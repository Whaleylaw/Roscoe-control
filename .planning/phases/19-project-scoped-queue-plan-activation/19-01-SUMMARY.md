---
phase: 19-project-scoped-queue-plan-activation
plan: 01
subsystem: api
tags: [queue, scoping, gsd, better-sqlite3, next-app-router, vitest, playwright]

# Dependency graph
requires:
  - phase: 10-multi-gsd-per-project
    provides: gsd_plans.wave column, gsd_plans/phases/milestones/projects join path
  - phase: 11-runtime-foundation-v1-2
    provides: workspace-scoped tasks, requireRole operator guard, rate limiting
provides:
  - Project-scoped GET /api/tasks/queue with project_id filter
  - Plan-scoped GET /api/tasks/queue with gsd_plan_id filter
  - Wave-scoped GET /api/tasks/queue with wave filter (via gsd_plans.wave subquery)
  - Cross-filter 400 when gsd_plan_id.project_id != project_id
  - Route-handler unit-test coverage for wave + cross-filter (vitest, non-skippable)
affects:
  - 19-02 plan-activation (will exercise the scoped queue primitives)
  - 20-lane-aware-routing (ROUTE-01 depends on project_id/gsd_plan_id/wave scoping)
  - 23-e2e-acceptance (ACCEPT-01 runs scoped polls in the full loop)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "`(? IS NULL OR column = ?)` bind-pair idiom for optional scalar filters"
    - "`(? IS NULL OR gsd_plan_id IN (SELECT id FROM gsd_plans WHERE wave = ?))` idiom for optional joined filters (avoids mandatory JOIN when filter is absent)"
    - "Cross-filter validation runs BEFORE scoped queries — 400 is loud, never silent-empty"
    - "Vitest route-handler tests with direct better-sqlite3 seeding + runMigrations — fills coverage gaps that Playwright harness cannot reach (gsd_plans seeding)"

key-files:
  created:
    - src/app/api/tasks/__tests__/queue-route.test.ts
  modified:
    - src/app/api/tasks/queue/route.ts
    - tests/task-queue.spec.ts

key-decisions:
  - "wave filter uses a correlated subquery (`gsd_plan_id IN (SELECT id FROM gsd_plans WHERE wave = ?)`) rather than a mandatory JOIN, so unscoped polls reduce to TRUE and are SQL-equivalent to v1.2 (COMPAT-01)."
  - "Cross-filter validation walks `gsd_plans → gsd_phases → gsd_milestones → projects` with a workspace_id guard, rather than relying on a `gsd_plans.project_id` column that does not exist."
  - "Pre-existing E2E test `respects project_id and gsd_plan_id queue scoping filters` was simplified to project_id-only because Playwright helpers cannot seed gsd_plans rows; gsd_plan_id coverage moved to the mandatory vitest unit file."
  - "Two Playwright tests (wave, cross-filter 400) are test.skip with TODOs pointing at the vitest file — acceptable per plan since mandatory coverage lives at the route-handler layer."

patterns-established:
  - "Optional JOIN via IN subquery: `AND (? IS NULL OR col IN (SELECT id FROM joined WHERE attr = ?))` — supports future scope filters that live on related tables without paying JOIN cost when absent"
  - "Route-handler vitest fills gsd-seeded coverage gaps: when Playwright cannot seed DB rows via REST helpers, a `__tests__/*-route.test.ts` file with direct `db.prepare().run()` seeding + `NextRequest` stubs is the mandatory coverage path"

requirements-completed: [QUEUE-01, COMPAT-01]

# Metrics
duration: 5min
completed: 2026-04-21
---

# Phase 19 Plan 01: Project-Scoped Queue Endpoint Summary

**GET /api/tasks/queue now accepts project_id / gsd_plan_id / wave filters applied consistently to current-task lookup, capacity count, and atomic claim subquery, with loud 400 on cross-filter project/plan mismatch and byte-equivalent v1.2 behavior when unscoped.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-22T01:19:02Z
- **Completed:** 2026-04-22T01:23:41Z
- **Tasks:** 2
- **Files modified:** 3 (2 modified + 1 created)

## Accomplishments

- Extended `QueueScope` with `wave: number | null`; parsed `?wave=N` via the existing `parseOptionalPositiveInt` helper with 400 on invalid.
- Added cross-filter validation: when BOTH `project_id` AND `gsd_plan_id` are present, the route joins `gsd_plans → gsd_phases → gsd_milestones → projects` (with workspace guard) and returns 400 if either the plan is missing or its project does not match the requested `project_id`. Error message names both plan id AND both project ids so callers can disambiguate.
- Applied all three filters to the three scoping surfaces — current in-progress lookup, in-progress capacity COUNT, and the atomic claim UPDATE subquery — via the `(? IS NULL OR …)` idiom so unscoped polls reduce to TRUE and are SQL-equivalent to v1.2 (COMPAT-01).
- Shipped a non-skippable vitest route-handler unit file with 4 tests (wave filter with real `gsd_plans` seed rows; cross-filter 400 naming both projects; missing-plan 400; COMPAT-01 unscoped priority ordering).
- Extended the E2E spec with COMPAT-01 (unscoped poll still claims a task) and capacity-per-scope (project-A in_progress task does not consume project-B capacity).

## Task Commits

1. **Task 1: Add wave filter + cross-filter 400 validation to queue route** — `5523158` (feat)
2. **Task 1 bug fix: cross-filter plan lookup uses `p.id` not `p.project_id`** — `0e2e072` (fix — Rule 1 auto-fix surfaced by the new unit tests)
3. **Task 2: Route-handler unit + E2E coverage for scoped queue polling** — `d9bf040` (test)

## Files Created/Modified

- `src/app/api/tasks/queue/route.ts` — Added `wave` to `QueueScope`, parsed `?wave=N`, added cross-filter project/plan 400, extended all three queries with the wave subquery.
- `src/app/api/tasks/__tests__/queue-route.test.ts` — NEW: mandatory route-handler vitest coverage (4 tests: wave filter, cross-filter 400, missing-plan 400, COMPAT-01 unscoped ordering).
- `tests/task-queue.spec.ts` — Added COMPAT-01 and capacity-per-scope E2E tests; simplified pre-existing scoping test to project_id-only (gsd_plan_id coverage moved to vitest file); added two `test.skip` placeholders pointing at the vitest file for wave + cross-filter coverage.

## Decisions Made

See `key-decisions` frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cross-filter plan-lookup SQL selected non-existent column**
- **Found during:** Task 2 (running the new route-handler unit tests — the cross-filter 400 assertion caught it before the tests could pass)
- **Issue:** The initial cross-filter query aliased `projects` as `p` and then `SELECT p.project_id AS project_id` — but the `projects` table does not have a `project_id` column (the column is `p.id`). Running this SQL raised a `SQLITE_ERROR: no such column: p.project_id`, which surfaced as a 500 instead of the expected 400 on mismatched project/plan.
- **Fix:** Changed the SELECT to `SELECT p.id AS project_id` (keeping the returned shape identical so the surrounding code was unaffected).
- **Files modified:** `src/app/api/tasks/queue/route.ts`
- **Verification:** All 4 vitest unit tests pass (including the two that drove the discovery); E2E Task Queue API suite passes (7 pass, 2 intentionally skipped with TODO pointers).
- **Committed in:** `0e2e072` (separate fix commit, trailing Task 1)

**2. [Rule 3 - Blocking] better-sqlite3 native addon mismatch**
- **Found during:** First attempt to run the new vitest file (`NODE_MODULE_VERSION 137 vs 127`).
- **Issue:** Native addon had been compiled against a different Node.js version than the current runtime.
- **Fix:** `pnpm rebuild better-sqlite3` — documented in project CLAUDE.md "Common Pitfalls" as the standard remedy.
- **Files modified:** None (rebuild only).
- **Verification:** Vitest suite runs and all tests pass.
- **Committed in:** No commit needed (build artifact, not source).

**3. [Rule 1 - Bug] Pre-existing E2E test assumed cross-filter validation would not fire**
- **Found during:** Running the full E2E Task Queue API suite after Task 1 landed.
- **Issue:** The WIP-authored `respects project_id and gsd_plan_id queue scoping filters` test passed `gsd_plan_id=123` where plan 123 did not exist. Once the cross-filter validation became active, that query correctly returned 400 ("gsd_plan_id 123 not found"), which broke the test.
- **Fix:** Simplified the test to cover only `project_id` scoping (the Playwright harness cannot seed `gsd_plans` rows via REST helpers; real `gsd_plan_id` + cross-filter coverage now lives in the mandatory vitest file per plan direction).
- **Files modified:** `tests/task-queue.spec.ts`
- **Verification:** Full E2E Task Queue API suite passes (7/7 pass + 2 intentionally skipped).
- **Committed in:** `d9bf040` (part of Task 2 commit).

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 3 blocking — all catch-bugs-while-implementing, no scope creep).
**Impact on plan:** Zero. All three auto-fixes were necessary for correctness; the SQL typo would have broken production for any `project_id + gsd_plan_id` caller, and the pre-existing E2E test would have been a false-failure alarm once 19-02 activated plans for real.

## Deferred Issues

`deferred-items.md` was created to record a typecheck error that surfaced in 19-02's `src/app/api/gsd/plans/[plan_id]/transition/route.ts` (`gsd.plan.queue_activated` not assignable to EventType). That belonged to 19-02 scope (which has since committed its own fixes); the final `pnpm typecheck` at the end of 19-01 was clean.

## Issues Encountered

- The Playwright harness cannot seed `gsd_plans` rows without driving the full phase → plan creation flow; the plan anticipated this and directed the mandatory coverage to a vitest route-handler file. Skipped Playwright tests include TODOs pointing at the vitest file.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `GET /api/tasks/queue` exposes the three scope dimensions (project_id, gsd_plan_id, wave) that Phase 20 ROUTE-01 will consume to prefer lane-scoped work.
- 19-02 (already committed via `077bb07`, `b8a328e`) can exercise the scoped queue primitive against real plan-activation side effects.
- 19-03 remains (CLI + MCP + openapi.json reflection of the new scoping params).

---

## Self-Check: PASSED

- Commits verified: `5523158`, `0e2e072`, `d9bf040` all present in `git log`.
- Files verified: `src/app/api/tasks/queue/route.ts`, `src/app/api/tasks/__tests__/queue-route.test.ts`, `tests/task-queue.spec.ts` all exist on disk.
- `pnpm typecheck` exits 0.
- `pnpm lint src/app/api/tasks/queue/route.ts` — 0 errors on the file (warnings are all in unrelated files per scope-boundary rules).
- `pnpm vitest run src/app/api/tasks/__tests__/queue-route.test.ts` — 4/4 tests pass.
- `pnpm test:e2e -g "Task Queue API"` — 7 pass, 2 intentionally skipped.

---
*Phase: 19-project-scoped-queue-plan-activation*
*Completed: 2026-04-21*
