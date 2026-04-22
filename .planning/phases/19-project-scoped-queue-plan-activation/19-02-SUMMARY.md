---
phase: 19-project-scoped-queue-plan-activation
plan: 02
subsystem: api
tags: [better-sqlite3, gsd, plan-transition, event-bus, queue-activation, zod, QUEUE-02]

# Dependency graph
requires:
  - phase: 09-gsd-native-integration
    provides: plan-transition route, gate/dependency/wave-conflict guards, canTransitionGsdPlanStatus
  - phase: 11-runtime-foundation-v1-2
    provides: tasks.recipe_slug column, tasks.gsd_plan_id column, agents.status enum
provides:
  - Spec-compliant QUEUE-02 activation side effect on POST /api/gsd/plans/:id/transition
  - Full queue_activation payload (activated, already_active, skipped_by_state, reassigned, by_status, task_ids) on both response and event
  - gsd.plan.tasks_activated event literal added to EventType union
  - Single-transaction atomicity for plan status flip + task activations
  - Assignee/recipe routing with dead-assignee recovery
affects:
  - phase: 19-project-scoped-queue-plan-activation (plans 19-03..19-05: CLI/MCP/OpenAPI surface)
  - phase: 20 (ROUTE-01 lane-aware router consumes queue_activation semantics)
  - phase: 23 (ACCEPT-01 end-to-end test asserts queue_activation shape)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "db.transaction(() => { ... })() wraps a multi-statement SQLite mutation; return value propagates out of the IIFE call"
    - "Bucket-and-count pattern: fetch ALL linked rows once, then partition into counters in a single pass, emit counters in the response and event with identical shape"
    - "Dead-assignee predicate for agents schema: `agents.status = 'error'` OR 'no matching row' is the terminal state (transient offline/idle/busy NOT terminal)"
    - "Recipe-alone branch: route to 'assigned' while preserving assigned_to = null so the runner-token principal claims by recipe slug (v1.2 sentinel convention)"

key-files:
  created:
    - .planning/phases/19-project-scoped-queue-plan-activation/19-02-SUMMARY.md
  modified:
    - src/app/api/gsd/plans/[plan_id]/transition/route.ts
    - src/lib/event-bus.ts
    - src/app/api/gsd/__tests__/phase-plan-routes.test.ts

key-decisions:
  - "Dead-assignee predicate: agents.status = 'error' OR no matching agent row. The agents table does not have a 'disabled' state (enum is offline|idle|busy|error), so CONTEXT.md's disabled predicate is mapped to 'error' for Phase 19. Transient states (offline/idle/busy) are NOT treated as terminal."
  - "Per-task task.status_changed broadcast DROPPED. The WIP emitted one per activated task with reason='plan_activated'; a grep of src/ found no consumer keying on that reason string, so the activation is now atomic from an SSE observer's perspective (only gsd.plan.tasks_activated + gsd.plan.transitioned fire)."
  - "Re-entry idempotence test uses in_progress -> review -> in_progress (not blocked), because GsdPlanStatus does not include 'blocked'. NEXT_GSD_PLAN_STATUSES for in_progress are review/done/failed; review -> in_progress is legal."
  - "Plan status UPDATE moved INSIDE the db.transaction() wrapper so a thrown UPDATE in the task loop rolls the plan flip back too (CONTEXT.md atomicity decision)."
  - "Recipe-alone tasks route to 'assigned' with assigned_to = null — preserves the v1.2 runner-token sentinel convention and avoids synthesizing a fake agent row."

patterns-established:
  - "EventType union literal MUST be appended in the SAME commit as the broadcast call site to keep pnpm typecheck green between commits"
  - "Four-counter bucketing (activated, already_active, skipped_by_state, reassigned) is the canonical shape for any future plan-side-effect endpoints; by_status{inbox,assigned} breaks down the activated count; task_ids mirror-for-length activated"
  - "Async event payload MUST match HTTP response payload shape so CLI/MCP callers and SSE observers see the same data"

requirements-completed:
  - QUEUE-02

# Metrics
duration: 5min
completed: 2026-04-22
---

# Phase 19 Plan 02: Plan-Driven Task Activation Summary

**POST /api/gsd/plans/:id/transition now auto-activates linked backlog/todo tasks into inbox or assigned with a four-counter queue_activation payload, single-transaction atomicity, and a gsd.plan.tasks_activated event mirroring the response shape.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-22T01:16:05Z
- **Completed:** 2026-04-22T01:20:35Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Rewrote the `in_progress` activation branch on the plan-transition route to match the CONTEXT.md locked decisions (strict source set `{backlog, todo}`, assignee/recipe routing, dead-assignee recovery, four-counter payload, single transaction).
- Extended `EventType` union in `src/lib/event-bus.ts` with `'gsd.plan.tasks_activated'` so the new broadcast is strict-type-clean.
- Replaced the pre-spec WIP test with seven targeted vitest cases that exercise source-state filtering, routing (three branches), already_active idempotence, re-entry idempotence, the gate-blocked pre-write guard, event-payload shape, and non-in_progress null-return behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite activation block with spec-compliant counters, routing, and transaction** — `439905a` (feat)
2. **Task 2: Vitest unit coverage for activation counters, routing, and idempotence** — `077bb07` (test)

## Files Created/Modified
- `src/app/api/gsd/plans/[plan_id]/transition/route.ts` — Replaced the `toStatus === 'in_progress'` branch with a `QueueActivation` type, `db.transaction()` wrapper, bucket-and-count pass over ALL plan-linked tasks, recipe/assignee routing with dead-assignee recovery, post-commit `gsd.plan.tasks_activated` broadcast. Non-in_progress transitions keep the existing UPDATE-outside-transaction path and return `queue_activation: null`.
- `src/lib/event-bus.ts` — Appended `'gsd.plan.tasks_activated'` literal to the `EventType` union.
- `src/app/api/gsd/__tests__/phase-plan-routes.test.ts` — Removed the WIP test and added seven new cases.

## Decisions Made
- **Dead-assignee predicate:** `agents.status = 'error'` OR no matching agent row. CONTEXT.md specified `status = 'disabled'`, but the agents table enum is `offline|idle|busy|error` — no `disabled` value exists. Treating `error` as the terminal state is the closest semantic match; transient states (offline/idle/busy) are deliberately NOT treated as dead because agents may legitimately come back.
- **Per-task `task.status_changed` broadcast dropped.** A grep of `src/` showed the `reason: 'plan_activated'` string was only present in the WIP itself — no SSE consumer relies on a per-task signal for activation. Keeping only the bulk `gsd.plan.tasks_activated` event makes the activation atomic from an observer's perspective. The generic `task.status_changed` consumer in `src/lib/use-server-events.ts` still works — it just does not receive one-per-task events during plan activation anymore.
- **Re-entry idempotence test path:** `in_progress -> review -> in_progress`. `GsdPlanStatus` does not include `blocked`; per `NEXT_GSD_PLAN_STATUSES`, the legal transitions out of `in_progress` are `review | done | failed`, and `review -> in_progress` is legal. This preserves the spirit of the CONTEXT.md decision (idempotent re-entry) using the actual state machine.

## Deviations from Plan

None - plan executed exactly as written. The plan itself called out the `disabled` vs `error` agent-schema mismatch and the `blocked` vs `review` state-machine mismatch as research questions for the executor, with documented fallback answers; both chosen answers match the plan's fallbacks.

## Issues Encountered

None. Type-checking, linting (scoped to the two modified source files), and the vitest suite all pass first-try.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- QUEUE-02 is done; the `queue_activation` shape is now contractually locked for Phase 20's lane-aware router (ROUTE-01) and Phase 23's end-to-end acceptance test (ACCEPT-01).
- Remaining Phase 19 plans (19-01, 19-03..19-05) can proceed in parallel; this plan has no blockers on them and they have no blockers on it.
- Deferred follow-ups:
  - No CLI/MCP/OpenAPI surface yet for the new payload — handled by later Phase 19 plans.
  - If a future phase needs a formal `disabled` agent state, the dead-assignee predicate here should be widened accordingly.

## Self-Check: PASSED

File existence:
- FOUND: src/app/api/gsd/plans/[plan_id]/transition/route.ts
- FOUND: src/lib/event-bus.ts
- FOUND: src/app/api/gsd/__tests__/phase-plan-routes.test.ts
- FOUND: .planning/phases/19-project-scoped-queue-plan-activation/19-02-SUMMARY.md

Commit existence:
- FOUND: 439905a (Task 1)
- FOUND: 077bb07 (Task 2)

---
*Phase: 19-project-scoped-queue-plan-activation*
*Completed: 2026-04-22*
