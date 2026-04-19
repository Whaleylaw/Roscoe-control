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

## v1.2 Requirements — Recipe-Based Ephemeral Agent Runtime

Requirements for milestone v1.2. Source design: `docs/superpowers/specs/2026-04-18-recipe-agent-system-design.md`.

**Milestone goal:** Ship a complete recipe-card + runner system that lets Kanban tasks be executed by short-lived containerized agents, configured from filesystem-authored recipe cards, with crash-safe progress checkpoints and per-task-scoped authentication.

### Recipe System

- [ ] **RECIPE-01**: Recipe author can define a recipe as a directory under `recipes/<slug>/` containing `recipe.yaml`, `SOUL.md`, optional `tools/`, optional `skills/`, optional `README.md`
- [ ] **RECIPE-02**: Recipes are indexed into a `recipes` SQLite table capturing slug, name, description, when_to_use, image, workspace_mode, timeout_seconds, max_concurrent, env_json, secrets_json, tags_json, model_json, version, and dir_sha
- [ ] **RECIPE-03**: Filesystem watcher re-indexes recipes when files change under `recipes/`, drops rows whose directories disappear, and uses `dir_sha` to skip unchanged recipes
- [ ] **RECIPE-04**: Recipe author can declare `model.primary` (required), `model.fallback`, `model.provider`, and `model.params` in `recipe.yaml`; primary validated against a known-model registry at index time
- [ ] **RECIPE-05**: User or caller can list recipes, fetch one by slug, and search by task description through the recipe API
- [ ] **RECIPE-06**: Caller (e.g., Hermes) can create a new recipe by posting `recipe.yaml` + `SOUL.md` body; system writes the files and indexes the row atomically
- [ ] **RECIPE-07**: Admin can force a full re-scan of the `recipes/` directory via an API endpoint when the watcher falls behind
- [ ] **RECIPE-08**: Recipe search ranks candidates against task description + tags using SQL matching in v1.2 (embedding search deferred)

### Task Runtime Context

- [ ] **TCTX-01**: Task author can set `recipe_slug` on a task at creation or update; task record references a valid recipe row
- [ ] **TCTX-02**: Task author can specify `workspace_source` (project_id + base_ref) on a task when the recipe declares `workspace: worktree`; system rejects tasks missing this for worktree-mode recipes
- [ ] **TCTX-03**: Task author can attach read-only reference mounts on a task as `{host_path, container_path, label}` entries, visible in the task UI
- [ ] **TCTX-04**: Task author can attach extra skill files on a task as a list of host paths, mounted at `/skills/<name>` in the container
- [ ] **TCTX-05**: Task author can set `model_override` on a task to force a specific model regardless of the recipe's default
- [ ] **TCTX-06**: All user-supplied host paths on a task are validated against the runner's `mount_allowlist` at task creation, failing fast with a clear error if out of bounds
- [ ] **TCTX-07**: Task record tracks runner execution state via `container_id`, `runner_started_at`, `runner_exit_code`, `worktree_path`, `runner_attempts`, `runner_max_attempts`, `runner_last_failure_reason`

### Runner Daemon

- [ ] **RUNNER-01**: Operator can run the runner as a standalone Node process (`scripts/mc-runner.mjs`) with its own LaunchAgent template, separate from the Mission Control web server
- [ ] **RUNNER-02**: Runner registers with Mission Control on startup using a long-lived shared secret (auto-generated on first run, stored in `.data/runner.secret`)
- [ ] **RUNNER-03**: Runner subscribes to `task.runner_requested` SSE events to claim work as soon as tasks become ready
- [ ] **RUNNER-04**: Runner polls `/api/runner/ready-tasks` every 15 seconds as a fallback when SSE drops
- [ ] **RUNNER-05**: Runner sends heartbeats every 10 seconds; Mission Control marks the runner offline and surfaces a UI banner when no heartbeat arrives for 60 seconds
- [ ] **RUNNER-06**: Runner claims a task atomically via `POST /api/runner/claim/:task_id`, receiving a full dispatch payload (recipe content, task, mounts, fresh task-scoped token) or a 409 if already claimed
- [ ] **RUNNER-07**: Runner validates every mount path against the allowlist at claim time as defense in depth, resolving symlinks and rejecting paths that escape
- [ ] **RUNNER-08**: Runner enforces global (`MAX_CONCURRENT_CONTAINERS`) and per-recipe (`max_concurrent`) concurrency caps; over-cap claims return 409 and leave the task for the next cycle
- [ ] **RUNNER-09**: Runner creates or reuses a git worktree at `.data/runner/worktrees/task-<id>/` for worktree-mode recipes, seeds the `.mc/` directory, and records the path on the task
- [ ] **RUNNER-10**: Runner launches the container via `docker run --rm -d` with the documented mounts, env, and resource flags, streaming stdout/stderr to `.data/runner/logs/task-<id>/attempt-<n>/`
- [ ] **RUNNER-11**: Runner waits for container exit, posts `runner-exit` with exit code and stderr tail, and triggers Mission Control retry/fail logic
- [ ] **RUNNER-12**: Runner gracefully stops the container when a `blocked` checkpoint arrives, preserving the worktree so the next attempt can resume
- [ ] **RUNNER-13**: On startup after a crash, runner reconciles orphaned containers against the DB via `GET /api/runner/pending-containers` and adopts or cleans them up
- [ ] **RUNNER-14**: On terminal task status, runner revokes the task token and destroys the worktree (preserving it for a GC window on failure)

### Container Execution

- [ ] **CONTAINER-01**: Container receives task context as env vars (`MC_API_URL`, `MC_TASK_ID`, `MC_API_TOKEN`, `MC_WORKSPACE`, `MC_RECIPE_PATH`, `MC_MODEL_*`) and recipe-declared secrets (e.g., `ANTHROPIC_API_KEY`) injected from the runner's secret store
- [ ] **CONTAINER-02**: Container sees the worktree at `/workspace` (rw when recipe is worktree-mode), the recipe at `/recipe` (ro), read-only mounts at `/refs/<label-slug>/` (ro), and extra skills at `/skills/<name>` (ro)
- [ ] **CONTAINER-03**: Container is hard-killed at `recipe.timeout_seconds`; runner reports the timeout as the failure reason
- [ ] **CONTAINER-04**: One reference image (`mc-hello-world-agent`) exercises the full checkpoint → submit flow for integration testing

### Worktree & Crash Recovery

- [ ] **WORK-01**: On first launch, runner seeds `.mc/task.json`, `.mc/progress.md` (empty), `.mc/checkpoints.jsonl` (empty), and `.mc/.gitignore` in the worktree
- [ ] **WORK-02**: `.mc/task.json` contains `task_id`, `recipe_slug`, `attempt`, `is_resuming`, and `prior_attempts[]` (each with started_at, exit_code, failure_reason)
- [ ] **WORK-03**: Worktree is preserved across container crashes and retries; destroyed only when task reaches `done`, `failed`, or `cancelled` (failed tasks get a GC delay of N days)
- [ ] **WORK-04**: On a resume attempt, runner injects an agent preamble above SOUL.md instructing the agent to read `.mc/progress.md` + `.mc/checkpoints.jsonl`, inspect git state, and continue without redoing work
- [ ] **WORK-05**: On first attempt, runner injects a shorter preamble instructing the agent to write notes to `.mc/progress.md` as it works
- [ ] **WORK-06**: Retry cap enforced via `runner_max_attempts` (default 3, recipe-overridable); exceeding the cap marks task `failed` with a clear reason
- [ ] **WORK-07**: Scheduled garbage-collection job prunes worktrees for tasks terminal longer than N days (configurable, default 7)

### Checkpoints

- [ ] **CP-01**: Agent can post a checkpoint via `POST /api/tasks/:id/checkpoints` with `step`, `summary`, `status` (`completed` | `in_progress` | `blocked`), plus optional `artifacts`, `next_step`, `blocker_reason`, `tokens_used`, `duration_ms`
- [ ] **CP-02**: Each checkpoint is stored both as a `task_checkpoints` row and as one JSON line appended to `<worktree>/.mc/checkpoints.jsonl` with identical field names
- [ ] **CP-03**: `status: blocked` checkpoints transition the task `in_progress → awaiting_owner`, post an automatic comment with the blocker reason, and gracefully stop the container
- [ ] **CP-04**: When the blocker is resolved (task back to `assigned`), runner relaunches with the resume flow
- [ ] **CP-05**: Checkpoint artifact entries are typed (`kind: file | url | diff | test_result | comment | other`) with optional `path`, `url`, `ref`, `summary`
- [ ] **CP-06**: Viewer can fetch the full checkpoint timeline for a task via `GET /api/tasks/:id/checkpoints`, filterable by `attempt`

### Authentication

- [ ] **RAUTH-01**: A new `runner` principal is defined in `src/lib/auth.ts`, authenticated by the shared `.data/runner.secret`, scoped strictly to `/api/runner/*` routes
- [ ] **RAUTH-02**: A new `runner-token` principal is defined; tokens are per-task, per-attempt, stored as SHA-256 hashes in `task_runner_tokens`, expiring at `runner_started_at + recipe.timeout_seconds + 60s`
- [ ] **RAUTH-03**: `runner-token` authentication verifies path parameter `:id` matches the token's embedded `task_id`, preventing cross-task access
- [ ] **RAUTH-04**: Route handlers opt into `runner-token` auth explicitly (no rank-ordered escalation path from lower tiers)
- [ ] **RAUTH-05**: When a task reaches a terminal status, its runner token is revoked (`revoked_at` set) and cannot be used again
- [ ] **RAUTH-06**: A runner-token-authenticated call can hit only the narrow set of task-lifecycle endpoints (checkpoints, submit, fail, scoped status, read own task, read own task comments)

### Model Registry

- [ ] **MODEL-01**: A new `src/lib/model-registry.ts` module exports a typed map of model identifiers to `{provider, context_window, output_tokens_max, supports_tools, supports_thinking}` — seeded with Opus 4.7, Sonnet 4.6, and Haiku 4.5
- [ ] **MODEL-02**: Recipe indexer rejects recipes whose `model.primary` is not in the registry, surfacing a human-readable error in the UI and indexer logs
- [ ] **MODEL-03**: Task creation rejects `model_override` values not in the registry with a clear error
- [ ] **MODEL-04**: Effective model is resolved at claim time as `task.model_override ?? recipe.model.primary` and passed to the container via env (`MC_MODEL_PRIMARY`, `MC_MODEL_PROVIDER`, `MC_MODEL_PARAMS_JSON`, optional `MC_MODEL_FALLBACK`)

### UI Surfaces

- [ ] **RUI-01**: Each task card on the Kanban displays a recipe badge when `recipe_slug` is set, including recipe name and model tier color
- [ ] **RUI-02**: Task-board shell shows a runner-status banner with live state (`🟢 Runner online` / `🔴 Runner offline — tasks waiting: N`)
- [ ] **RUI-03**: Task detail view has a new "Progress" tab showing a live checkpoint timeline grouped by attempt, updating via SSE
- [ ] **RUI-04**: Task create/edit form has a Recipe dropdown (autocomplete via `/api/recipes/search`) and a collapsible "Advanced" section exposing `read_only_mounts`, `extra_skills`, and `model_override`
- [ ] **RUI-05**: All new UI strings are translated across 10 locales (en/es/fr/de/ja/ko/pt/ru/zh/ar) atomically per the established pattern
- [ ] **RUI-06**: Minimal recipe list panel (reachable from main nav) shows indexed recipes with name, description, model, tags, and a "Resync" button — authoring stays filesystem-first

### Scheduler Integration

- [ ] **SCHED-01**: `autoRouteInboxTasks()` moves recipe-tagged tasks from `inbox` to `assigned` without running agent-affinity scoring
- [ ] **SCHED-02**: `dispatchAssignedTasks()` skips tasks with `recipe_slug` (legacy behavior preserved for non-recipe tasks)
- [ ] **SCHED-03**: `requeueStaleTasks()` detects stuck recipe-tagged tasks by checking runner heartbeat and container liveness in addition to existing legacy logic
- [ ] **SCHED-04**: A new `reconcileRunnerHeartbeat()` scheduler task (every 30s) marks `in_progress` recipe-tasks stale when runner is unreachable, so reconcile-on-reconnect works cleanly
- [ ] **SCHED-05**: `task.runner_requested` event is emitted from three points: `autoRouteInboxTasks` on `inbox → assigned`, `POST /api/tasks` when a task is created directly as `assigned` with `recipe_slug`, and the runner-exit retry path on `in_progress → assigned`
- [ ] **SCHED-06**: `recipe.indexed`, `recipe.removed`, `task.container_started`, `task.container_exited`, and `task.checkpoint_added` events are broadcast on SSE for UI reactivity

### Integration & Testing

- [ ] **RTEST-01**: Unit tests cover recipe indexer parsing, mount-allowlist resolution, runner-token mint/verify/revoke, and checkpoint validation
- [ ] **RTEST-02**: An integration test drives the full pipeline with the reference image: create task → runner claims → container emits checkpoints → container submits → task enters `review` → Aegis approves → `done`
- [ ] **RTEST-03**: A crash-recovery integration test deliberately kills the container mid-task, verifies worktree and `.mc/` state preservation, then confirms retry reads `.mc/progress.md` and completes
- [ ] **RTEST-04**: An E2E Playwright test verifies the recipe badge renders on task cards and the Progress tab updates live on checkpoint events

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
| NAV-01 | Phase 8 | Complete (reopened — Phase 2 shipped workspace code but no main-UI entry point; closed in Phase 8) |
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
| RECIPE-01 | Phase 12 | Pending |
| RECIPE-02 | Phase 12 | Pending |
| RECIPE-03 | Phase 12 | Pending |
| RECIPE-04 | Phase 12 | Pending |
| RECIPE-05 | Phase 12 | Pending |
| RECIPE-06 | Phase 12 | Pending |
| RECIPE-07 | Phase 12 | Pending |
| RECIPE-08 | Phase 12 | Pending |
| TCTX-01 | Phase 13 | Pending |
| TCTX-02 | Phase 13 | Pending |
| TCTX-03 | Phase 13 | Pending |
| TCTX-04 | Phase 13 | Pending |
| TCTX-05 | Phase 13 | Pending |
| TCTX-06 | Phase 13 | Pending |
| TCTX-07 | Phase 11 | Pending |
| RUNNER-01 | Phase 14 | Pending |
| RUNNER-02 | Phase 14 | Pending |
| RUNNER-03 | Phase 14 | Pending |
| RUNNER-04 | Phase 14 | Pending |
| RUNNER-05 | Phase 14 | Pending |
| RUNNER-06 | Phase 14 | Pending |
| RUNNER-07 | Phase 14 | Pending |
| RUNNER-08 | Phase 14 | Pending |
| RUNNER-09 | Phase 14 | Pending |
| RUNNER-10 | Phase 14 | Pending |
| RUNNER-11 | Phase 14 | Pending |
| RUNNER-12 | Phase 14 | Pending |
| RUNNER-13 | Phase 14 | Pending |
| RUNNER-14 | Phase 14 | Pending |
| CONTAINER-01 | Phase 14 | Pending |
| CONTAINER-02 | Phase 14 | Pending |
| CONTAINER-03 | Phase 14 | Pending |
| CONTAINER-04 | Phase 14 | Pending |
| WORK-01 | Phase 14 | Pending |
| WORK-02 | Phase 14 | Pending |
| WORK-03 | Phase 14 | Pending |
| WORK-04 | Phase 14 | Pending |
| WORK-05 | Phase 14 | Pending |
| WORK-06 | Phase 14 | Pending |
| WORK-07 | Phase 14 | Pending |
| CP-01 | Phase 15 | Pending |
| CP-02 | Phase 15 | Pending |
| CP-03 | Phase 15 | Pending |
| CP-04 | Phase 15 | Pending |
| CP-05 | Phase 15 | Pending |
| CP-06 | Phase 15 | Pending |
| RAUTH-01 | Phase 11 | Pending |
| RAUTH-02 | Phase 11 | Pending |
| RAUTH-03 | Phase 11 | Pending |
| RAUTH-04 | Phase 11 | Pending |
| RAUTH-05 | Phase 11 | Pending |
| RAUTH-06 | Phase 11 | Pending |
| MODEL-01 | Phase 11 | Pending |
| MODEL-02 | Phase 12 | Pending |
| MODEL-03 | Phase 11 | Pending |
| MODEL-04 | Phase 14 | Pending |
| RUI-01 | Phase 16 | Pending |
| RUI-02 | Phase 16 | Pending |
| RUI-03 | Phase 16 | Pending |
| RUI-04 | Phase 16 | Pending |
| RUI-05 | Phase 16 | Pending |
| RUI-06 | Phase 16 | Pending |
| SCHED-01 | Phase 15 | Pending |
| SCHED-02 | Phase 15 | Pending |
| SCHED-03 | Phase 15 | Pending |
| SCHED-04 | Phase 15 | Pending |
| SCHED-05 | Phase 15 | Pending |
| SCHED-06 | Phase 15 | Pending |
| RTEST-01 | Phase 17 | Pending |
| RTEST-02 | Phase 17 | Pending |
| RTEST-03 | Phase 17 | Pending |
| RTEST-04 | Phase 17 | Pending |

**Coverage:**
- v1 requirements: 26 total, mapped 26 / unmapped 0 ✓
- v1.1 requirements: 29 total, mapped 29 / unmapped 0 ✓
- v1.2 requirements: 72 total, mapped 72 / unmapped 0 ✓ (note: summary footer previously listed 60; actual count includes all RECIPE/TCTX/RUNNER/CONTAINER/WORK/CP/RAUTH/MODEL/RUI/SCHED/RTEST REQ-IDs)

---
*Requirements defined: 2026-04-13*
*Last updated: 2026-04-18 — v1.2 traceability table populated across Phases 11–17 (72 REQ-IDs mapped; 0 orphans)*
