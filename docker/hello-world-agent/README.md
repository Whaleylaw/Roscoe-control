# mc-hello-world-agent

Minimal Mission Control reference agent image. Exercises the full Phase 14 container contract (env vars, mounts, preamble, progress/checkpoints, git commit, runner-token submit-to-done) without calling any external model provider. Plan 14-10's smoke harness launches this image to prove end-to-end wiring — dispatch payload, env-file, mount layout, runner-token round-trip, terminal-flip — all the way from `POST /api/runner/claim/:id` to `task.status = 'done'`.

## Build

```bash
bash docker/hello-world-agent/build.sh
# OR
pnpm mc:build-hello-world
```

Either command runs `docker build -t mc-hello-world-agent:latest .` from this directory. No registry push — the image stays local. Re-run after editing `agent.mjs` or the `Dockerfile`.

## What it does (7 steps)

On launch the container executes `node /app/agent.mjs`, which performs:

1. **Env snapshot.** Logs `MC_TASK_ID`, `MC_API_URL`, `MC_MODEL_PRIMARY`, `MC_PREAMBLE_PATH`, `MC_WORKSPACE`, `MC_RECIPE_PATH`, and whether `MC_API_TOKEN` is present (never the token value).
2. **Read preamble + SOUL.** Reads `$MC_PREAMBLE_PATH` (runner-authored at claim time) and `$MC_RECIPE_PATH/SOUL.md` (recipe-authored).
3. **Append progress.md.** Appends a timestamped greeting line to `/workspace/.mc/progress.md`.
4. **Append checkpoints.jsonl.** Appends one JSON line (step `hello-world-smoke`, status `completed`) to `/workspace/.mc/checkpoints.jsonl`. Note: Phase 14 has no HTTP checkpoint endpoint — `POST /api/runner/checkpoint` lands in Phase 15. The file-write here IS the Phase-14 checkpoint surface.
5. **Commit HELLO.md.** Writes `/workspace/HELLO.md`, `git add` + `git commit -m "hello-world: task <id>"` inside the worktree.
6. **POST submit.** Sends `POST {MC_API_URL}/api/runner/tasks/{MC_TASK_ID}/submit` with `Authorization: Bearer {MC_API_TOKEN}` and body `{"status":"done"}`. This is the Plan 14-11 submit route, NOT `PUT /api/tasks/:id` — the runner-token allowlist in `src/lib/runner-tokens.ts` only permits `/api/runner/tasks/:id/*` paths. Non-2xx → exits 3. Network throw → exits 4.
7. **Exit 0.** Process exits cleanly. The runner's `runner-exit` reporter records the attempt; the submit in step 6 is what flips `task.status` to `done`.

## Expected environment variables

Runner composes these via `POST /api/runner/claim/:task_id` and passes them into the container via `docker run --env-file`:

- `MC_API_URL` — `http://host.docker.internal:<port>` (URL the container uses to reach MC)
- `MC_TASK_ID` — string
- `MC_API_TOKEN` — per-task runner-token (principal id `-2000`); expires after `runner_started_at + recipe.timeout_seconds + 60s`
- `MC_WORKSPACE` — `/workspace`
- `MC_RECIPE_PATH` — `/recipe`
- `MC_PREAMBLE_PATH` — `/recipe/PREAMBLE.md`
- `MC_MODEL_PRIMARY`, `MC_MODEL_PROVIDER`, `MC_MODEL_PARAMS_JSON` — resolved at claim time (`task.model_override ?? recipe.model.primary`)
- `MC_MODEL_FALLBACK` — optional

The container never receives secret values on its `docker run` argv — per the CONTAINER-01 invariant, secrets flow via `--env-file` only.

## Manual run (debugging)

To exercise `agent.mjs` outside the runner you must fake the mount layout and env. The submit step (6) will fail without a real runner-token, which is expected:

```bash
# 1. Create synthetic mount dirs
tmp=$(mktemp -d)
mkdir -p "$tmp/workspace/.mc" "$tmp/recipe"
# Minimal workspace git init so the commit in step 5 succeeds
git -C "$tmp/workspace" init -q && git -C "$tmp/workspace" commit --allow-empty -qm init
echo "# fake preamble" > "$tmp/recipe/PREAMBLE.md"
echo "# fake soul"     > "$tmp/recipe/SOUL.md"

# 2. Run the image with fake env (MC_API_TOKEN is a stub; step 6 will 401)
docker run --rm \
  -v "$tmp/workspace:/workspace" \
  -v "$tmp/recipe:/recipe:ro" \
  -e MC_API_URL="http://host.docker.internal:3000" \
  -e MC_TASK_ID="debug-1" \
  -e MC_API_TOKEN="fake-token-will-401" \
  -e MC_WORKSPACE="/workspace" \
  -e MC_RECIPE_PATH="/recipe" \
  -e MC_PREAMBLE_PATH="/recipe/PREAMBLE.md" \
  -e MC_MODEL_PRIMARY="claude-sonnet-4-5" \
  --add-host host.docker.internal:host-gateway \
  mc-hello-world-agent:latest

# 3. Inspect the workspace after the run
cat "$tmp/workspace/.mc/progress.md"
cat "$tmp/workspace/.mc/checkpoints.jsonl"
git -C "$tmp/workspace" log --oneline
```

The container will log steps 1–5 as successful JSON log lines, then exit 3 on the submit (because the stub token fails the runner-token allowlist). That's the intended debug outcome — the runner-driven smoke harness in Plan 14-10 exercises the full happy path.

## Limitations / Phase 17 TODO

- Single-shot happy path — no failure-mode variants (`fail`, `timeout`, `blocked-checkpoint`) in Phase 14.
- Phase 17 will add an `MC_HELLO_MODE` env var switch so integration tests can exercise the runner's retry / timeout / terminal-fail paths without a live model.
- No LLM calls, no SDKs, no cost. Pure substrate verification.
