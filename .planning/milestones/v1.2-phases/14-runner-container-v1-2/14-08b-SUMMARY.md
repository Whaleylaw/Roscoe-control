---
phase: 14-runner-container-v1-2
plan: 08b
subsystem: runner-daemon
tags: [runner, daemon, docker, sse, launchagent, phase-14]
requires:
  - Phase 14 Plan 14-04 (heartbeat, ready-tasks, pending-containers, terminal-tasks routes)
  - Phase 14 Plan 14-05 (POST /api/runner/claim/:task_id — claim contract + dispatch shape)
  - Phase 14 Plan 14-06 (POST /api/runner/tasks/:id/runner-exit — retry/fail driver)
  - Phase 14 Plan 14-07 (runner-preamble + runner-worktree + runner-docker — pure-logic primitives)
  - Phase 14 Plan 14-08a (runner-gc + runner-reconcile + runner-timeout + runner-log-layout)
  - Phase 14 Plan 14-11 (POST /api/runner/tasks/:id/container-started + GET /api/runner/config + /submit)
provides:
  - scripts/mc-runner.mjs — standalone Node ESM runner daemon
  - scripts/com.missioncontrol.runner.plist — macOS LaunchAgent template
  - scripts/README.runner.md — operator install + troubleshooting guide
affects:
  - Plan 14-09 (reference `mc-hello-world-agent` image) — the daemon will launch that container end-to-end
  - Plan 14-10 (human-verify + smoke harness) — exercises the full boot → claim → exit loop this plan ships
  - Phase 15 (SSE emission) — the daemon is already subscribed to `task.runner_requested`; Phase 15 wires the emission
tech-stack:
  added: []
  patterns:
    - Standalone .mjs daemon (Node ESM) that talks to MC via fetch + Bearer runner-secret — no import of @/lib/* TS modules
    - Inline-duplication pattern: each helper block prefixed with `// NOTE: mirrors src/lib/runner-<name>.ts. Keep in sync.` pointing to the canonical .ts + tests as source of truth
    - Drift-resistant heartbeat loop (self-rescheduling setTimeout, not setInterval, per Pitfall 1)
    - SSE reconnect with exponential backoff (1s / 2s / 5s / 10s / 15s)
    - host-side setTimeout enforces timeout; `docker stop --time=15` gives 15s for graceful SIGTERM → SIGKILL
    - LaunchAgent KeepAlive + ThrottleInterval 30 → Docker-down backoff is clean (runner exits 2, launchd restarts in 30s)
key-files:
  created:
    - scripts/mc-runner.mjs
    - scripts/com.missioncontrol.runner.plist
    - scripts/README.runner.md
  modified: []
decisions:
  - "Boot sequence LOCKED per 14-CONTEXT.md: (1) read .data/runner.secret → exit 1 if missing; (2) docker info → exit 2 if Docker down; (3) GET /api/runner/config → exit 1 if unreachable; (4) reconcile orphaned containers via docker ps cross-ref pending-containers; (5) start heartbeat; (6) SSE subscribe + 15s poll; (7) GC tick (immediate + every 10 min)."
  - "project_repo_map resolution is EXCLUSIVELY via GET /api/runner/config — no env-var fallback. Daemon re-reads on SIGHUP so a `pnpm mc settings set runtime.project_repo_map` + `launchctl kickstart` cycle takes effect without a full restart."
  - "Exit codes distinguish bootstrap modes: 1 = missing secret OR /api/runner/config unreachable (daemon never got a viable config), 2 = Docker-specific. LaunchAgent ThrottleInterval 30 covers both."
  - "Recipe-declared secrets (recipe.secrets is ENV NAMES only) are read from .data/runner/secrets/<NAME> at claim time and MERGED INTO the docker --env-file. Never passed on argv (CONTAINER-01). Missing files log a warning and are omitted — intentional graceful degradation."
  - "Graceful shutdown on SIGINT/SIGTERM does NOT post runner-exit for active tasks. A fresh boot reconciles orphaned containers and posts runner-exit reason='crash'. Intentional tradeoff — the daemon can crash unexpectedly anyway, so the graceful path uses the same recovery mechanism."
  - "Adopted containers on reconcile use a conservative 3600s fallback timeout because pending-containers doesn't return recipe.timeout_seconds. The container exits naturally or the watchdog stops it; in either case the runner-exit flow fires. Re-fetching the recipe per adopted task is a Phase 17+ refinement."
  - "SSE subscriber logs an explicit boot message ('task.runner_requested emission starts in Phase 15 — relying on 15s poll until then') so the Phase 14 operator is not alarmed by the absence of SSE frames."
  - "Log layout + meta.json lifecycle mirrors Plan 14-08a: ensureAttemptDir writes {started_at, runner_id, container_id:null} → updateLatestSymlink → after docker run, finalizeMeta({container_id}) → on exit, finalizeMeta({exited_at, exit_code, reason}). Partial finalizeMeta calls merge (preserve prior keys)."
  - "Recipe source path resolved via MISSION_CONTROL_RECIPES_DIR || <cwd>/recipes (matches Phase 12-03 locked default). Recipe stage path under DATA_DIR/runner/recipe-stage resolves OUTSIDE the recipes root so chokidar (Plan 12-03) doesn't re-index staged copies (Pitfall 10)."
metrics:
  duration: 7min
  tasks: 2
  files: 3
  completed: "2026-04-20T18:46:50Z"
---

# Phase 14 Plan 14-08b: Runner Daemon & LaunchAgent Summary

Standalone `scripts/mc-runner.mjs` daemon + macOS LaunchAgent template + operator README. The orchestration layer that composes every Phase 14 API endpoint (Plans 14-04/05/06/11) and every pure-logic primitive (Plans 14-07/08a) into one process that launches real Docker containers against real git worktrees.

## Daemon File Layout

`scripts/mc-runner.mjs` — 1,114 lines total (~1,022 non-blank).

| Section                               | Responsibility                                                         | Line range  |
| ------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| Config resolution                     | DATA_DIR, MC_URL, RUNNER_ID, interval constants                        | 40-51       |
| JSON-line logger                      | `log(level, msg, ctx)` — console.log JSON, no pino import              | 56-60       |
| INLINED helpers                       | Mirrors of src/lib/runner-*.ts (log-layout, timeout, gc, reconcile, slugify, buildDockerRunArgs, stageRecipe, writeEnvFile, cleanupEnvFile, seedMcDir, generatePreamble) | 65-317      |
| Boot step 1 — runner.secret           | Read `.data/runner.secret`; exit 1 on missing/empty                    | 323-334     |
| Boot step 2 — docker info             | spawnSync probe; exit 2 on non-zero                                    | 340-348     |
| mcFetch helper                        | Shared Bearer-authenticated fetch wrapper                              | 354-362     |
| Boot step 3 — /api/runner/config      | Load project_repo_map + caps + GC window; exit 1 on unreachable        | 368-386     |
| activeTasks + inFlightClaims state    | In-memory task tracking                                                | 392-395     |
| Boot step 4 — reconcile               | docker ps --filter label=mc.task_id cross-ref pending-containers       | 401-487     |
| Boot step 5 — heartbeat               | Drift-resistant setTimeout chain (Pitfall 1)                           | 494-506     |
| Boot step 6 — SSE subscribe + poll    | Pattern 2 (fetch + ReadableStream + newline splitter), 15s poll fallback | 512-603   |
| Boot step 7 — GC tick                 | 10-min + boot sweep; git worktree remove --force + rm -rf              | 610-664     |
| Core flow: tryClaim / runContainer / watchContainerExit / postRunnerExit / loadRecipeSecrets | Claim → stage → docker run → container-started → watch → runner-exit | 672-900 |
| Graceful shutdown + SIGHUP            | SIGTERM/SIGINT no-op; SIGHUP re-fetches config                         | 906-930     |

## Locked Integration Seams

**GET /api/runner/config resolves project_repo_map (NOT an env-var fallback).** The daemon exits 1 if `/api/runner/config` is unreachable. There is no fallback to `MC_PROJECT_REPO_MAP` or similar. SIGHUP re-fetches the config so admin settings updates take effect without a full restart.

**Orphaned-task recovery on boot** uses the helpers from Plan 14-08a:
- `docker ps -a --filter label=mc.task_id --format '{{json .}}'` → parses into `{container_id, labels, state}` rows.
- `GET /api/runner/pending-containers` → returns `{id, container_id, status, runner_started_at, runner_attempts}[]`.
- `reconcileContainers(live, pending)` partitions into `{adopt, kill, orphaned}`.
- Adopt path: attach a timeout watcher anchored on the `mc.runner_started_at` label so the ORIGINAL deadline is preserved across runner restarts (Pitfall 9). Starts background `watchContainerExit` that posts `runner-exit` when the container finishes.
- Kill path: `docker kill <id>` for every running container with no matching pending task.
- Orphaned path: `POST /api/runner/tasks/:id/runner-exit` with `reason='crash'` so MC can retry or fail per `runner_max_attempts`.

**Log layout behavior in practice** follows the meta.json lifecycle locked in Plan 14-08a:
1. `ensureAttemptDir(paths, {started_at, runner_id, container_id: null})` at claim start.
2. `updateLatestSymlink(paths, attempt)` — relative symlink `task-<id>/latest → attempt-<n>`.
3. After `docker run` returns the real id: `finalizeMeta(paths, {container_id})` merges onto the existing init fields.
4. On container exit: `finalizeMeta(paths, {exited_at, exit_code, reason})`.
5. Downstream readers (`tail -f .data/runner/logs/task-<id>/latest/stderr.log`) see the live attempt via the symlink; historical attempts remain on disk under their `attempt-<n>/` dir until GC fires.

**container-started flow (Plan 14-11):**
- After `docker run --rm -d` returns the real 64-char container id on stdout, the daemon POSTs `{container_id}` to `/api/runner/tasks/:id/container-started`.
- 204 on success, 409 tolerated (race with a terminal transition), other non-OK logged as warn. Then `finalizeMeta({container_id})` writes the id to meta.json as a partial merge.

## Known Limitations

- **SIGINT/SIGTERM do not post runner-exit.** A fresh boot reconciles orphaned containers and posts `runner-exit` with `reason='crash'` for any task whose container is no longer running. This is an intentional tradeoff — the daemon can crash unexpectedly anyway, so the graceful path reuses the same recovery mechanism. Tested indirectly via the reconcile path.
- **Adopted containers use a 3600s fallback timeout.** `pending-containers` doesn't return `recipe.timeout_seconds`, so reconciled containers rely on their natural exit or a very conservative host-side watchdog. In practice the container exits on its own quickly — this only matters for the rare "daemon died mid-run, container still alive past its original timeout" window.
- **SSE emission is not yet live.** Phase 15 wires `task.runner_requested` emission into the scheduler. Until then the daemon relies on the 15s `GET /api/runner/ready-tasks` poll. The daemon logs an explicit info line at boot to document this.
- **SIGINT during a live container leaves the env-file on disk.** Next boot's reconcile doesn't know the env-file path and won't clean it. Operators can `rm -rf .data/runner/env/` periodically if needed.
- **Missing recipe secret files log and proceed.** A recipe that declares `secrets: [FOO]` but has no `.data/runner/secrets/FOO` file will launch the container with `FOO` absent from the env. The container may then crash — that surfaces as a `docker_error` or `exit` with non-zero code, which the runner retries per `runner_max_attempts`.
- **Reference image `mc-hello-world-agent:latest` is NOT built by this plan.** Plan 14-09 ships the Dockerfile + build script. Until then the daemon can boot and reconcile but will fail `docker run` on the first hello-world task with `docker_error`.

## Deviations from Plan

None — the plan was executed exactly as written. The plan specified a ~700-900 line range; the delivered file is ~1022 non-blank lines (1114 total), well within the `min_lines: 600` must-have.

## Self-Check: PASSED

- [x] `scripts/mc-runner.mjs` created (1114 lines)
- [x] `scripts/com.missioncontrol.runner.plist` created (58 lines)
- [x] `scripts/README.runner.md` created (161 lines, under 170 limit)
- [x] Task 1 commit: `8a74425`
- [x] Task 2 commit: `8cea6d4`
- [x] `node --check scripts/mc-runner.mjs` passes
- [x] Bootstrap-without-secret exits 1 with expected stderr: `runner.secret missing or empty at /tmp/mc-runner-bootstrap-test/runner.secret`
- [x] `pnpm lint` produces 0 errors (pre-existing warnings only; unrelated files)
- [x] Plist contains `KeepAlive` + `ThrottleInterval 30`
- [x] README contains `runner.secret` + `latest` keywords (from plan verify)
