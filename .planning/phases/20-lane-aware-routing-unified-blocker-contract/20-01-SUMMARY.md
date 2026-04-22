---
phase: 20-lane-aware-routing-unified-blocker-contract
plan: 01
subsystem: scheduler
tags: [task-dispatch, auto-routing, gsd-lane, route-reason, better-sqlite3]

# Dependency graph
requires:
  - phase: 19-project-scoped-queue-plan-activation
    provides: gsd_plans.status lifecycle + plan activation emits inbox/assigned + gsd_plan_id column on tasks
provides:
  - autoRouteInboxTasks is lane-aware: legacy inbox rows linked to gsd_plans.status='in_progress' route first
  - auto_route_lane_scoped / auto_route_legacy_fallback reason values on task.status_changed
  - concurrent-modification guard (WHERE id = ? AND status = 'inbox') on primary + alt agent UPDATE
  - route_reason metadata on logActivity('task_auto_routed', ...)
  - recipe fast-path block (lines 1083-1111) proved byte-for-byte unchanged (COMPAT-02)
affects:
  - 20-02 unified blocker transition contract (shares task-dispatch scheduler tick)
  - 20-03 Phase 20 docs/reconcile (reason vocabulary expanded)
  - Phase 23 ACCEPT-01 end-to-end "automatic unless blocker" loop (lane preference is a pre-req)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-pass SELECT with variable-length IN-list via dynamic placeholder generation (better-sqlite3 idiom)"
    - "Route-reason metadata enum: auto_route_recipe | auto_route_lane_scoped | auto_route_legacy_fallback"
    - "Pre-existing concurrent-modification guard lifted from alt-agent branch onto primary branch"
    - "Lane-aware routing preference: plan membership > priority across passes; priority still dominates within a pass"

key-files:
  created:
    - ".planning/phases/20-lane-aware-routing-unified-blocker-contract/20-01-SUMMARY.md"
  modified:
    - "src/lib/task-dispatch.ts (autoRouteInboxTasks — legacy branch only; recipe fast-path untouched)"
    - "src/lib/__tests__/task-dispatch-autoroute.test.ts (+7 new cases, pre-existing 6 untouched)"

key-decisions:
  - "Two prepared statements (lane-scoped + unscoped fallback) instead of one SELECT with OR — clearer read, matches plan's CLAUDE discretion default."
  - "Lane-scoped SELECT dropped entirely when activePlanIds.length === 0 (skips a roundtrip when no plans in_progress)."
  - "Unscoped pass excludes lane-consumed rows via id NOT IN (...) belt-and-suspenders; status='inbox' guard alone would suffice but explicit exclude is robust against subtle race windows."
  - "Legacy message format: recipe-tagged prefix preserved verbatim for /Routed\\s+\\d+\\s+recipe-tagged/i regex; breakdown (N lane-scoped, M fallback) appended only when routed > 0."
  - "Per-row UPDATE guard (WHERE id = ? AND status = 'inbox') added on BOTH primary and alt-agent branches; broadcasts only fire when changes > 0."

patterns-established:
  - "Route-reason enum pattern: every auto-route emission carries a reason discriminator consumers can filter on (extending auto_route_recipe with lane/fallback values)."
  - "Hierarchy-seed helper (insertPlanHierarchy) for unit tests that only need a valid gsd_plans row — seeds workstream → milestone → phase → plan once, returns {plan_id, phase_id}."

requirements-completed:
  - ROUTE-01
  - COMPAT-02

# Metrics
duration: ~14min
completed: 2026-04-21
---

# Phase 20 Plan 01: Lane-Aware Default Auto-Routing Summary

**autoRouteInboxTasks now prefers legacy inbox rows linked to in_progress plans over unscoped rows, emits auto_route_lane_scoped / auto_route_legacy_fallback reason metadata on task.status_changed, and keeps the recipe fast-path block byte-for-byte unchanged.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-21T22:08Z
- **Completed:** 2026-04-21T22:22Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Two-pass lane-aware legacy SELECT inside autoRouteInboxTasks: lane-scoped rows (linked to gsd_plans.status='in_progress') route first, capped at 5; unscoped rows fill remaining budget.
- Every legacy-path task.status_changed emission now carries reason = 'auto_route_lane_scoped' | 'auto_route_legacy_fallback'; recipe fast-path continues to emit reason = 'auto_route_recipe'.
- Concurrent-modification guard (WHERE id = ? AND status = 'inbox') added to primary + alt-agent UPDATE; broadcasts only fire when changes > 0.
- 7 new Vitest cases cover lane preference, within-pass priority dominance, empty-active-plan fallback, 5-row batch cap, non-in_progress plan exclusion, concurrent-modification safety, and recipe fast-path regression.
- Recipe fast-path block at lines 1083-1111 is untouched — diff hunks start at line 1112, confirming COMPAT-02 lock.

## Task Commits

Each task was committed atomically:

1. **Task 1: Two-pass lane-aware legacy routing in autoRouteInboxTasks** — `459ba5d` (feat)
2. **Task 2: Vitest coverage for lane preference, fallback, reason metadata, and recipe-path regression** — `0dbf24d` (test)

## Files Created/Modified
- `src/lib/task-dispatch.ts` — autoRouteInboxTasks legacy branch rewritten as two-pass (lane-scoped + unscoped fallback); route_reason metadata on broadcasts + logActivity; UPDATE guard on both primary + alt agent branches. Recipe fast-path + scoring + capacity logic unchanged.
- `src/lib/__tests__/task-dispatch-autoroute.test.ts` — Added `insertPlanHierarchy`, `insertLaneTask`, `seedAgent` helpers; added `describe('autoRouteInboxTasks — lane-aware legacy routing (ROUTE-01)', …)` with 7 cases. Pre-existing 6 recipe-path cases unchanged and still pass.

## Decisions Made
- Two prepared statements over one OR'd SELECT (plan's recommended default; clearer read + predictable parameter binding).
- `id NOT IN (...)` guard on pass 2 is belt-and-suspenders — the `status='inbox'` guard on the per-row UPDATE already prevents double-routing, but the explicit exclude is robust.
- Return-message breakdown (`N lane-scoped, M fallback`) is appended ONLY when `routed > 0`; the recipe-tagged prefix is preserved verbatim so the existing regex continues to match.
- `seedAgent` helper was added because migrations do NOT seed any agents — the existing `scoreAgentForTask` returns at least 1 for any non-offline agent, so one idle agent is enough to route every lane-aware test.

## Deviations from Plan

None — plan executed exactly as written.

The plan called for a `seedAgent` helper implicitly (the existing 5 recipe-path tests already either delete all agents or rely on the runner fast-path). Adding it was a natural extension of the test-helper surface, not a deviation — the plan's test cases all assume at least one eligible agent.

## Issues Encountered

- **First test run** (after adding tests): 5 of 7 new cases failed because no agent was seeded — the lane-aware legacy tests require an idle agent for `scoreAgentForTask` to return a non-zero score. Added a `seedAgent(name, role)` helper and a single `seedAgent('agent-1')` call to each affected test. All 13 tests (6 existing + 7 new) now pass.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Lane-aware routing primitive is in place for Plan 20-02 (unified blocker contract) and Plan 20-03 (reconcile docs / reason vocabulary) to build on.
- No migrations or schema changes — purely additive runtime behavior gated on existing Phase 19 columns (`tasks.gsd_plan_id`, `gsd_plans.status`).
- ACCEPT-01 (Phase 23) end-to-end test can assert the lane-scoped reason fires after a plan transition without new instrumentation — this phase emits it on the existing `task.status_changed` bus.

## Self-Check: PASSED

- [x] `src/lib/task-dispatch.ts` contains `auto_route_lane_scoped` — verified.
- [x] `src/lib/__tests__/task-dispatch-autoroute.test.ts` contains `auto_route_legacy_fallback` — verified.
- [x] `459ba5d` exists in git log — verified.
- [x] `0dbf24d` exists in git log — verified.
- [x] `pnpm typecheck` exits 0 — verified (ran at end of Task 2).
- [x] `pnpm lint src/lib/task-dispatch.ts` exits 0 (12 pre-existing warnings unrelated to this plan) — verified.
- [x] `pnpm vitest run src/lib/__tests__/task-dispatch-autoroute.test.ts` passes — 13/13 green (6 pre-existing + 7 new).
- [x] Recipe fast-path diff check: all `git diff` hunks start at line 1112 or later — lines 1083-1111 are untouched.

---
*Phase: 20-lane-aware-routing-unified-blocker-contract*
*Completed: 2026-04-21*
