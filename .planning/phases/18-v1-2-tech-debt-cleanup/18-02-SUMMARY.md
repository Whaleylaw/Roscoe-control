---
phase: 18-v1-2-tech-debt-cleanup
plan: 02
subsystem: testing
tags: [playwright, vitest, testing, data-testid, recipe-badge, e2e-locator-hardening]

# Dependency graph
requires:
  - phase: 16-runtime-ui-surfaces
    provides: RecipeBadge component (RUI-01)
  - phase: 17-openclaw-local-e2e
    provides: Phase 17-06 recipes-progress-live.spec.ts (RTEST-04)
provides:
  - RecipeBadge root span carries data-testid="recipe-badge"
  - Phase 17-06 Playwright spec prefers data-testid primary locator via .or() chain
  - Text regex fallback retained as safety net for pre-18-02 builds / recipe renames
  - Unit test coverage extended with data-testid assertion (11th test)
affects: [e2e-tests, recipe-ui, v1.2-milestone-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Test-locator hardening pattern: `locator('[data-testid=\"X\"]').or(locator('text=/…/i'))` — primary testid + text safety net"

key-files:
  created: []
  modified:
    - src/components/panels/task-card/recipe-badge.tsx
    - src/components/panels/task-card/__tests__/recipe-badge.test.tsx
    - tests/recipes-progress-live.spec.ts

key-decisions:
  - "Retained text=/hello.world/i fallback as .or() safety net (not a replacement) so stale/pre-18-02 deployments still pass the spec"
  - "Placed data-testid as first attribute on the <span> root (before className/title/aria-label) for grep-friendly visibility"
  - "Added JSDoc note pointing future readers at Phase 18-02 / audit-td-2 as the origin of the data-testid"

patterns-established:
  - "Playwright locator hardening: prefer data-testid with text fallback via .or() chain rather than hard-replace"
  - "Unit test coverage for data-testid attributes (screen.getByTestId) in addition to aria/text assertions"

requirements-completed: [audit-td-2, RUI-01, RTEST-04]

# Metrics
duration: 6min
completed: 2026-04-21
---

# Phase 18 Plan 02: RecipeBadge data-testid + Phase 17-06 locator hardening Summary

**Added `data-testid="recipe-badge"` to the RecipeBadge root span and swapped the Phase 17-06 Playwright locator to a `.or()` chain (primary testid + text-regex safety net), closing audit-td-2 from the v1.2 milestone audit.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-21T13:51:52Z
- **Completed:** 2026-04-21T13:57:17Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- RecipeBadge component root `<span>` now carries `data-testid="recipe-badge"` (one-line attribute add + JSDoc note)
- Phase 17-06 Playwright spec (`tests/recipes-progress-live.spec.ts`) now prefers `[data-testid="recipe-badge"]` as the primary locator with the original `text=/hello.world/i` fallback retained via `.or()` safety net
- Unit test suite extended from 10 → 11 tests: new `it()` block asserts `screen.getByTestId('recipe-badge')` resolves on the root element
- `pnpm typecheck` passes; full 11-test suite passes in 45ms of test time
- audit-td-2 closure evidence satisfied (grep + typecheck + test all green)

## Task Commits

Each task group was committed atomically (plan-specified single fix commit for all three files):

1. **Task 1: Add data-testid="recipe-badge" to RecipeBadge component root** - part of `96c57d9`
2. **Task 2: Harden Phase 17-06 Playwright locator with data-testid primary + text fallback** - part of `96c57d9`
3. **Task 3: Extend RecipeBadge unit test + commit all three file changes** - `96c57d9` (fix)

**Plan metadata:** (added in final metadata commit — see below)

_Note: Plan 18-02 is explicitly a single-commit fix per its Task 3 directive; there are no per-task commits because Task 3 bundles all three files into one conventional commit._

## Files Created/Modified

- `src/components/panels/task-card/recipe-badge.tsx` — Added `data-testid="recipe-badge"` attribute to root `<span>`; added JSDoc paragraph documenting the test locator origin (Phase 18-02 / audit-td-2)
- `src/components/panels/task-card/__tests__/recipe-badge.test.tsx` — Added new `it('renders data-testid="recipe-badge" on the root element (Phase 18-02 / audit-td-2)')` block (11th test)
- `tests/recipes-progress-live.spec.ts` — Step 7 locator switched from `taskCard.locator('text=/hello.world/i').first()` to `taskCard.locator('[data-testid="recipe-badge"]').or(taskCard.locator('text=/hello.world/i')).first()`; updated inline comment to document the new primary + fallback intent

## Decisions Made

- **Retained text fallback via `.or()` rather than hard-replace** — explicit plan requirement. Rationale: a recipe rename or an accidentally stripped data-testid shouldn't silently break the E2E. The `.or()` chain means Playwright tries the testid first and only falls through to text if the testid is missing. This matches the "safety net" language in the plan's must_haves.truths.
- **Attribute order: `data-testid` placed first on the `<span>`** — Makes the attribute the first thing a reader sees when scanning the JSX; optimizes for grep and for future maintainers who want to confirm the testid exists without reading className walls. Per plan: "order does not affect render."
- **JSDoc documentation of the testid** — A single sentence appended to the existing JSDoc block so future developers understand why the testid exists and can trace it back to Phase 18-02 / audit-td-2 without grep-hunting through planning docs.

## Deviations from Plan

None — plan executed exactly as written. All three tasks completed in sequence, all verification commands passed on the first run, single commit as specified.

## Issues Encountered

None. This was a pure additive change with zero behavior impact.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plans 18-03 and 18-04 are unblocked (this plan had no dependents inside Phase 18; it's wave-1 with `depends_on: []`)
- audit-td-2 from `.planning/v1.2-MILESTONE-AUDIT.md` is now closed — next `/gsd:audit-milestone v1.2` run should drop it from the tech_debt block
- No follow-up work needed. The `.or()` pattern is ready to be replicated for any future Playwright locator hardening in this codebase

## Self-Check

Verified each claim above:

- **Component has data-testid:** `grep -q 'data-testid="recipe-badge"' src/components/panels/task-card/recipe-badge.tsx` → FOUND
- **Spec primary locator uses data-testid:** `grep -q 'data-testid="recipe-badge"' tests/recipes-progress-live.spec.ts` → FOUND
- **Spec text fallback retained:** `grep -q 'hello.world' tests/recipes-progress-live.spec.ts` → FOUND
- **Unit tests pass (11/11):** `pnpm test --run src/components/panels/task-card/__tests__/recipe-badge.test.tsx` → 11 passed (1 new + 10 pre-existing)
- **Typecheck clean:** `pnpm typecheck` → exit 0, no errors
- **Commit exists under 18-02:** `git log -1 --oneline` → `96c57d9 fix(18-02): add data-testid to RecipeBadge + harden Phase 17-06 locator (audit-td-2)`

## Self-Check: PASSED

---
*Phase: 18-v1-2-tech-debt-cleanup*
*Completed: 2026-04-21*
