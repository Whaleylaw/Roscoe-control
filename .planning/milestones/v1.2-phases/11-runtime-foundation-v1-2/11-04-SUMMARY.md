---
phase: 11-runtime-foundation-v1-2
plan: 04
subsystem: auth
tags: [auth, runner-token, bearer, principal, v1.2, runtime, rauth-02, rauth-03, rauth-04, rauth-05, rauth-06]

requires:
  - phase: 11-runtime-foundation-v1-2
    plan: 02
    provides: runner-secret branch in getUserFromRequest (the pattern + placement the runner-token branch mirrors); extractApiKeyFromHeaders shared extractor
  - phase: 11-runtime-foundation-v1-2
    plan: 03
    provides: task_runner_tokens table (migration 055) with {task_id, attempt, token_hash, expires_at, revoked_at} columns and partial index on non-revoked rows
provides:
  - runner-tokens module (src/lib/runner-tokens.ts) — issueRunnerToken, verifyRunnerToken, revokeTokensForTask, hashRunnerToken, RUNNER_TOKEN_ALLOWLIST
  - runner-token branch in getUserFromRequest (auth.ts) — happy-path principal with runner_token_task_id attribution; cross-task case falls through (null)
  - requireRunnerToken(request, taskId) wrapper in auth.ts — discriminated {user} | {error, status: 401|403}; single source of truth for 401-vs-403 decision on runner-token routes
  - User.runner_token_task_id optional field for downstream defense-in-depth
  - atomic runner-token revocation in PUT /api/tasks/[id] — wraps UPDATE + revokeTokensForTask in one db.transaction; terminal-status set guarded
  - synthetic runner-token User shape — id=-2000, username='runner-token', role='operator'
affects: [14 runner-daemon, 15 checkpoint-api]

tech-stack:
  added: []
  patterns:
    - "Opaque base64url bearer (≥32 bytes entropy) with sha256 hex stored in DB — plaintext NEVER persisted (mirrors auth-token-hash pattern from session-cookie)"
    - "Expiry formula runnerStartedAt + timeoutSeconds + 60 locked in issueRunnerToken signature — Phase 14 passes recipe.timeout_seconds"
    - "Strict <= expiry rejection so a token cannot be used AT its exact expiry moment"
    - "Atomic revocation via db.transaction(() => { UPDATE; revokeTokensForTask })() — a crash between the two rolls BOTH back"
    - "RAUTH-06 allowlist encoded as ReadonlyArray<{method, pathPattern: RegExp}> — regex captures the :id group for cross-task comparison"
    - "Discriminated auth result {user} | {error, status} mirroring requireRole — route handlers use `if ('error' in auth) return NextResponse.json(...)` pattern uniformly"
    - "Dual-layer cross-task enforcement: getUserFromRequest returns null on mismatch (cannot distinguish 401 from 403); requireRunnerToken wrapper re-verifies and returns 403 explicitly"
    - "Defensive terminal-status set {done, failed, cancelled} — cancelled self-activates when status enum widens (no code change needed)"

key-files:
  created:
    - src/lib/runner-tokens.ts
    - src/lib/__tests__/runner-tokens.test.ts
    - src/lib/__tests__/auth-runner-token-principal.test.ts
    - src/lib/__tests__/runner-token-revocation.test.ts
  modified:
    - src/lib/auth.ts
    - src/app/api/tasks/[id]/route.ts
    - src/app/api/tasks/__tests__/status-gate-block.test.ts

key-decisions:
  - "Cross-task 403 enforced in requireRunnerToken wrapper, NOT in getUserFromRequest. getUserFromRequest returns null for the cross-task case because it cannot distinguish 401 from 403 cleanly. This concentrates the 401-vs-403 decision in one place — Phase 14/15 route handlers MUST use requireRunnerToken, never getUserFromRequest directly for runner-token routes."
  - "id = -2000 sentinel for runner-token principal — distinct from -1000 (runner-secret principal) and -agent_id (agent-scoped API keys). Phase 14/15 can dispatch on user.id === -2000 without string-comparing username."
  - "runner_token_task_id populated in BOTH code paths (getUserFromRequest happy path + requireRunnerToken happy path) — downstream handlers can cross-check user.runner_token_task_id === params.id as defense-in-depth even though requireRunnerToken already enforced it."
  - "Terminal-status set is defensively {done, failed, cancelled} even though cancelled is not in the current enum — self-activates when a future migration widens the enum."
  - "Transaction guards against terminal→terminal re-revocation via isTerminalTransition. revokeTokensForTask is idempotent (returns 0), so double-revocation is harmless, but skipping the SQL noise is cleaner."
  - "RUNNER_TOKEN_ALLOWLIST kept in runner-tokens.ts (not auth.ts) so the data (the six RAUTH-06 endpoints) lives next to the module that gates on it. Auth.ts imports it."
  - "Strict <= expiry check in verifyRunnerToken so a token cannot be used AT its exact expiry moment. Prevents clock-skew edge cases where a token hit the server at expires_at."

patterns-established:
  - "Per-task bearer tokens in task_runner_tokens table — Phase 14 claim route will call issueRunnerToken(db, taskId, attempt, recipe.timeout_seconds) and return { token } as MC_API_TOKEN in the container env"
  - "Runner-token routes MUST use requireRunnerToken(request, taskId) — never getUserFromRequest — to get correct 401-vs-403 semantics"
  - "Atomic revocation on terminal-status transition is the SOLE revocation trigger. No background sweeper, no lazy-on-reuse, no scheduled cleanup. Phase 15's blocker-checkpoint path (which flips to awaiting_owner, NOT terminal) must NOT call revokeTokensForTask."

requirements-completed:
  - RAUTH-02
  - RAUTH-03
  - RAUTH-04
  - RAUTH-05
  - RAUTH-06

duration: 10min
completed: 2026-04-19
---

# Phase 11 Plan 04: Runner-Token Principal + Cross-Task 403 + Atomic Revocation Summary

**Ships the runner-token principal — per-task, per-attempt bearer tokens (base64url, SHA-256-hashed in DB) — together with the RAUTH-06 endpoint allowlist, the cross-task 403 substrate via a new `requireRunnerToken` wrapper, and atomic revocation on terminal task transitions. Five RAUTH requirements (02..06) land as one coherent mechanism. Phase 11 auth story is complete.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-19T02:07:11Z
- **Completed:** 2026-04-19T02:17:24Z
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 3

## Accomplishments

- **runner-tokens module** (`src/lib/runner-tokens.ts`, 102 lines) — four exports + one allowlist + one type. No HTTP, no routes, no JWT, no parseable prefix. Opaque random bearer.
- **Auth substrate extended** in `src/lib/auth.ts` with two surfaces:
  - New runner-token branch in `getUserFromRequest`, placed adjacent to the runner-secret branch (Plan 11-02). Happy-path returns principal with `runner_token_task_id`; cross-task case falls through to null.
  - New `requireRunnerToken(request, taskId)` exported helper, placed adjacent to `requireRole`. Discriminated return distinguishes 401 from 403 at the substrate layer.
- **`User.runner_token_task_id`** optional field added — downstream handlers can cross-check as defense-in-depth.
- **Atomic revocation** wired into `PUT /api/tasks/[id]` — when a task transitions INTO `done` / `failed` / `cancelled`, all live runner-tokens are revoked in the SAME `db.transaction` as the status UPDATE. A crash between them rolls BOTH back.
- **62 new Vitest cases** across three files covering the full contract: lifecycle (mint/verify/revoke/hash opacity/expiry boundary), auth branch (allowlist + cross-task + expiry + revocation + method mismatch), wrapper (401 vs 403 discrimination + discriminated return), revocation integration (terminal vs non-terminal, task-scope isolation, transaction rollback).
- **Zero regressions.** Full suite: 1730 passed, 0 failed (up from 1668 pre-Plan 11-04).

## Task Commits

1. **Task 1: Create runner-tokens module (mint / verify / revoke / hash)** — `bdbd9f5` (feat)
2. **Task 2: Extend auth.ts with runner-token principal branch + requireRunnerToken wrapper** — `01ba0e6` (feat)
3. **Task 3: Atomic revocation in task PUT handler + revocation tests** — `c3b10c3` (feat)

## Files Created/Modified

### Created

- **`src/lib/runner-tokens.ts`** — 102 lines. Exports `hashRunnerToken`, `issueRunnerToken`, `verifyRunnerToken`, `revokeTokensForTask`, `RUNNER_TOKEN_ALLOWLIST`, `VerifiedRunnerToken` type. No HTTP layer, no business logic beyond token lifecycle.
- **`src/lib/__tests__/runner-tokens.test.ts`** — 261 lines, 29 tests covering deterministic hash, 32-byte entropy, base64url encoding, plaintext never in DB, distinct tokens across calls, Date.now-based default, strict `<=` expiry rejection, idempotent revocation, task-scope isolation, and full allowlist regex coverage.
- **`src/lib/__tests__/auth-runner-token-principal.test.ts`** — 365 lines, 26 tests. Part A (getUserFromRequest branch): 6 happy paths across the six RAUTH-06 endpoints + cross-task null + allowlist negatives (claim/ready-tasks/wrong-method/wrong-path-prefix) + bogus/missing bearer + expired + revoked. Part B (requireRunnerToken wrapper): happy path with runner_token_task_id=5 + **two cross-task 403 assertions** (path mismatch + caller-param mismatch) + no-bearer 401 + invalid 401 + expired 401 + revoked 401 + non-allowlisted-path 401 + wrong-method 401 + discriminated-return invariants.
- **`src/lib/__tests__/runner-token-revocation.test.ts`** — 236 lines, 7 tests. Real in-memory DB + real PUT route invocation. Verifies: in_progress→done revokes all tokens, in_progress→failed revokes, non-terminal transitions don't revoke, terminal→terminal no-op, task-scope isolation, transaction rollback atomicity (forced throw inside transaction rolls back BOTH status and revocation), revocation idempotence.

### Modified

- **`src/lib/auth.ts`** — +98 lines. (1) New import line for `verifyRunnerToken`, `RUNNER_TOKEN_ALLOWLIST`, `VerifiedRunnerToken`. (2) New `runner_token_task_id?: number | null` optional field on `User`. (3) New branch in `getUserFromRequest` (lines 517–569) placed immediately after the runner-secret branch and before the session-cookie block — matches the plan's intent of `secret → token → session` precedence on `/api/runner/*`. (4) New `requireRunnerToken` exported function (lines 759–841) placed adjacent to `requireRole`.
- **`src/app/api/tasks/[id]/route.ts`** — +21 lines. One import (`revokeTokensForTask`), one module-level const (`TERMINAL_TASK_STATUSES`), and wrapped the existing `stmt.run(...updateParams)` in a `db.transaction(() => { ... })()` that conditionally calls `revokeTokensForTask(db, taskId)` when `isTerminalTransition` is true. No changes to gate logic, Aegis logic, mention resolution, ticket allocation, or event emission.
- **`src/app/api/tasks/__tests__/status-gate-block.test.ts`** — +4 lines. Added `transaction: (fn) => () => fn()` stub to the `getDatabase()` mock. Rule 3 deviation — the pre-existing mock lacked a `transaction` method that the new transaction wrapping in the PUT handler needs. Minimal fix: mock the immediate-runner shape that better-sqlite3 uses for successful transactions.

## RAUTH-06 Allowlist Reference (for Phase 14 route implementations)

Phase 14 must implement the six endpoints below EXACTLY at these paths/methods for `requireRunnerToken` to recognise them:

| Method | Path                                         | Purpose (Phase 14/15)                        |
| ------ | -------------------------------------------- | -------------------------------------------- |
| POST   | `/api/runner/tasks/:id/checkpoints`          | Phase 15 — checkpoint write                  |
| POST   | `/api/runner/tasks/:id/submit`               | Phase 15 — terminal submit (done)            |
| POST   | `/api/runner/tasks/:id/fail`                 | Phase 15 — terminal fail                     |
| GET    | `/api/runner/tasks/:id/status`               | Phase 14 — poll task state                   |
| GET    | `/api/runner/tasks/:id`                      | Phase 14 — fetch task detail                 |
| GET    | `/api/runner/tasks/:id/comments`             | Phase 14/15 — read human comments            |

Regex patterns (from `RUNNER_TOKEN_ALLOWLIST` in `src/lib/runner-tokens.ts`):

```
^/api/runner/tasks/(\d+)/checkpoints/?$
^/api/runner/tasks/(\d+)/submit/?$
^/api/runner/tasks/(\d+)/fail/?$
^/api/runner/tasks/(\d+)/status/?$
^/api/runner/tasks/(\d+)/?$
^/api/runner/tasks/(\d+)/comments/?$
```

Group 1 captures the task_id. `requireRunnerToken` extracts it and compares to the caller's `taskId` param.

## Runner-Token Principal Shape

Phase 14/15 handler code must treat this shape as the contract:

| Field | Value | Notes |
| ----- | ----- | ----- |
| `id` | `-2000` | Sentinel — distinct from `-1000` (runner-secret) and `-agent_id` (agent keys) |
| `username` | `'runner-token'` | Exact string |
| `display_name` | `'Runner Token'` | UI label |
| `role` | `'operator'` | Write access, NOT admin |
| `workspace_id` | `getDefaultWorkspaceContext().workspaceId` | Resolved at request time |
| `tenant_id` | `getDefaultWorkspaceContext().tenantId` | Resolved at request time |
| `provider` | `'local'` | |
| `email` / `avatar_url` | `null` | |
| `is_approved` | `1` | |
| `created_at` / `updated_at` | `0` | Synthetic — never persisted |
| `last_login_at` | `null` | |
| `agent_name` | `null` | Not agent-attributed |
| **`runner_token_task_id`** | **`verified.task_id` (from token row)** | **NEW** — handlers cross-check against `:id` |

## API Surface for Phase 14/15

### issueRunnerToken — call from Phase 14 claim route

```typescript
import { issueRunnerToken } from '@/lib/runner-tokens'

// When the runner claims a task, mint a token for the attempt:
const { token, expiresAt } = issueRunnerToken(
  db,
  taskId,
  attempt,            // current runner_attempts value after increment
  recipe.timeout_seconds,
)
// Pass `token` to the container as MC_API_TOKEN env var.
// `expiresAt` (unix seconds) = now + recipe.timeout_seconds + 60.
// Plaintext is returned ONLY this time — never recoverable.
```

### requireRunnerToken — MANDATORY for runner-token route handlers

Phase 14/15 route handlers MUST use this wrapper. **Do NOT call `getUserFromRequest` directly** — you will lose the 401-vs-403 distinction.

```typescript
import { requireRunnerToken } from '@/lib/auth'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const taskId = Number(id)
  const auth = requireRunnerToken(request, taskId)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
    // status is 401 OR 403 — the wrapper decides.
  }
  const { user } = auth
  // user.runner_token_task_id === taskId is guaranteed here.
  // Proceed with handler logic.
}
```

### revokeTokensForTask — reserved for terminal transitions

```typescript
import { revokeTokensForTask } from '@/lib/runner-tokens'

// Already wired in PUT /api/tasks/[id] — call from OTHER terminal-transition paths
// ONLY if they exist. Phase 15's blocker-checkpoint (awaiting_owner) must NOT call this.
db.transaction(() => {
  // ... terminal-status UPDATE ...
  revokeTokensForTask(db, taskId)
})()
```

## Location Map in auth.ts

For future auth extensions, the order inside `getUserFromRequest` is:

1. Proxy-auth (lines ~438–458) — Plan 11-02 left this unchanged
2. **Runner-secret branch** (lines 460–513) — Plan 11-02
3. **Runner-token branch** (lines 515–571) — **Plan 11-04, this plan**
4. Session cookie (lines 573–580) — unchanged
5. Global API key (lines 582–613) — unchanged
6. Agent-scoped API keys (lines 615–665) — unchanged
7. Plugin resolver hook (lines 667–671) — unchanged

`requireRunnerToken` lives at **lines 759–841**, immediately after `requireRole` at **lines 743–757**.

## Decisions Made

- **Cross-task 403 in the wrapper, NOT in getUserFromRequest.** The wrapper is the single source of truth for the 401-vs-403 decision. getUserFromRequest returns null on cross-task because it cannot return a non-user while also signalling "a valid token exists but for a different task" — that's a wrapper-level concern. This keeps getUserFromRequest honest ("null = no valid principal for this request") and avoids leaking status-code semantics into the principal resolver.
- **id = -2000.** Distinct from -1000 (runner-secret) and -agent_id. Phase 14 can `if (user.id === -2000)` dispatch on runner-token identity without string-compare.
- **User.runner_token_task_id.** Populated in BOTH code paths (branch AND wrapper). Phase 14/15 handlers can cross-check as defense-in-depth even though `requireRunnerToken` already enforced it. Optional field, backward-compatible.
- **Strict `<=` expiry rejection.** Prevents using a token AT its exact expiry moment. Guards against clock-skew edge cases. A token minted at t=1000 with timeout=300 expires at t=1360; verifyRunnerToken with `nowUnix=1360` returns null.
- **Same-transaction revocation.** CONTEXT.md locks this: no sweeper, no lazy-on-reuse, no cron. The transaction MUST contain both the UPDATE and the revokeTokensForTask call. A crash between them MUST roll back BOTH — verified via dedicated atomicity test.
- **Defensive TERMINAL_TASK_STATUSES = {done, failed, cancelled}.** The current status enum (`src/lib/validation.ts`) lacks `cancelled` — it was in CONTEXT.md's terminal list. Including `cancelled` in the set is dead code today but self-activates the moment a migration widens the enum. Costs nothing; removes a future gotcha.
- **isTerminalTransition guard skips terminal→terminal rewrites.** revokeTokensForTask is idempotent (returns 0 on already-revoked), but avoiding the SQL call when `currentTask.status` is already in the terminal set is cleaner and dodges log noise.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `transaction` stub to `status-gate-block.test.ts` mock**

- **Found during:** Task 3 full-suite regression run (5 failures in `status-gate-block.test.ts` after Task 3 commit)
- **Issue:** The pre-existing mock for `getDatabase()` in `status-gate-block.test.ts` returned a partial object with only `{ prepare }`. My new `db.transaction(() => { ... })()` call in the PUT route therefore blew up with `db.transaction is not a function` → 500 status → 5 tests that expected 200 failed.
- **Fix:** Added `transaction: (fn: () => unknown) => () => fn()` to the mock's return. This mirrors better-sqlite3's transaction API for the successful-completion path: `db.transaction(fn)` returns a function that, when called, invokes `fn` synchronously and returns its result. The mock doesn't simulate rollback, but the gate-block tests don't exercise rollback — they exercise status outcomes.
- **Files modified:** `src/app/api/tasks/__tests__/status-gate-block.test.ts` — +4 lines.
- **Verification:** `pnpm test src/app/api/tasks/__tests__/status-gate-block.test.ts --run` → 9/9 pass. Full suite re-run: 1730 passed, 0 failed.
- **Committed in:** c3b10c3 (Task 3)

**2. [Rule 1 - Bug] Fixed TS narrowing in wrapper test by switching `'user' in result` to `!('error' in result)`**

- **Found during:** Task 2 typecheck after writing the wrapper tests
- **Issue:** The discriminated return type uses `{user: User, error?: never, status?: never} | {user?: never, error: string, status: 401 | 403}` — mirroring `requireRole`'s shape. TypeScript's narrowing on `if ('user' in result)` doesn't correctly eliminate the `user?: never` variant (because the property IS declared, just optional-never). Three `result.user.xxx` accesses in the happy-path test therefore raised TS18048 ('possibly undefined').
- **Fix:** Switched the narrowing predicate to `if (!('error' in result))` — negating the failure discriminant forces TS to narrow to the success variant. The route-handler idiom in the codebase uses `if ('error' in auth) return ...` for the SAME reason (early-return on failure side). Test now mirrors that pattern.
- **Files modified:** `src/lib/__tests__/auth-runner-token-principal.test.ts` (3 locations)
- **Verification:** `pnpm typecheck` clean; all 26 tests still pass.
- **Committed in:** 01ba0e6 (Task 2)

---

**Total deviations:** 2 auto-fixed (Rule 3 blocking test-mock + Rule 1 TS narrowing). Neither changed the scope or behaviour of the plan — the first is a test-fixture catch-up caused by my adding a transaction, and the second is a narrowing pattern choice.

## Authentication Gates Encountered

None. All three tasks executed without needing user-provided credentials.

## Issues Encountered

- **Pre-existing lint warnings (76, all `react-hooks/exhaustive-deps`)** unchanged by this plan. Deferred per scope rules.
- **Pre-existing typecheck noise in `src/lib/validation.ts:58`** did NOT surface during this plan — clean typecheck on each task. Not touched.

## Verification Results

- `pnpm test src/lib/__tests__/runner-tokens.test.ts --run` → **29/29 pass**
- `pnpm test src/lib/__tests__/auth-runner-token-principal.test.ts --run` → **26/26 pass**
- `pnpm test src/lib/__tests__/runner-token-revocation.test.ts --run` → **7/7 pass**
- Regression check — existing runner tests: `pnpm test src/lib/__tests__/auth.test.ts src/lib/__tests__/auth-runner-principal.test.ts --run` → **24/24 pass**
- Full `pnpm vitest run` → **1730 passed, 0 failed, 44 todo, 4 skipped test files**
- `pnpm typecheck` → **clean (0 errors)**
- `pnpm lint` → **0 errors, 76 pre-existing warnings**
- `grep -n 'runner-token\|verifyRunnerToken\|RUNNER_TOKEN_ALLOWLIST\|requireRunnerToken\|runner_token_task_id\|status: 403' src/lib/auth.ts` → expected hits across imports, User field, branch body, and wrapper body; one `status: 403` line in the cross-task branch
- `grep -n 'revokeTokensForTask\|TERMINAL_TASK_STATUSES\|db.transaction' src/app/api/tasks/[id]/route.ts` → import, const, transaction wrapper, revocation call all present

## Self-Check: PASSED

Verified files and commits exist:

- FOUND: src/lib/runner-tokens.ts
- FOUND: src/lib/__tests__/runner-tokens.test.ts
- FOUND: src/lib/__tests__/auth-runner-token-principal.test.ts
- FOUND: src/lib/__tests__/runner-token-revocation.test.ts
- FOUND: src/lib/auth.ts (modified)
- FOUND: src/app/api/tasks/[id]/route.ts (modified)
- FOUND: src/app/api/tasks/__tests__/status-gate-block.test.ts (modified)
- FOUND: commit bdbd9f5 (Task 1)
- FOUND: commit 01ba0e6 (Task 2)
- FOUND: commit c3b10c3 (Task 3)
- 62/62 new tests pass across 3 files
- Full suite: 1730 passed, 0 failed

## Next Phase Readiness

- **Phase 14 (runner daemon).** Claim-route code should:
  1. Increment `runner_attempts` on tasks (already NOT NULL DEFAULT 0 from Plan 11-03)
  2. Call `issueRunnerToken(db, taskId, attempt, recipe.timeout_seconds)` to mint a bearer
  3. Pass the plaintext to the container as `MC_API_TOKEN`
  4. Expect the token to self-expire at `runner_started_at + timeout + 60` and self-revoke on terminal transitions
- **Phase 14/15 route handlers on `/api/runner/tasks/:id/*`.** MUST use `requireRunnerToken(request, taskId)` — the wrapper is the single source of truth for 401 vs 403. Do NOT call `getUserFromRequest` directly.
- **Phase 15 (checkpoint API).** Blocker-checkpoint writes that transition a task to `awaiting_owner` (NOT terminal) must NOT call `revokeTokensForTask`. Only terminal transitions revoke.
- **Manual smoke (Phase 14 validation day):** `curl -H "Authorization: Bearer <minted-token>" http://localhost:3000/api/runner/tasks/99/checkpoints` where the token was minted for task 5 → **403** (cross-task block from the wrapper). Same bearer on `/api/runner/tasks/5/checkpoints` with a Phase 14/15 handler → 200.

**Wave 1 substrate is now COMPLETE.** RAUTH-01..06 all landed across Plans 11-02 (RAUTH-01) and 11-04 (RAUTH-02..06). Phase 11 auth story ships.

---
*Phase: 11-runtime-foundation-v1-2*
*Completed: 2026-04-19*
