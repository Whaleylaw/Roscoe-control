# Requirements: Project Workspace & Dashboard

**Defined:** 2026-04-13
**Core Value:** When I click into a project, I see everything about that project and can manage all its work from one place.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Navigation

- [ ] **NAV-01**: User can navigate into a project via full-takeover workspace view
- [ ] **NAV-02**: Breadcrumb navigation shows Projects > Project Name > Sub-view with clickable trail
- [ ] **NAV-03**: User can navigate between project sub-views (dashboard, tasks, sessions, agents, settings)
- [ ] **NAV-04**: URL reflects current project and sub-view (e.g., /project/my-app/tasks)
- [ ] **NAV-05**: User can return to main view via breadcrumb or back navigation

### Dashboard

- [ ] **DASH-01**: Project dashboard shows status overview with task counts by status (active, blocked, completed)
- [ ] **DASH-02**: Project dashboard shows progress indicator (completion percentage + progress bar)
- [ ] **DASH-03**: Project dashboard shows project brief (description, goals, key info)
- [ ] **DASH-04**: Project dashboard shows activity feed with recent task updates and agent activity
- [ ] **DASH-05**: Project dashboard shows blocked/needs-attention tasks prominently
- [ ] **DASH-06**: Project status indicator shows health (on track / at risk / off track)
- [ ] **DASH-07**: Dashboard data updates in real-time via SSE when tasks or sessions change

### Tasks

- [ ] **TASK-01**: Project workspace shows task list filtered to only that project's tasks
- [ ] **TASK-02**: User can create new tasks pre-scoped to the current project
- [ ] **TASK-03**: User can reassign existing tasks into or out of the current project
- [ ] **TASK-04**: Task list supports existing task board functionality (status changes, editing, etc.)

### Sessions

- [ ] **SESS-01**: Project workspace shows agent sessions scoped to the project
- [ ] **SESS-02**: Project workspace shows agents assigned to or working on the project
- [ ] **SESS-03**: User can view session details from within the project context

### Settings

- [ ] **SETT-01**: User can edit project name, description, and status from project settings
- [ ] **SETT-02**: User can edit project color, ticket prefix, deadline, and GitHub repo from settings
- [ ] **SETT-03**: Project settings use existing PATCH /api/projects/[id] endpoint

### Foundation

- [ ] **FOUN-01**: Workspace state derived from URL, not stored in global Zustand store
- [ ] **FOUN-02**: Database indexes added for project_id composite queries (tasks, sessions)
- [ ] **FOUN-03**: Component directory structure prevents monolithic panel anti-pattern
- [ ] **FOUN-04**: All user-facing strings use next-intl message files

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
| NAV-01 | — | Pending |
| NAV-02 | — | Pending |
| NAV-03 | — | Pending |
| NAV-04 | — | Pending |
| NAV-05 | — | Pending |
| DASH-01 | — | Pending |
| DASH-02 | — | Pending |
| DASH-03 | — | Pending |
| DASH-04 | — | Pending |
| DASH-05 | — | Pending |
| DASH-06 | — | Pending |
| DASH-07 | — | Pending |
| TASK-01 | — | Pending |
| TASK-02 | — | Pending |
| TASK-03 | — | Pending |
| TASK-04 | — | Pending |
| SESS-01 | — | Pending |
| SESS-02 | — | Pending |
| SESS-03 | — | Pending |
| SETT-01 | — | Pending |
| SETT-02 | — | Pending |
| SETT-03 | — | Pending |
| FOUN-01 | — | Pending |
| FOUN-02 | — | Pending |
| FOUN-03 | — | Pending |
| FOUN-04 | — | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 0
- Unmapped: 26 ⚠️

---
*Requirements defined: 2026-04-13*
*Last updated: 2026-04-13 after initial definition*
