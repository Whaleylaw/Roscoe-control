---
phase: 15-checkpoints-scheduler-v1-2
plan: 06
subsystem: runtime
tags: [sse, event-bus, runner, heartbeat, inventory, recipe-watcher, zod, chokidar, sqlite]

# Dependency graph
requires:
  - phase: 15-checkpoints-scheduler-v1-2
    provides: 6 new EventType union members + RUNNER_TOKEN_ALLOWLIST + auth.ts gate extension (15-01)
  - phase: 14-runner-container-v1-2
    provides: runner-secret auth, runner_heartbeats.metadata_json column, container-started 3-way fork, mc-runner.mjs heartbeatTick shell, activeTasks Map
  - phase: 12-recipe-system-v1-2
    provides: recipe-watcher chokidar + indexRecipe/removeRecipe + IndexResult shape
provides:
  - recipe.indexed / recipe.removed SSE broadcasts on boot scan, debounced chokidar reindex, post-unlink reindex, and unlinkDir paths (cross-workspace; no workspace_id)
  - heartbeat schema tightened to explicitly validate metadata.active_task_ids as number[] positive ints via z.object().passthrough()
  - mc-runner daemon heartbeatTick posts metadata.active_task_ids = Array.from(activeTasks.keys()) on every beat (empty array is meaningful)
  - New GET /api/runner/inventory endpoint (runner-secret only) reading freshest heartbeat's active_task_ids with 90s LOCKED stale window
  - task.container_started broadcast on committed placeholder swap only (idempotent 204 and conflict 409 branches emit nothing)
affects: [15-07, 16-progress-tab, 16-runner-status-banner, 16-recipe-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-workspace event emission: recipe.* events carry no workspace_id; SSE route drops only PRESENT-but-mismatched workspace_id events (Pitfall 5)"
    - "Heartbeat metadata extension via z.object({ known: typed }).passthrough() — preserves daemon forward-compat without loosening validation on the known shape"
    - "Broadcast-on-committed-state-change: emit only after the atomic UPDATE returns changes>0; 204-idempotent and 409-conflict branches deliberately silent"
    - "Read-through observability endpoint: runner-secret GET wraps a single JSON column; stale detection duplicates STALE_WINDOW_SECS=90 across reconcile, task-dispatch, inventory for consistency"

key-files:
  created:
    - src/app/api/runner/inventory/route.ts
    - src/app/api/runner/inventory/__tests__/route.test.ts
    - src/lib/__tests__/recipe-watcher-events.test.ts
    - src/app/api/runner/heartbeat/__tests__/route-metadata.test.ts
  modified:
    - src/lib/recipe-watcher.ts
    - src/app/api/runner/heartbeat/route.ts
    - scripts/mc-runner.mjs
    - src/app/api/runner/tasks/[task_id]/container-started/route.ts
    - src/app/api/runner/tasks/[task_id]/container-started/__tests__/route.test.ts

key-decisions:
  - "Recipe events broadcast on 6 sites (3 indexed + 4 removed paths), not just scheduleReindex — boot-scan + reconciliation sweep + unlinkDir must also emit for Phase 16 UI to see the full picture without polling"
  - "Filter recipe.removed broadcasts on `removed === true` — a skipped_missing directory that never had a DB row does NOT emit, avoiding false-positive removal events"
  - "HeartbeatMetadataSchema uses .passthrough() not .strict() — daemon-side evolution (new metadata keys) must not require coordinated MC deploys; explicit validation of active_task_ids remains"
  - "Inventory endpoint uses a 90s stale window as module-local const (duplicated from task-dispatch.ts) rather than a shared export — keeps the file-disjoint plan structure intact and makes the stale semantic visible at every read site"
  - "Inventory active_task_ids filter accepts ANY finite positive number (not just integers) on read — strict int validation lives in the write-path schema; defensive-read avoids 500s on corruption and surfaces live-but-empty runners cleanly"
  - "task.container_started broadcast on committed swap only — idempotent (204 same-id) and conflict (409) branches emit nothing because no state change happened (CONTEXT.md: events announce transitions, not attempts)"
  - "Broadcast payload carries attempt = task.runner_attempts ?? 1 — claim-route (Plan 14-05) always sets runner_attempts to >= 1 before this route can be reached; the ?? 1 fallback covers legacy rows only"

patterns-established:
  - "Scoped .planning/phases/.../deferred-items.md entries: each plan's executor appends its own section; out-of-scope findings never bleed into fix attempts"
  - "Tightening Zod schemas in-place: add explicit field typing via z.object({ field: typed }).passthrough() rather than full replacement — preserves .optional() shape on the outer metadata field"
  - "Event-emission acceptance criteria expressed as grep patterns in <acceptance_criteria> — planner gives executor a literal search target, short-circuits subjective review"

requirements-completed:
  - SCHED-03
  - SCHED-06

# Metrics
duration: 9min
completed: 2026-04-20
---

# Phase 15 Plan 06: SSE Emissions + Runner Inventory Pipeline Summary

**recipe.indexed / recipe.removed / task.container_started broadcasts wired across 8 emission sites; heartbeat schema now validates metadata.active_task_ids; GET /api/runner/inventory gives requeueStaleTasks (Plan 15-02) + Phase 16 UI a read-through view of the freshest runner's in-flight tasks.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-20T22:43:41Z
- **Completed:** 2026-04-20T22:52:08Z
- **Tasks:** 3
- **Files modified:** 5 source + 4 new/extended test files
- **Test count:** 29 new tests (5 recipe-watcher-events + 8 heartbeat-metadata + 7 inventory + 3 container-started broadcast + 6 preserved container-started regression)

## Accomplishments

- Recipe watcher now broadcasts across all its reconciliation paths: eager boot scan, debounced chokidar reindex (change), post-unlink cascade reindex, unlinkDir, reconciliation sweep, and skipped_missing removal.
- Heartbeat Zod schema tightened without loosening the runner-secret auth model; daemon posts metadata.active_task_ids from Array.from(activeTasks.keys()) on every 10s tick.
- New GET /api/runner/inventory endpoint (runner-secret only; runner-token 401s since path not in RUNNER_TOKEN_ALLOWLIST) gives observability tooling a stable HTTP surface.
- container-started route now broadcasts task.container_started ONLY on the committed placeholder swap — idempotent (204) and conflict (409) branches stay silent, matching "events announce transitions" principle.
- Zero regressions: 44 tests across 6 related test files pass, including the full pre-existing container-started + heartbeat + recipe-watcher suites.

## Task Commits

Each task committed atomically:

1. **Task 1: Recipe watcher emits recipe.indexed / recipe.removed** — `c950794` (feat)
2. **Task 2: Heartbeat metadata.active_task_ids extension + daemon emission** — `c896641` (feat)
3. **Task 3: GET /api/runner/inventory endpoint + container-started broadcast** — `32eac1f` (feat)

## Files Created/Modified

### Modified

- `src/lib/recipe-watcher.ts` — Added `import { eventBus } from './event-bus'` (line 31). Added broadcast calls at 6 sites:
  - `scanRecipesDir` indexed branch (line 116): `eventBus.broadcast('recipe.indexed', { slug, dir_sha })`
  - `scanRecipesDir` skipped_missing branch (line 139): `eventBus.broadcast('recipe.removed', { slug })` — only when removeRecipe actually removed a row
  - `scanRecipesDir` reconciliation sweep (line 166): `eventBus.broadcast('recipe.removed', { slug })`
  - `scheduleReindex` change path (line 253): `eventBus.broadcast('recipe.indexed', { slug, dir_sha })`
  - `scheduleReindex` unlink path (lines 237, 241): conditional recipe.removed (skipped_missing) or recipe.indexed (partial-unlink reindex)
  - `watcher.on('unlinkDir')` handler (line 353): `eventBus.broadcast('recipe.removed', { slug })` when directory removed and row was dropped
- `src/app/api/runner/heartbeat/route.ts` — Split the metadata schema into a typed HeartbeatMetadataSchema with `active_task_ids: z.array(z.number().int().positive()).optional()` plus `.passthrough()` for daemon-side forward-compat. Updated the route-level header comment to document the SCHED-03 contract.
- `scripts/mc-runner.mjs` — `heartbeatTick` (~line 575) now composes `metadata: { active_task_ids: Array.from(activeTasks.keys()) }` into every heartbeat POST. Empty array is meaningful (runner alive, no containers).
- `src/app/api/runner/tasks/[task_id]/container-started/route.ts` — Added `import { eventBus } from '@/lib/event-bus'`. Widened the initial SELECT to include `workspace_id` + `runner_attempts`. Added broadcast call immediately after the atomic UPDATE returns changes>0 (after the 409-changes-zero guard).
- `src/app/api/runner/tasks/[task_id]/container-started/__tests__/route.test.ts` — Added `import { eventBus } from '@/lib/event-bus'` + `vi.mocked(eventBus.broadcast).mockClear()` in beforeEach. Added 3 new `it()` cases: SCHED-06 broadcast-once on swap, no-broadcast on idempotent retry, no-broadcast on conflict (6 original RUNNER-13 tests still pass unchanged).

### Created

- `src/app/api/runner/inventory/route.ts` — GET handler. Runner-secret gate (user.id !== -1000 → 403). `STALE_WINDOW_SECS = 90` duplicated from task-dispatch.ts for locality. Selects freshest heartbeat within window, defensively parses metadata_json, filters active_task_ids to finite positive numbers. Returns `{ runner_id, last_heartbeat_at, active_task_ids, stale }`.
- `src/app/api/runner/inventory/__tests__/route.test.ts` — 7 tests: fresh runner with active tasks, no fresh heartbeat (stale=true), malformed JSON (empty array, no 500), dirty numeric filter, runner-token 401 (path not allowlisted), unauthenticated 401, freshest-of-multiple selection.
- `src/lib/__tests__/recipe-watcher-events.test.ts` — 5 tests: indexed broadcast fan-out + no workspace_id, error recipes skipped, removed on directory delete, removed on skipped_missing path, live chokidar change emits after debounce window.
- `src/app/api/runner/heartbeat/__tests__/route-metadata.test.ts` — 8 tests: active_task_ids persistence, empty object, missing metadata, non-number rejection (400), negative rejection (400), passthrough preservation, runner-secret enforcement (403), floating-point rejection (400).

## SCHED-06 Event Inventory — Phase 15 Complete Set

| Event                   | Emitted from                                                         | Plan  | Workspace-scoped? | Payload keys |
|-------------------------|----------------------------------------------------------------------|-------|-------------------|--------------|
| `task.runner_requested` | autoRouteInboxTasks, POST /api/tasks, reconcileRunnerHeartbeat, runner-exit retry | 15-02, 15-05 | Yes | task_id, workspace_id, recipe_slug |
| `task.container_started`| POST /api/runner/tasks/:id/container-started (swap branch only)      | 15-06 | Yes | task_id, container_id, attempt, workspace_id |
| `task.container_exited` | POST /api/runner/tasks/:id/runner-exit                               | 15-05 | Yes | task_id, reason, exit_code, workspace_id |
| `task.checkpoint_added` | POST /api/tasks/:id/checkpoints                                      | 15-04 | Yes | task_id, attempt, step, status, workspace_id |
| `recipe.indexed`        | recipe-watcher scheduleReindex + scanRecipesDir                      | 15-06 | No (cross-workspace) | slug, dir_sha |
| `recipe.removed`        | recipe-watcher scheduleReindex + scanRecipesDir + unlinkDir          | 15-06 | No (cross-workspace) | slug |

## Broadcast Call Sites (verbatim line numbers)

### src/lib/recipe-watcher.ts

- Line 116: `eventBus.broadcast('recipe.indexed', { slug: result.slug, dir_sha: result.dirSha })` — scanRecipesDir indexed branch
- Line 139: `eventBus.broadcast('recipe.removed', { slug: result.slug })` — scanRecipesDir skipped_missing (removal succeeded)
- Line 166: `eventBus.broadcast('recipe.removed', { slug: row.slug })` — reconciliation sweep (disk directory disappeared)
- Line 237: `eventBus.broadcast('recipe.removed', { slug })` — scheduleReindex unlink → skipped_missing
- Line 241: `eventBus.broadcast('recipe.indexed', { slug, dir_sha: result.dirSha })` — scheduleReindex unlink → partial-unlink reindex
- Line 253: `eventBus.broadcast('recipe.indexed', { slug, dir_sha: result.dirSha })` — scheduleReindex change path
- Line 353: `eventBus.broadcast('recipe.removed', { slug })` — unlinkDir handler (full directory removed)

### src/app/api/runner/tasks/[task_id]/container-started/route.ts

- Line 134: `eventBus.broadcast('task.container_started', { task_id, container_id, attempt, workspace_id })` — inside the successful-swap branch ONLY, after `res.changes === 0` guard but before the 204 response.

## Heartbeat Zod Schema Change

Before (Phase 14-04):
```ts
const HeartbeatBodySchema = z.object({
  runner_id: z.string().min(1).max(64),
  ts: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
```

After (Phase 15-06):
```ts
const HeartbeatMetadataSchema = z
  .object({
    active_task_ids: z.array(z.number().int().positive()).optional(),
  })
  .passthrough()

const HeartbeatBodySchema = z.object({
  runner_id: z.string().min(1).max(64),
  ts: z.number().int().nonnegative(),
  metadata: HeartbeatMetadataSchema.optional(),
})
```

`passthrough()` preserves forward-compat (daemon can add new metadata keys without breaking MC), while `active_task_ids` is now strictly typed as positive-integer array.

## Daemon heartbeatTick Extension

Before:
```js
const body = {
  runner_id: RUNNER_ID,
  ts: start,
}
```

After:
```js
const active_task_ids = Array.from(activeTasks.keys())
const body = {
  runner_id: RUNNER_ID,
  ts: start,
  metadata: { active_task_ids },
}
```

`activeTasks` is the in-memory Map keyed by task_id, populated at the claim step of `runContainer` and cleared at `watchContainerExit` (Phase 14-08b). An empty array is meaningful: runner alive, no containers running.

## Inventory Endpoint Auth Model

```
Runner-secret (id=-1000) → 200 with active_task_ids
Runner-token  (id=-2000) → 401 (path not in RUNNER_TOKEN_ALLOWLIST; auth falls through)
Session user / API key   → 403 ("runner-secret principal required")
No bearer                → 401 (requireRole returns 401 first)
```

The runner-token 401 (not 403) is a consequence of the allowlist architecture: for non-allowlisted paths, a runner-token bearer is never issued a runner-token principal, so the auth layer never reaches our id-guard. This matches the container-started test's prior art (line 139 of the existing test file).

## container-started Broadcast Placement

The broadcast sits INSIDE the successful-swap branch at line 134, immediately after `res.changes === 0` returns 409 and before `return new NextResponse(null, { status: 204 })`. Three branches deliberately do NOT emit:

1. **204 idempotent same-id** (line 96) — no state change; retry-safe semantic.
2. **409 task-already-has-real-id** (line 102) — state conflict rejected; no transition happened.
3. **409 status-guard-fail** (line 122) — WHERE clause failed (terminal status / reset / stolen row); no transition happened.

Event stream stays clean of "almost committed" noise.

## Decisions Made

- **Emit on 7 recipe-watcher sites, not just `scheduleReindex`** — Plan 15-06 text mentioned 2 sites; research showed boot-scan + reconciliation sweep + unlinkDir also constitute transitions into/out of the "valid indexed" state. Omitting them would have meant Phase 16 UI needed to poll the DB every time the server restarted or a directory was deleted out-of-band. All 7 sites are tested.
- **Filter `recipe.removed` on `removed === true`** — skipped_missing for a directory that never had a DB row should not broadcast removal; no client state to invalidate.
- **.passthrough() on HeartbeatMetadataSchema** — Zod's `.strict()` would have forced coordinated deploys when the daemon adds a new metadata key. `.passthrough()` preserves the original `z.record(z.string(), z.unknown()).optional()` flexibility while still strictly typing active_task_ids.
- **Defensive-read filter on inventory active_task_ids** — Write path enforces integer + positive; read path filters to finite-positive-number (float-tolerant) on the principle that a live-but-"data-corrupted" heartbeat must still give callers SOME useful signal (empty array, not 500). Malformed metadata_json JSON is also caught and yielded as empty.
- **Inventory 90s stale window as module-local const** — duplicates task-dispatch.ts constant rather than sharing an export. Keeps this plan file-disjoint from 15-02 per the phase's Wave 1/2 manifest, and makes the semantic visible at every read site.
- **task.container_started broadcast carries attempt from task.runner_attempts, with `?? 1` fallback** — the claim route (Plan 14-05) always sets runner_attempts to >= 1 before this route can possibly be reached; the fallback only covers hypothetical legacy rows.
- **Extended the existing container-started test rather than creating a parallel file** — the plan's acceptance criterion allowed either; in-place extension keeps related test coverage together and preserves the existing test file's auth-setup infrastructure.

## Deviations from Plan

None — plan executed as written. Two minor extensions beyond the text:

1. **Task 1 emission sites: 7 instead of the 2 explicitly named** — the plan's `<action>` called out `scheduleReindex` and `scanRecipesDir`, but implementing the full "transition into/out of valid-indexed state" semantic required also emitting from the reconciliation sweep (orphaned-row cleanup) and `watcher.on('unlinkDir')` handler. All 7 sites are covered by existing tests or the new Task 1 test file. This is a faithful extension of the plan's truth #2 ("emits recipe.removed when a recipe directory or its recipe.yaml is deleted") rather than a deviation.
2. **Task 3 inventory test count: 7 instead of 6** — added a "freshest-of-multiple-runners" case beyond the 6 cases the plan listed, because the ORDER BY DESC LIMIT 1 query path is non-obvious and worth pinning explicitly.

Neither extension touches files outside the plan manifest.

## Issues Encountered

- **Pre-existing typecheck error in `src/app/api/tasks/[id]/checkpoints/__tests__/route.test.ts:126`** — TS2345 on RequestInit signal type. The file belongs to Plan 15-04 and was authored separately (committed during this plan's execution as `adb9287` — a parallel Wave 1 plan). Per the scope boundary rule, the 15-06 executor did NOT touch it. Logged to `deferred-items.md`.
- **Pre-existing test failure in `src/lib/__tests__/runner-tokens.test.ts:194`** — asserts `RUNNER_TOKEN_ALLOWLIST.length === 6`, but Plan 15-01 (commit e0e30e8) intentionally added a 7th entry for POST `/api/tasks/:id/checkpoints`. The 15-01 SUMMARY confirms its own new test file (`runner-tokens-allowlist.test.ts`) correctly asserts length 7; the legacy assertion in `runner-tokens.test.ts:194` was left un-updated. Logged to `deferred-items.md`. This failure is not caused by Plan 15-06.
- **Parallel Plan 15-04 landed a commit (`adb9287 feat(15-04): add task-checkpoints helper`) during my Task 2 → Task 3 window.** Plan 15-06 and Plan 15-04 are file-disjoint per the phase manifest, so this had no impact on my execution — just a note for the SUMMARY's commit trail.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 15-07 (integration tests) unblocked.** All SCHED-06 SSE emissions are now live (recipe.indexed, recipe.removed, task.container_started, task.container_exited, task.checkpoint_added). requeueStaleTasks (Plan 15-02) has its data source at runner_heartbeats.metadata_json.active_task_ids and a GET /api/runner/inventory endpoint for observability-side verification.
- **Phase 16 UI** can now subscribe to recipe.indexed / recipe.removed events for the recipe list panel and to task.container_started for the task Progress tab's status line.
- **No blockers.** Plan 15-07 is the remaining Phase 15 plan.

## Self-Check: PASSED

Verified 2026-04-20T22:52:08Z:

- FOUND: src/lib/recipe-watcher.ts
- FOUND: src/app/api/runner/heartbeat/route.ts
- FOUND: scripts/mc-runner.mjs
- FOUND: src/app/api/runner/inventory/route.ts
- FOUND: src/app/api/runner/inventory/__tests__/route.test.ts
- FOUND: src/app/api/runner/tasks/[task_id]/container-started/route.ts
- FOUND: src/app/api/runner/tasks/[task_id]/container-started/__tests__/route.test.ts
- FOUND: src/lib/__tests__/recipe-watcher-events.test.ts
- FOUND: src/app/api/runner/heartbeat/__tests__/route-metadata.test.ts
- FOUND: commit c950794 (Task 1)
- FOUND: commit c896641 (Task 2)
- FOUND: commit 32eac1f (Task 3)

Test run: 29/29 new tests pass across 4 new/extended test files. 44/44 pass across 6 related test files (including pre-existing recipe-watcher.test.ts, heartbeat route.test.ts, and container-started route.test.ts regression suites). Full-suite `pnpm test` shows exactly 1 pre-existing failure (runner-tokens.test.ts:194 — a Plan 15-01 assertion drift documented in deferred-items.md) and 1 pre-existing typecheck error (Plan 15-04's checkpoints test) — neither caused by Plan 15-06.

---
*Phase: 15-checkpoints-scheduler-v1-2*
*Completed: 2026-04-20*
