---
phase: 15-checkpoints-scheduler-v1-2
verified: 2026-04-20T19:45:00Z
status: passed
score: 6/6 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 5/6
  gaps_closed:
    - "All Phase 15 test files pass (full suite exits 0) — runner-tokens.test.ts:194 updated to toBe(7)"
  gaps_remaining: []
  regressions: []
---

# Phase 15: Checkpoints & Scheduler v1.2 Verification Report

**Phase Goal:** Agents can post checkpoints that persist to both the DB and the worktree journal, blockers flip the task to `awaiting_owner` and stop the container gracefully, and the MC scheduler treats recipe-tagged tasks correctly across the inbox → assigned → in_progress → review pipeline
**Verified:** 2026-04-20T19:45:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (commit df37379)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Agent authenticated with runner-token can POST /api/tasks/:id/checkpoints with full field set; each lands as task_checkpoints row AND JSONL line | VERIFIED | `src/app/api/tasks/[id]/checkpoints/route.ts` exports POST with runner-token auth guard (`id === -2000`), cross-task check, calls `writeCheckpoint` which does atomic DB+JSONL; 31 unit tests + 9 integration tests pass |
| 2 | status:'blocked' checkpoint transitions in_progress → awaiting_owner atomically, posts auto-comment, stops container via SSE | VERIFIED | `checkpoints/route.ts` passes `onInsert` callback to `writeCheckpoint`; callback UPDATEs tasks status='awaiting_owner' + INSERTs comment with author='system'; `mc-runner.mjs` listens for `task.checkpoint_added` with `status==='blocked'` and calls `spawnSync('docker', ['stop', '--time=15', ...])`; 6 route-blocker tests pass |
| 3 | GET /api/tasks/:id/checkpoints?attempt=N returns filterable timeline | VERIFIED | `checkpoints/route.ts` exports GET with viewer auth, parses `?attempt` query param, calls `readCheckpoints` with attempt filter ordered by (attempt ASC, id ASC) |
| 4 | autoRouteInboxTasks() inbox→assigned for recipe-tagged without affinity scoring; dispatchAssignedTasks() skips recipe tasks; requeueStaleTasks() uses runner heartbeat + container liveness | VERIFIED | `task-dispatch.ts`: autoRouteInboxTasks has recipe fast-path at line 1086 (WHERE recipe_slug IS NOT NULL), legacy path adds `AND recipe_slug IS NULL`; dispatchAssignedTasks WHERE clause includes `AND t.recipe_slug IS NULL` at line 768; requeueStaleTasks queries runner_heartbeats.metadata_json.active_task_ids at line 614; all 3 dispatch test suites pass |
| 5 | reconcileRunnerHeartbeat() scheduler task every 30s marks stale recipe-tasks | VERIFIED | `scheduler.ts` TICK_MS=30_000 at line 277; `reconcile_runner_heartbeat` task registered at line 402 with intervalMs=30_000; wired into tick ladder, triggerTask, getSchedulerStatus; `task-dispatch.ts` exports `reconcileRunnerHeartbeat` with STALE_WINDOW_SECS=90 at line 1240 |
| 6 | All Phase 15 tests pass (full suite exits 0) | VERIFIED | `pnpm test --run` exits clean: 2246 passed, 0 failed, 44 todo (2290 total across 190 files). `runner-tokens.test.ts:193-194` updated in commit df37379 to read `toBe(7)` with description "contains exactly the seven allowlist entries (six RAUTH-06 + Phase 15 checkpoints)" |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/event-bus.ts` | Extended EventType union with 6 new Phase 15 event types | VERIFIED | Lines 56-61 contain all 6: task.runner_requested, task.container_started, task.container_exited, task.checkpoint_added, recipe.indexed, recipe.removed |
| `src/lib/runner-tokens.ts` | RUNNER_TOKEN_ALLOWLIST extended with POST /api/tasks/:id/checkpoints | VERIFIED | Line 26: `{ method: 'POST', pathPattern: /^\/api\/tasks\/(\d+)\/checkpoints\/?$/ }` — 7 entries total |
| `src/lib/auth.ts` | Runner-token gate extended for /api/tasks/:id/checkpoints | VERIFIED | Lines 534-535: `isCheckpointsTaskPath` variable + OR condition in gate |
| `src/lib/scheduler.ts` | TICK_MS=30_000; reconcile_runner_heartbeat registered with intervalMs=30_000 | VERIFIED | Line 277: `const TICK_MS = 30 * 1000`; line 402: tasks.set('reconcile_runner_heartbeat', ...) |
| `src/lib/task-dispatch.ts` | autoRouteInboxTasks recipe fast-path, dispatchAssignedTasks recipe-skip, requeueStaleTasks recipe-branch, reconcileRunnerHeartbeat export | VERIFIED | All 4 functions present with correct SQL patterns |
| `src/app/api/tasks/route.ts` | POST emits task.runner_requested when direct-assigned with recipe_slug | VERIFIED | Line 487: conditional broadcast after task.created |
| `src/lib/task-checkpoints.ts` | CheckpointBodySchema, ArtifactSchema, writeCheckpoint (with onInsert), readCheckpoints | VERIFIED | 325-line file exports all required symbols; writeCheckpoint has WriteCheckpointOptions.onInsert callback |
| `src/app/api/tasks/[id]/checkpoints/route.ts` | POST (runner-token auth + blocker branch) + GET (viewer auth) | VERIFIED | Both handlers present; POST has awaiting_owner flip in onInsert callback; 15+ POST tests + 7 GET tests pass |
| `src/lib/runner-worktree.ts` | SeedMcDirInput with optional resume_marker; marker append on resume | VERIFIED | Lines 113-170: SeedMcDirInput exported; appendFileSync appends LOCKED format `| <<< RESUMED AFTER BLOCKER: ...` |
| `src/lib/recipe-watcher.ts` | recipe.indexed + recipe.removed broadcasts | VERIFIED | Lines 116, 139, 166, 237, 241, 253, 353: eventBus.broadcast calls at multiple paths (initial scan + chokidar events) |
| `src/app/api/runner/heartbeat/route.ts` | HeartbeatMetadataSchema with active_task_ids; passthrough() | VERIFIED | Lines 38-47: HeartbeatMetadataSchema with explicit active_task_ids and .passthrough() |
| `src/app/api/runner/inventory/route.ts` | GET endpoint with runner-secret auth, 90s stale window | VERIFIED | File exists; exports GET; checks `user.id !== -1000`; STALE_WINDOW_SECS=90 |
| `src/app/api/runner/tasks/[task_id]/container-started/route.ts` | task.container_started broadcast after placeholder swap | VERIFIED | Line 134: eventBus.broadcast('task.container_started', ...) in successful-swap branch only |
| `src/app/api/runner/tasks/[task_id]/runner-exit/route.ts` | task.container_exited broadcast; task.runner_requested on retry; blocked override | VERIFIED | Lines 280-328: all three behaviors present |
| `src/lib/runner-claim.ts` | resolveResumeMarker helper; resume_marker in dispatch payload | VERIFIED | Lines 486+: resolveResumeMarker exported; dispatch payload includes resume_marker at line 446 |
| `scripts/mc-runner.mjs` | task.checkpoint_added SSE handler → docker stop; seedMcDir resume_marker passthrough | VERIFIED | Lines 687-710: SSE handler; line 271: marker append in inline seedMcDir; node --check exits 0 |
| All Phase 15 test files | Integration tests for 15-07 | VERIFIED | All 3 integration test files exist and pass: integration.test.ts (9 tests), phase-15-scheduler-integration.test.ts (8 tests), phase-15-blocker-flow-integration.test.ts (1 test) |
| `src/lib/__tests__/runner-tokens.test.ts` | Allowlist length assertion updated to 7 | VERIFIED | Line 193-194: description updated to "contains exactly the seven allowlist entries (six RAUTH-06 + Phase 15 checkpoints)"; `expect(RUNNER_TOKEN_ALLOWLIST.length).toBe(7)` — commit df37379 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| EventType union (event-bus.ts) | Downstream consumers (checkpoints route, task-dispatch, recipe-watcher, runner-exit, container-started) | 6 new union members | WIRED | All 6 event types are broadcast in their respective files; typecheck passes |
| runner-tokens.ts RUNNER_TOKEN_ALLOWLIST | auth.ts runner-token gate | isCheckpointsTaskPath OR condition | WIRED | auth.ts line 534-535 explicitly handles /api/tasks/:id/checkpoints path |
| scheduler.ts | task-dispatch.ts reconcileRunnerHeartbeat | tick ladder dispatch at id==='reconcile_runner_heartbeat' | WIRED | Line 471 in scheduler.ts; imported at line 13 |
| autoRouteInboxTasks | event-bus.ts task.runner_requested | eventBus.broadcast in recipe fast-path | WIRED | Lines 1099 (fast-path) and 682 (requeueStaleTasks recipe flip) |
| POST /api/tasks | event-bus.ts task.runner_requested | conditional broadcast after task.created | WIRED | Line 487; gated on `parsedTask.status === 'assigned' && parsedTask.recipe_slug` |
| runner-exit retry path | event-bus.ts task.runner_requested | conditional broadcast after in_progress→assigned flip | WIRED | Lines 316-328 in runner-exit/route.ts; gated on recipe_slug non-null |
| checkpoints/route.ts POST status=blocked | tasks UPDATE awaiting_owner + comments INSERT | onInsert callback in writeCheckpoint transaction | WIRED | Lines 162-205; onInsert callback in task-checkpoints.ts called inside db.transaction |
| mc-runner.mjs SSE handler | docker stop --time=15 | task.checkpoint_added event with status==='blocked' + activeTasks.has check | WIRED | Lines 687-710 |
| claim/[task_id]/route.ts | runner-worktree.ts seedMcDir | resume_marker in dispatch payload → daemon passes to seedMcDir | WIRED | resolveResumeMarker called at line 365; daemon uses it at line 271 |
| recipe-watcher.ts scheduleReindex | event-bus.ts recipe.indexed/removed | eventBus.broadcast in success/removal branches | WIRED | Lines 116, 139, 166, 237, 241, 253, 353 |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CP-01 | 15-04, 15-07 | POST /api/tasks/:id/checkpoints with full field set; runner-token auth | SATISFIED | Route exists; Zod schema validates; runner-token guard at id===-2000 |
| CP-02 | 15-04, 15-05, 15-07 | Atomic DB row + JSONL line; rollback on failure | SATISFIED | writeCheckpoint uses db.transaction + appendFileSync; route compensates JSONL via truncateSync on throw |
| CP-03 | 15-05, 15-07 | blocked → awaiting_owner + auto-comment + container stop | SATISFIED | onInsert callback atomically flips status + inserts comment; daemon SSE handler calls docker stop |
| CP-04 | 15-03, 15-05, 15-07 | Resume flow with marker in progress.md | SATISFIED | seedMcDir appends LOCKED marker on resume; resolveResumeMarker in claim route; daemon passes resume_marker |
| CP-05 | 15-04, 15-07 | Artifact discriminated union (6 kinds) with per-kind validation | SATISFIED | ArtifactSchema z.discriminatedUnion with file/url/diff/test_result/comment/other |
| CP-06 | 15-04, 15-07 | GET /api/tasks/:id/checkpoints filterable by ?attempt, ordered (attempt ASC, id ASC) | SATISFIED | GET handler in route.ts with attemptFilter and readCheckpoints ordering |
| SCHED-01 | 15-02, 15-07 | autoRouteInboxTasks() inbox→assigned for recipe-tagged without affinity scoring | SATISFIED | Recipe fast-path at line 1086 of task-dispatch.ts |
| SCHED-02 | 15-02, 15-07 | dispatchAssignedTasks() skips recipe_slug tasks | SATISFIED | AND t.recipe_slug IS NULL at line 768 of task-dispatch.ts |
| SCHED-03 | 15-02, 15-06, 15-07 | requeueStaleTasks() uses runner heartbeat + container liveness for recipe tasks | SATISFIED | active_task_ids check at lines 614-616; runner_heartbeats query |
| SCHED-04 | 15-02, 15-07 | reconcileRunnerHeartbeat() every 30s flips stuck recipe-tasks | SATISFIED | Registered at scheduler line 402; STALE_WINDOW_SECS=90 at task-dispatch line 1240 |
| SCHED-05 | 15-02, 15-05 | task.runner_requested from 3 emission points | SATISFIED | autoRouteInboxTasks (line 1099), POST /api/tasks (line 487), runner-exit retry (line 328) |
| SCHED-06 | 15-01, 15-04, 15-05, 15-06 | recipe.indexed, recipe.removed, task.container_started, task.container_exited, task.checkpoint_added broadcast on SSE | SATISFIED | All 5 event types: recipe-watcher.ts (indexed/removed), container-started/route.ts, runner-exit/route.ts (container_exited), checkpoints/route.ts (checkpoint_added) |

### Anti-Patterns Found

None — the single stale assertion (`toBe(6)` at `runner-tokens.test.ts:194`) was corrected in commit df37379. No other anti-patterns found in Phase 15 files.

### Human Verification Required

No blocking items. The following are non-blocking observations:

1. **Docker stop graceful shutdown**
   - Test: Run a real container, post a blocked checkpoint, observe `docker stop --time=15` completes before forced kill
   - Expected: Container exits cleanly within 15s; worktree is preserved
   - Why human: Integration test uses in-memory DB and mocked docker; real container behavior can't be verified from test runner

2. **SSE event delivery to browser clients**
   - Test: Open a browser connected to `/api/events`, trigger a recipe index or checkpoint post
   - Expected: Browser receives the SSE event payload including the new event types
   - Why human: SSE delivery to real HTTP clients is not covered by unit tests (event-bus is mocked)

### Gaps Summary

No gaps remain. The single gap from the initial verification has been closed:

- **Closed (df37379):** `src/lib/__tests__/runner-tokens.test.ts:193-194` — stale `toBe(6)` assertion updated to `toBe(7)` with corrected description. Full suite now exits clean: 2246 passed, 0 failed, 44 todo across 2290 total tests (190 files).

All 6 observable truths verified. All 12 requirement IDs (CP-01..CP-06, SCHED-01..SCHED-06) satisfied. Phase 15 goal achieved.

---

_Verified: 2026-04-20T19:45:00Z_
_Verifier: Claude (gsd-verifier)_
