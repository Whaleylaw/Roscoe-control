# GSD Lifecycle Guide for Agents

Mission Control has a first-class "Get Shit Done" (GSD) lifecycle built into projects. This guide tells an agent everything it needs to spin up a project, walk it through the phases, and handle gate approvals — using the tools the system actually exposes.

**Audience:** autonomous agents (Claude Code, MCP consumers, direct REST callers). Everything below assumes you already have an API key (`MC_API_KEY`) and the base URL (`MC_URL`, default `http://127.0.0.1:3000`).

---

## 1. Mental Model

A GSD-enabled project is a normal Mission Control project with five extra columns:

| Column | Type | Meaning |
|---|---|---|
| `gsd_enabled` | 0/1 | GSD machinery on or off |
| `gsd_track` | enum | Which default task pack to seed: `ops`, `product`, `marketing`, `legal`, `firmvault`, `custom` |
| `gsd_phase` | enum | Current lifecycle phase: `discuss` → `plan` → `execute` → `verify` → `done` |
| `gsd_gate_mode` | enum | `manual_approval` (human approves gates) or `auto_internal` (system auto-approves trusted tracks) |
| `gsd_updated_at` | iso | Last phase transition |

Tasks get two GSD fields of their own:

| Column | Meaning |
|---|---|
| `gsd_phase` | Which phase this task belongs to (`discuss`/`plan`/…) |
| `gate_required` | 1 = task must be approved before it can move to `in_progress` or `done` |
| `gate_status` | `not_required` / `pending` / `approved` / `rejected` |

**The lifecycle is strictly linear.** You cannot skip phases. The server will reject any out-of-order transition with `409 ILLEGAL_TRANSITION`.

```
discuss ──► plan ──► execute ──► verify ──► done
```

Preconditions to advance:

| From → To | Requires |
|---|---|
| `discuss → plan` | ≥1 task in `discuss` phase is `done` |
| `plan → execute` | ≥1 task in `plan` phase is `done` AND its approval-package gate is `approved` |
| `execute → verify` | 0 open execute tasks — *or* body `{ "waive_remaining": true, "reason": "..." }` |
| `verify → done` | ≥1 task in `verify` phase is `done` |

Gate-required tasks cannot move to `in_progress` or `done` until they are approved. The server returns `403 GATE_BLOCKED` otherwise.

---

## 2. Which Tools You Have

Three surfaces are available. Pick one; they all hit the same REST API.

### Surface A — MCP Server (recommended for Claude Code agents)

```bash
claude mcp add mission-control -- node /path/to/mission-control/scripts/mc-mcp-server.cjs
```

Environment:

```
MC_URL=http://127.0.0.1:3000
MC_API_KEY=...
```

MCP exposes 35 tools: `mc_list_agents`, `mc_create_task`, `mc_poll_task_queue`, `mc_update_task`, `mc_session_transcript`, etc. See `docs/cli-agent-control.md` for the full list.

**Important:** GSD-specific endpoints (project create with GSD fields, bootstrap, transition, gate approval) **are not yet wrapped as dedicated MCP tools**. For those, use one of:

- The CLI (Surface B) — named wrappers: `mc projects create|bootstrap|transition`, `mc tasks gate`
- The REST API directly (see Surface C)
- The `mc_raw` tool if your MCP client exposes it

Task CRUD (`mc_create_task`, `mc_update_task`, `mc_poll_task_queue`) already respects GSD fields — you can set `gsd_phase` and `gate_required` via the task body.

### Surface B — CLI

```bash
pnpm mc agents list --json
pnpm mc tasks queue --agent Aegis --max-capacity 2 --json
pnpm mc events watch --types agent,task,project
pnpm mc projects bootstrap --id 42 --json
pnpm mc projects transition --id 42 --to plan --json
pnpm mc tasks gate --id 105 --approve --note "Plan reviewed"
```

Named wrappers exist for every GSD endpoint. The `raw` subcommand remains available as an escape hatch for anything the CLI doesn't yet wrap.

### Surface C — REST API

Direct HTTP with bearer auth:

```bash
curl -H "Authorization: Bearer $MC_API_KEY" \
     -H "Content-Type: application/json" \
     "$MC_URL/api/projects"
```

Full OpenAPI spec: `openapi.json`. Interactive docs at `$MC_URL/docs`.

Required role for all GSD mutations: **operator** or **admin**. Viewers get 403.

---

## 3. End-to-End Walkthrough

The canonical agent flow: create a project, bootstrap the default task pack, work through phases, approve gates, finish.

### Step 1 — Create a GSD-enabled project

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

```bash
# CLI equivalent:
pnpm mc projects create --name "Q2 Pricing Migration" --prefix PRI --gsd --track product --gate-mode manual_approval --json
```

Response includes `id`, `slug`, and all GSD columns. `gsd_phase` defaults to `discuss`.

**Common errors:**
- 400 `Invalid gsd_track` — must be one of `ops`, `product`, `marketing`, `legal`, `firmvault`, `custom`
- 400 `Invalid gsd_gate_mode` — must be `manual_approval` or `auto_internal`

### Step 2 — Bootstrap the default task pack

This seeds the starter tasks for the chosen track. Idempotent — running it twice is a no-op on the second call.

```bash
curl -X POST "$MC_URL/api/projects/42/gsd/bootstrap" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

```bash
# CLI equivalent:
pnpm mc projects bootstrap --id 42 --json
```

Response:

```json
{ "created": 8, "skipped": 0, "tasks": [ /* 8 task objects */ ] }
```

Default template structure (8 tasks across 4 phases):

```
discuss:  DISCUSS-01 Clarify goal / scope / success criteria
          DISCUSS-02 Identify constraints and risks
plan:     PLAN-01    Draft implementation plan
          PLAN-02    Approval package               (gate_required=1)
execute:  EXEC-01    Core implementation
          EXEC-02    Integration tasks              (gate_required=1)
verify:   VERIFY-01  Verify acceptance criteria
          VERIFY-02  Ship / readout
```

If `.data/gsd-templates/<track>.json` exists on disk, it overrides the default. Missing file → server falls back to `DEFAULT_TEMPLATE`.

### Step 3 — Work the discuss phase

Pick up discuss tasks via the queue:

```bash
pnpm mc tasks queue --agent scout --max-capacity 1 --json
# or MCP: mc_poll_task_queue({ agent: "scout", max_capacity: 1 })
```

Update status as work progresses:

```bash
pnpm mc tasks update --id 101 --body '{"status":"in_progress"}'
# ...do the work...
pnpm mc tasks update --id 101 --body '{"status":"done"}'
```

Once ≥1 discuss task is `done`, you can advance.

### Step 4 — Transition to plan

```bash
curl -X POST "$MC_URL/api/projects/42/gsd/transition" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "to_phase": "plan" }'
```

```bash
# CLI equivalent:
pnpm mc projects transition --id 42 --to plan --json
```

Response:

```json
{ "ok": true, "from_phase": "discuss", "to_phase": "plan", "project": { ... } }
```

**If preconditions aren't met:**

```json
{
  "error": "Cannot transition from discuss to plan",
  "code": "DISCUSS_REQUIRES_ONE_DONE"
}
```

Error codes: `ILLEGAL_TRANSITION`, `DISCUSS_REQUIRES_ONE_DONE`, `PLAN_REQUIRES_APPROVED_PACKAGE`, `EXECUTE_TASKS_INCOMPLETE`, `VERIFY_REQUIRES_ONE_DONE`, `PROJECT_NOT_FOUND`.

### Step 5 — Plan phase + approve the gate

Work plan tasks the same way. `PLAN-02` is `gate_required=1`. Agents can mark it `done` only *before* the gate check blocks further movement — but to transition the project to `execute`, the gate must be approved.

To approve a gate (operator/admin only):

```bash
curl -X PATCH "$MC_URL/api/tasks/105/gate" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "gate_status": "approved", "note": "Plan reviewed by Aegis" }'
```

```bash
# CLI equivalent:
pnpm mc tasks gate --id 105 --approve --note "Plan reviewed by Aegis"
# Reject:
pnpm mc tasks gate --id 105 --reject --note "Scope unclear"
```

This records `gate_approved_by` + `gate_approved_at` and broadcasts both `task.gate.changed` and `task.updated` SSE events.

To reject instead: `{ "gate_status": "rejected", "note": "Scope unclear" }`. The task can then be iterated on and re-approved.

### Step 6 — Transition plan → execute

Requires: plan task done AND its gate approved.

```bash
curl -X POST "$MC_URL/api/projects/42/gsd/transition" \
  -d '{ "to_phase": "execute" }' ...
```

### Step 7 — Execute phase

Now you do the actual implementation work. `EXEC-02` has `gate_required=1` — useful for "integration must be reviewed before merge" checkpoints. Same gate approval flow as Step 5.

When ready to advance:

```bash
# Normal path — all execute tasks done:
curl -X POST .../gsd/transition -d '{ "to_phase": "verify" }'

# Waiver path — some tasks still open, but you have a reason:
curl -X POST .../gsd/transition -d '{
  "to_phase": "verify",
  "waive_remaining": true,
  "reason": "Remaining tasks moved to follow-up project"
}'
```

```bash
# CLI equivalent:
pnpm mc projects transition --id 42 --to verify --waive --reason "Remaining tasks moved to follow-up project" --json
```

`reason` is **required** when `waive_remaining: true`.

### Step 8 — Verify → done

Complete at least one verify task, then:

```bash
curl -X POST .../gsd/transition -d '{ "to_phase": "done" }'
```

Project is now complete. `gsd_phase = done` is terminal — further transitions return 409.

---

## 4. Task Body Reference

When creating tasks programmatically, GSD fields live directly on the task body:

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

Read them back with:

```bash
curl "$MC_URL/api/tasks/105" -H "Authorization: Bearer $MC_API_KEY"
```

Returns `gsd_phase`, `gate_required`, `gate_status`, `gate_approved_by`, `gate_approved_at` alongside the usual task fields.

---

## 5. Events Your Agent Can Subscribe To

All GSD mutations broadcast over SSE (`GET /api/events`). Watch with:

```bash
pnpm mc events watch --types project,task --json
```

GSD-specific event types:

| Event | Fires when | Payload includes |
|---|---|---|
| `project.gsd.transition` | Phase advances | `{ project_id, from_phase, to_phase, reason?, waive_remaining? }` |
| `task.gate.changed` | Gate approved/rejected | `{ task_id, project_id, gate_status, approved_by }` |
| `task.updated` | Any task mutation (incl. gate changes — dual broadcast) | full task row |
| `activity.created` | Any audited action → live feed | `{ type, actor, target, timestamp }` |

**Why dual broadcast on gate changes?** `task.gate.changed` is the semantic event; `task.updated` lets existing listeners (task board, queue watchers) refresh without new handlers.

---

## 6. Common Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| 403 on bootstrap/transition/gate | Using a viewer-role key | Use operator or admin key |
| 409 ILLEGAL_TRANSITION | Tried to skip a phase | Transitions are strictly linear; hit intermediate phases first |
| 409 DISCUSS_REQUIRES_ONE_DONE etc. | Phase precondition not met | Mark a phase task `done` first |
| 403 GATE_BLOCKED on task status change | Trying to move gate-required task forward without approval | `PATCH /api/tasks/:id/gate` first |
| Bootstrap returns `created: 0, skipped: 8` | Already bootstrapped | Expected — idempotent |
| 400 Invalid gsd_track | Typo or unsupported track | Use `ops`/`product`/`marketing`/`legal`/`firmvault`/`custom` |
| Template not loading from disk | Missing file | Server falls back to `DEFAULT_TEMPLATE` silently — check `gsd-templates.ts` DEFAULT for expected shape |

---

## 7. Quick Reference — Endpoint Matrix

| Action | Method | Path | Role |
|---|---|---|---|
| Create GSD project | POST | `/api/projects` + `gsd_enabled:true` | operator |
| Update project GSD settings | PATCH | `/api/projects/:id` | operator |
| Bootstrap default tasks | POST | `/api/projects/:id/gsd/bootstrap` | operator |
| Advance phase | POST | `/api/projects/:id/gsd/transition` | operator |
| Approve/reject task gate | PATCH | `/api/tasks/:id/gate` | operator |
| Read project (incl. GSD cols) | GET | `/api/projects/:id` | viewer |
| Read task (incl. gate state) | GET | `/api/tasks/:id` | viewer |
| Watch GSD events | GET | `/api/events` (SSE) | viewer |

---

## 8. When to Use What

- **Agent just needs to pick up and work tasks?** Use `mc_poll_task_queue` + `mc_update_task`. You never touch the GSD endpoints directly.
- **Agent is spinning up a new initiative?** POST to `/api/projects` with `gsd_enabled:true`, then POST to `/gsd/bootstrap`, then work tasks.
- **Agent is coordinating multiple sub-agents through a lifecycle?** Subscribe to `project.gsd.transition` and `task.gate.changed` via SSE. Gate transitions are your cue to wake the next agent in the chain.
- **Agent is the reviewer (Aegis-style)?** You're the one calling `PATCH /api/tasks/:id/gate` after inspecting plan/integration deliverables.

---

## 9. Where the Authoritative Spec Lives

- **Lifecycle rules:** `src/app/api/projects/[id]/gsd/transition/route.ts` (top-level comment has all 5 preconditions)
- **Bootstrap behavior:** `src/app/api/projects/[id]/gsd/bootstrap/route.ts` + `src/lib/gsd-templates.ts`
- **Gate enforcement hook:** `src/app/api/tasks/[id]/route.ts` (PUT handler — the `GATE_BLOCKED` path)
- **Validation schemas:** `src/lib/validation.ts` §GSD (enum values, body shapes)
- **Event type union:** `src/lib/event-bus.ts`
- **Full OpenAPI:** `openapi.json`
- **Phase design record:** `.planning/phases/09-gsd-native-integration/` (RESEARCH.md, VERIFICATION.md, per-plan SUMMARYs)

Keep this guide in sync with those files — they are the source of truth.
