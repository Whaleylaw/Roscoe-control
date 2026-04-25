/**
 * Zod schema for the contents of a `recipe.yaml` file.
 *
 * This module is the single validation surface for raw YAML → RecipeYaml. Every
 * consumer (indexer in 12-02, watcher in 12-03, API layer in 12-04) imports
 * `parseRecipeYaml` from here so rejection messages are consistent across the
 * indexer log, `GET /api/recipes/:slug`, and `POST /api/recipes` responses.
 *
 * Validation rules summary:
 *   - `slug`: lowercase kebab-case, 1–64 chars, no leading/trailing dashes
 *   - `name`, `image`, `workspace_mode`: required
 *   - `workspace_mode` ∈ { 'worktree', 'readonly', 'none' }
 *   - `timeout_seconds`: integer in [10, 86400]
 *   - `max_concurrent`: integer in [1, 100], default 1
 *   - `max_attempts`: OPTIONAL integer in [1, 10] (Phase 14 — RUNNER-08).
 *       NOT round-tripped through the recipes DB row; Plan 14-05 / 14-06
 *       re-read recipe.yaml from disk (`getRecipesRoot()/<slug>/recipe.yaml`)
 *       and call `parseRecipeYaml()` to resolve the value at claim / exit time.
 *   - `model.primary`: MUST be in `model-registry` (MODEL-02)
 *   - `env`: Record<string, string>, default {}
 *   - `secrets`: string[] (ENV VAR names, not values), default []
 *   - `tools`: string[] of recipe-agent tool names, default []
 *   - `tags`: string[], default []
 *   - `version`: positive integer, default 1
 *
 * Soft / optional: `description`, `when_to_use`, `model.fallback`,
 * `model.provider`, `model.params`.
 */

import { z } from 'zod'
import { parse as yamlParse, YAMLParseError } from 'yaml'
import { isKnownModel, MODEL_IDS } from './model-registry'

/**
 * Canonical Zod schema for a recipe.yaml document. `z.infer` drives the
 * `RecipeYaml` type exported from `src/types/recipe.ts`.
 */
export const recipeYamlSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message:
        'slug must be lowercase kebab-case (a-z, 0-9, hyphens, no leading/trailing dash), 1-64 chars',
    })
    .min(1)
    .max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  when_to_use: z.string().max(2000).optional(),
  image: z.string().min(1),
  workspace_mode: z.enum(['worktree', 'readonly', 'none']),
  timeout_seconds: z.number().int().min(10).max(86400),
  max_concurrent: z.number().int().min(1).max(100).default(1),
  max_attempts: z.number().int().min(1).max(10).optional(),
  env: z.record(z.string(), z.string()).default({}),
  secrets: z.array(z.string().min(1)).default([]),
  tools: z.array(z.enum(['read_file', 'list_dir', 'grep_files', 'write_file', 'run_shell'])).default([]),
  tags: z.array(z.string().min(1)).default([]),
  model: z.object({
    primary: z
      .string()
      .min(1)
      .refine(isKnownModel, {
        error: (issue) =>
          `recipe.model.primary '${String(issue.input)}' is not in the model registry. ` +
          `Known models: ${MODEL_IDS.join(', ')}`,
      }),
    fallback: z.string().optional(),
    provider: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  version: z.number().int().min(1).default(1),
})

/**
 * Fully parsed + validated recipe.yaml shape. The source of truth for any
 * callers in Phase 12 (indexer, watcher, API) that need a typed view of the
 * YAML contents.
 */
export type RecipeYaml = z.infer<typeof recipeYamlSchema>

/**
 * Result of parsing a recipe.yaml file's raw string contents.
 *
 *   - `{ ok: true, value }`  — YAML parsed AND Zod schema accepted
 *   - `{ ok: false, error }` — YAML syntax error OR schema validation failure
 *
 * The `error` string is ready to be written into `recipes.error_message` and
 * surfaced in the indexer log + API response. It ALWAYS mentions the offending
 * file/field; for unknown `model.primary` it enumerates the known model IDs.
 */
export type ParseResult =
  | { ok: true; value: RecipeYaml }
  | { ok: false; error: string }

/**
 * Parse + validate raw recipe.yaml text.
 *
 * Never throws: syntax errors and schema failures both flow through the
 * discriminated {@link ParseResult} so callers can uniformly write the message
 * into `recipes.error_message` without try/catch noise.
 */
export function parseRecipeYaml(raw: string): ParseResult {
  // Step 1 — YAML parse.
  let json: unknown
  try {
    json = yamlParse(raw)
  } catch (err) {
    if (err instanceof YAMLParseError) {
      return { ok: false, error: `YAML parse error: ${err.message}` }
    }
    return {
      ok: false,
      error: `YAML parse error: ${(err as Error).message || String(err)}`,
    }
  }

  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return {
      ok: false,
      error: 'recipe.yaml must be a YAML mapping (object) at the root',
    }
  }

  // Step 2 — Zod schema.
  const result = recipeYamlSchema.safeParse(json)
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `${path}: ${issue.message}`
    })
    return { ok: false, error: lines.join('; ') }
  }

  return { ok: true, value: result.data }
}
