---
phase: 15-checkpoints-scheduler-v1-2
plan: 07
subsystem: testing
tags: [integration, vitest, checkpoints, scheduler, blocker-resume, runner, sse, in-memory-db, typescript]

# Dependency graph
requires:
  - plan: 15-01
    provides: EventType union additions + RUNNER_TOKEN_ALLOWLIST entry + auth.ts runner-token gate extension for POST /api/tasks/:id/checkpoints
  - plan: 15-02
    provides: autoRouteInboxTasks recipe fast-path + dispatchAssignedTasks recipe-skip filter + requeueStaleTasks isRecipeTaskStuck helper + reconcileRunnerHeartbeat export + scheduler tick ladder entry
  - plan: 15-03
    provides: SeedMcDirInput.resume_marker extension + LOCKED marker line append on resume attempts
  - plan: 15-04
    provides: task-checkpoints helper (writeCheckpoint + readCheckpoints + Zod schemas) + POST/GET route module
  - plan: 15-05
    provides: blocker-branch onInsert closure + resolveResumeMarker + runner-exit emissions + daemon SSE passthrough
  - plan: 15-06
    provides: heartbeat metadata.active_task_ids schema + inventory endpoint + task.container_started broadcast + recipe-watcher emissions
provides:
  - End-to-end integration coverage of the Phase 15 control loop (CP-01..06 + SCHED-01..06)
  - Atomic-rollback proof under JSONL throw AND DB INSERT throw injection (CP-02)
  - Artifact discriminator matrix round-trip (CP-05) across all 6 kinds
  - SCHED-03 heartbeat + active_task_ids three-case inventory probe (alive-tracked skipped, alive-but-lost flipped, never-reported flipped)
  - SCHED-04 reconcile 90s stale window + just-claimed guard boundaries proven with vi.useFakeTimers
  - Byte-for-byte LOCKED progress.md marker format asserted (CP-04)
  - Living documentation of the intended blocker → resume flow for future maintainers
affects: [16-progress-tab, 16-recipe-panel, 16-runner-status-banner, 17-rtest]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Integration-test strategy: real DB via in-memory better-sqlite3 + real modules under test; ONLY boundary mocks (event-bus for broadcast capture, rate-limit passthrough, runner-secret/security-events stubs)"
    - "Fake-timer discipline for scheduler-level integration: vi.useFakeTimers() + vi.setSystemTime(base) for deterministic 30s/90s boundary crossings; DB timestamps seeded relative to Math.floor(Date.now()/1000)"
    - "Cross-module composition asserted via REAL imports: the three integration files never vi.mock @/lib/task-checkpoints, @/lib/task-dispatch, @/lib/runner-claim, or @/lib/runner-worktree — only boundary seams are instrumented"
    - "Broadcast ordering assertion on blocker path: types.toEqual(['task.status_changed', 'task.checkpoint_added']) — cause-before-effect sequence pinned as a contract"
    - "Byte-for-byte filesystem assertion for LOCKED marker format: expect(progress).toBe(initialProgress + expectedMarker) with expectedMarker = `${at_iso} | <<< RESUMED AFTER BLOCKER: ${reason} >>>\\n`"

key-files:
  created:
    - src/app/api/tasks/[id]/checkpoints/__tests__/integration.test.ts
    - src/lib/__tests__/phase-15-scheduler-integration.test.ts
    - src/lib/__tests__/phase-15-blocker-flow-integration.test.ts
  modified:
    - .planning/phases/15-checkpoints-scheduler-v1-2/deferred-items.md

key-decisions:
  - "Dynamic `await import()` cannot destructure `type` re-exports — `import { ..., type X } from '...'` is a TypeScript-only syntax that esbuild rejects in `await import(...)`. The blocker-flow test file uses a top-level `import type { McTaskJson }` PLUS a separate dynamic `await import` for the runtime symbols. Pattern applies to any future test that needs both runtime + type from a mocked module."
  - "Used sequential `issueRunnerToken(...)` calls within a single test rather than issuing one token and reusing — each POST path is independent of token rotation; reusing one token across multiple POSTs would still work today but would hide a future breakage where runner-tokens become attempt-scoped. Plan author discretion; tests are more realistic this way."
  - "Test 3 + 4 in the checkpoint integration sweep use DIFFERENT rollback injection strategies — Test 3 spies `fs.appendFileSync` to simulate ENOSPC (JSONL throw path); Test 4 DROPs the `task_checkpoints` table mid-transaction to force a DB INSERT throw. Both paths exercise the catch branch in route.ts that truncates the JSONL back to pre-call size."
  - "The scheduler integration test file stubs 10+ scheduler-imported lib surfaces (agent-sync, webhooks, claude-sessions, sessions, skill-sync, local-agent-sync, recurring-tasks, config) so initScheduler() doesn't touch real services. The single-source-of-truth pattern matches scheduler-reconcile.test.ts from Plan 15-02 — planner did NOT extract a shared fixture because Plan 15-07 is the last Phase 15 plan; extraction belongs to a cross-phase refactor."
  - "Phase 1 seed in the blocker-flow test pre-populates progress.md AND checkpoints.jsonl with one existing line — NOT via the route handler (which would require setting up a token + worktree + attempt counter before the 'actual' Phase 2 blocker POST). Direct fs.writeFileSync gives a realistic 'runner already started processing' baseline. The assertion is then on the DELTA: exactly 1 new JSONL line + 1 new task_checkpoints row after Phase 2."
  - "Single large `it(...)` block for the full blocker → resume flow (per plan allowance of 'one per phase is acceptable'). Keeps the narrative linear so a future maintainer reads one cohesive story rather than jumping across 5 independent test bodies that would need to share a complex `beforeEach` re-seed."

patterns-established:
  - "Boundary-mock-only integration tests: the ONLY vi.mock calls are for (a) @/lib/db to swap in :memory: DB, (b) @/lib/event-bus to capture broadcasts, (c) @/lib/rate-limit as passthrough, (d) runner-secret + security-events as inert stubs. Every production module under test is imported for real."
  - "Sequential POST helper function pattern: `postCheckpoint(taskId, bearer, body)` encapsulates NextRequest construction + route invocation so the test body reads as a sequence of business operations, not HTTP plumbing."
  - "DELTA-based JSONL assertions when a test pre-seeds the file: snapshot `fs.statSync(path).size` BEFORE the operation, assert final-size relative to baseline. Avoids hard-coding line counts that break when the test harness changes its seed."
  - "Byte-for-byte format assertions for LOCKED strings: use `expect(actual).toBe(expected)` on the full file content, not regex. The marker format is a contract with future UI consumers (Phase 16 Progress tab will parse it); drift must fail fast."

requirements-completed:
  - CP-01
  - CP-02
  - CP-03
  - CP-04
  - CP-05
  - CP-06
  - SCHED-01
  - SCHED-02
  - SCHED-03
  - SCHED-04
  - SCHED-05
  - SCHED-06

# Metrics
duration: 7min
completed: 2026-04-20
---

# Phase 15 Plan 07: Integration Test Sweep Summary

**Three cross-module integration test files ship end-to-end coverage of the Phase 15 control loop: checkpoint POST+GET + artifact matrix + atomic rollback (9 cases), scheduler + reconcile + requeue orchestration (8 cases), and the full blocker → awaiting_owner → resume → progress.md marker flow (1 cohesive `it`). 18 new tests; zero production code modified; all 12 Phase 15 requirement IDs now have at least one integration-level assertion.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-20T23:18:38Z
- **Completed:** 2026-04-20T23:25:15Z
- **Tasks:** 3
- **Files created:** 3 (all test files)
- **Files modified:** 1 (deferred-items.md — appended 15-07 section for the pre-existing runner-tokens failure)
- **Tests added:** 18 (9 checkpoint POST+GET + 8 scheduler orchestration + 1 blocker-resume end-to-end)

## Accomplishments

- **Three integration files shipped**, all passing on first CI run (after one esbuild syntax fix — see Deviations):
  - `src/app/api/tasks/[id]/checkpoints/__tests__/integration.test.ts` — 9 test cases
  - `src/lib/__tests__/phase-15-scheduler-integration.test.ts` — 8 test cases
  - `src/lib/__tests__/phase-15-blocker-flow-integration.test.ts` — 1 large cohesive test
- **Zero production code touched.** Per plan frontmatter, this plan is integration-tests-only. The three created files live in their respective `__tests__/` directories adjacent to the modules they exercise.
- **Atomic contract enforced under failure injection.** Two distinct rollback paths tested: (a) `fs.appendFileSync` throws via vi.spyOn (CP-02 JSONL-failure branch); (b) `task_checkpoints` table DROPped mid-transaction to force DB INSERT throw. Both assert (HTTP 500 ∧ DB row count ∧ JSONL size == baseline).
- **Artifact discriminator matrix (CP-05) round-trips all 6 kinds** (file/url/diff/test_result/comment/other) through POST → DB → JSONL → GET with shape equality.
- **SCHED-03 three-case inventory probe** proven in one test: alive-tracked task (skipped), alive-but-lost task (flipped), and all three assertion axes (task status + broadcast emission count + broadcast payload shape).
- **SCHED-04 just-claimed guard** verified with fake-timer boundary math — a recipe-task with fresh updated_at survives a 120s fast-forward even when no heartbeat has arrived.
- **LOCKED marker format byte-asserted**: `expect(progress).toBe(initialProgress + expectedMarker)` where `expectedMarker = \`${at_iso} | <<< RESUMED AFTER BLOCKER: ${reason} >>>\n\``. Any future drift fails the assertion.
- **Full suite regression check:** `pnpm test --run` reports 1 failed / 2245 passed / 44 todo — the single failure is the documented pre-existing `runner-tokens.test.ts:194` allowlist-length assertion (logged in `deferred-items.md` since Plan 15-04). No new regressions.
- **Typecheck clean:** `pnpm typecheck` exits 0.

## Task Commits

Each task committed atomically:

1. **Task 1: Checkpoint POST + GET integration sweep** — `584ed43` (test)
2. **Task 2: Scheduler + reconcile + requeue orchestration integration** — `3dee4d0` (test)
3. **Task 3: Blocker → resume end-to-end integration** — `9ca965b` (test)

Plan metadata commit pending (this SUMMARY.md + STATE.md + ROADMAP.md + deferred-items.md).

## Requirement ID → Test Location Matrix

All 12 Phase 15 requirement IDs now have at least one integration-level assertion, on top of the per-plan unit tests delivered across Plans 15-01..06:

| Req ID   | Integration file | Case(s) | Notes |
|----------|------------------|---------|-------|
| CP-01    | checkpoints integration.test.ts | 1, 5, 6 | runner-token auth + status='blocked' refines |
| CP-02    | checkpoints integration.test.ts | 1, 3, 4 | DB+JSONL atomic write; rollback under both throw paths |
| CP-02    | blocker-flow integration.test.ts | Phase 2 | 4-op atomic transaction on blocker branch (extra coverage) |
| CP-03    | blocker-flow integration.test.ts | Phases 2–3 | status flip to awaiting_owner + system comment |
| CP-04    | blocker-flow integration.test.ts | Phases 4–5 | resume_marker resolution + seedMcDir marker append |
| CP-05    | checkpoints integration.test.ts | 2 | artifact matrix round-trip (all 6 kinds) |
| CP-06    | checkpoints integration.test.ts | 1, 8, 9 | GET ordering + workspace masquerade + attempt filter |
| SCHED-01 | scheduler integration.test.ts | 1 | autoRouteInboxTasks recipe fast-path |
| SCHED-02 | scheduler integration.test.ts | 2 | dispatchAssignedTasks recipe-skip |
| SCHED-03 | scheduler integration.test.ts | 3 | requeueStaleTasks heartbeat + inventory three-case probe |
| SCHED-04 | scheduler integration.test.ts | 4, 5, 6, 7 | reconcileRunnerHeartbeat boundaries + scheduler ladder |
| SCHED-05 | scheduler integration.test.ts | 1, 3, 4 | task.runner_requested emissions from autoRoute + requeue + reconcile |
| SCHED-05 | blocker-flow integration.test.ts | Phase 2 | (indirect — runner-exit retry emission covered by 15-05's runner-exit route.test.ts) |
| SCHED-06 | checkpoints integration.test.ts | 1, 2 | task.checkpoint_added broadcast payload shape + count |
| SCHED-06 | blocker-flow integration.test.ts | Phase 2 | task.status_changed + task.checkpoint_added cause-before-effect ordering |

## Seams Required During Integration

**None.** Every unit-tested module composed cleanly with the others without needing a refactor. The only surface-level adjustment was an import syntax fix:

### Dynamic `await import()` cannot destructure `type` re-exports

The initial draft of `phase-15-blocker-flow-integration.test.ts` used:

```ts
const { seedMcDir, type McTaskJson } = await import('@/lib/runner-worktree')
```

esbuild rejects this because `import { ..., type X }` is TypeScript-only syntax that does not survive through a dynamic import. Fix: split into a static type-only import at top of file PLUS a runtime-only dynamic import:

```ts
import type { McTaskJson } from '@/lib/runner-worktree'

const { seedMcDir } = await import('@/lib/runner-worktree')
```

Documented in `key-decisions` so future test authors composing mocked + real modules hit the same solution without rediscovery.

## Broadcast Assertion Pattern

The Phase 15-05 `task.status_changed` + `task.checkpoint_added` cause-before-effect ordering is pinned in the blocker-flow integration test via:

```ts
const types = broadcastMock.mock.calls.map((c) => c[0])
expect(types).toEqual(['task.status_changed', 'task.checkpoint_added'])
```

Reverse ordering would briefly show a `in_progress` task with a `blocked` checkpoint to UI subscribers that listen for both events, requiring client-side reconciliation. Asserting the types array order (not just presence) makes any future regression fail fast.

## Fake-Timer Boundary Math

Test case 6 in the scheduler-integration file asserts the SCHED-04 just-claimed guard — a freshly-claimed recipe-task whose `updated_at` is still within the 90s window must NOT be flipped even when no runner heartbeat has arrived. The test uses:

```ts
const BASE_TIME_MS = Date.UTC(2026, 3, 21, 12, 0, 0) // 2026-04-21T12:00:00.000Z
vi.setSystemTime(BASE_TIME_MS)

// Seed task with updated_at = initialNow + 60 so, after +120s clock fast-forward,
// the task's effective age = 60s (fresh, < 90s window).
testDb
  .prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`)
  .run(initialNow + 60, t)
vi.setSystemTime(BASE_TIME_MS + 120_000)

await reconcileRunnerHeartbeat()

expect(taskStatus(t)).toBe('in_progress')
```

The seed uses `initialNow + 60` (future-dated) so the arithmetic works regardless of how long the test harness takes to actually call `reconcileRunnerHeartbeat()`. Without fake timers, wall-clock drift during the test would break the boundary assertion non-deterministically.

## Phase 17 RTEST Coverage Recommendation

Phase 15 integration tests exercise the **in-process** wiring between MC server modules — they prove the DB + JSONL + event-bus + route handlers + helpers compose correctly. They do NOT cover:

- **Reference image-driven container lifecycle** (Phase 14's `mc-hello-world-agent` image actually running + POSTing real checkpoints back to a live MC server). That path is exercised by the Phase 14-10 smoke harness (`scripts/mc-runner-smoke.sh`) but the smoke harness is a single-run verify, not an integration suite.
- **Multi-runner concurrent claim** — the heartbeat + active_task_ids inventory code path only sees one `runner_id='test-runner'` in the 15-07 fixtures. Phase 17 should test with two live runners.
- **Real HTTP transport** — the 15-07 tests call route handlers directly with constructed `NextRequest` objects. A Phase 17 RTEST with a running Next.js server would catch any middleware drift.

**Recommendation for Phase 17:** extend with a full container-driven end-to-end test using the `mc-hello-world-agent` reference image. The hello-world recipe already POSTs checkpoints via the Phase 15 route (per Plan 14-09 + 14-10), so a Phase 17 test can:

1. Boot a local MC server + runner daemon + reference image.
2. Create a `hello-world` task with `recipe_slug='hello-world'`.
3. Assert the container starts, posts checkpoints, and exits with the expected submit payload — end-to-end across all Phase 11–16 boundaries.

This Phase 17 test would catch transport-layer breakage (e.g., middleware ordering, SSE broadcast delivery to a real daemon) that Phase 15's in-process integration cannot.

## Files Created/Modified

### Created

- `src/app/api/tasks/[id]/checkpoints/__tests__/integration.test.ts` (602 lines, 9 `it(...)` cases) — Checkpoint POST + GET integration. Imports real `@/lib/task-checkpoints` + real `@/app/api/tasks/[id]/checkpoints/route`. Covers full completed → in_progress → blocked sequence, CP-05 artifact matrix round-trip, atomic rollback under fs-throw AND DB-throw injection, Zod refinements, artifact discriminator, cross-workspace 404 masquerade, attempt filter.
- `src/lib/__tests__/phase-15-scheduler-integration.test.ts` (493 lines, 8 `it(...)` cases) — Scheduler + reconcile + requeue orchestration. Imports real `autoRouteInboxTasks`, `dispatchAssignedTasks`, `requeueStaleTasks`, `reconcileRunnerHeartbeat` from `@/lib/task-dispatch` + real `initScheduler`/`getSchedulerStatus`/`triggerTask` from `@/lib/scheduler`. Uses `vi.useFakeTimers()` + `vi.setSystemTime(BASE_TIME_MS)` for deterministic 30s/90s boundary crossings. Stubs 10+ scheduler-imported lib surfaces (agent-sync, webhooks, claude-sessions, sessions, skill-sync, local-agent-sync, recurring-tasks, config) to keep the suite hermetic.
- `src/lib/__tests__/phase-15-blocker-flow-integration.test.ts` (382 lines, 1 large `it(...)`) — End-to-end blocker → resume flow. 5 phases in a single test: seed, blocker POST via real handler, owner flip via direct SQL, resolveResumeMarker call, seedMcDir simulation. Asserts byte-for-byte LOCKED marker format + 4-op atomic transaction + pre-existing-content preservation + task.json rewrite.

### Modified

- `.planning/phases/15-checkpoints-scheduler-v1-2/deferred-items.md` — appended a "From Plan 15-07 execution" section documenting the pre-existing `runner-tokens.test.ts:194` failure per the scope boundary rule (Plan 15-07 owns integration tests only; the allowlist-length assertion drift pre-dates this plan and is owned by Plan 15-01 cleanup or a phase-wide refactor).

## Decisions Made

See `key-decisions` in frontmatter for the full list. Summary:

- **Boundary-mock-only pattern** — production modules under test are imported for real; only event-bus, rate-limit, runner-secret, security-events, and DB handle are mocked.
- **Dynamic `await import()` type-separation** — TypeScript `type` re-exports don't work in dynamic imports; use a static `import type` + dynamic value-only import instead.
- **Sequential token issuance** — each POST in a test sequence issues a fresh runner-token rather than reusing, matching the real-world pattern and guarding against future token-rotation behaviors.
- **Single-file stub for scheduler integration** — avoided extracting a shared fixture for the 10+ lib surface stubs because Plan 15-07 is the last Phase 15 plan; a cross-phase extraction is deferred to a future refactor.
- **DELTA-based JSONL assertions in blocker-flow** — the Phase 1 pre-seed pre-populates the file; assertions then work on the delta (1 new line after Phase 2) rather than hard-coding line counts.
- **Single large `it(...)` for blocker-flow** — plan allowed one-per-phase breakdown but keeping the five phases in one test preserves the linear narrative for future maintainers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Dynamic `await import()` rejects destructured `type` re-export**

- **Found during:** Task 3 (blocker-flow integration file, first test run)
- **Issue:** `const { seedMcDir, type McTaskJson } = await import('@/lib/runner-worktree')` failed esbuild with `Expected "}" but found "McTaskJson"`. The `import { ..., type X }` syntax is TypeScript-only and does not survive through a dynamic import at runtime.
- **Fix:** Split into a static top-of-file `import type { McTaskJson } from '@/lib/runner-worktree'` plus a runtime-only dynamic `const { seedMcDir } = await import('@/lib/runner-worktree')`. Tests compile and run cleanly.
- **Files modified:** `src/lib/__tests__/phase-15-blocker-flow-integration.test.ts`
- **Verification:** Test file re-ran, all assertions pass; `pnpm typecheck` exits 0.
- **Committed in:** `9ca965b` (Task 3 commit — the fix was applied before the commit landed, not after)

---

**Total deviations:** 1 auto-fixed (Rule 3 - Blocking).
**Impact on plan:** Minor syntax correction within the same task author-iterate cycle; no scope creep. The plan text did not specify the dynamic-vs-static import distinction; future test-author docs should note the pattern.

## Issues Encountered

- **Pre-existing test failure (out of scope):** `src/lib/__tests__/runner-tokens.test.ts:194` still fails with `expected 7 to be 6` after Plan 15-01 added the 7th RUNNER_TOKEN_ALLOWLIST entry. This failure was re-confirmed on a clean checkout BEFORE Plan 15-07 commits landed. Per the scope boundary rule we did NOT fix it — the allowlist module is owned by Plan 15-01 cleanup or a phase-wide test refactor. Logged to `deferred-items.md`.
- **Expected error logs from failure-injection tests:** Running `pnpm test --run` on the checkpoint integration file surfaces two deliberate error logs from the atomic-rollback tests (ENOSPC simulated + "no such table: task_checkpoints"). These are expected — the tests assert that the catch-branch fires and the 500 response lands.

## User Setup Required

None — integration-tests-only plan, no external service configuration required.

## Next Phase Readiness

- **Phase 15 complete.** All 12 requirement IDs (CP-01..06 + SCHED-01..06) now have both unit + integration coverage. The Phase 15 control loop is proven operational at the module-composition level.
- **Phase 16 UI surfaces** can proceed. The three integration tests serve as living documentation for future UI authors:
  - Progress tab consumers know the exact shape of `task.checkpoint_added` payloads (9 cases in checkpoints integration).
  - Recipe-list panel authors know the `recipe.indexed` / `recipe.removed` emission cadence (covered in Plan 15-06 tests; integration-level continuation in Phase 16 test deliverables).
  - Runner-status banner authors know the `task.status_changed` + `task.container_started` + `task.container_exited` sequence from the blocker-flow test narrative.
- **Phase 17 RTEST** should add container-driven end-to-end coverage per the recommendation above. The `mc-hello-world-agent` reference image + the Phase 14-10 smoke harness are the scaffolding; Phase 17 extends with formal assertions and a multi-runner scenario.
- **No blockers.** The pre-existing `runner-tokens.test.ts:194` failure is the only outstanding Phase 15 deferred item — fix when a Phase 15 cleanup pass is scheduled.

## Self-Check: PASSED

Verified 2026-04-20T23:25:15Z:

- FOUND: src/app/api/tasks/[id]/checkpoints/__tests__/integration.test.ts
- FOUND: src/lib/__tests__/phase-15-scheduler-integration.test.ts
- FOUND: src/lib/__tests__/phase-15-blocker-flow-integration.test.ts
- FOUND: .planning/phases/15-checkpoints-scheduler-v1-2/15-07-SUMMARY.md
- FOUND: commit 584ed43 (Task 1: checkpoint POST+GET integration)
- FOUND: commit 3dee4d0 (Task 2: scheduler orchestration integration)
- FOUND: commit 9ca965b (Task 3: blocker → resume end-to-end integration)

Test runs:
- `pnpm test src/app/api/tasks/[id]/checkpoints/__tests__/integration.test.ts --run` → 9/9 PASS
- `pnpm test src/lib/__tests__/phase-15-scheduler-integration.test.ts --run` → 8/8 PASS
- `pnpm test src/lib/__tests__/phase-15-blocker-flow-integration.test.ts --run` → 1/1 PASS
- All three together → 18/18 PASS
- `pnpm typecheck` → exits 0
- Full `pnpm test --run` → 1 pre-existing failure (runner-tokens.test.ts:194 documented in deferred-items.md) + 2245 passed + 44 todo — no new regressions

---
*Phase: 15-checkpoints-scheduler-v1-2*
*Completed: 2026-04-20*
