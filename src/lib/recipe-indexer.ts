/**
 * Single write path for the `recipes` table.
 *
 * Every caller that materialises a filesystem recipe directory into a DB row
 * routes through `indexRecipe` in this module:
 *   - The boot scanner / chokidar watcher (Plan 12-03)
 *   - The `POST /api/recipes` endpoint (Plan 12-04)
 *   - Any future resync / CLI maintenance tool
 *
 * Centralising the logic here means each caller shares one interpretation of:
 *   - YAML parsing + Zod validation (delegated to `parseRecipeYaml` from 12-01)
 *   - Directory content hashing (`computeDirSha` from `recipe-hash.ts`)
 *   - The error-row flow — invalid recipes still produce a row with
 *     `error_message` populated so `GET /api/recipes/:slug` can surface the
 *     message to operators (see CONTEXT.md "hard fail cases")
 *
 * Flow for each `indexRecipe(absDir)` call:
 *   1. Derive slug from `basename(absDir)`
 *   2. If `recipe.yaml` is missing → `skipped_missing` (caller decides whether to removeRecipe)
 *   3. Compute `dir_sha` over the directory
 *   4. If an existing row has the same `dir_sha` AND `error_message IS NULL` → `unchanged` (no DB write)
 *   5. Parse + validate `recipe.yaml`
 *   6. On parse failure → write an error row + log + return `error`
 *   7. Verify the YAML's `slug` matches the directory name (else → error row)
 *   8. Read optional `SOUL.md` and `REVIEW.md`
 *   9. UPSERT the full row (error_message set to NULL — this also handles the
 *      broken-to-valid recovery path so a fixed recipe becomes readable again)
 *
 * Removals (`removeRecipe`) go through the migration 059 AFTER DELETE trigger,
 * which cascades into `recipes_fts` so search queries don't return stale rows.
 */

import { readFile } from 'fs/promises'
import { join, basename } from 'path'
import type Database from 'better-sqlite3'
import { getDatabase } from './db'
import { logger } from './logger'
import { parseRecipeYaml } from './recipe-schema'
import { computeDirSha } from './recipe-hash'
import type { RecipeYaml } from './recipe-schema'
import type { RecipeRow, RecipeErrorRow } from '../types/recipe'

/**
 * Discriminated outcome of a single `indexRecipe` call.
 *
 *   - `indexed`         — row inserted/updated with a valid recipe
 *   - `unchanged`       — `dir_sha` matched the existing row; DB not touched
 *   - `error`           — validation failed; minimal error-row written with `error_message`
 *   - `skipped_missing` — `recipe.yaml` does not exist in `absDir`; NO row written
 *                         (caller should call `removeRecipe` if a row exists)
 *
 * The watcher (Plan 12-03) switches on `status` to decide log level + event
 * emission; the POST endpoint (Plan 12-04) maps `error` → 400 response.
 */
export type IndexResult =
  | { status: 'indexed'; slug: string; dirSha: string }
  | { status: 'unchanged'; slug: string; dirSha: string }
  | { status: 'error'; slug: string; error: string }
  | { status: 'skipped_missing'; slug: string }

/** Options for `indexRecipe`. All fields optional; defaults match the global workspace. */
export interface IndexOptions {
  /** `workspace_id` to scope the row. Defaults to 1 (global workspace). */
  workspaceId?: number
  /** `tenant_id` to scope the row. Defaults to 1. */
  tenantId?: number
  /** Force reindex even if `dir_sha` matches (used by POST /api/recipes and resync). */
  force?: boolean
  /** Override `getDatabase()` — used by tests with an in-memory Database. */
  dbOverride?: Database.Database
}

/**
 * Index a recipe directory into the DB.
 *
 * See the module-level doc for the full flow. Never throws; all failure modes
 * resolve to an `IndexResult` variant. Caller can inspect `status` and decide
 * whether to emit an event, log, or retry.
 */
export async function indexRecipe(
  absDir: string,
  opts: IndexOptions = {},
): Promise<IndexResult> {
  const workspaceId = opts.workspaceId ?? 1
  const tenantId = opts.tenantId ?? 1
  const db = opts.dbOverride ?? getDatabase()
  const slug = basename(absDir)

  // Step 2: recipe.yaml existence check. Missing → skipped_missing (NO row written).
  let recipeYamlRaw: string
  try {
    recipeYamlRaw = await readFile(join(absDir, 'recipe.yaml'), 'utf8')
  } catch {
    return { status: 'skipped_missing', slug }
  }

  // Step 3: deterministic content hash over the directory.
  const dirSha = await computeDirSha(absDir)

  // Step 4: fast-path dedup. Only short-circuit when the existing row is a
  // FULLY INDEXED row (error_message IS NULL). If the existing row is an error
  // row — even with the same dir_sha — we want to re-parse so a fix in the YAML
  // (without any other file changes) still flips error_message back to NULL.
  const existing = db
    .prepare(`SELECT dir_sha, error_message FROM recipes WHERE slug = ?`)
    .get(slug) as { dir_sha: string; error_message: string | null } | undefined
  if (
    !opts.force &&
    existing &&
    existing.dir_sha === dirSha &&
    existing.error_message === null
  ) {
    return { status: 'unchanged', slug, dirSha }
  }

  // Step 5: YAML parse + Zod validation.
  const parsed = parseRecipeYaml(recipeYamlRaw)
  if (!parsed.ok) {
    logger.error(
      { slug, path: absDir, reason: parsed.error },
      'recipe index failed',
    )
    writeErrorRow(db, slug, parsed.error, dirSha, workspaceId, tenantId)
    return { status: 'error', slug, error: parsed.error }
  }

  // Step 7: slug-vs-directory consistency. If the YAML declares a different slug
  // than the directory name, the watcher and the API would disagree on which
  // row to operate on — treat as a hard-fail and write an error row.
  if (parsed.value.slug !== slug) {
    const reason = `slug mismatch: directory is '${slug}' but recipe.yaml says '${parsed.value.slug}'`
    logger.error({ slug, path: absDir, reason }, 'recipe index failed')
    writeErrorRow(db, slug, reason, dirSha, workspaceId, tenantId)
    return { status: 'error', slug, error: reason }
  }

  // Step 8: optional SOUL.md and REVIEW.md (null if missing).
  let soulMd: string | null = null
  try {
    soulMd = await readFile(join(absDir, 'SOUL.md'), 'utf8')
  } catch {
    soulMd = null
  }
  let reviewMd: string | null = null
  try {
    reviewMd = await readFile(join(absDir, 'REVIEW.md'), 'utf8')
  } catch {
    reviewMd = null
  }

  // Step 9: UPSERT the full row. `ON CONFLICT ... DO UPDATE` fires the
  // `recipes_fts_au` trigger (migration 059) which re-syncs FTS5.
  writeIndexedRow(db, parsed.value, dirSha, soulMd, reviewMd, workspaceId, tenantId)
  return { status: 'indexed', slug, dirSha }
}

/**
 * Delete a recipe row by slug. The migration 059 AFTER DELETE trigger cascades
 * the delete into `recipes_fts`. No-op (returns `{ removed: false }`) if the
 * row does not exist.
 */
export function removeRecipe(
  slug: string,
  opts: { dbOverride?: Database.Database } = {},
): { removed: boolean } {
  const db = opts.dbOverride ?? getDatabase()
  const result = db.prepare(`DELETE FROM recipes WHERE slug = ?`).run(slug)
  return { removed: result.changes > 0 }
}

/**
 * Read an indexed recipe by slug, parsing the JSON columns back into their
 * declared types. Used by `GET /api/recipes/:slug` (Plan 12-04) and the runner
 * dispatch path (Plan 14).
 *
 * Returns:
 *   - `RecipeRow` when `error_message IS NULL` (fully indexed)
 *   - `RecipeErrorRow` when `error_message IS NOT NULL` (broken recipe)
 *   - `null` when no row exists for the slug
 *
 * Consumers discriminate via `'error_message' in row && row.error_message !== null`.
 */
export function getIndexedRecipeBySlug(
  slug: string,
  opts: { dbOverride?: Database.Database } = {},
): RecipeRow | RecipeErrorRow | null {
  const db = opts.dbOverride ?? getDatabase()
  const row = db.prepare(`SELECT * FROM recipes WHERE slug = ?`).get(slug) as
    | Record<string, unknown>
    | undefined
  if (!row) return null

  if (row.error_message) {
    return {
      id: row.id as number,
      slug: row.slug as string,
      error_message: row.error_message as string,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    }
  }

  return {
    id: row.id as number,
    slug: row.slug as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    when_to_use: (row.when_to_use as string) ?? null,
    image: row.image as string,
    workspace_mode: row.workspace_mode as 'worktree' | 'readonly' | 'none',
    timeout_seconds: row.timeout_seconds as number,
    max_concurrent: row.max_concurrent as number,
    env: JSON.parse((row.env_json as string) || '{}'),
    secrets: JSON.parse((row.secrets_json as string) || '[]'),
    tags: JSON.parse((row.tags_json as string) || '[]'),
    model: JSON.parse((row.model_json as string) || '{}'),
    version: row.version as number,
    dir_sha: row.dir_sha as string,
    soul_md: (row.soul_md as string) ?? null,
    review_md: (row.review_md as string) ?? null,
    error_message: null,
    workspace_id: row.workspace_id as number,
    tenant_id: row.tenant_id as number,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  }
}

// ---------- internal helpers ----------

/** UPSERT a fully indexed recipe row. All JSON fields are serialised here. */
function writeIndexedRow(
  db: Database.Database,
  y: RecipeYaml,
  dirSha: string,
  soulMd: string | null,
  reviewMd: string | null,
  workspaceId: number,
  tenantId: number,
): void {
  db.prepare(
    `
    INSERT INTO recipes
      (slug, name, description, when_to_use, image, workspace_mode, timeout_seconds,
       max_concurrent, env_json, secrets_json, tags_json, model_json, version, dir_sha, soul_md,
       review_md, error_message, workspace_id, tenant_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, unixepoch())
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name,
      description=excluded.description,
      when_to_use=excluded.when_to_use,
      image=excluded.image,
      workspace_mode=excluded.workspace_mode,
      timeout_seconds=excluded.timeout_seconds,
      max_concurrent=excluded.max_concurrent,
      env_json=excluded.env_json,
      secrets_json=excluded.secrets_json,
      tags_json=excluded.tags_json,
      model_json=excluded.model_json,
      version=excluded.version,
      dir_sha=excluded.dir_sha,
      soul_md=excluded.soul_md,
      review_md=excluded.review_md,
      error_message=NULL,
      workspace_id=excluded.workspace_id,
      tenant_id=excluded.tenant_id,
      updated_at=unixepoch()
  `,
  ).run(
    y.slug,
    y.name,
    y.description ?? null,
    y.when_to_use ?? null,
    y.image,
    y.workspace_mode,
    y.timeout_seconds,
    y.max_concurrent,
    JSON.stringify(y.env),
    JSON.stringify(y.secrets),
    JSON.stringify(y.tags),
    JSON.stringify(y.model),
    y.version,
    dirSha,
    soulMd,
    reviewMd,
    workspaceId,
    tenantId,
  )
}

/**
 * UPSERT a minimal error row.
 *
 * Error rows carry just `slug`, `error_message`, scoping, and timestamps. The
 * migration 054 schema requires non-null values for several columns (`name`,
 * `image`, `workspace_mode`, `timeout_seconds`, `dir_sha`) — we pass safe
 * placeholders so the row round-trips through PRAGMA without NOT NULL errors.
 * These placeholders are NEVER surfaced to API callers — the handler in
 * Plan 12-04 projects error rows as `{ slug, error_message }` only.
 *
 * `dir_sha` for error rows IS the directory's computed hash (not '') so a
 * subsequent indexer call with identical broken content can short-circuit —
 * except we deliberately don't short-circuit error rows (see step 4 above) so
 * a fix still re-runs the parser even when no other files changed.
 */
function writeErrorRow(
  db: Database.Database,
  slug: string,
  errorMessage: string,
  dirSha: string,
  workspaceId: number,
  tenantId: number,
): void {
  db.prepare(
    `
    INSERT INTO recipes
      (slug, name, image, workspace_mode, timeout_seconds, dir_sha,
       env_json, secrets_json, tags_json, model_json, max_concurrent, version,
       error_message, workspace_id, tenant_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '{}', '[]', '[]', '{}', 1, 1, ?, ?, ?, unixepoch())
    ON CONFLICT(slug) DO UPDATE SET
      error_message=excluded.error_message,
      dir_sha=excluded.dir_sha,
      updated_at=unixepoch()
  `,
  ).run(
    slug,
    slug, // name fallback to slug
    'unknown', // image placeholder
    'worktree', // workspace_mode placeholder
    0, // timeout_seconds placeholder
    dirSha,
    errorMessage,
    workspaceId,
    tenantId,
  )
}
