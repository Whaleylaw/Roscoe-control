# Phase 19 Deferred Items

Out-of-scope issues discovered during plan execution, logged per GSD scope-boundary rules.

## From 19-01 execution (2026-04-21)

### Pre-existing WIP typecheck error in 19-02 scope

**File:** `src/app/api/gsd/plans/[plan_id]/transition/route.ts:197`
**Error:** `TS2345: Argument of type '"gsd.plan.queue_activated"' is not assignable to parameter of type 'EventType'.`
**Scope:** This WIP belongs to Plan 19-02 (QUEUE-02 plan→queue activation). Not touched by Plan 19-01.
**Resolution:** To be addressed when Plan 19-02 executes (that plan owns `EventType` registration for `gsd.plan.queue_activated` / `gsd.plan.tasks_activated`).
**Action:** None — deferred to 19-02.
