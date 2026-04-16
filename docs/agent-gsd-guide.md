# GSD Lifecycle Guide for Agents

Mission Control now exposes GSD in two layers:

- the legacy project shell: bootstrap, gate tasks, and top-level `discuss -> plan -> execute -> verify -> done`
- the Phase 10 hierarchy: workstreams, milestones, phases, plans, and task linkage inside a single project

This guide is the agent-facing contract for both.

**Audience:** autonomous agents, operator scripts, CLI users, and REST callers. Everything below assumes you already have an API key (`MC_API_KEY`) and the base URL (`MC_URL`, default `http://127.0.0.1:3000`).

---

## 1. Mental model

### Project shell

Projects still carry the legacy GSD columns:

| Column | Type | Meaning |
|---|---|---|
| `gsd_enabled` | 0/1 | GSD machinery on or off |
| `gsd_track` | enum | Default legacy task pack: `ops`, `product`, `marketing`, `legal`, `firmvault`, `custom` |
| `gsd_phase` | enum | Top-level lifecycle phase: `discuss` → `plan` → `execute` → `verify` → `done` |
| `gsd_gate_mode` | enum | `manual_approval` or `auto_internal` |
| `gsd_updated_at` | iso | Last shell transition |

That shell is still strictly linear.

### Hierarchy layer

Inside a project, Phase 10 adds first-class hierarchy objects:

```text
project
  -> workstreams (optional)
  -> milestones
  -> phases
  -> plans
  -> tasks
```

Hierarchy entities and statuses:

| Entity | Key fields | Status / lifecycle |
|---|---|---|
| Workstream | `key`, `name` | `active`, `paused`, `complete` |
| Milestone | `version_label`, `title`, `workstream_id?` | `planned`, `active`, `complete`, `archived` |
| Phase | `phase_key`, `phase_slug`, `ordering_numeric`, `depends_on_phase_ids` | lifecycle `discuss -> plan -> execute -> verify -> done`; status `planned`, `active`, `complete`, `deferred` |
| Plan | `plan_ref`, `title`, `wave`, `depends_on_plan_ids` | `todo`, `in_progress`, `review`, `done`, `failed` |

Dependency scope:

- phase dependencies must stay within one milestone
- plan dependencies must stay within one phase

Tasks may also link directly to hierarchy objects using:

- `gsd_workstream_id`
- `gsd_milestone_id`
- `gsd_phase_id`
- `gsd_plan_id`

### Legacy task gating still exists

Tasks still expose:

| Column | Meaning |
|---|---|
| `gsd_phase` | Legacy shell phase tag |
| `gate_required` | 1 = approval required |
| `gate_status` | `not_required`, `pending`, `approved`, `rejected` |

The shell and the hierarchy can coexist in the same project.

---

## 2. Which surfaces you have

### Surface A: Lifecycle tab

The built-in Lifecycle tab is now a real operator console, not a read-only view. It can:

- fetch the lifecycle graph
- create workstreams, milestones, phases, and plans
- edit metadata inline
- reassign milestones across workstreams
- select dependencies through scoped checkbox pickers
- complete workstreams and milestones
- transition phases and plans
- live-refresh from SSE events

For many operators, this is now the easiest Phase 10 surface.

### Surface B: CLI

The CLI now has first-class wrappers for both the legacy project shell and the Phase 10 hierarchy:

```bash
pnpm mc projects create --name "Q2 Pricing Migration" --prefix PRI --gsd --track product --gate-mode manual_approval --json
pnpm mc projects bootstrap --id 42 --json
pnpm mc projects transition --id 42 --to plan --json
pnpm mc projects lifecycle-graph --id 42 --json
pnpm mc projects workstreams create --id 42 --key core --name "Core Platform" --json
pnpm mc projects milestones create --id 42 --version v2.1 --title "Gateway parity rollout" --workstream-id 7 --json
pnpm mc gsd phases create --milestone-id 11 --key 10-01 --slug schema-and-api-foundation --order 10.01 --json
pnpm mc gsd plans transition --plan-id 27 --to in_progress --json
pnpm mc tasks gate --id 105 --approve --note "Plan reviewed"
```

The CLI uses the same REST contracts as the UI. If you need an endpoint that is not yet wrapped, fall back to `pnpm mc raw --method ... --path /api/...`.

### Surface C: REST

REST is the authoritative programmable interface for Phase 10.

Direct HTTP with bearer auth:

```bash
curl -H "Authorization: Bearer $MC_API_KEY" \
     -H "Content-Type: application/json" \
     "$MC_URL/api/projects"
```

Mutation role requirement:

- hierarchy and shell mutations require `operator` or `admin`
- viewers can read graph state and SSE events, but cannot mutate

---

## 3. Canonical read model

Use this endpoint first:

```bash
GET /api/projects/:id/gsd/lifecycle-graph
```

It returns:

- project shell metadata
- hierarchy rollups
- nested workstreams with milestones, phases, and plans
- unscoped milestones
- legacy fallback state for pre-Phase-10 projects

Important flags in the response:

| Field | Meaning |
|---|---|
| `legacy.enabled` | Project still has GSD shell or shell-tagged tasks |
| `legacy.current_phase` | Current shell phase |
| `legacy.fallback_active` | No hierarchy exists yet, so the Lifecycle tab should stay in legacy mode |
| `rollups.blocked_gates` | Count of gate-required tasks not yet approved |
| `rollups.in_progress_plans` | Active plan execution count |

Agents should generally refetch this graph after any successful mutation and after any `409` conflict response.

---

## 4. Legacy shell workflow

Use the shell for top-level lifecycle control and for backward-compatible projects.

### Create a GSD-enabled project

```bash
curl -X POST "$MC_URL/api/projects" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Q2 Pricing Migration",
    "ticket_prefix": "PRI",
    "gsd_enabled": true,
    "gsd_track": "product",
    "gsd_gate_mode": "manual_approval"
  }'
```

### Bootstrap the legacy task pack

```bash
curl -X POST "$MC_URL/api/projects/42/gsd/bootstrap" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

This seeds the default 8-task discuss/plan/execute/verify pack.

### Transition the shell

```bash
curl -X POST "$MC_URL/api/projects/42/gsd/transition" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "to_phase": "plan" }'
```

Shell rules remain unchanged:

| From → To | Requires |
|---|---|
| `discuss → plan` | ≥1 discuss task is `done` |
| `plan → execute` | ≥1 plan task is `done` and approval-package gate is `approved` |
| `execute → verify` | all execute tasks done, or `waive_remaining:true` with `reason` |
| `verify → done` | ≥1 verify task is `done` |

### Approve a gate-required task

```bash
curl -X PATCH "$MC_URL/api/tasks/105/gate" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "gate_status": "approved", "note": "Plan reviewed by Aegis" }'
```

---

## 5. Hierarchy workflow

### 5.1 Create workstreams

```bash
curl -X POST "$MC_URL/api/projects/42/gsd/workstreams" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "core-platform",
    "name": "Core Platform",
    "status": "active"
  }'
```

### 5.2 Create milestones

Milestones can belong to a workstream or be project-scoped:

```bash
curl -X POST "$MC_URL/api/projects/42/gsd/milestones" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "workstream_id": 7,
    "version_label": "v2.1",
    "title": "Gateway parity rollout",
    "status": "active"
  }'
```

### 5.3 Create phases

```bash
curl -X POST "$MC_URL/api/gsd/milestones/11/phases" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phase_key": "10-01",
    "phase_slug": "schema-and-api-foundation",
    "lifecycle_phase": "discuss",
    "ordering_numeric": 10.01,
    "status": "active",
    "depends_on_phase_ids": []
  }'
```

### 5.4 Create plans

```bash
curl -X POST "$MC_URL/api/gsd/phases/15/plans" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "plan_ref": "10-01-PLAN",
    "title": "Implement schema and validation",
    "wave": 1,
    "status": "todo",
    "depends_on_plan_ids": []
  }'
```

### 5.5 Update hierarchy entities

All hierarchy PATCH endpoints accept partial bodies. When you have it, send `expected_updated_at` to avoid stomping concurrent edits.

Examples:

```bash
PATCH /api/projects/:id/gsd/workstreams/:ws_id
PATCH /api/projects/:id/gsd/milestones/:milestone_id
PATCH /api/gsd/phases/:phase_id
PATCH /api/gsd/plans/:plan_id
```

Typical editable fields:

- workstream: `key`, `name`, `status`
- milestone: `workstream_id`, `version_label`, `title`, `status`, timestamps
- phase: `phase_key`, `phase_slug`, `lifecycle_phase`, `ordering_numeric`, `status`, `depends_on_phase_ids`
- plan: `plan_ref`, `title`, `wave`, `status`, `depends_on_plan_ids`

### 5.6 Complete workstreams and milestones

```bash
POST /api/projects/:id/gsd/workstreams/:ws_id/complete
POST /api/projects/:id/gsd/milestones/:milestone_id/complete
```

Both accept optional `expected_updated_at`.

### 5.7 Transition phases

```bash
curl -X POST "$MC_URL/api/gsd/phases/15/transition" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to_lifecycle_phase": "plan",
    "expected_updated_at": 1713200000
  }'
```

Transition rules:

- transitions are strictly linear
- moving beyond `discuss` is blocked if dependency phases are incomplete
- moving beyond `discuss` is also blocked if earlier ordered phases in the milestone are incomplete

Conflict responses:

- `409 DEPENDENCY_BLOCKED`
- `409 PHASE_ORDER_BLOCKED`
- `409 ILLEGAL_TRANSITION`

### 5.8 Transition plans

```bash
curl -X POST "$MC_URL/api/gsd/plans/27/transition" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to_status": "in_progress",
    "expected_updated_at": 1713200000
  }'
```

Key rule:

- a plan cannot move to `in_progress` until all depended-on plans in the same phase are `done`
- a plan also cannot move to `in_progress` if another same-wave active plan points at overlapping task resource hints; the API returns `WAVE_CONFLICT_BLOCKED` plus `blocking_plan_ids` and `conflicting_paths`

Conflict response:

- `409 PLAN_DEPENDENCY_BLOCKED`

---

## 6. Task body reference

Tasks can still be created with legacy shell fields:

```json
{
  "title": "Review security implications",
  "description": "...",
  "status": "inbox",
  "assigned_to": "aegis",
  "project_id": 42,
  "gsd_phase": "plan",
  "gate_required": 1
}
```

Phase 10 tasks may also carry hierarchy links:

```json
{
  "title": "Implement lifecycle graph route",
  "project_id": 42,
  "gsd_phase_id": 15,
  "gsd_plan_id": 27,
  "gsd_milestone_id": 11,
  "gsd_workstream_id": 7
}
```

Use task linkage when the execution record should roll up into a specific hierarchy node.

---

## 7. Events your agent can subscribe to

All GSD mutations broadcast over SSE at `GET /api/events`.

Watch with:

```bash
pnpm mc events watch --types project,task,activity --json
```

Legacy shell events:

| Event | Fires when |
|---|---|
| `project.gsd.transition` | Project shell phase advances |
| `task.gate.changed` | Gate approved or rejected |
| `task.updated` | Any task mutation |
| `activity.created` | Audited activity entry |

Hierarchy events:

| Event | Fires when |
|---|---|
| `gsd.workstream.created` | Workstream created |
| `gsd.workstream.updated` | Workstream patched |
| `gsd.workstream.completed` | Workstream completed |
| `gsd.milestone.created` | Milestone created |
| `gsd.milestone.updated` | Milestone patched |
| `gsd.milestone.completed` | Milestone completed |
| `gsd.phase.created` | Phase created |
| `gsd.phase.updated` | Phase patched |
| `gsd.phase.transitioned` | Phase lifecycle advanced |
| `gsd.plan.created` | Plan created |
| `gsd.plan.updated` | Plan patched |
| `gsd.plan.transitioned` | Plan status advanced |
| `gsd.conflict.detected` | Server detected a dependency or ordering block |

Hierarchy events include `project_id`, so listeners can safely filter by project and refetch the lifecycle graph.

---

## 8. Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| 403 on hierarchy or shell mutation | Viewer key or insufficient role | Use operator or admin key |
| 409 `OPTIMISTIC_LOCK_FAILED` | Entity changed since last read | Refetch graph and retry with fresh `updated_at` |
| 409 `ILLEGAL_TRANSITION` | Attempted out-of-order phase or plan transition | Use the next legal state only |
| 409 `DEPENDENCY_BLOCKED` | A depended-on phase is incomplete | Complete blocking phases first |
| 409 `PHASE_ORDER_BLOCKED` | An earlier ordered phase is incomplete | Complete lower-order phases first |
| 409 `PLAN_DEPENDENCY_BLOCKED` | Depended-on plans are not `done` | Finish blocking plans first |
| 409 `WAVE_CONFLICT_BLOCKED` | Another active plan in the same wave overlaps on resource hints | Move one plan to a different wave or reduce overlapping files/paths |
| 400 `INVALID_DEPENDENCIES` | Dependency IDs cross scope or self-reference | Keep phase deps inside one milestone and plan deps inside one phase |
| 404 `WORKSTREAM_NOT_FOUND` | Milestone reassignment target missing | Use a valid workstream in the same project |
| Bootstrap returns `created: 0, skipped: 8` | Already bootstrapped | Expected; bootstrap is idempotent |

---

## 9. Quick reference endpoint matrix

| Action | Method | Path | Role |
|---|---|---|---|
| Create GSD project | POST | `/api/projects` + `gsd_enabled:true` | operator |
| Bootstrap legacy task pack | POST | `/api/projects/:id/gsd/bootstrap` | operator |
| Advance project shell | POST | `/api/projects/:id/gsd/transition` | operator |
| Read lifecycle graph | GET | `/api/projects/:id/gsd/lifecycle-graph` | viewer |
| List or create workstreams | GET / POST | `/api/projects/:id/gsd/workstreams` | viewer / operator |
| Patch workstream | PATCH | `/api/projects/:id/gsd/workstreams/:ws_id` | operator |
| Complete workstream | POST | `/api/projects/:id/gsd/workstreams/:ws_id/complete` | operator |
| List or create milestones | GET / POST | `/api/projects/:id/gsd/milestones` | viewer / operator |
| Patch milestone | PATCH | `/api/projects/:id/gsd/milestones/:milestone_id` | operator |
| Complete milestone | POST | `/api/projects/:id/gsd/milestones/:milestone_id/complete` | operator |
| List or create phases | GET / POST | `/api/gsd/milestones/:milestone_id/phases` | viewer / operator |
| Patch phase | PATCH | `/api/gsd/phases/:phase_id` | operator |
| Transition phase | POST | `/api/gsd/phases/:phase_id/transition` | operator |
| List or create plans | GET / POST | `/api/gsd/phases/:phase_id/plans` | viewer / operator |
| Patch plan | PATCH | `/api/gsd/plans/:plan_id` | operator |
| Transition plan | POST | `/api/gsd/plans/:plan_id/transition` | operator |
| Approve or reject gate | PATCH | `/api/tasks/:id/gate` | operator |
| Watch events | GET | `/api/events` | viewer |

---

## 10. When to use what

- **Agent just needs work items?** Use task queue and task CRUD. You may never touch hierarchy endpoints directly.
- **Operator is structuring a real project?** Use the Lifecycle tab or REST hierarchy endpoints.
- **Agent is coordinating multiple tracks in one project?** Use the lifecycle graph as the read model and subscribe to `gsd.*` SSE events.
- **You still rely on legacy gate tasks?** Bootstrap and use the project shell plus `PATCH /api/tasks/:id/gate`.
- **You need headless automation today?** Use the dedicated `mc projects ...` and `mc gsd ...` wrappers first; fall back to REST or `mc raw` for anything not yet wrapped.

---

## 11. Where the authoritative spec lives

- **Hierarchy read model:** `src/app/api/projects/[id]/gsd/lifecycle-graph/route.ts`
- **Hierarchy validation:** `src/lib/validation.ts`
- **Hierarchy rules and helpers:** `src/lib/gsd-hierarchy.ts`
- **Hierarchy event types:** `src/lib/event-bus.ts`
- **Legacy shell transitions:** `src/app/api/projects/[id]/gsd/transition/route.ts`
- **Legacy bootstrap:** `src/app/api/projects/[id]/gsd/bootstrap/route.ts`
- **Lifecycle UI:** `src/components/project/lifecycle/lifecycle-view.tsx` and `src/components/project/lifecycle/lifecycle-hierarchy.tsx`
- **Phase 10 design record:** `.planning/phases/10-multi-gsd-per-project/`

Keep this guide aligned with those files. They are the real source of truth for Phase 10 behavior.
