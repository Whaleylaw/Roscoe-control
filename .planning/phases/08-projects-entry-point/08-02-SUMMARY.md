---
phase: 08-projects-entry-point
plan: 02
subsystem: ui
tags: [react, next-intl, navigation, projects, breadcrumb]

# Dependency graph
requires:
  - phase: 02-navigation-workspace-shell
    provides: ProjectBreadcrumb with Projects segment (line 38)
  - phase: 08-projects-entry-point
    plan: 00
    provides: last_activity_at data backbone (unused here but shares phase boundary)
  - phase: 08-projects-entry-point
    plan: 01
    provides: projects.picker.openWorkspace i18n key (consumed via useTranslations('projects')); button text falls back to the literal key if 08-01 has not merged yet — tests mock translations so they are independent
provides:
  - "Breadcrumb 'Projects' segment routes to /projects (not /) per D-19"
  - "Task-board filter bar gains sibling '↗ Open workspace' button → /project/{slug}"
  - "CreateTaskModal project select gains sibling '↗ Open workspace' button (type=button, does NOT submit form) → /project/{slug}"
  - "Exported CreateTaskModal named export enables isolated unit testing"
affects: [08-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling picker-button pattern: <select> + Button with disabled={filter === 'all' || !projects.find(p => String(p.id) === filter)} — reusable template for any future project pickers"
    - "type='button' inside a surrounding <form onSubmit> is load-bearing — without it the Button defaults to submit and would clobber form-submit on click (documented as a pitfall in the plan)"
    - "Flex wrapper around existing <select> so the button sits horizontally adjacent without stacking — select gets flex-1, button sits at natural width"

key-files:
  created:
    - src/components/project/__tests__/project-breadcrumb-retarget.test.tsx
    - src/components/panels/__tests__/task-board-open-workspace.test.tsx
    - src/components/panels/__tests__/create-task-modal-open-workspace.test.tsx
  modified:
    - src/components/project/project-breadcrumb.tsx
    - src/components/panels/task-board-panel.tsx

key-decisions:
  - "Breadcrumb re-target is a one-line change: navigate('/') -> navigate('/projects'). Phase 2's decision ('Projects breadcrumb navigates to / since no /projects panel exists') is now superseded by Phase 8 D-19 because /projects exists as of Plan 08-01."
  - "Exported CreateTaskModal as a named export (Strategy B from plan) instead of rendering it through TaskBoardPanel. The export has zero runtime cost (tree-shaken where unused) and makes the modal isolated-testable with concrete props instead of driving it through a parent-panel render pipeline that pulls in fetch, SSE, focus traps, etc."
  - "Re-used useRouter import already present at the module top of task-board-panel.tsx — no new imports needed. Added tProjects = useTranslations('projects') inside both TaskBoardPanel (for the filter-bar button) and CreateTaskModal (for the modal button); they are independent hook calls sharing the same namespace."
  - "Picker audit documented: the 'overview dashboard picker' referenced by D-14 does not exist in the codebase (verified 2026-04-14). Only two pickers exist: task-board filter and CreateTaskModal. D-14 is fully honored by covering both."
  - "All three test files mock useTranslations to echo `${namespace}.${key}` so tests are independent of whether Plan 08-01's en.json additions have landed."

patterns-established:
  - "Test-file per behavior: three focused test files co-located in src/components/{project,panels}/__tests__/ — each ~150-200 lines, mocking only the external-dep surface needed"
  - "Mock pattern for testing components that live inside task-board-panel.tsx: import the subcomponent as a named export (after exporting it), mock the @/store module with a static shape, assert against aria-label/role queries so tests survive CSS changes"

requirements-completed: [NAV-01]

# Metrics
duration: 6min
completed: 2026-04-14
---

# Phase 08 Plan 02: Breadcrumb + Picker Button Retrofits Summary

**Breadcrumb 'Projects' segment now routes to `/projects` (not `/`), and both surviving project pickers (task-board filter + CreateTaskModal) gain a sibling '↗ Open workspace' button that deep-links to `/project/{slug}` with defensive disabled-state guards.**

## Performance

- **Duration:** ~6 min
- **Tasks:** 3
- **Files modified:** 5 (3 created, 2 modified)
- **Commits:** 6 (3 test + 3 feat, strict TDD RED→GREEN per task)

## Accomplishments

- **Task 1 (D-19):** Breadcrumb `Projects` segment routes to `/projects`. One-line code change, two unit tests prove the router.push target (and prove the old target is gone). Phase 2's superseded decision is now carried forward correctly.
- **Task 2 (D-14, D-15, D-20):** Task-board filter bar gains sibling `<Button>` rendered under the same `!scope?.hideProjectFilter` visibility guard as the select — so scoped (workspace-embedded) boards still omit both. Disabled when filter value is `'all'` OR when no project in the Zustand `projects[]` matches the selected id.
- **Task 3 (D-14, D-15, D-20):** CreateTaskModal's project `<select>` is wrapped in a horizontal flex row; sibling `<Button type="button">` sits adjacent. Critical `type="button"` attribute stops the surrounding form from submitting on click. Exported `CreateTaskModal` so isolated tests work without a parent-panel pipeline.

## Tests Added

- `src/components/project/__tests__/project-breadcrumb-retarget.test.tsx` — 2 tests
- `src/components/panels/__tests__/task-board-open-workspace.test.tsx` — 4 tests
- `src/components/panels/__tests__/create-task-modal-open-workspace.test.tsx` — 4 tests

All 10 new tests pass. Existing `task-board-panel.test.tsx` (24 tests) still passes — zero regressions.

## Deviations from Plan

None — plan executed exactly as written. Minor detail: `useRouter` was already imported at the top of `task-board-panel.tsx` (from Phase 4+ work), so the "add import if not present" step was a no-op, not a change.

## Verification

- `pnpm test -- src/components/project/__tests__/project-breadcrumb-retarget.test.tsx` — 2 passing
- `pnpm test -- src/components/panels/__tests__/task-board-open-workspace.test.tsx` — 4 passing
- `pnpm test -- src/components/panels/__tests__/create-task-modal-open-workspace.test.tsx` — 4 passing
- `pnpm test -- src/components/panels/__tests__/task-board-panel.test.tsx` — 24 passing (regression guard)
- `pnpm typecheck` — exit 0
- `pnpm lint src/components/project/project-breadcrumb.tsx src/components/panels/task-board-panel.tsx` — 0 errors, only pre-existing hooks warnings unrelated to this plan

## Commits

- `8652622` test(08-02): add failing test for breadcrumb /projects re-target
- `034788f` feat(08-02): re-target breadcrumb Projects segment to /projects
- `7ac53bd` test(08-02): add failing tests for task-board Open workspace button
- `b441c46` feat(08-02): add Open workspace button next to task-board project filter
- `f17a1e4` test(08-02): add failing tests for CreateTaskModal Open workspace button
- `952f186` feat(08-02): add Open workspace button inside CreateTaskModal

## Parallel-Execution Scope Discipline

Plan 08-01 (running in parallel) owns `src/components/panels/projects-panel.tsx`, `src/components/layout/nav-rail.tsx`, `src/app/[[...panel]]/page.tsx`, and `messages/*.json`. Plan 08-02 stayed entirely within its declared `files_modified` list — no touches to 08-01's files. Tests mock `next-intl` to echo keys so they are resilient to 08-01's landing order.

## Known Stubs

None. All buttons are wired to real router push calls; disabled states are computed from the real Zustand `projects[]` shape. No placeholders, no TODOs.

## Self-Check: PASSED
