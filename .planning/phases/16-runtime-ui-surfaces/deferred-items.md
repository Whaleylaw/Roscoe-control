# Phase 16 — Deferred Items

## Pre-existing flaky test (out of scope)

**File:** `src/lib/__tests__/recipe-watcher-events.test.ts`
**Symptom:** Test "broadcasts recipe.indexed after a live change event (debounce observed)" times out on `expect(indexedForDelta).toBeDefined()` when run as part of the full `pnpm test --run` suite, but passes in isolation (`pnpm vitest run src/lib/__tests__/recipe-watcher-events.test.ts`).
**Origin:** Phase 15-06 (c950794 `feat(15-06): emit recipe.indexed / recipe.removed from recipe watcher`).
**Root cause (suspected):** chokidar/fsevents debounce-window timing on macOS under whole-suite load — not a production-code defect.
**Impact on Plan 16-01:** None. 16-01 does not touch `src/lib/recipe-watcher.ts` or its test. The flake is documented here so a future stabilisation PR can own the retry/waitFor refactor without being misread as Phase 16 regression.

## Pre-existing (documented in STATE.md)

**File:** `src/lib/__tests__/runner-tokens.test.ts:194`
**Symptom:** allowlist-length drift assertion.
**Origin:** Phase 15-04. Tracked since then in `.planning/STATE.md`.

## Parallel-wave in-flight noise (out of scope for 16-04)

**Files/area:** `src/components/panels/task-board-panel.tsx` EditTaskModal region (lines ~2648+)
**Symptom:** During parallel Wave-1 execution 16-04's working-tree typecheck and two of 21 `task-board-panel.test.tsx` tests ("EditTaskModal project select visible…", "submitting EditTaskModal with different project_id calls PUT") reported `ReferenceError: recipeSlug is not defined`.
**Root cause:** Plan 16-05 landed its `<RecipeCombobox value={recipeSlug}` JSX hunk in the EditTaskModal before its corresponding `useState` declarations were committed.
**Impact on Plan 16-04:** Zero. When 16-05's uncommitted hunk is stashed, `pnpm typecheck` exits 0 and 21/21 task-board-panel tests pass. Plan 16-04's own tests (`src/components/panels/task-detail/__tests__/*.test.tsx`) are unaffected in either scenario.
**Resolution:** Plan 16-05's next commit will land the `useState` declarations and clear the ReferenceError; if not, a dedicated chore follows.
