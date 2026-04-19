/**
 * Shared TypeScript types for the Phase 12 recipe system.
 *
 * These types are the bridge between:
 *   - The SQLite `recipes` table (rows written by the indexer in Plan 12-02)
 *   - The API surfaces (listing, search, GET by slug) in Plan 12-04
 *   - The watcher (Plan 12-03) that drives re-indexing
 *
 * The row shape is split into two narrow interfaces (RecipeRow / RecipeErrorRow)
 * so downstream code can discriminate between a fully indexed recipe and a
 * broken-recipe row purely on `error_message === null`.
 */

import type { RecipeYaml as _RecipeYaml } from '../lib/recipe-schema'

/**
 * Parsed `model` block from recipe.yaml. The indexer serialises this into the
 * `model_json` column and downstream consumers deserialise on read.
 *
 * Only `primary` is guaranteed — the Zod schema validates it against the
 * model-registry at parse time (MODEL-02).
 */
export interface RecipeModel {
  primary: string
  fallback?: string
  provider?: string
  params?: Record<string, unknown>
}

/**
 * DB row shape for a FULLY INDEXED recipe (error_message IS NULL).
 *
 * All JSON columns (`env_json`, `secrets_json`, `tags_json`, `model_json`) are
 * assumed to be parsed into their declared types before the row reaches the
 * caller — API handlers in Plan 12-04 do that deserialisation.
 *
 * `error_message` is pinned to `null` here so the discriminated union with
 * {@link RecipeErrorRow} narrows cleanly on `row.error_message === null`.
 */
export interface RecipeRow {
  id: number
  slug: string
  name: string
  description: string | null
  when_to_use: string | null
  image: string
  workspace_mode: 'worktree' | 'readonly' | 'none'
  timeout_seconds: number
  max_concurrent: number
  env: Record<string, string>
  secrets: string[]
  tags: string[]
  model: RecipeModel
  version: number
  dir_sha: string
  soul_md: string | null
  error_message: null
  workspace_id: number
  tenant_id: number
  created_at: number
  updated_at: number
}

/**
 * Error-row discriminated partner. Only `slug`, `error_message`, `id`, and
 * timestamps are guaranteed — other columns may be default or null and must
 * NOT be trusted by consumers.
 *
 * The `GET /api/recipes/:slug` handler in Plan 12-04 projects these rows as
 * `{ slug, error_message }` for the API response; indexing log in Plan 12-02
 * mirrors the `error_message` verbatim into its structured log record.
 */
export interface RecipeErrorRow {
  id: number
  slug: string
  error_message: string
  created_at: number
  updated_at: number
}

/**
 * Re-export of the parsed YAML shape (source of truth lives in recipe-schema.ts
 * where the Zod schema defines it via `z.infer`). Centralising it here lets
 * callers import all recipe types from a single module.
 */
export type RecipeYaml = _RecipeYaml
