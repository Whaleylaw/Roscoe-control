# GSD Parity Diff — Mission Control vs gsd-lawyerinc-main

Date: 2026-04-21

Compared repos:
- Baseline concept/runtime: `/Users/aaronwhaley/Downloads/gsd-lawyerinc-main`
- Current implementation: `/Users/aaronwhaley/Github/mission-control`

---

## 1) What *does* match (or exceed) baseline

1. **Hierarchical lifecycle model exists and is richer in Mission Control**
   - Mission Control has first-class `workstreams -> milestones -> phases -> plans` APIs and conflict checks.
   - Baseline repo is mostly file-driven (`.planning/*.md`) + CLI parser/dispatcher.

2. **Plan transition safety checks are stronger in Mission Control**
   - Gate blockers, dependency blockers, and same-wave conflict blockers (`WAVE_CONFLICT_BLOCKED`) are enforced server-side.

3. **Queue claim path is atomic in Mission Control**
   - `/api/tasks/queue` uses single UPDATE-with-subquery claim ordering by priority/due/created.

4. **Recent P0 bridge progress is real**
   - Plan `in_progress` transition now activates linked tasks (`backlog/awaiting_owner -> inbox`) and returns `queue_activation` payload.
   - Queue polling now supports `project_id` and `gsd_plan_id` filters.

---

## 2) Mismatches against baseline intent (autonomous routing until blockers)

### M1 — Scheduler auto-route is not plan-lane aware by default

**Baseline intent:** execute by wave/phase context from the active plan (`dispatchByWaves`, phase-centric execution in `gsd-execute`).

**Mission Control current:** `autoRouteInboxTasks()` routes globally from `status='inbox'` (recipe fast-path + legacy affinity path) without default `project_id/gsd_plan_id` lane constraints.

Impact:
- Even though queue endpoint supports plan/project filters, scheduler’s default routing step can still assign inbox work across the workspace lane.

---

### M2 — Blocker pause/resume parity is incomplete across execution paths

**Baseline intent:** lifecycle only pauses on explicit blockers/approvals, then resumes deterministically.

**Mission Control current:**
- Recipe/runner path has explicit owner-wait semantics.
- Legacy dispatch path is retry/fail oriented (`assigned <-> in_progress -> failed/review`) and does not provide equivalent structured blocker transitions as first-class behavior.

Impact:
- Automation behavior differs by task path; escalation semantics are less uniform than the model you want.

---

### M3 — MCP task contract still under-exposes queue/lifecycle linkage fields

**Baseline intent:** routing metadata is explicit in config/plan (`task type`, assignee, wave, approval gates, project context).

**Mission Control current MCP:**
- `mc_poll_task_queue` now supports `project_id`/`gsd_plan_id` ✅
- But `mc_create_task`/`mc_update_task` schemas still mainly expose basic fields and not the full project+GSD linkage set used by API for deterministic routing.

Impact:
- Agents can poll scoped lanes, but cannot always create/update fully linked queue-ready tasks via MCP alone.

---

### M4 — Approval/blocker semantics are conceptually present but not consistently normalized

**Baseline intent (`PROJECT.md`, `gsd-verify.js`):** approval gates are explicit lifecycle states and pause points.

**Mission Control current:**
- Has gate enforcement and status model variants (`awaiting_owner`, `review`, etc.), but lifecycle-to-queue-to-owner intervention loop is split across multiple paths.

Impact:
- Behavior is close, but still not the single deterministic “automatic unless blocker” loop across all task types.

---

## 3) Verdict

**Match level: ~75–80% to the baseline intent.**

- Data model and safety guards are stronger than baseline.
- The remaining gap is primarily **operational routing determinism**, not missing primitives.

The critical unfinished piece is still:

> **default scheduler behavior that honors plan/project lanes first, and unified blocker pause/resume semantics across recipe + legacy paths.**

---

## 4) Concrete continuation plan (next pass)

## P1-A (highest): Make scheduler lane-aware by default

Files:
- `src/lib/task-dispatch.ts`
- `src/lib/scheduler.ts` (if needed for context handoff)
- tests: `src/lib/__tests__/task-dispatch-autoroute.test.ts`, `tests/task-queue.spec.ts`

Changes:
1. Restrict legacy `autoRouteInboxTasks()` candidate set to work that is lifecycle-ready:
   - prefer rows with `gsd_plan_id` in active `in_progress` plans,
   - optionally group by project/plan and route within that lane first,
   - only then fall back to unscoped legacy inbox rows.
2. Preserve recipe fast-path behavior.
3. Emit route reason metadata (`auto_route_lane_scoped`, `auto_route_legacy_fallback`).

Acceptance:
- With active plan lanes present, scheduler routes those lanes first (deterministic).
- Global fallback only when no lane-scoped work is eligible.

---

## P1-B: Unify blocker transition contract

Files:
- `src/lib/task-dispatch.ts`
- `src/lib/task-checkpoints.ts`
- task status API routes/tests as needed

Changes:
1. Add structured blocker envelope for legacy dispatch path:
   - `in_progress -> awaiting_owner` with `blocker_reason`, `blocker_kind`, `resume_hint`.
2. Add deterministic resume transition when owner clears blocker.
3. Emit common events for both recipe and legacy paths.

Acceptance:
- Both execution paths support the same owner-intervention pause/resume semantics.

---

## P1-C: MCP create/update parity for routing fields

Files:
- `scripts/mc-mcp-server.cjs`
- docs: `docs/cli-agent-control.md`

Changes:
- Expand `mc_create_task` and `mc_update_task` schema/handlers to include:
  - `project_id`
  - `metadata`
  - `gsd_workstream_id`, `gsd_milestone_id`, `gsd_phase_id`, `gsd_plan_id`
  - any supported gate fields (`gate_required`, `gate_status`) where API permits.

Acceptance:
- Agent can fully create/update lane-scoped lifecycle-linked tasks via MCP (no raw REST fallback needed).

---

## 5) Validation command pack

```bash
# from /Users/aaronwhaley/Github/mission-control
pnpm vitest run src/lib/__tests__/task-dispatch-autoroute.test.ts
pnpm vitest run tests/task-queue.spec.ts
pnpm vitest run src/app/api/gsd/__tests__/phase-plan-routes.test.ts
pnpm vitest run src/lib/__tests__/phase-15-scheduler-integration.test.ts
node scripts/verify-runtime-docs.mjs
```

If needed:

```bash
nvm use 22
pnpm rebuild better-sqlite3
```
