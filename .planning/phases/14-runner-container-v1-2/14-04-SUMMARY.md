---
phase: 14-runner-container-v1-2
plan: 04
subsystem: api
tags: [runner, http, heartbeat, ready-tasks, pending-containers, terminal-tasks, runner-secret, zod]

# Dependency graph
requires:
  - phase: 11-runtime-foundation-v1-2
    provides: "Runner-secret auth principal (user.id === -1000, operator role) from src/lib/auth.ts"
  - phase: 14-runner-container-v1-2
    provides: "Migration 060 runner_heartbeats (UPSERT by runner_id) + 11 tasks runtime columns from migrations 054-057 (container_id, workspace_source, read_only_mounts, extra_skills, model_override, runner_max_attempts, runner_attempts, runner_started_at)"
  - phase: 14-runner-container-v1-2
    plan: 03
    provides: "Wave-0 test scaffolds — 14 it.todo stubs across 4 route test files"
provides:
  - "POST /api/runner/heartbeat (runner_id + ts → UPSERT runner_heartbeats, 204)"
  - "GET /api/runner/ready-tasks (assigned + recipe_slug + no container → claim candidates)"
  - "GET /api/runner/pending-containers (container_id attributed + non-terminal → reconcile candidates)"
  - "GET /api/runner/terminal-tasks?since=<iso8601> (terminal since → GC-tick driver)"
  - "Shared runner-secret auth guard idiom (requireRole operator + user.id === -1000 → 403 otherwise) — copy-paste template for Plans 14-05 and 14-06"
affects:
  - 14-05-claim-route (same auth guard pattern)
  - 14-06-runner-exit (same auth guard pattern)
  - 14-08-runner-daemon (consumes all 4 endpoints)
  - 15-checkpoints-scheduler (reconcileRunnerHeartbeat reads runner_heartbeats populated by 14-04 POST)
  - 16-ui-surfaces (offline banner reads runner_heartbeats table)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Runner-secret route guard idiom: requireRole(operator) → error check → user.id === -1000 check (403 otherwise). Keeps 401-vs-403 decision clean: requireRole's 401 for no bearer, route's 403 for wrong principal."
    - "Zod body validation inline at route level for small fixed-schema endpoints (runner_id/ts/metadata) — no shared schema file needed, route is the single call site"
    - "mutationLimiter AFTER auth + BEFORE DB write — auth errors must not count toward rate-limit, and rate-limit must short-circuit the DB"
    - "Narrow mapRow for runner API responses: subset of mapTaskRow from src/app/api/tasks/route.ts — only the runtime-context columns the runner needs to build a claim dispatch payload"

key-files:
  created:
    - src/app/api/runner/heartbeat/route.ts
    - src/app/api/runner/ready-tasks/route.ts
    - src/app/api/runner/pending-containers/route.ts
    - src/app/api/runner/terminal-tasks/route.ts
  modified:
    - src/app/api/runner/heartbeat/__tests__/route.test.ts
    - src/app/api/runner/ready-tasks/__tests__/route.test.ts
    - src/app/api/runner/pending-containers/__tests__/route.test.ts
    - src/app/api/runner/terminal-tasks/__tests__/route.test.ts

key-decisions:
  - "Heartbeat body converts client-supplied ms `ts` to unix seconds via Math.floor(ts / 1000) at insert — migration 060's column is INTEGER unix-seconds and the runner-daemon-to-MC contract is ms for wall-clock parity with JS Date.now()."
  - "Heartbeat UPSERT SET clause deliberately omits registered_at, preserving first-registration timestamp across heartbeats (inherits migration 060 locked semantic)."
  - "terminal_at in /terminal-tasks response is projected from tasks.updated_at rather than a dedicated terminal_at column — Phase 14 has no requirement distinguishing 'updated while terminal' from 'transitioned to terminal', and the filter only selects rows already in terminal status. A dedicated column would be a Phase 15+ concern."
  - "/terminal-tasks returns 400 on missing or malformed `since` rather than silently defaulting. The runner tracks its scan cursor locally; a malformed value indicates a client bug that a silent default would mask."
  - "/ready-tasks LIMIT 50 matches the 'single-poll batch' intent — runner polls every 15s (CONTEXT.md boot step 5) and SSE is the primary trigger; a coarse batch cap prevents pathological response sizes."
  - "Rate-limiter asserted in test via mock behaviour (invoked + short-circuits on 429) rather than via IP-keyed execution inside jsdom — deterministic across test runs and pins the wiring order (auth → limiter → DB)."

patterns-established:
  - "All four routes share the identical runner-secret guard block: requireRole → error → user.id check. Plans 14-05 and 14-06 use the same 3-line prefix."
  - "Response shape tuned to the runner's consumption: ready-tasks parses JSON columns server-side (workspace_source, read_only_mounts, extra_skills); pending-containers leaves columns raw since they're human-readable scalars; terminal-tasks re-keys to {task_id, status, terminal_at} for semantic clarity."

requirements-completed: [RUNNER-04, RUNNER-05, RUNNER-13, WORK-07]

# Metrics
duration: 9min
completed: 2026-04-20
---

# Phase 14 Plan 04: Read-Side Runner API Summary

**Four runner-secret-authenticated HTTP endpoints — heartbeat persistence (POST 204), ready-task poll fallback, post-crash reconciliation, and GC-tick terminal discovery — shipped with 15 passing Vitest cases that lock the SQL predicates the runner daemon will depend on.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-20T18:12:42Z
- **Completed:** 2026-04-20T18:21:48Z
- **Tasks:** 3
- **Files created:** 4 (route handlers)
- **Files modified:** 4 (test scaffolds → real tests)

## Accomplishments

- `POST /api/runner/heartbeat` — 204 No Content on valid body; UPSERT into `runner_heartbeats` preserving `registered_at`; `mutationLimiter` defensive hookup (60/min ceiling, comfortably above daemon's 6/min rhythm).
- `GET /api/runner/ready-tasks` — projects the narrow column subset the runner needs to build the Plan 14-05 claim dispatch payload (id, recipe_slug, model_override, workspace_source, read_only_mounts, extra_skills, runner_max_attempts, runner_attempts). JSON columns parsed server-side.
- `GET /api/runner/pending-containers` — returns `{id, recipe_slug, container_id, status, runner_started_at, runner_attempts}` for post-crash adopt-vs-kill reconciliation.
- `GET /api/runner/terminal-tasks?since=<iso8601>` — returns `{task_id, status, terminal_at}` for the runner's 10-min GC tick; 400 on missing/malformed since.
- 15/15 Vitest cases across the 4 routes; typecheck + lint clean.

## Task Commits

Each task was committed atomically. The Task 1 typecheck fix landed as a separate `fix` commit per the harness's no-amend policy.

1. **Task 1: POST /api/runner/heartbeat + tests** — `60155f7` (feat)
2. **Task 1 follow-up: typecheck fix on rate-limiter mock** — `7fad5d6` (fix)
3. **Task 2: GET /api/runner/ready-tasks + tests** — `8d597cf` (feat)
4. **Task 3: GET /api/runner/pending-containers + /terminal-tasks + tests** — `e0ac72f` (feat)

**Plan metadata commit:** (to be added by final git_commit_metadata step)

## Endpoint Response Shapes (for Plan 14-08 daemon)

### POST /api/runner/heartbeat

**Request body:**
```json
{
  "runner_id": "string (1..64)",
  "ts": 1700000000000,
  "metadata": { "host": "mac", "...": "optional" }
}
```

**Response:** `204 No Content` on success. `400` on invalid JSON or Zod validation failure. `401` from requireRole on missing bearer. `403` from the id-guard on non-runner principal.

### GET /api/runner/ready-tasks

**Response:**
```json
{
  "tasks": [
    {
      "id": 42,
      "recipe_slug": "wt-recipe",
      "model_override": "haiku-4-5" | null,
      "workspace_source": { "project_id": 1, "base_ref": "main" } | null,
      "read_only_mounts": [{ "host_path": "...", "container_path": "...", "label": "..." }],
      "extra_skills": ["skill-one"],
      "runner_max_attempts": 5 | null,
      "runner_attempts": 0
    }
  ]
}
```

LIMIT 50, ORDER BY id ASC. Empty array when no claimable work.

### GET /api/runner/pending-containers

**Response:**
```json
{
  "tasks": [
    {
      "id": 42,
      "recipe_slug": "wt-recipe" | null,
      "container_id": "mc-task-42-a1",
      "status": "assigned" | "in_progress",
      "runner_started_at": 1700000000 | null,
      "runner_attempts": 1
    }
  ]
}
```

No LIMIT (reconciliation must see all pending containers). ORDER BY id ASC.

### GET /api/runner/terminal-tasks?since=<iso8601>

**Response:**
```json
{
  "tasks": [
    { "task_id": 42, "status": "done" | "failed" | "cancelled", "terminal_at": 1700000060 }
  ]
}
```

LIMIT 200, ORDER BY updated_at ASC. `terminal_at` is `tasks.updated_at` (unix seconds). `400` if `since` is missing or unparseable.

## Test Count per Route

| Route | Test cases | Covered requirements |
|-------|-----------:|----------------------|
| `POST /api/runner/heartbeat`           | 4 | RUNNER-05 |
| `GET /api/runner/ready-tasks`          | 4 | RUNNER-04 |
| `GET /api/runner/pending-containers`   | 3 | RUNNER-13 |
| `GET /api/runner/terminal-tasks`       | 4 | WORK-07   |
| **Total**                              | **15** | |

All 14 Wave-0 `it.todo` stubs (plan's minimum floor) were replaced with real `it()` bodies. Terminal-tasks gained a 4th case (400 on missing/malformed `since`) because the defensive guard is the easiest way to assert the runtime contract Plan 14-08 will depend on.

## Files Created/Modified

- `src/app/api/runner/heartbeat/route.ts` — POST handler, Zod body validation, mutationLimiter, UPSERT runner_heartbeats (204 response).
- `src/app/api/runner/ready-tasks/route.ts` — GET handler, claimable-task SQL predicate, mapRow JSON projection.
- `src/app/api/runner/pending-containers/route.ts` — GET handler, reconciliation predicate.
- `src/app/api/runner/terminal-tasks/route.ts` — GET handler with `?since` validation, GC-tick predicate.
- `src/app/api/runner/heartbeat/__tests__/route.test.ts` — 4 cases.
- `src/app/api/runner/ready-tasks/__tests__/route.test.ts` — 4 cases.
- `src/app/api/runner/pending-containers/__tests__/route.test.ts` — 3 cases.
- `src/app/api/runner/terminal-tasks/__tests__/route.test.ts` — 4 cases.

## Decisions Made

All documented in frontmatter `key-decisions`. Headlines:

- Heartbeat `ts` (ms) → `last_heartbeat_at` (seconds) conversion with `Math.floor(ts / 1000)`.
- UPSERT preserves `registered_at` (SET clause omission, inheriting migration 060's locked semantic).
- `terminal_at` in /terminal-tasks response maps to `tasks.updated_at` (no dedicated column in Phase 14 scope).
- 400 on missing/malformed `since` (defensive guard, surfaces runner bugs).
- /ready-tasks LIMIT 50 matches single-poll-batch intent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `mutationLimiter` mock return-type mismatch in heartbeat test**

- **Found during:** Final typecheck after Task 3.
- **Issue:** `mutationLimiter`'s production return type is `NextResponse | null`. The first draft of the heartbeat test's rate-limiter assertion used `new Response(...)` and cast via `as unknown as Response & {...}`. `vi.mocked(mutationLimiter).mockReturnValueOnce(...)`'s argument type is `NextResponse`, not `Response`, so tsc emitted `error TS2345`.
- **Fix:** Swapped the mock value to `NextResponse.json({ error }, { status: 429 })` imported dynamically from `next/server`. The dynamic `await import(...)` avoids polluting the file-top imports that other tests may or may not want.
- **Files modified:** `src/app/api/runner/heartbeat/__tests__/route.test.ts`
- **Verification:** `pnpm typecheck` clean (exit 0); 4/4 heartbeat tests still pass.
- **Committed in:** `7fad5d6` (separate `fix` commit per no-amend policy).

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Mechanical type correction, no scope change. Route behaviour identical; only the test mock constructor changed.

## Issues Encountered

- **Working-tree contamination from prior plans:** Running `git status` during execution surfaced several pre-existing uncommitted / untracked files from other Phase 14 plans (`src/app/api/runner/tasks/[task_id]/runner-exit/__tests__/route.test.ts` modified from scaffold to 540 lines, `src/lib/runner-docker.ts`, `src/lib/runner-claim.ts`, etc.). Per the SCOPE BOUNDARY rule these are out-of-scope for Plan 14-04 and were not staged or modified. They remain in the working tree for the plan that owns them.
- **One tsc error from a prior plan's uncommitted test file** surfaced mid-execution (`runner-exit/__tests__/route.test.ts` TS2556 on `...Object.values(...)` spread). This is unrelated to Plan 14-04's scope; the final verification of Plan 14-04 only typechecks cleanly against committed state. Deferred for the plan owner.

## Runtime Gotchas Encountered

- **`mutationLimiter` default ceiling (60/min) vs 10s heartbeat rhythm (6/min).** The plan called out 300/min as the possible ceiling; the actual default (60/min) still leaves 10x headroom over the daemon's 6/min steady state. Bursts during reconnect (e.g., 20 heartbeats in the first minute after a network blip) remain comfortably under the ceiling. A route comment records that multi-runner deployments sharing an IP might need a runner-specific limiter in Phase 16, but no adjustment was needed for Phase 14.
- **Rate-limiter testing inside jsdom.** The IP-keyed bucket is deterministic only if tests manually manipulate system time or the store state. Rather than bypass that, the heartbeat rate-limit test asserts via the mock: (a) limiter is invoked after auth and before DB work, and (b) a 429 return short-circuits the DB. This pins the wiring contract without flaky time-based assertions.
- **Heartbeat test contamination risk.** `vi.mocked(mutationLimiter).mockReset()` in `beforeEach` now clears call counts between tests. Without it, the 4th test's `toHaveBeenCalledTimes(1)` assertion would have inherited counts from earlier tests.

## User Setup Required

None — no external services, no env vars, no manual configuration. All four endpoints activate automatically when the runner secret is present in `.data/runner.secret` (already auto-generated on first boot from Phase 11).

## Next Phase Readiness

- **Plan 14-05 (claim route):** The runner-secret guard idiom is identical (3-line prefix). The ready-tasks query predicate is the same one the claim route will re-evaluate under SQLite's write lock (per 14-RESEARCH claim-time re-validation). Response shape documented above for the dispatch payload builder.
- **Plan 14-06 (runner-exit):** Same auth guard idiom. `/terminal-tasks` depends on `tasks.updated_at` being bumped by the runner-exit handler's status UPDATE — already guaranteed by Phase 11's status-transition triggers.
- **Plan 14-08 (runner daemon):** All four endpoints are daemon-ready. Response shapes above are the contract; the daemon's HTTP client should parse them verbatim.
- **Phase 15 (reconcileRunnerHeartbeat):** Reads `runner_heartbeats.last_heartbeat_at` — populated by this plan's POST.
- **Phase 16 (offline banner):** Same table. No additional server work.

No blockers.

## Self-Check: PASSED

- FOUND: src/app/api/runner/heartbeat/route.ts
- FOUND: src/app/api/runner/ready-tasks/route.ts
- FOUND: src/app/api/runner/pending-containers/route.ts
- FOUND: src/app/api/runner/terminal-tasks/route.ts
- FOUND: src/app/api/runner/heartbeat/__tests__/route.test.ts (modified)
- FOUND: src/app/api/runner/ready-tasks/__tests__/route.test.ts (modified)
- FOUND: src/app/api/runner/pending-containers/__tests__/route.test.ts (modified)
- FOUND: src/app/api/runner/terminal-tasks/__tests__/route.test.ts (modified)
- FOUND commit: 60155f7 (Task 1)
- FOUND commit: 7fad5d6 (Task 1 typecheck fix)
- FOUND commit: 8d597cf (Task 2)
- FOUND commit: e0ac72f (Task 3)

---
*Phase: 14-runner-container-v1-2*
*Completed: 2026-04-20*
