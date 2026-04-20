# Phase 15: Checkpoints & Scheduler Integration — Research

**Researched:** 2026-04-20
**Domain:** HTTP endpoint + scheduler + SSE event-bus integration atop the existing Phase 11–14 substrate
**Confidence:** HIGH (every finding cites a repo path or function name; no external library speculation)

## Summary

Phase 15 is "wire-up work" — the substrate (DB tables, auth principals, runner daemon, worktree lifecycle) all exist. What's missing is the **agent-facing checkpoint HTTP surface**, the **blocker-flow state machine** (status flip + auto-comment + graceful-stop instruction), the **scheduler ticks** that treat recipe-tagged tasks differently, and the **SSE broadcast points** that the Phase 16 UI will consume.

The research below answers "how" for every locked decision in `15-CONTEXT.md`. Four sharp edges dominate the plan:

1. **Auth boundary for the checkpoints endpoint.** `RUNNER_TOKEN_ALLOWLIST` in `src/lib/runner-tokens.ts:10-17` and the path-scope gate in `src/lib/auth.ts:472, 526` both hard-require `/api/runner/*`. `POST /api/tasks/:id/checkpoints` would silently fall through to the 401 reject branch. **Recommendation: host the checkpoints endpoint under `/api/runner/tasks/:task_id/checkpoints` (which is ALREADY in the allowlist — line 11) and treat this as a discretionary route-path choice permitted by CONTEXT.md § Claude's Discretion.** See Focus Area 8 for full analysis.
2. **No existing MC→runner control channel.** The daemon (`scripts/mc-runner.mjs:623-676`) only consumes `task.runner_requested` from SSE. There is no "stop this container" channel today. **Recommendation: handle graceful stop by emitting `task.container_exited { reason: 'blocked' }` via SSE and having the daemon listen for it** (a new SSE handler in the daemon alongside `handleRunnerRequested`); the daemon already owns the container handle in its `activeTasks` Map (line 444). Alternative: expose a new `GET /api/runner/stop-requests` polling endpoint. See Focus Area 11.
3. **`EventType` union must be extended.** `src/lib/event-bus.ts:15-55` is a closed union. The six new event types Phase 15 needs (`task.runner_requested`, `task.container_started`, `task.container_exited`, `task.checkpoint_added`, `recipe.indexed`, `recipe.removed`) must be appended. The SSE route (`src/app/api/events/route.ts`) passes events through opaquely — no filter changes needed there.
4. **Atomic DB + JSONL write is implementable.** `better-sqlite3` 12.6 transactions are synchronous; `fs.appendFileSync` inside a transaction blocks the transaction commit until the write lands. The rollback-JSONL-on-DB-fail half is straightforward because we know the exact number of bytes written (compute `line.length` before append, truncate on error). See Focus Area 2.

**Primary recommendation:** The planner should NOT host checkpoints at `/api/tasks/:id/checkpoints` as literally stated in CP-01 — doing so would require either modifying the path-scope gate in `auth.ts` (touching Phase 11's RAUTH-01/02 substrate) or rebuilding token dispatch in a new way. Host it at `/api/runner/tasks/:task_id/checkpoints` which is already RAUTH-06 allowlisted and matches the established pattern for `/submit`, `/fail`, `/runner-exit`, `/container-started`. The task-facing GET can mirror at `/api/tasks/:id/checkpoints` under viewer auth since it requires no runner-token. CONTEXT.md § Claude's Discretion explicitly permits this path choice.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Blocker & Resume Flow:**
- Auto-comment author = `system` (machine-generated; no human sender).
- Graceful stop = `docker stop --time=15` (SIGTERM → 15s → SIGKILL). Emit `task.container_exited` with `reason='blocked'`. Worktree + `.mc/` preserved.
- Resume trigger = re-emit `task.runner_requested` from the `assigned`-transition (SCHED-05 existing path). **NO new `/api/tasks/:id/resume` endpoint.** Phase 14's `seedMcDir` does the right thing.
- Resume context = `progress.md` marker line: `<iso-ts> | <<< RESUMED AFTER BLOCKER: <blocker_reason> >>>`. No new env vars.

**Checkpoint Persistence:**
- Atomic DB + JSONL — any failure returns 500. Open DB transaction, append JSONL inside transaction's try, commit only after both succeed; on error, rollback DB and truncate/unlink the JSONL line.
- Server writes the canonical `<host-worktree>/.mc/checkpoints.jsonl`. The in-container agent's pre-post audit write remains as-is.
- JSONL line = POST body fields + server-generated `id`, `attempt`, `task_id`, `ts` (ISO-8601).
- Artifact validation = strict per-kind Zod discriminated union: `file` → `path` required; `url` → `url` required (no http(s) restriction); `diff` → `ref` OR `path`; `test_result` → at least one of `path/url/summary`; `comment` → `summary` required; `other` → all optional. Unknown kind → 400.

**Heartbeat & Stale Detection:**
- Stale window = 90s fixed (3× 30s tick). Not configurable in v1.2.
- Stale-runner action on `in_progress` recipe-tasks: flip back to `assigned` (not `awaiting_owner`). `task.runner_requested` re-emitted.
- Container liveness = heartbeat freshness + runner-inventory query. **MC does NOT shell out to `docker inspect`.**
- Reconnect recovery = runner reports its tracked task IDs; MC re-emits `task.runner_requested` for any `assigned` recipe-task the runner is not holding. Daemon claim is idempotent.

**Event Emission & SSE:**
- `task.runner_requested` dedup = emit-on-every-transition, daemon dedupes. No server-side suppression window.
- SSE channel scope = single global stream at `/api/events`. Client-side filter. No per-task topics.
- No throttling for `task.checkpoint_added` in v1.2.
- Additive-only compat policy. No renames/removals.

### Claude's Discretion

- Exact route file paths (follows `src/app/api/tasks/[id]/...` and `src/app/api/runner/tasks/[task_id]/...` conventions).
- Migration naming + SQL detail beyond what Phase 11 already created.
- Runner-inventory endpoint contract — path, response shape, how the daemon populates it from existing in-memory state.
- Auto-comment template wording beyond "system-authored, includes `blocker_reason` verbatim, references `attempt` number."
- Test naming/Vitest organization; whether RTEST integration tests live here or wait for Phase 17.
- `GET /api/tasks/:id/checkpoints` pagination/filtering beyond the required `?attempt=N` filter (default ordering, optional `?since=<ts>`).
- Idempotency mechanism for retried POSTs (e.g., `client_token`) — not required; planner may add if cheap.

### Deferred Ideas (OUT OF SCOPE)

- Configurable stale window (`runtime.runner_heartbeat_stale_seconds`) — v1.3.
- Per-task SSE endpoint — v1.3+.
- `task.checkpoint_added` throttling/coalescing — v1.3+ if chatty recipe surfaces.
- HTTPS enforcement on `kind: 'url'` artifacts — defer.
- Path-safety validation (reject `..` in artifact `path`) — defer.
- POST idempotency token — defer unless cheap.

---

## Phase Requirements

| ID | Description (from REQUIREMENTS.md) | Research Support |
|----|------------------------------------|------------------|
| CP-01 | `POST /api/tasks/:id/checkpoints` with step/summary/status + optional artifacts/next_step/blocker_reason/tokens_used/duration_ms | Focus Areas 1, 8 (path choice), 2 (atomic writes) |
| CP-02 | Each checkpoint → `task_checkpoints` row AND one JSONL line at `<worktree>/.mc/checkpoints.jsonl` with identical field names | Focus Areas 2 (atomic write), 3 (worktree path access) |
| CP-03 | `status: blocked` → task `in_progress → awaiting_owner`, auto-comment with blocker_reason, graceful container stop | Focus Areas 7 (comments), 11 (stop channel) |
| CP-04 | Resume when task back to `assigned` reuses Phase 14 flow | Focus Area 12 (emit `task.runner_requested`, `seedMcDir` already handles) |
| CP-05 | Typed artifacts: `kind: file \| url \| diff \| test_result \| comment \| other` with optional path/url/ref/summary | Focus Area 1 (Zod discriminated union pattern) |
| CP-06 | `GET /api/tasks/:id/checkpoints` filterable by `?attempt=N` | Focus Area 1 |
| SCHED-01 | `autoRouteInboxTasks()` routes recipe-tagged `inbox → assigned` without affinity scoring | Focus Area 4, 5 |
| SCHED-02 | `dispatchAssignedTasks()` SKIPS recipe-tagged tasks | Focus Area 4 |
| SCHED-03 | `requeueStaleTasks()` uses heartbeat + container liveness for recipe-tagged | Focus Areas 4, 9, 10 |
| SCHED-04 | New `reconcileRunnerHeartbeat()` tick every 30s flips stale `in_progress` recipe-tasks back to `assigned` | Focus Areas 4 (tick registration), 9 (heartbeat query) |
| SCHED-05 | `task.runner_requested` from 3 emission points: `autoRouteInboxTasks`, `POST /api/tasks` (direct-assigned w/ recipe_slug), runner-exit retry | Focus Areas 5, 6, 12 |
| SCHED-06 | New SSE events: `recipe.indexed`, `recipe.removed`, `task.container_started`, `task.container_exited`, `task.checkpoint_added` | Focus Area 6 |

---

## Focus Area 1 — Checkpoints endpoint pattern

### Existing `src/app/api/tasks/[id]/...` conventions

Only one sub-route exists today: `src/app/api/tasks/[id]/comments/route.ts` (285 lines). Pattern:

```ts
// src/app/api/tasks/[id]/comments/route.ts:12-17 (GET)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // ...
}

// src/app/api/tasks/[id]/comments/route.ts:90-99 (POST)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;
  // ...
}
```

Other existing `/api/tasks/[id]/` sub-routes: `branch/`, `broadcast/`, `gate/`. Dynamic param is `[id]` (not `[task_id]`).

### Existing `src/app/api/runner/tasks/[task_id]/...` pattern

Route convention under `/api/runner/tasks/[task_id]/`: three existing sub-routes (`submit/`, `runner-exit/`, `container-started/`) all use `Promise<{ task_id: string }>` and `Number.parseInt(resolvedParams.task_id, 10)`. Every existing route follows this 10-line boilerplate:

```ts
// src/app/api/runner/tasks/[task_id]/submit/route.ts:30-48
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ task_id: string }> },
): Promise<NextResponse> {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  // For runner-token routes:
  if (auth.user.id !== -2000) {
    return NextResponse.json({ error: 'runner-token principal required' }, { status: 403 })
  }
  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.task_id, 10)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }
  // For runner-token routes, defense-in-depth cross-task check:
  if (auth.user.runner_token_task_id !== taskId) {
    return NextResponse.json({ error: 'cross-task access forbidden' }, { status: 403 })
  }
  // ...
}
```

### Zod validation + error response patterns

Two patterns coexist:

**Pattern A — legacy `{ error, details }` via `validateBody`** (`src/lib/validation.ts:11-33`): used by comments route, ~60 other endpoints.

**Pattern B — inline `safeParse` with aggregated issues** (`src/app/api/runner/tasks/[task_id]/submit/route.ts:61-71`): used by all four 14-xx runner routes. Returns `{ error: 'Invalid request body', issues: parsed.error.issues }` with status 400.

For CP-05 (discriminated-union artifact validation), Pattern B is the right choice — Zod's `z.discriminatedUnion('kind', [...])` produces structured issues with the discriminator error, and Pattern A's `validateBody` flattens to `${e.path.join('.')}: ${e.message}` which swallows the discriminator path.

### Rate limiter

`mutationLimiter(request)` from `@/lib/rate-limit` — called after auth, before body parse. Returns a `NextResponse` when the caller is over-budget, `null` otherwise. All four 14-xx runner routes use this. For checkpoints, default 60/min per IP is appropriate (agents checkpoint at step boundaries, not per-token).

### GET endpoint shape (CP-06)

CONTEXT.md lets the planner pick ordering. Given the `task_checkpoints` schema (migration 056, `id INTEGER PRIMARY KEY AUTOINCREMENT ... attempt INTEGER ... created_at INTEGER`), default `ORDER BY attempt ASC, id ASC` is stable — `id ASC` is monotone with `created_at` and guarantees a deterministic order within the same `created_at` second. Index `idx_task_checkpoints_task_attempt_created` (migration 056 line 1634) supports this exactly.

---

## Focus Area 2 — Atomic DB + JSONL write mechanics

### `better-sqlite3` transaction idiom

Every 14-xx route uses the same synchronous wrapper:

```ts
// src/app/api/runner/tasks/[task_id]/submit/route.ts:94
db.transaction(() => {
  db.prepare(`UPDATE tasks ...`).run(...)
  revokeTokensForTask(db, taskId, nowUnix)
})()
```

`better-sqlite3`'s `db.transaction(fn)` returns a function; calling it runs `fn` inside `BEGIN ... COMMIT`. Any thrown error triggers `ROLLBACK`. Critically, the transaction function **executes synchronously** — `fn` cannot be `async`, and any `await` inside would break atomicity. `fs.appendFileSync` is synchronous, so it composes cleanly inside the transaction.

### Implementation pattern for Phase 15 atomic write

Because `db.transaction(fn)` treats a thrown error as "rollback", the pattern CONTEXT.md locks is implementable as:

```ts
// Pseudo-code for the checkpoints POST handler:
const lineJson = JSON.stringify({ id: null, task_id, attempt, ts, ...body }) + '\n'
let jsonlBytesBeforeAppend = 0
try {
  jsonlBytesBeforeAppend = fs.statSync(jsonlPath).size
} catch {
  // ENOENT — file will be created by appendFileSync
  jsonlBytesBeforeAppend = 0
}

const inserted = db.transaction(() => {
  const result = db.prepare(`INSERT INTO task_checkpoints (...) VALUES (...)`).run(...)
  // Re-serialize with the actual id now that we have it:
  const actualLine = JSON.stringify({ id: result.lastInsertRowid, task_id, attempt, ts, ...body }) + '\n'
  fs.appendFileSync(jsonlPath, actualLine, { mode: 0o600 })
  return { id: result.lastInsertRowid, line: actualLine }
})()
// On any throw inside transaction(): DB auto-rolls-back. JSONL write MAY have
// landed if the throw happened AFTER appendFileSync. Rollback JSONL by
// truncating back to jsonlBytesBeforeAppend:
// - We cannot reach this `try/catch` point if transaction() threw — Node's
//   error propagation skips past, so the rollback-JSONL logic must live in
//   an outer try/catch around the `.transaction(...)()` call, not inside.
```

**Recommended outer shape:**

```ts
let jsonlBytesBeforeAppend: number
try {
  jsonlBytesBeforeAppend = fs.existsSync(jsonlPath) ? fs.statSync(jsonlPath).size : 0
} catch { jsonlBytesBeforeAppend = 0 }

try {
  const inserted = db.transaction(() => {
    const row = db.prepare(`INSERT INTO task_checkpoints ...`).run(...)
    const line = JSON.stringify({ id: row.lastInsertRowid, ... }) + '\n'
    fs.appendFileSync(jsonlPath, line, { mode: 0o600 })
    return row.lastInsertRowid
  })()
  return NextResponse.json({ id: inserted }, { status: 201 })
} catch (err) {
  // DB already rolled back. If we partially appended JSONL, truncate back.
  try {
    const nowSize = fs.existsSync(jsonlPath) ? fs.statSync(jsonlPath).size : 0
    if (nowSize > jsonlBytesBeforeAppend) {
      fs.truncateSync(jsonlPath, jsonlBytesBeforeAppend)
    }
  } catch { /* non-fatal cleanup */ }
  logger.error({ err, taskId }, 'POST checkpoints failed')
  return NextResponse.json({ error: 'Failed to persist checkpoint' }, { status: 500 })
}
```

**Why this satisfies CONTEXT.md:** The DB transaction rolls back on any throw — including an appendFileSync throw. The outer catch truncates the JSONL file back to its pre-append byte count, which reliably removes the partial line because `appendFileSync` is all-or-nothing for small writes on POSIX (and Linux/macOS ext4/APFS atomically append within a single write syscall for buffers under PIPE_BUF / page size). For a checkpoint line (<< 4KB typically), a torn write is unreachable on the supported platforms.

### Concurrent-writer concerns

`fs.appendFileSync` uses `O_APPEND` which is atomic across processes on POSIX for writes <= PIPE_BUF (4KB on Linux, 512B on macOS by POSIX spec but larger in practice). Two concurrent checkpoint POSTs for the same task would append in an unspecified order but would NOT interleave lines. The in-container agent also append-writes to the same path inside the container (which sees `/workspace` = host worktree), so host + container agents both writing to `checkpoints.jsonl` is already the state as of Phase 14. The host-canonical audit per CONTEXT.md treats the host file as authoritative; in-container appends are an audit redundancy.

**No file-locking primitive exists in `src/lib/` today.** If two checkpoints POSTs race for the same task, both will succeed (DB rows both commit with different `id`s, JSONL gets two lines). This matches the "emit-on-every-transition, daemon dedupes" spirit.

### Existing JSONL append elsewhere in repo

None in `src/lib/` (grep confirmed). The runner daemon at `scripts/mc-runner.mjs` works with JSONL but only reads; writes happen via `seedMcDir` (empty file creation) in `src/lib/runner-worktree.ts:137`. The in-container agent at `docker/hello-world-agent/agent.mjs` appends via `fs.appendFileSync` (CONTEXT.md references this as the "local pre-post audit"). **Phase 15's server-side append is a net-new pattern for the `src/` tree.**

---

## Focus Area 3 — Worktree path access

### How `tasks.worktree_path` gets set

`src/app/api/runner/claim/[task_id]/route.ts:265-287`:

```ts
const worktreePath =
  recipe.workspace_mode === 'worktree'
    ? path.join(config.dataDir, 'runner', 'worktrees', `task-${taskId}`)
    : null

// Inside the atomic claim transaction:
UPDATE tasks
SET ... worktree_path = ?, ...
WHERE id = ? AND status = 'assigned' AND container_id IS NULL AND recipe_slug IS NOT NULL
```

The path is **absolute**, joined from `config.dataDir` (from `src/lib/config.ts:69-73`). `config.dataDir` resolves to `process.env.MISSION_CONTROL_DATA_DIR ?? path.join(process.cwd(), '.data')`. In production, this is always absolute.

### Reading worktree_path in API routes

The Phase 15 checkpoints POST will:

```ts
const task = db.prepare(
  'SELECT worktree_path, runner_attempts FROM tasks WHERE id = ? AND workspace_id = ?'
).get(taskId, workspaceId) as { worktree_path: string | null; runner_attempts: number }

if (!task.worktree_path) {
  return NextResponse.json({ error: 'task has no worktree — non-worktree-mode recipe or not yet claimed' }, { status: 400 })
}
const jsonlPath = path.join(task.worktree_path, '.mc', 'checkpoints.jsonl')
```

**Attempt number for JSONL line:** `runner_attempts` is the current attempt (incremented on claim in `runner-exit/route.ts:181` flow via `runner-claim.ts`). Since `.mc/task.json` uses the same counter (`src/lib/runner-worktree.ts:34-37` — `attempt: number`), `runner_attempts` at POST time IS the attempt number the checkpoint belongs to.

### MISSION_CONTROL_DATA_DIR envelope

Set at `src/lib/config.ts:13` (`process.env.MISSION_CONTROL_DATA_DIR || defaultDataDir`). `defaultDataDir` = `path.join(process.cwd(), '.data')` at `src/lib/config.ts:12`. For tests that stub this, the precedent is to pass a temp dir via env var (`src/app/api/runner/tasks/[task_id]/runner-exit/__tests__/route.test.ts:14-17` uses `mkdtemp(join(tmpdir(), ...))` and sets env vars).

---

## Focus Area 4 — Scheduler module structure

### Scheduler functions live in `src/lib/task-dispatch.ts`

- `autoRouteInboxTasks()` — `src/lib/task-dispatch.ts:979-1076`
- `dispatchAssignedTasks()` — `src/lib/task-dispatch.ts:666-924`
- `requeueStaleTasks()` — `src/lib/task-dispatch.ts:588-664`
- `runAegisReviews()` — `src/lib/task-dispatch.ts:414-582`

### Tick registration pattern in `src/lib/scheduler.ts`

The scheduler uses a `Map<string, ScheduledTask>` of tick metadata (`src/lib/scheduler.ts:18-26`) registered in `initScheduler()` (line 279). Each entry has:

```ts
tasks.set('<id>', {
  name: '<display name>',
  intervalMs: TICK_MS,   // = 60 * 1000
  lastRun: null,
  nextRun: now + <delay>,
  enabled: true,
  running: false,
})
```

The tick loop `tick()` at line 418 dispatches via a massive `id === '<name>' ? await <fn>() : ...` chain (lines 442-460). Same chain in `triggerTask()` (line 513) and `getSchedulerStatus()` (line 473).

**`TICK_MS` is 60 seconds (line 276).** Adding a 30s tick for `reconcileRunnerHeartbeat` means the scheduler loop needs to run at 30s — BUT the current loop runs at 60s. **The cleanest path is to set the new task's `intervalMs = 30_000` and reduce the tick loop to `Math.min(30_000, TICK_MS)`, or run the reconcile tick twice per scheduler tick by tracking `lastRun`**. The simpler option is to register the new task with `intervalMs: 30_000` and change `TICK_MS` at line 276 to `30_000`. This affects every other task (they'd be checked every 30s instead of 60s, but `nextRun` logic prevents duplicate runs).

**Verified:** Existing tasks (agent_heartbeat = 5 min, task_dispatch = 60s, etc.) are driven by `nextRun = now + intervalMs` comparisons. Reducing `TICK_MS` to 30s doesn't change their effective cadence.

**Alternative:** Keep `TICK_MS=60_000`, register `reconcile_runner_heartbeat` with `intervalMs=30_000`. On the 60s tick, at most one reconcile fires (it would "miss" one 30s boundary). Not strictly 30s cadence but usually close enough. The stale window is 90s = 3× the intended 30s tick; if tick fires every 60s, effective detection is 60-150s, which is outside the stated locked "3× 30s = 90s" semantics.

**Recommendation: reduce `TICK_MS` to 30_000** to honor the locked 90s stale window semantics precisely. This is a low-risk change — scheduler state is in-process, no persistence.

### Settings-enabled gate

Every scheduled task is gated by `isSettingEnabled(settingKey, defaultEnabled)` at line 438. Phase 15 should add `general.reconcile_runner_heartbeat` to the switch with `defaultEnabled = true`. Same pattern on the `getSchedulerStatus` and `triggerTask` ladders.

---

## Focus Area 5 — Recipe tagging probe

### Column definition

`src/lib/migrations.ts:1644` — `if (!hasTaskCol('recipe_slug')) db.exec('ALTER TABLE tasks ADD COLUMN recipe_slug TEXT')`. Migration 057. Nullable. Partial index `idx_tasks_recipe_slug ON tasks(recipe_slug) WHERE recipe_slug IS NOT NULL` (line 1657).

### How a task gets a `recipe_slug`

Two code paths:

1. **`POST /api/tasks`** — `src/app/api/tasks/route.ts:216-244` validates `recipe_slug` via `getIndexedRecipeBySlug` (recipe-not-found → 400 with `RECIPE_NOT_FOUND`). INSERTs at line 386 (`body.recipe_slug ?? null`).
2. **`PUT /api/tasks/[id]`** — `src/app/api/tasks/[id]/route.ts:288-331` — RECIPE_LOCKED gate: `recipe_slug` can only change while `status IN ('backlog', 'inbox')` (line 45). Update applied at line 533.

### SCHED-05 direct-assigned emission point

`POST /api/tasks` path that creates a task as `status='assigned'` with `recipe_slug` set. Check `normalizeTaskCreateStatus` (`src/lib/task-status.ts:13-20`) — if caller passes `status: 'inbox'` AND `assigned_to`, it auto-upgrades to `'assigned'`. Caller passing `status: 'assigned'` explicitly also lands as `'assigned'`.

**Exact emission site in `src/app/api/tasks/route.ts`:** after line 468 (`eventBus.broadcast('task.created', parsedTask)`), conditionally emit:

```ts
if (parsedTask.status === 'assigned' && parsedTask.recipe_slug) {
  eventBus.broadcast('task.runner_requested', {
    task_id: parsedTask.id,
    recipe_slug: parsedTask.recipe_slug,
    workspace_id: parsedTask.workspace_id,
  })
}
```

### SCHED-01 — autoRouteInboxTasks recipe-tagged fast path

`src/lib/task-dispatch.ts:982-990` currently queries:

```sql
SELECT id, title, description, priority, tags, workspace_id
FROM tasks
WHERE status = 'inbox' AND assigned_to IS NULL
```

**Doesn't filter by `recipe_slug`.** SCHED-01 requires recipe-tagged tasks to bypass the affinity scoring (lines 1008-1067). Simplest refactor: split the loop — pull recipe-tagged rows first, move them `inbox → assigned` with `assigned_to = null` kept and `recipe_slug` unchanged, emit `task.runner_requested`. Then run the legacy scoring loop on the remaining non-recipe rows.

### SCHED-02 — dispatchAssignedTasks recipe skip

`src/lib/task-dispatch.ts:669-681` joins `tasks JOIN agents a ON a.name = t.assigned_to`. A recipe-tagged task has `recipe_slug IS NOT NULL` and typically no `assigned_to` (or `assigned_to=null`) — the JOIN already excludes them. But if some edge case ever assigns an agent to a recipe-tagged task, the SELECT would return it. Safer: add `AND t.recipe_slug IS NULL` to the WHERE at line 676.

---

## Focus Area 6 — Event bus + SSE emission

### `src/lib/event-bus.ts` shape

```ts
// src/lib/event-bus.ts:15-55
export type EventType =
  | 'task.created' | 'task.updated' | 'task.deleted' | 'task.status_changed'
  | 'task.escalated' | ...
  // 40-ish types currently; CLOSED UNION
```

`eventBus.broadcast(type: EventType, data: any)` at line 75. **The `type` parameter is typed — adding a new event type requires extending the union.** This is good: it catches typos at compile time.

### Changes Phase 15 must make

Append to the union (additive-only per CONTEXT.md):

```ts
| 'task.runner_requested'     // SCHED-05
| 'task.container_started'    // SCHED-06, emitted from /container-started route
| 'task.container_exited'     // SCHED-06, emitted from /runner-exit route
| 'task.checkpoint_added'     // SCHED-06, emitted from POST checkpoints
| 'recipe.indexed'            // SCHED-06, emitted from recipe-watcher.ts
| 'recipe.removed'            // SCHED-06, emitted from recipe-watcher.ts
```

### SSE route — opaque pass-through

`src/app/api/events/route.ts:30-40`:

```ts
const handler = (event: ServerEvent) => {
  if (event.data?.workspace_id && event.data.workspace_id !== userWorkspaceId) return
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
}
eventBus.on('server-event', handler)
```

**No type filter — every `EventType` flows through.** Clients see everything and filter client-side. Phase 16 UI will add handlers keyed on `event.type`.

**Workspace-scoping note:** if `event.data.workspace_id` is present, SSE route drops cross-workspace events. New events must carry `workspace_id` for cross-workspace isolation. The daemon currently runs global (not workspace-scoped), but the task-related events all have a `workspace_id` because tasks are workspace-scoped.

### Recipe watcher — no existing emission

`src/lib/recipe-watcher.ts:202-232` (`scheduleReindex`): logs `'recipe removed (recipe.yaml gone)'` or `'recipe re-indexed after partial unlink'` via `logger.info(...)` but does NOT call `eventBus.broadcast`. Phase 15 must inject broadcast calls at lines 217 (removed) and 218/224 (indexed).

```ts
// After `removeRecipe(slug)` at line 216:
eventBus.broadcast('recipe.removed', { slug })

// After each successful `indexRecipe(absDir)` result.status === 'indexed' (lines 219, 225):
eventBus.broadcast('recipe.indexed', { slug, dir_sha: result.dir_sha })
```

Boot-scan path at `scanRecipesDir` (not shown — earlier in file) would also emit during initial index. Planner decides whether boot events count (per CONTEXT.md additive-only, emitting on boot is harmless — clients filter).

---

## Focus Area 7 — Comments API for auto-comment

### Pattern for system-authored comments

There is no dedicated helper. Three existing code sites INSERT comments directly via SQL:

- `src/lib/task-dispatch.ts:539-541` — author `'aegis'` (Aegis rejection comments)
- `src/lib/task-dispatch.ts:640-642` — author `'scheduler'` (requeue-by-scheduler comments)
- `src/lib/task-dispatch.ts:826-834` — author `task.agent_name` (dispatch result)

**All use raw INSERT** — no mentions processing, no subscriber notifications, no event bus broadcast. Schema (from `comments` table): `task_id, author, content, created_at, workspace_id, parent_id (optional), mentions (optional JSON)`.

### Recommended Phase 15 auto-comment

Direct INSERT, author `'system'`, no mentions, no subscribers:

```ts
db.prepare(`
  INSERT INTO comments (task_id, author, content, created_at, workspace_id)
  VALUES (?, 'system', ?, ?, ?)
`).run(
  taskId,
  `Task blocked at attempt ${attempt}.\n\nReason: ${blocker_reason}\n\nAwaiting owner review. Move task back to \`assigned\` to resume execution.`,
  nowUnix,
  workspaceId,
)
```

This INSERT must live INSIDE the same `db.transaction(...)` as the `tasks.status = 'awaiting_owner'` UPDATE so a crash rolls both back (matches the Phase 11-04 + Phase 14-06 pattern at `runner-exit/route.ts:182-260`).

### Activity log?

`db_helpers.logActivity` pattern (comments route line 188-202) creates an `activities` row. Optional for the auto-comment but precedent is to log when a user-facing event happens. Decide in plan.

---

## Focus Area 8 — Runner-token auth on checkpoints endpoint (CRITICAL)

### The substrate constraint

`src/lib/runner-tokens.ts:10-17`:

```ts
export const RUNNER_TOKEN_ALLOWLIST: ReadonlyArray<{ method: string; pathPattern: RegExp }> = [
  { method: 'POST', pathPattern: /^\/api\/runner\/tasks\/(\d+)\/checkpoints\/?$/ },
  { method: 'POST', pathPattern: /^\/api\/runner\/tasks\/(\d+)\/submit\/?$/ },
  { method: 'POST', pathPattern: /^\/api\/runner\/tasks\/(\d+)\/fail\/?$/ },
  { method: 'GET',  pathPattern: /^\/api\/runner\/tasks\/(\d+)\/status\/?$/ },
  { method: 'GET',  pathPattern: /^\/api\/runner\/tasks\/(\d+)\/?$/ },
  { method: 'GET',  pathPattern: /^\/api\/runner\/tasks\/(\d+)\/comments\/?$/ },
]
```

**Already has `POST /api/runner/tasks/:id/checkpoints`.** NOT `POST /api/tasks/:id/checkpoints`.

`src/lib/auth.ts:526`:

```ts
if (url.pathname.startsWith('/api/runner/')) {
  const bearer = extractApiKeyFromHeaders(request.headers)
  if (bearer) {
    const match = RUNNER_TOKEN_ALLOWLIST.find(...)
    if (match) { ... issue runner-token principal ... }
  }
}
```

**Both gates require `/api/runner/*`.** A runner-token presented to `POST /api/tasks/:id/checkpoints` falls all the way through to the final `return null` (line 673) → `requireRole` returns 401.

### The conflict

CP-01 verbatim: `POST /api/tasks/:id/checkpoints`. But the substrate only allows runner-token auth on `/api/runner/*`.

**Two options:**

**Option A — host the endpoint at `/api/runner/tasks/:task_id/checkpoints`.** Already in the RAUTH-06 allowlist (line 11). Matches `/submit`, `/fail`, `/runner-exit`, `/container-started` pattern. Zero substrate change. CONTEXT.md § Claude's Discretion explicitly permits: "Exact route file paths. Pattern follows existing `src/app/api/tasks/[id]/...` conventions." (The phrase `src/app/api/tasks/[id]/...` in CONTEXT.md is under "Claude's Discretion" — discretion can reinterpret toward `/api/runner/tasks/...`.)

**Option B — modify `src/lib/auth.ts` + `runner-tokens.ts` to allow runner-token on `/api/tasks/*`.** Adds an entry like `{ method: 'POST', pathPattern: /^\/api\/tasks\/(\d+)\/checkpoints\/?$/ }`. Breaks the Phase 11 invariant that runner-tokens are `/api/runner/*`-scoped. Touches RAUTH-01/02/06.

**Recommendation: Option A.** It's the zero-substrate-churn path, already tested via `RUNNER_TOKEN_ALLOWLIST` line 11, and preserves Phase 11's locked invariant.

### GET under viewer auth

CP-06 specifies a viewer-readable GET for the timeline. Under Option A, mirror the GET at `/api/tasks/[id]/checkpoints` (no runner-token required — this is a viewer read, goes through `requireRole('viewer')`). The POST and GET are asymmetric by design: POST is agent-facing (runner-token), GET is UI-facing (viewer).

**Callout in plan:** document this asymmetry. Requirement CP-01 mentions `/api/tasks/:id/checkpoints` which the planner will translate to a **GET at that path** and a **POST at `/api/runner/tasks/:task_id/checkpoints`**. This resolves CP-06 literally (GET at `/api/tasks/:id/checkpoints?attempt=N`) while respecting the auth substrate.

---

## Focus Area 9 — Runner heartbeats table

### Schema

Migration 060 (`src/lib/migrations.ts:1736-1744`):

```sql
CREATE TABLE IF NOT EXISTS runner_heartbeats (
  runner_id TEXT PRIMARY KEY,
  last_heartbeat_at INTEGER NOT NULL,
  registered_at INTEGER NOT NULL,
  metadata_json TEXT
);
CREATE INDEX idx_runner_heartbeats_last ON runner_heartbeats(last_heartbeat_at DESC);
```

One row per runner. `last_heartbeat_at` in unix-seconds (`src/app/api/runner/heartbeat/route.ts:69` — `Math.floor(ts / 1000)`).

### Stale query

No existing helper. The Phase 15 query:

```ts
const STALE_SECS = 90
const nowUnix = Math.floor(Date.now() / 1000)
const staleRunners = db.prepare(
  'SELECT runner_id, last_heartbeat_at FROM runner_heartbeats WHERE last_heartbeat_at < ?'
).all(nowUnix - STALE_SECS) as Array<{ runner_id: string; last_heartbeat_at: number }>
```

Index hits directly. For `reconcileRunnerHeartbeat`:

```ts
// Find tasks IN PROGRESS with recipe_slug that were claimed by a now-stale runner.
// There's no tasks.runner_id column today — the link is via task_runner_attempts
// OR via runner_started_at plus "the only runner". Since migration 061
// task_runner_attempts doesn't carry runner_id either, the current data model
// assumes a SINGLE runner. Stale-detection for v1.2 is therefore:
//    "If ANY runner is stale AND a recipe task is in_progress, check it."
// Multi-runner attribution is a v1.3 concern.
```

**Finding:** The data model assumes one runner. If any runner is stale, and a recipe task is `in_progress`, it's stuck. This is consistent with RUNNER-01's "standalone Node process" framing. The plan should treat this explicitly — reconcileRunnerHeartbeat queries `tasks WHERE status='in_progress' AND recipe_slug IS NOT NULL` and flips any whose last update is older than the stale window, OR (more precisely) flips them if `runner_heartbeats` shows no runner heartbeated recently.

### Recommendation

```ts
async function reconcileRunnerHeartbeat(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const STALE_WINDOW_SECS = 90

  // Any fresh heartbeat in the last 90s?
  const freshHb = db.prepare(
    'SELECT COUNT(*) as c FROM runner_heartbeats WHERE last_heartbeat_at >= ?'
  ).get(now - STALE_WINDOW_SECS) as { c: number }

  if (freshHb.c > 0) {
    // A runner IS alive — no stale-flip. Container-liveness cross-check
    // happens inside requeueStaleTasks against the runner-inventory endpoint.
    return { ok: true, message: 'Runner heartbeat fresh' }
  }

  // No runner heartbeat in 90s. Flip in_progress recipe-tasks back to assigned.
  const stuck = db.prepare(`
    SELECT id FROM tasks
    WHERE status = 'in_progress' AND recipe_slug IS NOT NULL
      AND updated_at < ?
  `).all(now - STALE_WINDOW_SECS) as Array<{ id: number }>

  for (const t of stuck) {
    // Atomic flip + re-emit task.runner_requested
    // ...
  }
}
```

---

## Focus Area 10 — Runner inventory endpoint

### Existing daemon state tracking

`scripts/mc-runner.mjs:443-445`:

```js
// taskId -> { containerId, attempt, timeoutHandle, timeoutFired, logPaths, envFilePath, logsProc }
const activeTasks = new Map()
const inFlightClaims = new Set()
```

In-memory only. Populated at `runContainer` step 11 (line 1073) and cleared in `watchContainerExit` (line 895). Adopted on reconcile (line 533).

### No existing HTTP surface

Daemon does not expose HTTP. It's a client-only process (heartbeat POST, claim POST, runner-exit POST, container-started POST, SSE subscriber, poll ready-tasks). To expose its `activeTasks` Map, one of:

**Option A — Daemon pushes inventory** via a new POST `/api/runner/inventory` on every heartbeat (or on a dedicated tick). MC stores it in a new `runner_inventory` table or in `runner_heartbeats.metadata_json`.

**Option B — MC pulls inventory** via a new daemon-side HTTP listener. The daemon currently uses no HTTP server; adding one is a significant architecture change.

**Option C — Include inventory in heartbeat payload.** Heartbeat schema (`src/app/api/runner/heartbeat/route.ts:31-35`) already has `metadata: z.record(z.string(), z.unknown()).optional()`. Daemon can include `{ active_task_ids: [...] }` in every heartbeat. MC reads it from `runner_heartbeats.metadata_json`.

**Recommendation: Option C.** Minimal surface change. Daemon adds a single line to `heartbeatTick` at `scripts/mc-runner.mjs:580`:

```js
body: JSON.stringify({
  runner_id: RUNNER_ID,
  ts: start,
  metadata: { active_task_ids: Array.from(activeTasks.keys()) },
})
```

MC-side reader:

```ts
// In requeueStaleTasks or a new helper:
const freshHb = db.prepare(`
  SELECT metadata_json FROM runner_heartbeats
  WHERE last_heartbeat_at >= ?
`).get(now - 90) as { metadata_json: string | null } | undefined

const runnerActiveTaskIds = new Set<number>(
  freshHb?.metadata_json
    ? (JSON.parse(freshHb.metadata_json).active_task_ids ?? [])
    : []
)
```

No new endpoint, no new table, no new daemon HTTP server. The CONTEXT.md suggestion of `GET /api/runner/inventory` could also be added as a thin wrapper over this reader for observability, but it's not load-bearing for SCHED-03.

---

## Focus Area 11 — Graceful docker stop from the MC server (CRITICAL)

### The constraint

CONTEXT.md: "MC server does NOT shell out to `docker inspect`". The locked graceful-stop call is `docker stop --time=15` inside the runner daemon — NOT MC. MC must INSTRUCT the runner to execute that stop.

### Existing MC → runner control channel

**None.** The daemon listens for `task.runner_requested` SSE events (`scripts/mc-runner.mjs:660`) and polls `/api/runner/ready-tasks`. There is no "stop this container" message today.

### Options for Phase 15

**Option A — New SSE event `task.container_stop_requested`**, daemon subscribes alongside `task.runner_requested`. Daemon's SSE handler (`scripts/mc-runner.mjs:623-676`) parses the event, looks up the container in `activeTasks`, calls `spawnSync('docker', ['stop', '--time=15', tracked.containerId])`. This mirrors the existing pattern exactly — SSE is the only MC→daemon channel today.

**Option B — Piggyback on `task.container_exited` with `reason='blocked'`.** CONTEXT.md already locks this emit: "Emit `task.container_exited` with `reason='blocked'`." But **that event fires AFTER the stop**. The question is what triggers the stop to BEGIN with.

**Option C — New polling endpoint `GET /api/runner/stop-requests`.** MC inserts a row in a new `task_stop_requests` table when blocked checkpoint arrives; daemon polls every 10s (heartbeat rhythm) and drains. Higher latency than SSE.

**Option D — The daemon observes `task.checkpoint_added` SSE event** for its own active tasks, and when the event's `status === 'blocked'` AND `task_id ∈ activeTasks`, it self-initiates `docker stop --time=15`. This avoids a new control channel entirely; the existing checkpoint event IS the signal.

**Recommendation: Option D.** The `task.checkpoint_added` event is already in the SCHED-06 list. Daemon subscribes to it, checks `activeTasks.has(event.data.task_id)`, and on `status==='blocked'` stops the container. After the stop, `watchContainerExit` (line 836) fires, `postRunnerExit` reports reason='exit' (or 'crash' if docker was SIGKILL'd past the 15s grace); MC's `runner-exit` handler sees this. The `task.container_exited` event with `reason='blocked'` is emitted by MC's `runner-exit` handler when it detects the preceding blocker checkpoint.

**Order of operations for the blocker path:**

1. Agent POSTs `/api/runner/tasks/:id/checkpoints` with `status: 'blocked', blocker_reason: '...'`.
2. MC atomically: INSERT task_checkpoints row + append JSONL + `UPDATE tasks SET status='awaiting_owner'` + INSERT auto-comment (author='system') + `revokeTokensForTask` (optional — the runner-token is single-attempt so it'll die naturally; but explicit revoke matches the terminal-status precedent at `src/app/api/tasks/[id]/route.ts:581-583`).
3. MC broadcasts `task.checkpoint_added` SSE event (includes `status: 'blocked'`).
4. Daemon's SSE handler sees it, checks `activeTasks.has(task_id)`, calls `docker stop --time=15 <container_id>`.
5. Container exits (clean SIGTERM or timeout SIGKILL); `watchContainerExit` resolves; `postRunnerExit` POSTs `/api/runner/tasks/:id/runner-exit` with the exit code.
6. MC's runner-exit handler detects the preceding-blocker state (task.status === 'awaiting_owner' at this point) and emits `task.container_exited { reason: 'blocked' }` instead of the usual retry/fail logic.

**Alternative if the planner prefers explicit separation:** new `task.container_stop_requested` SSE event (Option A) — cleaner separation of concerns but adds an SSE type and a daemon handler for a feature already expressible via Option D. Plan decides.

### seedMcDir resume-marker (CONTEXT.md lock)

CONTEXT.md: "When the runner seeds the resumed `.mc/` dir, it appends a single visible marker line to `progress.md`". Current `src/lib/runner-worktree.ts:126-152` does NOT do this. Phase 15 modifies `seedMcDir` to append the marker when `task.is_resuming===true AND task.blocker_reason !== null`. The `blocker_reason` would need to flow into the dispatch payload. **Trace needed:**

- Dispatch payload is built by `src/app/api/runner/claim/[task_id]/route.ts:~320` (`buildDispatchPayload`). It currently includes `task.prior_attempts`. Add `task.last_blocker_reason` derived from the most recent `task_checkpoints` row where `status='blocked' AND task_id=:id`.
- OR: query the DB from inside `seedMcDir`. But `runner-worktree.ts` is pure-filesystem — no DB. Keep it pure; pass the marker text in via the input object.

Recommendation: extend `seedMcDir` input:

```ts
export function seedMcDir(worktreePath: string, input: {
  task: McTaskJson;
  resume_marker?: { blocker_reason: string; at_iso: string } | null;
}): void
```

The daemon or MC assembles the `resume_marker` when `task.is_resuming && last_blocker_reason`. Marker line appended to `progress.md`.

---

## Focus Area 12 — Phase 14's claim path

### Trace

1. **MC emits `task.runner_requested`** (Phase 15 new). Data: `{ task_id, recipe_slug, workspace_id }`.
2. **Daemon SSE handler** (`scripts/mc-runner.mjs:660`) calls `handleRunnerRequested(taskId)` → `tryClaim(taskId)`.
3. **`tryClaim`** POSTs `/api/runner/claim/:task_id` (`scripts/mc-runner.mjs` ~line 850).
4. **Claim route** (`src/app/api/runner/claim/[task_id]/route.ts`) atomically: UPDATE tasks to `in_progress`, INSERT `task_runner_attempts`, mint runner-token, RETURN dispatch payload with `is_resuming: task.runner_attempts > 0` OR similar derivation.
5. **Daemon runContainer** (`scripts/mc-runner.mjs:898`) → worktree add/reuse → `seedMcDir({ task: { ..., is_resuming: task.is_resuming, prior_attempts: [...] } })` → stage recipe → docker run.
6. **Post-launch** — daemon POSTs `/api/runner/tasks/:id/container-started` with real container_id (Plan 14-11). **Phase 15 adds `eventBus.broadcast('task.container_started', ...)` in this route.**

### Resume semantics unchanged

`seedMcDir` at `src/lib/runner-worktree.ts:134-147` already preserves `progress.md` + `checkpoints.jsonl` on `is_resuming=true`. Rewrites `task.json`. Creates defensive empty files if operator wiped worktree. This is the full resume path — no changes needed for CP-04 except the progress.md marker injection (Focus Area 11).

### is_resuming derivation

Claim route at `src/app/api/runner/claim/[task_id]/route.ts` (around line 300, in `buildDispatchPayload`): `is_resuming` becomes `true` when the task has prior attempts. This already works for crash-retry via runner-exit. For the blocker-resume path it ALSO works because the flow is: agent blocks → MC flips to `awaiting_owner` (keeps `runner_attempts` intact) → human flips back to `assigned` → next claim sees `runner_attempts > 0` → `is_resuming=true`.

---

## Focus Area 13 — Testing conventions

### Vitest layout

- Unit tests: `src/lib/__tests__/<module>.test.ts` (pattern from `src/lib/__tests__/migrations-v12-runtime.test.ts`)
- Route integration tests: co-located in `src/app/api/<path>/__tests__/route.test.ts`
- Environment: `jsdom` (`vitest.config.ts:12`) — works for both client and server code
- Coverage thresholds: 60% all four metrics (line 82-86)

### Mock patterns

Consistent across 14-xx routes (see `src/app/api/runner/tasks/[task_id]/runner-exit/__tests__/route.test.ts:22-46`):

```ts
let testDb: Database.Database  // in-memory via `new Database(':memory:')`

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: { logActivity: vi.fn(), ... },
}))

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', () => ({ requireRole: (...args) => requireRoleMock(...args) }))

vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

// Import route AFTER mocks
import { POST } from '@/app/api/runner/tasks/[task_id]/.../route'
```

The `runMigrations(testDb)` call at test setup builds the schema. `seedTask(db, id)` helpers INSERT rows directly.

### Wave-0 scaffold precedent

Phases 11/12/13/14 each shipped a Wave-0 plan with `it.todo` stubs prefixed by REQ-ID (`[Phase 14-03]` decision in STATE.md). Wave 1+ replaces `it.todo` bodies in-place.

### No Next.js route harness

There's no harness that spins up Next routes — tests import the POST/GET functions directly and construct `NextRequest` inline:

```ts
function submitReq(taskId: number, bearer: string | null, body: unknown): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  return new NextRequest(`http://localhost/api/runner/tasks/${taskId}/submit`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
}
```

### Atomic-write testing

For the DB + JSONL atomic test, the pattern is `mkdtemp(join(tmpdir(), ...))` for `MISSION_CONTROL_DATA_DIR` and assertions on `fs.readFileSync(jsonlPath, 'utf8').split('\n')`. To simulate DB failure while JSONL succeeded, stub `db.prepare(...).run` to throw after a first successful call — standard vitest. To simulate JSONL failure while DB succeeded, stub `fs.appendFileSync` to throw once. Assert DB row count = 0 AND JSONL line count unchanged from pre-call baseline.

---

## Focus Area 14 — Requirements catalogue

Verified against `.planning/REQUIREMENTS.md:174-213` (CP-01..06 + SCHED-01..06). No nuance beyond roadmap summary. Direct quotes:

- **CP-01** (line 174): `step`, `summary`, `status` (`completed` | `in_progress` | `blocked`), plus optional `artifacts`, `next_step`, `blocker_reason`, `tokens_used`, `duration_ms`. **Note: `status='completed'` is a third accepted value** beyond `in_progress` and `blocked`. CONTEXT.md § Decisions does not restrict to `blocked`-only handling — completed/in_progress just persist and emit, they don't trigger special state transitions.
- **CP-02** (line 175): "identical field names" — JSONL line field names match DB column names except DB uses `artifacts_json` while JSONL uses `artifacts`. Plan must handle this: JSONL stores the array as `"artifacts": [...]`, DB stores it as JSON string in `artifacts_json`. Both round-trip to the same array value.
- **CP-05** (line 178): `kind: file | url | diff | test_result | comment | other` with optional `path`, `url`, `ref`, `summary`. CONTEXT.md § Decisions tightens this to per-kind required-field strictness.
- **SCHED-03** (line 210): "runner heartbeat AND container liveness in addition to existing legacy logic." Legacy `requeueStaleTasks` (`src/lib/task-dispatch.ts:588-664`) checks `agent_status = 'offline'`. Phase 15 extends for recipe-tasks (where there's no `agent`).
- **SCHED-05** (line 212): three emission points. Already enumerated in Focus Areas 5, 6, 12.

---

## Standard Stack

### Core (already present — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | 12.6.2 | Synchronous SQL with atomic transactions | Every route uses `getDatabase()` + `db.transaction` |
| `zod` | 4.3.6 | Runtime validation | 60+ routes use it; v4 API for dynamic error messages |
| `next` | 16.1.6 | App Router routes | All existing API routes |
| `pino` | 10.3.1 | Structured logging | `logger.info/warn/error` everywhere |

### New Patterns (no new deps)

| Pattern | Implementation | Location |
|---------|----------------|----------|
| Discriminated-union Zod schema | `z.discriminatedUnion('kind', [...])` | New — for CP-05 artifacts |
| `fs.appendFileSync` inside `db.transaction` | Inline in checkpoints POST | New for `src/` tree |
| `fs.truncateSync(path, size)` compensating rollback | Inline in checkpoints POST catch | New for `src/` tree |
| SSE event subscriber in daemon | Extend `scripts/mc-runner.mjs:623-676` | New handler for `task.checkpoint_added` |

### Installation

No new dependencies.

---

## Architecture Patterns

### Recommended Layout

```
src/
├── app/api/
│   ├── runner/tasks/[task_id]/checkpoints/
│   │   ├── route.ts              # POST (runner-token auth)
│   │   └── __tests__/route.test.ts
│   ├── tasks/[id]/checkpoints/
│   │   ├── route.ts              # GET (viewer auth)
│   │   └── __tests__/route.test.ts
│   └── runner/inventory/         # OPTIONAL (Focus Area 10)
│       ├── route.ts
│       └── __tests__/route.test.ts
├── lib/
│   ├── task-checkpoints.ts       # NEW: write helper + read helper + Zod schemas
│   │                             # Keeps route.ts lean; testable in isolation
│   ├── scheduler-runner-reconcile.ts  # NEW: reconcileRunnerHeartbeat pure fn
│   ├── event-bus.ts              # MODIFIED: add 6 new EventType entries
│   ├── task-dispatch.ts          # MODIFIED: autoRoute + requeueStale + SCHED-02
│   ├── scheduler.ts              # MODIFIED: register reconcile_runner_heartbeat tick
│   ├── recipe-watcher.ts         # MODIFIED: emit recipe.indexed / recipe.removed
│   └── runner-worktree.ts        # MODIFIED: seedMcDir accepts resume_marker
```

### Pattern 1: Atomic checkpoint write

```ts
// src/lib/task-checkpoints.ts — NEW

import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { z } from 'zod'

// Artifact discriminated union (CP-05)
const ArtifactBase = { summary: z.string().max(4000).optional() }
export const ArtifactSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'),        path: z.string().min(1).max(1000), ...ArtifactBase }),
  z.object({ kind: z.literal('url'),         url: z.string().min(1).max(2000),  ...ArtifactBase }),
  z.object({ kind: z.literal('diff'), path: z.string().min(1).max(1000).optional(), ref: z.string().min(1).max(200).optional(), ...ArtifactBase })
    .refine((a) => Boolean(a.path || a.ref), { message: 'diff requires path OR ref' }),
  z.object({ kind: z.literal('test_result'), path: z.string().optional(), url: z.string().optional(), summary: z.string().min(1).max(4000).optional() })
    .refine((a) => Boolean(a.path || a.url || a.summary), { message: 'test_result requires path OR url OR summary' }),
  z.object({ kind: z.literal('comment'),     summary: z.string().min(1).max(4000) }),
  z.object({ kind: z.literal('other'),       path: z.string().optional(), url: z.string().optional(), ref: z.string().optional(), summary: z.string().optional() }),
])

export const CheckpointBodySchema = z.object({
  step: z.string().min(1).max(200),
  summary: z.string().min(1).max(4000),
  status: z.enum(['completed', 'in_progress', 'blocked']),
  artifacts: z.array(ArtifactSchema).max(50).optional(),
  next_step: z.string().max(500).optional(),
  blocker_reason: z.string().max(2000).optional(),
  tokens_used: z.number().int().min(0).optional(),
  duration_ms: z.number().int().min(0).optional(),
}).refine(
  (b) => b.status !== 'blocked' || (b.blocker_reason && b.blocker_reason.trim().length > 0),
  { message: 'status=blocked requires non-empty blocker_reason', path: ['blocker_reason'] },
)

export type CheckpointBody = z.infer<typeof CheckpointBodySchema>

export interface CheckpointInsertResult {
  id: number
  attempt: number
  ts: string  // ISO-8601
}

/**
 * Atomic write: DB row + JSONL line. Throws on any failure; caller
 * compensates by truncating the JSONL file back to its pre-call size.
 */
export function writeCheckpoint(
  db: Database.Database,
  taskId: number,
  attempt: number,
  worktreePath: string | null,
  body: CheckpointBody,
): CheckpointInsertResult {
  const nowUnix = Math.floor(Date.now() / 1000)
  const ts = new Date(nowUnix * 1000).toISOString()

  return db.transaction(() => {
    const res = db.prepare(`
      INSERT INTO task_checkpoints
        (task_id, attempt, step, summary, status, artifacts_json,
         next_step, blocker_reason, tokens_used, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId, attempt, body.step, body.summary, body.status,
      JSON.stringify(body.artifacts ?? []),
      body.next_step ?? null, body.blocker_reason ?? null,
      body.tokens_used ?? null, body.duration_ms ?? null,
      nowUnix,
    )
    const id = Number(res.lastInsertRowid)

    if (worktreePath) {
      const jsonlPath = path.join(worktreePath, '.mc', 'checkpoints.jsonl')
      const line = JSON.stringify({
        id, task_id: taskId, attempt, ts,
        step: body.step, summary: body.summary, status: body.status,
        artifacts: body.artifacts ?? [],
        next_step: body.next_step ?? null,
        blocker_reason: body.blocker_reason ?? null,
        tokens_used: body.tokens_used ?? null,
        duration_ms: body.duration_ms ?? null,
      }) + '\n'
      // appendFileSync throws → transaction rolls back DB insert automatically.
      fs.mkdirSync(path.dirname(jsonlPath), { recursive: true })
      fs.appendFileSync(jsonlPath, line, { mode: 0o600 })
    }

    return { id, attempt, ts }
  })()
}
```

### Pattern 2: Scheduler tick registration

```ts
// src/lib/scheduler.ts — ADD after line 399

tasks.set('reconcile_runner_heartbeat', {
  name: 'Reconcile Runner Heartbeat',
  intervalMs: 30_000,       // CONTEXT.md locked 30s cadence
  lastRun: null,
  nextRun: now + 30_000,    // First check 30s after startup
  enabled: true,
  running: false,
})

// And in the dispatch ladder at line 442:
: id === 'reconcile_runner_heartbeat' ? await reconcileRunnerHeartbeat()

// And the settings key at line 426+ and 485+:
: id === 'reconcile_runner_heartbeat' ? 'general.reconcile_runner_heartbeat'
```

**IMPORTANT:** also change `TICK_MS` at line 276 from `60_000` to `30_000` to honor 30s cadence (see Focus Area 4).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File locking for JSONL | `proper-lockfile` / `fcntl` | `fs.appendFileSync` with `O_APPEND` | POSIX `O_APPEND` is atomic for <= PIPE_BUF writes; concurrent appends don't interleave |
| Transaction abstraction over DB + FS | Custom 2-phase commit | `db.transaction(() => { sql; appendFileSync; })` | better-sqlite3 transaction callback synchronously rolls back on throw; appendFileSync is synchronous; they compose cleanly |
| JSON Schema for checkpoint | Hand-rolled validator | `z.discriminatedUnion('kind', ...)` | Already the pattern in `src/lib/validation.ts:74-85`, `src/lib/task-runtime-validation.ts` |
| SSE broadcast fan-out | Custom WebSocket | `eventBus.broadcast(...)` | 40+ existing events use this pattern; already typed; already drains to `/api/events` |
| Container-liveness via docker CLI | `spawn('docker', ['inspect', ...])` in MC | Heartbeat metadata `active_task_ids` (Focus Area 10) | CONTEXT.md locked "no docker inspect from MC"; daemon already knows its active set |
| Parsing runner-inventory JSON | Custom parsing | `z.array(z.number().int().positive())` on the heartbeat body extension | Safe + typed; the heartbeat schema already supports arbitrary metadata |

**Key insight:** Phase 15 adds very little NEW code — most of it is wiring. The temptation to build custom abstractions ("a CheckpointManager class", "a RunnerInventoryService") is premature; inline the 5-10 lines of logic where it lives.

---

## Common Pitfalls

### Pitfall 1: Off-substrate auth path

**What goes wrong:** Hosting `POST /api/tasks/:id/checkpoints` literally as requirements state, then learning the runner-token can't reach it.

**Why it happens:** `src/lib/auth.ts:472, 526` both gate runner-token on `/api/runner/*`. Neither gate is on a path the Phase 15 planner would naturally look at.

**How to avoid:** Host POST at `/api/runner/tasks/:task_id/checkpoints`, GET at `/api/tasks/:id/checkpoints`. Document the asymmetry in the plan.

**Warning signs:** Integration test where the agent presents a runner-token and gets 401.

### Pitfall 2: Async function inside db.transaction

**What goes wrong:** Putting `await` inside `db.transaction(async () => {...})` breaks atomicity — the transaction commits before the await resolves, or the callback is ignored.

**Why it happens:** Developer reaches for async reflexively. better-sqlite3's `transaction` documentation is explicit that the callback must be synchronous.

**How to avoid:** Use `fs.appendFileSync` (not `fs.promises.appendFile`), `fs.statSync`, `fs.truncateSync`. All the existing 14-xx routes follow this pattern.

**Warning signs:** Race where a checkpoint's JSONL line appears but the DB row doesn't, or vice versa.

### Pitfall 3: Scheduler `TICK_MS` mismatch

**What goes wrong:** Registering a 30s task while `TICK_MS=60000` gives 60-90s effective cadence, not 30s.

**Why it happens:** The tick loop runs at `TICK_MS` and dispatches only tasks whose `nextRun < now`. A 30s `intervalMs` misses every other scheduled window.

**How to avoid:** Reduce `TICK_MS` to 30_000.

**Warning signs:** Stale-detection lag > 90s in integration tests.

### Pitfall 4: Missing EventType extension

**What goes wrong:** Calling `eventBus.broadcast('task.runner_requested', ...)` without adding it to the `EventType` union triggers a TS compile error.

**Why it happens:** `src/lib/event-bus.ts:15-55` is closed union.

**How to avoid:** First line item in the plan should be extending `EventType`. Followed by route/scheduler changes that emit.

**Warning signs:** `pnpm typecheck` fails at first PR.

### Pitfall 5: Workspace-scoped SSE drops cross-workspace events

**What goes wrong:** A recipe indexer event fires without `workspace_id` in the payload, but the SSE route (`src/app/api/events/route.ts:32`) only drops events where `event.data?.workspace_id` is PRESENT AND mismatches. Absent workspace_id flows through.

**Why it happens:** Operators conclude events must carry `workspace_id` — but they don't have to, they just MAY.

**How to avoid:** `recipe.indexed`/`recipe.removed` are global (recipes are cross-workspace authored). Emit WITHOUT `workspace_id`. Task events carry `workspace_id`.

**Warning signs:** A runner connected as workspace B loses `recipe.indexed` events authored from workspace A.

### Pitfall 6: Auto-comment outside DB transaction

**What goes wrong:** The `tasks SET status='awaiting_owner'` UPDATE commits but the auto-comment INSERT fails (or vice versa), leaving an inconsistent state.

**Why it happens:** Reflexive `db.prepare(...).run(...)` outside the transaction boundary.

**How to avoid:** Wrap checkpoint INSERT + JSONL append + tasks UPDATE + comment INSERT + token revoke ALL in ONE `db.transaction`. Appending the JSONL inside the transaction is already required by CP-02 atomicity; add the three other DB writes into the same block.

**Warning signs:** A crash test leaves a task in `awaiting_owner` with no comment, or a comment without the task flip.

### Pitfall 7: Daemon dedup fails on coalesced SSE events

**What goes wrong:** Two `task.runner_requested` events fire ~50ms apart (legitimate — autoRouteInboxTasks AND direct-assigned runner-exit retry could both hit the same task). The daemon races, the second claim 409's — but the second `handleRunnerRequested` might fire BEFORE the first completes, BOTH end up in `inFlightClaims`, neither honors the idempotency.

**Why it happens:** `scripts/mc-runner.mjs:595` checks `activeTasks.has(taskId) || inFlightClaims.has(taskId)` and returns early. BUT: `inFlightClaims.add(taskId)` at line 603 happens BEFORE `await tryClaim`, so the second SSE handler correctly sees it and returns. Verified: daemon is already idempotent.

**Why it still matters:** If daemon crashes between `inFlightClaims.add` and `tryClaim` completing, both inFlightClaims AND activeTasks are empty on next SSE — but MC still believes task is in_progress. This is exactly what reconcileRunnerHeartbeat solves.

**How to avoid:** No plan action needed. The existing pattern is correct; reconcileRunnerHeartbeat is the safety net.

### Pitfall 8: JSONL truncation after concurrent append

**What goes wrong:** Two concurrent checkpoint POSTs both append 200-byte lines; first one's DB insert succeeds, second one's DB insert fails, the rollback truncates to `pre-call-size`, which DELETES the first one's successfully-written line too.

**Why it happens:** The `jsonlBytesBeforeAppend = fs.statSync(jsonlPath).size` snapshot is per-POST, not globally serialized.

**How to avoid:** **Do not truncate blindly.** Record `postAppendSize = fs.statSync(jsonlPath).size` (inside the transaction, after appendFileSync). On rollback, truncate only if current size is still `postAppendSize` AND larger than `jsonlBytesBeforeAppend`. If size has grown further (another concurrent POST appended), DO NOT truncate — the JSONL is now out of sync with the DB (this POST's line is still there but its DB row rolled back), and the plan must accept this as acceptable staleness or serialize via a process-level mutex.

**Alternative:** Accept that the server-side canonical JSONL may contain "ghost lines" from rolled-back POSTs in the extremely rare concurrent-failure case. Document it. The agent-posted in-container JSONL remains as source-of-truth audit.

**Recommendation:** Document a best-effort rollback. The tombstone invariant ("DB row exists iff JSONL line committed") holds for sequential POSTs; concurrent POSTs can diverge under failure. Phase 15 acceptance is pragmatic — the in-container pre-post audit (CONTEXT.md) is the true source of truth if divergence matters.

### Pitfall 9: `task.container_exited` emission on every exit reason

**What goes wrong:** The `runner-exit` route fires on exit codes 0, 1, 137, timeout, crash. If Phase 15 broadcasts `task.container_exited` unconditionally, the UI sees the event for both happy-path exits (done via `/submit`) AND error paths.

**Why it matters:** CONTEXT.md says emit with `reason: 'blocked'` in the blocker case. For non-blocker cases, `reason` should be `'exit' | 'timeout' | 'oom' | 'crash' | 'worktree_create_failed' | 'docker_error'` — the existing runner-exit enum (line 52 of runner-exit route). Emit once per exit, with the reason from the body.

**How to avoid:** Map runner-exit's `reason` field directly to the broadcast payload's `reason`. For blocker path, the `reconcile` happens: when runner-exit sees the task is ALREADY `awaiting_owner` (flipped by blocker checkpoint handler), override reason to `'blocked'`.

---

## Code Examples

### Checkpoints POST handler skeleton

```ts
// src/app/api/runner/tasks/[task_id]/checkpoints/route.ts — NEW
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'
import { eventBus } from '@/lib/event-bus'
import { revokeTokensForTask } from '@/lib/runner-tokens'
import { logger } from '@/lib/logger'
import { CheckpointBodySchema, type CheckpointBody } from '@/lib/task-checkpoints'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ task_id: string }> },
): Promise<NextResponse> {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  // Runner-token principal only — id === -2000. Auth layer (src/lib/auth.ts:526)
  // already verified path is allowlisted and token maps to this task_id.
  if (auth.user.id !== -2000) {
    return NextResponse.json({ error: 'runner-token principal required' }, { status: 403 })
  }

  const { task_id } = await params
  const taskId = Number.parseInt(task_id, 10)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }
  if (auth.user.runner_token_task_id !== taskId) {
    return NextResponse.json({ error: 'cross-task access forbidden' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: CheckpointBody
  try {
    const json = await request.json()
    const parsed = CheckpointBodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid checkpoint body', issues: parsed.error.issues }, { status: 400 })
    }
    body = parsed.data
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 })
  }

  const db = getDatabase()
  const task = db.prepare(
    `SELECT id, status, worktree_path, runner_attempts, workspace_id
     FROM tasks WHERE id = ?`
  ).get(taskId) as {
    id: number; status: string; worktree_path: string | null;
    runner_attempts: number; workspace_id: number;
  } | undefined

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (task.status !== 'in_progress') {
    return NextResponse.json({ error: `task status must be in_progress, got ${task.status}` }, { status: 409 })
  }

  const jsonlPath = task.worktree_path ? path.join(task.worktree_path, '.mc', 'checkpoints.jsonl') : null
  let jsonlSizeBeforeAppend = 0
  if (jsonlPath && fs.existsSync(jsonlPath)) {
    try { jsonlSizeBeforeAppend = fs.statSync(jsonlPath).size } catch {}
  }

  const nowUnix = Math.floor(Date.now() / 1000)
  const ts = new Date(nowUnix * 1000).toISOString()
  const attempt = task.runner_attempts

  // Atomic: insert checkpoint + append JSONL + (if blocked) flip status + comment + revoke tokens.
  let inserted: { id: number }
  try {
    inserted = db.transaction(() => {
      const res = db.prepare(`
        INSERT INTO task_checkpoints
          (task_id, attempt, step, summary, status, artifacts_json,
           next_step, blocker_reason, tokens_used, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskId, attempt, body.step, body.summary, body.status,
        JSON.stringify(body.artifacts ?? []),
        body.next_step ?? null, body.blocker_reason ?? null,
        body.tokens_used ?? null, body.duration_ms ?? null, nowUnix,
      )
      const id = Number(res.lastInsertRowid)

      if (jsonlPath) {
        const line = JSON.stringify({
          id, task_id: taskId, attempt, ts,
          step: body.step, summary: body.summary, status: body.status,
          artifacts: body.artifacts ?? [],
          next_step: body.next_step ?? null,
          blocker_reason: body.blocker_reason ?? null,
          tokens_used: body.tokens_used ?? null,
          duration_ms: body.duration_ms ?? null,
        }) + '\n'
        fs.mkdirSync(path.dirname(jsonlPath), { recursive: true })
        fs.appendFileSync(jsonlPath, line, { mode: 0o600 })
      }

      if (body.status === 'blocked') {
        // CP-03: in_progress → awaiting_owner, auto-comment, (runner-token auto-revokes on claim-next).
        db.prepare(`
          UPDATE tasks
          SET status = 'awaiting_owner',
              runner_last_failure_reason = ?,
              updated_at = ?
          WHERE id = ? AND status = 'in_progress'
        `).run(`blocked:${body.blocker_reason!.slice(0, 200)}`, nowUnix, taskId)
        db.prepare(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, 'system', ?, ?, ?)
        `).run(
          taskId,
          `Task blocked at attempt ${attempt}.\n\nReason: ${body.blocker_reason}\n\nMove task back to \`assigned\` to resume.`,
          nowUnix, task.workspace_id,
        )
        // NOT revoking tokens here — container's graceful stop will take time;
        // the token must stay valid for the container to finish any in-flight writes.
        // Token naturally expires 60s after the recipe timeout.
      }

      return { id }
    })()
  } catch (err) {
    // Compensate JSONL append on any failure.
    if (jsonlPath) {
      try {
        const nowSize = fs.existsSync(jsonlPath) ? fs.statSync(jsonlPath).size : 0
        if (nowSize > jsonlSizeBeforeAppend) {
          fs.truncateSync(jsonlPath, jsonlSizeBeforeAppend)
        }
      } catch { /* non-fatal cleanup */ }
    }
    logger.error({ err, taskId }, 'POST /api/runner/tasks/:id/checkpoints error')
    return NextResponse.json({ error: 'Failed to persist checkpoint' }, { status: 500 })
  }

  // SSE broadcast — OUTSIDE transaction so clients only see committed state.
  eventBus.broadcast('task.checkpoint_added', {
    checkpoint_id: inserted.id,
    task_id: taskId,
    attempt,
    status: body.status,
    step: body.step,
    workspace_id: task.workspace_id,
  })

  if (body.status === 'blocked') {
    // Daemon's SSE subscriber (Pitfall D / Option D in Focus Area 11) uses this
    // exact event to initiate `docker stop --time=15`. No extra stop-event needed.
  }

  return NextResponse.json({ id: inserted.id, ts, attempt }, { status: 201 })
}
```

### Recipe-watcher emit patch

```ts
// src/lib/recipe-watcher.ts — MODIFY scheduleReindex callback at line 206+

import { eventBus } from './event-bus'  // NEW import

// Inside the setTimeout callback:
const result = await indexRecipe(absDir)
if (result.status === 'skipped_missing') {
  removeRecipe(slug)
  eventBus.broadcast('recipe.removed', { slug })  // NEW
  logger.info({ slug, path: absDir }, 'recipe removed (recipe.yaml gone)')
} else if (result.status === 'indexed') {
  eventBus.broadcast('recipe.indexed', { slug })  // NEW
  logger.info({ slug, path: absDir }, 'recipe re-indexed after partial unlink')
}
// Error path stays log-only; error rows DO exist in DB so Phase 16 UI reads them directly.
```

### Scheduler reconcile tick

```ts
// src/lib/task-dispatch.ts — ADD export reconcileRunnerHeartbeat

import { eventBus } from './event-bus'  // already imported

export async function reconcileRunnerHeartbeat(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()
  const nowUnix = Math.floor(Date.now() / 1000)
  const STALE_WINDOW_SECS = 90

  const fresh = db.prepare(
    'SELECT 1 FROM runner_heartbeats WHERE last_heartbeat_at >= ? LIMIT 1'
  ).get(nowUnix - STALE_WINDOW_SECS)

  if (fresh) {
    return { ok: true, message: 'Runner heartbeat fresh' }
  }

  // No runner fresh. Flip any in_progress recipe-task whose last update is
  // also stale (prevents flipping a just-claimed task before the first
  // heartbeat window elapses).
  const stuck = db.prepare(`
    SELECT id, recipe_slug, workspace_id FROM tasks
    WHERE status = 'in_progress' AND recipe_slug IS NOT NULL
      AND updated_at < ?
  `).all(nowUnix - STALE_WINDOW_SECS) as Array<{
    id: number; recipe_slug: string; workspace_id: number;
  }>

  if (stuck.length === 0) {
    return { ok: true, message: 'No stale in_progress recipe-tasks' }
  }

  let flipped = 0
  for (const t of stuck) {
    db.transaction(() => {
      const res = db.prepare(`
        UPDATE tasks
        SET status = 'assigned',
            container_id = NULL,
            runner_started_at = NULL,
            runner_last_failure_reason = 'runner_heartbeat_stale',
            updated_at = ?
        WHERE id = ? AND status = 'in_progress'
      `).run(nowUnix, t.id)
      if (res.changes > 0) flipped++
    })()
    if (flipped > 0) {
      eventBus.broadcast('task.runner_requested', {
        task_id: t.id,
        recipe_slug: t.recipe_slug,
        workspace_id: t.workspace_id,
      })
    }
  }

  return { ok: true, message: `Flipped ${flipped} stale recipe-tasks back to assigned` }
}
```

---

## State of the Art

Nothing in Phase 15 needs ecosystem comparison — every decision is driven by the existing codebase substrate. CONTEXT.md locked decisions are the authoritative choice.

**Deprecated/outdated:** Nothing. Phase 15 adds to Phase 11–14 infrastructure; no prior pattern is retired.

---

## Open Questions

1. **Does `GET /api/runner/inventory` need to exist as a public endpoint, or is the heartbeat-metadata embedding enough?**
   - What we know: CONTEXT.md suggests the endpoint but also notes it's Claude's discretion.
   - What's unclear: Phase 16 might want to display "runner active tasks" in the Progress tab. If so, a public GET is cleaner than reaching into `runner_heartbeats.metadata_json`.
   - Recommendation: Plan decides. If yes, add the endpoint as a thin wrapper (10 lines) reading from the heartbeat metadata. If no, defer.

2. **Should the blocker-resume path revoke the runner-token immediately, or wait for natural expiry?**
   - What we know: Current blocker flow leaves the runner-token alive for the graceful-stop window.
   - What's unclear: If the agent re-POSTs a checkpoint after the blocker, what should happen? The task is `awaiting_owner`, not `in_progress` — the POST handler should 409.
   - Recommendation: Add a `status === 'in_progress'` guard in the checkpoint POST (already in the code example above). No token revoke needed — the status guard is sufficient.

3. **Does `reconcileRunnerHeartbeat` emit `task.container_exited` when it flips a stuck task?**
   - What we know: CONTEXT.md says the blocker path emits `reason='blocked'`, and `reason` values are in the runner-exit enum.
   - What's unclear: For a stale-heartbeat flip, the container is still running (presumably) — should we emit `task.container_exited { reason: 'heartbeat_stale' }`?
   - Recommendation: Extend the `reason` enum in the runner-exit schema to include `'heartbeat_stale'`, and emit `task.container_exited` from reconcile when it flips. Alternatively, keep reconcile silent on container_exited (the runner-exit posted later by the daemon would fire it).

4. **Can the daemon actually subscribe to `task.checkpoint_added` SSE events (Focus Area 11 Option D)?**
   - What we know: Daemon already has an SSE subscriber loop.
   - What's unclear: Whether adding a second event handler in the loop is architecturally clean, or whether a new dedicated SSE event `task.container_stop_requested` is cleaner.
   - Recommendation: Extend the existing handler at `scripts/mc-runner.mjs:660`. One more `if (evt.type === '...')` branch is zero-churn. Decision in plan.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.x |
| Config file | `/Users/aaronwhaley/Github/mission-control/vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test:all` (lint + typecheck + test + build + e2e) |

Environment: `jsdom` (line 12), 60% coverage thresholds (line 82-86). No Next.js route harness — tests import POST/GET directly and construct `NextRequest` inline.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CP-01 | POST checkpoints body validation (step/summary/status required; completed/in_progress/blocked enum) | unit (route integration) | `pnpm test src/app/api/runner/tasks/\\[task_id\\]/checkpoints/__tests__/route.test.ts` | ❌ Wave 0 |
| CP-01 | POST checkpoints runner-token auth (cross-task 403, wrong-principal 403) | unit (route integration) | same | ❌ Wave 0 |
| CP-02 | Atomic DB + JSONL write: happy path writes both | unit (route integration) | same | ❌ Wave 0 |
| CP-02 | Atomic DB + JSONL write: JSONL stub throws → DB row count unchanged | unit (route integration) | same | ❌ Wave 0 |
| CP-02 | Atomic DB + JSONL write: DB stub throws → JSONL truncated back to pre-call size | unit (route integration) | same | ❌ Wave 0 |
| CP-02 | JSONL field names match DB column names (except `artifacts`/`artifacts_json`) | unit (pure) | `pnpm test src/lib/__tests__/task-checkpoints.test.ts` | ❌ Wave 0 |
| CP-03 | status=blocked → tasks.status='awaiting_owner', comment INSERT with author='system', atomic | unit (route integration) | same (checkpoints route test) | ❌ Wave 0 |
| CP-03 | status=blocked → `task.checkpoint_added` broadcast fires | unit (route integration) | same | ❌ Wave 0 |
| CP-04 | Resume flow (blocked → assigned) re-emits `task.runner_requested` | unit (route integration for PUT /api/tasks/:id) | `pnpm test src/app/api/tasks/\\[id\\]/__tests__/route.test.ts` | ⚠ exists, extend |
| CP-04 | seedMcDir with resume_marker appends `<iso> \| <<< RESUMED ... >>>` to progress.md | unit (pure) | `pnpm test src/lib/__tests__/runner-worktree.test.ts` | ⚠ exists, extend |
| CP-05 | Artifact discriminated union: kind=file requires path, kind=diff requires path OR ref, etc. | unit (pure) | `pnpm test src/lib/__tests__/task-checkpoints.test.ts` | ❌ Wave 0 |
| CP-05 | Unknown `kind` → 400 with discriminator error | unit (route integration) | checkpoints route test | ❌ Wave 0 |
| CP-06 | GET /api/tasks/:id/checkpoints returns full timeline ordered by attempt, id | unit (route integration) | `pnpm test src/app/api/tasks/\\[id\\]/checkpoints/__tests__/route.test.ts` | ❌ Wave 0 |
| CP-06 | GET ?attempt=N filter | unit (route integration) | same | ❌ Wave 0 |
| SCHED-01 | autoRouteInboxTasks moves recipe-tagged tasks without affinity scoring | unit (task-dispatch extract) | `pnpm test src/lib/__tests__/task-dispatch-autoroute.test.ts` | ❌ Wave 0 |
| SCHED-01 | autoRouteInboxTasks emits `task.runner_requested` for recipe-tagged flip | unit (task-dispatch extract) | same | ❌ Wave 0 |
| SCHED-02 | dispatchAssignedTasks does NOT include recipe-tagged tasks in its SELECT | unit (task-dispatch extract) | `pnpm test src/lib/__tests__/task-dispatch-dispatch.test.ts` | ❌ Wave 0 |
| SCHED-03 | requeueStaleTasks for recipe-tagged checks heartbeat AND runner-inventory | unit (task-dispatch extract) | `pnpm test src/lib/__tests__/task-dispatch-requeue.test.ts` | ❌ Wave 0 |
| SCHED-04 | reconcileRunnerHeartbeat flips in_progress recipe-tasks when no fresh heartbeat | unit (pure) | `pnpm test src/lib/__tests__/task-dispatch-reconcile.test.ts` | ❌ Wave 0 |
| SCHED-04 | reconcileRunnerHeartbeat emits `task.runner_requested` for each flip | unit (pure) | same | ❌ Wave 0 |
| SCHED-05 | Emit from autoRouteInboxTasks on inbox→assigned | unit | task-dispatch tests | ❌ Wave 0 |
| SCHED-05 | Emit from POST /api/tasks when status=assigned + recipe_slug | unit (route integration) | `pnpm test src/app/api/tasks/__tests__/route.test.ts` | ⚠ exists, extend |
| SCHED-05 | Emit from runner-exit retry path (in_progress → assigned) | unit (route integration) | `pnpm test src/app/api/runner/tasks/\\[task_id\\]/runner-exit/__tests__/route.test.ts` | ⚠ exists, extend |
| SCHED-06 | recipe.indexed broadcast on indexRecipe success | unit | `pnpm test src/lib/__tests__/recipe-watcher.test.ts` | ⚠ exists, extend |
| SCHED-06 | recipe.removed broadcast on removeRecipe | unit | same | ⚠ exists, extend |
| SCHED-06 | task.container_started broadcast from /container-started route | unit (route integration) | `pnpm test src/app/api/runner/tasks/\\[task_id\\]/container-started/__tests__/route.test.ts` | ⚠ exists, extend |
| SCHED-06 | task.container_exited broadcast from /runner-exit route (with correct `reason`) | unit (route integration) | runner-exit tests | ⚠ exists, extend |
| SCHED-06 | task.checkpoint_added broadcast from POST checkpoints | unit (route integration) | checkpoints route test | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test --run <specific-test-file>` (~2s)
- **Per wave merge:** `pnpm test` (full vitest suite, ~30s)
- **Phase gate:** `pnpm test:all` (lint + typecheck + test + build + e2e) — full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/app/api/runner/tasks/[task_id]/checkpoints/__tests__/route.test.ts` — covers CP-01, CP-02, CP-03, CP-05
- [ ] `src/app/api/tasks/[id]/checkpoints/__tests__/route.test.ts` — covers CP-06
- [ ] `src/lib/__tests__/task-checkpoints.test.ts` — covers Zod schema (CP-05), atomic-write helper (CP-02 pure)
- [ ] `src/lib/__tests__/task-dispatch-reconcile.test.ts` — covers SCHED-04 (new `reconcileRunnerHeartbeat`)
- [ ] `src/lib/__tests__/task-dispatch-autoroute.test.ts` — covers SCHED-01 (extended autoRouteInboxTasks)
- [ ] `src/lib/__tests__/task-dispatch-dispatch.test.ts` — covers SCHED-02 (dispatchAssignedTasks recipe skip)
- [ ] `src/lib/__tests__/task-dispatch-requeue.test.ts` — covers SCHED-03 (requeueStaleTasks recipe path)
- [ ] `src/lib/__tests__/event-bus.test.ts` — schema-level test that all six new EventType entries compile
- [ ] Existing-file extensions:
  - `src/lib/__tests__/runner-worktree.test.ts` — add resume_marker path (CP-04)
  - `src/lib/__tests__/recipe-watcher.test.ts` — add event emission assertions (SCHED-06)
  - `src/app/api/tasks/__tests__/route.test.ts` — add direct-assigned-with-recipe_slug emission (SCHED-05)
  - `src/app/api/runner/tasks/[task_id]/runner-exit/__tests__/route.test.ts` — add retry-path emission + blocker-detection container_exited (SCHED-05, SCHED-06)
  - `src/app/api/runner/tasks/[task_id]/container-started/__tests__/route.test.ts` — add container_started broadcast (SCHED-06)

No framework install needed — Vitest + better-sqlite3 already present. No new config file.

---

## Sources

### Primary (HIGH confidence)

- `src/lib/auth.ts` — runner-token path-scope gate (lines 472, 526); `requireRunnerToken` wrapper (line 776)
- `src/lib/runner-tokens.ts` — RAUTH-06 allowlist (line 10-17); verify/issue/revoke helpers
- `src/lib/event-bus.ts` — EventType union (line 15-55); broadcast method (line 75)
- `src/lib/migrations.ts` — migrations 055 (tokens), 056 (checkpoints), 057 (tasks cols), 060 (heartbeats), 061 (attempts)
- `src/lib/scheduler.ts` — tick registration pattern (line 287-399); dispatch ladder (line 442-460)
- `src/lib/task-dispatch.ts` — autoRouteInboxTasks (line 979), dispatchAssignedTasks (line 666), requeueStaleTasks (line 588)
- `src/lib/runner-worktree.ts` — seedMcDir (line 126) — must extend for CP-04 resume marker
- `src/lib/recipe-watcher.ts` — scheduleReindex callback (line 202) — must emit recipe.indexed/removed
- `src/lib/config.ts` — dataDir resolution (line 12-19)
- `src/app/api/tasks/route.ts` — POST task pattern (line 174-475); Zod aggregated-issue response pattern
- `src/app/api/tasks/[id]/route.ts` — PUT task + token revoke on terminal transition (line 575-584)
- `src/app/api/tasks/[id]/comments/route.ts` — existing `src/app/api/tasks/[id]/...` route convention
- `src/app/api/runner/tasks/[task_id]/submit/route.ts` — runner-token route pattern (line 30-80)
- `src/app/api/runner/tasks/[task_id]/runner-exit/route.ts` — runner-secret route pattern; retry/fail state machine (line 182-260)
- `src/app/api/runner/tasks/[task_id]/container-started/route.ts` — needs `task.container_started` emission addition
- `src/app/api/runner/heartbeat/route.ts` — heartbeat metadata schema (line 31-35) supports inventory embedding
- `src/app/api/events/route.ts` — SSE opaque pass-through (line 30-40); workspace_id filter
- `scripts/mc-runner.mjs` — daemon activeTasks Map (line 443), SSE handler (line 623-676), docker stop timeout (line 1071)
- `.planning/phases/15-checkpoints-scheduler-v1-2/15-CONTEXT.md` — all locked decisions
- `.planning/REQUIREMENTS.md:174-213` — CP-01..06 + SCHED-01..06 acceptance text
- `vitest.config.ts` — test environment and thresholds
- `package.json` — dependency versions (better-sqlite3 12.6, zod 4.3, next 16.1, chokidar 5)

### Secondary (MEDIUM confidence)

- `src/lib/runner-claim.ts` — claim route helpers; worktree_path composition at line 265 of claim route
- `src/lib/__tests__/migrations-v12-runtime.test.ts` — migration test pattern
- `.planning/STATE.md` — Phase 11-14 decision history (lines 121-231)

### Tertiary (LOW confidence)

- POSIX O_APPEND atomicity: cited as HIGH behavior but without a specific man-page citation in this research; planner should spot-verify with a stress test if concurrent POSTs matter.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every file/line cited; version numbers from package.json
- Architecture: HIGH — all file paths concrete; handler shapes replicable from existing routes
- Pitfalls: HIGH — all derive from the existing code substrate, not external speculation

**Research date:** 2026-04-20
**Valid until:** 30 days (2026-05-20) — stable substrate; no external API dependencies
