---
phase: 15-checkpoints-scheduler-v1-2
plan: 02
subsystem: scheduler
tags: [scheduler, task-dispatch, runner, heartbeat, sse, recipe-runtime]

# Dependency graph
requires:
  - phase: 15-checkpoints-scheduler-v1-2
    provides: "EventType union members task.runner_requested + task.status_changed (Plan 15-01)"
  - phase: 14-runner-container-v1-2
    provides: "runner_heartbeats table (migration 060), task_runner_attempts (061), recipe_slug/container_id/runner_started_at columns on tasks, Phase 14 claim route expecting task.runner_requested SSE frames"
  - phase: 13-task-runtime-context-v1-2
    provides: "recipe_slug column + recipe validation at POST /api/tasks creation"
  - phase: 12-recipe-system-v1-2
    provides: "getIndexedRecipeBySlug + indexed recipes table"
provides:
  - "Scheduler ticks every 30s (was 60s) — 3× 30s = 90s LOCKED stale window"
  - "reconcile_runner_heartbeat task registered in scheduler Map (intervalMs=30_000)"
  - "reconcileRunnerHeartbeat() exported from src/lib/task-dispatch.ts"
  - "autoRouteInboxTasks() recipe fast-path: inbox→assigned + task.runner_requested emit"
  - "dispatchAssignedTasks() SKIPS rows where recipe_slug IS NOT NULL"
  - "requeueStaleTasks() recipe branch uses runner heartbeat + metadata_json.active_task_ids probe (NOT agents.status)"
  - "POST /api/tasks emits task.runner_requested when parsedTask.status='assigned' && parsedTask.recipe_slug"
affects: [15-04, 15-05, 15-06, 15-07, 16-ui-surfaces]

# Tech tracking
tech-stack:
  added: []  # no new libraries
  patterns:
    - "Dispatch-lane separation by recipe_slug (SQL IS NULL / IS NOT NULL filter)"
    - "Heartbeat + inventory combined liveness probe for recipe-tagged tasks"
    - "Deliberate stub-then-replace within the same plan: Task 1 lands a reconcileRunnerHeartbeat stub, Task 4 replaces it with the real body"

key-files:
  created:
    - "src/lib/__tests__/scheduler-reconcile.test.ts"
    - "src/lib/__tests__/task-dispatch-autoroute.test.ts"
    - "src/lib/__tests__/task-dispatch-dispatch.test.ts"
    - "src/lib/__tests__/task-dispatch-requeue.test.ts"
    - "src/lib/__tests__/task-dispatch-reconcile.test.ts"
    - "src/app/api/tasks/__tests__/route-recipe-emission.test.ts"
  modified:
    - "src/lib/scheduler.ts"
    - "src/lib/task-dispatch.ts"
    - "src/app/api/tasks/route.ts"

key-decisions:
  - "TICK_MS LOCKED at 30_000 (not 60_000) — 3× 30s = 90s LOCKED stale window per 15-CONTEXT.md Heartbeat & Stale Detection"
  - "STALE_WINDOW_SECS = 90 is a module-private constant in reconcileRunnerHeartbeat and isRecipeTaskStuck — deliberately NOT exposed as a runtime setting in v1.2 (deferred per 15-CONTEXT.md)"
  - "isRecipeTaskStuck returns false when fresh heartbeat exists but metadata_json has no active_task_ids inventory — conservative skip rather than flipping a task the runner might actually own"
  - "Reconcile loop flips tasks one-at-a-time inside a transaction; the rowFlipped flag ensures we only broadcast when the UPDATE actually changed a row (avoids double-emit under contention)"
  - "reconcileRunnerHeartbeat is the single SCHED-05 emission point for the 'runner crashed mid-run' path; Plan 15-05 owns the parallel 'runner-exit with retry' emission point"
  - "POST /api/tasks emission uses a local cast to read recipe_slug / workspace_id off parsedTask — the Task interface in db.ts predates those columns and widening it belongs to a separate refactor"

patterns-established:
  - "Two-lane inbox/assigned dispatch: recipe-tagged rows go through fast-path + runner daemon, legacy rows stay on agent-affinity scoring + dispatchAssignedTasks"
  - "SCHED-05 emit-on-every-transition: three emission points fire unconditionally (autoRouteInboxTasks, POST /api/tasks, reconcileRunnerHeartbeat); daemon's claim route is idempotent via runner-token mint keyed on task_id+attempt"
  - "Concurrent-modification guard pattern: UPDATE ... WHERE status = 'inbox' AND recipe_slug IS NOT NULL and only emit when res.changes > 0 — prevents duplicate events when another tick flipped the row first"

requirements-completed: [SCHED-01, SCHED-02, SCHED-03, SCHED-04, SCHED-05, SCHED-06]

# Metrics
duration: 11min
completed: 2026-04-20
---

# Phase 15 Plan 15-02: Scheduler + Task Dispatch Recipe Lanes Summary

**Scheduler ticks at 30s with reconcile_runner_heartbeat registered; autoRouteInboxTasks / dispatchAssignedTasks / requeueStaleTasks cleanly split recipe-tagged vs legacy rows; three of four SCHED-05 task.runner_requested emission points now fire from MC.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-20T22:27:15Z
- **Completed:** 2026-04-20T22:38:36Z
- **Tasks:** 5
- **Files modified:** 3 source + 6 new tests = 9 total

## Accomplishments

- Scheduler `TICK_MS` reduced from 60_000 → 30_000 (SCHED-04 cadence alignment)
- `reconcile_runner_heartbeat` task registered in the tasks Map, settings-key ladder, defaultEnabled chain, tick dispatch ladder, getSchedulerStatus, and triggerTask (5 touch points)
- `autoRouteInboxTasks` recipe fast-path moves `inbox → assigned` atomically for `recipe_slug IS NOT NULL` rows, emits `task.runner_requested` + `task.status_changed{reason:auto_route_recipe}` per flip, leaves the legacy affinity-scoring loop untouched for recipe_slug IS NULL rows
- `dispatchAssignedTasks` SELECT now carries `AND t.recipe_slug IS NULL` — recipe-tagged assigned rows CANNOT be picked up by the legacy dispatch loop even when an operator sets `assigned_to` on them
- `requeueStaleTasks` split into two branches: recipe rows use `isRecipeTaskStuck()` (runner heartbeat + metadata_json.active_task_ids inventory); legacy rows keep the existing agent-offline probe. Recipe flip sets `runner_last_failure_reason='runner_heartbeat_stale'`
- `reconcileRunnerHeartbeat()` exported with the RESEARCH.md-spec body: 90s LOCKED stale window, double-guard (no fresh heartbeat AND task updated_at also stale), one broadcast per successfully-flipped row
- `POST /api/tasks` emits `task.runner_requested` when `parsedTask.status === 'assigned' && parsedTask.recipe_slug`

## Task Commits

Each task was committed atomically:

1. **Task 1: Scheduler TICK_MS=30s + reconcile_runner_heartbeat registration** — `66ccd66` (feat)
2. **Task 2: autoRouteInboxTasks recipe fast-path + runner_requested emission** — `8cf4108` (feat)
3. **Task 3: dispatchAssignedTasks recipe-skip + requeueStaleTasks recipe branch** — `f728084` (feat)
4. **Task 4: reconcileRunnerHeartbeat replaces Task 1 stub** — `6f01e94` (feat)
5. **Task 5: POST /api/tasks emits task.runner_requested** — `9119a96` (feat)

## Files Created/Modified

- `src/lib/scheduler.ts` — TICK_MS=30_000, reconcile_runner_heartbeat registered across 5 ladders, reconcileRunnerHeartbeat imported from task-dispatch
- `src/lib/task-dispatch.ts` — autoRouteInboxTasks recipe fast-path, dispatchAssignedTasks recipe-skip filter, requeueStaleTasks recipe branch + `isRecipeTaskStuck` helper, reconcileRunnerHeartbeat export
- `src/app/api/tasks/route.ts` — conditional `task.runner_requested` emit after `task.created` broadcast in the POST handler
- `src/lib/__tests__/scheduler-reconcile.test.ts` — 6 cases (scheduler ladder wiring)
- `src/lib/__tests__/task-dispatch-autoroute.test.ts` — 6 cases (recipe fast-path, legacy lane, mixed, concurrent-modification)
- `src/lib/__tests__/task-dispatch-dispatch.test.ts` — 4 cases (recipe rows never dispatched)
- `src/lib/__tests__/task-dispatch-requeue.test.ts` — 7 cases (heartbeat freshness, inventory probe, malformed metadata, legacy regression)
- `src/lib/__tests__/task-dispatch-reconcile.test.ts` — 7 cases (reconcileRunnerHeartbeat behavior including 90s boundary)
- `src/app/api/tasks/__tests__/route-recipe-emission.test.ts` — 6 cases (status × recipe_slug × assigned_to matrix)

Total new test cases: **36 passing** (regression suite: task-routing + task-status + route.runtime-context = 29 still passing).

## reconcileRunnerHeartbeat Public Signature

```ts
export async function reconcileRunnerHeartbeat(): Promise<{ ok: boolean; message: string }>
```

Pseudocode (full body in `src/lib/task-dispatch.ts:1087-1163`):

```
nowUnix = floor(Date.now() / 1000)
STALE_WINDOW_SECS = 90 // LOCKED

fresh = SELECT 1 FROM runner_heartbeats WHERE last_heartbeat_at >= nowUnix - 90 LIMIT 1

IF fresh:
  return { ok: true, message: "Runner heartbeat fresh" }

stuck = SELECT id, recipe_slug, workspace_id FROM tasks
        WHERE status = 'in_progress' AND recipe_slug IS NOT NULL
          AND updated_at < nowUnix - 90

IF stuck.length == 0:
  return { ok: true, message: "No stale in_progress recipe-tasks" }

FOR each t in stuck:
  db.transaction():
    res = UPDATE tasks SET status='assigned', container_id=NULL,
          runner_started_at=NULL, runner_last_failure_reason='runner_heartbeat_stale',
          updated_at = nowUnix
          WHERE id = t.id AND status = 'in_progress' AND recipe_slug IS NOT NULL
    rowFlipped = res.changes > 0
  IF rowFlipped:
    eventBus.broadcast('task.runner_requested', { task_id, recipe_slug, workspace_id })
    eventBus.broadcast('task.status_changed', { ... reason: 'runner_heartbeat_stale' })

return { ok: true, message: `Flipped ${flipped} stale recipe-task(s) back to assigned` }
```

## SQL Refactors (exact)

**autoRouteInboxTasks — new recipe fast-path (inserted BEFORE the legacy SELECT):**
```sql
SELECT id, recipe_slug, workspace_id FROM tasks
WHERE status = 'inbox' AND recipe_slug IS NOT NULL
```
Per-row UPDATE guard:
```sql
UPDATE tasks SET status = 'assigned', updated_at = ?
WHERE id = ? AND status = 'inbox' AND recipe_slug IS NOT NULL
```

**autoRouteInboxTasks — legacy SELECT filter changed from:**
```sql
WHERE status = 'inbox' AND assigned_to IS NULL
```
to:
```sql
WHERE status = 'inbox' AND assigned_to IS NULL AND recipe_slug IS NULL
```

**dispatchAssignedTasks — SELECT WHERE clause changed from:**
```sql
WHERE t.status = 'assigned' AND t.assigned_to IS NOT NULL
```
to:
```sql
WHERE t.status = 'assigned' AND t.assigned_to IS NOT NULL
  -- Phase 15 SCHED-02: recipe-tagged tasks handled by runner daemon, not legacy dispatch
  AND t.recipe_slug IS NULL
```

**requeueStaleTasks — SELECT now includes recipe_slug + container_id; per-row branches split on `task.recipe_slug` nullness.**

## POST /api/tasks emission guard

Lives in `src/app/api/tasks/route.ts` immediately after `eventBus.broadcast('task.created', parsedTask)`:
```ts
if (parsedTaskAny.status === 'assigned' && parsedTaskAny.recipe_slug) {
  eventBus.broadcast('task.runner_requested', {
    task_id: parsedTaskAny.id,
    recipe_slug: parsedTaskAny.recipe_slug,
    workspace_id: parsedTaskAny.workspace_id,
  })
}
```
`parsedTaskAny` is a local cast because the shared `Task` interface in `src/lib/db.ts` predates the Phase 13 runtime-context columns.

## Emission-point Landing Map

Three of four Phase 15 SCHED-05 `task.runner_requested` emission points land in this plan:

| Emission Point | Plan | Status |
|---|---|---|
| `autoRouteInboxTasks` (inbox→assigned) | **15-02** | ✅ shipped (Task 2) |
| `POST /api/tasks` (direct-assigned + recipe_slug) | **15-02** | ✅ shipped (Task 5) |
| Stale reconcile (in_progress→assigned via heartbeat miss) | **15-02** | ✅ shipped (Task 4) |
| Runner-exit retry path (in_progress→assigned after crash) | 15-05 | ⏳ Wave 2 |

## Decisions Made

- **TICK_MS=30_000 chosen over "keep 60s + register reconcile with 30s intervalMs"** — RESEARCH.md Focus Area 4 notes the simpler path. All TICK_MS-driven tasks now tick at 30s (webhook_retry, claude_session_scan, skill_sync, local_agent_sync, gateway_agent_sync, task_dispatch, aegis_review, recurring_task_spawn, stale_task_requeue). This doubles their check frequency but `nextRun` gating prevents any single task from firing more often than its declared `intervalMs` — no behavior regression expected.
- **reconcileRunnerHeartbeat stub in Task 1, real body in Task 4** — deliberate ordering: scheduler.ts imports the symbol at compile time, so Task 1 needed SOMETHING exported for pnpm typecheck to pass. The stub is three lines of "ok: true, message: 'stub ...'", and Task 4 drops in the RESEARCH.md-spec body verbatim.
- **isRecipeTaskStuck returns false when metadata_json has no active_task_ids inventory** — conservative behavior. We can't tell if the runner actually tracks this task, so we don't flip it. The parallel reconcileRunnerHeartbeat (no heartbeat at all) covers the "runner is dead" case unambiguously; isRecipeTaskStuck only kicks in when heartbeat IS fresh.
- **Task 3 test uses `updated_at: now - 700` not `now - 600`** — requeueStaleTasks uses `updated_at < staleThreshold` (strict less-than), and staleThreshold is `now - 600`. Using `now - 600` for the seed would hit the boundary and fail. `now - 700` is unambiguously stale.

## Deviations from Plan

None material. Minor adjustments:

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task interface in db.ts missing recipe_slug / workspace_id**
- **Found during:** Task 5 (POST /api/tasks emission)
- **Issue:** `parsedTask.recipe_slug` and `parsedTask.workspace_id` failed typecheck because the `Task` interface in `src/lib/db.ts` predates the Phase 13 runtime-context columns.
- **Fix:** Local cast (`parsedTask as unknown as {status; id; recipe_slug?; workspace_id?}`) scoped to the emission block. Widening the shared Task interface belongs to a separate refactor outside the Phase 15 scope boundary.
- **Files modified:** `src/app/api/tasks/route.ts`
- **Verification:** `pnpm typecheck` passes; route-recipe-emission.test.ts 6/6.
- **Committed in:** 9119a96 (Task 5 commit)

**2. [Rule 1 - Bug] Test seed updated_at landed on the staleThreshold boundary**
- **Found during:** Task 3 (task-dispatch-requeue.test.ts)
- **Issue:** Seeds used `updated_at: now - 600` but staleThreshold = `now - 600` and the SELECT uses strict less-than — rows didn't qualify as stale, 3 tests failed.
- **Fix:** Changed seeds to `updated_at: now - 700` across all 7 cases.
- **Files modified:** `src/lib/__tests__/task-dispatch-requeue.test.ts`
- **Verification:** All 7 requeue tests pass.
- **Committed in:** f728084 (Task 3 commit)

**3. [Rule 1 - Bug] active_task_ids test case used hardcoded ids**
- **Found during:** Task 3 (task-dispatch-requeue.test.ts)
- **Issue:** Test seeded `active_task_ids: [1, 2]` expecting task id 3, but auto-increment assigned id 1 to the inserted row.
- **Fix:** Use `[id + 100, id + 200]` relative to the actual inserted id.
- **Files modified:** `src/lib/__tests__/task-dispatch-requeue.test.ts`
- **Verification:** 7/7 requeue tests pass.
- **Committed in:** f728084 (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 blocking type-widening, 2 test-seed bugs).
**Impact on plan:** All three were within-task author corrections. No scope creep.

## Issues Encountered

- **gsd-tools.cjs path mismatch:** The plan references `./.claude/get-shit-done/bin/gsd-tools.cjs` but the project has no `.claude/get-shit-done/` directory; the tool lives at `/Users/aaronwhaley/.claude/get-shit-done/bin/gsd-tools.cjs` (user-global). The `init execute-phase` call succeeded from the user-global path. STATE.md / ROADMAP.md updates will use the same absolute path.
- **Plan 15-01 was partially landed before 15-02:** `src/lib/event-bus.ts` already carried the six Phase 15 union members (committed as `765aace` during this session), so every Task in 15-02 could reference `eventBus.broadcast('task.runner_requested', ...)` without TS error. The uncommitted `auth.ts` + `runner-tokens.ts` + `runner-tokens-allowlist.test.ts` changes in the working tree belong to Plan 15-01 Task 2 (not 15-02) and were NOT included in any 15-02 commit.

## Next Phase Readiness

- **Plan 15-03 (resume marker):** Already landed during this session (`2409141` + `85af186`). No blocking dependency from 15-02.
- **Plan 15-04 (checkpoints POST route):** Depends on Plan 15-01 Task 2 (auth.ts gate + runner-tokens.ts allowlist entry), which is staged but uncommitted. 15-04 should pick those up in its own commit.
- **Plan 15-05 (runner-exit retry emission):** Independent file surface; can proceed in parallel.
- **Plan 15-06 (daemon metadata_json.active_task_ids population):** Required for `isRecipeTaskStuck` to distinguish "runner lost this task" vs "runner conservatively treated as unknown." Until 15-06 lands, all fresh-heartbeat recipe rows will be skipped by `requeueStaleTasks` (the conservative side of the probe). This is the intended transitional behavior.

## Self-Check: PASSED

**File existence checks:**
- `src/lib/scheduler.ts` modified: FOUND (TICK_MS = 30_000 at line 277, `reconcileRunnerHeartbeat` import at line 13, `reconcile_runner_heartbeat` reg at line 402)
- `src/lib/task-dispatch.ts` modified: FOUND (autoRouteInboxTasks recipe fast-path, dispatchAssignedTasks `AND t.recipe_slug IS NULL`, requeueStaleTasks recipe branch, reconcileRunnerHeartbeat export)
- `src/app/api/tasks/route.ts` modified: FOUND (`task.runner_requested` emission block)
- `src/lib/__tests__/scheduler-reconcile.test.ts`: FOUND (6 tests)
- `src/lib/__tests__/task-dispatch-autoroute.test.ts`: FOUND (6 tests)
- `src/lib/__tests__/task-dispatch-dispatch.test.ts`: FOUND (4 tests)
- `src/lib/__tests__/task-dispatch-requeue.test.ts`: FOUND (7 tests)
- `src/lib/__tests__/task-dispatch-reconcile.test.ts`: FOUND (7 tests)
- `src/app/api/tasks/__tests__/route-recipe-emission.test.ts`: FOUND (6 tests)

**Commit existence checks:**
- 66ccd66 (Task 1): FOUND
- 8cf4108 (Task 2): FOUND
- f728084 (Task 3): FOUND
- 6f01e94 (Task 4): FOUND
- 9119a96 (Task 5): FOUND

**Test execution:** 36/36 new tests pass; 29/29 regression (task-routing + task-status + route.runtime-context) pass; `pnpm typecheck` exits 0.

---
*Phase: 15-checkpoints-scheduler-v1-2*
*Completed: 2026-04-20*
