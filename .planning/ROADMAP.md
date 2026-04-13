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
- [ ] **Phase 3: Project Dashboard** - Dashboard with status overview, progress, project brief, activity feed, and real-time updates
- [ ] **Phase 4: Project Tasks** - Scoped task list with create, reassign, and full board functionality within the workspace
- [ ] **Phase 5: Sessions & Agents** - Scoped session and agent views with detail access from within the project context
- [ ] **Phase 6: Settings** - Project settings panel for name, description, status, color, prefix, deadline, and GitHub repo

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
- [ ] 02-00-PLAN.md — Wave 0 test scaffolds for workspace, breadcrumb, tabs (NAV-01 through NAV-05)
- [ ] 02-01-PLAN.md — Context provider with project data fetching, breadcrumb + tab bar components, workspace shell wiring, i18n nav keys
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
**Plans**: TBD
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
**Plans**: TBD
**UI hint**: yes

### Phase 5: Sessions & Agents
**Goal**: Users can see which agent sessions and agents are active in the project, and can open session details without leaving the project context
**Depends on**: Phase 4
**Requirements**: SESS-01, SESS-02, SESS-03
**Success Criteria** (what must be TRUE):
  1. Sessions tab shows only sessions associated with the current project
  2. Agents tab shows only agents assigned to or currently working on the current project
  3. User can click a session to open its detail view without navigating away from the project workspace
**Plans**: TBD
**UI hint**: yes

### Phase 6: Settings
**Goal**: Users can fully configure a project — name, description, status, color, ticket prefix, deadline, and GitHub repo — from within the project workspace using the existing API
**Depends on**: Phase 5
**Requirements**: SETT-01, SETT-02, SETT-03
**Success Criteria** (what must be TRUE):
  1. Settings tab shows editable fields for project name, description, and status
  2. Settings tab shows editable fields for color, ticket prefix, deadline, and GitHub repo
  3. Saving changes calls the existing PATCH /api/projects/[id] endpoint and the workspace reflects updates immediately
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/3 | Planning complete | - |
| 2. Navigation & Workspace Shell | 0/2 | Planning complete | - |
| 3. Project Dashboard | 0/TBD | Not started | - |
| 4. Project Tasks | 0/TBD | Not started | - |
| 5. Sessions & Agents | 0/TBD | Not started | - |
| 6. Settings | 0/TBD | Not started | - |
