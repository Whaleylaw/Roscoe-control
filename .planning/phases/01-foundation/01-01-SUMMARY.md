---
phase: 01-foundation
plan: 01
subsystem: database, i18n
tags: [sqlite, indexes, composite-index, i18n, next-intl, localization]

requires:
  - phase: 01-foundation-00
    provides: Wave 0 test scaffold structure
provides:
  - Migration 051 with composite indexes for project-scoped queries
  - Project i18n namespace across all 10 locale files
affects: [01-foundation-02, 02-routing, 03-views]

tech-stack:
  added: []
  patterns: [composite index for project-scoped queries, i18n namespace per feature area]

key-files:
  created:
    - src/lib/__tests__/project-indexes.test.ts
    - src/components/project/__tests__/i18n-coverage.test.tsx
  modified:
    - src/lib/migrations.ts
    - messages/en.json
    - messages/ar.json
    - messages/de.json
    - messages/es.json
    - messages/fr.json
    - messages/ja.json
    - messages/ko.json
    - messages/pt.json
    - messages/ru.json
    - messages/zh.json

key-decisions:
  - "Used migration ID 051 instead of 050 (050 already taken by mcp_call_receipt_signing)"
  - "EXPLAIN QUERY PLAN assertions use regex to match both USING INDEX and USING COVERING INDEX"

patterns-established:
  - "Composite indexes: project_id+status for tasks, project_slug+is_active for sessions"
  - "i18n namespace: top-level 'project' key with sub-keys per view area"

requirements-completed: [FOUN-02, FOUN-04]

duration: 4min
completed: 2026-04-13
---

# Phase 01 Plan 01: Database Indexes and i18n Namespace Summary

**SQLite composite indexes for project-scoped queries (tasks by status, sessions by active) and project i18n namespace across all 10 locales**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-13T20:19:26Z
- **Completed:** 2026-04-13T20:23:00Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Added migration 051_project_workspace_indexes with idx_tasks_project_status and idx_sessions_project_active composite indexes
- EXPLAIN QUERY PLAN verification confirms both indexes are used by the SQLite query planner (no table scans)
- Added "project" i18n namespace with 7 sub-keys (workspace, nav, dashboard, tasks, sessions, agents, settings) to all 10 locale files
- All tests pass: 5 index tests (including EXPLAIN QUERY PLAN) and 2 i18n coverage tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Add database migration 051 with project composite indexes and tests** - `5dc5f7c` (feat)
2. **Task 2: Add project i18n namespace to all 10 locale files with tests** - `0d63493` (feat)

## Files Created/Modified
- `src/lib/migrations.ts` - Added migration 051 with two composite indexes
- `src/lib/__tests__/project-indexes.test.ts` - Index existence and EXPLAIN QUERY PLAN tests
- `src/components/project/__tests__/i18n-coverage.test.tsx` - i18n namespace coverage tests
- `messages/en.json` - Added project namespace (English)
- `messages/{ar,de,es,fr,ja,ko,pt,ru,zh}.json` - Added project namespace (9 non-English locales)

## Decisions Made
- Used migration ID 051 instead of 050 because 050_mcp_call_receipt_signing already exists in the codebase (merged after plan was written)
- EXPLAIN QUERY PLAN assertions use regex matching for both "USING INDEX" and "USING COVERING INDEX" since SQLite may report either depending on query structure

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Migration ID 050 already taken**
- **Found during:** Task 1
- **Issue:** Plan specified migration ID `050_project_workspace_indexes` but `050_mcp_call_receipt_signing` already exists
- **Fix:** Used migration ID `051_project_workspace_indexes` instead
- **Files modified:** src/lib/migrations.ts
- **Verification:** Migration runs after 050, typecheck passes
- **Committed in:** 5dc5f7c

**2. [Rule 1 - Bug] SQLite EXPLAIN QUERY PLAN returns COVERING INDEX**
- **Found during:** Task 1
- **Issue:** Test expected "USING INDEX" but SQLite returned "USING COVERING INDEX" for covering index access
- **Fix:** Changed assertion to regex `/USING (?:COVERING )?INDEX/` to handle both cases
- **Files modified:** src/lib/__tests__/project-indexes.test.ts
- **Verification:** All 5 tests pass
- **Committed in:** 5dc5f7c

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## Known Stubs
None - all planned functionality is fully implemented.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Composite indexes ready for project-scoped queries in dashboard and views
- i18n namespace ready for all project workspace UI components
- Plan 02 can now build stub views that use `useTranslations('project')`

---
*Phase: 01-foundation*
*Completed: 2026-04-13*
