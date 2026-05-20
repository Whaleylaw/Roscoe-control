# GSD Finish-Up Punch List (Queue + Blocker Automation)

Date: 2026-04-21
Scope: `/Users/aaronwhaley/Github/mission-control`
Baseline concept reference: `get-shit-done-main` (local path under this repo)

## 1) What is already true (verified)

- Queue mechanics exist and are atomic at workspace scope:
  - `src/app/api/tasks/queue/route.ts`
- Scheduler auto-routes + dispatches + reviews + stale requeue:
  - `src/lib/scheduler.ts`
  - `src/lib/task-dispatch.ts`
- GSD hierarchy primitives exist (workstreams/milestones/phases/plans + transitions + conflicts):
  - `src/app/api/gsd/**`
  - `src/app/api/projects/[id]/gsd/**`
  - `src/lib/gsd-hierarchy.ts`, `src/lib/gsd-conflicts.ts`

## 2) Confirmed gaps vs desired behavior

Desired behavior from your note: tasks should route automatically through project queue, and only stop for explicit blockers/user intervention.

### Gap A — queue is workspace-level, not project/plan scoped

- `GET /api/tasks/queue` does not accept `project_id`, `gsd_plan_id`, or `wave` filters.
- Selection is from `status IN ('assigned','inbox')` across workspace.
- Result: no deterministic “project task queue lane” for autonomous lifecycle execution.

### Gap B — plan transitions do not automatically activate execution tasks

- `POST /api/gsd/plans/:id/transition` updates plan status and emits events.
- It does **not** project plan status changes into task queue state transitions (e.g., activate plan tasks into inbox/assigned).
- Result: hierarchy and execution queue are loosely coupled.

### Gap C — auto-routing is affinity-based, not lifecycle-aware

- `autoRouteInboxTasks()` routes legacy inbox tasks by role keyword scoring.
- It does not enforce plan-level wave/dependency readiness during assignment.
- Result: execution order can drift from lifecycle intent unless manually controlled.

### Gap D — blocker path is uneven across execution modes

- Recipe-runner path has explicit blocked checkpoint mechanics (`awaiting_owner`, blocker reason flow).
- Legacy dispatch path lacks equivalent first-class “blocked -> awaiting_owner -> resume” semantics driven by agent checkpoints.
- Result: blocker handling is strong in runtime path, weaker in generic dispatch path.

### Gap E — MCP wrappers still under-expose task routing fields

- `mc_create_task` schema currently omits key routing fields (`project_id`, `gsd_*_id`, gate fields, explicit status, metadata).
- API supports richer fields; MCP wrapper lags.
- Result: agent operators cannot fully drive queue semantics through MCP without falling back to raw calls.

### Gap F — doc drift still present

- `docs/GSD-MODEL-COMPARISON.md` has contradictory rows:
  - rows claiming gap for wave conflicts/wrappers
  - later section stating those are closed
- Runtime docs harness currently fails due stale links:
  - `docs/runtime/INDEX.md` links to old `.planning` paths
  - `node scripts/verify-runtime-docs.mjs` fails with 2 link errors

## 3) Priority patch plan (for Claude/Codex)

## P0 — Make queue execution project-aware and blocker-safe

### P0.1 Add project-scoped queue filtering

Files:
- `src/app/api/tasks/queue/route.ts`
- `openapi.json`
- `scripts/mc-cli.cjs`
- `scripts/mc-mcp-server.cjs`
- `tests/task-queue.spec.ts`

Changes:
- Add optional query params: `project_id`, `gsd_plan_id` (and optionally `wave` via join).
- Apply filters consistently to:
  - current in-progress lookup
  - capacity checks
  - atomic claim subquery
- Keep backward compatibility when params absent.

Acceptance:
- Queue poll with `project_id` only returns/claims tasks from that project.
- Existing queue behavior unchanged without filters.

### P0.2 Couple plan activation to queue state

Files:
- `src/app/api/gsd/plans/[plan_id]/transition/route.ts`
- `src/lib/task-dispatch.ts` (small helper if needed)
- tests under `src/app/api/gsd/__tests__/`

Changes:
- On `to_status='in_progress'`, transition linked execution tasks (`gsd_plan_id=planId`) from backlog/todo-style states into queue-entering state (`inbox` or `assigned` based on assignee).
- Emit explicit event (e.g., `gsd.plan.tasks_activated`) with counts.

Acceptance:
- Transitioning a plan to `in_progress` makes its executable tasks claimable without manual status edits.
- Dependencies/gate/wave checks still enforced before activation.

### P0.3 Unify blocker semantics for non-recipe dispatch

Files:
- `src/lib/task-dispatch.ts`
- `src/lib/task-checkpoints.ts`
- `src/app/api/tasks/[id]/route.ts` (if status rules need extension)
- relevant tests in `src/lib/__tests__/phase-15*` or new tests

Changes:
- Support checkpoint-driven blocker transitions for legacy dispatch too:
  - `in_progress -> awaiting_owner`
  - require structured `blocker_reason`
  - preserve retry/resume metadata
- Add deterministic resume behavior when owner action clears blocker.

Acceptance:
- A dispatched task can cleanly pause for user intervention and resume with blocker context, same as runner path.

## P1 — Close agent-surface and doc drift

### P1.1 Expand MCP task schema to include routing/lifecycle fields

Files:
- `scripts/mc-mcp-server.cjs`
- docs: `docs/cli-agent-control.md`, `docs/agent-gsd-guide.md`

Changes:
- Extend `mc_create_task` and `mc_update_task` schemas/handlers for:
  - `project_id`, `status`, `metadata`
  - `gsd_workstream_id`, `gsd_milestone_id`, `gsd_phase_id`, `gsd_plan_id`
  - `gate_required`, `gate_status` (if API allows direct set)

Acceptance:
- MCP-only agent can create properly linked, queue-ready, project-scoped tasks without raw endpoint fallback.

### P1.2 Fix contradictory docs and stale runtime links

Files:
- `docs/GSD-MODEL-COMPARISON.md`
- `docs/runtime/INDEX.md`

Changes:
- Resolve matrix contradictions (rows 51–52 vs later “closed” claims).
- Repoint links to current paths:
  - `.planning/milestones/v1.2-MILESTONE-AUDIT.md`
  - `.planning/milestones/v1.2-REQUIREMENTS.md`
  (or restore old files if intentionally required)

Acceptance:
- `node scripts/verify-runtime-docs.mjs` passes.
- No internal contradictions in GSD comparison doc.

## P2 — Hardening and confidence

### P2.1 Replace high-value `it.todo` with executable tests (queue/lifecycle first)

Focus files:
- `src/components/project/__tests__/dashboard-view.test.tsx`
- `src/lib/__tests__/project-{breadcrumb,tabs,workspace}.test.ts`
- add/expand queue + transition integration tests

Acceptance:
- Critical lifecycle + queue behaviors covered by executable tests, not placeholders.

## 4) Conceptual match vs get-shit-done-main

`get-shit-done-main` emphasizes:
- autonomous phase flow
- wave/dependency ordering
- only pausing on explicit checkpoints/blockers

Mission Control now has the data model and most primitives, but still lacks one deterministic bridge:

**hierarchy transition -> task queue activation -> project-scoped claiming -> blocker pause/resume loop**

That bridge is the core finish-up work.

## 5) Execution order recommendation

1. P0.1 queue scoping
2. P0.2 plan->queue activation
3. P0.3 blocker parity
4. P1.1 MCP schema expansion
5. P1.2 doc/runtime fixes
6. P2 targeted test debt burn-down

---

## Suggested verification command pack

```bash
# from /Users/aaronwhaley/Github/mission-control
pnpm test tests/task-queue.spec.ts
pnpm test src/app/api/gsd/__tests__/phase-plan-routes.test.ts
pnpm test src/lib/__tests__/gsd-conflicts.test.ts
node scripts/verify-runtime-docs.mjs
```

If native module mismatch appears, align Node to `.nvmrc` (22.x) and rebuild:

```bash
nvm use 22
pnpm rebuild better-sqlite3
```
