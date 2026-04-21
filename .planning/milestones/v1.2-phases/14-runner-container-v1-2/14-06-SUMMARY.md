---
phase: 14-runner-container-v1-2
plan: 06
subsystem: runner-api
tags: [runner, runner-exit, retry, revocation, runner-secret, atomic-transaction, phase-14]

# Dependency graph
requires:
  - phase: 14-runner-container-v1-2
    plan: 01
    provides: "task_runner_attempts table (migration 061) — this route is the primary UPDATE-site"
  - phase: 14-runner-container-v1-2
    plan: 02
    provides: "recipe.max_attempts Zod field — the filesystem re-parse helper reads it"
  - phase: 14-runner-container-v1-2
    plan: 03
    provides: "6 it.todo stubs in the test scaffold — all replaced by this plan"
  - phase: 11-runtime-foundation-v1-2
    plan: 04
    provides: "revokeTokensForTask — called atomically inside the terminal-fail transaction"
  - phase: 11-runtime-foundation-v1-2
    plan: 02
    provides: "runner-secret auth branch (id=-1000) in src/lib/auth.ts"
provides:
  - "POST /api/runner/tasks/:task_id/runner-exit route (204 on success, typed error responses)"
  - "formatFailureReason helper semantics: reason='exit' && exit_code != null → 'exit:${n}', else bare reason"
  - "Atomic retry-vs-fail state machine: attempts < cap → 'assigned'; attempts >= cap OR worktree_create_failed → 'failed' + tokens revoked"
  - "Filesystem re-parse of recipe.yaml for max_attempts (resolveRecipeMaxAttempts) — now shipped in src/lib/runner-claim.ts for reuse by Plan 14-05"
  - "Defensive warn-log when task_runner_attempts UPDATE affects 0 rows — preserves state machine forward-progress under a broken claim-route invariant"
affects:
  - 14-05-claim-endpoint (shares src/lib/runner-claim.ts; Plan 14-05 will extend with additional helpers)
  - 14-08b-runner-daemon (primary caller — posts runner-exit after every container exit)
  - 14-11-submit-endpoint (orthogonal — /submit owns successful-exit terminal flip)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Daemon-facing HTTP endpoint under /api/runner/* authenticated with runner-SECRET (id=-1000), not runner-TOKEN (id=-2000) — the per-attempt token may be expired at container-exit time"
    - "Route handler as a thin shell: auth → rate-limit → Zod parse → task load → cap resolution → atomic transaction; business logic lives in helpers (formatFailureReason, resolveRecipeMaxAttempts)"
    - "WHERE-clause status guard on the state-transition UPDATE (`WHERE id = ? AND status NOT IN (...)`) defends against a raced terminal transition without requiring SELECT-FOR-UPDATE"
    - "Atomic token revocation inside the same db.transaction as the status UPDATE — identical to the Phase 11-04 wiring on src/app/api/tasks/[id]/route.ts"
    - "Defensive warn-log on 0-rows-affected writes rather than hard-fail — a broken upstream invariant (claim didn't insert) should not wedge the state machine"

key-files:
  created:
    - src/app/api/runner/tasks/[task_id]/runner-exit/route.ts
    - src/lib/runner-claim.ts
  modified:
    - src/app/api/runner/tasks/[task_id]/runner-exit/__tests__/route.test.ts

key-decisions:
  - "Created src/lib/runner-claim.ts with ONLY resolveRecipeMaxAttempts to unblock 14-06 execution — Plan 14-05 (same wave) will extend the file with additional helpers. Avoided stubbing those helpers here to keep this plan's surface minimal."
  - "formatFailureReason uses `exit:${exit_code}` for ALL reason='exit' cases where exit_code != null, including exit_code=0. Successful-exit attempt rows still carry 'exit:0' so the attempt-history UI can distinguish a recorded successful run from a missing/unexited row."
  - "Idempotency guard checks task.status IN ('done','failed','cancelled') BEFORE any write — reject with 409 and do not touch task_runner_attempts. A daemon retrying a previously-successful POST should get a clean 409, not an overwritten attempt row."
  - "reason='worktree_create_failed' short-circuits to terminal fail regardless of runner_attempts. Rationale: worktree creation failures are infrastructure-level (missing project repo, fs perms) and won't succeed on retry within the same task's lifetime."
  - "Zod rejects `stderr_tail` longer than 16 KiB at the route surface. The cap mirrors the migration 061 column expectation and prevents a runaway container from posting megabytes of stderr."
  - "Idempotency of the UPDATE on task_runner_attempts: the row is UPSERTed only at claim time (Plan 14-05 INSERT ON CONFLICT DO NOTHING), so this route's UPDATE is the single exit-path write. Defensive warn-log on 0-rows-affected logs a message but proceeds with status transition."

patterns-established:
  - "Runner-secret endpoints under /api/runner/* share a 4-line auth preamble (requireRole('operator') + user.id === -1000 + mutationLimiter). Plans 14-04 / 14-06 / 14-11 all match this shape; future runner-daemon endpoints should copy the boilerplate verbatim."
  - "Test harness pattern for runner routes: vi.mock('@/lib/db') with a let-bound testDb + vi.mock('@/lib/auth') with a requireRoleMock whose mockReturnValueOnce is set per test via asRunner() / asSessionOperator() / asAuthFailure() helpers. Scales to all six runner routes in the phase."
  - "Filesystem-backed tests that exercise resolveRecipeMaxAttempts use MISSION_CONTROL_RECIPES_DIR + mkdtemp for isolation; afterEach restores the original env var. Plans 14-05 / later plans that touch recipe-on-disk helpers should reuse this shape."

requirements-completed: [RUNNER-11, WORK-06]

# Metrics
duration: 9min
completed: 2026-04-20
---

# Phase 14 Plan 06: Runner-Exit Retry/Fail Driver Summary

**`POST /api/runner/tasks/:task_id/runner-exit` — runner-secret authenticated daemon endpoint that persists container-exit metadata to `task_runner_attempts`, drives the retry (`assigned`) vs terminal-fail (`failed` + token revocation) state machine based on a resolved cap, and leaves successful exits alone so `/submit` (Plan 14-11) can own the terminal flip. 8/8 tests green.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-20T18:13:41Z
- **Completed:** 2026-04-20T18:22:01Z
- **Tasks:** 2 plan tasks (+ 1 pre-req helper-creation task)
- **Files created:** 2 (route + runner-claim helper)
- **Files modified:** 1 (test scaffold → full suite)
- **Test count:** 8 passing (RUNNER-11 + WORK-06)

## Request / Response Contract

### Request

- **Method:** POST
- **Path:** `/api/runner/tasks/:task_id/runner-exit`
- **Auth:** `Authorization: Bearer <runner-secret>` (runner principal, `user.id === -1000`)
- **Rate limit:** `mutationLimiter` (60/min/IP shared with other mutation routes)
- **Body (Zod-validated):**

```typescript
{
  exit_code: number | null,            // null on timeout / OOM / crash
  reason: 'exit' | 'timeout' | 'oom' | 'crash' | 'worktree_create_failed' | 'docker_error',
  stderr_tail?: string,                 // optional, max 16 KiB
  attempt: number,                      // positive integer matching the claim-route attempt
}
```

### Response codes

| Code | When                                                                 |
| ---- | -------------------------------------------------------------------- |
| 204  | Success — attempt persisted, state machine advanced when applicable  |
| 400  | Invalid JSON, Zod violations, or non-positive `task_id` path param   |
| 401  | Authentication failed (no bearer or wrong principal resolution)      |
| 403  | Authenticated but caller is not the runner-secret principal          |
| 404  | Task not found                                                        |
| 409  | Task already terminal — idempotency guard (do not retry)              |
| 500  | DB error while loading task or committing transaction                 |

## State Transitions Per Exit Kind

Resolved cap rule:
```
resolvedMaxAttempts = task.runner_max_attempts
                  ?? resolveRecipeMaxAttempts(task.recipe_slug)
                  ?? 3
```

| Kind                                     | Write                                                                             | Tokens        |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ------------- |
| Successful (exit_code=0 AND reason=exit) | `task_runner_attempts` UPDATE only. `tasks.status` untouched.                     | Unchanged      |
| Retry (attempts < cap)                   | `tasks.status='assigned'`, `container_id=NULL`, `runner_started_at=NULL`, reason  | Unchanged      |
| Terminal fail (attempts >= cap)          | `tasks.status='failed'`, `container_id=NULL`, reason                              | **Revoked**    |
| `reason='worktree_create_failed'`        | Forces terminal fail regardless of attempts                                        | **Revoked**    |

Successful exits DO NOT flip `tasks.status` to `done` here. That is the `POST /api/runner/tasks/:task_id/submit` endpoint's job (Plan 14-11) — the agent inside the container makes the deliberate choice that the task is complete.

## Cap Resolution — Filesystem Re-parse (LOCKED)

`recipe.max_attempts` is NOT round-tripped through the `recipes` DB row. `getIndexedRecipeBySlug` projects a fixed column set and has no `max_attempts` column (confirmed during Plan 14-02 execution).

This plan ships `resolveRecipeMaxAttempts(slug, recipesRootOverride?)` in `src/lib/runner-claim.ts` — a filesystem-only helper:

```typescript
import { getRecipesRoot } from '@/lib/recipe-watcher'
import { parseRecipeYaml } from '@/lib/recipe-schema'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function resolveRecipeMaxAttempts(
  slug: string,
  recipesRootOverride?: string,
): number | undefined { /* reads <root>/<slug>/recipe.yaml */ }
```

- Missing file / unreadable file / unparseable YAML → `undefined` (silent fallback). A corrupt recipe must NEVER wedge the state machine.
- `recipesRootOverride` parameter exists so tests can target an `mkdtemp` fixture without mutating `MISSION_CONTROL_RECIPES_DIR`.

Plan 14-05 (claim route) will extend `src/lib/runner-claim.ts` with additional helpers (`resolveEffectiveModel`, `composeEnvMap`, `resolveResourceLimits`, `checkGlobalCap`, `checkPerRecipeCap`, `readPriorAttempts`, `buildDispatchPayload`). This plan only shipped the minimal surface both plans agree on.

## Defensive UPDATE 0-rows Handling

The claim route (Plan 14-05) is expected to INSERT one `task_runner_attempts` row per `(task_id, attempt)`. If the row is missing at runner-exit time, the UPDATE returns `result.changes === 0`. The route's behaviour:

1. Emit `logger.warn({ task_id, attempt }, 'runner-exit: task_runner_attempts UPDATE affected 0 rows; proceeding with status transition')`.
2. Continue with the task-status transition anyway — retry branch or terminal-fail branch as applicable.
3. Return 204.

Rationale: losing a single attempt's exit metadata is strictly preferable to wedging the state machine in `in_progress` forever. The warn-log is the breadcrumb for a human to investigate the upstream claim-route invariant failure.

## Test Coverage — 8/8 Passing

Replaces the 6 Wave-0 `it.todo` stubs from Plan 14-03 and adds 2 cases. File: `src/app/api/runner/tasks/[task_id]/runner-exit/__tests__/route.test.ts`.

| # | Requirement | Description                                                                                        |
| - | ----------- | -------------------------------------------------------------------------------------------------- |
| 1 | RUNNER-11   | Successful exit (exit_code=0, reason='exit') persists attempt row, leaves task.status untouched     |
| 2 | RUNNER-11   | Non-zero exit with attempts < max → status='assigned', container_id cleared, failure_reason='exit:137' |
| 3 | WORK-06     | attempts >= max + reason='timeout' → status='failed' + ALL task tokens revoked atomically           |
| 4 | WORK-06     | Cap precedence across three sub-cases (task override null → recipe.yaml 5 → default 3)             |
| 5 | RUNNER-11   | Non-runner-secret principal → 403; no-bearer → 401; both leave state unchanged                      |
| 6 | RUNNER-11   | 409 when task already terminal; attempt row untouched (idempotency)                                 |
| 7 | RUNNER-11   | reason='worktree_create_failed' forces terminal fail even when attempts=1 of 5                      |
| 8 | RUNNER-11   | Missing `task_runner_attempts` row → defensive warn-log + status transition still happens           |

### Test Helpers

- `asRunner()` — resolves `requireRoleMock` to `{id: -1000}` (matches auth.ts runner-secret branch)
- `asSessionOperator()` — resolves to a real-user operator (id=7) so the id-guard at `user.id !== -1000` returns 403
- `asAuthFailure(status)` — resolves `requireRoleMock` to the `{error, status}` shape for 401/403 paths
- `seedTask({ status, recipe_slug, runner_attempts, runner_max_attempts, container_id, runner_started_at })` — inserts a task row with runner-relevant fields
- `seedAttempt(taskId, attempt, startedAt)` — inserts the `task_runner_attempts` row the claim route would have created
- `seedRunnerToken(taskId, attempt, hash, expiresAt)` — inserts a `task_runner_tokens` row so revocation can be asserted
- `stageRecipeYaml(slug, body)` — writes a real `recipe.yaml` to an `mkdtemp`'d dir and sets `MISSION_CONTROL_RECIPES_DIR` — exercises `resolveRecipeMaxAttempts` against the filesystem

## Tasks Completed

| # | Name                                                                   | Commit    | Files                                                                                 |
| - | ---------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------- |
| — | Pre-req: create src/lib/runner-claim.ts with resolveRecipeMaxAttempts  | `f7be87e` | `src/lib/runner-claim.ts`                                                             |
| 1 | Implement POST /api/runner/tasks/:task_id/runner-exit handler          | `0aa2c49` | `src/app/api/runner/tasks/[task_id]/runner-exit/route.ts`                             |
| 2 | Replace 6 it.todo stubs + add 2 cases (8 integration tests total)      | `a68dc1d` | `src/app/api/runner/tasks/[task_id]/runner-exit/__tests__/route.test.ts`              |

## Verification

- `pnpm test "src/app/api/runner/tasks/[task_id]/runner-exit" -- --run` → **8/8 pass, 268ms runtime**
- `pnpm typecheck` → exit 0, clean (plan surfaces introduce no new errors)
- `pnpm lint "src/app/api/runner/tasks/[task_id]/runner-exit" "src/lib/runner-claim.ts"` → **0 errors**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Created `src/lib/runner-claim.ts` ahead of Plan 14-05**

- **Found during:** Pre-execution dependency scan
- **Issue:** The plan's `<interfaces>` block imports `resolveRecipeMaxAttempts` from `@/lib/runner-claim`, but Plan 14-05 (which owns that file) has not been executed yet. Both plans live in Wave 1 and are intended to be file-disjoint for parallel execution, but 14-06's route cannot compile without the import target.
- **Fix:** Created `src/lib/runner-claim.ts` with ONLY the `resolveRecipeMaxAttempts` helper. Documented in the file header that Plan 14-05 will extend the module with its additional helpers (`resolveEffectiveModel`, `composeEnvMap`, `resolveResourceLimits`, `checkGlobalCap`, `checkPerRecipeCap`, `readPriorAttempts`, `buildDispatchPayload`).
- **Files modified:** `src/lib/runner-claim.ts`
- **Commit:** `f7be87e` (feat(14-06))
- **Impact on Plan 14-05:** None. 14-05 can extend the file with its helpers (the Plan 14-05 `<artifacts>` list explicitly calls out `exports: ["resolveEffectiveModel", "composeEnvMap", "buildDispatchPayload", "checkGlobalCap", "checkPerRecipeCap", "resolveRecipeMaxAttempts"]` so this plan shipping `resolveRecipeMaxAttempts` first is an expected merge, not a conflict).

**2. [Rule 3 — Blocking] Corrected Object.values-as-spread antipattern in test helper call site**

- **Found during:** Task 2 first test run
- **Issue:** I wrote `await POST(...Object.values(makePost(...)))` as a shorthand to avoid re-destructuring `{req, params}` at each call site. `Object.values` on an object literal is not guaranteed to preserve insertion order when keys have different types, and the destructured `params` landed in the first-argument slot instead of `req`. TypeError: `Cannot destructure property 'task_id' of '(intermediate value)' as it is undefined.`
- **Fix:** Explicit destructuring at every call site (`const call = makePost(...); POST(call.req, { params: call.params })`). Four call sites corrected.
- **Files modified:** `src/app/api/runner/tasks/[task_id]/runner-exit/__tests__/route.test.ts`
- **Commit:** `a68dc1d` (test(14-06), rolled in with the Task 2 commit)

### Commit-level observation (non-deviation)

- During execution, Plan 14-05 (claim route) appears to have been partially executed concurrently by another agent — `src/lib/runner-claim.ts` now contains additional helpers beyond the one I authored. The additions are in the uncommitted working tree, not in any of this plan's commits. Plan 14-05's executor will presumably commit them under its own message; this plan's commits (`f7be87e`, `0aa2c49`, `a68dc1d`) only touched this plan's files.

## Deferred Issues

None blocking. One pre-existing typecheck error in `src/app/api/runner/heartbeat/__tests__/route.test.ts` (Plan 14-04 scope) is logged in `.planning/phases/14-runner-container-v1-2/deferred-items.md` — belongs to 14-04, does not block 14-06.

## Self-Check: PASSED

- FOUND: `src/app/api/runner/tasks/[task_id]/runner-exit/route.ts`
- FOUND: `src/app/api/runner/tasks/[task_id]/runner-exit/__tests__/route.test.ts`
- FOUND: `src/lib/runner-claim.ts` (with `resolveRecipeMaxAttempts` export)
- FOUND commit `f7be87e` (runner-claim helper)
- FOUND commit `0aa2c49` (route handler)
- FOUND commit `a68dc1d` (integration tests)

---
*Phase: 14-runner-container-v1-2*
*Completed: 2026-04-20*
