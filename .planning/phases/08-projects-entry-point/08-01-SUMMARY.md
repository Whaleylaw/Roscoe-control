---
phase: 08-projects-entry-point
plan: 01
subsystem: ui
tags: [nav-rail, panel, routing, i18n, react, typescript, next-intl, zustand]

# Dependency graph
requires:
  - phase: 08-projects-entry-point
    plan: 00
    provides: "GET /api/projects returns last_activity_at (unix ms | null) and Project interface carries the optional field"
  - phase: 02-navigation-workspace-shell
    provides: "ProjectManagerModal component + /project/{slug} workspace routing"
provides:
  - "Projects nav-rail item in the core group, positioned immediately before Tasks"
  - "ProjectsPanel rendered at /projects — row list of active projects + empty-state CTA"
  - "ContentRouter case 'projects' + ESSENTIAL_PANELS membership"
  - "nav.projects (depth-2) and top-level 'projects' namespace in all 10 locales"
  - "Unit tests: 4 for nav-rail placement/click/essential visibility; 7 for ProjectsPanel behavior"
affects: [08-02, 08-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Row-based clickable panel using role='button' + tabIndex=0 + keyboard Enter/Space handler (matches a11y expectations where <button> semantics are wanted but flex/table layout is cleaner as a div)"
    - "Empty-state CTA reuses an existing modal component instead of forking a second creation flow (ProjectManagerModal) — keeps a single source of truth for project CRUD"
    - "Atomic 10-locale JSON update via a one-shot Node script that preserves insertion order (new keys placed next to their semantic siblings, not appended)"

key-files:
  created:
    - src/components/panels/projects-panel.tsx
    - src/components/panels/__tests__/projects-panel.test.tsx
    - src/components/layout/__tests__/nav-rail-projects.test.tsx
  modified:
    - src/components/layout/nav-rail.tsx
    - src/app/[[...panel]]/page.tsx
    - messages/ar.json
    - messages/de.json
    - messages/en.json
    - messages/es.json
    - messages/fr.json
    - messages/ja.json
    - messages/ko.json
    - messages/pt.json
    - messages/ru.json
    - messages/zh.json

key-decisions:
  - "Task execution order swapped from plan sequence: Task 2 (ProjectsPanel) ran first so the `import { ProjectsPanel }` added in Task 1a resolves immediately — typecheck stays green between commits. Plan anticipated this inversion ('Simplest path: run Task 2 first')."
  - "Row element uses <div role='button' tabIndex=0> instead of a native <button> so flex-based horizontal layout composes cleanly (status badge + ticket prefix + ml-auto meta slot). Keyboard Enter/Space handler restores the native button interaction model — a11y equivalent."
  - "Deadline takes precedence over last-activity in the meta slot (D-10) — encoded as an exclusive if/else if/else in the row render; when both are falsy the slot shows row.noActivity styled as muted placeholder."
  - "ProjectManagerModal mounts only when showManager is true (gated unmount) — mirrors task-board's pattern and ensures onClose re-fetches the projects list so newly-created projects appear immediately without page reload."
  - "Atomic i18n update via /tmp/add-i18n.mjs script that JSON-parses each locale, preserves existing key order, and inserts `nav.projects` right after `nav.overview` + top-level `projects` namespace right before `project`. Prevents accidental reordering of untouched keys across diffs."

patterns-established:
  - "First co-located test under src/components/layout/__tests__/ — canonical location for future nav-rail/header/live-feed unit tests."
  - "Empty-state CTA shape for list panels: [muted message, primary Button] stacked centered (py-24 gap-4) — reusable for future empty-state surfaces."

requirements-completed: [NAV-01]

# Metrics
duration: 8min
completed: 2026-04-14
---

# Phase 08 Plan 01: Projects Nav Entry + List Panel Summary

**Ships the main-UI discoverability path for the project workspace: a Projects nav-rail item (in the core group, immediately before Tasks) and a ProjectsPanel rendered at `/projects` that lists active projects as clickable rows with name + status badge + ticket prefix + deadline-or-last-activity meta; row clicks route to `/project/{slug}` and an empty state reuses the existing ProjectManagerModal — closing NAV-01.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-14T17:06:07Z
- **Completed:** 2026-04-14T17:14:32Z
- **Tasks:** 3 (with TDD RED→GREEN splits on Task 2)
- **Files modified:** 14 (3 created, 11 modified)

## Accomplishments

- **Nav item discoverable**: NavRail now renders a Projects button in the `core` group, positioned before Tasks; wired through `navItemTranslationKeys` and `ESSENTIAL_PANELS` so it shows in both `full` and `essential` interface modes. New `ProjectsIcon` inline SVG matches the stroke/viewBox style of its siblings (per D-05 — no icon libraries).
- **Panel rendered at `/projects`**: `ContentRouter` switch in `src/app/[[...panel]]/page.tsx` returns `<ProjectsPanel />` for `case 'projects'`. Registered above `case 'tasks'` to keep switch-case order consistent with nav-rail order.
- **ProjectsPanel component**: reads Zustand `projects[]` (no re-fetch), filters to `status === 'active'`, renders one row per project with name, status badge, ticket prefix, and a right-aligned meta slot. Row click + Enter/Space keyboard navigate via `router.push('/project/{slug}', { scroll: false })` wrapped in `startTransition` (matches project-breadcrumb's pattern).
- **Meta slot precedence**: deadline (unix seconds) wins; else last-activity (unix ms from Plan 08-00); else muted `row.noActivity` placeholder.
- **Empty state**: when `activeProjects.length === 0`, renders a centered message + "Create project" CTA that opens the existing `ProjectManagerModal` — same modal triggered by the task-board's Projects button. No duplicate creation flow.
- **i18n (atomic across 10 locales)**: added `nav.projects` key inside each locale's existing `nav` namespace (right after `overview`) + a new top-level `projects` namespace (title, empty.title, empty.cta, picker.openWorkspace, row.statusLabel, row.deadlineLabel, row.lastActivityLabel, row.noActivity). Placed adjacent to the existing `project` namespace. The `↗ ` glyph in `picker.openWorkspace` is kept untranslated in every locale per Phase 5 D-100 precedent for decorative marks.
- **Test coverage**:
  - `nav-rail-projects.test.tsx` — 4 tests: full-mode visibility, DOM ordering (Projects before Tasks), click invokes `navigateToPanel('projects')`, essential-mode visibility.
  - `projects-panel.test.tsx` — 7 tests: row count, row content (name/status/ticket), click routes to `/project/{slug}`, empty-state CTA opens modal, meta slot precedence (deadline vs last_activity), keyboard Enter navigation, archived projects filtered out.

## Task Commits

Each task committed atomically; Task 2 split into RED/GREEN per its TDD directive.

1. **Task 2 RED: Add failing tests for ProjectsPanel** — `7a76528` (test)
2. **Task 2 GREEN: Add ProjectsPanel component** — `be52746` (feat)
3. **Task 1a: Register Projects nav item + ContentRouter + i18n (10 locales atomic)** — `3705c79` (feat)
4. **Task 1b: Add nav-rail Projects item unit tests** — `31adfed` (test)

_Task 2 ran before Task 1a so the `import { ProjectsPanel }` added in Task 1a resolves cleanly — the plan itself called out this ordering option._

## Files Created/Modified

- `src/components/panels/projects-panel.tsx` — **created** — 151 lines. Client component (`'use client'`). Named export `ProjectsPanel`. Uses `useTranslations('projects')`, `useRouter`, `useMissionControl`, `Button`, `ProjectManagerModal`. Filters to active projects, renders rows or empty-state.
- `src/components/panels/__tests__/projects-panel.test.tsx` — **created** — 146 lines. 7 tests using `@testing-library/react` + `vitest`. Mocks `next-intl`, `next/navigation`, `@/store`, `@/components/modals/project-manager-modal`.
- `src/components/layout/__tests__/nav-rail-projects.test.tsx` — **created** — 122 lines. 4 tests scoped to the Projects nav item contract (not the whole nav-rail). First co-located test under `src/components/layout/__tests__/`.
- `src/components/layout/nav-rail.tsx` — **modified** — added `ProjectsIcon` SVG, inserted `{ id: 'projects' }` in `navGroups[0].items` between agents and tasks, added `projects: 'projects'` to `navItemTranslationKeys`, added `'projects'` to the in-component `essentialIds` set at line 945 (mobile bottom-bar guard).
- `src/app/[[...panel]]/page.tsx` — **modified** — imported `ProjectsPanel`, added `'projects'` to `ESSENTIAL_PANELS`, registered `case 'projects': return <ProjectsPanel />` above `case 'tasks'`.
- `messages/{ar,de,en,es,fr,ja,ko,pt,ru,zh}.json` — **modified** — atomic addition of `nav.projects` key and top-level `projects` namespace.

## Decisions Made

- **Execution order inversion** — Plan listed Task 1a → Task 1b → Task 2 but explicitly noted "Simplest path: run Task 2 first" to keep the `ProjectsPanel` import resolvable mid-plan. Adopted that order. Every intermediate commit type-checks cleanly.
- **Row element: `<div role="button">` vs native `<button>`** — The row needs flex with `ml-auto` for the meta slot. Native `<button>` children-with-block-flex compositions fight user-agent stylesheets. Chose `<div role="button" tabIndex={0}>` with explicit keyboard handlers (Enter/Space → navigate). A11y is equivalent; layout is cleaner.
- **Meta slot precedence encoded with mutually exclusive booleans** — `showDeadline = typeof deadline === 'number' && deadline > 0`; `showLastActivity = !showDeadline && typeof last_activity_at === 'number' && last_activity_at > 0`. Guards against `0` being treated as truthy and guarantees only one of the three meta variants renders.
- **Date formatting via `.toLocaleDateString()`** — Plan flagged "use existing relative-time helper if one exists, else simple formatting is acceptable for v1". No relative-time helper was found in `src/lib/` during the `read_first` scan; `.toLocaleDateString()` matches what task-board uses for task timestamps and keeps i18n delegation to the browser's locale-aware formatter.
- **Atomic i18n via Node script** — Hand-editing 10 locale JSON files was rejected as conflict-prone. Built `/tmp/add-i18n.mjs` that JSON-parses each locale, inserts keys at their semantic positions (not appended), and writes back with stable 2-space indentation + trailing newline. Result: zero drift between locales, all 10 files pass `grep -l '"projects": {' messages/*.json | wc -l == 10`. Script was ephemeral (not committed — plan's `files_modified` lists only the locale files).
- **`ProjectManagerModal` onClose refetches projects** — `onClose={() => { setShowManager(false); fetchProjects(); }}` — ensures a newly-created project appears in the list immediately without a page reload (parity with task-board's `onChanged={fetchData}` pattern, adapted to the simpler `onClose`-only contract when `onChanged` isn't wired).

## Deviations from Plan

None — plan executed exactly as written, with the Task 2→Task 1a→Task 1b execution order explicitly sanctioned by the plan's own "Simplest path" note. All 11 acceptance criteria for Task 1a, all 3 for Task 1b, and all 9 for Task 2 pass on first run.

## Issues Encountered

**Pre-existing failing tests in `task-board-open-workspace.test.tsx`** — surfaced during the first `pnpm test` run after creating `ProjectsPanel`. These belong to parallel plan 08-02 (task-board picker button retrofit) and were owned by the sibling executor agent. Confirmed out of my files_modified scope and left untouched per the `<parallel_scope>` directive. A later `git log` shows 08-02 landed its own fix shortly after.

## User Setup Required

None — no env vars, migrations, or external service config. The new nav item and route are immediately usable after the next dev reload.

## Next Plan Readiness

- **Plan 08-02** (picker affordances) can consume `projects.picker.openWorkspace` from this commit's i18n additions — the key is already present in all 10 locales.
- **Plan 08-03** (breadcrumb re-target) is unaffected — it changes `project-breadcrumb.tsx:38` only and doesn't touch nav-rail or ProjectsPanel.
- **NAV-01** requirement is closed: a main-UI path into the workspace exists (nav-rail → /projects → row click → /project/{slug}).

## Self-Check

Verifying claims before closing out:

- File `src/components/panels/projects-panel.tsx` — FOUND
- File `src/components/panels/__tests__/projects-panel.test.tsx` — FOUND
- File `src/components/layout/__tests__/nav-rail-projects.test.tsx` — FOUND
- File `src/components/layout/nav-rail.tsx` — FOUND (modified; contains `id: 'projects'` before `id: 'tasks',`; `projects: 'projects'` in `navItemTranslationKeys`; `'projects'` in `essentialIds` set at line 945)
- File `src/app/[[...panel]]/page.tsx` — FOUND (modified; contains `import { ProjectsPanel }`, `'projects'` in `ESSENTIAL_PANELS`, `case 'projects': return <ProjectsPanel />` above `case 'tasks'`)
- `grep -l '"projects": {' messages/*.json | wc -l` — returns 10
- Commit `7a76528` (test RED) — FOUND
- Commit `be52746` (feat GREEN ProjectsPanel) — FOUND
- Commit `3705c79` (feat nav-rail + page.tsx + 10 locales) — FOUND
- Commit `31adfed` (test nav-rail-projects) — FOUND
- `pnpm test -- src/components/layout/__tests__/nav-rail-projects.test.tsx src/components/panels/__tests__/projects-panel.test.tsx` — exit 0 (11 tests, 1151 total passing across suite)
- `pnpm typecheck` — exit 0

## Self-Check: PASSED

---
*Phase: 08-projects-entry-point*
*Completed: 2026-04-14*
