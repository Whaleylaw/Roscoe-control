/**
 * GET /api/recipes/:slug — fetch a single recipe by slug.
 *
 * Plan 12-04 (Phase 12 — Recipe System). Uses `getIndexedRecipeBySlug` from
 * Plan 12-02 which already discriminates between fully-indexed and error rows.
 * This handler re-serialises the row through `mapRow` (from the sibling list
 * route) so the GET-by-slug shape is identical to what a list entry looks like.
 *
 * Response codes:
 *   200 — recipe found (full shape or { slug, error_message } for broken recipes)
 *   404 — slug not in recipes table
 *   401/403 — viewer+ required
 *   500 — unexpected DB/parse failure
 */

import { NextRequest, NextResponse } from 'next/server'
import { mkdir, readFile, rm, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getIndexedRecipeBySlug, indexRecipe, removeRecipe } from '@/lib/recipe-indexer'
import { logger } from '@/lib/logger'
import { mapRow } from '../route'
import { getRecipesRoot } from '@/lib/recipe-watcher'
import { parseRecipeYaml } from '@/lib/recipe-schema'
import { mutationLimiter } from '@/lib/rate-limit'
import { eventBus } from '@/lib/event-bus'

/**
 * GET /api/recipes/:slug — fetch a single recipe, returning either:
 *   - 200 with the full recipe when error_message IS NULL
 *   - 200 with { slug, error_message, created_at, updated_at } when broken
 *     (CONTEXT.md: error surface is visible through the API so UIs can render the failure)
 *   - 404 when the slug does not exist
 */
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { slug } = await context.params
    const row = getIndexedRecipeBySlug(slug)
    if (!row) {
      return NextResponse.json({ error: `Recipe '${slug}' not found` }, { status: 404 })
    }
    // `getIndexedRecipeBySlug` already deserialises env/secrets/tags/model from
    // JSON columns; mapRow expects the raw *_json shape so we re-serialise the
    // fields before handing off. This keeps a single projection path between
    // list, search, and fetch-by-slug so any future shape change lands in one
    // place (mapRow).
    const raw: Record<string, unknown> = { ...(row as unknown as Record<string, unknown>) }
    if ('env' in raw) raw.env_json = JSON.stringify(raw.env)
    if ('secrets' in raw) raw.secrets_json = JSON.stringify(raw.secrets)
    if ('tags' in raw) raw.tags_json = JSON.stringify(raw.tags)
    if ('model' in raw) raw.model_json = JSON.stringify(raw.model)
    return NextResponse.json({ recipe: mapRow(raw) })
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'GET /api/recipes/:slug failed')
    return NextResponse.json({ error: 'Failed to fetch recipe' }, { status: 500 })
  }
}

const mutationBodySchema = z.object({
  recipe_yaml: z.string().min(1),
  soul_md: z.string().default(''),
})

/**
 * PUT /api/recipes/:slug — update recipe.yaml and SOUL.md on disk, then force reindex.
 *
 * The route intentionally edits only the two UI-owned files. Existing README.md,
 * tools/, and skills/ content is preserved.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
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

  const parsed = mutationBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    )
  }

  const { slug } = await context.params
  const yamlResult = parseRecipeYaml(parsed.data.recipe_yaml)
  if (!yamlResult.ok) {
    return NextResponse.json(
      { error: 'Recipe YAML invalid', details: [yamlResult.error] },
      { status: 400 },
    )
  }
  if (yamlResult.value.slug !== slug) {
    return NextResponse.json(
      {
        error: `Slug mismatch: route slug='${slug}' but recipe_yaml slug='${yamlResult.value.slug}'`,
      },
      { status: 400 },
    )
  }

  const recipeDir = join(getRecipesRoot(), slug)
  const yamlPath = join(recipeDir, 'recipe.yaml')
  const soulPath = join(recipeDir, 'SOUL.md')

  let previousYaml: string | null = null
  let previousSoul: string | null = null
  try {
    previousYaml = await readFile(yamlPath, 'utf8')
  } catch {
    return NextResponse.json({ error: `Recipe '${slug}' not found on disk` }, { status: 404 })
  }
  try {
    previousSoul = await readFile(soulPath, 'utf8')
  } catch {
    previousSoul = null
  }

  try {
    await writeFile(yamlPath, parsed.data.recipe_yaml, 'utf8')
    if (parsed.data.soul_md) {
      await writeFile(soulPath, parsed.data.soul_md, 'utf8')
    } else {
      await unlink(soulPath).catch(() => {})
    }

    const indexResult = await indexRecipe(recipeDir, { force: true })
    if (indexResult.status === 'error') {
      throw new Error(indexResult.error)
    }
    const row = getIndexedRecipeBySlug(slug)
    if (!row || row.error_message !== null) {
      throw new Error('Recipe reindex did not produce a valid row')
    }
    eventBus.broadcast('recipe.indexed', {
      slug,
      dir_sha: indexResult.status === 'indexed' || indexResult.status === 'unchanged' ? indexResult.dirSha : null,
    })

    const raw: Record<string, unknown> = { ...(row as unknown as Record<string, unknown>) }
    if ('env' in raw) raw.env_json = JSON.stringify(raw.env)
    if ('secrets' in raw) raw.secrets_json = JSON.stringify(raw.secrets)
    if ('tags' in raw) raw.tags_json = JSON.stringify(raw.tags)
    if ('model' in raw) raw.model_json = JSON.stringify(raw.model)
    return NextResponse.json({ recipe: mapRow(raw) })
  } catch (err) {
    if (previousYaml !== null) {
      await mkdir(recipeDir, { recursive: true }).catch(() => {})
      await writeFile(yamlPath, previousYaml, 'utf8').catch(() => {})
    }
    if (previousSoul !== null) {
      await writeFile(soulPath, previousSoul, 'utf8').catch(() => {})
    } else {
      await unlink(soulPath).catch(() => {})
    }
    await indexRecipe(recipeDir, { force: true }).catch(() => {})
    logger.error({ err: (err as Error).message, slug }, 'PUT /api/recipes/:slug failed')
    return NextResponse.json({ error: 'Failed to update recipe' }, { status: 500 })
  }
}

/**
 * DELETE /api/recipes/:slug — remove the recipe directory and indexed row.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateLimited = mutationLimiter(request)
  if (rateLimited) return rateLimited

  const { slug } = await context.params
  try {
    await rm(join(getRecipesRoot(), slug), { recursive: true, force: true })
    const result = removeRecipe(slug)
    if (result.removed) {
      eventBus.broadcast('recipe.removed', { slug })
    }
    return NextResponse.json({ ok: true, removed: result.removed })
  } catch (err) {
    logger.error({ err: (err as Error).message, slug }, 'DELETE /api/recipes/:slug failed')
    return NextResponse.json({ error: 'Failed to delete recipe' }, { status: 500 })
  }
}
