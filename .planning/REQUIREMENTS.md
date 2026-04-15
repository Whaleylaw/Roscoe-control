# Requirements: Project Workspace & Dashboard

**Defined:** 2026-04-13
**Core Value:** When I click into a project, I see everything about that project and can manage all its work from one place.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Navigation

- [x] **NAV-01**: User can navigate into a project via full-takeover workspace view
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

## v1.1 Requirements — Native GSD Integration

Requirements for milestone v1.1. Each maps to Phase 9 (gsd-native-integration).

### Schema & Data Model

- [x] **GSD-01**: Projects can be flagged `gsd_enabled` and assigned a `gsd_track` (ops / product / marketing / legal / firmvault / custom) at create or update time
- [x] **GSD-02**: Projects track current phase via `gsd_phase` (discuss / plan / execute / verify / done) with backward-compatible default
- [x] **GSD-03**: Projects track approval policy via `gsd_gate_mode` (manual_approval / auto_internal)
- [x] **GSD-04**: Tasks track `gsd_phase` and `gate_required` flag to participate in the lifecycle
- [x] **GSD-05**: Tasks track gate state via `gate_status` (not_required / pending / approved / rejected) with `gate_approved_by` and `gate_approved_at` audit fields
- [x] **GSD-06**: Database migrations are additive and safe to run on existing production DBs

### Lifecycle API

- [x] **GSD-07**: User can bootstrap default phase tasks via `POST /api/projects/:id/gsd/bootstrap` idempotently (re-run safe)
- [x] **GSD-08**: User can advance a project through phases via `POST /api/projects/:id/gsd/transition` with enforced ordering
- [x] **GSD-09**: Transition endpoint rejects illegal phase jumps with a machine-readable error code and actionable message
- [x] **GSD-10**: Transition endpoint supports a waiver flag on execute→verify (with required reason) for tasks that won't ship this cycle
- [x] **GSD-11**: User can approve or reject a task gate via `PATCH /api/tasks/:id/gate`, recording approver identity and timestamp
- [x] **GSD-12**: All three new endpoints require operator or admin role; viewers can read gate state but not mutate it
- [x] **GSD-13**: Project and task read endpoints include the new GSD fields in their responses
- [x] **GSD-14**: Project create/update endpoints accept the new GSD fields with validation

### Gate Enforcement

- [x] **GSD-15**: Tasks with `gate_required=1` and `gate_status!=approved` cannot move to `in_progress` or `done`; the API returns 403 with actionable error text
- [x] **GSD-16**: Gate enforcement applies only to forward motion (in_progress / done), not to backward motion or status changes to backlog/blocked/in_review

### Bootstrap Templates

- [x] **GSD-17**: Bootstrap loads phase task templates from external JSON files at `<MISSION_CONTROL_DATA_DIR>/gsd-templates/<track>.json` (or `default.json`)
- [x] **GSD-18**: Bootstrap falls back to a bundled hard-coded default if no template file exists on disk — bootstrap always succeeds
- [x] **GSD-19**: Bootstrap is idempotent per phase: re-runs skip tasks whose `ticket_ref` + `gsd_phase` combination already exists on the project

### UI — Lifecycle Tab

- [x] **GSD-20**: Project workspace exposes a dedicated "Lifecycle" tab at `/[slug]/lifecycle` alongside Dashboard / Tasks / Sessions / Agents / Settings
- [x] **GSD-21**: Lifecycle tab shows current phase, phase timeline, bootstrap button, and transition controls for GSD-enabled projects
- [x] **GSD-22**: Lifecycle tab shows gate-required tasks with inline approve/reject actions (operator+ only)
- [x] **GSD-23**: For non-GSD projects, Lifecycle tab renders an empty state with an "Enable GSD for this project" CTA

### UI — Task Board Integration

- [x] **GSD-24**: Task board (global and project-scoped) displays phase badges on tasks with non-null `gsd_phase`
- [x] **GSD-25**: Gate-required tasks display a distinct "Approval required" badge; approved gates show "Approved"

### UI — Settings

- [x] **GSD-26**: Project settings view includes a GSD section with `gsd_enabled` toggle, `gsd_track` dropdown, and `gsd_gate_mode` selector
- [x] **GSD-27**: GSD section is always visible; track and gate-mode controls are disabled/grayed until `gsd_enabled=1`

### Events & i18n

- [x] **GSD-28**: Transitions and gate-status changes emit events via the existing `eventBus` (`project.gsd.transition`, `task.gate.changed`); existing `/api/activities` stream surfaces them automatically
- [x] **GSD-29**: All new user-facing strings go through next-intl under a `project.lifecycle.*` namespace with atomic coverage across all 10 locales

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
| GSD-01 | Phase 9 | Complete |
| GSD-02 | Phase 9 | Complete |
| GSD-03 | Phase 9 | Complete |
| GSD-04 | Phase 9 | Complete |
| GSD-05 | Phase 9 | Complete |
| GSD-06 | Phase 9 | Complete |
| GSD-07 | Phase 9 | Complete |
| GSD-08 | Phase 9 | Complete |
| GSD-09 | Phase 9 | Complete |
| GSD-10 | Phase 9 | Complete |
| GSD-11 | Phase 9 | Complete |
| GSD-12 | Phase 9 | Complete |
| GSD-13 | Phase 9 | Complete |
| GSD-14 | Phase 9 | Complete |
| GSD-15 | Phase 9 | Complete |
| GSD-16 | Phase 9 | Complete |
| GSD-17 | Phase 9 | Complete |
| GSD-18 | Phase 9 | Complete |
| GSD-19 | Phase 9 | Complete |
| GSD-20 | Phase 9 | Complete |
| GSD-21 | Phase 9 | Complete |
| GSD-22 | Phase 9 | Complete |
| GSD-23 | Phase 9 | Complete |
| GSD-24 | Phase 9 | Complete |
| GSD-25 | Phase 9 | Complete |
| GSD-26 | Phase 9 | Complete |
| GSD-27 | Phase 9 | Complete |
| GSD-28 | Phase 9 | Complete |
| GSD-29 | Phase 9 | Complete |

**Coverage:**
- v1 requirements: 26 total, mapped 26 / unmapped 0 ✓
- v1.1 requirements: 29 total, mapped 29 / unmapped 0 ✓

---
*Requirements defined: 2026-04-13*
*Last updated: 2026-04-14 — v1.1 Native GSD Integration requirements added (29 new REQ-IDs: GSD-01..29)*
