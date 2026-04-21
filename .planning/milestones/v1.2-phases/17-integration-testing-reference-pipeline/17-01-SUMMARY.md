---
phase: 17-integration-testing-reference-pipeline
plan: 01
subsystem: api
tags: [runner-token, review-gate, event-bus, submit-route, aegis, task-status]

# Dependency graph
requires:
  - phase: 11-runtime-foundation-v1-2
    provides: runner-token principal (id=-2000), revokeTokensForTask, atomic-transaction precedent (PUT /api/tasks/:id)
  - phase: 14-runner-container-v1-2
    provides: POST /api/runner/tasks/:task_id/submit route (14-11), Body schema literal 'done', resolution advisory write
  - phase: 15-checkpoints-scheduler-v1-2
    provides: task.status_changed EventType, runAegisReviews() scheduler hook reading WHERE status='review'
provides:
  - submit route flips in_progress → review (not done directly) — runner-token atomically revoked at the flip
  - task.status_changed broadcast with previous_status='in_progress', status='review' emitted after transaction commit
  - 409 idempotency guard extended so re-submits against status='review' return 409 without double-broadcast
  - route-level test enforcing the 6 behavioral invariants (review-flip, atomic revoke, broadcast, cross-task 403, 409 idempotency × 2)
affects: [17-02-RTEST-02-daemon-integration, 17-03-RTEST-02-direct-helpers, 17-04-RTEST-03-crash-recovery, 17-05-RTEST-04-playwright, ROADMAP SC-2 in_progress→review→done flow]

# Tech tracking
tech-stack:
  added: []
  patterns: ["completed_at is NOT set on the review-flip — Aegis owns the final done transition", "runner-token revoked at review-flip (not at Aegis-done) — runner's attempt is done; revision requests mint a new token per Phase 11-04 token-per-attempt model", "broadcast AFTER transaction commits so SSE subscribers never see a transition that later got rolled back"]

key-files:
  created:
    - src/app/api/runner/tasks/[task_id]/submit/__tests__/route.test.ts (rewritten from Plan 14-11 done-flip cases to 6 Phase 17 review-gate cases)
  modified:
    - src/app/api/runner/tasks/[task_id]/submit/route.ts (review-flip + broadcast + extended 409 guard)

key-decisions:
  - "completed_at is NOT set on the review-flip. The Aegis-driven final done transition in runAegisReviews() (src/lib/task-dispatch.ts:414) is the canonical terminal transition. Review is not terminal."
  - "Runner-token is revoked atomically at the review-flip, not deferred to the Aegis-done flip. Rationale: the RUNNER's attempt is done at submit; if Aegis requests revision, the task goes back to 'assigned' and a new claim attempt mints a new token per the Phase 11-04 token-per-attempt invariant."
  - "ALREADY_SETTLED = {'review','done','failed','cancelled'} extends the former TERMINAL_STATUSES set so re-submits against 'review' return 409 idempotently — a network-retry after a successful 204 cannot double-broadcast or re-revoke."
  - "task.status_changed broadcast fires OUTSIDE the db.transaction callback, after commit. Matches the runner-exit precedent (src/app/api/runner/tasks/[task_id]/runner-exit/route.ts lines 287-312) so observers never see a state transition that rolls back."
  - "Body schema is UNCHANGED — agent still POSTs {status:'done'}. 'done' is the agent's declaration of intent; the route translates to 'review'. Keeps the hello-world reference image (docker/hello-world-agent/agent.mjs) and the Phase 14-07 preamble contract stable."

patterns-established:
  - "Review-gate pattern: runner submits 'done' → route flips to 'review' → revokeTokensForTask + broadcast after commit → runAegisReviews() picks up WHERE status='review' → final terminal hop"
  - "Extended-409-idempotency: settled-status set includes non-terminal status 'review' so retries after successful submit are absorbed cleanly"

requirements-completed: [RTEST-02]

# Metrics
duration: 6min
completed: 2026-04-20
---

# Phase 17 Plan 01: Submit Review Gate Summary

**Submit route now flips `in_progress → review` (not `done`) so the existing runAegisReviews() scheduler hop in src/lib/task-dispatch.ts can drive the Aegis-approval final transition. Runner-token revoked atomically with the flip; task.status_changed broadcast after commit with previous_status='in_progress'.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-20T23:00:40Z
- **Completed:** 2026-04-20T23:06:38Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Flipped `src/app/api/runner/tasks/[task_id]/submit/route.ts` from `UPDATE tasks SET status='done'` to `SET status='review'` — opens the Phase 17 SC-2 `in_progress → review → done` Aegis-approval pipeline
- Extended the 409 idempotency guard to include 'review' so runner retries after a successful submit don't double-broadcast or re-revoke
- Added `eventBus.broadcast('task.status_changed', { task_id, status:'review', previous_status:'in_progress', workspace_id:null, at })` AFTER the db.transaction commits — SSE subscribers (UI, runner daemon, RTEST-02 integration tests) see the transition
- Replaced the Plan 14-11 done-flip test file (7 cases) with 6 behavioral cases enforcing the new review-gate semantics — all pass under the Phase 15-07 LOCKED boundary-mock pattern
- Confirmed runAegisReviews() (src/lib/task-dispatch.ts:414) already polls WHERE status='review' — NO scheduler changes required. The submit route is the only hop that changed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Flip submit route from status='done' to status='review'** - `e9e5fc1` (feat)
2. **Task 2: Write route-level unit test enforcing review-flip invariants** - `d5d6739` (test)

## Files Created/Modified
- `src/app/api/runner/tasks/[task_id]/submit/route.ts` - Review-flip + broadcast + extended 409 guard. JSDoc header updated to document the Phase 17 D-01 scope expansion. `completed_at` column assignment removed (review is not terminal).
- `src/app/api/runner/tasks/[task_id]/submit/__tests__/route.test.ts` - Rewritten from 7 Plan 14-11 done-flip cases to 6 Phase 17 review-gate cases. Introduces `broadcastMock` with `mockReset()` in beforeEach for cross-test isolation. Uses existing `issueRunnerToken(db, taskId, attempt, timeoutSeconds)` positional signature (not the object-form the plan sketched — matches the real runner-tokens.ts export).

## Decisions Made

### Locked rules (captured in frontmatter key-decisions)

- **completed_at NOT set on review-flip.** Review is not a terminal status. The Aegis-driven final `done` hop in `runAegisReviews()` owns the terminal transition. Test case 1 asserts `completed_at` stays NULL after the review-flip — any future change that re-introduces `completed_at` at submit-time will break this byte-level assertion.
- **Runner-token revoked at review-flip, not at Aegis-done.** The RUNNER's attempt is done at submit. If Aegis requests revision, the task goes back to `assigned` and a new claim attempt mints a new token per the Phase 11-04 token-per-attempt model. Revoking early prevents a stale bearer from being replayed against any runner-token-allowlisted endpoint during the Aegis window.
- **runAegisReviews() unchanged.** The scheduler hop at `src/lib/task-dispatch.ts:414` already polls `WHERE t.status = 'review'` and drives rows to `done` (approved) / `review` (revision) / `failed` (rejected). Plan 17-01 is the ONLY production-code change required to open the `in_progress → review → done` flow.

### Implementation detail (not a lock — could change without breaking callers)

- **workspace_id=null in the broadcast payload.** The submit route's cached task SELECT only reads `id, status`. Downstream consumers (UI, runner daemon) derive workspace scope from `task_id`, not the broadcast payload. A future refactor that adds `workspace_id` to the SELECT could populate this correctly without schema-breaking any observer.

## Deviations from Plan

### Minor plan-sketch correction (no rule triggered — clarification)

**1. [Clarification] issueRunnerToken signature is positional, not object-form**
- **Found during:** Task 2 (writing the test file)
- **Issue:** Plan 17-01's `read_first` section sketched `issueRunnerToken(testDb, { taskId, attempt, expiresAt })` but the actual export in `src/lib/runner-tokens.ts:38` is `issueRunnerToken(db, taskId, attempt, timeoutSeconds, runnerStartedAtUnix?)` — positional args.
- **Fix:** Used the actual positional signature `issueRunnerToken(testDb, 5, 1, 300)` — matches the pre-existing test pattern at lines 98/119/143/154/160 of the pre-17-01 test file.
- **Files modified:** `src/app/api/runner/tasks/[task_id]/submit/__tests__/route.test.ts`
- **Verification:** All 6 tests pass; typecheck exits 0.
- **Committed in:** `d5d6739` (Task 2 commit)

### Scope boundary observation (NOT fixed, deliberately left alone per Rule 4 scope limits)

- Pre-existing untracked diffs in `src/lib/__tests__/auth-runner-token-principal.test.ts` and `src/lib/__tests__/runner-tokens.test.ts` (both show as `M` in `git status` but have no relation to Plan 17-01). Left uncommitted — the executor neither reviewed nor modified these files. Any downstream plan that touches runner-token auth surface should treat these as a separate pre-existing context to resolve.

---

**Total deviations:** 1 clarification (plan sketch vs actual export signature). No auto-fixes required; no scope expansion beyond the plan's 2-task scope.
**Impact on plan:** Zero — the test file uses the correct signature and all acceptance criteria pass.

## Issues Encountered

- None. Both tasks executed in-order, typecheck and lint clean on the two modified files, all 6 behavioral tests pass on first run.

## User Setup Required

None - no external service configuration required. The Phase 17 D-01 scope expansion is fully internal and requires no operator action.

## Next Phase Readiness

- Plans 17-02 (RTEST-02 daemon-subprocess integration test) and 17-03 (RTEST-02 direct-helpers integration test) can now assert on the `in_progress → review → done` flow. Both plans' test bodies can invoke `runAegisReviews()` directly after observing `task.status_changed` with `status='review'` to drive the final terminal transition.
- Plan 17-05 (RTEST-04 Playwright E2E) will see `status='review'` on the task card during the Aegis-window gap — whatever visual state the UI renders for review-status tasks must be asserted (may require a Phase 16 task-card precedent check before writing the spec).
- No blockers for the remainder of Phase 17. The runAegisReviews() scheduler ticks every 30 seconds (STATE.md 15-02 LOCKED), so integration tests must either (a) directly invoke `runAegisReviews()` or (b) wait up to 30s for the natural tick.

## Self-Check

- `src/app/api/runner/tasks/[task_id]/submit/route.ts` — FOUND (modified, committed in `e9e5fc1`)
- `src/app/api/runner/tasks/[task_id]/submit/__tests__/route.test.ts` — FOUND (rewritten, committed in `d5d6739`)
- Commit `e9e5fc1` — FOUND in `git log`
- Commit `d5d6739` — FOUND in `git log`
- `pnpm typecheck` — EXITS 0
- `pnpm test --run src/app/api/runner/tasks/[task_id]/submit/__tests__/route.test.ts` — 6/6 PASSING

## Self-Check: PASSED

---
*Phase: 17-integration-testing-reference-pipeline*
*Completed: 2026-04-20*
