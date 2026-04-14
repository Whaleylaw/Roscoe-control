# Phase 8: Projects Entry Point - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

A main-UI entry point for the existing project workspace (Phase 2) so users can reach `/project/{slug}` without URL typing. Deliverables:

1. A **Projects** item in the nav-rail.
2. A **Projects list panel** rendered at `/projects` (tab id `projects`), with one row per active project.
3. **Picker affordances** — every pre-existing project-name picker/dropdown in the main UI gains a visible path into the workspace.
4. **Breadcrumb re-target** — the existing workspace breadcrumb's "Projects" segment routes to the new `/projects` panel instead of `/`.

Out of scope: the workspace itself (already exists), project CRUD (reuse existing project-manager modal), any changes to `/project/{slug}` routing or sub-views.

</domain>

<decisions>
## Implementation Decisions

### Nav-Rail Integration
- **D-01:** Add `{ id: 'projects', label: 'Projects', icon: <ProjectsIcon />, priority: true, essential: true }` into the unlabeled `core` group in `src/components/layout/nav-rail.tsx`, positioned **before** the existing `tasks` entry. Rationale: projects are the primary entry for project-scoped work; ROADMAP says "near Tasks"; placing before Tasks signals primacy without renaming the group.
- **D-02:** The ROADMAP's wording "OPERATE group" refers to the existing `core` group. Do **not** rename `core` to `OPERATE` — Phase 6 locked translation keys across 10 locales and a label addition would require updating every locale's `nav.group.*` namespace for marginal benefit.
- **D-03:** Add `projects: 'projects'` to the `navItemTranslationKeys` map so the nav item reads its label from the `nav.projects` i18n key (namespace already used by the breadcrumb — see `src/components/project/project-breadcrumb.tsx`).
- **D-04:** Add the new panel id `'projects'` to the `ESSENTIAL_PANELS` set in `src/app/[[...panel]]/page.tsx` so it renders in both `essential` and `full` interface modes.
- **D-05:** Use a plain text/emoji glyph for the icon (no icon libraries — per CLAUDE.md). The icon component `ProjectsIcon` lives inline in `nav-rail.tsx` alongside the other `*Icon` components.

### Projects List Panel
- **D-06:** Panel route: `/projects` (tab id `'projects'`). Plural form is distinct from `/project/{slug}` workspace route — no collision.
- **D-07:** Panel file: `src/components/panels/projects-panel.tsx`, named export `ProjectsPanel`. Register in the `ContentRouter` switch in `src/app/[[...panel]]/page.tsx` with `case 'projects': return <ProjectsPanel />`.
- **D-08:** Data source: Zustand `projects[]` from `useMissionControl()` (already populated during boot via `GET /api/projects`). Do not re-fetch — follow existing panel conventions.
- **D-09:** Layout: **vertical rows**, one per project. Density matches task-board and agent-squad panels. No grid/card mode in v1.
- **D-10:** Each row renders: project name (left), status badge, ticket prefix (e.g., `PROJ`), and a right-aligned meta slot showing **deadline when present, else last-activity hint**.
  - Deadline: format using existing date utilities (reuse whatever project-manager modal or task-board already uses).
  - Last-activity: derived from `MAX(task.updated_at)` for that project (see D-15).
  - Show a human-friendly relative string ("in 3 days", "2h ago") — follow existing conventions.
- **D-11:** Click target: the **whole row** is a clickable affordance that navigates to `/project/{slug}` via `useNavigateToPanel` or `router.push`. No separate "Open" button. Status badge and ticket prefix are informational (no click handlers).
- **D-12:** Empty state: when Zustand `projects[]` is empty or all projects have non-active status, render a minimal message ("No active projects yet" — via i18n key) plus a button that opens the existing **project-manager modal** (same modal triggered by the task-board's `Projects` button — see `src/components/panels/task-board-panel.tsx:848`). Reuse the trigger; do not duplicate the creation flow.
- **D-13:** i18n: all panel strings go through `next-intl` under the `projects` namespace (new). Add keys atomically across all 10 locale files — follow Phase 6 precedent.

### Picker Affordances
- **D-14:** Every pre-existing project-name picker/dropdown in the main UI gets a small sibling button **"↗ Open workspace"** (or equivalent i18n'd label). Button is disabled when no specific project is selected (e.g., filter value `'all'`). Clicking routes to `/project/{slug}` of the currently-selected project.
  - Known call sites to update:
    - `src/components/panels/task-board-panel.tsx` — project filter select (line ~829)
    - Overview dashboard — any project picker (check `src/components/panels/`)
    - Create-task modal — project field (find in task creation flow)
  - Rationale: non-destructive — the select keeps its filter role; the button adds the navigation path without changing existing behavior.
- **D-15:** Do **not** make picker option text directly clickable — the button is the single, discoverable affordance. Consistency across call sites matters more than a second affordance.

### Last-Activity Data
- **D-16:** `GET /api/projects` must return a `last_activity_at` field per project, computed as `MAX(tasks.updated_at)` grouped by `project_id`. Projects with no tasks return `null` and the row falls back to showing nothing in the meta slot (with deadline taking precedence when both exist).
- **D-17:** Extend the `Project` interface in `src/store/index.ts` (line 329) with `last_activity_at?: number` (unix ms timestamp).
- **D-18:** Implementation: update the API route handler that serves `GET /api/projects` with a LEFT JOIN (prepared statement, no ORM) to include the MAX. Do **not** compute it on the client.

### Breadcrumb Re-Target
- **D-19:** Update `src/components/project/project-breadcrumb.tsx` line 38: change the "Projects" button's `onClick` from `navigate('/')` to `navigate('/projects')`. This is the only behavior change to the existing breadcrumb component.
- **D-20:** The existing `t('nav.projects')` translation key is already used for the breadcrumb label — reuse it for the nav-rail item (D-03) so labels stay consistent.

### Testing
- **D-21:** Unit tests (Vitest + @testing-library/react) MUST cover:
  - Nav-rail renders the new `projects` item in the correct position (before `tasks`, in the `core` group).
  - Projects list panel renders one row per project from Zustand `projects[]`.
  - Clicking a row navigates to `/project/{slug}` (mock `useRouter` or `useNavigateToPanel`).
  - Breadcrumb "Projects" segment routes to `/projects` (not `/`).
  - Picker "↗ Open workspace" button is disabled when no project is selected.
  - Empty state renders the create-project affordance when `projects[]` is empty.
- **D-22:** Existing E2E suite (`tests/*.spec.ts`) — add one spec for the cold-start journey (criterion #4): login at `/` → click Projects nav item → click a project row → see workspace dashboard → click breadcrumb "Projects" → return to `/projects` panel.

### Claude's Discretion
- Exact Tailwind classes for row layout, hover states, and spacing (match existing panel aesthetics).
- The specific `ProjectsIcon` SVG/text glyph content.
- Exact relative-time formatting helper (reuse an existing one if available; otherwise pick the same approach task-board uses for task timestamps).
- Whether to show the status badge using a colored pill, outlined tag, or project.color. Use whatever matches existing status displays.
- Loading/skeleton UI while Zustand `projects[]` hydrates (if relevant).
- The exact disabled-state styling for the "↗ Open workspace" picker button.

### Folded Todos
None.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning
- `.planning/PROJECT.md` — Project Workspace & Dashboard vision; constraints (no icon libraries, next-intl, Zustand)
- `.planning/REQUIREMENTS.md` — NAV-01 requirement and acceptance criteria
- `.planning/ROADMAP.md` — Phase 8 goal, success criteria, dependencies

### Phase 2 Foundation (already built)
- `.planning/phases/02-navigation-workspace-shell/02-CONTEXT.md` — workspace routing decisions (D-01 through D-14) that Phase 8 extends
- `src/components/project/project-breadcrumb.tsx` — breadcrumb with "Projects" segment that Phase 8 re-targets (line 38)
- `src/components/project/project-workspace.tsx` — workspace shell (not modified)
- `src/components/project/project-context.tsx` — URL parsing (not modified)

### Nav & Panel System
- `src/components/layout/nav-rail.tsx` — `navGroups`, `NavItem`, `NavGroup`, `navItemTranslationKeys`, `groupTranslationKeys` (add `projects` item + key)
- `src/app/[[...panel]]/page.tsx` — `ContentRouter` switch (register `case 'projects'`), `ESSENTIAL_PANELS` set
- `src/lib/navigation.ts` — `useNavigateToPanel`, `panelHref` patterns

### Data & Store
- `src/store/index.ts` — `Project` interface (line 329), `projects[]` state, boot-time fetch path
- API route serving `GET /api/projects` — to extend with `last_activity_at` via `MAX(tasks.updated_at)` JOIN

### Reusable UI
- `src/components/panels/task-board-panel.tsx` — project filter select (line ~829) + "Projects" button (line ~848) that opens the project-manager modal (reuse for empty-state creation affordance)
- `src/components/panels/agent-squad-panel.tsx` — vertical-row panel pattern to mirror for layout

### Codebase Architecture
- `.planning/codebase/ARCHITECTURE.md` — Routing/shell layer, panel system, data flow
- `.planning/codebase/CONVENTIONS.md` — Naming (kebab-case files, named exports), imports (`@/` alias), no icon libraries
- `.planning/codebase/TESTING.md` — Vitest/RTL patterns

### i18n
- `messages/*.json` (all 10 locales) — `nav.projects` key exists; add `projects.*` namespace atomically

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Zustand `projects[]` in `src/store/index.ts` — already populated at boot; panel consumes directly
- `useNavigateToPanel` in `src/lib/navigation.ts` — client-nav pattern; use for row clicks and picker buttons
- `useTranslations('nav')` already exposes `nav.projects` label (used by breadcrumb) — reuse for nav item
- The existing project-manager modal trigger in `task-board-panel.tsx:848` — lift or re-trigger for empty-state CTA

### Established Patterns
- Nav items: `{ id, label, icon: <XIcon />, priority, essential? }` with a matching entry in `navItemTranslationKeys` for i18n
- Panel registration: add `case 'panelId': return <PanelComponent />` to `ContentRouter` switch in `src/app/[[...panel]]/page.tsx`
- Panel files: kebab-case in `src/components/panels/`, named exports, read store with `useMissionControl()`
- Essential panels: add id to `ESSENTIAL_PANELS` set in `src/app/[[...panel]]/page.tsx` if it must render in `essential` interface mode
- All strings via `next-intl`; locale updates must span all 10 locale JSON files atomically

### Integration Points
- `nav-rail.tsx` `navGroups[0].items` array — insert new entry before `tasks`
- `page.tsx` `ContentRouter` switch + `ESSENTIAL_PANELS` set
- `project-breadcrumb.tsx:38` — one-line change (`/` → `/projects`)
- Every project picker site — task-board filter, overview, create-task modal — each gets a sibling button
- `GET /api/projects` route handler — add `MAX(tasks.updated_at) AS last_activity_at` via LEFT JOIN + GROUP BY

</code_context>

<specifics>
## Specific Ideas

- The breadcrumb already uses `t('nav.projects')` — that string is the canonical label. Use it everywhere Projects appears (nav item, breadcrumb, panel title).
- Picker button label: "↗ Open workspace" (arrow glyph is decorative; the text carries meaning for screen readers and i18n).
- Row click target is the entire row element — ensure keyboard accessibility (enter/space triggers navigation, proper `role="link"` or `<a>` semantics).

</specifics>

<deferred>
## Deferred Ideas

- **Archived/inactive project view** — ROADMAP scopes the list to "active" projects. A toggle to show archived projects is a follow-on.
- **Search/filter on the Projects list** — the list is expected to be short enough (N≤~20 typical) that filtering isn't required in v1.
- **Grid-of-cards alternate layout** — rejected for v1; revisit if the list grows beyond what rows scan well.
- **Last-activity from sessions/comments, not just tasks** — MVP uses `MAX(tasks.updated_at)`. More accurate aggregation is a follow-on if this proves misleading.
- **Clickable picker option text (in addition to the button)** — rejected to keep a single, consistent affordance per picker.

</deferred>

---

*Phase: 08-projects-entry-point*
*Context gathered: 2026-04-14*
