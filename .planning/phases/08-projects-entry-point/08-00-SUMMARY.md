---
phase: 08-projects-entry-point
plan: 00
subsystem: api
tags: [sqlite, better-sqlite3, zustand, typescript, projects]

# Dependency graph
requires:
  - phase: 02-navigation-workspace-shell
    provides: Project interface in Zustand store (line 329) and GET /api/projects handler
provides:
  - "GET /api/projects exposes last_activity_at: number | null per project"
  - "Project interface extended with optional last_activity_at (unix ms)"
  - "Unit test coverage for happy path, null path, and SQL shape (LEFT JOIN + MAX + GROUP BY)"
affects: [08-01, 08-02, 08-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LEFT JOIN + aggregate + GROUP BY p.id combined with pre-existing correlated scalar subqueries (aliasing inner subquery alias t -> t2 to avoid shadowing the outer JOIN alias)"
    - "Server-side unix seconds -> unix ms conversion at the SELECT layer (MAX(updated_at) * 1000) so API contract remains ms-based"

key-files:
  created:
    - src/app/api/projects/__tests__/get-last-activity.test.ts
  modified:
    - src/app/api/projects/route.ts
    - src/store/index.ts

key-decisions:
  - "Kept the existing correlated task_count subquery but renamed its inner alias from t to t2 to avoid shadowing the outer LEFT JOIN tasks t alias (per plan D-18 guidance)"
  - "Multiplied by 1000 in the SQL (not the map) to keep a single source of truth for the ms conversion — tasks.updated_at is unix seconds (unixepoch())"
  - "Explicit null-safe coerce `row.last_activity_at == null ? null : Number(...)` in the map to guard against better-sqlite3 returning BigInt for large aggregates"

patterns-established:
  - "Dynamic import + capturedSql array pattern for asserting SQL shape via regex in route handler tests (reusable for future SQL-shape contract tests)"

requirements-completed: [NAV-01]

# Metrics
duration: 2min
completed: 2026-04-14
---

# Phase 08 Plan 00: Last-Activity Data Backbone Summary

**GET /api/projects now returns `last_activity_at` (unix ms | null) via LEFT JOIN tasks + MAX(updated_at) * 1000 + GROUP BY p.id, and the Zustand Project interface carries the new optional field — unblocks Plans 01/02/03 for the projects list panel.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-14T17:00:25Z
- **Completed:** 2026-04-14T17:02:36Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- Backend contract change: `GET /api/projects` emits `last_activity_at` per project, computed server-side per D-18 — no client aggregation
- Type contract change: `Project` interface in `src/store/index.ts` includes `last_activity_at?: number` so downstream panels can read it without TypeScript errors
- Test coverage: 6-assertion vitest spec covering response shape, number/null normalization, and three structural SQL regexes (LEFT JOIN, MAX, GROUP BY)

## Task Commits

Each task was committed atomically (TDD RED → GREEN for Task 1, single feat commit for Task 2):

1. **Task 1 (RED): Failing test for last_activity_at** — `aba52c4` (test)
2. **Task 1 (GREEN): Extend GET /api/projects with LEFT JOIN + MAX + GROUP BY** — `cef474f` (feat)
3. **Task 2: Extend Project interface with last_activity_at** — `db9b28f` (feat)

_TDD for Task 1 produced two commits (failing test first, then passing implementation). Task 1 did not need a refactor commit._

## Files Created/Modified
- `src/app/api/projects/__tests__/get-last-activity.test.ts` — **created** — 6 assertions covering happy path, null path, and SQL shape regexes; uses dynamic import + capturedSql array pattern
- `src/app/api/projects/route.ts` — **modified** — GET handler SELECT now LEFT JOINs tasks t, aggregates `MAX(t.updated_at) * 1000 AS last_activity_at`, GROUPs BY p.id; inner `task_count` subquery alias renamed t -> t2; response map normalizes `last_activity_at` to `number | null`
- `src/store/index.ts` — **modified** — `Project` interface extended with `last_activity_at?: number` at line 344 (last field before closing brace)

## Decisions Made

- **Subquery alias rename t -> t2:** The outer `LEFT JOIN tasks t` reserves the alias `t` for the aggregation source. The pre-existing correlated subquery `(SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count` aliased its own `tasks` as `t`, which would shadow the outer alias. Renamed the inner alias to `t2` (scoped to the subquery only — invisible outside it). Row shape is unchanged because the correlated subquery still returns a scalar per `p.id`.
- **ms conversion in SQL, not map:** `tasks.updated_at` is stored as unix seconds (SQLite convention — created via `unixepoch()` in the INSERT at line ~114). Multiplied by 1000 in the SELECT so the returned column is already ms. The response map only does defensive `Number()` coercion (guards against better-sqlite3 BigInt on very large values).
- **Null semantics preserved naturally:** With no matching tasks, `MAX(t.updated_at)` is NULL; `NULL * 1000` is NULL in SQLite; the map's `row.last_activity_at == null ? null : Number(...)` preserves that cleanly.

## Deviations from Plan

None — plan executed exactly as written. Both acceptance-criteria grep hits and all six test assertions (including the three structural SQL regexes) pass on first implementation.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 01 (projects list panel) can now read `project.last_activity_at` directly from `useMissionControl().projects[]` — the field hydrates automatically through the existing `fetchProjects` spread
- Plans 02 and 03 (picker affordances, breadcrumb re-target) are independent of this data contract and can run in parallel with Plan 01 without blocking
- No migrations, no env-var changes, no breaking changes to existing consumers — the new field is additive

## Self-Check

Verifying claims before closing out:

- File `src/app/api/projects/__tests__/get-last-activity.test.ts` — FOUND
- File `src/app/api/projects/route.ts` — FOUND (modified; contains `last_activity_at`, `LEFT JOIN tasks t`, `MAX(t.updated_at) * 1000`, `GROUP BY p.id`)
- File `src/store/index.ts` — FOUND (modified; contains `last_activity_at?: number` inside `Project` interface)
- Commit `aba52c4` — FOUND
- Commit `cef474f` — FOUND
- Commit `db9b28f` — FOUND
- `pnpm test -- src/app/api/projects/__tests__/get-last-activity.test.ts` — exit 0 (6 new assertions pass; 1130 total passing)
- `pnpm typecheck` — exit 0

## Self-Check: PASSED

---
*Phase: 08-projects-entry-point*
*Completed: 2026-04-14*
