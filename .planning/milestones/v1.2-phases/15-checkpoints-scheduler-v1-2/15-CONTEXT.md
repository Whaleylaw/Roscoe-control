# Phase 15: Checkpoints & Scheduler Integration — Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 15 closes the v1.2 control loop between agents and Mission Control:

1. **Checkpoints API** — Agents authenticated with a `runner-token` post structured progress events to `POST /api/tasks/:id/checkpoints`. Each checkpoint persists to BOTH the `task_checkpoints` DB table AND the worktree journal at `<host-worktree>/.mc/checkpoints.jsonl`. Viewers fetch the timeline via `GET /api/tasks/:id/checkpoints?attempt=N`.
2. **Blocker flow** — A `status: blocked` checkpoint flips the task `in_progress → awaiting_owner`, posts an automatic comment with the `blocker_reason`, and gracefully stops the container while preserving the worktree. When the owner moves the task back to `assigned`, the runner relaunches via the resume path.
3. **Scheduler integration** — `autoRouteInboxTasks()`, `dispatchAssignedTasks()`, and `requeueStaleTasks()` all learn about recipe-tagged tasks. A new `reconcileRunnerHeartbeat()` tick catches stale runners. `task.runner_requested` is emitted from all three intended emission points, and the new `recipe.*` and `task.*` events broadcast on SSE for Phase 16's UI to consume.

**Out of scope (other phases):**
- Any UI surface that consumes these events — Progress tab, recipe badge, runner-status banner, recipe list panel (Phase 16, RUI-01..06).
- New recipe authoring tooling beyond what the indexer already supports.
- Changes to checkpoint shape that would break the agent contract written in Phase 14's hello-world recipe.

</domain>

<decisions>
## Implementation Decisions

### Blocker & Resume Flow

- **Auto-comment author = `system`.** The auto-comment posted on `status: blocked` is authored by the `system` principal (machine-generated). Owners must not see a human sender they might @reply.
- **Graceful stop = `docker stop --time=15`.** Reuse Phase 14's exact stop pattern: SIGTERM → 15s grace → SIGKILL. Emit `task.container_exited` with `reason='blocked'`. Worktree and `.mc/` are preserved (never pruned on a blocker).
- **Resume trigger = re-emit `task.runner_requested` from the `assigned`-transition.** When the owner moves a blocked task back to `assigned`, the existing SCHED-05 emission path takes over — daemon claims, attempt counter increments, `progress.md` and `checkpoints.jsonl` are preserved, `prior_attempts` gets the previous attempt appended, `task.json` is rewritten with `is_resuming=true`. **No new `/api/tasks/:id/resume` endpoint.** Phase 14's seedMcDir already does the right thing.
- **Resume context = progress.md marker line.** When the runner seeds the resumed `.mc/` dir, it appends a single visible marker line to `progress.md`:
  ```
  <iso-ts> | <<< RESUMED AFTER BLOCKER: <blocker_reason> >>>
  ```
  No new env vars (`MC_RESUMED_FROM_BLOCKER` etc.) — agent preambles already read `progress.md`, so they naturally see the blocker reason without expanding the runtime env surface.

### Checkpoint Persistence Contract

- **Atomic DB + JSONL writes — any failure returns 500.** The endpoint MUST treat the DB insert and the JSONL append as a single logical write. If either fails, the POST returns `500` and the partially-written side is rolled back (DB transaction rolled back; JSONL line not flushed or compensated). No 200-with-warning fallback. Implementation pattern: open the DB transaction, append JSONL inside the transaction's try block, commit only after both succeed; on any error, rollback DB and unlink the JSONL line if it landed.
- **Server writes the canonical JSONL.** The `POST /api/tasks/:id/checkpoints` handler writes `<host-worktree>/.mc/checkpoints.jsonl` from server-side using the `worktree_path` already persisted on `tasks` (RUNNER-09 / Phase 14 SC3). The agent's in-container `fs.appendFileSync('/workspace/.mc/checkpoints.jsonl', ...)` call from Phase 14's hello-world recipe REMAINS in place as a local pre-post audit — the host's `.mc/checkpoints.jsonl` and the in-container one will both be on disk, but the host file (server-written) is the canonical record. Recipes do NOT need to change behavior.
- **JSONL line shape = POST body + server-generated metadata.** Each line is one JSON object containing all POST body fields (`step`, `summary`, `status`, `artifacts`, `next_step`, `blocker_reason`, `tokens_used`, `duration_ms`) PLUS server-generated `id`, `attempt`, `task_id`, `ts` (ISO-8601). The line is reconstructible into the DB row without joins.
- **Artifact validation = strict per-kind via Zod discriminated union.**
  - `kind: 'file'` → `path` required (relative to worktree)
  - `kind: 'url'` → `url` required (any string accepted; no http(s) restriction at v1.2)
  - `kind: 'diff'` → `ref` OR `path` required
  - `kind: 'test_result'` → at least one of `path`, `url`, `summary`
  - `kind: 'comment'` → `summary` required
  - `kind: 'other'` → all fields optional
  - Unknown `kind` → 400 with the discriminator error.

### Heartbeat & Stale Detection

- **Stale window = 90s (fixed, not configurable).** Reconcile tick runs every 30s; stale threshold = 3× tick = 90s. This is the standard liveness multiplier (matches Kubernetes-style defaults). Not exposed as a runtime setting in v1.2 — revisit only if real-world WAN deployments demand it.
- **Stale-runner action on in_progress recipe-tasks: flip back to `assigned`.** Symmetric with the blocker-resume path and the runner-exit `reason='crash'` path. `task.runner_requested` is re-emitted; the daemon claims fresh; attempt counter increments; `.mc/` preserved. NOT moved to `awaiting_owner` (that would create noise during transient runner restarts).
- **Container liveness probe = heartbeat + runner-inventory query.** `requeueStaleTasks()` for recipe-tagged tasks combines:
  1. Stale-runner check (shared with `reconcileRunnerHeartbeat()`).
  2. For runners that ARE alive, query the runner via a new runner-protocol endpoint (e.g., `GET /api/runner/inventory` authenticated by `runner` principal) that returns the runner's currently-tracked task IDs. Tasks the MC believes are `in_progress` on a live runner that the runner does NOT report as active are stuck → flipped to `assigned`.
  3. **MC server does NOT shell out to `docker inspect`** — no Docker socket coupling between MC server and runner host.
- **Reconnect recovery = runner reconcile-on-boot + selective re-emission.** When a previously-stale runner heartbeats again, MC compares `assigned` recipe-tasks against the runner's reported inventory; for any task the runner doesn't have, MC re-emits `task.runner_requested`. Daemon's claim path is idempotent (runner-token mint guards), so duplicate emissions are safe.

### Checkpoint Endpoint Auth Path (added 2026-04-20 after research)

- **POST path = literal `/api/tasks/:id/checkpoints`.** To preserve the roadmap success criterion path, the planner MUST extend `RUNNER_TOKEN_ALLOWLIST` in `src/lib/runner-tokens.ts` to include `POST /api/tasks/:id/checkpoints`. Do NOT relocate the POST under `/api/runner/*` and do NOT refactor the runner-token path scope more broadly. The allowlist was designed for exactly this kind of targeted extension.
- **GET path = same route module.** `GET /api/tasks/:id/checkpoints?attempt=N` is viewer-authed via the standard `requireRole` flow — same `route.ts` file, two exported handlers (GET + POST) with different auth requirements.

### Event Emission & SSE Fan-out

- **`task.runner_requested` dedup policy: emit-on-every-transition, daemon dedupes.** Each of the three SCHED-05 emission points (`autoRouteInboxTasks` on `inbox→assigned`, `POST /api/tasks` direct-assigned creation with `recipe_slug`, runner-exit retry path on `in_progress→assigned`) emits unconditionally. The daemon's claim path is idempotent (runner-token mint by `task_id+attempt` is the natural guard), so duplicate consume is safe. **No server-side suppression window or scheduler-tick coalescing.**
- **SSE channel scope = single global stream, client-side filter.** All `task.*` and `recipe.*` events broadcast on the existing `/api/events` endpoint via `event-bus.ts`. Phase 16 UI filters by event type and `task_id` client-side. **No new per-task SSE endpoints, no topic-based subscriptions.** Matches Mission Control's existing SSE pattern.
- **No throttling for `task.checkpoint_added` in v1.2.** Recipes are expected to checkpoint at meaningful step boundaries, not per-token. Premature throttling. If a chatty recipe surfaces, add a coalescer in v1.3.
- **Compat policy: additive-only.** Phase 15 only ADDS event types. No existing event renamed or removed. Existing clients ignore unknown types per the current pattern. Phase 16 listeners opt in explicitly.

### Claude's Discretion

The following are NOT locked by this CONTEXT.md — planner picks the implementation:

- **Exact route file paths.** Pattern follows existing `src/app/api/tasks/[id]/...` conventions.
- **Migration file naming and SQL detail** — `task_checkpoints` table shape (PK, columns, indexes) beyond what Phase 11's migration already created. Planner verifies the existing schema and adds only what's missing.
- **Runner-inventory endpoint contract** — exact path (suggest `GET /api/runner/inventory`), response shape (suggest `{ tasks: [{ task_id, attempt, container_id, started_at }] }`), and how the daemon populates it from its existing in-memory tracking.
- **Auto-comment template wording** beyond "system-authored, includes blocker_reason verbatim, references attempt number."
- **Test naming, Vitest organization, and whether RTEST integration tests live with this phase or wait for the broader v1.2 RTEST sweep** (RTEST-01..04 are listed in REQUIREMENTS.md but NOT in Phase 15's requirement IDs — planner decides whether to seed unit tests for the new modules now or defer the integration tests).
- **`GET /api/tasks/:id/checkpoints` pagination/filtering** beyond the required `?attempt=N` filter — planner picks default ordering (likely `attempt ASC, ts ASC`) and any additional `?since=<ts>` or `?status=` query params.
- **Idempotency mechanism for retried POSTs** (e.g., client_token field) — not requested by any success criterion. Planner may add if cheap; otherwise defer.

</decisions>

<specifics>
## Specific Ideas

- **Reuse Phase 14's `docker stop --time=15`** literally — same call site, same timeout. Don't introduce a different stop policy.
- **Reuse Phase 14's `worktree_path` on `tasks`** (persisted by RUNNER-09 / 14-claim) for the host-side JSONL append — no new lookup needed.
- **Reuse Phase 14's `task.runner_requested` SSE subscriber** in the daemon — already wired, just emitting from MC for the first time in Phase 15.
- **Reuse Phase 14's `runner_heartbeats` table** (with `idx_runner_heartbeats_last`) for the 90s stale window query.
- **Reuse Phase 14's `seedMcDir(is_resuming=true)`** path for the blocker→resume flow — preserves `progress.md` and `checkpoints.jsonl`, rewrites `task.json`, defensive empty-file fallback.
- **Reuse Phase 14's `runner-token` mint pattern** for the new POST /checkpoints endpoint auth (RAUTH-02..06 already done).
- **Auto-comment goes through the existing comments table/API** — no new comment surface.

</specifics>

<deferred>
## Deferred Ideas

- **Configurable stale window** (`runtime.runner_heartbeat_stale_seconds`) — defer to v1.3 if a long-RTT deployment asks. Phase 15 ships fixed 90s.
- **Per-task SSE endpoint** (`/api/tasks/:id/events`) — defer; global stream + client filter is sufficient through v1.2.
- **`task.checkpoint_added` throttling/coalescing** — defer until a chatty recipe creates real load.
- **HTTPS enforcement on `kind: 'url'` artifacts** — defer; agents may emit internal http URLs intentionally.
- **Path-safety validation** (reject `..` paths or absolute paths inside artifact `path` fields) — defer; agents are run by us, not untrusted users. Add when we accept third-party recipes.
- **Idempotency token on POST /checkpoints** — defer unless the planner finds a cheap way to add it; no success criterion requires it.

</deferred>

---

*Phase: 15-checkpoints-scheduler-v1-2*
*Context gathered: 2026-04-20*
