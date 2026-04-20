# Mission Control Runner Daemon

`scripts/mc-runner.mjs` is a standalone Node ESM daemon that claims
recipe-tagged tasks from Mission Control and launches short-lived Docker
containers against a per-task git worktree. It is the counterpart to the
REST API layer shipped in Phases 14-04 / 14-05 / 14-06 / 14-11 — the daemon
consumes those endpoints end-to-end.

## What the runner does

Boots, reads `.data/runner.secret`, verifies Docker is reachable, pulls its
config (project→repo map, concurrency caps, GC window) from
`GET /api/runner/config`, reconciles orphaned containers from a previous
run, subscribes to `task.runner_requested` SSE events with a 15s poll
fallback, atomically claims tasks via `POST /api/runner/claim/:id`, seeds
`.mc/` inside the task's worktree, launches the container via
`docker run --rm -d`, reports the real container id via
`POST /api/runner/tasks/:id/container-started`, streams stdout/stderr to
`.data/runner/logs/task-<id>/attempt-<n>/`, enforces the recipe timeout,
and posts `runner-exit` when the container exits. A 10-minute GC tick
destroys worktrees + logs for terminal tasks.

## Prerequisites

- Docker Desktop running (daemon reachable at the default socket)
- Node.js >= 22
- `.data/runner.secret` (auto-generates on first MC boot; see
  `src/lib/runner-secret.ts`)
- Mission Control server running at `MC_URL` (default
  `http://127.0.0.1:3000`)

## First run (foreground)

From the repository root:

```bash
node scripts/mc-runner.mjs
```

You should see JSON log lines on stdout:

```json
{"level":"info","ts":"...","msg":"config loaded","project_repo_map_size":1,"failed_gc_window_days":7,"max_concurrent_containers":3}
{"level":"info","ts":"...","msg":"runner boot","runner_id":"runner-host-12345","mc_url":"http://127.0.0.1:3000","data_dir":".../.data"}
{"level":"info","ts":"...","msg":"reconcile","adopt":0,"kill":0,"orphaned":0}
{"level":"info","ts":"...","msg":"SSE subscribed; task.runner_requested emission starts in Phase 15 — relying on 15s poll until then"}
```

Ctrl-C exits. The next boot reconciles any containers left running.

Exit codes:

| Code | Meaning |
| ---- | ------- |
| 1    | Bootstrap failed — `.data/runner.secret` missing or `/api/runner/config` unreachable |
| 2    | Docker daemon unreachable |

## LaunchAgent install (macOS)

1. Copy the template:
   ```bash
   cp scripts/com.missioncontrol.runner.plist ~/Library/LaunchAgents/com.missioncontrol.runner.plist
   ```
2. Search-replace `__MC_ROOT__` with the absolute path to this repository:
   ```bash
   sed -i '' "s|__MC_ROOT__|$(pwd)|g" ~/Library/LaunchAgents/com.missioncontrol.runner.plist
   ```
3. Load and start:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.missioncontrol.runner.plist
   launchctl kickstart "gui/$(id -u)/com.missioncontrol.runner"
   ```
4. Watch logs:
   ```bash
   tail -f .data/runner/daemon.err
   tail -f .data/runner/daemon.log
   ```

`KeepAlive + ThrottleInterval 30` means launchd restarts the daemon after
30s whenever it exits — including the clean `exit 2` when Docker is down.

## Project-repo mapping

The daemon resolves `workspace_source.project_id` to a local git repo path
via the `runtime.project_repo_map` admin setting. Update it with:

```bash
pnpm mc settings set runtime.project_repo_map '{"1":"/abs/path/to/repo-for-project-1"}'
```

The daemon calls `GET /api/runner/config` at startup and on `SIGHUP` to
load that map — there is no env-var fallback. After a settings update, send
the daemon SIGHUP (or `launchctl kickstart` the LaunchAgent) so the new
mapping takes effect.

## Recipe-declared secrets

Recipes declare secret env var NAMES in `recipe.yaml` (e.g.
`secrets: [ANTHROPIC_API_KEY]`). The server never sees the values — the
runner reads them from the filesystem at claim time and merges them into
the docker `--env-file`:

```bash
install -m 0600 /dev/stdin .data/runner/secrets/ANTHROPIC_API_KEY <<<'sk-...'
```

Missing secret files log a warning and are omitted from the env-file.

## Logs layout

Per attempt:

```
.data/runner/logs/task-<id>/
├── attempt-<n>/
│   ├── stdout.log
│   ├── stderr.log
│   └── meta.json   { started_at, runner_id, container_id, exited_at?, exit_code?, reason? }
└── latest → attempt-<n>
```

`latest` is a relative symlink updated at every new attempt. To follow a
live run, point `tail -f` at the symlink:

```bash
tail -f .data/runner/logs/task-42/latest/stderr.log
```

## Troubleshooting

- **runner exits 1 (`runner.secret missing`)** — run `pnpm dev` once to
  auto-generate the secret, then re-launch the runner.
- **runner exits 1 (`/api/runner/config unreachable`)** — ensure MC is
  running at `MC_URL` and responds to
  `curl -H "Authorization: Bearer $(cat .data/runner.secret)" $MC_URL/api/runner/config`.
- **runner exits 2** — Docker daemon is not reachable. Open Docker
  Desktop and wait for the whale icon to stop animating.
- **task stays in `assigned`** — tail `.data/runner/daemon.log` for
  claim errors (HTTP status codes, schema mismatches).
- **container starts but immediately exits** — check
  `.data/runner/logs/task-<id>/latest/stderr.log`. Common causes: missing
  recipe-declared secret, bad `MC_API_URL`, image entrypoint crash.
- **task stuck with `container_id = 'pending:<id>:<attempt>'`** — the
  daemon's `container-started` POST failed. Check `daemon.err` for the
  HTTP error; the reconcile step on next runner boot will not recover
  this (the container already exited because `--rm` removed it).
- **worktree not cleaned up after task done** — the GC tick runs every
  10 min; wait, or restart the runner to force an immediate sweep.
- **failed task's worktree lingers** — intentional. Retained for
  `runtime.failed_gc_window_days` (default 7). Adjust via
  `pnpm mc settings set runtime.failed_gc_window_days 3`.

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.missioncontrol.runner.plist
rm ~/Library/LaunchAgents/com.missioncontrol.runner.plist
```

Worktrees and logs under `.data/runner/` remain — delete manually if
desired.
