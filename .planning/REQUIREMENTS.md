# Requirements: Project Workspace & Dashboard

**Defined:** 2026-04-13
**Core Value:** When I click into a project, I see everything about that project and can manage all its work from one place.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Navigation

- [ ] **NAV-01**: User can navigate into a project via full-takeover workspace view
- [x] **NAV-02**: Breadcrumb navigation shows Projects > Project Name > Sub-view with clickable trail
- [x] **NAV-03**: User can navigate between project sub-views (dashboard, tasks, sessions, agents, settings)
- [x] **NAV-04**: URL reflects current project and sub-view (e.g., /project/my-app/tasks)
- [x] **NAV-05**: User can return to main view via breadcrumb or back navigation

### Dashboard

- [x] **DASH-01**: Project dashboard shows status overview with task counts by status (active, blocked, completed)
- [x] **DASH-02**: Project dashboard shows progress indicator (completion percentage + progress bar)
- [x] **DASH-03**: Project dashboard shows project brief (description, goals, key info)
- [x] **DASH-04**: Project dashboard shows activity feed with recent task updates and agent activity
- [x] **DASH-05**: Project dashboard shows blocked/needs-attention tasks prominently
- [x] **DASH-06**: Project status indicator shows health (on track / at risk / off track)
- [x] **DASH-07**: Dashboard data updates in real-time via SSE when tasks or sessions change

### Tasks

- [x] **TASK-01**: Project workspace shows task list filtered to only that project's tasks
- [x] **TASK-02**: User can create new tasks pre-scoped to the current project
- [x] **TASK-03**: User can reassign existing tasks into or out of the current project
- [x] **TASK-04**: Task list supports existing task board functionality (status changes, editing, etc.)

### Sessions

- [x] **SESS-01**: Project workspace shows agent sessions scoped to the project
- [x] **SESS-02**: Project workspace shows agents assigned to or working on the project
- [x] **SESS-03**: User can view session details from within the project context

### Settings

- [x] **SETT-01**: User can edit project name, description, and status from project settings
- [x] **SETT-02**: User can edit project color, ticket prefix, deadline, and GitHub repo from settings
- [x] **SETT-03**: Project settings use existing PATCH /api/projects/[id] endpoint

### Foundation

- [x] **FOUN-01**: Workspace state derived from URL, not stored in global Zustand store
- [x] **FOUN-02**: Database indexes added for project_id composite queries (tasks, sessions)
- [x] **FOUN-03**: Component directory structure prevents monolithic panel anti-pattern
- [x] **FOUN-04**: All user-facing strings use next-intl message files

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### AI-Native Features

- **AI-01**: Live agent activity indicators showing agents working on project tasks in real-time
- **AI-02**: One-click task dispatch to agents from project workspace
- **AI-03**: Project cost tracking showing token usage and API costs per project
- **AI-04**: Agent performance analytics per project (completion rates, error rates)

### Enhanced Views

- **VIEW-01**: Rich text/markdown project brief editor
- **VIEW-02**: Kanban/board view toggle within project task list
- **VIEW-03**: Project templates for creating new projects from patterns

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Gantt chart / timeline view | High complexity, low value for AI agent work measured in minutes not months |
| Cross-project dependencies | Massively increases data model complexity; projects are independent scopes |
| Custom fields on projects | Scope creep; existing fields sufficient; use description for freeform metadata |
| Project-level permissions/roles | Existing workspace auth (viewer/operator/admin) is sufficient |
| Real-time collaborative editing | Requires CRDT infrastructure; enormous complexity for a dashboard tool |
| Drag-and-drop project reordering | Low value with 3-10 projects; sort by activity or alphabetically |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 | Phase 1 | Complete |
| FOUN-02 | Phase 1 | Complete |
| FOUN-03 | Phase 1 | Complete |
| FOUN-04 | Phase 1 | Complete |
| NAV-01 | Phase 8 | Pending (reopened — Phase 2 shipped workspace code but no main-UI entry point; discovered during v1.0 human verification) |
| NAV-02 | Phase 2 | Complete |
| NAV-03 | Phase 2 | Complete |
| NAV-04 | Phase 2 | Complete |
| NAV-05 | Phase 2 | Complete |
| DASH-01 | Phase 3 | Complete |
| DASH-02 | Phase 3 | Complete |
| DASH-03 | Phase 3 | Complete |
| DASH-04 | Phase 3 | Complete |
| DASH-05 | Phase 3 | Complete |
| DASH-06 | Phase 3 | Complete |
| DASH-07 | Phase 3 | Complete |
| TASK-01 | Phase 4 | Complete |
| TASK-02 | Phase 4 | Complete |
| TASK-03 | Phase 4 | Complete |
| TASK-04 | Phase 4 | Complete |
| SESS-01 | Phase 5 | Complete |
| SESS-02 | Phase 5 | Complete |
| SESS-03 | Phase 5 | Complete |
| SETT-01 | Phase 6 | Complete |
| SETT-02 | Phase 6 | Complete |
| SETT-03 | Phase 6 | Complete |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-13*
*Last updated: 2026-04-13 after roadmap creation*
