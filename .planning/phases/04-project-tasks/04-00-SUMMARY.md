---
phase: 04-project-tasks
plan: 00
subsystem: testing
tags: [vitest, playwright, wave-0, scaffold, react, kanban]

requires:
  - phase: 03-project-dashboard
    provides: it.todo() wave-0 scaffold pattern (dashboard-view.test.tsx precedent)
  - phase: 02-navigation-workspace-shell
    provides: useProjectWorkspace() hook + activeProject Zustand state
  - phase: 01-foundation
    provides: tasks-view.tsx stub at the workspace tasks route
provides:
  - TasksView integration test scaffold (13 it.todo stubs) for TASK-01/03/04
  - TaskBoardPanel scope-prop unit test scaffold (21 it.todo stubs) including default-behavior regression guard
  - Playwright E2E scaffold (6 test.fixme stubs) for TASK-02 and TASK-03 reassignment flows
affects: [04-01, future-task-board-changes]

tech-stack:
  added: []
  patterns:
    - "Wave-0 it.todo()/test.fixme() scaffolds carry pitfall annotations from RESEARCH.md directly into stub descriptions for traceability"
    - "Scope-prop testing pattern: default-undefined regression-guard describe block precedes each prop-specific behavior block"

key-files:
  created:
    - src/components/project/__tests__/tasks-view.test.tsx
    - src/components/panels/__tests__/task-board-panel.test.tsx
    - tests/project-tasks.spec.ts
  modified: []

key-decisions:
  - "Continued wave-0 it.todo()/test.fixme() pattern from Phases 1-3 — keeps full vitest+playwright suite green while making every Plan 04-01 implementation task have a concrete test bucket"
  - "Pitfall annotations (PUT-not-PATCH, slow-projects-fetch, SSE-reassign-out, detail-modal ticket_ref) embedded directly into todo descriptions so executors cannot miss them when filling stubs"
  - "Created src/components/panels/__tests__/ directory — first co-located unit-test directory for panel components"

patterns-established:
  - "Pitfall traceability via todo strings: each pitfall in RESEARCH.md has a matching it.todo() stub referencing it by number"
  - "Default-behavior regression guard: any new optional prop added to a high-touch component gets a 'scope undefined = current behavior preserved' describe block"

requirements-completed: [TASK-01, TASK-02, TASK-03, TASK-04]

duration: 2min
completed: 2026-04-13
---

# Phase 4 Plan 00: Project Tasks Wave-0 Scaffolds Summary

**Test-first wave-0 scaffolding for Phase 4 — 34 vitest todos + 6 Playwright fixmes covering TASK-01 through TASK-04 with embedded pitfall annotations from research**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-13T23:25:16Z
- **Completed:** 2026-04-13T23:26:51Z
- **Tasks:** 3
- **Files created:** 3 (1 new directory)

## Accomplishments
- TasksView integration test scaffold with 13 it.todo() stubs grouped by requirement ID covering filter, hidden dropdown, hidden card label, reassign-out, and feature-parity guard
- TaskBoardPanel scope-prop unit test scaffold with 21 it.todo() stubs including a regression-guard block for `scope = undefined` plus dedicated blocks per scope property
- Playwright E2E scaffold with 6 test.fixme() stubs for TASK-02 (create-in-workspace pre-scopes project_id) and TASK-03 (reassign via EditTaskModal uses PUT, reassigned-out tasks disappear)
- All 5 RESEARCH pitfalls embedded directly into stub descriptions for downstream traceability

## Task Commits

Each task was committed atomically:

1. **Task 1: TasksView integration test scaffold** — `6a8a893` (test)
2. **Task 2: TaskBoardPanel scope-prop unit test scaffold** — `106ca4a` (test)
3. **Task 3: Playwright E2E scaffold** — `332f242` (test)

## Files Created/Modified
- `src/components/project/__tests__/tasks-view.test.tsx` — Integration test scaffold for the TasksView wrapper, 13 it.todo() stubs covering TASK-01/03/04
- `src/components/panels/__tests__/task-board-panel.test.tsx` — Unit test scaffold for TaskBoardPanel scope prop, 21 it.todo() stubs covering default-behavior regression guard and all 4 scope fields plus TASK-03 EditTaskModal and TASK-04 parity
- `tests/project-tasks.spec.ts` — Playwright E2E scaffold, 6 test.fixme() stubs for TASK-02 create-in-workspace and TASK-03 reassign-via-edit-modal flows

## Decisions Made
- Used pre-existing `src/components/panels/__tests__/` directory convention (created fresh — no prior co-located panel tests existed) rather than placing the scope-prop test under `src/lib/__tests__/` or a new top-level location, because TaskBoardPanel is a panel component and conventions favor co-location
- Followed dashboard-view.test.tsx's lead-comment-then-describe-blocks structure verbatim so wave-0 scaffolds are visually homogeneous across phases
- Embedded pitfall numbers (#1, #3, #4, #5) into stub descriptions rather than using a separate annotation comment, ensuring executors filling each stub see the constraint inline

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 04-01 (implementation wave) can now replace each it.todo()/test.fixme() with a real test body, then implement the matching feature
- Verification commands all green:
  - `pnpm vitest run src/components/project/__tests__/tasks-view.test.tsx` → 13 todo, 0 failed
  - `pnpm vitest run src/components/panels/__tests__/task-board-panel.test.tsx` → 21 todo, 0 failed
  - `npx playwright test --list tests/project-tasks.spec.ts` → 6 tests listed, 0 syntax errors
- No blockers; the scope prop interface and pitfalls are documented in 04-RESEARCH.md for the implementation wave to consume

## Self-Check: PASSED

Verified:
- src/components/project/__tests__/tasks-view.test.tsx exists (13 todos run as pending)
- src/components/panels/__tests__/task-board-panel.test.tsx exists (21 todos run as pending)
- tests/project-tasks.spec.ts exists (6 fixmes list cleanly via Playwright)
- Commits 6a8a893, 106ca4a, 332f242 all present on main

---
*Phase: 04-project-tasks*
*Completed: 2026-04-13*
