/**
 * GET / POST /api/recipes — recipe listing + creation endpoints.
 *
 * Plan 12-04 (Phase 12 — Recipe System). GET lists indexed recipes (Task 1);
 * POST performs the disk-first + atomic-rename + indexRecipe + rollback flow
 * (Task 2). Exports `mapRow` so sibling routes ([slug], search) reuse the
 * DB-row → DTO projection.
 *
 * See .planning/phases/12-recipe-system-v1-2/12-04-PLAN.md.
 */

import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile, rm, rename, access } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { indexRecipe } from '@/lib/recipe-indexer'
import { getRecipesRoot } from '@/lib/recipe-watcher'
import { parseRecipeYaml } from '@/lib/recipe-schema'
import { mutationLimiter } from '@/lib/rate-limit'
import { eventBus } from '@/lib/event-bus'

/**
 * GET /api/recipes — list all fully-indexed recipes (error_message IS NULL).
 *
 * Query params:
 *   include_broken=1   — include error rows as { slug, error_message } (admin only, debug aid)
 *
 * Response: { recipes: Array<FullRecipeDto | ErrorRecipeDto> }
 *
 * Role: viewer+ for the default (indexed-only) listing. include_broken=1 requires admin.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(request.url)
  const includeBroken = url.searchParams.get('include_broken') === '1'
  if (includeBroken && auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'include_broken requires admin role' }, { status: 403 })
  }

  try {
    const db = getDatabase()
    const rows = includeBroken
      ? db.prepare(`SELECT * FROM recipes ORDER BY slug`).all()
      : db.prepare(`SELECT * FROM recipes WHERE error_message IS NULL ORDER BY slug`).all()

    const recipes = (rows as Array<Record<string, unknown>>).map(mapRow)
    return NextResponse.json({ recipes })
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'GET /api/recipes failed')
    return NextResponse.json({ error: 'Failed to list recipes' }, { status: 500 })
  }
}

/**
 * Transform a raw DB row into the API DTO. Error rows produce a small
 * { slug, error_message, created_at, updated_at } shape so the API surface
 * signals "exists but broken" distinctly from 404. Fully-indexed rows project
 * every column into the public shape and deserialise the JSON-encoded fields.
 */
export function mapRow(row: Record<string, unknown>): Record<string, unknown> {
  if (row.error_message) {
    return {
      slug: row.slug,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    when_to_use: row.when_to_use ?? null,
    image: row.image,
    workspace_mode: row.workspace_mode,
    timeout_seconds: row.timeout_seconds,
    max_concurrent: row.max_concurrent,
    env: safeJson(row.env_json, {}),
    secrets: safeJson(row.secrets_json, []),
    tags: safeJson(row.tags_json, []),
    model: safeJson(row.model_json, {}),
    version: row.version,
    dir_sha: row.dir_sha,
    soul_md: row.soul_md ?? null,
    workspace_id: row.workspace_id,
    tenant_id: row.tenant_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function safeJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// POST /api/recipes — disk-first + atomic rename + indexRecipe + rollback.
// ---------------------------------------------------------------------------

const postBodySchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case lowercase')
    .min(1)
    .max(64),
  recipe_yaml: z.string().min(1),
  soul_md: z.string().default(''),
})

/**
 * POST /api/recipes — create a recipe on disk and index it atomically.
 *
 * Flow (disk-first, index-second, rollback-on-fail per CONTEXT.md):
 *   1. requireRole('admin') — admin only
 *   2. rate limit via mutationLimiter
 *   3. Validate body shape with Zod
 *   4. Pre-flight: reject if recipes/<slug>/ already exists on disk OR an active
 *      non-error row exists in DB → 409 Conflict, NO write
 *   5. Pre-flight: parse recipe_yaml via parseRecipeYaml to catch obvious failures
 *      before we touch disk → 400 with the schema error (includes MODEL-02)
 *   6. Pre-flight: reject if body.slug !== parsed.slug → 400
 *   7. Write to a temp directory outside recipes/
 *   8. Atomically rename the temp dir to recipes/<slug>/
 *   9. Call indexRecipe(absDir, { force: true })
 *  10. If indexRecipe returns 'error': rm -rf recipes/<slug>/, delete error row, return 500
 *  11. Return 201 with the indexed row
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateLimited = mutationLimiter(request)
  if (rateLimited) return rateLimited

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = postBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    )
  }

  const { slug, recipe_yaml, soul_md } = parsed.data
  const recipesRoot = getRecipesRoot()
  const targetDir = join(recipesRoot, slug)

  // Step 4: slug conflict check (disk OR DB).
  if (await pathExists(targetDir)) {
    return NextResponse.json(
      { error: `Recipe directory '${slug}' already exists on disk` },
      { status: 409 },
    )
  }
  const existing = getDatabase()
    .prepare(`SELECT slug, error_message FROM recipes WHERE slug = ?`)
    .get(slug) as { slug: string; error_message: string | null } | undefined
  if (existing && existing.error_message === null) {
    return NextResponse.json({ error: `Recipe '${slug}' already indexed` }, { status: 409 })
  }

  // Step 5: pre-flight validate the YAML so we never write a broken recipe to disk.
  const yamlResult = parseRecipeYaml(recipe_yaml)
  if (!yamlResult.ok) {
    return NextResponse.json(
      { error: 'Recipe YAML invalid', details: [yamlResult.error] },
      { status: 400 },
    )
  }

  // Step 6: body slug must match YAML slug.
  if (yamlResult.value.slug !== slug) {
    return NextResponse.json(
      {
        error: `Slug mismatch: body.slug='${slug}' but recipe_yaml slug='${yamlResult.value.slug}'`,
      },
      { status: 400 },
    )
  }

  // Step 7: ensure recipesRoot exists before the rename target path is usable.
  try {
    await mkdir(recipesRoot, { recursive: true })
  } catch {
    // Ignore — either existed already or step 8 will surface a clearer error.
  }

  // Step 8: write to temp dir, then atomic rename.
  const tempDir = join(
    tmpdir(),
    `mc-recipe-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  try {
    await mkdir(tempDir, { recursive: true })
    await writeFile(join(tempDir, 'recipe.yaml'), recipe_yaml, 'utf8')
    if (soul_md) await writeFile(join(tempDir, 'SOUL.md'), soul_md, 'utf8')

    // Atomic rename from temp to target. When tmpdir is on a different filesystem
    // than recipesRoot (common in CI containers and test setups that put tmpdir
    // on tmpfs), fs.rename will throw EXDEV — fall back to copy + remove.
    try {
      await rename(tempDir, targetDir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        const { cp } = await import('fs/promises')
        await cp(tempDir, targetDir, { recursive: true })
        await rm(tempDir, { recursive: true, force: true })
      } else {
        throw err
      }
    }

    // Step 9: index.
    const indexResult = await indexRecipe(targetDir, { force: true })
    if (indexResult.status === 'error') {
      // Step 10: rollback — remove the freshly written directory AND the
      // error row indexRecipe just wrote so repeating the POST starts clean.
      await rm(targetDir, { recursive: true, force: true }).catch(() => {})
      getDatabase().prepare(`DELETE FROM recipes WHERE slug = ?`).run(slug)
      return NextResponse.json(
        { error: 'Recipe indexing failed', details: [indexResult.error] },
        { status: 500 },
      )
    }

    // Read the freshly indexed row and return it through the shared mapRow projection.
    const row = getDatabase()
      .prepare(`SELECT * FROM recipes WHERE slug = ?`)
      .get(slug) as Record<string, unknown>
    if (indexResult.status === 'indexed') {
      eventBus.broadcast('recipe.indexed', { slug, dir_sha: indexResult.dirSha })
    }
    return NextResponse.json({ recipe: mapRow(row) }, { status: 201 })
  } catch (err) {
    // Best-effort cleanup on any unexpected error: remove temp + target, surface 500.
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    await rm(targetDir, { recursive: true, force: true }).catch(() => {})
    logger.error({ err: (err as Error).message, slug }, 'POST /api/recipes failed')
    return NextResponse.json({ error: 'Failed to create recipe' }, { status: 500 })
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}
