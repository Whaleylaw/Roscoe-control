# Roadmap: Project Workspace & Dashboard

## Overview

Transform projects from a task-grouping label into a first-class destination. v1.0 built the workspace itself — foundations, navigation shell, dashboard, scoped tasks/sessions/agents, settings, and entry points. v1.1 layered native GSD lifecycle support onto that workspace (Discuss → Plan → Execute → Verify → Done). Phase 10 extended that model so a single project can host multiple workstreams, milestones, phases, and plans concurrently via a hierarchical Lifecycle tab. v1.2 added the agent execution layer: Kanban tasks declare a recipe card, and a dedicated runner daemon launches short-lived containerized agents to execute them with crash-safe progress checkpoints and per-task-scoped authentication. v1.3 closes the autonomous-routing gap vs the `gsd-lawyerinc` baseline — hierarchy transitions now project into queue activation, routing honors project/plan lanes by default, blocker pause/resume semantics are unified across recipe + legacy paths, and the MCP surface reaches parity with the REST routing contract.

## Milestones

- ✅ **v1.0 — Project Workspace & Dashboard** — Phases 1–8 (shipped 2026-04-14) → [archive](milestones/v1.0-MILESTONE-AUDIT.md)
- ✅ **v1.1 — Native GSD Integration** — Phases 9–10 (shipped 2026-04-15) → [archive](milestones/v1.1-MILESTONE-AUDIT.md)
- ✅ **v1.2 — Recipe-Based Ephemeral Agent Runtime** — Phases 11–18.1 (shipped 2026-04-21) → [archive](milestones/v1.2-ROADMAP.md)
- 🚧 **v1.3 — Autonomous-Routing Parity** — Phases 19–23 (active)

## Phases

<details>
<summary>✅ v1.0 — Project Workspace & Dashboard (Phases 1–8) — SHIPPED 2026-04-14</summary>

- [x] Phase 1: Foundation (3/3 plans)
- [x] Phase 2: Navigation & Workspace Shell (2/2 plans)
- [x] Phase 3: Project Dashboard (3/3 plans)
- [x] Phase 4: Project Tasks (2/2 plans)
- [x] Phase 5: Sessions & Agents (4/4 plans)
- [x] Phase 6: Settings (2/2 plans)
- [x] Phase 7: Post-Audit Gap Closure (2/2 plans)
- [x] Phase 8: Projects Entry Point (6/6 plans)

Phase directories remain under `.planning/phases/` as historical execution record. Full audit at `.planning/v1.0-MILESTONE-AUDIT.md`.

</details>

<details>
<summary>✅ v1.1 — Native GSD Integration (Phases 9–10) — SHIPPED 2026-04-15</summary>

- [x] Phase 9: GSD Native Integration (11/11 plans)
- [x] Phase 10: Hierarchical Lifecycle Graph (complete)

Phase directories remain under `.planning/phases/` as historical execution record. Full audit at `.planning/v1.1-MILESTONE-AUDIT.md`.

</details>

<details>
<summary>✅ v1.2 — Recipe-Based Ephemeral Agent Runtime (Phases 11–18.1) — SHIPPED 2026-04-21</summary>

- [x] Phase 11: Runtime Foundation (4/4 plans)
- [x] Phase 12: Recipe System (4/4 plans)
- [x] Phase 13: Task Runtime Context (3/3 plans)
- [x] Phase 14: Runner Daemon & Container Execution (12/12 plans)
- [x] Phase 15: Checkpoints & Scheduler Integration (7/7 plans)
- [x] Phase 16: Runtime UI Surfaces (6/6 plans)
- [x] Phase 17: Integration Testing & Reference Pipeline (6/6 plans)
- [x] Phase 18: v1.2 Tech-Debt Cleanup (4/4 plans)
- [x] Phase 18.1: v1.2 Runtime Documentation (INSERTED, 7/7 plans)

Phase directories archived to `.planning/milestones/v1.2-phases/`. Full audit at `.planning/milestones/v1.2-MILESTONE-AUDIT.md`. Full roadmap snapshot at `.planning/milestones/v1.2-ROADMAP.md`.

</details>

## v1.3 — Autonomous-Routing Parity (Phases 19–23)

Active milestone. Closes the ~20–25% autonomous-routing gap identified in `.planning/GSD_PARITY_DIFF_vs_gsd-lawyerinc_2026-04-21.md` — delivers a single deterministic "automatic unless blocker" loop across every task type (recipe + legacy).

- [x] **Phase 19: Project-Scoped Queue & Plan Activation** — Scope the queue endpoint to project/plan/wave lanes and couple plan `in_progress` transitions into queue-entering task activations. (QUEUE-01, QUEUE-02, COMPAT-01) (completed 2026-04-22)
- [ ] **Phase 20: Lane-Aware Routing & Unified Blocker Contract** — Make the scheduler prefer active plan lanes over legacy inbox and give legacy dispatch the same structured `awaiting_owner` pause/resume contract as the recipe runner. (ROUTE-01, ROUTE-02, COMPAT-02, COMPAT-03)
- [ ] **Phase 21: MCP Routing-Field Parity** — Extend `mc_create_task` / `mc_update_task` to accept the full project + GSD linkage + gate field set so MCP-only agents can produce queue-ready, lifecycle-linked tasks without REST fallback. (MCP-01, MCP-02, MCP-03, COMPAT-04)
- [ ] **Phase 22: Doc Reconciliation & Test Debt Burn-Down** — Reconcile `GSD-MODEL-COMPARISON.md` contradictions, keep the runtime drift harness green, and replace high-value `it.todo` placeholders on the workspace shell + queue/transition paths with executable tests. (DOCS-01, DOCS-02, TESTS-01, TESTS-02, TESTS-03)
- [ ] **Phase 23: End-to-End Acceptance Validation** — Prove the full deterministic "automatic unless blocker" loop end-to-end across both recipe and legacy execution paths. (ACCEPT-01)

### Phase Details

### Phase 19: Project-Scoped Queue & Plan Activation
**Goal**: Operators can poll a queue scoped to a single project/plan/wave, and flipping a plan to `in_progress` deterministically activates its linked execution tasks into claimable queue state.
**Depends on**: Nothing (entry phase for v1.3 — builds on shipped v1.2 queue + plan-transition primitives)
**Requirements**: QUEUE-01, QUEUE-02, COMPAT-01
**Success Criteria** (what must be TRUE):
  1. A caller can hit `GET /api/tasks/queue?project_id=<id>` (and/or `gsd_plan_id`, `wave`) and only receive or atomically claim tasks that match the scope, with capacity checks enforced per-scope.
  2. A caller polling `GET /api/tasks/queue` with no scoping params receives the same result set and capacity semantics as before v1.3 (workspace-level behavior preserved).
  3. Transitioning a plan to `in_progress` via `POST /api/gsd/plans/:id/transition` moves every linked execution task (`gsd_plan_id=planId`) from backlog-style states into `inbox` or `assigned` based on assignee, returns a `queue_activation` payload with counts, and emits `gsd.plan.tasks_activated`.
  4. Plan activation still respects existing dependency, gate, and same-wave conflict checks — a blocked transition does not activate tasks.
  5. `openapi.json`, `scripts/mc-cli.cjs`, and `scripts/mc-mcp-server.cjs` reflect the new scoping params so CLI and MCP callers can drive the scoped queue without raw REST.
**Plans**: 3 plans
- [ ] 19-01-PLAN.md — Project/plan/wave scoping + cross-filter validation on GET /api/tasks/queue
- [ ] 19-02-PLAN.md — Plan-transition activation side effect with full queue_activation payload + gsd.plan.tasks_activated event
- [ ] 19-03-PLAN.md — OpenAPI/CLI/MCP surface updates for scoping params and queue_activation response

### Phase 20: Lane-Aware Routing & Unified Blocker Contract
**Goal**: The default auto-router prefers lifecycle-ready plan lanes over unscoped legacy inbox, and every dispatch path — recipe runner and legacy — supports the same structured owner-intervention pause/resume contract.
**Depends on**: Phase 19 (needs the lane-scoped primitives QUEUE-01/02 establish)
**Requirements**: ROUTE-01, ROUTE-02, COMPAT-02, COMPAT-03
**Success Criteria** (what must be TRUE):
  1. When at least one inbox task is linked to an active `in_progress` plan, `autoRouteInboxTasks()` routes lane-scoped work first and only falls back to unscoped legacy inbox when no lane-scoped work is eligible.
  2. Route decisions surface observable reason metadata on emitted events — `auto_route_lane_scoped` when a lane-scoped route fires and `auto_route_legacy_fallback` when the unscoped path runs.
  3. Recipe fast-path claim order, recipe resolution, and event shape are byte-for-byte unchanged — a recipe-tagged task still moves through the runner exactly as it did in v1.2.
  4. A legacy-dispatched task can transition `in_progress → awaiting_owner` with required `blocker_reason`, `blocker_kind`, and `resume_hint` fields, and an owner-initiated resume restores it to its pre-blocker state deterministically.
  5. Existing legacy retry/fail semantics (`assigned ↔ in_progress → failed/review`) still fire on non-blocker error paths — the blocker contract is additive, not a replacement.
  6. Recipe runner and legacy dispatch emit a common event shape for blocker and resume transitions so downstream UI/observers handle both paths identically.
**Plans**: TBD

### Phase 21: MCP Routing-Field Parity
**Goal**: An MCP-only agent can create or update fully project-scoped, lifecycle-linked, gate-aware tasks without ever falling back to raw REST.
**Depends on**: Phase 19 (consumes the scoped queue contract; MCP fields must target the same routing model)
**Requirements**: MCP-01, MCP-02, MCP-03, COMPAT-04
**Success Criteria** (what must be TRUE):
  1. `mc_create_task` accepts `project_id`, `status`, `metadata`, `gsd_workstream_id`, `gsd_milestone_id`, `gsd_phase_id`, `gsd_plan_id`, `gate_required`, and `gate_status` (where the underlying API permits), validates them with the same rules as REST, and produces a queue-ready task row.
  2. `mc_update_task` accepts the same expanded field set with equivalent validation, so an agent can retrofit routing metadata onto an existing task via MCP alone.
  3. Pre-v1.3 MCP callers that omit every new field continue to function identically — no new fields are required, and default behavior matches the prior release.
  4. `docs/cli-agent-control.md` and `docs/agent-gsd-guide.md` document the expanded schemas with worked examples for lifecycle-linked task creation and lane-scoped polling — an agent reader can cut-and-paste a valid call.
**Plans**: TBD

### Phase 22: Doc Reconciliation & Test Debt Burn-Down
**Goal**: Workspace shell and queue/transition behaviors are protected by executable tests (not `it.todo` placeholders), and the GSD docs present a single source-of-truth status per capability with the runtime drift harness staying green.
**Depends on**: Phase 19 (TESTS-03 integration tests exercise QUEUE-01/02), Phase 20 (TESTS-03 covers ROUTE-01 end-to-end)
**Requirements**: DOCS-01, DOCS-02, TESTS-01, TESTS-02, TESTS-03
**Success Criteria** (what must be TRUE):
  1. `docs/GSD-MODEL-COMPARISON.md` shows a single, consistent status per capability row — earlier "gap" rows and later "closed" claims are reconciled into one answer.
  2. `node scripts/verify-runtime-docs.mjs` exits 0 with all 10 checks green after the v1.3 doc changes.
  3. `src/components/project/__tests__/dashboard-view.test.tsx` has its high-value `it.todo` placeholders replaced with executable tests covering critical dashboard render, data load, and real-time update behaviors.
  4. `src/lib/__tests__/project-breadcrumb.test.ts`, `project-tabs.test.ts`, and `project-workspace.test.ts` have their high-value `it.todo` placeholders replaced with executable tests covering the routing + state contracts the workspace shell depends on.
  5. Queue + plan-transition integration tests exist (added or expanded) that exercise QUEUE-01, QUEUE-02, and ROUTE-01 end-to-end — project-scoped claim, plan-activation side effects, and lane-aware dispatch preference.
**Plans**: TBD

### Phase 23: End-to-End Acceptance Validation
**Goal**: A single automated test demonstrates the deterministic "automatic unless blocker" loop across every task type, closing the v1.3 M4 umbrella goal.
**Depends on**: Phase 19, Phase 20, Phase 21, Phase 22 (needs every behavior above wired and test infrastructure in place)
**Requirements**: ACCEPT-01
**Success Criteria** (what must be TRUE):
  1. An automated end-to-end test walks plan → `in_progress` transition → linked tasks activated into queue → project-scoped claim by a runner/agent → `in_progress` → blocker checkpoint → `awaiting_owner` → owner-initiated resume → task completion, and passes deterministically.
  2. The same loop is exercised for both the recipe path (runner claims a recipe-tagged task) and the legacy dispatch path (non-recipe task) within the acceptance test, proving the unified blocker contract holds on both.
  3. The acceptance test is reproducible from a clean state (no hand-seeded data) and runs in the project's existing test harness (`pnpm vitest` or `pnpm test:e2e` as appropriate).
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-04-13 |
| 2. Navigation & Workspace Shell | v1.0 | 2/2 | Complete | 2026-04-13 |
| 3. Project Dashboard | v1.0 | 3/3 | Complete | 2026-04-13 |
| 4. Project Tasks | v1.0 | 2/2 | Complete | 2026-04-13 |
| 5. Sessions & Agents | v1.0 | 4/4 | Complete | 2026-04-13 |
| 6. Settings | v1.0 | 2/2 | Complete | 2026-04-14 |
| 7. Post-Audit Gap Closure | v1.0 | 2/2 | Complete | 2026-04-14 |
| 8. Projects Entry Point | v1.0 | 6/6 | Complete | 2026-04-14 |
| 9. GSD Native Integration | v1.1 | 11/11 | Complete | 2026-04-15 |
| 10. Hierarchical Lifecycle Graph | v1.1 | — | Complete | 2026-04-15 |
| 11. Runtime Foundation | v1.2 | 4/4 | Complete | 2026-04-19 |
| 12. Recipe System | v1.2 | 4/4 | Complete | 2026-04-19 |
| 13. Task Runtime Context | v1.2 | 3/3 | Complete | 2026-04-20 |
| 14. Runner Daemon & Container Execution | v1.2 | 12/12 | Complete | 2026-04-20 |
| 15. Checkpoints & Scheduler Integration | v1.2 | 7/7 | Complete | 2026-04-20 |
| 16. Runtime UI Surfaces | v1.2 | 6/6 | Complete | 2026-04-21 |
| 17. Integration Testing & Reference Pipeline | v1.2 | 6/6 | Complete | 2026-04-21 |
| 18. v1.2 Tech-Debt Cleanup | v1.2 | 4/4 | Complete | 2026-04-21 |
| 18.1. v1.2 Runtime Documentation | v1.2 | 7/7 | Complete | 2026-04-21 |
| 19. Project-Scoped Queue & Plan Activation | 3/3 | Complete    | 2026-04-22 | — |
| 20. Lane-Aware Routing & Unified Blocker Contract | 2/3 | In Progress|  | — |
| 21. MCP Routing-Field Parity | v1.3 | 0/— | Pending | — |
| 22. Doc Reconciliation & Test Debt Burn-Down | v1.3 | 0/— | Pending | — |
| 23. End-to-End Acceptance Validation | v1.3 | 0/— | Pending | — |

Active milestone: v1.3 — run `/gsd:plan-phase 19` to start planning Phase 19.
