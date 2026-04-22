# Project Workspace & Dashboard

## What This Is

A full-takeover project workspace for Mission Control that elevates projects from a task-grouping label into a first-class destination. Users navigate into a project and get a dedicated dashboard with status overview, activity feed, and project brief — plus scoped views for tasks, agent sessions, agents, and settings. Breadcrumb navigation moves between projects and back to the main view.

v1.1 extends this workspace with native GSD lifecycle support: projects can be flagged `gsd_enabled`, move through Discuss → Plan → Execute → Verify → Done phases, and gate critical tasks behind operator/admin approval. Phase 10 extends that model again: a single project can now host multiple workstreams, milestones, phases, and plans concurrently, with the Lifecycle tab acting as the primary operator surface over the hierarchical graph.

v1.2 adds an agent execution layer: Kanban tasks can declare a **recipe card** (a markdown-plus-YAML bundle describing an agent's persona, tools, skills, container image, and model), and a dedicated runner daemon launches short-lived containers to execute those tasks. Work state lives in a per-task git worktree with a `.mc/` progress convention so crashed containers can resume without redoing work.

## Core Value

When I click into a project, I see everything about that project — what it is, what's happening, what's next — and I can manage all its work from one place, including driving it through its GSD lifecycle, and autonomous agents pick up assigned work, execute it in isolated containers, and move it through the Kanban for me.

## Current State

**Shipped through v1.2** (2026-04-21) — v1.0 Project Workspace & Dashboard, v1.1 Native GSD Integration, and v1.2 Recipe-Based Ephemeral Agent Runtime all complete. The app is a full-featured project workspace with native GSD lifecycle tracking and a shippable recipe-based container runtime; operators can author recipe cards, land Kanban tasks into a runner daemon, watch them execute in short-lived containers with crash-safe checkpointing, and review them through the existing Aegis loop. Operator manual lives at `docs/runtime/INDEX.md`; drift harness at `scripts/verify-runtime-docs.mjs`.

**v1.3 in flight** — Phase 20 (Lane-Aware Routing & Unified Blocker Contract) complete 2026-04-22, closing M1 and M2 of the autonomous-routing parity block: legacy `autoRouteInboxTasks` is now lane-aware with reason-metadata broadcasts, and both recipe + legacy paths emit a common `task.blocker_transition` event with a stable 10-key payload around structured pause/resume envelopes.

## Current Milestone: v1.3 Autonomous-Routing Parity

**Goal:** Close the autonomous-routing gap identified in `.planning/GSD_PARITY_DIFF_vs_gsd-lawyerinc_2026-04-21.md` — v1.2 shipped ~75–80% of baseline autonomous-routing intent; v1.3 delivers the missing deterministic "automatic unless blocker" loop across every task type.

**Target scope (parity block — P0 + P1 + P2):**

**P0 — the missing `hierarchy transition → queue activation → project-scoped claiming → blocker pause/resume` bridge:**
- Project-scoped queue filtering (`project_id`, `gsd_plan_id`, `wave`) applied to current-in-progress lookup, capacity checks, and the atomic claim subquery
- Plan `in_progress` transition activates linked execution tasks (`gsd_plan_id=planId`) into `inbox`/`assigned` based on assignee, emitting `gsd.plan.tasks_activated`
- Lane-aware default auto-routing — `autoRouteInboxTasks()` prefers inbox tasks linked to active plans; unscoped legacy fallback only when no lane work eligible; recipe fast-path preserved
- Unified blocker transition contract across legacy + recipe paths — structured `in_progress → awaiting_owner` with `blocker_reason`, `blocker_kind`, `resume_hint`; deterministic owner-resume; common events

**P1 — agent surface + doc drift:**
- MCP `mc_create_task` / `mc_update_task` parity for routing fields (`project_id`, `gsd_workstream_id`, `gsd_milestone_id`, `gsd_phase_id`, `gsd_plan_id`, `gate_required`, `gate_status`, `status`, `metadata`)
- Reconcile `docs/GSD-MODEL-COMPARISON.md` internal contradictions (rows 51–52 vs later "closed" claims); keep `node scripts/verify-runtime-docs.mjs` green

**P2 — hardening:**
- Replace high-value `it.todo` placeholders with executable tests (queue + lifecycle first): `src/components/project/__tests__/dashboard-view.test.tsx`, `src/lib/__tests__/project-{breadcrumb,tabs,workspace}.test.ts`, plus queue + transition integration tests

**M4 umbrella acceptance:** single deterministic "automatic unless blocker" loop across every task type — explicit acceptance test covering hierarchy transition → queue activation → project-scoped claiming → blocker pause/resume round-trip.

**Next:** Run `/gsd:plan-phase 19` once REQUIREMENTS.md and ROADMAP.md are finalized.

## Requirements

### Validated

**Pre-v1.0 baseline:**
- ✓ Projects exist as an entity with name, description, status — existing
- ✓ Tasks can be assigned to projects — existing
- ✓ Task board and task management UI — existing
- ✓ Agent and session management — existing
- ✓ Chat interface for agent sessions — existing
- ✓ Panel-based navigation with Zustand state — existing
- ✓ SSE real-time updates for data changes — existing
- ✓ REST API for all CRUD operations — existing

**v1.2 — Recipe-Based Ephemeral Agent Runtime (shipped 2026-04-21):**
- ✓ Filesystem-first recipe cards at `recipes/<slug>/` indexed via chokidar watcher — v1.2 Phase 12
- ✓ Recipe schema (container image, workspace mode, timeout, concurrency, env, secrets, tags, model) with Zod validation — v1.2 Phase 12
- ✓ Task schema extensions (`recipe_slug`, `workspace_source`, `read_only_mounts`, `extra_skills`, `model_override`) — v1.2 Phase 13
- ✓ `task_runner_tokens` per-task per-attempt ephemeral bearer tokens — v1.2 Phase 11
- ✓ `task_checkpoints` table + dual-write to `.mc/checkpoints.jsonl` — v1.2 Phase 15
- ✓ `scripts/mc-runner.mjs` daemon with LaunchAgent, claim-based dispatch, docker run, heartbeat, crash recovery — v1.2 Phase 14
- ✓ `.mc/` worktree convention (task.json, progress.md, checkpoints.jsonl) with resume preamble — v1.2 Phase 14
- ✓ Mount allowlist enforced at task creation + at runner claim — v1.2 Phases 13, 14
- ✓ `runner` + `runner-token` auth principals — v1.2 Phase 11
- ✓ Recipe CRUD + SQL-LIKE search API; runner protocol API — v1.2 Phase 12, Phase 14
- ✓ Model registry (`src/lib/model-registry.ts`) validates recipes at index time — v1.2 Phase 11
- ✓ Recipe badge + model tier + RunnerStatusBanner + Progress tab + Recipe/Advanced dropdowns + Recipes panel — v1.2 Phase 16
- ✓ Reference `mc-hello-world-agent` image wired through full flow — v1.2 Phase 14
- ✓ Scheduler integration (`autoRouteInboxTasks`, `dispatchAssignedTasks` bypass, `requeueStaleTasks`, `reconcileRunnerHeartbeat`) — v1.2 Phase 15
- ✓ Submit→review two-hop lifecycle (agent submits → review → Aegis flips → done) — v1.2 Phase 17-01
- ✓ Integration pipeline: unit + daemon-subprocess integration + crash-recovery + Playwright E2E — v1.2 Phase 17
- ✓ Operator manual under `docs/runtime/` (6 surface docs + INDEX + drift harness) — v1.2 Phase 18.1

### Active

- [x] URL-driven project workspace routing (no Zustand dependency) — Validated in Phase 1: Foundation
- [x] Component architecture for project workspace (dedicated directory, multi-file) — Validated in Phase 1: Foundation
- [x] Database composite indexes for project-scoped queries — Validated in Phase 1: Foundation
- [x] i18n namespace for project workspace UI strings — Validated in Phase 1: Foundation
- [x] Full-takeover project workspace view when navigating into a project — Validated in Phase 2: Navigation
- [x] Breadcrumb navigation (Projects > Project Name > Sub-view) — Validated in Phase 2: Navigation
- [x] Project dashboard with status overview (active tasks, blocked items, progress) — Validated in Phase 3: Dashboard
- [x] Project dashboard with project brief (description, goals, key info) — Validated in Phase 3: Dashboard
- [x] Project dashboard with activity feed (recent task updates, agent activity) — Validated in Phase 3: Dashboard
- [x] Project-scoped task list showing only that project's tasks — Validated in Phase 4: Project Tasks
- [x] Create new tasks pre-scoped to the current project — Validated in Phase 4: Project Tasks
- [x] Reassign existing tasks into/out of the current project — Validated in Phase 4: Project Tasks
- [x] Project-scoped agent sessions view — Validated in Phase 5: Sessions & Agents
- [x] Project-scoped agents view — Validated in Phase 5: Sessions & Agents
- [x] Project settings (name, description, status, configuration) — Validated in Phase 6: Settings
- [ ] Project-level progress/completion indicators
- [x] Projects can be flagged for GSD-native tracking (`gsd_enabled`) — Validated in Phase 9: GSD Native Integration
- [x] Projects advance through Discuss → Plan → Execute → Verify → Done phases via in-app controls — Validated in Phase 9: GSD Native Integration
- [x] Tasks can be marked gate-required, blocking in_progress/done without operator approval — Validated in Phase 9: GSD Native Integration
- [x] Operators and admins can approve or reject gates from the UI and API — Validated in Phase 9: GSD Native Integration
- [x] Bootstrap endpoint creates default phase task packs idempotently — Validated in Phase 9: GSD Native Integration
- [x] Phase state is visible on the task board as per-task badges — Validated in Phase 9: GSD Native Integration
- [x] Project workspace exposes a dedicated Lifecycle tab — Validated in Phase 9: GSD Native Integration
- [x] Bootstrap templates loadable from external JSON files with bundled fallback — Validated in Phase 9: GSD Native Integration
- [x] One project can host multiple GSD workstreams concurrently — Implemented in Phase 10
- [x] One project can host multiple active milestones concurrently — Implemented in Phase 10
- [x] Milestones can contain ordered phases with dependency checks — Implemented in Phase 10
- [x] Phases can contain plan waves with plan dependency checks — Implemented in Phase 10
- [x] Lifecycle tab reads a hierarchical lifecycle graph with legacy fallback — Implemented in Phase 10
- [x] Lifecycle tab supports inline create/edit/complete/transition for hierarchy entities — Implemented in Phase 10
- [x] Lifecycle tab live-refreshes from project-scoped `gsd.*` SSE events — Implemented in Phase 10
- [x] OpenAPI and focused E2E/regression coverage for Phase 10 hierarchy — Implemented in Phase 10
- [x] CLI wrappers exist for Phase 10 workstreams, milestones, phases, plans, and lifecycle-graph reads — Implemented in Phase 10
- [x] Same-wave conflicts are counted in `rollups.wave_conflicts` and can block `plan -> in_progress` transitions — Implemented in Phase 10

**v1.3 candidates (not yet scoped — run `/gsd:new-milestone` to triage):**

**Autonomous-routing parity** (source docs: `.planning/GSD_PARITY_DIFF_vs_gsd-lawyerinc_2026-04-21.md` + `.planning/GSD_FINISHUP_PUNCHLIST_2026-04-21.md` + `.planning/GSD_CONTINUATION_AGENT_PROMPT_2026-04-21.md`; v1.2 shipped ~75–80% of baseline autonomous-routing intent — the items below close that gap):

**P0 — the missing `hierarchy transition → task queue activation → project-scoped claiming → blocker pause/resume` bridge:**

- [ ] **Gap A / P0.1: Project-scoped queue filtering** — `GET /api/tasks/queue` is workspace-level today. Add optional `project_id`, `gsd_plan_id`, `wave` query params applied consistently to current-in-progress lookup, capacity checks, and the atomic claim subquery. Backward-compatible when params absent. Files: `src/app/api/tasks/queue/route.ts`, `openapi.json`, `scripts/mc-cli.cjs`, `scripts/mc-mcp-server.cjs`, `tests/task-queue.spec.ts`.
- [ ] **Gap B / P0.2: Couple plan activation to queue state** — `POST /api/gsd/plans/:id/transition` updates plan status + emits events but does NOT project status changes into task queue state. On `to_status='in_progress'`, transition linked execution tasks (`gsd_plan_id=planId`) from backlog-style states into `inbox`/`assigned` based on assignee. Emit `gsd.plan.tasks_activated` with counts. Dependencies/gate/wave checks still enforced. Files: `src/app/api/gsd/plans/[plan_id]/transition/route.ts`, `src/lib/task-dispatch.ts`, tests under `src/app/api/gsd/__tests__/`.
- [x] **Gap C / M1 / P0.3 (scheduler): Lane-aware default auto-routing** — Validated in Phase 20: Lane-Aware Routing & Unified Blocker Contract (ROUTE-01, COMPAT-02). `autoRouteInboxTasks()` now runs a two-pass legacy SELECT (lane-scoped rows linked to `gsd_plans.status='in_progress'` first, unscoped fallback after) with `auto_route_lane_scoped` / `auto_route_legacy_fallback` reason metadata on `task.status_changed` broadcasts. Recipe fast-path byte-identical.
- [x] **Gap D / M2 / P0.3 (blocker): Unified blocker transition contract** — Validated in Phase 20: Lane-Aware Routing & Unified Blocker Contract (ROUTE-02, COMPAT-03). Legacy PUT `/api/tasks/:id` accepts `{blocker_reason, blocker_kind, resume_hint}` envelope atomically writing to `runner_last_failure_reason`; 409 redirect for recipe tasks. New `task.blocker_transition` event emitted from all four sites (recipe pause, legacy pause, legacy resume, recipe resume) with identical 10-key payload. Scheduler retry/fail paths unchanged.

**P1 — agent surface + doc drift:**

- [ ] **Gap E / M3 / P1.1: MCP create/update parity for routing fields** — `mc_poll_task_queue` supports `project_id` / `gsd_plan_id` (✓). Expand `mc_create_task` and `mc_update_task` (`scripts/mc-mcp-server.cjs`) to accept `project_id`, `status`, `metadata`, `gsd_workstream_id`, `gsd_milestone_id`, `gsd_phase_id`, `gsd_plan_id`, `gate_required`, `gate_status` where API permits. Docs: `docs/cli-agent-control.md`, `docs/agent-gsd-guide.md`.
- [ ] **Gap F / P1.2: Resolve remaining doc contradictions** — `docs/GSD-MODEL-COMPARISON.md` rows 51–52 claim gaps for wave conflicts / wrappers that a later section says are closed; reconcile. (`docs/runtime/INDEX.md` link drift fixed in commit `05965ef` after the v1.2 archive moved files.) Acceptance: `node scripts/verify-runtime-docs.mjs` stays green; GSD-MODEL-COMPARISON has no contradictions.

**P2 — hardening:**

- [ ] **P2.1: Replace high-value `it.todo` placeholders with executable tests** — focus on queue + lifecycle first: `src/components/project/__tests__/dashboard-view.test.tsx`, `src/lib/__tests__/project-{breadcrumb,tabs,workspace}.test.ts`, plus queue + transition integration tests. Target critical lifecycle + queue behaviors.

**M4 / umbrella goal:** Everything above should cohere into a single deterministic "automatic unless blocker" loop across every task type. Largely emerges from P0 landing cleanly; worth an explicit acceptance test in the v1.3 plan.

**Other v1.3 candidates:**

- [ ] Project-level progress/completion indicators (carried over from v1.0 Active — never landed)
- [ ] Multi-recipe scheduling (currently one recipe_slug per task; multi-step workflows would need a new primitive)
- [ ] Docker-host health integration (runner banner heartbeat is 90s; doesn't probe Docker — Pitfall #9 in Phase 18.1)
- [ ] Recipe versioning policy (currently recipe_slug is identity; no migration story across versions)
- [ ] Agent-image marketplace / signed-image verification (runtime trusts the operator-configured image allowlist)
- [ ] Observability surfaces for long-running agents (checkpoint timeline is per-task; no project-level aggregation)

### Out of Scope

- Project templates or cloning — complexity not needed for v1
- Project-level permissions/roles — existing auth roles are sufficient
- Gantt charts or timeline views — status overview is enough
- Cross-project dependency tracking — projects are independent for now
- Project archiving/deletion workflows — can use existing status changes

## Context

- Mission Control uses a single catch-all route (`src/app/[[...panel]]/page.tsx`) with Zustand state driving which panel renders. The project workspace integrates with this routing pattern.
- Projects live in SQLite via `better-sqlite3`. Migrations are additive only; schema has grown through v1.2 to include `recipes`, `task_runner_tokens`, `task_checkpoints`, and 11 new task columns.
- 33+ panels in `src/components/panels/`. The project workspace is itself a panel that contains sub-views (dashboard, tasks, sessions, agents, settings, Lifecycle).
- Real-time updates via SSE (`eventBus`) push task, agent, GSD lifecycle, and v1.2 runtime events (`task.runner_requested`, `task.container_started/exited`, `task.checkpoint_added`, `recipe.indexed/removed`) to the client.
- i18n support via `next-intl` — 10-locale coverage for all v1.2 UI surfaces.
- Agent runtime: `scripts/mc-runner.mjs` daemon runs on a LaunchAgent; spawns short-lived containers from recipe cards in `recipes/<slug>/`. Reference image: `mc-hello-world-agent`. Operator manual: `docs/runtime/INDEX.md`. Drift harness: `scripts/verify-runtime-docs.mjs` (pnpm script `docs:verify-runtime`).
- Auth stack: session cookies + `API_KEY` bearer + v1.2-added `runner` / `runner-token` principals (negative-sentinel user ids `-1000` / `-2000`).

## Constraints

- **Stack**: Must use existing Next.js 16 / React 19 / TypeScript / Tailwind / Zustand stack
- **Routing**: Must work within the existing catch-all route and panel system
- **Database**: SQLite via better-sqlite3 — no ORM, prepared statements only
- **Icons**: No icon libraries — raw text/emoji per project conventions
- **i18n**: All user-facing strings must go through next-intl message files

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Full takeover view (not drawer/sidebar) | User wants project to feel like its own workspace, not a detail panel | — Pending |
| Breadcrumb navigation | Natural way to move between project context and main view | — Pending |
| All sub-views in v1 (tasks, sessions, agents, settings) | User wants the complete workspace experience, not incremental | — Pending |
| v1.1: GSD state stored in-DB only (no `.planning/` sync) | Avoids filesystem sync bugs; CLI stays the authoring surface, MC tracks approvals | Landed in Phase 9 (migration 052 adds `gsd_*` columns on projects/tasks; no FS sync) |
| v1.1: Operator+admin required for all GSD endpoints | Reuses existing MC role model; no new per-project approver table | Landed in Phase 9 (`requireRole(request, 'operator')` on bootstrap/transition/gate routes) |
| v1.1: External JSON templates with bundled default fallback | Flexibility for users without forcing code changes | Landed in Phase 9 (`loadGsdTemplate` resolves `<DATA_DIR>/gsd-templates/*.json` → `DEFAULT_TEMPLATE`) |
| v1.1: Dedicated Lifecycle tab (not just settings) + task badges | Discoverable where work happens; matches existing workspace tab pattern | Landed in Phase 9 (lifecycle-view + phase/gate badges on task cards) |
| Phase 10: Keep project-level `gsd_phase` as legacy shell while hierarchy becomes primary model | Preserves backward compatibility and avoids forced migration of Phase 9 projects | Landed in Phase 10 (`/api/projects/:id/gsd/lifecycle-graph` returns both graph + legacy fallback metadata) |
| Phase 10: REST-first hierarchy surface before CLI parity | Keeps delivery moving while contracts stabilize; UI can ship immediately on top of canonical routes | Landed in Phase 10 (hierarchy routes + Lifecycle tab shipped first; CLI wrappers followed once contracts settled) |
| Phase 10: Optimistic locking on hierarchy mutations | Prevents silent overwrite races in the interactive Lifecycle tab | Landed in Phase 10 (`expected_updated_at` on PATCH/complete/transition routes) |
| Phase 10: No MCP parity in this phase | Operator explicitly chose CLI + REST plus conflict analysis, not a matching MCP tool surface | Landed in Phase 10 (CLI wrappers shipped; MCP parity intentionally deferred) |
| v1.2: Phase 11 scoped to substrate only (migrations + registry + auth) | Every later phase depends on it; keeps foundation shippable as pure additive migration | ✓ Good — landed clean, zero rollback needed |
| v1.2: Model-registry validation split across 3 phases (11, 12, 14) | Each validation lands where its consumer code lives | ✓ Good — validation boundaries match usage sites; no duplication |
| v1.2: Runner + container + worktree + reference image all ship together in Phase 14 | Mutually dependent — daemon is useless without worktree layout | ✓ Good — Phase 17 integration tests confirmed the bundle works end-to-end |
| v1.2: submit → review two-hop lifecycle (agent submits → review → Aegis → done) | Decouples agent "done" claim from human/reviewer approval; preserves Aegis review loop | ✓ Good — locked in Phase 17-01 RTEST-02; Phase 18-03 corrected earlier Phase 14 narrative drift |
| v1.2: Dual-write checkpoints (DB + .mc/checkpoints.jsonl) | DB for query/UI; JSONL for crash recovery (agent can re-read after container restart) | ✓ Good — Phase 17-05 crash-recovery test proved resume works byte-for-byte |
| v1.2: `runtime.project_repo_map` is the exclusive project→repo resolution path | No env-var fallback — forces operators to use settings API; prevents silent misconfiguration | ✓ Good — locked in Phase 14-08b; documented as Pitfall #4 in operator manual |
| v1.2: CONTAINER-01 — secrets injected via `--env-file`, never on docker argv | Docker argv is world-readable on the host; env files are 0600 | ✓ Good — Phase 14 runner-docker.ts uses writeEnvFile; Phase 17 argv-scan test prevents regression |
| v1.2: RUNNER_TOKEN_ALLOWLIST has 7 entries (not 6) | Added Phase 15 checkpoint endpoint post-design; allowlist is source-of-truth | ✓ Good — harness count-check prevents future off-by-one drift |
| v1.2: Phase 18 tech-debt cleanup as dedicated closure phase | Initial v1.2 audit found 4 non-critical items; batching them avoided derailing Phase 17 | ✓ Good — all 4 closed in <1 day; milestone re-audit flipped tech_debt → passed |
| v1.2: Phase 18.1 Runtime Documentation as inserted urgent phase | Operator manual was a gate for `/gsd:complete-milestone v1.2`; kept separate from Phase 18 tech-debt closure | ✓ Good — 7 plans shipped in 3 waves; drift harness prevents future regression |
| v1.2: Agent contract is tool-agnostic (no Claude Code assumption) | Runtime accepts any HTTP+file agent; reference image is Node but contract works for any language/framework | ✓ Good — locked in Phase 18.1-03 doc + user memory |
| v1.2: Closed at 75–80% of baseline autonomous-routing intent (4 M-items deferred to v1.3) | Baseline `gsd-lawyerinc` implies lane-aware scheduler + unified blocker contract + full MCP routing parity; those were never in v1.2's 72 REQ-IDs and would have been scope creep. Captured as v1.3 candidates per `.planning/GSD_PARITY_DIFF_vs_gsd-lawyerinc_2026-04-21.md` | ⚠️ Revisit in v1.3 — deterministic routing is the next missing primitive |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-22 — Phase 20 (Lane-Aware Routing & Unified Blocker Contract) complete, closing Gaps C and D from the v1.3 parity block (ROUTE-01, ROUTE-02, COMPAT-02, COMPAT-03 validated). v1.3 milestone (Autonomous-Routing Parity) started 2026-04-21 via /gsd:new-milestone. v1.2 shipped 2026-04-21 — 9 phases, 53 plans, 72/72 requirements satisfied.*
