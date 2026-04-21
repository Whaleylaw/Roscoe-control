# Getting Started with Recipe Agents

This tutorial walks you from a fresh Mission Control install to your first recipe-tagged task completing via the ephemeral runner. Expect **10 minutes of wall-clock time** on a Docker-equipped machine.

By the end, you will see a task travel the full lifecycle — `assigned → in_progress → review → done` — entirely under agent control, with Mission Control's Progress tab as your live-view surface.

**Tutorial vs. reference.** This page is a linear walkthrough. For deep reference on any topic here, see the links at the end of each step, and the **[Next steps](#step-9-next-steps)** and **[Troubleshooting](#troubleshooting)** sections at the bottom.

## Prerequisites

- **Node.js 22+** (LTS recommended; 24.x also supported) — check with `node --version`
- **Docker Desktop** running — check with `docker info`
- **pnpm** — `corepack enable` to auto-install
- **`jq`** — optional but recommended for the JSON-parsing commands
- **A local git repo you control** — the runner will mount this read-only into the agent's container. The hello-world reference agent does not modify your repo; it commits inside an isolated git worktree under `.data/runner/worktrees/`.

Every command below is copy-paste runnable. No placeholders like `<your-host>` — we rely on `$VAR` shell variables exported earlier in the tutorial.

---

## Step 1: Install and boot Mission Control

```bash
git clone <your-mission-control-repo>
cd mission-control
pnpm install
pnpm build
pnpm dev           # starts on http://localhost:3000
```

Expected: A fresh Mission Control server on `http://localhost:3000`. On first boot, `AUTH_SECRET` and `API_KEY` auto-generate and persist to `.data/.auto-generated`. The runner's bearer credential (`.data/runner.secret`) is created the same way.

Visit `http://localhost:3000/setup` in a browser — if no admin account exists, create one. That completes initial login.

> **Note — standalone mode.** If you are deploying with `node .next/standalone/server.js` instead of `pnpm dev`, you MUST set `MISSION_CONTROL_RECIPES_DIR` to the repo's `recipes/` directory so the indexer can find recipe authorings. The standalone server's `cwd` is `.next/standalone/`, not the repo root, so the default recipes-root resolution misses your `recipes/` tree entirely. See [admin-config.md#standalone-mode-requirements](./admin-config.md#standalone-mode-requirements).

---

## Step 2: Export `MC_URL` and `MC_API_KEY`

Every subsequent command uses these two environment variables. Export them once in the terminal you will drive the tutorial from:

```bash
export MC_URL=http://127.0.0.1:3000
export MC_API_KEY=$(grep '^API_KEY=' .data/.auto-generated | cut -d= -f2-)

# Smoke-test your auth is working
curl -s -H "Authorization: Bearer $MC_API_KEY" "$MC_URL/api/status" | jq .
```

Expected: A JSON body with Mission Control's build/status fields. Anything else (401/403/HTML) means `MC_API_KEY` did not resolve — re-open `.data/.auto-generated` and confirm an `API_KEY=` line exists.

The API key is auto-generated on first boot and persists to `.data/.auto-generated`. See [admin-config.md#auth-tiers-and-secrets](./admin-config.md#auth-tiers-and-secrets).

---

## Step 3: Configure runtime settings

The runner needs to know two things before it can launch a container for your task:

1. **`runtime.mount_allowlist`** — which host paths it is permitted to mount into containers.
2. **`runtime.project_repo_map`** — which absolute git-repo path corresponds to each Mission Control `project_id`.

> ⚠️ **Pitfall (exclusive-path rule).** `runtime.project_repo_map` is the **only** way the runner learns where your repos live. There is no env-var fallback, no auto-discovery, no filesystem search. A misconfigured map makes `POST /api/runner/claim/:id` fail loud at boot. Always use `pnpm mc settings set` — never try to shortcut with an env var like `RUNNER_PROJECT_REPO_MAP`. See [admin-config.md#project-repo-map](./admin-config.md#project-repo-map).

Configure both settings. Substitute real paths for your filesystem:

```bash
# Allow the runner to mount paths below ~/Github (adjust to your repos root)
pnpm mc settings set runtime.mount_allowlist '["/Users/me/Github"]'

# Tell the runner that project_id 1 lives at this absolute path
pnpm mc settings set runtime.project_repo_map '{"1":"/Users/me/Github/my-repo"}'
```

Expected output (each command): a single JSON line confirming the key was written, e.g. `{"key":"runtime.project_repo_map","value":"{\"1\":\"/Users/me/Github/my-repo\"}","updated":true}`.

Verify the runner can read its config (this is the same endpoint the daemon will hit at boot):

```bash
curl -s -H "Authorization: Bearer $(cat .data/runner.secret)" \
  "$MC_URL/api/runner/config" | jq .
```

Expected:

```json
{
  "project_repo_map": { "1": "/Users/me/Github/my-repo" },
  "mount_allowlist": ["/Users/me/Github"],
  "max_concurrent_containers": 3,
  "failed_gc_window_days": 7
}
```

If `project_repo_map` comes back empty, your `pnpm mc settings set` write did not persist — re-run it with valid JSON single-quoted. The runner SIGHUP-reloads this config without a daemon restart once it's running, but for the first boot we want it correct up front. See [admin-config.md#runner-config-endpoint](./admin-config.md#runner-config-endpoint).

---

## Step 4: Build the reference container image

Mission Control ships a reference agent image (`mc-hello-world-agent:latest`) under `docker/hello-world-agent/`. It is the canonical worked example of the container contract — six steps, zero LLM calls, pure substrate verification.

```bash
pnpm mc:build-hello-world
# equivalent to:
# bash docker/hello-world-agent/build.sh
```

Expected (final line): `Successfully tagged mc-hello-world-agent:latest`

Verify:

```bash
docker images mc-hello-world-agent
```

Expected: a single row with the `latest` tag and a recent creation time.

The image implements the full 7-step Mission Control container contract: env snapshot → read preamble/SOUL → append `.mc/progress.md` → append `.mc/checkpoints.jsonl` → commit `HELLO.md` → POST submit → exit. Walk through it in [docker/hello-world-agent/README.md](../../docker/hello-world-agent/README.md), and see [agent-contract.md](./agent-contract.md) for the full substrate reference.

---

## Step 5: Start the runner daemon (separate terminal)

Open a **second terminal** at the repo root. The runner runs in the foreground here — leave this terminal open for the rest of the tutorial.

```bash
# In a second terminal, from the mission-control repo root:
node scripts/mc-runner.mjs
```

Expected (JSON log lines on stdout, one per line):

```json
{"level":"info","ts":"...","msg":"config loaded","project_repo_map_size":1,"failed_gc_window_days":7,"max_concurrent_containers":3}
{"level":"info","ts":"...","msg":"runner boot","runner_id":"runner-<host>-<pid>","mc_url":"http://127.0.0.1:3000"}
{"level":"info","ts":"...","msg":"reconcile","adopt":0,"kill":0,"orphaned":0}
```

The daemon is now polling for work via `POST /api/runner/claim`. See [runner-daemon.md#boot-sequence](./runner-daemon.md#boot-sequence) for the full 7-step boot sequence.

If the runner exits immediately:

- **Exit 1** — `.data/runner.secret` missing, or `GET /api/runner/config` unreachable. Confirm Mission Control is still running from Step 1.
- **Exit 2** — Docker daemon unreachable. Start Docker Desktop and retry.

See [runner-daemon.md#exit-codes](./runner-daemon.md#exit-codes).

---

## Step 6: Create a recipe-tagged task

Back in your **first terminal** (the one with `MC_URL` and `MC_API_KEY` exported), create a task tagged with the `hello-world` recipe. The runner will pick it up within a few seconds.

```bash
# Create a task; remember the task id for later steps
TASK=$(curl -s -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Hello world smoke",
    "recipe_slug": "hello-world",
    "status": "assigned",
    "workspace_source": { "project_id": 1, "base_ref": "main" }
  }')

export TASK_ID=$(echo "$TASK" | jq -r '.task.id // .id')
echo "Created task $TASK_ID"
```

Expected: `Created task <N>` where `<N>` is the new task's numeric id. The task starts in `assigned` because we passed `"status": "assigned"`; if you omit that field the task lands in `inbox` and the autoRoute path will move it to `assigned` once it resolves a recipe/owner. See [task-board-surfaces.md#event-wiring](./task-board-surfaces.md#event-wiring).

If the POST returns 400 with a message about `workspace_source`, confirm `project_id: 1` exists in your Projects panel (or change it to an id that does). The runner needs `project_repo_map` to carry that same id — which you configured in Step 3.

---

## Step 7: Watch the task progress (the two-hop lifecycle)

This is the payoff. You can watch the task travel through the runtime from three surfaces — pick the one that fits your workflow.

> ⚠️ **Pitfall (two-hop terminal transition).** When the agent POSTs submit, the task does **not** go directly to `done`. The submit route flips the task to `review` first; then `runAegisReviews()` (part of Mission Control's scheduler tick) flips `review → done` after approving the submission. If your task stops at `review`, check the review comments on the task. The body the agent sends literally is `{"status":"done"}` — this is the agent's declaration of intent, and the submit route translates it to `review`. See [agent-contract.md#submit-http-endpoint-the-two-hop-lifecycle](./agent-contract.md#submit-http-endpoint-the-two-hop-lifecycle).

**Option A — UI observation (recommended first time).** Open `http://localhost:3000`, click into the task you just created, and open the **Progress** tab. You will see, within ~10 seconds:

1. A checkpoint row for step `hello-world-smoke` appear with `status: completed`.
2. The task card's status transition from `assigned` → `in_progress` (runner claim).
3. After the container exits and posts submit, the task transitions to `review` (**not** directly to `done`).
4. The scheduler's next tick (Aegis review) flips the task `review → done`.

The Progress tab surfaces checkpoints, attempts, and log pointers. The task-card status pill reflects the Kanban column. See [task-board-surfaces.md#progress-tab](./task-board-surfaces.md#progress-tab).

**Option B — CLI observation.** In your first terminal, tail the event stream:

```bash
pnpm mc events watch --types task
```

Expected event sequence (lines abridged):

```text
task.runner_requested     { id: <TASK_ID>, ... }
task.container_started    { id: <TASK_ID>, container_id: ... }
task.checkpoint_added     { id: <TASK_ID>, step: hello-world-smoke, status: completed }
task.container_exited     { id: <TASK_ID>, reason: exit, exit_code: 0 }
task.status_changed       { id: <TASK_ID>, from: in_progress, to: review }
task.status_changed       { id: <TASK_ID>, from: review,      to: done }
```

The two-hop transition is visible as two distinct `task.status_changed` events.

**Option C — log-file tail.** Watch the container's stderr stream directly:

```bash
tail -f .data/runner/logs/task-$TASK_ID/latest/stderr.log
```

Expected: the six hello-world-agent steps logged as JSON lines, ending with a `step":"submit"` entry and a clean exit. The `latest/` symlink always points at the most recent attempt directory (`attempt-1/`, `attempt-2/`, ...) and is preserved after the task completes. See [runner-daemon.md#logs-layout](./runner-daemon.md#logs-layout).

---

## Step 8: Verify the workspace artifacts

The hello-world agent commits a single file, `HELLO.md`, inside the task's isolated git worktree. Worktrees live under `.data/runner/worktrees/task-<id>/` while the task is alive, and are destroyed on `done` (or retained for `runtime.failed_gc_window_days` on failure).

Because the worktree is GC'd after `done`, the most reliable way to inspect what the agent produced is the preserved log directory:

```bash
# The logs dir is preserved across task completion.
cat .data/runner/logs/task-$TASK_ID/attempt-1/stderr.log | tail -20
```

Expected: the tail shows six agent steps (env snapshot, read preamble/SOUL, append progress, append checkpoint, commit HELLO.md, POST submit) plus a clean `exit 0`.

If you tailed the log during the run and caught the worktree before GC, you would have also seen:

- `.data/runner/worktrees/task-$TASK_ID/HELLO.md` — the committed artifact
- `.data/runner/worktrees/task-$TASK_ID/.mc/progress.md` — append-only progress log
- `.data/runner/worktrees/task-$TASK_ID/.mc/checkpoints.jsonl` — append-only checkpoints

The `.mc/` contents are append-only across attempts — the agent contract requires `fs.appendFileSync`, never `fs.writeFileSync`. See [agent-contract.md#progress--checkpoints-append-only](./agent-contract.md#progress--checkpoints-append-only).

---

## Step 9: Next steps

You now have a working recipe-agent pipeline. To go further:

- **Author a NEW recipe.** Start from `recipes/hello-world/` and follow the `recipe.yaml` schema reference: [recipes.md](./recipes.md).
- **Understand the full container contract** — every env var, mount, and HTTP seam: [agent-contract.md](./agent-contract.md).
- **Tune admin settings** — concurrency caps, resource limits, failed-GC window, secrets store: [admin-config.md](./admin-config.md).
- **Understand every UI surface** on the task board: [task-board-surfaces.md](./task-board-surfaces.md).
- **Deep-dive the runner daemon** — LaunchAgent install, log layout, heartbeat/poll fallback: [runner-daemon.md](./runner-daemon.md) and [scripts/README.runner.md](../../scripts/README.runner.md).

If you plan to run recipe-agent workloads in production, the [admin-config.md](./admin-config.md) page is the most important second read — it documents all 8 `runtime.*` keys, the secrets store layout, auth tiers, and the standalone-mode caveats. For CI or headless smoke-testing, see the end-to-end harness at [`scripts/mc-runner-smoke.sh`](../../scripts/mc-runner-smoke.sh) (the script this tutorial adapts).

---

## Troubleshooting

First-run issues almost always fall into one of the six rows below. Each row cross-links the authoritative remediation.

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| Task stays in `inbox` | Scheduler never routed the task, or the recipe is not indexed. | Check the Recipes panel in the UI for an error row under `hello-world`; run `POST /api/recipes/resync` if needed. See [recipes.md#common-errors](./recipes.md#common-errors). |
| Task stays in `assigned` | Runner is offline — not polling for claims. | Confirm the Step-5 terminal is still running. If it exited, inspect `.data/runner/daemon.err` and match the exit code against [runner-daemon.md#exit-codes](./runner-daemon.md#exit-codes). |
| UI banner says 🟢 runner online but nothing happens | 90s stale-window gotcha — the runner's last heartbeat is still fresh even though Docker is down and the process has crashed. | Restart the runner and watch for exit 2 (Docker unreachable). See [task-board-surfaces.md#runnerstatusbanner](./task-board-surfaces.md#runnerstatusbanner) and [runner-daemon.md#exit-codes](./runner-daemon.md#exit-codes). |
| Agent logs show `401` on submit | Runner-token expired — the task ran past `recipe.timeout_seconds + 60s`. | The token is bounded by the recipe's `timeout_seconds`; bump it in `recipe.yaml` or split the work. See [agent-contract.md#runner-token-lifetime](./agent-contract.md#runner-token-lifetime). |
| Agent logs show `404`/hang on `http://localhost:3000` | Container code used `localhost` instead of `$MC_API_URL`. Inside the container, `MC_API_URL` is `http://host.docker.internal:<port>`. | Fix the agent's HTTP client to read `process.env.MC_API_URL`. See [agent-contract.md#container-env-vars](./agent-contract.md#container-env-vars). |
| Task stuck at `review` | Aegis's scheduler tick has not run yet, or review failed. | Wait ~30s for the next scheduler tick; if the task stays at `review`, open the task detail and check the review comments. See [agent-contract.md#submit-http-endpoint-the-two-hop-lifecycle](./agent-contract.md#submit-http-endpoint-the-two-hop-lifecycle). |

For the full reference stack, start at [docs/runtime/](./) and read the five surface docs in any order.
