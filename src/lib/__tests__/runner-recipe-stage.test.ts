/**
 * Test scaffold for recipe-stage copy + PREAMBLE.md write (Plan 14-07).
 *
 * Wave 0 stubs — replaced with real test bodies in the Wave 1/2 plan that
 * implements src/lib/runner-recipe-stage.ts. Stages a read-only copy of a
 * recipe directory outside MISSION_CONTROL_RECIPES_DIR so the chokidar
 * watcher (Plan 12-03) does not re-index the staged copy.
 */

import { describe, it } from 'vitest'

describe('runner recipe-stage copy + PREAMBLE.md write', () => {
  it.todo(
    'recipe-stage dir is created under .data/runner/recipe-stage/task-<id>/ (outside MISSION_CONTROL_RECIPES_DIR — Pitfall 10 guard against chokidar re-index)',
  )
  it.todo(
    'deep copy includes recipe tools/, skills/, README.md, SOUL.md — no symlinks back to the source dir',
  )
  it.todo(
    'PREAMBLE.md is written AFTER the deep copy so a recipe-authored PREAMBLE.md would be overwritten (runner owns /recipe/PREAMBLE.md)',
  )
  it.todo(
    'staged dir path resolves OUTSIDE getRecipesRoot() — verified via path.relative() starts-with ".."',
  )
})
