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
