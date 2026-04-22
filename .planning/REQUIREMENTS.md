# Requirements: v1.3 Autonomous-Routing Parity

**Defined:** 2026-04-21
**Milestone:** v1.3 Autonomous-Routing Parity
**Core Value:** When I click into a project, I see everything about that project and can manage all its work from one place, including driving it through its GSD lifecycle, and autonomous agents pick up assigned work, execute it in isolated containers, and move it through the Kanban.

**Milestone Goal:** Close the ~20–25% autonomous-routing gap identified in `.planning/GSD_PARITY_DIFF_vs_gsd-lawyerinc_2026-04-21.md` — deliver a single deterministic "automatic unless blocker" loop across every task type (recipe + legacy).

**Source documents:**
- `.planning/GSD_PARITY_DIFF_vs_gsd-lawyerinc_2026-04-21.md` — baseline parity analysis (M1–M4)
- `.planning/GSD_FINISHUP_PUNCHLIST_2026-04-21.md` — concrete gap list (A–F) with acceptance criteria
- `.planning/GSD_CONTINUATION_AGENT_PROMPT_2026-04-21.md` — P1 scope framing

---

## v1.3 Requirements

Requirements for milestone v1.3. Each maps to roadmap phases.

### Queue (P0 — project-scoped queue primitives)

- [ ] **QUEUE-01**: `GET /api/tasks/queue` accepts optional `project_id`, `gsd_plan_id`, and `wave` query parameters, applied consistently to current-in-progress lookup, capacity checks, and the atomic claim subquery. Backward-compatible when params absent. Reflected in `openapi.json`, `scripts/mc-cli.cjs`, and `scripts/mc-mcp-server.cjs`.
- [x] **QUEUE-02**: `POST /api/gsd/plans/:id/transition` to `in_progress` transitions linked execution tasks (`gsd_plan_id=planId`) from backlog-style states into `inbox` or `assigned` based on assignee, emits `gsd.plan.tasks_activated` with counts, and returns a `queue_activation` payload. Existing dependency, gate, and same-wave conflict checks continue to gate activation.

### Route (P0 — scheduler behavior + blocker contract)

- [ ] **ROUTE-01**: `autoRouteInboxTasks()` prefers inbox tasks linked to active `in_progress` plans (`gsd_plan_id`) and scoped project lanes over unscoped legacy inbox rows; falls back to unscoped routing only when no lane-scoped work is eligible. Recipe fast-path behavior is unchanged. Route decisions expose reason metadata (`auto_route_lane_scoped`, `auto_route_legacy_fallback`) via event payloads.
- [ ] **ROUTE-02**: Legacy dispatch path supports a structured `in_progress → awaiting_owner` transition with required `blocker_reason`, `blocker_kind`, and `resume_hint` fields; supports deterministic owner-initiated resume that restores the task to its pre-blocker state. Recipe runner and legacy dispatch emit a common event shape for blocker/resume transitions.

### MCP (P1 — agent surface parity)

- [ ] **MCP-01**: `mc_create_task` accepts `project_id`, `status`, `metadata`, `gsd_workstream_id`, `gsd_milestone_id`, `gsd_phase_id`, `gsd_plan_id`, `gate_required`, and `gate_status` (where the underlying API permits direct set) so an MCP-only agent can create a lane-scoped, lifecycle-linked, queue-ready task without falling back to raw REST.
- [ ] **MCP-02**: `mc_update_task` accepts the same expanded field set as MCP-01 with equivalent validation behavior.
- [ ] **MCP-03**: `docs/cli-agent-control.md` and `docs/agent-gsd-guide.md` describe the expanded MCP schemas, including worked examples for lifecycle-linked task creation and lane-scoped polling.

### Docs (P1 — reconcile drift)

- [ ] **DOCS-01**: `docs/GSD-MODEL-COMPARISON.md` internal contradictions are reconciled — rows claiming gaps for wave conflicts / wrappers are consistent with any later "closed" sections; a single source-of-truth status per row.
- [ ] **DOCS-02**: `node scripts/verify-runtime-docs.mjs` continues to pass (exit 0, all 10 checks green) after all v1.3 doc changes.

### Tests (P2 — hardening)

- [ ] **TESTS-01**: `src/components/project/__tests__/dashboard-view.test.tsx` has its high-value `it.todo` placeholders replaced with executable tests covering critical dashboard render, data load, and real-time update behaviors.
- [ ] **TESTS-02**: `src/lib/__tests__/project-breadcrumb.test.ts`, `project-tabs.test.ts`, and `project-workspace.test.ts` have their high-value `it.todo` placeholders replaced with executable tests covering the critical routing + state contracts used by the workspace shell.
- [ ] **TESTS-03**: Queue + plan-transition integration tests exist (added or expanded) covering QUEUE-01, QUEUE-02, and ROUTE-01 end-to-end — project-scoped claim, plan-activation side effects, and lane-aware dispatch preference.

### Acceptance (M4 umbrella)

- [ ] **ACCEPT-01**: End-to-end acceptance test demonstrates the deterministic "automatic unless blocker" loop — plan → `in_progress` transition → tasks activated into queue → project-scoped claim by a runner/agent → `in_progress` → blocker checkpoint → `awaiting_owner` → owner-initiated resume → completion — executing both the recipe path and the legacy dispatch path where each applies.

### Compat (back-compat guardrails)

- [ ] **COMPAT-01**: Existing workspace-level queue polling (no scoping params) continues to return the same result set and respect the same capacity semantics as before v1.3.
- [ ] **COMPAT-02**: Recipe fast-path dispatch behavior is unchanged by the lane-awareness introduced in ROUTE-01 (same claim order, same recipe resolution, same event shape).
- [ ] **COMPAT-03**: Legacy dispatch retry and failure semantics (`assigned ↔ in_progress → failed/review`) are preserved; the ROUTE-02 blocker contract is additive, not a replacement for existing retry/fail transitions.
- [ ] **COMPAT-04**: MCP callers that omit the new routing fields introduced in MCP-01/MCP-02 continue to function identically to their pre-v1.3 behavior (no required-field additions on existing call sites).

---

## Future Requirements

Deferred from v1.3-candidates in PROJECT.md. Tracked but not in v1.3 roadmap.

### Platform

- **FUT-01**: Project-level progress/completion indicators (carryover from v1.0 Active — never landed)
- **FUT-02**: Multi-recipe scheduling (currently one recipe_slug per task; multi-step workflows would need a new primitive)
- **FUT-03**: Docker-host health integration (runner banner heartbeat is 90s; doesn't probe Docker — Pitfall #9 from Phase 18.1)
- **FUT-04**: Recipe versioning policy (recipe_slug is identity today; no migration story across versions)
- **FUT-05**: Agent-image marketplace / signed-image verification (runtime trusts operator-configured image allowlist)
- **FUT-06**: Observability surfaces for long-running agents (checkpoint timeline is per-task; no project-level aggregation)

---

## Out of Scope

Explicitly excluded from v1.3. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Multi-recipe scheduling | Needs new primitive; not a routing/parity concern — tracked as FUT-02 |
| Docker-host health probe | Runtime-infra concern; independent of autonomous-routing loop — FUT-03 |
| Recipe versioning policy | Identity-model change; independent of routing — FUT-04 |
| Agent-image marketplace / signing | Security/infra scope; independent of routing — FUT-05 |
| Project-level agent observability | Aggregation surface; separate UX pass — FUT-06 |
| Project-level progress/completion indicators | UI feature, not routing — FUT-01 |
| MCP parity for workstream/milestone/phase CRUD beyond task linkage | Phase 10 explicitly deferred this; still deferred |
| `GSD-MODEL-COMPARISON.md` full rewrite | DOCS-01 scope is contradiction reconciliation only; avoid scope creep |
| Schema or migration changes to queue primitives | Existing SQLite schema is sufficient; queue/plan linkage is already in task rows |
| New authentication principals | Existing `runner` / `runner-token` / session cookie / API key stack is sufficient |
| New UI panels for v1.3 behaviors | Route-reason metadata and blocker fields are API surfaces; UI surfacing deferred |

---

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| QUEUE-01 | Phase 19 | Pending |
| QUEUE-02 | Phase 19 | Complete |
| ROUTE-01 | Phase 20 | Pending |
| ROUTE-02 | Phase 20 | Pending |
| MCP-01 | Phase 21 | Pending |
| MCP-02 | Phase 21 | Pending |
| MCP-03 | Phase 21 | Pending |
| DOCS-01 | Phase 22 | Pending |
| DOCS-02 | Phase 22 | Pending |
| TESTS-01 | Phase 22 | Pending |
| TESTS-02 | Phase 22 | Pending |
| TESTS-03 | Phase 22 | Pending |
| ACCEPT-01 | Phase 23 | Pending |
| COMPAT-01 | Phase 19 | Pending |
| COMPAT-02 | Phase 20 | Pending |
| COMPAT-03 | Phase 20 | Pending |
| COMPAT-04 | Phase 21 | Pending |

**Coverage:**
- v1.3 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

**Distribution:**
- Phase 19 (Project-Scoped Queue & Plan Activation): QUEUE-01, QUEUE-02, COMPAT-01 — 3 reqs
- Phase 20 (Lane-Aware Routing & Unified Blocker Contract): ROUTE-01, ROUTE-02, COMPAT-02, COMPAT-03 — 4 reqs
- Phase 21 (MCP Routing-Field Parity): MCP-01, MCP-02, MCP-03, COMPAT-04 — 4 reqs
- Phase 22 (Doc Reconciliation & Test Debt Burn-Down): DOCS-01, DOCS-02, TESTS-01, TESTS-02, TESTS-03 — 5 reqs
- Phase 23 (End-to-End Acceptance Validation): ACCEPT-01 — 1 req

---

*Requirements defined: 2026-04-21*
*Last updated: 2026-04-21 — v1.3 roadmap landed; all 17 requirements mapped to Phases 19–23 via /gsd:roadmapper.*
