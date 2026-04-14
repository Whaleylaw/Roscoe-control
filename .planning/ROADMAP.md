# Roadmap: Project Workspace & Dashboard

## Overview

Transform projects from a task-grouping label into a first-class destination. The build starts with technical foundations (URL routing, DB indexes, component structure), then constructs the navigation shell that lets users enter a project workspace, followed by the dashboard that makes the core value real. The final phases layer in scoped task management, session and agent views, and project settings — completing the full workspace experience.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Technical underpinnings: URL-driven state, DB indexes, component structure, i18n
- [ ] **Phase 2: Navigation & Workspace Shell** - Full-takeover workspace entry point with breadcrumb navigation and sub-view routing
- [x] **Phase 3: Project Dashboard** - Dashboard with status overview, progress, project brief, activity feed, and real-time updates (completed 2026-04-13)
- [ ] **Phase 4: Project Tasks** - Scoped task list with create, reassign, and full board functionality within the workspace
- [ ] **Phase 5: Sessions & Agents** - Scoped session and agent views with detail access from within the project context
- [ ] **Phase 6: Settings** - Project settings panel for name, description, status, color, prefix, deadline, and GitHub repo
- [ ] **Phase 7: Post-Audit Gap Closure** - Resolve FLOW-E archive visibility decision + project-context loading-timeout escape hatch
- [ ] **Phase 8: Projects Entry Point** - Wire the main-UI path INTO the project workspace (nav-rail item, projects list panel, deep-link from existing project pickers) — closes real-world NAV-01 gap

## Phase Details

### Phase 1: Foundation
**Goal**: The technical substrate exists for a URL-driven project workspace with performant queries, clean component architecture, and full i18n support
**Depends on**: Nothing (first phase)
**Requirements**: FOUN-01, FOUN-02, FOUN-03, FOUN-04
**Success Criteria** (what must be TRUE):
  1. Navigating to a project URL renders the correct workspace without relying on global Zustand state
  2. Database queries scoping tasks and sessions by project_id use indexes (query plans show index scans)
  3. Project workspace components live in a dedicated directory, not as a single monolithic file
  4. All new UI strings render correctly via next-intl message lookups with no hardcoded text
**Plans:** 3 plans
Plans:
- [x] 01-00-PLAN.md — Wave 0 test scaffolds (FOUN-01, FOUN-02, FOUN-04)
- [x] 01-01-PLAN.md — DB composite indexes + i18n namespace for all 10 locales
- [x] 01-02-PLAN.md — URL-driven context provider, workspace shell, view router, stub views, page.tsx integration
**UI hint**: yes

### Phase 2: Navigation & Workspace Shell
**Goal**: Users can navigate into a project and see a full-takeover workspace with breadcrumb trail, sub-view tabs, and a working back path to the main view
**Depends on**: Phase 1
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04, NAV-05
**Success Criteria** (what must be TRUE):
  1. Clicking a project in the main view opens a full-screen workspace replacing the main panel content
  2. Breadcrumb reads "Projects > [Project Name] > [Sub-view]" with each segment clickable
  3. User can switch between Dashboard, Tasks, Sessions, Agents, and Settings tabs without a page reload
  4. The browser URL updates to reflect the active project and sub-view (e.g. /project/my-app/tasks)
  5. User can return to the main project list by clicking "Projects" in the breadcrumb or a back affordance
**Plans:** 2 plans
Plans:
- [x] 02-00-PLAN.md — Wave 0 test scaffolds for workspace, breadcrumb, tabs (NAV-01 through NAV-05)
- [x] 02-01-PLAN.md — Context provider with project data fetching, breadcrumb + tab bar components, workspace shell wiring, i18n nav keys
**UI hint**: yes

### Phase 3: Project Dashboard
**Goal**: Users arrive at a dashboard that tells them exactly what is happening in the project — status, progress, blocked items, recent activity — and it stays current without a page refresh
**Depends on**: Phase 2
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07
**Success Criteria** (what must be TRUE):
  1. Dashboard shows task counts grouped by status (active, blocked, completed) at a glance
  2. A progress bar and percentage reflect the ratio of completed to total tasks
  3. Dashboard shows the project brief (description and goals) in readable form
  4. An activity feed lists recent task updates and agent activity in reverse chronological order
  5. Blocked or needs-attention tasks are visually prominent and distinct from normal tasks
  6. A health indicator (on track / at risk / off track) is visible without scrolling
  7. All dashboard data updates live when an SSE event fires for a task or session change
**Plans:** 3/3 plans complete
Plans:
- [x] 03-00-PLAN.md — Wave 0 test scaffolds for dashboard (DASH-01 through DASH-07)
- [x] 03-01-PLAN.md — i18n keys + dashboard sub-components (status cards, progress bar, health badge, project brief, activity feed)
- [x] 03-02-PLAN.md — Main dashboard-view.tsx wiring with data, layout, SSE reactivity, and visual verification
**UI hint**: yes

### Phase 4: Project Tasks
**Goal**: Users can manage the project's full task lifecycle — view, create, reassign, and update tasks — entirely from within the project workspace
**Depends on**: Phase 3
**Requirements**: TASK-01, TASK-02, TASK-03, TASK-04
**Success Criteria** (what must be TRUE):
  1. Task list inside the workspace shows only tasks belonging to the current project
  2. Creating a task from within the workspace automatically assigns it to the current project
  3. User can reassign any existing task to or from the current project via the task's edit UI
  4. All existing task board actions (status change, edit, delete) work identically inside the project workspace
**Plans:** 2 plans
Plans:
- [x] 04-00-PLAN.md — Wave 0 test scaffolds (TASK-01 through TASK-04)
- [x] 04-01-PLAN.md — TaskBoardScope prop + tasks-view wrapper + test bodies
**UI hint**: yes

### Phase 5: Sessions & Agents
**Goal**: Users can see which agent sessions and agents are active in the project, and can open session details without leaving the project context
**Depends on**: Phase 4
**Requirements**: SESS-01, SESS-02, SESS-03
**Success Criteria** (what must be TRUE):
  1. Sessions tab shows only sessions associated with the current project
  2. Agents tab shows only agents assigned to or currently working on the current project
  3. User can click a session to open its detail view without navigating away from the project workspace
**Plans:** 4 plans
Plans:
- [x] 05-00-PLAN.md — Wave 0 test scaffolds + i18n keys across 10 locales (SESS-01, SESS-02, SESS-03)
- [x] 05-01-PLAN.md — /api/agents?project_id= union filter + AgentSquadScope prop + agents-view wrapper (SESS-02)
- [x] 05-02-PLAN.md — detailId URL parser + SessionDetailView + SessionDetailScope prop + breadcrumb extension (SESS-03)
- [x] 05-03-PLAN.md — GET /api/projects/[id]/sessions endpoint + two-section sessions-view + Playwright E2E (SESS-01)
**UI hint**: yes

### Phase 6: Settings
**Goal**: Users can fully configure a project — name, description, status, color, ticket prefix, deadline, and GitHub repo — from within the project workspace using the existing API
**Depends on**: Phase 5
**Requirements**: SETT-01, SETT-02, SETT-03
**Success Criteria** (what must be TRUE):
  1. Settings tab shows editable fields for project name, description, and status
  2. Settings tab shows editable fields for color, ticket prefix, deadline, and GitHub repo
  3. Saving changes calls the existing PATCH /api/projects/[id] endpoint and the workspace reflects updates immediately
**Plans:** 2 plans
Plans:
- [x] 06-00-PLAN.md — Wave 0 test scaffolds + atomic project.settings.* i18n keys across 10 locales (SETT-01, SETT-02, SETT-03)
- [x] 06-01-PLAN.md — SettingsView form implementation (structure + state + dirty/viewer readonly, then save PATCH + Zustand refresh + error routing + test bodies)
**UI hint**: yes

### Phase 7: Post-Audit Gap Closure
**Goal**: Resolve the one flow gap and one hardening item surfaced by the v1.0 milestone audit so the milestone ships without known UX ambiguity or boot-stall failure mode
**Depends on**: Phase 6
**Requirements**: (no new REQ-IDs — gap closure against existing SETT-01/SETT-02 and FOUN-01 behavior)
**Gap Closure**: Closes FLOW-E (archive visibility) + Phase 2 tech-debt (project-context loading timeout) from `.planning/v1.0-MILESTONE-AUDIT.md`
**Success Criteria** (what must be TRUE):
  1. Archiving a project via Settings either (a) keeps the project visible in the Zustand `projects` array with `status: 'archived'` so the UI can show a badge, OR (b) the product decision to hide archived projects is documented explicitly in the plan — whichever the plan phase decides, the behavior is intentional and tested
  2. `project-context.tsx` has an escape path when the boot sequence stalls: if `projects.length === 0` after a reasonable timeout (e.g. 10s), the workspace shell surfaces an error state with a retry action instead of spinning indefinitely
  3. Unit tests cover both branches (timeout fires → error UI; timeout does not fire → normal load) and the archive visibility behavior matches the decision from criterion 1
**Plans:** 2 plans
Plans:
- [x] 07-00-PLAN.md — Wave 0 scaffolds: it.todo stubs for loading-timeout + FLOW-E archive-behavior contract, atomic 10-locale loadTimeout i18n keys
- [x] 07-01-PLAN.md — Wave 1: 10s timeout escape path in project-context + workspace retry UI + FLOW-E Option-2 decision comment in store/index.ts + 7 real tests (replaces all 7 it.todo stubs)
**UI hint**: no (no new UI surface; only error-state text inside existing workspace shell)

### Phase 8: Projects Entry Point
**Goal**: Users can discover and enter a project workspace from the main UI without typing a URL — NAV-01 is actually achievable end-to-end, not just direct-URL-load
**Depends on**: Phase 2 (workspace shell), Phase 7 (clean baseline)
**Requirements**: NAV-01 (reopened — was marked Complete in v1.0 audit but real-world entry path missing)
**Gap Closure**: Closes the Phase 2 discovery gap surfaced during v1.0 human verification — workspace code existed but no main-UI call site ever navigated to `/project/{slug}`
**Success Criteria** (what must be TRUE):
  1. A "Projects" item is visible in the nav-rail OPERATE group (order: near Tasks); clicking it renders a Projects list panel, not the project workspace itself
  2. The Projects list panel shows one entry per active project with name, status badge, ticket prefix, and either a deadline or a last-activity hint; clicking an entry navigates to `/project/{slug}` (the workspace dashboard, per existing router)
  3. All pre-existing project-name pickers and dropdowns in the main UI (task board filter, overview, create-task modal) expose a clear path into the workspace — either a "Open workspace" action on the selected project, or clicking the picker's resolved project name routes to its workspace
  4. Cold-start journey: from a fresh login at `/`, a user can reach a project's dashboard with clicks alone (no URL editing) and return to the main view via the existing breadcrumb "Projects" link (which should route to the new Projects panel, not to `/`)
  5. The Projects list panel uses i18n via `next-intl` across all 10 locales atomically (follow phase 6 precedent)
  6. Unit tests cover: nav-rail renders the new item; Projects list panel renders project cards from Zustand `projects[]` and navigates on click; breadcrumb "Projects" segment routes to the Projects panel (not `/`)
**Plans:** 4 plans
Plans:
- [x] 08-00-PLAN.md — Backend + store: extend GET /api/projects with last_activity_at; extend Project interface; unit test
- [x] 08-01-PLAN.md — i18n (10 locales) + nav-rail Projects item + ContentRouter + ProjectsPanel (row list + empty-state CTA) + unit tests
- [x] 08-02-PLAN.md — Breadcrumb re-target to /projects + "↗ Open workspace" picker button on task-board filter + unit tests
- [ ] 08-03-PLAN.md — Playwright E2E covering the NAV-01 cold-start journey
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/3 | Planning complete | - |
| 2. Navigation & Workspace Shell | 0/2 | Planning complete | - |
| 3. Project Dashboard | 3/3 | Complete   | 2026-04-13 |
| 4. Project Tasks | 0/2 | Planning complete | - |
| 5. Sessions & Agents | 0/4 | Planning complete | - |
| 6. Settings | 0/2 | Planning complete | - |
| 7. Post-Audit Gap Closure | 0/2 | Planning complete | - |
| 8. Projects Entry Point | 0/4 | Planning complete | - |
