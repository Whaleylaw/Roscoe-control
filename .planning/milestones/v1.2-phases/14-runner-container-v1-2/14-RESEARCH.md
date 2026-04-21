# Phase 14: Runner Daemon & Container Execution (v1.2) - Research

**Researched:** 2026-04-20
**Domain:** Standalone Node daemon + Docker container orchestration + git worktree lifecycle + SSE claim protocol
**Confidence:** HIGH (substrate) / MEDIUM (container mechanics) — HIGH-confidence surfaces already shipped in Phases 11–13; the new runner-process code paths (child_process against `docker` + `git worktree`, SSE consumer, LaunchAgent) are mechanical and well-supported but need faithful implementation

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Agent Preamble**

- **Tone / length:** Verbose with concrete examples (≈ 30–50 lines for first-attempt, ≈ 45 lines for resume). Preamble includes a sample progress.md entry, a sample checkpoints.jsonl line, and an HTTP skeleton for `POST /api/runner/checkpoint`.
- **Tool-agnostic:** Preambles do NOT assume Claude Code or any specific agent runtime. Phrasing uses generic "read this file", "run this command", "POST to this URL". Contract is file-system + HTTP + env vars.
- **Checkpoint API reference:** Preamble copy forward-references `POST {MC_API_URL}/api/runner/checkpoint` even though the endpoint ships in Phase 15. Phase 14 hello-world does NOT call it; Phase 15 wires it live and the preamble copy stays stable.
- **Injection mechanism:** Runner writes `/recipe/PREAMBLE.md` at claim time into a runner-owned mount. The authored SOUL.md is never mutated. Agent reading order: PREAMBLE.md → SOUL.md → `/workspace/.mc/*`.
- **Signalling:** Runner sets env var `MC_PREAMBLE_PATH=/recipe/PREAMBLE.md`. Reference images and recipe entrypoints are documented to read `$MC_PREAMBLE_PATH` before SOUL.md when set.
- **Resume variants:** One resume preamble for all failure modes. Richness (crash / timeout / blocked-checkpoint) is surfaced via `.mc/task.json.prior_attempts[]` (each entry carries `started_at`, `exit_code`, `failure_reason`). Preamble tells the agent "read task.json and react accordingly".
- **Resume preamble content:** Mandatory first steps are read task.json → read progress.md → read checkpoints.jsonl → run `git status` + `git log --oneline` in `/workspace` → re-read SOUL.md. Reconciliation rules: trust git over progress.md on conflict; if prior attempt finished but failed to submit, submit now; append new notes under `## attempt {n}` header.

**Reference Image (`mc-hello-world-agent`)**

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

**On-Disk Layout & Retention**

- **Worktree:** `.data/runner/worktrees/task-<id>/` — ONE worktree per task, reused across all attempts. Attempt counter lives in `.mc/task.json.attempt` and is bumped at the start of each new attempt. Git state persists across attempts (required by RUNNER-12 / WORK-03).
- **Logs:** `.data/runner/logs/task-<id>/attempt-<n>/{stdout.log, stderr.log, meta.json}`. `meta.json` carries `started_at`, `exited_at`, `exit_code`, `reason`. No mid-run rotation; logs grow unbounded within a single attempt.
- **Convenience symlink:** Inside each `task-<id>/` log dir, `latest → attempt-<n>/`. Runner updates the symlink on every attempt start. Enables `tail -f .data/runner/logs/task-42/latest/stderr.log`.
- **Retention policy:**
  - Task reaches `done` or `cancelled` → destroy worktree AND logs immediately on detection.
  - Task reaches `failed` → keep both for GC window (`RUNNER_FAILED_GC_WINDOW_DAYS`, default 7).
  - Destroy sequence: `git worktree remove --force <path>` then `rm -rf <logs/task-<id>/>`.
- **GC driver:** Runner-side 10-minute tick. On startup, run GC immediately (catches terminal transitions missed during downtime). No MC-side cron in Phase 14; scheduler-driven GC is a Phase 15+ concern.
- **GC query shape:** `GET /api/runner/terminal-tasks?since=<iso8601>` returns `{task_id, status, terminal_at}` for terminal tasks since the timestamp. Runner tracks its last-scan timestamp locally.

**Container Lifecycle**

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

### Deferred Ideas (OUT OF SCOPE)

- **Runner secrets UI / management surface** — file-based `.data/runner/secrets/` is fine for Phase 14; operator-facing UI ships in Phase 16 (RUI-xx).
- **`task.resource_override`** — label reserved in the resource-caps precedence, but not implemented in Phase 14.
- **`recipe.network.allow_hosts` enforcement** — field can be declared in recipes but is NOT enforced in Phase 14; enforcement belongs to a later security phase.
- **Multi-runner support** — label schema is ready (`mc.runner_id`), but Phase 14 assumes a single runner per MC instance. Multi-runner coordination (which runner claims? how do they share concurrency caps?) is out of scope.
- **MC-side GC cron** — Phase 14 uses runner-side ticks exclusively. A scheduler-driven GC event is a Phase 15+ refinement.
- **Mid-run log rotation** — unbounded stdout/stderr is a known risk; rotation is a future concern if operators hit it in practice.
- **"Degraded" runner state** — Phase 14 is binary: runner is up (heartbeating) or down (process exited). Any future "up but Docker unavailable" signalling is deferred.
- **`MC_HELLO_MODE` test-mode switch** on the reference image (fail / timeout / blocked variants) — useful for Phase 17 integration testing; not shipping in Phase 14.
- **Blocked-checkpoint resume preamble variant** — considered and rejected for Phase 14; the single resume preamble + `.mc/task.json.prior_attempts[]` is sufficient. Revisit if Phase 15 scheduler makes blocked-checkpoint resumes qualitatively different.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RUNNER-01 | Standalone Node runner daemon (`scripts/mc-runner.mjs`) + LaunchAgent template | Scripts/CLI precedent: `scripts/mc-cli.cjs` + `scripts/mc-mcp-server.cjs` show the .cjs/.mjs convention. New file: `scripts/mc-runner.mjs`. LaunchAgent plist per Apple docs + ThrottleInterval pattern (see Standard Stack) |
| RUNNER-02 | Register with MC using shared `.data/runner.secret` | Substrate READY: `src/lib/runner-secret.ts` exports `getRunnerSecret()`; `src/lib/auth.ts` runner-secret branch (id=-1000) already dispatches `/api/runner/*` to operator-level auth. Runner sends `Authorization: Bearer <secret>` |
| RUNNER-03 | Subscribe to `task.runner_requested` SSE events | SSE endpoint exists: `GET /api/events` streams `ServerEvent` via `eventBus.broadcast`. EventBus type union in `src/lib/event-bus.ts` does NOT yet include `task.runner_requested` — Phase 15 adds emission (per roadmap SCHED-05). Phase 14 runner SHOULD subscribe defensively (subscription works even if events aren't yet fired). Consumer pattern in `scripts/mc-cli.cjs` lines 240–301 shows the full SSE reader with `fetch` + `ReadableStream` |
| RUNNER-04 | 15-second poll fallback `GET /api/runner/ready-tasks` | NEW endpoint. Query shape: `SELECT * FROM tasks WHERE status = 'assigned' AND recipe_slug IS NOT NULL AND container_id IS NULL`. Auth: runner-secret (`/api/runner/*` + id=-1000 operator) |
| RUNNER-05 | 10-second heartbeat; MC offline at 60s silence | NEW `POST /api/runner/heartbeat`. Agent-heartbeat precedent: `src/app/api/agents/[id]/heartbeat/route.ts` (different semantics but useful pattern). Offline signal: SSE broadcast new event `runner.status_changed` when DB `last_heartbeat_at` exceeds threshold — but banner ships in Phase 16, so Phase 14 can just persist `last_heartbeat_at` in a new `runner_heartbeats` row (single-row table) and the Phase 15 scheduler (`reconcileRunnerHeartbeat`) reads it |
| RUNNER-06 | Atomic claim via `POST /api/runner/claim/:task_id`, returns dispatch payload | NEW endpoint. Dispatch payload = recipe content from `getIndexedRecipeBySlug` + task row + runner-token from `issueRunnerToken` (src/lib/runner-tokens.ts already exists, expiry = `runner_started_at + timeout_seconds + 60`). Claim must be atomic: `UPDATE tasks SET status='in_progress', container_id = ?, runner_started_at = ?, runner_attempts = runner_attempts + 1 WHERE id = ? AND status = 'assigned' AND container_id IS NULL`. `result.changes === 0` → 409 |
| RUNNER-07 | Re-validate mount paths at claim with allowlist + symlink resolution | REUSE `validateHostPathAgainstAllowlist` from `src/lib/task-runtime-validation.ts`. Same surface as Phase 13 POST/PATCH handlers. Emit errors through `buildAggregatedValidationResponse` + `TASK_RUNTIME_ERROR_CODES`. STATE.md 2026-04-20 lock: "Phase 14 runner MUST import validateHostPathAgainstAllowlist" |
| RUNNER-08 | Global + per-recipe concurrency caps; 409 on overage | Global cap: new setting `runtime.max_concurrent_containers` (default 4). Per-recipe cap: `recipe.max_concurrent` (column exists — migration 054). Enforcement query: `SELECT COUNT(*) FROM tasks WHERE status = 'in_progress' AND container_id IS NOT NULL` and same filtered by recipe_slug. 409 response per `TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED` |
| RUNNER-09 | Create/reuse git worktree; seed `.mc/` directory | `git worktree add`. ONE worktree per task (CONTEXT.md locks). Workspace source = `task.workspace_source.{project_id, base_ref}`. **OPEN QUESTION**: `projects` table has `github_repo` but NO `local_path` column — see Open Questions #1. `.mc/` seeding is straightforward `fs.mkdirSync` + `fs.writeFileSync` |
| RUNNER-10 | `docker run --rm -d` with mount layout + env vars + stream logs | `node:child_process.spawn('docker', ['run', ...], { detached: false, stdio: [...file descriptors] })`. For `--rm -d` detached pattern: capture container_id from stdout; use `docker inspect` + polling for status (OR `docker events --filter container=<id>` stream) to detect exit. Log streaming: `docker logs -f <id>` spawned with `stdio: ['ignore', logFd, errFd]` |
| RUNNER-11 | Wait for container exit, post `runner-exit`, MC drives retry/fail | NEW endpoint `POST /api/runner/tasks/:task_id/runner-exit` (or reuse `/api/runner/tasks/:task_id/fail` from RAUTH-06 allowlist — BUT allowlist is runner-TOKEN not runner-SECRET. Runner-secret daemon should post via a separate route, not via runner-token). Runner reads exit code, posts `{exit_code, reason, stderr_tail}`. MC handler: if `runner_attempts < runner_max_attempts`, `status → assigned` (next attempt); else `status → failed` |
| RUNNER-12 | Graceful stop on `blocked` checkpoint, preserve worktree | Phase 14 DOES NOT wire checkpoint HTTP surface (Phase 15), but MUST preserve worktree on container kill. Command: `docker stop --time=15 <id>` (SIGTERM then SIGKILL). Worktree is not touched. CONTEXT.md "Worktree preserved across container crashes and retries" |
| RUNNER-13 | Post-crash reconcile `docker ps` against `GET /api/runner/pending-containers` | NEW endpoint. Query: tasks with `container_id IS NOT NULL` and `status IN ('assigned', 'in_progress')`. Diff against `docker ps -a --filter label=mc.task_id --format '{{json .}}'`. Adopt-vs-kill decision tree is Claude's discretion |
| RUNNER-14 | On terminal status, revoke token + destroy worktree | Revocation: already automatic via `revokeTokensForTask` in same `db.transaction` as terminal status UPDATE (see `src/app/api/tasks/[id]/route.ts` line 582 — Phase 11-04 wiring). Runner GC tick reads terminal tasks + destroys worktree (subject to 7-day GC window for `failed`) |
| CONTAINER-01 | Container receives MC_* env vars + recipe-declared secrets | Env composition at claim time. `MC_MODEL_PRIMARY = task.model_override ?? recipe.model.primary` (MODEL-04). Secrets loaded from file-based store at `.data/runner/secrets/<NAME>` (Claude's discretion; file-based OK per CONTEXT.md). Runner MUST NOT log secret values |
| CONTAINER-02 | Container mounts: /workspace (rw worktree), /recipe (ro), /refs/<label>/ (ro), /skills/<name> (ro) | `-v <host>:/workspace:rw` for worktree; `-v <recipe_dir>:/recipe:ro` for recipe + runner-authored `PREAMBLE.md`; one `-v` per `read_only_mount`; one `-v` per `extra_skill`. Recipe dir needs a per-task staging copy so `/recipe/PREAMBLE.md` doesn't stomp the source — OR mount `/recipe` from `.data/runner/recipe-stage/task-<id>/` after copying recipe contents + generating PREAMBLE.md there |
| CONTAINER-03 | Hard-kill at `recipe.timeout_seconds`; report `reason='timeout'` | Host-side `setTimeout(() => docker.stop(id), timeoutMs)`. Alternative: `--stop-timeout` flag on `docker run` for graceful shutdown then SIGKILL. Host timer is authoritative |
| CONTAINER-04 | `mc-hello-world-agent` reference image | `docker/hello-world-agent/Dockerfile` (FROM node:22-alpine), `docker/hello-world-agent/agent.mjs` (per CONTEXT.md steps 1–7), `docker/hello-world-agent/build.sh` (wraps `docker build -t mc-hello-world-agent:latest .`). Companion recipe at `recipes/hello-world/recipe.yaml` + `SOUL.md` |
| WORK-01 | Seed `.mc/task.json`, `.mc/progress.md`, `.mc/checkpoints.jsonl`, `.mc/.gitignore` on first launch | `.mc/.gitignore` = `*` (CONTEXT.md). Each file `writeFileSync` with empty or initial content |
| WORK-02 | `.mc/task.json` carries `task_id`, `recipe_slug`, `attempt`, `is_resuming`, `prior_attempts[]` | CONTEXT.md locks exact shape. Each `prior_attempts[]` entry = `{started_at (ISO 8601), exit_code, failure_reason}` |
| WORK-03 | Worktree preserved across crashes/retries; destroyed on done/cancelled/(failed + GC window) | GC driver: runner-side 10-minute tick + immediate GC on startup. Destroy sequence: `git worktree remove --force` then `rm -rf` logs |
| WORK-04 | Resume preamble (~45 lines) instructing read of task.json/progress.md/checkpoints.jsonl + git state inspection | Preamble generated at claim time. `is_resuming = (runner_attempts > 1)` determines which preamble. Writes to `/recipe/PREAMBLE.md` per CONTEXT.md injection decision |
| WORK-05 | First-attempt preamble (~30–50 lines) instructing writes to `.mc/progress.md` | Same mechanism; `is_resuming = false` branch |
| WORK-06 | `runner_max_attempts` (default 3, recipe-overridable); fail on exceed | Column exists (migration 057). Resolution: `task.runner_max_attempts ?? recipe.max_attempts ?? 3`. **OPEN QUESTION**: recipe.yaml schema (`src/lib/recipe-schema.ts`) does NOT currently have a `max_attempts` field. Phase 14 must either add it to recipe-schema.ts or source the per-recipe default purely from `task.runner_max_attempts` (set at task creation). See Open Questions #2 |
| WORK-07 | Scheduled GC prunes long-terminal worktrees | Runner-side 10-minute tick (not MC scheduler — per CONTEXT.md). GC query: `GET /api/runner/terminal-tasks?since=<iso8601>` |
| MODEL-04 | Effective model = `task.model_override ?? recipe.model.primary`; pass as env | Resolution at claim time. Both sides validated at creation: `model_override` via `isKnownModel` in `createTaskSchema` (validation.ts:63); `recipe.model.primary` via `isKnownModel` refine in `recipe-schema.ts:56`. Claim-route reads task row + calls `getIndexedRecipeBySlug`; compose `MC_MODEL_PRIMARY`, `MC_MODEL_FALLBACK`, `MC_MODEL_PROVIDER`, `MC_MODEL_PARAMS_JSON` |

</phase_requirements>

## Summary

Phase 14 ships the first process in the Mission Control codebase that runs OUTSIDE Next.js: a standalone Node daemon (`scripts/mc-runner.mjs`) that shells to `docker` and `git worktree`. The substrate is already in place — runner-secret auth (Phase 11-02, id=-1000), runner-token issue/verify/revoke (Phase 11-04, id=-2000), `validateHostPathAgainstAllowlist` (Phase 13-01), `getIndexedRecipeBySlug` (Phase 12-02), `revokeTokensForTask` wired into the terminal-status transaction (Phase 11-04), `MODELS` registry (Phase 11-01), runtime settings (Phase 13-01, `runtime.mount_allowlist` + caps), and all 11 additive task columns (migration 057). Phase 14 connects these pieces to a live Docker container via a new REST surface under `/api/runner/*`.

The work splits cleanly into four tracks: **(A) MC-side REST surface** — 5 new endpoints under `/api/runner/` (heartbeat, ready-tasks, claim, pending-containers, terminal-tasks, runner-exit) + one new setting (`runtime.max_concurrent_containers`); **(B) Runner daemon** — `scripts/mc-runner.mjs` with SSE consumer (pattern from `scripts/mc-cli.cjs:240-301`), 15s poll fallback, 10s heartbeat loop, atomic claim flow, worktree + `.mc/` seeder, preamble generator, `docker run --rm -d` launcher with log streaming, exit handler, reconciliation at boot, 10-minute GC tick; **(C) Reference image** — `docker/hello-world-agent/` (Dockerfile + agent.mjs + build.sh) + companion `recipes/hello-world/` (recipe.yaml + SOUL.md); **(D) LaunchAgent template** — `scripts/com.missioncontrol.runner.plist` with `KeepAlive` + `ThrottleInterval 30` for Docker-down backoff.

The hard-won insight: nothing in Phase 14 invents new auth, new validation, or new column semantics. Every requirement has a named Phase 11–13 surface to reuse. The research risk is concentrated in two external-process shells — `docker` and `git worktree` — both of which have straightforward, documented CLIs but require careful stdio handling, label-based reconciliation, and a per-task recipe staging directory so the runner-authored PREAMBLE.md doesn't mutate the source recipe dir.

**Primary recommendation:** Scaffold REST endpoints first (Wave 1), then runner daemon against those endpoints (Wave 2), then reference image against the working daemon (Wave 3). Introduce a new `projects.local_path` column OR a `runtime.project_repo_map` setting in Wave 0 (needed by worktree creation — see Open Questions #1).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` | built-in (Node 22) | Spawn `docker` + `git worktree` subprocesses | Zero-dependency; spawn gives exit code + stream plumbing; already used by `src/lib/command.ts` |
| `node:fs` (+ promises) | built-in | Worktree seeding (`.mc/task.json`, progress.md, checkpoints.jsonl, .gitignore), log file creation, PREAMBLE.md write | Already used everywhere; fs.openSync returns file descriptors for stdio redirection |
| `node:crypto` | built-in | `randomBytes` for runner-token (already wired in `src/lib/runner-tokens.ts`) | Already in use |
| `better-sqlite3` 12.6.x | existing | Runner-side reads from the task DB are NOT allowed — all DB access goes through `/api/runner/*` endpoints with runner-secret auth | Per architectural pattern: client processes never import `getDatabase()` directly |
| `fetch` (built-in) | Node 22 native | HTTP calls from runner to MC (heartbeat, claim, runner-exit) | Node 18+ has global fetch; no `node-fetch` needed |
| `chokidar` 5.x | existing | NOT needed by runner; already used by recipe-watcher — no new consumer in Phase 14 | N/A |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` 10.3.x | existing | Runner-process structured logging (pino is already project logger) | Runner should mirror server logger config: JSON to stdout |
| `zod` 4.3.x | existing | Claim-payload / heartbeat-payload response validation on the runner side (defense-in-depth; MC already validates) | Keep runner resilient to MC-side schema drift |
| `yaml` 2.8.x | existing | Recipe-dir staging if runner needs to touch recipe.yaml (it shouldn't — just copy bytes + generate PREAMBLE.md) | Only if recipe post-processing is needed (not expected) |

### NOT Needed (Don't Add)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Docker shell commands | `dockerode` npm package | ADD a dep; `dockerode` uses the Docker socket which is the same thing under the hood. Shelling to `docker` CLI keeps the runner inspectable with `docker ps` and aligns with CONTEXT.md "docker info at boot" + "docker ps --filter label=mc.task_id" reconciliation |
| Git via `simple-git` | `simple-git` npm package | ADD a dep; `git worktree` has 3 commands we need (`add`, `remove`, `list`). Shelling is clearer |
| SSE client | `eventsource` npm package | `scripts/mc-cli.cjs:240-301` already shows the native `fetch` + `ReadableStream` pattern that works. Copy the utility; don't add a dep |
| Process manager | `pm2` | macOS launchd is already assumed (LaunchAgent). Linux operators can write a systemd unit; Phase 14 ships only the macOS plist per CONTEXT.md "LaunchAgent" lock |

**Installation:** No new npm dependencies. Phase 14 is entirely additive using built-ins + already-installed packages.

## Architecture Patterns

### Recommended Project Structure

```
scripts/
├── mc-runner.mjs                     # NEW — runner daemon entry point
├── com.missioncontrol.runner.plist   # NEW — macOS LaunchAgent template
└── mc-cli.cjs                        # EXISTING — SSE reader pattern to mirror

src/app/api/runner/                   # NEW — all routes under this tree
├── heartbeat/route.ts                # POST — 10s heartbeat, updates last_heartbeat_at
├── ready-tasks/route.ts              # GET — assigned recipe-tagged tasks, 15s poll fallback
├── claim/[task_id]/route.ts          # POST — atomic claim, returns dispatch payload
├── pending-containers/route.ts       # GET — tasks with container_id for reconciliation
├── terminal-tasks/route.ts           # GET — terminal tasks since ISO8601 for GC
└── tasks/[task_id]/
    └── runner-exit/route.ts          # POST — runner reports container exit, MC drives retry

src/lib/
├── runner-claim.ts                   # NEW — atomic claim query + concurrency cap enforcement
├── runner-heartbeat.ts               # NEW — heartbeat persistence + freshness helper
├── runner-worktree.ts                # NEW (host-side doc; actual worktree work lives in mc-runner.mjs but types / path helpers may be shared)
└── settings.ts / settings-definitions # EXTEND — add runtime.max_concurrent_containers

docker/                               # NEW top-level dir
└── hello-world-agent/
    ├── Dockerfile                    # FROM node:22-alpine
    ├── agent.mjs                     # CONTEXT.md steps 1–7
    ├── build.sh                      # docker build -t mc-hello-world-agent:latest .
    └── README.md

recipes/                              # NEW top-level dir (gitignored? — see Open Questions #4)
└── hello-world/
    ├── recipe.yaml                   # image: mc-hello-world-agent:latest, workspace: worktree
    └── SOUL.md

.data/runner/                         # RUNTIME (gitignored via .data/)
├── secrets/                          # Recipe-declared secrets (file-per-name)
├── recipe-stage/task-<id>/           # Per-task copy of recipe dir + runner-authored PREAMBLE.md
├── worktrees/task-<id>/              # Per-task git worktree (.mc/ inside)
└── logs/task-<id>/attempt-<n>/       # stdout.log, stderr.log, meta.json + `latest` symlink
```

### Pattern 1: Atomic Claim via SQL CHANGES()

**What:** Avoid race conditions between SSE-driven claim and poll-fallback claim by relying on SQLite row-level `UPDATE ... WHERE` semantics.
**When to use:** Any "at-most-one-runner claims this task" flow — the canonical pattern for work queues.
**Example:**
```typescript
// Source: Phase 11-04 terminal-revocation pattern (src/app/api/tasks/[id]/route.ts:579)
const result = db.prepare(`
  UPDATE tasks
  SET status = 'in_progress',
      container_id = ?,
      runner_started_at = ?,
      runner_attempts = runner_attempts + 1
  WHERE id = ?
    AND status = 'assigned'
    AND container_id IS NULL
    AND recipe_slug IS NOT NULL
`).run(pendingContainerId, nowUnix, taskId)

if (result.changes === 0) {
  return NextResponse.json({ error: 'Already claimed or ineligible' }, { status: 409 })
}
```

### Pattern 2: SSE Consumer with Poll Fallback

**What:** Runner listens to `/api/events` for `task.runner_requested`; on SSE drop, poll `/api/runner/ready-tasks` every 15s until SSE reconnects.
**When to use:** Any external daemon consuming MC server events — survives network drops, Next.js dev restarts, server redeploys.
**Example:**
```javascript
// Source: scripts/mc-cli.cjs lines 240-301 (exact pattern, no dependencies)
async function sseStream({ baseUrl, apiKey, route, onEvent, onError }) {
  const headers = { Accept: 'text/event-stream', Authorization: `Bearer ${apiKey}` }
  const controller = new AbortController()
  const res = await fetch(`${baseUrl}${route}`, { headers, signal: controller.signal })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    let currentData = ''
    for (const line of lines) {
      if (line.startsWith('data: ')) currentData += line.slice(6)
      else if (line === '' && currentData) {
        try { onEvent(JSON.parse(currentData)) } catch { /* non-JSON frame */ }
        currentData = ''
      }
    }
  }
}
```

### Pattern 3: Detached Docker Run with File-Descriptor stdio

**What:** Spawn `docker run --rm -d <img> ...`; capture container_id from stdout; separately spawn `docker logs -f <id>` with stdio redirected to pre-opened file descriptors for stdout/stderr logs.
**When to use:** Any long-running container where we don't want the parent daemon to hold the stream open (parent can crash and come back; `docker logs -f` can be relaunched against the same container).
**Example:**
```javascript
// Source: node.js docs + search results; adapted for --rm -d
import { spawn } from 'node:child_process'
import { openSync } from 'node:fs'

// 1. Start container (returns container_id on stdout)
const runProc = spawn('docker', [
  'run', '--rm', '-d',
  '--name', `mc-task-${taskId}-a${attempt}`,
  '--label', `mc.task_id=${taskId}`,
  '--label', `mc.recipe_slug=${recipeSlug}`,
  '--label', `mc.attempt=${attempt}`,
  '--add-host', 'host.docker.internal:host-gateway',
  '-e', `MC_API_URL=http://host.docker.internal:${MC_PORT}`,
  '-e', `MC_TASK_ID=${taskId}`,
  '-e', `MC_API_TOKEN=${runnerToken}`,
  '-v', `${worktreePath}:/workspace:rw`,
  '-v', `${recipeStagePath}:/recipe:ro`,
  // ... mounts for read_only_mounts, extra_skills, memory/cpu flags ...
  image,
], { stdio: ['ignore', 'pipe', 'pipe'] })

let containerId = ''
runProc.stdout.on('data', chunk => containerId += chunk.toString())
await new Promise(resolve => runProc.on('exit', resolve))
containerId = containerId.trim()

// 2. Stream logs (independent subprocess; parent can restart)
const stdoutFd = openSync(`${logDir}/stdout.log`, 'a')
const stderrFd = openSync(`${logDir}/stderr.log`, 'a')
const logsProc = spawn('docker', ['logs', '-f', containerId], {
  stdio: ['ignore', stdoutFd, stderrFd],
})

// 3. Wait for exit (blocking host timer for timeout)
const exitCode = await waitForContainerExit(containerId, recipe.timeout_seconds)
```

### Pattern 4: Per-Task Recipe Staging

**What:** Copy `recipes/<slug>/` to `.data/runner/recipe-stage/task-<id>/`, write runner-authored `PREAMBLE.md` in the stage dir, mount the STAGE dir (not source) as `/recipe:ro`.
**When to use:** Any runner-authored artifact that needs to be adjacent to source recipe files (PREAMBLE.md, generated per-task). Keeps source recipe dirs pristine.
**Anti-pattern to avoid:** Mounting `recipes/<slug>/` directly and writing PREAMBLE.md into it — the chokidar watcher (`src/lib/recipe-watcher.ts`) would re-hash the dir (`computeDirSha`) and re-index, possibly fighting the runner.

### Pattern 5: Runner-Process → MC via runner-secret (NOT runner-token)

**What:** Runner daemon holds the long-lived `.data/runner.secret`; issues + distributes per-task runner-tokens but never uses them itself. All `/api/runner/*` admin paths (heartbeat, claim, pending-containers, terminal-tasks, ready-tasks, runner-exit) authenticate as runner-secret (`id=-1000`). Only the CONTAINER's agent process uses the runner-token (`id=-2000`, task-scoped).
**When to use:** Every runner → MC HTTP call in this daemon.
**Why:** Runner-token RAUTH-06 allowlist (src/lib/runner-tokens.ts:10) is scoped to `/api/runner/tasks/:id/{checkpoints,submit,fail,status,...}` — agent-facing paths. Daemon-facing paths are NOT in the allowlist, so runner-token auth would fail with 401.

### Anti-Patterns to Avoid

- **Storing runner-secret in the DB:** Secret lives on-disk at `.data/runner.secret` with mode 0600. `src/lib/runner-secret.ts` already owns the generation + read surface; runner just reads it at boot.
- **Fine-grained UPDATEs for heartbeat:** Don't UPDATE a tasks row on every heartbeat. Keep heartbeat state in a new `runner_heartbeats` single-row table (or a `settings` row keyed `runtime.runner_last_heartbeat`) to avoid churning the tasks table.
- **Mutating `/recipe/SOUL.md`:** CONTEXT.md explicitly locks "authored SOUL.md is never mutated". Runner writes ONLY `/recipe/PREAMBLE.md` in the staged recipe dir.
- **Using `docker attach` or interactive mode:** Batch agents; no TTY; use `-d` (detached) + `docker logs -f` for streaming. `--rm` handles cleanup.
- **Runner-side DB imports:** The daemon is a separate process; `getDatabase()` would open a second SQLite handle with its own WAL state. All DB access flows through `/api/runner/*` endpoints to avoid dual-writer footguns.
- **Shell string concatenation for `docker run`:** Always pass args as array to `spawn`; never `sh -c '<string>'`. Values come from user-controlled recipe.yaml (image name, env values) and shell-injected quoting is a supply-chain risk.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Allowlist validation at claim | New validator | `validateHostPathAgainstAllowlist` from `@/lib/task-runtime-validation` | Phase 13-01 already handles symlink walking (realpath → ENOENT ancestor walk), empty-allowlist rejection, OUT_OF_ALLOWLIST vs INVALID_PATH error discrimination. STATE.md locks "Phase 14 runner MUST import" this |
| Recipe lookup | DB-level SELECTs on `recipes` | `getIndexedRecipeBySlug(slug)` from `@/lib/recipe-indexer` | Handles JSON column deserialization (env_json → env, etc.), discriminates RecipeRow vs RecipeErrorRow, returns `null` for unknown. See STATE.md "Phase 13 discrimination rule" |
| Runner-token mint | Custom bearer generator | `issueRunnerToken(db, taskId, attempt, timeoutSeconds)` from `@/lib/runner-tokens` | Handles SHA-256 hash at rest, expiry calc (`runner_started_at + timeout + 60`), insertion into `task_runner_tokens`. Plaintext returned once |
| Runner-token revoke on terminal | Custom revocation | Automatic via `revokeTokensForTask` wired in same `db.transaction` as terminal status UPDATE (`src/app/api/tasks/[id]/route.ts:579-584`) | Phase 11-04 lock: "terminal transition atomic with revocation". Runner just PATCHes status; revocation happens server-side transactionally |
| Error-response shape | Ad-hoc `{ error: '...' }` | `buildAggregatedValidationResponse(issues)` + `TASK_RUNTIME_ERROR_CODES` from `@/lib/task-runtime-validation` | Phase 13 locked the aggregated `{ errors: [{ field, code, message, hint }] }` shape; Phase 14 claim-route MUST emit the same shape for RECIPE_NOT_FOUND / RECIPE_BROKEN / ALLOWLIST_EMPTY / OUT_OF_ALLOWLIST / CAP_EXCEEDED |
| Model resolution | Custom lookup | `isKnownModel(id)` + `getModel(id)` from `@/lib/model-registry` + already-validated `task.model_override` / `recipe.model.primary` | Both sides are validated at creation time. Claim-route just composes the effective model via `task.model_override ?? recipe.model.primary` with no re-validation |
| Mount-cap enforcement at claim | Custom count | `getMountsCap()` + `getExtraSkillsCap()` from `@/lib/task-runtime-settings` | Already getters-per-request (admin-mutable via PUT /api/settings). Claim re-checks defensively in case of drift between create-time and claim-time |
| Rate limiting on heartbeat | Custom throttle | `mutationLimiter` from `@/lib/rate-limit` (precedent in every POST/PATCH route) | 10s heartbeat is high-frequency; heartbeat is still a write (`last_heartbeat_at` update). Limiter prevents accidental-hammering from a misbehaving runner |
| Settings definitions | Custom JSON | Extend `settingDefinitions` in `src/app/api/settings/route.ts:18` | Add `runtime.max_concurrent_containers` (category 'runtime', default '4') alongside existing `runtime.mount_allowlist` / `runtime.read_only_mounts_cap` / `runtime.extra_skills_cap` |
| SSE consumer | New EventSource polyfill | Copy pattern from `scripts/mc-cli.cjs:240-301` (native fetch + ReadableStream) | Zero-dep; already proven by `mc events watch` |
| Logger for runner | New pino setup | Import `@/lib/logger` into `mc-runner.mjs` | But — `scripts/mc-runner.mjs` is ESM + outside src/. Use a minimal local `createRunnerLogger()` that pipes JSON lines to stdout, OR `import { logger } from '../src/lib/logger.ts'` which requires a bundle step. See Open Questions #3 |

**Key insight:** Phase 14 is 80% wiring existing modules. The planner's job is to orchestrate *what* wires to *where* — not to invent new mechanics. Every place the runner must "validate" / "auth" / "look up a recipe" / "revoke a token" has a named function already on disk and under test.

## Common Pitfalls

### Pitfall 1: Heartbeat drift + 60s offline threshold mismatch
**What goes wrong:** Heartbeat sent every 10s with `setInterval`; if the event loop stalls (GC pause, slow DB write), heartbeats cluster. MC sees heartbeat at T+0 then T+65, flips to offline briefly.
**Why it happens:** `setInterval` is wall-clock, not drift-compensating. A slow tick pushes the next tick back by the same delta.
**How to avoid:** Use `setTimeout` with self-scheduling: after successful heartbeat post, schedule the next one at `max(lastHeartbeatAt + 10_000 - now, 100)`. Or accept drift and widen MC offline threshold: Phase 14 uses 60s silence (6x heartbeat interval) so there's already headroom.
**Warning signs:** "Runner offline" banner flapping in a dev environment with no actual outage. Check MC logs for heartbeat receive timestamps.

### Pitfall 2: Worktree-add against a repo that doesn't have the base_ref
**What goes wrong:** `git -C <repo> worktree add .data/runner/worktrees/task-42 main` fails with "invalid reference: main" because the host repo is fetched only to `origin/main` or the default branch is `master`.
**Why it happens:** `workspace_source.base_ref` is user-provided at task creation; no runtime check against the actual repo until the runner hits it. Branch-name drift is common.
**How to avoid:** Runner performs `git -C <repo> fetch --all --prune` before `worktree add`. If `worktree add` fails, post `runner-exit` with `reason='worktree_create_failed'` and `stderr_tail=<git stderr>` — do NOT retry indefinitely. Let MC drive retry/fail via `runner_max_attempts` — a bad base_ref will blow through attempts fast with a clear reason.
**Warning signs:** `.data/runner/worktrees/task-<id>/` missing after successful claim; git stderr shows "invalid reference" or "unknown revision".

### Pitfall 3: Container name collision on attempt retry
**What goes wrong:** `mc-task-42-a2` exists (crashed, not yet removed); runner tries `mc-task-42-a2` again after bumping attempt logic incorrectly.
**Why it happens:** The attempt counter lives in `.mc/task.json` AND on the tasks row (`runner_attempts`). If the runner crashes between updating one and the other, they drift.
**How to avoid:** Tasks row is authoritative. Runner reads `task.runner_attempts` (server-authoritative via claim response), bumps it in the `UPDATE tasks SET runner_attempts = runner_attempts + 1` in the atomic claim query, and uses THAT value for the container name + `.mc/task.json`. Do NOT write `runner_attempts` from runner code; it's set in the claim SQL.
**Warning signs:** `docker run` fails with "Conflict. The container name '/mc-task-42-a3' is already in use by container '<hash>'".

### Pitfall 4: Runner-secret leak through `ps aux` / `/proc`
**What goes wrong:** Runner starts `docker run ... -e MC_API_TOKEN=<runner-secret> ...` and the secret shows up in every operator's `ps` output.
**Why it happens:** Env-var flags on command lines are visible process-wide on most OSes.
**How to avoid:** Use `--env-file` for any secret-bearing env. Stage `/tmp/mc-task-<id>-env` with `MC_API_TOKEN=...` inside, mode 0600, pass `--env-file /tmp/mc-task-<id>-env` to `docker run`, delete after container exits. **Critical:** `MC_API_TOKEN` is the PER-TASK runner-token (not runner-secret). It's still sensitive — agents on other tasks must not see it.
**Warning signs:** `ps aux | grep docker` reveals `MC_API_TOKEN=<43-char base64url>`.

### Pitfall 5: SIGKILL on timeout before log flush
**What goes wrong:** Timeout fires, runner calls `docker kill <id>`, agent process dies mid-write. stdout.log is truncated at the buffer boundary.
**Why it happens:** `docker kill` sends SIGKILL by default; no chance for the container to flush stdout.
**How to avoid:** Use `docker stop --time=15 <id>` which sends SIGTERM, waits 15s, then SIGKILL. Most Node agents respect SIGTERM and flush. CONTEXT.md "hard-kill at timeout" permits either; SIGTERM+SIGKILL chain preserves logs when possible.
**Warning signs:** stdout.log ends mid-JSON-line; operator can't diagnose failure.

### Pitfall 6: GC racing with in-flight task
**What goes wrong:** GC tick computes "task 42 is `done`, destroy worktree" then runs `git worktree remove --force .data/runner/worktrees/task-42/`. But the container is actually still running because MC hadn't received `runner-exit` yet — task status was flipped to `done` by the Phase-13 PATCH handler on a different path.
**Why it happens:** Terminal-status transitions aren't coupled to container lifecycle in Phase 14. A user manually PATCHes a task to `done` via the UI; runner's GC tick sees it and nukes the worktree while the agent is still writing.
**How to avoid:** GC must check `task.container_id IS NULL` in addition to terminal status. If a container is still recorded, GC skips and defers. The next tick re-evaluates after the container exits (container_id cleared on runner-exit).
**Warning signs:** Agent logs show "ENOENT: no such file or directory" mid-run; operator sees worktree gone.

### Pitfall 7: Recipe staging dir not cleaned up
**What goes wrong:** `.data/runner/recipe-stage/task-<id>/` accumulates forever across attempts and tasks.
**Why it happens:** Stage dir is created at claim time but only explicitly cleaned on successful GC of the worktree. Aborted claims (concurrency cap hit, allowlist reject) leave stage dirs.
**How to avoid:** Stage dir creation is the LAST step before `docker run`, and cleanup is in the same GC tick as the worktree. If a claim fails mid-flight (after stage dir created, before container started), the exit handler in the runner removes it. `mkdirSync` with `recursive: true` is idempotent — safe on retry.
**Warning signs:** `.data/runner/recipe-stage/` has more entries than `tasks WHERE container_id IS NOT NULL`.

### Pitfall 8: `docker ps -a --filter label=mc.task_id` returning too much
**What goes wrong:** At reconciliation, the runner lists ALL containers (stopped + running) with any `mc.task_id` label. It finds completed `--rm` containers from weeks ago (if `--rm` was stripped by an operator) and tries to "reconcile" them.
**Why it happens:** `-a` flag includes stopped containers; `--rm` is not guaranteed across operator edits.
**How to avoid:** Filter by status in the ps output: `docker ps --filter label=mc.task_id --filter status=running` for live containers only. Then `--filter status=exited` separately for cleanup of stopped ones. The adopt-vs-kill tree operates on running containers; exited containers get `docker rm` + task-row `container_id IS NULL` clear.
**Warning signs:** Reconciliation log claims to "adopt" 40 containers on fresh boot; only 1 actually running.

### Pitfall 9: Runner restart during active container
**What goes wrong:** `launchctl kickstart` restarts the runner while a container is mid-task. Runner boots, reconciles, adopts the running container — but loses the in-memory `setTimeout` for timeout enforcement.
**Why it happens:** Timeouts are runner-process-local; process restart kills them.
**How to avoid:** Reconciliation computes `now - mc.runner_started_at` from the container label + `recipe.timeout_seconds`. If `elapsed > timeout`, kill now. Otherwise, schedule a new `setTimeout` for the remaining time. Host timer after reconciliation is still authoritative.
**Warning signs:** Container runs well past `recipe.timeout_seconds` after a runner restart.

### Pitfall 10: `chokidar` watcher fighting with recipe staging
**What goes wrong:** Runner copies `recipes/hello-world/` to `.data/runner/recipe-stage/task-42/` and writes `PREAMBLE.md`. The chokidar watcher (`src/lib/recipe-watcher.ts`) sees a new file under... wait, is `.data/runner/recipe-stage/` under the recipes watcher root?
**Why it happens:** `getRecipesRoot()` returns `<cwd>/recipes` by default, so `.data/runner/recipe-stage/` is OUTSIDE. Not a real conflict if the staging dir is chosen carefully.
**How to avoid:** Never stage inside `recipes/`. `.data/runner/recipe-stage/task-<id>/` is safe because `MISSION_CONTROL_RECIPES_DIR` defaults to `<cwd>/recipes` (not `.data/recipes`). Double-check the watcher root in `src/lib/recipe-watcher.ts:43-47`.
**Warning signs:** Indexer log shows "indexing recipe at .data/runner/recipe-stage/task-42".

## Code Examples

### Minimal runner daemon skeleton

```javascript
// Source: scripts/mc-runner.mjs (new file, patterns borrowed from scripts/mc-cli.cjs)
#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const DATA_DIR = process.env.MISSION_CONTROL_DATA_DIR || path.join(process.cwd(), '.data')
const MC_URL = process.env.MC_URL || 'http://127.0.0.1:3000'
const RUNNER_ID = process.env.RUNNER_ID || 'runner-local'

// Step 1: read runner.secret
const secret = fs.readFileSync(path.join(DATA_DIR, 'runner.secret'), 'utf8').trim()
if (!secret || Buffer.from(secret, 'base64url').length < 32) {
  console.error('runner.secret missing or invalid')
  process.exit(1)
}

// Step 2: docker info (fail → exit 2 per CONTEXT.md)
const probe = spawn('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: ['ignore', 'ignore', 'inherit'] })
const probeExit = await new Promise(res => probe.on('exit', res))
if (probeExit !== 0) {
  console.error('Docker daemon unreachable. Start Docker and re-launch the runner.')
  process.exit(2)
}

const mcFetch = (path, init = {}) => fetch(`${MC_URL}${path}`, {
  ...init,
  headers: { ...init.headers, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
})

// Step 3: reconcile
const pending = await mcFetch('/api/runner/pending-containers').then(r => r.json())
const liveOut = await new Promise(res => {
  const p = spawn('docker', ['ps', '--filter', 'label=mc.task_id', '--filter', 'status=running', '--format', '{{json .}}'])
  let buf = ''; p.stdout.on('data', c => buf += c); p.on('exit', () => res(buf))
})
const live = liveOut.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
// ... adopt-vs-kill logic ...

// Step 4: heartbeat loop (self-scheduled, drift-resistant)
async function beat() {
  const start = Date.now()
  try {
    await mcFetch('/api/runner/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ runner_id: RUNNER_ID, ts: start }),
    })
  } catch (err) {
    // Transient — continue; MC offline threshold is 60s
  }
  const delay = Math.max(10_000 - (Date.now() - start), 100)
  setTimeout(beat, delay)
}
beat()

// Step 5: SSE + poll fallback
subscribeToRunnerRequested(onRunnerRequested)
setInterval(pollReadyTasks, 15_000)

// ... claim, worktree, docker run, exit loop ...
```

### Atomic claim endpoint

```typescript
// Source: NEW src/app/api/runner/claim/[task_id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { getIndexedRecipeBySlug } from '@/lib/recipe-indexer'
import { issueRunnerToken } from '@/lib/runner-tokens'
import { validateHostPathAgainstAllowlist, buildAggregatedValidationResponse, TASK_RUNTIME_ERROR_CODES } from '@/lib/task-runtime-validation'
import { getMountsCap, getExtraSkillsCap } from '@/lib/task-runtime-settings'
import { isKnownModel, getModel } from '@/lib/model-registry'

export async function POST(request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  // runner-secret principal is id=-1000 operator role; runner-secret branch in auth.ts auto-resolves.
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (auth.user.id !== -1000) {
    return NextResponse.json({ error: 'claim requires runner-secret principal' }, { status: 403 })
  }

  const { task_id: taskIdStr } = await params
  const taskId = Number(taskIdStr)
  const db = getDatabase()
  const nowUnix = Math.floor(Date.now() / 1000)

  // Load task + recipe for validation
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId) as any
  if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 })
  if (!task.recipe_slug) return NextResponse.json({ error: 'task has no recipe_slug' }, { status: 400 })

  const recipe = getIndexedRecipeBySlug(task.recipe_slug)
  if (!recipe || recipe.error_message) {
    return buildAggregatedValidationResponse([{
      field: 'recipe_slug',
      code: recipe?.error_message ? TASK_RUNTIME_ERROR_CODES.RECIPE_BROKEN : TASK_RUNTIME_ERROR_CODES.RECIPE_NOT_FOUND,
      message: `recipe '${task.recipe_slug}' ${recipe?.error_message ? 'has an indexing error' : 'not found'}`,
      hint: recipe?.error_message || 'ensure the recipe directory exists and was indexed',
    }])
  }

  // Re-validate mounts + extra_skills (RUNNER-07)
  const issues = []
  const mounts = task.read_only_mounts ? JSON.parse(task.read_only_mounts) : []
  const skills = task.extra_skills ? JSON.parse(task.extra_skills) : []
  for (let i = 0; i < mounts.length; i++) {
    const r = await validateHostPathAgainstAllowlist(mounts[i].host_path)
    if (!r.ok) issues.push({ field: `read_only_mounts.${i}.host_path`, code: r.code, message: r.message, hint: r.hint })
  }
  for (let i = 0; i < skills.length; i++) {
    const r = await validateHostPathAgainstAllowlist(skills[i])
    if (!r.ok) issues.push({ field: `extra_skills.${i}`, code: r.code, message: r.message, hint: r.hint })
  }
  if (mounts.length > getMountsCap()) issues.push({ field: 'read_only_mounts', code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED, message: `${mounts.length} > ${getMountsCap()}`, hint: 'reduce mounts or raise runtime.read_only_mounts_cap' })
  if (skills.length > getExtraSkillsCap()) issues.push({ field: 'extra_skills', code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED, message: `${skills.length} > ${getExtraSkillsCap()}`, hint: 'reduce skills or raise runtime.extra_skills_cap' })
  if (issues.length > 0) return buildAggregatedValidationResponse(issues)

  // Concurrency caps (RUNNER-08)
  const global = db.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status = 'in_progress' AND container_id IS NOT NULL`).get() as { n: number }
  const maxGlobal = Number(db.prepare(`SELECT value FROM settings WHERE key = 'runtime.max_concurrent_containers'`).get()?.value || '4')
  if (global.n >= maxGlobal) return NextResponse.json({ errors: [{ field: '(global)', code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED, message: `global concurrency cap ${maxGlobal} reached`, hint: 'wait for a container to exit' }] }, { status: 409 })

  const perRecipe = db.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status = 'in_progress' AND recipe_slug = ?`).get(task.recipe_slug) as { n: number }
  if (perRecipe.n >= recipe.max_concurrent) return NextResponse.json({ errors: [{ field: 'recipe.max_concurrent', code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED, message: `per-recipe cap ${recipe.max_concurrent} reached`, hint: 'wait for same-recipe container to exit' }] }, { status: 409 })

  // Atomic claim
  const nextAttempt = (task.runner_attempts || 0) + 1
  const pendingContainerId = `pending:${taskId}:${nextAttempt}` // placeholder until docker run returns real id

  let token: { token: string; expiresAt: number } | null = null
  const claim = db.transaction(() => {
    const result = db.prepare(`
      UPDATE tasks
      SET status = 'in_progress',
          container_id = ?,
          runner_started_at = ?,
          runner_attempts = runner_attempts + 1
      WHERE id = ?
        AND status = 'assigned'
        AND container_id IS NULL
    `).run(pendingContainerId, nowUnix, taskId)
    if (result.changes === 0) return { claimed: false }
    token = issueRunnerToken(db, taskId, nextAttempt, recipe.timeout_seconds, nowUnix)
    return { claimed: true }
  })()

  if (!claim.claimed) return NextResponse.json({ error: 'already claimed or ineligible' }, { status: 409 })

  // Compose dispatch payload
  const modelPrimary = task.model_override ?? recipe.model.primary
  const modelMeta = getModel(modelPrimary)
  return NextResponse.json({
    task: {
      id: task.id,
      recipe_slug: task.recipe_slug,
      workspace_source: task.workspace_source ? JSON.parse(task.workspace_source) : null,
      read_only_mounts: mounts,
      extra_skills: skills,
      attempt: nextAttempt,
      is_resuming: nextAttempt > 1,
      prior_attempts: /* TODO: load from task_checkpoints or a new prior_attempts column */ [],
      runner_max_attempts: task.runner_max_attempts ?? 3,
    },
    recipe,
    env: {
      MC_API_URL: `http://host.docker.internal:${process.env.PORT || 3000}`,
      MC_TASK_ID: String(task.id),
      MC_API_TOKEN: token!.token,
      MC_WORKSPACE: '/workspace',
      MC_RECIPE_PATH: '/recipe',
      MC_PREAMBLE_PATH: '/recipe/PREAMBLE.md',
      MC_MODEL_PRIMARY: modelPrimary,
      MC_MODEL_PROVIDER: recipe.model.provider || modelMeta?.provider || 'anthropic',
      MC_MODEL_FALLBACK: recipe.model.fallback || '',
      MC_MODEL_PARAMS_JSON: JSON.stringify(recipe.model.params || {}),
    },
    runner_token_expires_at: token!.expiresAt,
  })
}
```

### `.mc/task.json` seeding

```typescript
// Source: CONTEXT.md locked shape (WORK-02)
function seedMcDir(worktreePath: string, task: ClaimedTask) {
  const mcDir = path.join(worktreePath, '.mc')
  fs.mkdirSync(mcDir, { recursive: true })

  const taskJson = {
    task_id: String(task.id),
    recipe_slug: task.recipe_slug,
    attempt: task.attempt,
    is_resuming: task.is_resuming,
    prior_attempts: task.prior_attempts,
  }
  fs.writeFileSync(path.join(mcDir, 'task.json'), JSON.stringify(taskJson, null, 2))

  // Initialize only if not resuming (preserve content across attempts per WORK-03)
  if (!task.is_resuming) {
    fs.writeFileSync(path.join(mcDir, 'progress.md'), `# Progress — Task ${task.id}\n\n`)
    fs.writeFileSync(path.join(mcDir, 'checkpoints.jsonl'), '')
  }
  fs.writeFileSync(path.join(mcDir, '.gitignore'), '*\n')
}
```

### LaunchAgent plist template

```xml
<!-- Source: scripts/com.missioncontrol.runner.plist (NEW) — macOS launchd docs + tjluoma/launchd-keepalive -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.missioncontrol.runner</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/mission-control/scripts/mc-runner.mjs</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/path/to/mission-control</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>MC_URL</key>
    <string>http://127.0.0.1:3000</string>
    <key>MISSION_CONTROL_DATA_DIR</key>
    <string>/path/to/mission-control/.data</string>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>

  <key>KeepAlive</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>30</integer>

  <key>StandardOutPath</key>
  <string>/path/to/mission-control/.data/runner/daemon.log</string>

  <key>StandardErrorPath</key>
  <string>/path/to/mission-control/.data/runner/daemon.err</string>
</dict>
</plist>
```

Install: `launchctl load ~/Library/LaunchAgents/com.missioncontrol.runner.plist`. Uninstall: `launchctl unload ...`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Long-running web agents embedded in Next.js process | Short-lived containers per task with SSE dispatch | v1.2 (this phase) | Crash containment — agent crash doesn't take down MC |
| Agent claims task via direct DB write | Atomic claim via `POST /api/runner/claim/:task_id` + runner-secret auth | v1.2 | Single source of truth; concurrency caps enforceable |
| Agent auth via global `API_KEY` | Per-task, per-attempt runner-token, scoped by RAUTH-06 allowlist, expiring, revocable | Phase 11-04 | Least-privilege; cross-task access blocked by design |
| Mount validation at task creation only | Mount validation at creation AND claim (defense-in-depth) | Phase 13-01 + Phase 14 (this) | Symlink races between creation and claim are caught |

**Deprecated/outdated:**
- **Claude Code assumption:** The v1.2 design deliberately removed any Claude-specific glue. Per MEMORY.md ("agent-runtime-tool-agnostic"), preamble + runner + container contract target "any HTTP + file agent". Phase 14 reference image uses built-in Node fetch — no SDKs, no Claude-specific libraries.
- **EventSource polyfill:** Node 22 has global `fetch` + `ReadableStream`; no need for `eventsource` npm or `node-fetch`.
- **`node-pty` for container launch:** PTY is for interactive terminals; batch containers use `spawn` with file-descriptor stdio redirection. `node-pty` is installed for other reasons (agent PTY emulation) but not relevant here.

## Open Questions

1. **Worktree source path — where is the local git repo?**
   - What we know: `task.workspace_source = { project_id, base_ref }`. `projects` table has `github_repo` (remote URL) but NO `local_path` column. Phase 13 validates `workspace_source` structure but doesn't resolve a filesystem path.
   - What's unclear: How does the runner know WHERE to `git -C <path> worktree add`? Options:
     - (A) Add a new `projects.local_path TEXT` column (migration 060). Admin sets per project.
     - (B) New setting `runtime.project_repo_map` = JSON `{ "<project_id>": "<absolute path>" }`. Admin-managed.
     - (C) Convention: derive from `github_repo` → checkout under `.data/runner/repos/<project_id>/` on first use, fetch + create worktree from there. Adds a clone step.
   - Recommendation: **Plan decides**. Option (B) is fastest (uses existing settings machinery, no new migration); Option (A) is most discoverable; Option (C) auto-bootstraps but introduces a new responsibility (local mirror maintenance). Planner should pick one and the Wave 0 setup task should wire it.

2. **`recipe.max_attempts` — recipe-overridable per WORK-06?**
   - What we know: Requirement text says "runner_max_attempts default 3, recipe-overridable". Task has `runner_max_attempts` column (migration 057, nullable). Recipe schema (`src/lib/recipe-schema.ts`) does NOT have a `max_attempts` field.
   - What's unclear: Is the override at task level only (operator sets per task) or recipe level (author sets in recipe.yaml)?
   - Recommendation: **Plan decides**. Easiest interpretation: (a) recipe.yaml adds optional `max_attempts: z.number().int().min(1).max(10).optional()`, (b) task creation resolves `task.runner_max_attempts ?? recipe.max_attempts ?? 3` and persists the resolved value on the task row. If planner defers the recipe-level field, document in the plan that WORK-06 is satisfied via task-level override only and file a v1.3 refinement.

3. **Runner logger — share `@/lib/logger` or local?**
   - What we know: `scripts/mc-runner.mjs` is a top-level script outside `src/`. `@/lib/logger` is TypeScript + uses `pino` 10.3.x. Other .cjs scripts don't import `@/lib/logger` (they use `console`).
   - What's unclear: Does planner want the runner to emit pino JSON lines (operationally consistent with MC server) or console-plain (simpler)?
   - Recommendation: **Lean toward a minimal local logger** (console.log JSON lines with `{ level, ts, msg, ...ctx }` shape) to avoid a .ts-in-.mjs bundling concern. Alternative: name the file `scripts/mc-runner.mjs` and import pino directly (`import pino from 'pino'`). Pino is already in dependencies.

4. **`recipes/` source-tree or runtime-tree?**
   - What we know: `getRecipesRoot()` defaults to `<cwd>/recipes` (source-tree) per STATE.md 2026-04-19 "Recipes root defaults to <cwd>/recipes via MISSION_CONTROL_RECIPES_DIR, NOT MISSION_CONTROL_DATA_DIR — recipe directories are authored code living alongside src/ and scripts/". Bundled `recipes/hello-world/` ships in the source tree per CONTEXT.md.
   - What's unclear: The `recipes/` dir doesn't exist yet in the repo. It'll be committed as part of Phase 14 (hello-world). Should it be gitignored or committed?
   - Recommendation: **Commit `recipes/hello-world/`** (it's authored code). In a future multi-recipe world, operators can add their own under `recipes/` — that's an author-dependent choice (commit if team-shared, gitignore if private). No `.gitignore` entry needed in Phase 14; the default behavior is "committed".

5. **Heartbeat persistence — which table?**
   - What we know: MC needs `last_heartbeat_at` for the Phase 15 `reconcileRunnerHeartbeat()` scheduler task. Phase 14 doesn't surface the banner (Phase 16) but must persist the value.
   - What's unclear: Dedicated `runner_heartbeats` table (with `runner_id` + `last_heartbeat_at`, pre-populated for multi-runner readiness) vs a settings row (`runtime.runner_last_heartbeat_at`)?
   - Recommendation: **New tiny table `runner_heartbeats (runner_id TEXT PRIMARY KEY, last_heartbeat_at INTEGER NOT NULL, metadata_json TEXT)` in a migration 060**. Scales to multi-runner without schema change; avoids polluting `settings` with runtime operational state.

6. **`runner-exit` endpoint — runner-secret or runner-token?**
   - What we know: Runner-token allowlist (RUNNER-TOKENS.md) includes `POST /api/runner/tasks/:id/{submit,fail,checkpoints}` (runner-TOKEN paths) but NOT `/api/runner/tasks/:id/runner-exit`. The daemon (not the agent) posts `runner-exit`.
   - What's unclear: Is runner-exit a runner-SECRET path (daemon-authenticated) or a new runner-token path?
   - Recommendation: **runner-secret**. The container's runner-token might be expired by the time the container exits past timeout; the daemon is the authoritative reporter. Add to a NEW route path that's runner-secret-only: `POST /api/runner/tasks/:task_id/runner-exit` (daemon) — distinct from the agent-facing runner-token paths. Auth wrapper: the existing `/api/runner/*` runner-secret branch in `src/lib/auth.ts:472` already handles it if we pick a `/api/runner/...` path NOT in the RUNNER_TOKEN_ALLOWLIST.

7. **Prior-attempts source — where does it live?**
   - What we know: `.mc/task.json.prior_attempts[]` is a list of past attempts with `{started_at, exit_code, failure_reason}`. Task row has `runner_attempts` (count) and `runner_last_failure_reason` (latest only). `task_checkpoints` table exists but is Phase 15.
   - What's unclear: For Phase 14, how does the claim route populate `prior_attempts[]`? Options:
     - (A) New column `tasks.prior_attempts_json TEXT` — append on each `runner-exit` in MC's handler.
     - (B) New table `task_runner_attempts (id, task_id, attempt, started_at, exit_code, failure_reason, created_at)`.
     - (C) Phase 14 populates only the latest attempt (N-1) from `runner_attempts` + `runner_last_failure_reason` + `runner_started_at`; older history deferred.
   - Recommendation: **Option (B), new migration 061**. Clean relational model, scales to unbounded attempts, trivially queryable. Worth a plan task. `prior_attempts_json` in `.mc/task.json` is computed by the claim route from the latest N rows.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.x (jsdom env) + Playwright 1.51.x for E2E |
| Config file | `vitest.config.ts` + `playwright.config.ts` |
| Quick run command | `pnpm test src/lib/__tests__/runner-claim.test.ts -- --run` |
| Full suite command | `pnpm test` (all unit) + `pnpm test:e2e` (all E2E) |

Note: `src/lib/task-dispatch.ts`, `src/lib/scheduler.ts`, `src/lib/command.ts`, `src/lib/db.ts`, `src/lib/auth.ts` are EXCLUDED from coverage (vitest.config.ts). New Phase 14 modules (`runner-claim.ts`, `runner-heartbeat.ts`) should be INCLUDED in coverage unless they hit hard-to-mock external processes (e.g., live `docker run`); in that case add to the exclude list with a justifying comment.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RUNNER-01 | Runner script boots, exits 1 on missing secret | unit | `pnpm test src/lib/__tests__/mc-runner-boot.test.ts -- --run` (script-under-test spawned via child_process) | Wave 0 |
| RUNNER-02 | Runner authenticates via runner-secret | unit | `pnpm test src/lib/__tests__/auth-runner-principal.test.ts` | EXISTS (Phase 11-02) |
| RUNNER-03 | SSE subscribe reads `task.runner_requested` frames | unit | `pnpm test src/lib/__tests__/runner-sse-consumer.test.ts -- --run` | Wave 0 |
| RUNNER-04 | GET `/api/runner/ready-tasks` returns correct shape | unit + route | `pnpm test src/app/api/runner/ready-tasks/__tests__/route.test.ts -- --run` | Wave 0 |
| RUNNER-05 | POST `/api/runner/heartbeat` persists + 60s staleness | unit | `pnpm test src/lib/__tests__/runner-heartbeat.test.ts -- --run` | Wave 0 |
| RUNNER-06 | Atomic claim returns 409 on double-claim | integration | `pnpm test src/app/api/runner/claim/__tests__/route.test.ts -- --run` | Wave 0 |
| RUNNER-07 | Claim re-validates mounts via `validateHostPathAgainstAllowlist` | unit | Same as RUNNER-06, with allowlist-escape fixtures | Wave 0 |
| RUNNER-08 | Global + per-recipe cap → 409 | unit | Same as RUNNER-06, with cap-breach fixtures | Wave 0 |
| RUNNER-09 | Seed `.mc/task.json`, progress.md, checkpoints.jsonl, .gitignore | unit | `pnpm test src/lib/__tests__/runner-worktree-seed.test.ts -- --run` | Wave 0 |
| RUNNER-10 | `docker run` argv composition matches recipe + env | unit | `pnpm test src/lib/__tests__/runner-docker-args.test.ts -- --run` (assert on argv array, no live docker call) | Wave 0 |
| RUNNER-11 | `runner-exit` handler increments attempts + drives retry/fail | integration | `pnpm test src/app/api/runner/tasks/[task_id]/runner-exit/__tests__/route.test.ts` | Wave 0 |
| RUNNER-12 | Graceful stop preserves worktree | manual-only (requires live docker) | `bash scripts/mc-runner-smoke.sh preserve-on-stop` | Wave 0 |
| RUNNER-13 | Reconcile at boot diffs docker ps vs pending-containers | unit | `pnpm test src/lib/__tests__/runner-reconcile.test.ts -- --run` (mock `docker ps` output + MC response) | Wave 0 |
| RUNNER-14 | Token revoke + worktree destroy on terminal status | integration | `pnpm test src/app/api/tasks/[id]/__tests__/runner-terminal.test.ts` (extends existing tests) | Wave 0 |
| CONTAINER-01 | Env composition via env-file (no secrets on argv) | unit | `pnpm test src/lib/__tests__/runner-env-file.test.ts -- --run` | Wave 0 |
| CONTAINER-02 | Mount paths resolve to correct container paths | unit | Same as RUNNER-10 | Wave 0 |
| CONTAINER-03 | Host-side timer kills at `timeout_seconds` | unit | `pnpm test src/lib/__tests__/runner-timeout.test.ts -- --run` (fake timers) | Wave 0 |
| CONTAINER-04 | Reference image builds + runs end-to-end | integration (live docker) | `bash docker/hello-world-agent/build.sh && bash scripts/mc-runner-smoke.sh hello-world` | Wave 0 |
| WORK-01 | All 4 files seeded | unit | Same as RUNNER-09 | Wave 0 |
| WORK-02 | `.mc/task.json` shape matches CONTEXT lock | unit | Same as RUNNER-09, fixture-driven | Wave 0 |
| WORK-03 | Worktree survives crash, destroyed on terminal | integration | `bash scripts/mc-runner-smoke.sh preserve-across-crash` | Wave 0 |
| WORK-04 | Resume preamble content includes mandatory read steps | unit | `pnpm test src/lib/__tests__/runner-preamble.test.ts -- --run` (snapshot) | Wave 0 |
| WORK-05 | First-attempt preamble instructs progress.md writes | unit | Same as WORK-04 | Wave 0 |
| WORK-06 | `runner_max_attempts` cap → status='failed' | integration | Same as RUNNER-11, fixture with 3 prior attempts | Wave 0 |
| WORK-07 | GC tick destroys worktree for task terminal > 7 days | unit | `pnpm test src/lib/__tests__/runner-gc.test.ts -- --run` (fake clock) | Wave 0 |
| MODEL-04 | `MC_MODEL_PRIMARY = task.model_override ?? recipe.model.primary` | unit | `pnpm test src/app/api/runner/claim/__tests__/route.test.ts -- -t model` | Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test src/lib/__tests__/<module-under-test>.test.ts -- --run` + `pnpm typecheck`
- **Per wave merge:** `pnpm test` (all unit) + `pnpm typecheck` + `pnpm lint`
- **Phase gate:** `pnpm test:all` (lint + typecheck + test + build + e2e) + live hello-world smoke via `bash scripts/mc-runner-smoke.sh full` before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/app/api/runner/` directory + 6 new route stubs (each `__tests__/route.test.ts`)
- [ ] `src/lib/__tests__/runner-claim.test.ts` — atomic claim semantics
- [ ] `src/lib/__tests__/runner-heartbeat.test.ts` — staleness + persistence
- [ ] `src/lib/__tests__/runner-worktree-seed.test.ts` — `.mc/` seeding
- [ ] `src/lib/__tests__/runner-docker-args.test.ts` — argv composition (no live docker)
- [ ] `src/lib/__tests__/runner-env-file.test.ts` — env-file generation + cleanup
- [ ] `src/lib/__tests__/runner-timeout.test.ts` — timer behavior with fake clocks
- [ ] `src/lib/__tests__/runner-reconcile.test.ts` — mock `docker ps` output
- [ ] `src/lib/__tests__/runner-preamble.test.ts` — snapshot tests for both variants
- [ ] `src/lib/__tests__/runner-gc.test.ts` — tick behavior with fake clocks
- [ ] `scripts/mc-runner-smoke.sh` — manual-only smoke harness (hello-world, preserve-on-stop, preserve-across-crash)
- [ ] `scripts/com.missioncontrol.runner.plist` — LaunchAgent template
- [ ] `docker/hello-world-agent/{Dockerfile, agent.mjs, build.sh, README.md}`
- [ ] `recipes/hello-world/{recipe.yaml, SOUL.md}`
- [ ] Migration 060: `runner_heartbeats` table (per Open Question #5 recommendation)
- [ ] Migration 061: `task_runner_attempts` table (per Open Question #7 recommendation)
- [ ] Setting definition: `runtime.max_concurrent_containers` (extend `settingDefinitions` in `src/app/api/settings/route.ts`)
- [ ] Setting / column for project local-repo-path resolution (per Open Question #1 planner decision)

## Sources

### Primary (HIGH confidence)

- **Internal substrate (already shipped):**
  - `src/lib/runner-secret.ts` — runner-secret auto-gen + read (Phase 11-02)
  - `src/lib/runner-tokens.ts` — `issueRunnerToken` / `verifyRunnerToken` / `revokeTokensForTask` (Phase 11-04)
  - `src/lib/auth.ts:463-572, 776-837` — runner-secret (id=-1000) + runner-token (id=-2000) principals; `requireRunnerToken` wrapper
  - `src/lib/task-runtime-validation.ts` — `validateHostPathAgainstAllowlist`, `TASK_RUNTIME_ERROR_CODES`, `buildAggregatedValidationResponse` (Phase 13-01)
  - `src/lib/task-runtime-settings.ts` — `getMountAllowlist`, `getMountsCap`, `getExtraSkillsCap` (Phase 13-01)
  - `src/lib/recipe-indexer.ts:177` — `getIndexedRecipeBySlug` (Phase 12-02)
  - `src/lib/recipe-schema.ts` — `parseRecipeYaml` + Zod schema with MODEL-02 refine
  - `src/lib/recipe-watcher.ts:43-47` — `getRecipesRoot()` resolution
  - `src/lib/model-registry.ts` — `isKnownModel`, `getModel`, `MODELS`, `MODEL_IDS` (Phase 11-01)
  - `src/lib/event-bus.ts` — `eventBus.broadcast()` + `ServerEvent` shape; does NOT include `task.runner_requested` yet (Phase 15 adds)
  - `src/lib/migrations.ts:1559-1660` — migrations 054 (recipes) + 055 (task_runner_tokens) + 056 (task_checkpoints) + 057 (11 new task columns)
  - `src/lib/validation.ts:40-85` — `createTaskSchema` with Phase 13 runtime fields + `model_override` Zod refine
  - `src/app/api/events/route.ts` — SSE stream + `/api/events` endpoint shape
  - `src/app/api/tasks/[id]/route.ts:579-584` — atomic terminal revocation pattern (Phase 11-04 wiring)
  - `src/app/api/agents/[id]/heartbeat/route.ts` — heartbeat endpoint precedent (different semantics but useful pattern)
  - `src/app/api/settings/route.ts:18-75` — settingDefinitions + `runtime.*` prefix
  - `scripts/mc-cli.cjs:240-301` — SSE consumer with `fetch` + `ReadableStream` (zero-dep pattern)
  - `src/lib/command.ts` — existing `child_process.spawn` wrapper for reference
  - `.planning/phases/14-runner-container-v1-2/14-CONTEXT.md` — full decision lock

### Secondary (MEDIUM confidence)

- [node:child_process official docs](https://nodejs.org/api/child_process.html) — spawn options, stdio file descriptors, detached behavior
- [git-worktree official docs](https://git-scm.com/docs/git-worktree) — add/remove/list/lock/prune semantics, per-worktree HEAD + index sharing
- [launchd.plist(5)](https://keith.github.io/xcode-man-pages/launchd.plist.5.html) — KeepAlive, ThrottleInterval, EnvironmentVariables
- [Practical Guide to Git Worktree (DEV Community)](https://dev.to/yankee/practical-guide-to-git-worktree-58o0) — long-lived worktree best practices
- [Git Worktree Best Practices (gist.github.com/ChristopherA)](https://gist.github.com/ChristopherA/4643b2f5e024578606b9cd5d2e6815cc) — naming conventions + lock usage
- [A Launchd Tutorial (launchd.info)](https://www.launchd.info/) — full plist walkthrough
- [tjluoma/launchd-keepalive](https://github.com/tjluoma/launchd-keepalive) — KeepAlive plist templates

### Tertiary (LOW confidence)

- [dweinstein/docker-spawn](https://github.com/dweinstein/docker-spawn) — Node wrapper for Docker; reviewed for pattern ideas only (we don't use it)
- [How to reproduce docker run via Docker Remote API with Node.js (Medium)](https://medium.com/@johnnyeric/how-to-reproduce-command-docker-run-via-docker-remote-api-with-node-js-5918d7b221ea) — alternative transport we rejected

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every module is already in the repo and tested; Phase 14 is wiring
- Architecture patterns: HIGH — atomic claim, SSE consumer, recipe staging patterns all have direct precedent
- Don't Hand-Roll table: HIGH — every "use instead" is a named function with tests
- Common pitfalls: MEDIUM — Docker/git subprocess pitfalls (5, 6, 9) rely on web-sourced best practices + defensive programming; verify with smoke tests before relying on them
- Code examples: HIGH for in-repo, MEDIUM for docker/worktree snippets (spawn/stdio is standard Node; exact `docker logs -f` behavior depends on Docker version)
- Open Questions: 7 genuine blockers for the planner; recommendations provided but NOT locked

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (30 days — substrate is stable; external deps are long-stable CLIs)

## Sources

Sources:
- [Child process | Node.js v25.9.0 Documentation](https://nodejs.org/api/child_process.html)
- [Git - git-worktree Documentation](https://git-scm.com/docs/git-worktree)
- [launchd.plist(5)](https://keith.github.io/xcode-man-pages/launchd.plist.5.html)
- [Practical Guide to Git Worktree - DEV Community](https://dev.to/yankee/practical-guide-to-git-worktree-58o0)
- [A Launchd Tutorial (launchd.info)](https://www.launchd.info/)
- [tjluoma/launchd-keepalive](https://github.com/tjluoma/launchd-keepalive)
- [How to Use Git Worktree (GitKraken)](https://www.gitkraken.com/learn/git/git-worktree)
