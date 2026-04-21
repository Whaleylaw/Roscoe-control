# Phase 14: Runner Daemon & Container Execution (v1.2) — Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 14 delivers a standalone `scripts/mc-runner.mjs` daemon that:

1. Registers with Mission Control using `.data/runner.secret` and a 10-second heartbeat (offline at 60s silence).
2. Subscribes to `task.runner_requested` SSE events with a 15-second poll fallback (`GET /api/runner/ready-tasks`).
3. Atomically claims tasks via `POST /api/runner/claim/:task_id`, receiving a dispatch payload (recipe content + fresh per-task runner-token).
4. Re-validates every mount at claim time using `validateHostPathAgainstAllowlist` from `@/lib/task-runtime-validation` (symlink-resolved, defense-in-depth against the check already done at task creation).
5. Enforces global (`MAX_CONCURRENT_CONTAINERS`) and per-recipe (`max_concurrent`) concurrency caps; over-cap claims return 409.
6. For `workspace: worktree` recipes, creates or reuses a git worktree at `.data/runner/worktrees/task-<id>/`, seeds `.mc/` (task.json, progress.md, checkpoints.jsonl, .gitignore), and writes `worktree_path` onto the task.
7. Launches the container via `docker run --rm -d` with the documented mount / env / label layout, writes a runner-authored `/recipe/PREAMBLE.md` at claim time, and streams stdout/stderr to `.data/runner/logs/task-<id>/attempt-<n>/`.
8. Enforces `recipe.timeout_seconds` via hard kill; posts `runner-exit` on non-zero exit or timeout; drives MC retry/fail with `runner_max_attempts` (default 3, recipe-overridable).
9. Preserves worktrees across container crashes/retries; destroys on terminal `done`/`cancelled`, or after a GC window (default 7 days) on `failed`; a runner-side 10-minute GC tick handles cleanup.
10. After a runner crash, reconciles `docker ps` output (filter `label=mc.task_id`) against `GET /api/runner/pending-containers` and either adopts or cleans up; revokes the per-task runner-token when the task reaches terminal state.
11. Ships the `mc-hello-world-agent` reference image (`docker/hello-world-agent/`) and a companion recipe (`recipes/hello-world/`) that exercises the full container contract end-to-end.

**Not in Phase 14:** checkpoint HTTP endpoint (Phase 15), scheduler event emission (Phase 15), UI surfaces (Phase 16), integration/E2E test suite (Phase 17).

</domain>

<decisions>
## Implementation Decisions

### Agent Preamble

- **Tone / length:** Verbose with concrete examples (≈ 30–50 lines for first-attempt, ≈ 45 lines for resume). Preamble includes a sample progress.md entry, a sample checkpoints.jsonl line, and an HTTP skeleton for `POST /api/runner/checkpoint`.
- **Tool-agnostic:** Preambles do NOT assume Claude Code or any specific agent runtime. Phrasing uses generic "read this file", "run this command", "POST to this URL". Contract is file-system + HTTP + env vars.
- **Checkpoint API reference:** Preamble copy forward-references `POST {MC_API_URL}/api/runner/checkpoint` even though the endpoint ships in Phase 15. Phase 14 hello-world does NOT call it; Phase 15 wires it live and the preamble copy stays stable.
- **Injection mechanism:** Runner writes `/recipe/PREAMBLE.md` at claim time into a runner-owned mount. The authored SOUL.md is never mutated. Agent reading order: PREAMBLE.md → SOUL.md → `/workspace/.mc/*`.
- **Signalling:** Runner sets env var `MC_PREAMBLE_PATH=/recipe/PREAMBLE.md`. Reference images and recipe entrypoints are documented to read `$MC_PREAMBLE_PATH` before SOUL.md when set.
- **Resume variants:** One resume preamble for all failure modes. Richness (crash / timeout / blocked-checkpoint) is surfaced via `.mc/task.json.prior_attempts[]` (each entry carries `started_at`, `exit_code`, `failure_reason`). Preamble tells the agent "read task.json and react accordingly".
- **Resume preamble content:** Mandatory first steps are read task.json → read progress.md → read checkpoints.jsonl → run `git status` + `git log --oneline` in `/workspace` → re-read SOUL.md. Reconciliation rules: trust git over progress.md on conflict; if prior attempt finished but failed to submit, submit now; append new notes under `## attempt {n}` header.

### Reference Image (`mc-hello-world-agent`)

- **Location:** `docker/hello-world-agent/` at repo root (Dockerfile + `agent.mjs` + README.md). New top-level `docker/` directory reserved for bundled runtime images.
- **Companion recipe:** `recipes/hello-world/` with `recipe.yaml` (image: `mc-hello-world-agent:latest`, workspace: `worktree`) and SOUL.md (short: "say hello, emit a checkpoint, done").
- **Base image:** `node:22-alpine` — matches MC server runtime; Node built-in fetch + fs; no extra deps in the Dockerfile.
- **Agent behavior (Phase 14 scope):**
  1. Log env vars present (MC_TASK_ID, MC_API_URL, MC_API_TOKEN, MC_MODEL_PRIMARY, MC_PREAMBLE_PATH).
  2. Read `$MC_PREAMBLE_PATH` and `/recipe/SOUL.md`.
  3. Append a timestamped line to `/workspace/.mc/progress.md`.
  4. Append a JSON line to `/workspace/.mc/checkpoints.jsonl` (file write; HTTP checkpoint call added in Phase 15).
  5. Commit a `HELLO.md` file into `/workspace` using `git -C /workspace commit`.
  6. `PUT {MC_API_URL}/api/tasks/{MC_TASK_ID}` with `Authorization: Bearer {MC_API_TOKEN}` and `{ "status": "done" }` — uses the existing Phase-13 handler + Phase-11-04 runner-token.
  7. `process.exit(0)`.
- **Phase 14 does NOT call `/api/runner/checkpoint`** — that endpoint lands in Phase 15. The Phase-15 update to `agent.mjs` will insert the HTTP POST between steps 4 and 5 while leaving every other step unchanged.
- **Build story:** Phase 14 ships source + a build script (e.g., `docker/hello-world-agent/build.sh`, or a `pnpm mc:build-hello-world` npm script) that runs `docker build -t mc-hello-world-agent:latest .`. No registry push. Operator runs the build once; re-runs after source edits.

### On-Disk Layout & Retention

- **Worktree:** `.data/runner/worktrees/task-<id>/` — ONE worktree per task, reused across all attempts. Attempt counter lives in `.mc/task.json.attempt` and is bumped at the start of each new attempt. Git state persists across attempts (required by RUNNER-12 / WORK-03).
- **Logs:** `.data/runner/logs/task-<id>/attempt-<n>/{stdout.log, stderr.log, meta.json}`. `meta.json` carries `started_at`, `exited_at`, `exit_code`, `reason`. No mid-run rotation; logs grow unbounded within a single attempt.
- **Convenience symlink:** Inside each `task-<id>/` log dir, `latest → attempt-<n>/`. Runner updates the symlink on every attempt start. Enables `tail -f .data/runner/logs/task-42/latest/stderr.log`.
- **Retention policy:**
  - Task reaches `done` or `cancelled` → destroy worktree AND logs immediately on detection.
  - Task reaches `failed` → keep both for GC window (`RUNNER_FAILED_GC_WINDOW_DAYS`, default 7).
  - Destroy sequence: `git worktree remove --force <path>` then `rm -rf <logs/task-<id>/>`.
- **GC driver:** Runner-side 10-minute tick. On startup, run GC immediately (catches terminal transitions missed during downtime). No MC-side cron in Phase 14; scheduler-driven GC is a Phase 15+ concern.
- **GC query shape:** `GET /api/runner/terminal-tasks?since=<iso8601>` returns `{task_id, status, terminal_at}` for terminal tasks since the timestamp. Runner tracks its last-scan timestamp locally.

### Container Lifecycle

- **Name:** `mc-task-<task_id>-a<attempt>` (e.g., `mc-task-42-a3`). Human-readable in `docker ps`. Container is `--rm` so name is reusable across attempts if a prior one cleaned up.
- **Labels:** `mc.task_id`, `mc.recipe_slug`, `mc.attempt`, `mc.runner_id`, `mc.runner_started_at` (ISO 8601). `mc.*` label prefix reserved for Mission Control.
- **Reconciliation discovery:** `docker ps -a --filter label=mc.task_id` at runner startup; cross-reference with `GET /api/runner/pending-containers`. Adopt vs kill decision tree is Claude's discretion (default suggestion: adopt if task status ∈ {assigned, running}; kill otherwise).
- **Resource caps — precedence (high to low):**
  1. `task.resource_override` — reserved, NOT in Phase 14.
  2. `recipe.memory_limit` / `recipe.cpu_limit` — per-recipe override.
  3. Runner default — 2 GB memory, 1.0 CPU.
- **Admin ceilings (MC settings, admin-only):** `MAX_MEMORY_PER_CONTAINER` (default `8g`), `MAX_CPU_PER_CONTAINER` (default `4.0`). Claim-time rejection if a recipe's declared limit exceeds the ceiling.
- **Network:** Default bridge network + `--add-host host.docker.internal:host-gateway`. `MC_API_URL=http://host.docker.internal:3000` (or the configured port). Container reaches MC via the host-gateway alias; reaches the wider internet via the default bridge. No egress allow-list in Phase 14; `recipe.network.allow_hosts` field is reserved for a later phase.
- **Docker daemon down at startup:**
  - Runner runs `docker info` during boot, step 2 (after reading `.data/runner.secret`, before reconciliation).
  - On failure: log `Docker daemon unreachable at <socket>. Start Docker and re-launch the runner.` to stderr, then `process.exit(2)`.
  - LaunchAgent plist uses `KeepAlive` + `ThrottleInterval 30` to retry with backoff.
  - Heartbeats never start — MC sees a clean "offline" signal, not a "degraded" state. No mid-run degradation state in Phase 14.
- **Boot sequence:**
  1. Read `.data/runner.secret` (fail → exit 1, distinct from Docker-down).
  2. `docker info` (fail → log + exit 2).
  3. Reconcile orphaned containers via labels + `GET /api/runner/pending-containers`.
  4. Register with MC (start heartbeat).
  5. Subscribe SSE to `task.runner_requested` + start 15-second poll fallback.
  6. Start 10-minute GC tick.

### Claude's Discretion

- Reconciliation adopt-vs-kill decision tree (only the discovery mechanism is locked).
- Exact shape of runner identity (`runner_id`) — single runner in Phase 14, but the label schema is ready for multi-runner.
- LaunchAgent plist contents — standard template, Claude to draft.
- SSE reconnection policy (backoff, max attempts) — standard exponential backoff acceptable.
- Secrets store layout for recipe-declared secrets (e.g., `ANTHROPIC_API_KEY`) — file-based under `.data/runner/secrets/` is acceptable; UI surface is Phase 16.
- Exact wording of the preamble (subject to meeting the tone/length/forward-reference requirements above).
- How the runner composes the container env from `recipe.env` + `recipe.secrets` + MC_* system vars (single merge pass is fine).
- Whether `docker/hello-world-agent/build.sh` is a shell script or a `pnpm` npm script — either is acceptable.

</decisions>

<specifics>
## Specific Ideas

- **Reuse from Phase 13:** Runner MUST import `validateHostPathAgainstAllowlist` from `@/lib/task-runtime-validation` for claim-time mount re-validation. `TASK_RUNTIME_ERROR_CODES` from Phase 13 is the shared error vocabulary for allowlist/cap failures at the claim surface (matches the codes already returned by `POST /api/tasks` and `PUT /api/tasks/[id]`).
- **Reuse from Phase 12:** `getIndexedRecipeBySlug` is the sole path for loading recipe content at claim time; no direct filesystem reads of `recipes/<slug>/recipe.yaml` from the runner or claim route. JSON-column deserialisation (env_json → env, etc.) lives behind that function.
- **Reuse from Phase 11:**
  - Runner-token principal uses `id = -2000` sentinel; runner-secret principal uses `id = -1000`. Claim-route and checkpoint-route handlers dispatch on `user.id === -2000` vs `-1000`.
  - Atomic terminal revocation is already wired in the shared `db.transaction` that updates task status (Phase 11-04). Phase 14 runner code simply issues the status-update HTTP request; revocation happens server-side in the same transaction.
  - `task_runner_tokens`, `task_checkpoints`, and the 11 new task columns (including `worktree_path`, `runner_attempts`, `runner_last_failure_reason`, `container_id`, `runner_started_at`, `runner_exit_code`, `workspace_source`, `read_only_mounts`, `extra_skills`, `runner_max_attempts`, `recipe_slug`, `model_override`) exist as of migrations 054-057.
- **`.mc/task.json` shape (locked by WORK-02):**
  ```json
  {
    "task_id": "<id>",
    "recipe_slug": "<slug>",
    "attempt": 3,
    "is_resuming": true,
    "prior_attempts": [
      { "started_at": "2026-04-20T14:03:00Z", "exit_code": 137, "failure_reason": "container_oom" },
      { "started_at": "2026-04-20T14:11:00Z", "exit_code": null, "failure_reason": "timeout" }
    ]
  }
  ```
- **`.mc/.gitignore`:** `*` — the entire `.mc/` dir is ignored from the task's git history; runner state is not part of the agent's deliverable.
- **Container env var budget:** `MC_API_URL`, `MC_TASK_ID`, `MC_API_TOKEN`, `MC_WORKSPACE`, `MC_RECIPE_PATH`, `MC_PREAMBLE_PATH`, `MC_MODEL_PRIMARY`, `MC_MODEL_FALLBACK` (optional), `MC_MODEL_PROVIDER`, `MC_MODEL_PARAMS_JSON`, plus recipe-declared secrets. `MC_MODEL_PRIMARY` resolved at claim time as `task.model_override ?? recipe.model.primary` (MODEL-04).

</specifics>

<deferred>
## Deferred Ideas

- **Runner secrets UI / management surface** — file-based `.data/runner/secrets/` is fine for Phase 14; operator-facing UI ships in Phase 16 (RUI-xx).
- **`task.resource_override`** — label reserved in the resource-caps precedence, but not implemented in Phase 14.
- **`recipe.network.allow_hosts` enforcement** — field can be declared in recipes but is NOT enforced in Phase 14; enforcement belongs to a later security phase.
- **Multi-runner support** — label schema is ready (`mc.runner_id`), but Phase 14 assumes a single runner per MC instance. Multi-runner coordination (which runner claims? how do they share concurrency caps?) is out of scope.
- **MC-side GC cron** — Phase 14 uses runner-side ticks exclusively. A scheduler-driven GC event is a Phase 15+ refinement.
- **Mid-run log rotation** — unbounded stdout/stderr is a known risk; rotation is a future concern if operators hit it in practice.
- **"Degraded" runner state** — Phase 14 is binary: runner is up (heartbeating) or down (process exited). Any future "up but Docker unavailable" signalling is deferred.
- **`MC_HELLO_MODE` test-mode switch** on the reference image (fail / timeout / blocked variants) — useful for Phase 17 integration testing; not shipping in Phase 14.
- **Blocked-checkpoint resume preamble variant** — considered and rejected for Phase 14; the single resume preamble + `.mc/task.json.prior_attempts[]` is sufficient. Revisit if Phase 15 scheduler makes blocked-checkpoint resumes qualitatively different.

</deferred>

---

*Phase: 14-runner-container-v1-2*
*Context gathered: 2026-04-20 via /gsd:discuss-phase*
