# Roadmap: Project Workspace & Dashboard

## Overview

Transform projects from a task-grouping label into a first-class destination. v1.0 built the workspace itself — foundations, navigation shell, dashboard, scoped tasks/sessions/agents, settings, and entry points. v1.1 layered native GSD lifecycle support onto that workspace (Discuss → Plan → Execute → Verify → Done). Phase 10 extended that model so a single project can host multiple workstreams, milestones, phases, and plans concurrently via a hierarchical Lifecycle tab. v1.2 now adds an agent execution layer: Kanban tasks declare a recipe card, and a dedicated runner daemon launches short-lived containerized agents to execute them, with crash-safe progress checkpoints and per-task-scoped authentication.

## Milestones

**v1.0 — Project Workspace & Dashboard** (Phases 1–8): ✓ Complete
**v1.1 — Native GSD Integration** (Phases 9–10): ✓ Complete
**v1.2 — Recipe-Based Ephemeral Agent Runtime** (Phases 11–17): In progress — roadmap drafted, planning next

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

### v1.0 — Project Workspace & Dashboard
- [x] **Phase 1: Foundation** - Technical underpinnings: URL-driven state, DB indexes, component structure, i18n
- [x] **Phase 2: Navigation & Workspace Shell** - Full-takeover workspace entry point with breadcrumb navigation and sub-view routing
- [x] **Phase 3: Project Dashboard** - Dashboard with status overview, progress, project brief, activity feed, and real-time updates
- [x] **Phase 4: Project Tasks** - Scoped task list with create, reassign, and full board functionality within the workspace
- [x] **Phase 5: Sessions & Agents** - Scoped session and agent views with detail access from within the project context
- [x] **Phase 6: Settings** - Project settings panel for name, description, status, color, prefix, deadline, and GitHub repo
- [x] **Phase 7: Post-Audit Gap Closure** - Resolve FLOW-E archive visibility decision + project-context loading-timeout escape hatch
- [x] **Phase 8: Projects Entry Point** - Wire the main-UI path INTO the project workspace (nav-rail item, projects list panel, deep-link from existing project pickers)

### v1.1 — Native GSD Integration
- [x] **Phase 9: GSD Native Integration** - First-class lifecycle tracking inside MC: schema extensions, three new APIs (bootstrap / transition / gate), gate-required task enforcement, dedicated Lifecycle tab + task-board phase badges, external JSON template system
- [x] **Phase 10: Hierarchical Lifecycle Graph** - Multiple concurrent workstreams/milestones/phases/plans per project, Lifecycle tab reads hierarchical graph with legacy fallback, CLI wrappers, same-wave conflict detection

### v1.2 — Recipe-Based Ephemeral Agent Runtime
- [x] **Phase 11: Runtime Foundation** - DB migrations (recipes, task_runner_tokens, task_checkpoints, task column additions), model registry module, runner + runner-token auth principals (completed 2026-04-19)
- [x] **Phase 12: Recipe System** - `recipes/<slug>/` filesystem layout, chokidar indexer with dir_sha dedup, recipe CRUD + search API, admin resync, model-registry validation at index time (completed 2026-04-19)
- [x] **Phase 13: Task Runtime Context** - Task-level fields (recipe_slug, workspace_source, read_only_mounts, extra_skills, model_override), mount allowlist validation at task creation, create/update API plumbing
- [ ] **Phase 14: Runner Daemon & Container Execution** - Standalone `scripts/mc-runner.mjs` daemon, register/heartbeat/claim/exit protocol, docker run with mounts + env, git worktree lifecycle with `.mc/` seeding and resume preamble, retry cap, GC, reference `mc-hello-world-agent` image
- [ ] **Phase 15: Checkpoints & Scheduler Integration** - Checkpoint API with dual DB + `.mc/checkpoints.jsonl` storage, blocked→awaiting_owner flow, scheduler hooks (autoRouteInboxTasks, dispatchAssignedTasks bypass, requeueStaleTasks, reconcileRunnerHeartbeat), runtime SSE event broadcast
- [ ] **Phase 16: Runtime UI Surfaces** - Recipe badge + model tier on task cards, runner-status banner, Progress tab on task detail, Recipe dropdown + Advanced section on task form, minimal recipes list panel, atomic 10-locale i18n
- [ ] **Phase 17: Integration Testing & Reference Pipeline** - Unit tests (indexer, allowlist, tokens, checkpoints), full-pipeline integration test using reference image, crash-recovery integration test, E2E Playwright coverage

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
**Gap Closure**: Closes the Phase 2 discovery gap surfaced during v1.0 human verification — workspace code existed but no main-UI call site ever navigated to `/project/{slug}`. Plans 08-04 and 08-05 close the two UAT-diagnosed gaps (header CTA + upgraded create-project modal with GitHub linking at creation)
**Success Criteria** (what must be TRUE):
  1. A "Projects" item is visible in the nav-rail OPERATE group (order: near Tasks); clicking it renders a Projects list panel, not the project workspace itself
  2. The Projects list panel shows one entry per active project with name, status badge, ticket prefix, and either a deadline or a last-activity hint; clicking an entry navigates to `/project/{slug}` (the workspace dashboard, per existing router)
  3. All pre-existing project-name pickers and dropdowns in the main UI (task board filter, overview, create-task modal) expose a clear path into the workspace — either a "Open workspace" action on the selected project, or clicking the picker's resolved project name routes to its workspace
  4. Cold-start journey: from a fresh login at `/`, a user can reach a project's dashboard with clicks alone (no URL editing) and return to the main view via the existing breadcrumb "Projects" link (which should route to the new Projects panel, not to `/`)
  5. The Projects list panel uses i18n via `next-intl` across all 10 locales atomically (follow phase 6 precedent)
  6. Unit tests cover: nav-rail renders the new item; Projects list panel renders project cards from Zustand `projects[]` and navigates on click; breadcrumb "Projects" segment routes to the Projects panel (not `/`)
  7. Users can create a new project from the Projects panel header CTA (not only from the empty state) — UAT Gap 1 closure
  8. Create-project modal supports github_repo, deadline, color, and one-click GitHub sync + label initialization at creation time — UAT Gap 2 closure
**Plans:** 6 plans
Plans:
- [x] 08-00-PLAN.md — Backend + store: extend GET /api/projects with last_activity_at; extend Project interface; unit test
- [x] 08-01-PLAN.md — i18n (10 locales) + nav-rail Projects item + ContentRouter + ProjectsPanel (row list + empty-state CTA) + unit tests
- [x] 08-02-PLAN.md — Breadcrumb re-target to /projects + "↗ Open workspace" picker button on task-board filter + unit tests
- [x] 08-03-PLAN.md — Playwright E2E covering the NAV-01 cold-start journey
- [x] 08-04-PLAN.md — Gap closure: header "New project" CTA on ProjectsPanel + atomic 10-locale i18n + test coverage (UAT Gap 1)
- [x] 08-05-PLAN.md — Gap closure: upgrade create-project modal with github_repo/deadline/color + init-labels chain + graceful failure + new test suite (UAT Gap 2)
**UI hint**: yes

### Phase 9: GSD Native Integration  *(v1.1)*
**Goal**: Build first-class GSD lifecycle (Discuss → Plan → Execute → Verify → Done) into Mission Control so projects can be tracked through phases, bootstrap default task packs, and enforce gate approval on critical tasks — all without reaching for the CLI
**Depends on**: Phase 8
**Requirements**: GSD-01..29 (29 requirements — schema, API, gate enforcement, templates, Lifecycle tab, task-board badges, settings section, events, i18n)
**Success Criteria** (what must be TRUE):
  1. A new GSD-enabled project can be created with `gsd_enabled=1`, `gsd_track` set, and appear on GET with all GSD fields populated
  2. `POST /api/projects/:id/gsd/bootstrap` creates the default phase tasks exactly once (idempotent) and is sourced from external JSON templates at `$DATA_DIR/gsd-templates/` with a bundled fallback if no file exists
  3. `POST /api/projects/:id/gsd/transition` enforces lifecycle ordering (discuss → plan → execute → verify → done) and rejects illegal jumps with HTTP 409 and machine-readable error code
  4. `PATCH /api/tasks/:id/gate` flips gate_status to approved or rejected and records approver + timestamp; gate-required tasks with status != approved cannot move to in_progress/done (403)
  5. All three endpoints enforce operator+admin role via existing `requireRole`; viewers can read but not mutate gate state
  6. Project workspace renders a dedicated "Lifecycle" tab at `/[slug]/lifecycle` with current-phase callout, phase timeline, bootstrap button, transition controls, and gate approval list; non-GSD projects see an empty state with "Enable GSD" CTA
  7. Task board (global and project-scoped) renders per-task phase badges when `gsd_phase` is set; gate-required tasks show an "Approval required" badge
  8. Project settings view includes a GSD section with `gsd_enabled` toggle, `gsd_track` dropdown, and `gsd_gate_mode` selector; track and gate-mode controls disabled until GSD enabled
  9. Transitions and gate changes emit events via existing `eventBus`; `/api/activities` stream surfaces them automatically
  10. All new user-facing strings live under `project.lifecycle.*` with atomic coverage across all 10 locales
  11. Migration is additive and runs cleanly on existing production DBs; non-GSD projects behave identically to v1.0
  12. Test suite covers: project CRUD with GSD fields, bootstrap idempotency, illegal transition rejection, gate-block on task status, gate-approval unblocks, role enforcement on new endpoints
**Plans:** 11 plans
**UI hint**: yes

### Phase 10: Hierarchical Lifecycle Graph  *(v1.1)*
**Goal**: Projects can host multiple concurrent workstreams, milestones, phases, and plans with dependency-aware advancement, surfaced through an interactive Lifecycle tab and CLI wrappers
**Depends on**: Phase 9
**Requirements**: Phase-10 hierarchy extensions tracked in PROJECT.md (workstreams, milestones, phases, plans, wave conflicts)
**Success Criteria** (what must be TRUE):
  1. One project hosts multiple workstreams and multiple active milestones concurrently
  2. Milestones contain ordered phases with dependency-checked transitions; phases contain plan waves with plan dependency checks
  3. Lifecycle tab reads a hierarchical `/api/projects/:id/gsd/lifecycle-graph` with legacy fallback and live-refreshes via project-scoped `gsd.*` SSE events
  4. Operators can inline-create/edit/complete/transition hierarchy entities from the Lifecycle tab with optimistic-locking (`expected_updated_at`) race guards
  5. Same-wave conflicts are counted in `rollups.wave_conflicts` and block `plan → in_progress` transitions
  6. CLI wrappers exist for workstreams, milestones, phases, plans, and lifecycle-graph reads
**UI hint**: yes

### Phase 11: Runtime Foundation  *(v1.2)*
**Goal**: The database schema, model registry, and auth principals that every later v1.2 phase depends on are in place — no runtime code yet, just the substrate
**Depends on**: Phase 10
**Requirements**: TCTX-07, RAUTH-01, RAUTH-02, RAUTH-03, RAUTH-04, RAUTH-05, RAUTH-06, MODEL-01, MODEL-03
**Success Criteria** (what must be TRUE):
  1. A fresh DB and an existing production DB both migrate cleanly to include the `recipes`, `task_runner_tokens`, and `task_checkpoints` tables plus the additive `tasks` columns (`recipe_slug`, workspace / mounts / skills JSON, `model_override`, `container_id`, `runner_started_at`, `runner_exit_code`, `worktree_path`, `runner_attempts`, `runner_max_attempts`, `runner_last_failure_reason`)
  2. A developer can import `src/lib/model-registry.ts` and look up Opus 4.7, Sonnet 4.6, and Haiku 4.5 by identifier and get typed `{provider, context_window, output_tokens_max, supports_tools, supports_thinking}` back; unknown identifiers return null / a typed error
  3. Creating a task with `model_override` set to an unknown model is rejected with a clear validation error referencing the registry
  4. A request presenting `.data/runner.secret` authenticates as the `runner` principal and only resolves on `/api/runner/*` routes; other paths reject
  5. A request presenting a valid per-task, per-attempt bearer token authenticates as `runner-token`, and handlers that opt in verify the path `:id` matches the token's `task_id` (cross-task access blocked); tokens are SHA-256 hashed at rest and carry an expiry of `runner_started_at + recipe.timeout_seconds + 60s`
  6. When a task reaches a terminal status the associated runner token row is marked `revoked_at` and subsequent presentations are rejected
**Plans:** 4/4 plans complete
Plans:
- [x] 11-01-PLAN.md — Model registry module (MODEL-01) + task model_override validation (MODEL-03)
- [x] 11-02-PLAN.md — Auto-generated .data/runner.secret + runner principal in auth.ts scoped to /api/runner/* (RAUTH-01)
- [x] 11-03-PLAN.md — Additive v1.2 migrations (recipes, task_runner_tokens, task_checkpoints, 11 new task columns) (TCTX-07)
- [ ] 11-04-PLAN.md — Runner-token principal with RAUTH-06 allowlist + cross-task guard + atomic terminal-status revocation (RAUTH-02..06)
**UI hint**: no

### Phase 12: Recipe System  *(v1.2)*
**Goal**: Recipes exist as filesystem-authored directories under `recipes/<slug>/`, are indexed into the DB via a chokidar watcher with content-hash dedup, and can be listed, fetched, searched, created, and resynced through the API
**Depends on**: Phase 11
**Requirements**: RECIPE-01, RECIPE-02, RECIPE-03, RECIPE-04, RECIPE-05, RECIPE-06, RECIPE-07, RECIPE-08, MODEL-02
**Success Criteria** (what must be TRUE):
  1. A recipe author can drop a directory at `recipes/<slug>/` with `recipe.yaml` + `SOUL.md` (plus optional `tools/`, `skills/`, `README.md`) and within seconds see a matching row appear in the `recipes` table with slug, name, description, when_to_use, image, workspace_mode, timeout_seconds, max_concurrent, env/secrets/tags/model JSON, version, and `dir_sha`
  2. Editing, renaming, or deleting files under `recipes/` causes the watcher to re-index (or drop) only the affected rows; unchanged recipes are skipped via `dir_sha` equality
  3. `GET /api/recipes`, `GET /api/recipes/:slug`, and `GET /api/recipes/search?q=...` return recipe metadata and SOUL.md body, with search ranking candidates against task description + tags using SQL matching
  4. `POST /api/recipes` (called by Hermes or an operator) writes the recipe files to disk and indexes the row atomically; the recipe appears in subsequent list/search responses
  5. An admin can `POST /api/recipes/resync` to force a full re-scan of `recipes/` when the watcher falls behind
  6. A recipe whose `model.primary` is not in the model registry fails to index with a human-readable error surfaced both in the indexer log and through the recipe API / UI fetch
**Plans:** 4/4 plans complete
Plans:
- [x] 12-01-PLAN.md — Additive migrations (058 error_message col + 059 recipes_fts5 virtual table) + recipe.yaml Zod schema + TypeScript types (RECIPE-02, RECIPE-04, RECIPE-08)
- [x] 12-02-PLAN.md — Recipe indexer module (parse + dir_sha + UPSERT valid-or-error row) + deterministic recipe-hash (RECIPE-01, RECIPE-02, RECIPE-04, MODEL-02)
- [x] 12-03-PLAN.md — Chokidar watcher + eager boot scanner + synchronous resyncRecipes function (RECIPE-03, RECIPE-07)
- [ ] 12-04-PLAN.md — REST endpoints (GET list / GET :slug / GET search with FTS5 BM25 tag-weighted 2x / POST create atomic disk+index / POST /resync admin) + boot wiring in db.ts (RECIPE-05, RECIPE-06, RECIPE-07, RECIPE-08)
**UI hint**: no (API + backend; recipe list panel ships in Phase 16)

### Phase 13: Task Runtime Context  *(v1.2)*
**Goal**: A task can reference a recipe and declare the runtime specifics the runner will need — workspace source, read-only mounts, extra skills, model override — with mount-allowlist validation enforced at task creation
**Depends on**: Phase 12
**Requirements**: TCTX-01, TCTX-02, TCTX-03, TCTX-04, TCTX-05, TCTX-06
**Success Criteria** (what must be TRUE):
  1. Creating or updating a task with `recipe_slug` pointing at an indexed recipe succeeds and the task record persists the reference; pointing at a missing recipe fails with a clear error
  2. When the referenced recipe declares `workspace: worktree`, the task must carry `workspace_source = { project_id, base_ref }`; tasks missing this are rejected at creation time
  3. A task can carry zero or more `read_only_mounts` entries (`{ host_path, container_path, label }`), zero or more `extra_skills` host paths, and an optional `model_override`, and all three round-trip through the task read API
  4. Any `host_path` on a task (read_only_mount or extra_skill) that falls outside the runner's `mount_allowlist` is rejected at task creation with an actionable error referencing the offending path
  5. A `model_override` that is not in the model registry is rejected with a clear error
**Plans:** 3/3 plans executed
Plans:
- [x] 13-01-PLAN.md — Shared substrate: runtime.* settings definitions + task-runtime-settings.ts getters + task-runtime-validation.ts (Zod schemas, allowlist resolver with fs.realpath parent-walk, aggregated-error builder, zodErrorToIssues) (TCTX-03, TCTX-04, TCTX-06)
- [x] 13-02-PLAN.md — POST /api/tasks extension: createTaskSchema + manual safeParse → aggregated errors, recipe lookup (getIndexedRecipeBySlug), workspace_source gating, allowlist + caps enforcement, INSERT column extension, mapTaskRow round-trip (TCTX-01..06)
- [x] 13-03-PLAN.md — PATCH /api/tasks/[id] extension: updateTaskSchema + manual safeParse, pre-dispatch-only recipe_slug mutability (RECIPE_LOCKED), atomic workspace_source gap rejection, preserve-and-revalidate, mapTaskRow symmetry, RAUTH-05 revocation preserved (TCTX-01..06)
**UI hint**: no (UI form updates ship in Phase 16)

### Phase 14: Runner Daemon & Container Execution  *(v1.2)*
**Goal**: A standalone runner process can claim recipe-tagged tasks, launch short-lived containers against a per-task git worktree, monitor exit, and safely preserve state across crashes so a retry resumes without redoing work
**Depends on**: Phase 13
**Requirements**: RUNNER-01, RUNNER-02, RUNNER-03, RUNNER-04, RUNNER-05, RUNNER-06, RUNNER-07, RUNNER-08, RUNNER-09, RUNNER-10, RUNNER-11, RUNNER-12, RUNNER-13, RUNNER-14, CONTAINER-01, CONTAINER-02, CONTAINER-03, CONTAINER-04, WORK-01, WORK-02, WORK-03, WORK-04, WORK-05, WORK-06, WORK-07, MODEL-04
**Success Criteria** (what must be TRUE):
  1. An operator can launch `scripts/mc-runner.mjs` from the supplied LaunchAgent template and it registers with MC using the shared `.data/runner.secret`, begins sending 10-second heartbeats, and subscribes to `task.runner_requested` SSE events with a 15-second poll fallback; MC flips the runner-online indicator based on heartbeat freshness (offline after 60s silence)
  2. When a recipe-tagged task becomes `assigned`, the runner atomically claims it, receives a dispatch payload with recipe content + fresh per-task runner-token, re-validates every mount against the allowlist with symlink resolution, and enforces global (`MAX_CONCURRENT_CONTAINERS`) + per-recipe (`max_concurrent`) concurrency caps; over-cap claims 409 and leave the task for the next cycle
  3. For `workspace: worktree` recipes, the runner creates or reuses a git worktree at `.data/runner/worktrees/task-<id>/`, seeds `.mc/task.json` (with `task_id`, `recipe_slug`, `attempt`, `is_resuming`, `prior_attempts[]`), `.mc/progress.md`, `.mc/checkpoints.jsonl`, and `.mc/.gitignore`, and records `worktree_path` on the task
  4. The runner launches the container via `docker run --rm -d` with the documented mount layout (`/workspace`, `/recipe`, `/refs/<label>/`, `/skills/<name>`), env vars (`MC_API_URL`, `MC_TASK_ID`, `MC_API_TOKEN`, `MC_WORKSPACE`, `MC_RECIPE_PATH`, `MC_MODEL_PRIMARY`, `MC_MODEL_FALLBACK`, `MC_MODEL_PROVIDER`, `MC_MODEL_PARAMS_JSON`) and recipe-declared secrets from the runner store; `MC_MODEL_PRIMARY` resolves as `task.model_override ?? recipe.model.primary` at claim time
  5. On first attempt, the runner injects a short preamble above SOUL.md instructing the agent to write notes to `.mc/progress.md`; on a resume attempt, it injects a longer preamble instructing the agent to read `.mc/progress.md` + `.mc/checkpoints.jsonl`, inspect git state, and continue without redoing work
  6. The container is hard-killed at `recipe.timeout_seconds` and the runner reports `reason='timeout'`; stdout/stderr stream to `.data/runner/logs/task-<id>/attempt-<n>/`; on non-zero exit or timeout the runner posts `runner-exit` and MC drives retry/fail with `runner_max_attempts` (default 3, recipe-overridable) — exceeding the cap marks the task `failed` with a clear reason
  7. Worktrees are preserved across container crashes and retries and destroyed only when a task reaches `done`, `cancelled`, or (after a GC window of N days, default 7) `failed`; a scheduled GC job prunes worktrees for long-terminal tasks
  8. After a runner crash, starting the runner reconciles live Docker containers (`mc-task-*`) against `GET /api/runner/pending-containers` and either adopts or cleans them up; when a task reaches terminal status, the runner revokes its token and destroys the worktree (subject to the failure GC window)
  9. The bundled `mc-hello-world-agent` reference image exercises the full container flow — reads `/recipe`, emits checkpoints, submits a resolution — proving the runtime is end-to-end wired
**Plans:** 7/12 plans executed
Plans:
- [x] 14-01-PLAN.md — Migrations 060 (runner_heartbeats) + 061 (task_runner_attempts) + tests (RUNNER-05, WORK-02)
- [x] 14-02-PLAN.md — 5 runtime.* settings + recipe-schema max_attempts + typed getters + tests (RUNNER-08, WORK-06, RUNNER-09)
- [x] 14-03-PLAN.md — Wave 0 test scaffolds (11 files, ≥60 it.todo stubs)
- [x] 14-04-PLAN.md — heartbeat + ready-tasks + pending-containers + terminal-tasks routes (RUNNER-04, RUNNER-05, RUNNER-13, WORK-07)
- [ ] 14-05-PLAN.md — POST /api/runner/claim/[task_id] atomic claim with allowlist + caps + token mint + dispatch payload (RUNNER-06..08, MODEL-04)
- [ ] 14-06-PLAN.md — POST /api/runner/tasks/[task_id]/runner-exit retry/fail driver (RUNNER-11, WORK-06)
- [ ] 14-07-PLAN.md — runner-preamble + runner-worktree + runner-docker pure-logic lib modules + tests (WORK-01, 02, 04, 05; CONTAINER-01, 02; RUNNER-09, 10)
- [x] 14-08a-PLAN.md — runner-gc + runner-reconcile + runner-timeout + runner-log-layout pure-logic helpers + tests (RUNNER-12, 13, 14, CONTAINER-03, WORK-07)
- [ ] 14-08b-PLAN.md — scripts/mc-runner.mjs daemon + LaunchAgent + README (RUNNER-01..14, CONTAINER-03, WORK-03, 06, 07, MODEL-04)
- [ ] 14-09-PLAN.md — docker/hello-world-agent reference image calling /submit endpoint (CONTAINER-04)
- [ ] 14-10-PLAN.md — recipes/hello-world/ + smoke harness + human-verify end-to-end checkpoint (CONTAINER-04, RUNNER-09..11, WORK-01..03, MODEL-04)
- [x] 14-11-PLAN.md — submit + container-started + /api/runner/config routes (RUNNER-06, 11, 13, WORK-06)
**UI hint**: no (runner status banner ships in Phase 16)

### Phase 15: Checkpoints & Scheduler Integration  *(v1.2)*
**Goal**: Agents can post checkpoints that persist to both the DB and the worktree journal, blockers flip the task to `awaiting_owner` and stop the container gracefully, and the MC scheduler treats recipe-tagged tasks correctly across the inbox → assigned → in_progress → review pipeline
**Depends on**: Phase 14
**Requirements**: CP-01, CP-02, CP-03, CP-04, CP-05, CP-06, SCHED-01, SCHED-02, SCHED-03, SCHED-04, SCHED-05, SCHED-06
**Success Criteria** (what must be TRUE):
  1. An agent authenticated with a runner-token can `POST /api/tasks/:id/checkpoints` with `step`, `summary`, `status` (`completed` / `in_progress` / `blocked`) plus optional `artifacts` (typed `kind: file | url | diff | test_result | comment | other`), `next_step`, `blocker_reason`, `tokens_used`, `duration_ms`; each checkpoint lands both as a `task_checkpoints` row AND as one JSON line appended to `<worktree>/.mc/checkpoints.jsonl` with identical field names
  2. A `status: blocked` checkpoint transitions the task `in_progress → awaiting_owner`, posts an automatic comment with `blocker_reason`, and causes the runner to gracefully stop the container while preserving the worktree; when the blocker is resolved and the task returns to `assigned`, the runner relaunches with the resume flow
  3. A viewer can `GET /api/tasks/:id/checkpoints?attempt=N` and receive the full timeline, filterable by attempt
  4. `autoRouteInboxTasks()` moves recipe-tagged tasks from `inbox → assigned` without running agent-affinity scoring; `dispatchAssignedTasks()` skips tasks with `recipe_slug` so legacy behavior is preserved for non-recipe tasks; `requeueStaleTasks()` detects stuck recipe-tagged tasks by checking runner heartbeat and container liveness in addition to legacy logic
  5. A new `reconcileRunnerHeartbeat()` scheduler task (every 30s) marks `in_progress` recipe-tasks stale when the runner has been unreachable beyond the threshold, so reconcile-on-reconnect works cleanly
  6. `task.runner_requested` fires from all three emission points (`autoRouteInboxTasks` on `inbox → assigned`, `POST /api/tasks` on direct-assigned creation with `recipe_slug`, the runner-exit retry path on `in_progress → assigned`), and `recipe.indexed`, `recipe.removed`, `task.container_started`, `task.container_exited`, and `task.checkpoint_added` are broadcast on SSE for UI reactivity
**Plans:** 4 plans
Plans:
- [ ] 11-01-PLAN.md — Model registry module (MODEL-01) + task model_override validation (MODEL-03)
- [x] 11-02-PLAN.md — Auto-generated .data/runner.secret + runner principal in auth.ts scoped to /api/runner/* (RAUTH-01)
- [ ] 11-03-PLAN.md — Additive v1.2 migrations (recipes, task_runner_tokens, task_checkpoints, 11 new task columns) (TCTX-07)
- [ ] 11-04-PLAN.md — Runner-token principal with RAUTH-06 allowlist + cross-task guard + atomic terminal-status revocation (RAUTH-02..06)
**UI hint**: no (UI listeners ship in Phase 16)

### Phase 16: Runtime UI Surfaces  *(v1.2)*
**Goal**: Operators can see recipes and runner state in Mission Control's UI — a recipe badge per task card, a live runner-status banner, a checkpoint-timeline Progress tab on task detail, a Recipe dropdown + Advanced section on the task form, and a minimal recipes list panel — all localized across 10 locales
**Depends on**: Phase 15
**Requirements**: RUI-01, RUI-02, RUI-03, RUI-04, RUI-05, RUI-06
**Success Criteria** (what must be TRUE):
  1. Every task card on the Kanban displays a recipe badge (recipe name + model-tier color) when `recipe_slug` is set; cards without a recipe look identical to today
  2. The task-board shell shows a live runner-status banner that flips between "Runner online" and "Runner offline — tasks waiting: N" in real time based on heartbeat SSE events
  3. The task detail view has a "Progress" tab that renders a live checkpoint timeline grouped by attempt and updates via `task.checkpoint_added` SSE without a page reload
  4. The task create/edit form exposes a Recipe dropdown backed by `/api/recipes/search` autocomplete and a collapsible "Advanced" section for editing `read_only_mounts`, `extra_skills`, and `model_override`
  5. A minimal Recipes panel (reachable from the main nav) lists indexed recipes with name, description, model, tags, and a "Resync" button — authoring stays filesystem-first
  6. All new UI strings ship atomically across en/es/fr/de/ja/ko/pt/ru/zh/ar
**Plans:** 4 plans
Plans:
- [ ] 11-01-PLAN.md — Model registry module (MODEL-01) + task model_override validation (MODEL-03)
- [x] 11-02-PLAN.md — Auto-generated .data/runner.secret + runner principal in auth.ts scoped to /api/runner/* (RAUTH-01)
- [ ] 11-03-PLAN.md — Additive v1.2 migrations (recipes, task_runner_tokens, task_checkpoints, 11 new task columns) (TCTX-07)
- [ ] 11-04-PLAN.md — Runner-token principal with RAUTH-06 allowlist + cross-task guard + atomic terminal-status revocation (RAUTH-02..06)
**UI hint**: yes

### Phase 17: Integration Testing & Reference Pipeline  *(v1.2)*
**Goal**: The runtime ships with end-to-end confidence — unit tests on the sharp-edged pieces, a full integration test driving a real container through the pipeline with the reference image, a crash-recovery test proving `.mc/` persistence works, and a Playwright E2E proving the UI surfaces update live
**Depends on**: Phase 16
**Requirements**: RTEST-01, RTEST-02, RTEST-03, RTEST-04
**Success Criteria** (what must be TRUE):
  1. Unit tests cover recipe-indexer parsing (including malformed YAML and unknown-model rejection), mount-allowlist resolution (including symlink escape attempts), runner-token mint/verify/revoke (including cross-task rejection and expiry), and checkpoint validation (including blocked-without-reason rejection)
  2. An integration test drives the full pipeline with the `mc-hello-world-agent` reference image end to end: create a task with `recipe_slug`, runner claims, container starts, emits checkpoints, submits, task enters `review`, Aegis approves, task reaches `done`
  3. A crash-recovery integration test deliberately kills the container mid-task, asserts the worktree and `.mc/` state are preserved, then confirms the retry attempt reads `.mc/progress.md` + `.mc/checkpoints.jsonl` and completes without redoing prior work
  4. An E2E Playwright test verifies the recipe badge renders on task cards and the Progress tab updates live when a checkpoint event fires
**Plans:** 4 plans
Plans:
- [ ] 11-01-PLAN.md — Model registry module (MODEL-01) + task model_override validation (MODEL-03)
- [x] 11-02-PLAN.md — Auto-generated .data/runner.secret + runner principal in auth.ts scoped to /api/runner/* (RAUTH-01)
- [ ] 11-03-PLAN.md — Additive v1.2 migrations (recipes, task_runner_tokens, task_checkpoints, 11 new task columns) (TCTX-07)
- [ ] 11-04-PLAN.md — Runner-token principal with RAUTH-06 allowlist + cross-task guard + atomic terminal-status revocation (RAUTH-02..06)
**UI hint**: no (test coverage only — no new UI surface)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete | 2026-04-13 |
| 2. Navigation & Workspace Shell | 2/2 | Complete | 2026-04-13 |
| 3. Project Dashboard | 3/3 | Complete | 2026-04-13 |
| 4. Project Tasks | 2/2 | Complete | 2026-04-13 |
| 5. Sessions & Agents | 4/4 | Complete | 2026-04-13 |
| 6. Settings | 2/2 | Complete | 2026-04-14 |
| 7. Post-Audit Gap Closure | 2/2 | Complete | 2026-04-14 |
| 8. Projects Entry Point | 6/6 | Complete | 2026-04-14 |
| 9. GSD Native Integration *(v1.1)* | 11/11 | Complete | 2026-04-15 |
| 10. Hierarchical Lifecycle Graph *(v1.1)* | — | Complete | 2026-04-15 |
| 11. Runtime Foundation *(v1.2)* | 4/4 | Complete    | 2026-04-19 |
| 12. Recipe System *(v1.2)* | 4/4 | Complete    | 2026-04-19 |
| 13. Task Runtime Context *(v1.2)* | 3/3 | Complete    | 2026-04-20 |
| 14. Runner Daemon & Container Execution *(v1.2)* | 7/12 | In Progress|  |
| 15. Checkpoints & Scheduler Integration *(v1.2)* | 0/— | Not started | - |
| 16. Runtime UI Surfaces *(v1.2)* | 0/— | Not started | - |
| 17. Integration Testing & Reference Pipeline *(v1.2)* | 0/— | Not started | - |
