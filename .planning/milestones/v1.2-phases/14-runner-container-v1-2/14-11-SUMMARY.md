---
phase: 14-runner-container-v1-2
plan: 11
subsystem: runner-http-api
tags: [runner, http-api, runner-token, runner-secret, submit, container-started, config, phase-14]

# Dependency graph
requires:
  - phase: 11-runtime-foundation-v1-2
    plan: 04
    provides: RUNNER_TOKEN_ALLOWLIST with /submit entry (line 12, src/lib/runner-tokens.ts); requireRunnerToken wrapper; atomic revokeTokensForTask
  - phase: 14-runner-container-v1-2
    plan: 01
    provides: task_runner_tokens table (migration 055) and task_runner_attempts table (migration 061) for token revocation + per-attempt semantics
  - phase: 14-runner-container-v1-2
    plan: 02
    provides: Five runtime.* getters (getMaxConcurrentContainers, getProjectRepoMap, getMaxMemoryPerContainer, getMaxCpuPerContainer, getFailedGcWindowDays) + DEFAULT_* constants
provides:
  - "POST /api/runner/tasks/:task_id/submit — runner-token scoped flip of in_progress → review + atomic revoke (Phase 14 shipped status='done' terminal semantics; Phase 17-01 RTEST-02 re-homed the endpoint to status='review' so Aegis can gate the final done flip; the docs below describe the Phase-14-era done behavior but the shipped code now flips to review)"
  - "POST /api/runner/tasks/:task_id/container-started — runner-secret scoped placeholder-swap (replaces pending:<task>:<attempt> with real docker container_id)"
  - "GET /api/runner/config — runner-secret scoped 5-key runtime config snapshot for daemon startup + SIGHUP reload"
  - "17 Vitest cases (7 + 6 + 4) pinning auth discrimination, idempotency, conflict, input validation"
affects:
  - 14-08b-runner-daemon (consumes all three routes)
  - 14-09-runner-docker-exec (hello-world agent submits via /submit)
  - 14-07-runner-preamble (preamble copy forward-references POST /api/runner/tasks/:id/submit)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Runner-token (-2000) vs runner-secret (-1000) principal discrimination at route layer — two separate auth gates with different id-sentinel checks after requireRole('operator')"
    - "Defense-in-depth runner_token_task_id cross-check in /submit handler (auth layer already discriminates on path task_id, but route re-verifies)"
    - "Placeholder-swap pattern: UPDATE tasks SET container_id = ? WHERE container_id LIKE 'pending:%' OR container_id IS NULL guards against the race where someone flips task terminal between claim (Plan 14-05) and docker run"
    - "Consolidated-GET pattern for daemon startup — one round-trip returns five runtime.* settings vs five individual GETs"

key-files:
  created:
    - src/app/api/runner/tasks/[task_id]/submit/route.ts
    - src/app/api/runner/tasks/[task_id]/submit/__tests__/route.test.ts
    - src/app/api/runner/tasks/[task_id]/container-started/route.ts
    - src/app/api/runner/tasks/[task_id]/container-started/__tests__/route.test.ts
    - src/app/api/runner/config/route.ts
    - src/app/api/runner/config/__tests__/route.test.ts
  modified: []

key-decisions:
  - "Resolution body field is advisory in Phase 14 — /submit handler persists it to task_runner_attempts.resolution_notes ONLY IF the column exists on the attempts table. Migration 061 does NOT include resolution_notes, so this is a forward-compat hook for a later migration. Handler probes pragma_table_info before writing; absence is silent (non-fatal)."
  - "container-started route guards the UPDATE on status='in_progress'. If task moved to terminal between the daemon's `docker run` and this call, the UPDATE affects 0 rows and returns 409 'task not in claimable state'. Prevents silently overwriting a post-terminal container_id."
  - "Idempotency discrimination in container-started is by EXACT match on the presented container_id against the stored one. Same id → 204 (no-op). Different real id → 409 (conflict). Placeholder → swap. This is a three-way fork, NOT a two-way: a naive 'if current != null → 409' would break idempotent retries from network timeouts."
  - "config route does NOT rate-limit. Read-only endpoints don't get mutationLimiter; the daemon polls this on SIGHUP, not per-request, so the cost model matches other runner-secret GETs (heartbeat GET, pending-containers GET, terminal-tasks GET)."
  - "Did NOT add entry to RUNNER_TOKEN_ALLOWLIST — /submit/ was pre-locked in Phase 11-04 (src/lib/runner-tokens.ts line 12). Container-started and config are runner-secret scoped so they don't go on the token allowlist at all."

patterns-established:
  - "Two-line principal check after requireRole: `requireRole('operator')` establishes auth, then `if (auth.user.id !== -1000)` (secret) or `if (auth.user.id !== -2000)` (token) narrows to the specific principal. This idiom repeats across all three routes in this plan and will repeat in every future runner route."
  - "Zod body at top of handler, error-first control flow, 204-no-content on success. Mirrors the minimal-body pattern established by Plan 11-04 runner-token endpoints."

requirements-completed: [RUNNER-06, RUNNER-11, RUNNER-13, WORK-06]

# Metrics
duration: 5min
completed: 2026-04-20
---

> **Doc-drift correction (Phase 18-03 / audit-td-3):** Original SUMMARY prose described the `/submit` endpoint as a "terminal-flip to done" that sets `task.status='done'` inside the transaction. Per Phase 17-01 RTEST-02 the shipped implementation flips `in_progress → review` (NOT `done`); Aegis quality approval then flips `review → done` in a separate transaction. SQL and Zod-body code blocks below are preserved as Phase-14-era snapshots — the shipped server transaction (rewritten by Phase 17-01) uses `SET status='review', ...` with `revokeTokensForTask` + status-change broadcast. Prose below has been corrected; commits, route files, tests, and migrations are unchanged by this correction.

# Phase 14 Plan 11: Submit + Container-Started + Config Runner Endpoints Summary

**Three runner-scoped endpoints the Phase 14 daemon and reference agent need to drive a task from claim to terminal: submit (agent terminal-flip), container-started (daemon placeholder-swap), config (daemon startup snapshot).**

## Performance

- **Duration:** ~5 min (Task 1: 2 min / Task 2: 2 min / Task 3: 1 min)
- **Started:** 2026-04-20T18:14:27Z
- **Completed:** 2026-04-20T18:16:52Z
- **Tasks:** 3
- **Files created:** 6 (3 routes + 3 test files)
- **Files modified:** 0
- **Tests added:** 17 (7 + 6 + 4)
- **Test pass rate:** 17/17

## Routes Delivered

| Route                                                     | Method | Auth scope        | Body                                  | Success |
| --------------------------------------------------------- | ------ | ----------------- | ------------------------------------- | ------- |
| `/api/runner/tasks/:task_id/submit`                       | POST   | runner-token (-2000) | `{ status: 'done', resolution? }`   | 204     |
| `/api/runner/tasks/:task_id/container-started`            | POST   | runner-secret (-1000) | `{ container_id: string }`         | 204     |
| `/api/runner/config`                                      | GET    | runner-secret (-1000) | —                                  | 200 JSON |

### submit

- **Body:** Zod `{ status: z.literal('done'), resolution?: z.string().max(10_000) }`. Phase 14 only supports `'done'` as a body value; the shipped server flips in_progress → review per Phase 17-01 RTEST-02 regardless of the body value; `'cancelled'` and `'failed'` are OUT of scope for this route (the daemon handles `failed` via runner-exit).
- **Atomic transaction:**
  > _Note (Phase 18-03 correction): Phase 17-01 RTEST-02 rewrote this UPDATE to `SET status='review', ...` with `revokeTokensForTask` + status-change broadcast. The SQL shown reflects the Phase-14-era implementation, not the current shipped behavior._

  `UPDATE tasks SET status='done', container_id=NULL, completed_at, updated_at` + `revokeTokensForTask(db, taskId)` in a single `db.transaction(() => { ... })()`.
- **Cross-task defense:** `auth.user.runner_token_task_id === taskId` must hold (403 otherwise). The auth layer already enforces this, but the route re-verifies as defense-in-depth.
- **Idempotency:** 409 if task is already in `{done, failed, cancelled}`.

### container-started

- **Body:** Zod `{ container_id: z.string().min(12).max(128).regex(/^[a-f0-9]+$/i) }`.
- **Placeholder-swap semantics:** `pending:<task>:<attempt>` → real docker container_id. Three-way fork on the current value:
  - Same id → 204 (idempotent retry)
  - Placeholder or NULL → swap to new id, 204
  - Different real id → 409 conflict
- **Race guard:** UPDATE guarded on `status='in_progress'` AND `container_id LIKE 'pending:%' OR IS NULL`. If terminal race wins, `changes=0` → 409.

### config

- **Response shape:**
  ```json
  {
    "project_repo_map": { "<project_id>": "<repo_path>" },
    "max_memory_per_container": "8g",
    "max_cpu_per_container": 4.0,
    "failed_gc_window_days": 7,
    "max_concurrent_containers": 4
  }
  ```
- **Source:** The five Phase 14-02 getters (`getMaxConcurrentContainers`, `getProjectRepoMap`, `getMaxMemoryPerContainer`, `getMaxCpuPerContainer`, `getFailedGcWindowDays`). Defensive-default pattern — missing rows or corrupted values fall back to `DEFAULT_*` constants.
- **No rate limit** (read-only). Matches the other runner-secret GET routes (heartbeat, pending-containers, terminal-tasks).

## Task Commits

Each task was committed atomically:

1. **Task 1: POST /api/runner/tasks/:task_id/submit + 7 tests** — `3daf4e4` (feat)
2. **Task 2: POST /api/runner/tasks/:task_id/container-started + 6 tests** — `547e902` (feat)
3. **Task 3: GET /api/runner/config + 4 tests** — `f10f386` (feat)

## Verification Results

- `pnpm test src/app/api/runner/tasks/[task_id]/submit src/app/api/runner/tasks/[task_id]/container-started src/app/api/runner/config -- --run` → **3 files / 17 tests / 0 failures**
- `pnpm lint` → **0 errors** (78 pre-existing warnings in unrelated files; none in new files)
- `pnpm typecheck` → **1 pre-existing error** in `src/app/api/runner/heartbeat/__tests__/route.test.ts:197` (Plan 14-04, already logged in `deferred-items.md` entry 1)
- `grep -n "\\/submit\\\\/?\\$" src/lib/runner-tokens.ts` → 1 line (allowlist entry pre-existing from Phase 11-04; this plan did NOT modify runner-tokens.ts, confirming the `locked_decisions` frontmatter item)

## Decisions Made

- **Resolution field is advisory with schema probe:** The /submit handler accepts `resolution?: string` up to 10k chars, but migration 061 (`task_runner_attempts`) does NOT include a `resolution_notes` column. Handler probes `pragma_table_info('task_runner_attempts')` and writes only when the column exists. Silent on absence — a later migration can add the column without breaking this handler.
- **Placeholder-swap is a three-way fork, not two:** `current === new → 204`, `current is placeholder/NULL → swap`, `current is different real id → 409`. A simpler two-way fork `if (current != null) { conflict }` would break idempotent retries from network timeouts, where the daemon already wrote the real id in a previous POST attempt that lost its response.
- **Cross-task defense-in-depth in /submit:** `auth.user.runner_token_task_id === taskId` is re-verified in the route handler even though the auth layer (`getUserFromRequest` → `requireRunnerToken`) already enforces this. The cost is one comparison; the benefit is no silent cross-task write if the auth layer is ever weakened by regression.
- **Runner-secret vs runner-token dispatch is explicit, not inferred:** Each route does `if (auth.user.id !== -EXPECTED_SENTINEL) return 403`. Never relies on `role === 'operator'` alone, because both runner-secret and runner-token map to `role='operator'`.
- **No rate limit on /api/runner/config:** Read-only, polled by the daemon at startup + SIGHUP, not per-request. Matches the pattern for other runner-secret GET routes. Rate limit would add noise without security value.

## Deviations from Plan

None — plan executed exactly as written. All three routes landed with the documented body shape, auth scope, and HTTP status codes. All 17 tests pass on first run.

## Issues Encountered

- **Pre-existing typecheck error** in `src/app/api/runner/heartbeat/__tests__/route.test.ts:197` (introduced by Plan 14-04 commit `60155f7`). Already logged in `deferred-items.md` entry 1. Out of scope for Plan 14-11.
- No test flakes; all suites green on first run.

## User Setup Required

None — additive HTTP routes, no environment variables, no migrations, no manual data bootstrap.

## Next Phase Readiness

- **Plan 14-07 (runner preamble):** Preamble copy can now forward-reference `POST {MC_API_URL}/api/runner/tasks/{MC_TASK_ID}/submit` with confidence that the route exists and accepts the documented body shape.
- **Plan 14-08b (runner daemon):** Daemon can:
  - GET /api/runner/config at startup + SIGHUP reload for the five runtime settings.
  - POST /api/runner/tasks/:id/container-started right after `docker run` returns, swapping the placeholder.
  - Rely on revokeTokensForTask firing transactionally when the agent /submits.
- **Plan 14-09 (hello-world agent):** `agent.mjs` can POST to /api/runner/tasks/:id/submit with its per-task runner-token for the terminal flip. The PUT /api/tasks/:id path originally drafted in earlier Phase 14 iterations would have failed the RUNNER_TOKEN_ALLOWLIST guard; /submit is the supported path.

No blockers for downstream plans.

## Self-Check: PASSED

- FOUND: `src/app/api/runner/tasks/[task_id]/submit/route.ts`
- FOUND: `src/app/api/runner/tasks/[task_id]/submit/__tests__/route.test.ts`
- FOUND: `src/app/api/runner/tasks/[task_id]/container-started/route.ts`
- FOUND: `src/app/api/runner/tasks/[task_id]/container-started/__tests__/route.test.ts`
- FOUND: `src/app/api/runner/config/route.ts`
- FOUND: `src/app/api/runner/config/__tests__/route.test.ts`
- FOUND commit: `3daf4e4` (Task 1 — submit)
- FOUND commit: `547e902` (Task 2 — container-started)
- FOUND commit: `f10f386` (Task 3 — config)

---

*Phase: 14-runner-container-v1-2*
*Completed: 2026-04-20*
