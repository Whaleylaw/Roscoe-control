/**
 * Pure helpers used by the runner claim route (Plan 14-05) and runner-exit
 * route (Plan 14-06). Kept in a standalone module so the HTTP handlers stay
 * thin and the logic is unit-testable without spinning up Next.js.
 *
 * Phase 14 locked decision (per 14-02 SUMMARY + 14-05/14-06 frontmatter):
 * `recipe.max_attempts` is NOT round-tripped through the recipes DB row.
 * `getIndexedRecipeBySlug` projects a fixed column set and the `recipes`
 * table has no `max_attempts` column. Resolution happens via filesystem
 * re-parse of `recipe.yaml` — this module owns the helper.
 *
 * Resolution rule at claim / exit time:
 *   final_max_attempts = task.runner_max_attempts
 *                     ?? resolveRecipeMaxAttempts(slug)
 *                     ?? 3
 *
 * Plan 14-05 is expected to extend this module with additional helpers
 * (resolveEffectiveModel, composeEnvMap, resolveResourceLimits,
 * checkGlobalCap, checkPerRecipeCap, readPriorAttempts, buildDispatchPayload).
 * Plan 14-06 only needs resolveRecipeMaxAttempts, so this ships the minimal
 * surface that both plans agree on.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getRecipesRoot } from '@/lib/recipe-watcher'
import { parseRecipeYaml } from '@/lib/recipe-schema'

/**
 * Resolve the `max_attempts` value declared on disk for a recipe slug.
 *
 * Reads `<recipesRoot>/<slug>/recipe.yaml` and runs it through
 * `parseRecipeYaml`. Returns the parsed value when present, otherwise
 * `undefined` — callers should treat `undefined` as "no opinion" and fall
 * through to the next precedence tier (default cap of 3 in Plan 14-06).
 *
 * Silently returns `undefined` on missing file, unreadable file, or parse
 * error. A corrupt recipe.yaml must NEVER prevent the claim/exit state
 * machine from making progress — the 500 surface belongs to the indexer,
 * not to the runner-exit hot path.
 *
 * @param slug  Recipe slug (directory name under recipes root).
 * @param recipesRootOverride  Optional override for the recipes root. Used
 *                             by tests to point at a tmpdir fixture without
 *                             mutating `MISSION_CONTROL_RECIPES_DIR`.
 */
export function resolveRecipeMaxAttempts(
  slug: string,
  recipesRootOverride?: string,
): number | undefined {
  if (!slug) return undefined
  const recipesRoot = recipesRootOverride ?? getRecipesRoot()
  const yamlPath = join(recipesRoot, slug, 'recipe.yaml')
  if (!existsSync(yamlPath)) return undefined
  try {
    const raw = readFileSync(yamlPath, 'utf8')
    const parsed = parseRecipeYaml(raw)
    if (parsed.ok) return parsed.value.max_attempts
  } catch {
    // Fall through to undefined — see function-header contract.
  }
  return undefined
}
