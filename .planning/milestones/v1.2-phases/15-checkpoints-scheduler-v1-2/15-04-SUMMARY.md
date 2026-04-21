---
phase: 15-checkpoints-scheduler-v1-2
plan: 04
subsystem: checkpoints-api
tags: [api, runner-token, zod, sqlite, jsonl, atomic-write, sse, typescript]

# Dependency graph
requires:
  - phase: 11-runtime-foundation-v1-2
    provides: task_checkpoints table (migration 056), runner-token principal (id=-2000), workspace_id on tasks
  - phase: 14-runner-container-v1-2
    provides: tasks.worktree_path + .mc/ directory layout, runner-token mint/verify/revoke
  - plan: 15-01
    provides: task.checkpoint_added EventType + RUNNER_TOKEN_ALLOWLIST entry #7 + auth.ts runner-token prefix extension for POST /api/tasks/:id/checkpoints
provides:
  - POST /api/tasks/:id/checkpoints (runner-token scoped) — atomic DB+JSONL persistence + task.checkpoint_added broadcast after commit
  - GET /api/tasks/:id/checkpoints (viewer scoped) — ordered + ?attempt=N filter
  - src/lib/task-checkpoints.ts helper with CheckpointBodySchema, ArtifactSchema, writeCheckpoint, readCheckpoints
  - Extension-ready writeCheckpoint transaction for Plan 15-05's blocker-state-machine wrap
affects: [15-05, 15-07, 16-progress-tab]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic DB+JSONL write inside a synchronous better-sqlite3 transaction callback; caller compensates JSONL via fs.truncateSync on throw"
    - "Zod discriminated-union Artifact schema with per-kind refine() guards — diff requires path OR ref; test_result requires path OR url OR summary"
    - "Event broadcast AFTER transaction commits (never inside) so SSE subscribers only see committed state"
    - "Defense-in-depth cross-task 403 at the route handler, redundant with auth.ts layer"
    - "Workspace-scoped GET masquerades cross-workspace as 404 (don't leak task existence)"

key-files:
  created:
    - src/lib/task-checkpoints.ts
    - src/lib/__tests__/task-checkpoints.test.ts
    - src/app/api/tasks/[id]/checkpoints/route.ts
    - src/app/api/tasks/[id]/checkpoints/__tests__/route.test.ts
  modified: []

key-decisions:
  - "writeCheckpoint returns `{ id, attempt, ts, nowUnix }` (4 fields) instead of 3 from the plan prose — nowUnix added so Plan 15-05 can stamp the tasks UPDATE (status='awaiting_owner', updated_at=nowUnix) and comment INSERT with the exact same unix-seconds value that created_at uses on the checkpoint row. Keeps the status-flip timestamp aligned with the checkpoint timestamp."
  - "Broadcast payload includes blocker_reason ONLY when status=='blocked' (plan says 'extends this payload in 15-05'; landed it in 15-04 already because the schema already has blocker_reason validated as non-empty on blocked status — so 15-05's daemon-side docker-stop handler receives the reason from its very first frame, no schema bump needed). Other statuses still omit blocker_reason for payload economy."
  - "Plan 15-05 extension path: option (a) — add an optional `extraOps(db, insertedId, nowUnix): void` callback to writeCheckpoint. Rationale: the caller already wraps writeCheckpoint in try/catch for the JSONL compensation, so adding extraOps keeps the atomic-write contract in one module rather than duplicating the DB transaction inline in route.ts. Option (b) (unrolling the transaction into route.ts) was rejected because it would force 15-05 to re-implement the JSONL append/truncate logic."
  - "GET workspace-scoping returns 404 for cross-workspace (masquerade), not 403 — matches the comments route convention (src/app/api/tasks/[id]/comments/route.ts) and avoids leaking task existence across workspaces. viewer_workspace_id !== task.workspace_id → 404."
  - "Invalid ?attempt= rejected when String(n) !== attemptParam.trim() — catches '1e5' scientific-notation, '1.5' float, and '01' leading-zero cases that parseInt would silently accept. Aligned with the 'attempts are opaque counter values, not human input' invariant."

patterns-established:
  - "Atomic DB+filesystem write via db.transaction(() => { ...; fs.appendFileSync; ... })(). Synchronous callback is required — async breaks better-sqlite3's rollback semantics (Pitfall 2 in 15-RESEARCH.md)."
  - "Rollback compensation for filesystem side: caller snapshots fs.statSync(path).size BEFORE the call, truncates back on throw. Accepts ghost-line risk under concurrent failure (Pitfall 8 in 15-RESEARCH.md) — the in-container pre-post JSONL remains the local audit source-of-truth."
  - "eventBus.broadcast(type, payload) ALWAYS fires AFTER db.transaction(() => ...)() returns successfully. Never inside the transaction body (subscribers would see uncommitted state on rollback)."
  - "Runner-token route pattern: requireRole → check auth.user.id === -2000 → parseInt path id → check auth.user.runner_token_task_id === taskId → rate limiter → Zod safeParse → handler body. The cross-task id check is defense-in-depth (auth.ts already refuses to issue the principal on mismatch, but any breakage upstream must fall back to a hard 403)."

requirements-completed:
  - CP-01
  - CP-02
  - CP-05
  - CP-06
  - SCHED-06

# Metrics
duration: 7min
completed: 2026-04-20
---

# Phase 15 Plan 04: Checkpoints API Summary

**POST + GET /api/tasks/:id/checkpoints delivered with atomic DB+JSONL persistence, workspace-scoped read access, strict Zod validation (discriminated artifact union, status=blocked refine), runner-token auth + defense-in-depth cross-task 403, and task.checkpoint_added broadcast firing after transaction commit — CP-01 / CP-02 / CP-05 / CP-06 / SCHED-06 all satisfied; blocker state machine (CP-03) stays for Plan 15-05.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-20T22:45:00Z (approx)
- **Completed:** 2026-04-20T22:52:00Z
- **Tasks:** 2
- **Files created:** 4 (2 source + 2 test)
- **Files modified:** 0
- **Total lines:** 1683 (286 + 558 + 266 + 573)
- **Tests added:** 56 (31 helper + 25 route)

## Accomplishments

- Pure-logic helper module `src/lib/task-checkpoints.ts` with Zod schemas, atomic `writeCheckpoint`, and filterable `readCheckpoints`. Pure-logic = DB + fs only; no HTTP, no auth, no broadcast. Testable in isolation with an in-memory DB + mkdtempSync.
- Route module `src/app/api/tasks/[id]/checkpoints/route.ts` exporting POST (runner-token) and GET (viewer) as a single file — Next.js App Router convention. Thin wrapper around the helper: requireRole → id checks → rate limit → Zod safeParse → writeCheckpoint → broadcast.
- Atomic rollback under injection: `fs.appendFileSync` thrown → 500 response, DB row count unchanged, JSONL file truncated to pre-call size (or never created). Broadcast never fires on rollback.
- Discriminated-union artifact validation: `file/url/diff/test_result/comment/other` kinds each enforce their required fields via per-kind refine; unknown kind hits the Zod discriminator error at 400.
- 56 unit tests passing. `pnpm typecheck` exits 0. Full `pnpm test --run` suite: 2208 passing / 1 pre-existing failure (Plan 15-01 legacy `runner-tokens.test.ts:194` assertion, documented in deferred-items.md).

## Task Commits

1. **Task 1: task-checkpoints helper (schemas + writeCheckpoint + readCheckpoints)** — `adb9287` (feat)
2. **Task 2: POST + GET /api/tasks/[id]/checkpoints route module + tests** — `9ff0e59` (feat)

## Files Created

### `src/lib/task-checkpoints.ts` (286 lines)

Exports:

```ts
export const ArtifactSchema            // Zod discriminated union (kind: file|url|diff|test_result|comment|other)
export const CheckpointBodySchema      // Zod object + refine(status='blocked' → blocker_reason required)
export type  Artifact                  // z.infer<typeof ArtifactSchema>
export type  CheckpointBody            // z.infer<typeof CheckpointBodySchema>
export interface CheckpointInsertResult { id, attempt, ts (ISO-8601), nowUnix }
export interface CheckpointRow { id, task_id, attempt, step, summary, status, artifacts, next_step, blocker_reason, tokens_used, duration_ms, created_at }
export function writeCheckpoint(db, taskId, attempt, worktreePath | null, body): CheckpointInsertResult
export function readCheckpoints(db, taskId, filter?: { attempt?: number }): CheckpointRow[]
```

### `src/lib/__tests__/task-checkpoints.test.ts` (558 lines, 31 tests)

Covers Zod schema validation (11 cases), writeCheckpoint atomic contract (7 cases including DB failure + JSONL failure rollback), and readCheckpoints ordering/filter (5 cases).

### `src/app/api/tasks/[id]/checkpoints/route.ts` (266 lines)

Exports `POST` (runner-token) + `GET` (viewer) as separate async functions sharing the file.

### `src/app/api/tasks/[id]/checkpoints/__tests__/route.test.ts` (573 lines, 25 tests)

14 POST tests + 8 GET tests + 3 shared setup (token+worktree seeding, mocks for event-bus/rate-limit/db).

## Atomic-Write Contract

**Transaction boundary:**

```ts
db.transaction(() => {
  INSERT INTO task_checkpoints (...)
  fs.appendFileSync('<worktree>/.mc/checkpoints.jsonl', line, { mode: 0o600 })
  return { id, attempt, ts, nowUnix }
})()
```

**Compensation (in route.ts POST handler):**

```ts
const jsonlSizeBefore = fs.existsSync(jsonlPath) ? fs.statSync(jsonlPath).size : 0
try {
  inserted = writeCheckpoint(...)
} catch (err) {
  if (jsonlPath && fs.existsSync(jsonlPath)) {
    const nowSize = fs.statSync(jsonlPath).size
    if (nowSize > jsonlSizeBefore) {
      fs.truncateSync(jsonlPath, jsonlSizeBefore)
    }
  }
  return 500
}
// Broadcast AFTER — never inside db.transaction
eventBus.broadcast('task.checkpoint_added', { ... })
```

**Invariants held:**

- DB INSERT rolls back automatically on any throw inside the transaction callback (better-sqlite3 semantics).
- Synchronous fs API (`appendFileSync`, `statSync`, `truncateSync`) — **NEVER** fs.promises.* (Pitfall 2: async callback inside db.transaction silently commits).
- Broadcast fires only after `writeCheckpoint` returns normally; subscribers cannot observe uncommitted state.
- Concurrent-writer ghost-line risk (Pitfall 8) is accepted: v1.2 does not serialize POSTs; the in-container pre-post JSONL (Phase 14 hello-world recipe at `/workspace/.mc/checkpoints.jsonl`) remains the local audit source-of-truth if divergence matters. Sequential POSTs are correct.

## Route Auth Path

Request flow for POST `/api/tasks/:id/checkpoints` with a runner-token bearer:

1. Next.js App Router hits `POST` export in `src/app/api/tasks/[id]/checkpoints/route.ts`.
2. `requireRole(request, 'operator')` → calls `getUserFromRequest`.
3. `getUserFromRequest` (auth.ts line 526+, extended in Plan 15-01):
   - Prefix filter: `isRunnerPath || isCheckpointsTaskPath` matches `/api/tasks/\d+/checkpoints`.
   - Allowlist match: entry #7 `{ method: 'POST', pathPattern: /^\/api\/tasks\/(\d+)\/checkpoints\/?$/ }` (added in Plan 15-01, runner-tokens.ts line 26).
   - `verifyRunnerToken(db, bearer)` returns `{ task_id, attempt, expires_at }` or null.
   - Token `task_id` === path `:id` → issue principal `{ id: -2000, username: 'runner-token', runner_token_task_id: task_id, workspace_id, tenant_id, ... }`.
   - Mismatch / unknown / revoked / expired → null principal; the session/api-key branches fall through and yield a 401.
4. POST handler:
   - `auth.user.id !== -2000` → 403 ("runner-token principal required"). Rejects runner-secret (-1000), admin API keys (0), session cookies.
   - `auth.user.runner_token_task_id !== taskId` → 403 ("cross-task access forbidden"). Defense-in-depth — auth.ts already refused to issue a principal with mismatched task_id, but any breakage upstream must NOT silently permit cross-task writes.
   - Rate limit → Zod `safeParse` → `writeCheckpoint` → broadcast → 201 response.

Request flow for GET `/api/tasks/:id/checkpoints?attempt=N`:

1. `requireRole(request, 'viewer')` → session cookie OR admin API key OR viewer-scoped agent key.
2. Parse `:id` (reject ≤ 0) and `?attempt=N` (reject non-integer / negative / float / leading-zero).
3. SELECT `tasks` row; 404 if missing OR workspace mismatch (masquerade — don't leak existence).
4. `readCheckpoints(db, taskId, { attempt })` returns ordered array.
5. 200 `{ checkpoints: [...] }`.

## GET Ordering and Filter

**Query:**

```sql
SELECT ... FROM task_checkpoints
WHERE task_id = ?
  [ AND attempt = ? ]   -- optional filter
ORDER BY attempt ASC, id ASC
```

Uses `idx_task_checkpoints_task_attempt_created` (migration 056) as the scan. `ORDER BY attempt, id` is a cheap in-memory sort of the index slice; two checkpoints with identical `created_at` (sub-second) are deterministically insertion-ordered via `id` (AUTOINCREMENT).

## Plan 15-05 Extension Hook

The POST transaction is **extension-ready** for the blocker-state-machine (CP-03):

| Path | Trade-off | Decision |
|------|-----------|----------|
| (a) Add optional `extraOps(db, insertedId, nowUnix): void` callback to `writeCheckpoint` | Keeps the atomic-write contract in one module; Plan 15-05 passes a closure that does `UPDATE tasks SET status='awaiting_owner', updated_at=nowUnix` + `INSERT INTO comments` + token revoke + daemon-side docker-stop SSE payload hint | **RECOMMENDED** — the caller already wraps writeCheckpoint in try/catch for JSONL compensation. |
| (b) Unroll writeCheckpoint into route.ts and inline the blocker branch | Flat control flow in route.ts; duplicates JSONL append/truncate logic; Plan 15-05 owns both the checkpoint write AND the state machine | REJECTED — violates DRY across two plans; diverges the atomic-write contract. |

Plan 15-05 planner: prefer (a). The new `extraOps` callback executes inside the same `db.transaction` AFTER the INSERT + appendFileSync, so it sees the inserted `id` and contributes to the atomic rollback set.

## Broadcast Payload Shape

```ts
eventBus.broadcast('task.checkpoint_added', {
  checkpoint_id: number,    // server-generated
  task_id: number,          // path :id
  attempt: number,          // task.runner_attempts at POST time
  status: 'completed' | 'in_progress' | 'blocked',
  step: string,             // echo of body.step
  workspace_id: number,     // from tasks row; SSE filter uses this
  blocker_reason?: string,  // present ONLY when status === 'blocked'
})
```

- `workspace_id` present ⇒ SSE route drops cross-workspace listeners (Pitfall 5 in 15-RESEARCH.md is about ABSENT workspace_id; we always set it for task events).
- `blocker_reason` present on blocked checkpoints so Plan 15-05's daemon SSE handler can self-initiate `docker stop --time=15` without re-fetching from DB.

## Decisions Made

- **writeCheckpoint signature:** `(db, taskId, attempt, worktreePath | null, body)` — accepts worktreePath as an argument rather than looking it up from `tasks` inside the helper. Keeps the helper pure (no secondary DB reads), lets the route handler do the SELECT once for status + workspace + worktree_path + runner_attempts.
- **worktreePath=null path:** When the task has no worktree (e.g. a task that was inboxed then moved to in_progress without recipe claim), the DB INSERT still runs but the filesystem append is skipped. Tests assert `fs.mkdirSync` and `fs.appendFileSync` are never called. Runner-dispatched tasks will always have a worktree by Phase 14's claim route; this branch guards against out-of-band state where an operator manually flipped status.
- **Broadcast payload `workspace_id` source:** read from `tasks.workspace_id` at POST time, not from `auth.user.workspace_id` (which is the runner-token principal's default workspace — not necessarily the task's workspace). Prevents cross-workspace-leak if a runner-token were ever issued for a task in a workspace different from the principal's default.
- **Rate limiter:** `mutationLimiter` (60 req/min per IP, shared with comments/tasks mutations). A burst of checkpoint POSTs from a single recipe stays under the limit in practice (recipes checkpoint at step boundaries, not per-token). Phase 16 may add a runner-specific limiter if multi-runner deployments prove noisy.
- **`?attempt=0` is valid:** attempts start at 0 for pre-first-claim states in the scheduler's inventory-reconcile path; the GET filter accepts 0 explicitly (`n >= 0`), not `n > 0`.
- **25 route tests (min: 22):** added three extra-credit tests for (a) broadcast-fires-after-commit (observes DB row count from inside the broadcast callback), (b) worktreePath=null filesystem-quiet assertion via `vi.spyOn`, (c) rate-limiter short-circuit. No test for 401 on cross-task token was specifically plan-required, but kept as a positive coverage of the auth.ts integration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test typecheck error (TS2345) on NextRequest init literal**
- **Found during:** Task 2 (post-test-run typecheck)
- **Issue:** `new NextRequest(url, { method, headers, body })` with an intermediate `RequestInit & {...}` type literal failed typecheck — DOM's `RequestInit.signal` is `AbortSignal | null | undefined` while Next's `NextRequest` RequestInit constrains it to `AbortSignal | undefined`.
- **Fix:** Inlined the NextRequest init literal directly as the second argument (no typed variable); TS infers the narrower Next type from the call site. Tests pass and typecheck is clean.
- **Files modified:** `src/app/api/tasks/[id]/checkpoints/__tests__/route.test.ts`
- **Commit:** `9ff0e59` (baked into the Task 2 commit)

### Deferred (out of scope)

**Pre-existing test failure from Plan 15-01 — `src/lib/__tests__/runner-tokens.test.ts:194`**
Asserts `RUNNER_TOKEN_ALLOWLIST.length === 6`, but Plan 15-01 intentionally added a 7th entry. Re-confirmed failing on a clean checkout BEFORE starting 15-04 (`git stash; pnpm test runner-tokens` → 1 failed). Logged to `deferred-items.md`. Per scope boundary: we do NOT fix this — it's owned by Plan 15-01 cleanup or a phase-wide test refactor.

## Issues Encountered

- **Typecheck RequestInit error (Rule 1 auto-fix):** See above.
- **Pre-existing runner-tokens.test.ts failure (out of scope):** See above.
- **FK constraint on `task not found → 404` test:** Initial draft used `issueRunnerToken(testDb, 9999, ...)` but the token row has a FK to `tasks(id)` (migration 055). Fixed by temporarily disabling `foreign_keys` PRAGMA, seeding task 9999, issuing the token, deleting task 9999, re-enabling FK; the token row then survives the task deletion for auth.ts to resolve the runner-token principal while the handler's SELECT returns `undefined` → 404 branch.

## Next Plan Readiness

- **Plan 15-05 (blocker state machine)** can now extend the POST transaction. Recommended approach: add optional `extraOps(db, insertedId, nowUnix)` callback to `writeCheckpoint`. 15-05's blocker branch closure should:
  1. `UPDATE tasks SET status='awaiting_owner', updated_at=? WHERE id=? AND status='in_progress'` (idempotency guarded by status check).
  2. `INSERT INTO comments` with `author='system'`, content = blocker_reason + attempt reference.
  3. `revokeTokensForTask(db, taskId, nowUnix)` (Phase 11-04 helper already imported elsewhere).
  4. The broadcast payload's `blocker_reason` is already present for 15-05's daemon SSE handler to pick up and initiate `docker stop --time=15`.
- **Plan 15-07 (integration tests)** can exercise the full agent-post-checkpoint → MC-persist → SSE-broadcast → daemon-sees-frame loop using the hello-world recipe + a real runner-token.
- **Phase 16 Progress tab** can GET `/api/tasks/:id/checkpoints?attempt=N` and receive the timeline ordered for rendering.

## Self-Check: PASSED

Verified 2026-04-20T22:52:00Z:

- FOUND: src/lib/task-checkpoints.ts
- FOUND: src/lib/__tests__/task-checkpoints.test.ts
- FOUND: src/app/api/tasks/[id]/checkpoints/route.ts
- FOUND: src/app/api/tasks/[id]/checkpoints/__tests__/route.test.ts
- FOUND: .planning/phases/15-checkpoints-scheduler-v1-2/15-04-SUMMARY.md
- FOUND: commit adb9287 (Task 1: task-checkpoints helper)
- FOUND: commit 9ff0e59 (Task 2: POST + GET route)

Test run: 56/56 new tests pass (31 helper + 25 route). `pnpm typecheck` exits 0. Full `pnpm test --run` shows 1 pre-existing failure (Plan 15-01 legacy assertion) + 2208 passing — zero regressions introduced by this plan.

---
*Phase: 15-checkpoints-scheduler-v1-2*
*Completed: 2026-04-20*
