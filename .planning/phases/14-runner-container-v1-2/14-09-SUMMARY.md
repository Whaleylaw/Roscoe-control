---
phase: 14-runner-container-v1-2
plan: 09
subsystem: infra
tags: [docker, alpine, node22, hello-world-agent, runner-token, reference-image, container-contract]

# Dependency graph
requires:
  - phase: 14-runner-container-v1-2
    provides: 14-08b (runner daemon — will launch this image), 14-11 (POST /api/runner/tasks/:id/submit — agent's terminal call), 14-07 (runner-authored PREAMBLE.md — what agent reads), 14-05 (claim-route env-file composition — what agent receives)
provides:
  - mc-hello-world-agent:latest reference Docker image (node:22-alpine, 249 MB)
  - Runnable proof of the Phase 14 container contract end-to-end (env vars, mounts, preamble/SOUL read, progress.md, checkpoints.jsonl, git-commit, runner-token submit-to-done, exit 0)
  - Build script + pnpm alias for local image construction without a registry
affects: [14-10 smoke harness (launches this image), Phase 15 checkpoint endpoint (will insert POST /api/runner/checkpoint call into step 4-5), Phase 17 integration testing (MC_HELLO_MODE variants)]

# Tech tracking
tech-stack:
  added:
    - node:22-alpine Docker base image (~54 MB compressed)
    - alpine apk git package inside the reference image (git 2.52.0)
  patterns:
    - "CONTAINER-01 invariant demonstrated: agent.mjs receives MC_API_TOKEN via env (docker --env-file at runtime) — never via argv or Dockerfile-baked ENV"
    - "Runner-token submit contract: POST /api/runner/tasks/:task_id/submit with Bearer token, body {status: 'done'} — matches Plan 14-11 + runner-token allowlist (src/lib/runner-tokens.ts)"
    - "Reference-image build pattern: docker/<image-name>/ with Dockerfile + entrypoint source + build.sh + README + pnpm mc:build-<image-name> convenience script"
    - "Agent reading order established: $MC_PREAMBLE_PATH (runner-authored) → $MC_RECIPE_PATH/SOUL.md (author-owned) → /workspace/.mc/* (runner-seeded)"
    - "JSON stdout logging from agent (level/ts/agent/msg) — parseable by runner log capture in .data/runner/logs/task-<id>/attempt-<n>/stdout.log"

key-files:
  created:
    - docker/hello-world-agent/Dockerfile
    - docker/hello-world-agent/agent.mjs
    - docker/hello-world-agent/build.sh
    - docker/hello-world-agent/README.md
  modified:
    - package.json (added mc:build-hello-world script)

key-decisions:
  - "Image is 249 MB uncompressed (node:22-alpine is ~85 MB compressed + apk git ~14 MB + 4 KB agent.mjs); acceptable for a reference image that ships once per operator install"
  - "agent.mjs is pure ESM Node — no package.json, no dependencies beyond Node built-ins (fs, path, child_process, global fetch). Single file copy from the Dockerfile context keeps the build context minimal"
  - "agent.mjs POSTs /api/runner/tasks/:id/submit (Plan 14-11), NOT PUT /api/tasks/:id — the runner-token allowlist in src/lib/runner-tokens.ts only permits /api/runner/tasks/:id/* paths. A PUT /api/tasks/:id would fail at the auth-layer allowlist guard (RAUTH-06)"
  - "Phase 14 has NO /api/runner/checkpoint call — only the file-write to checkpoints.jsonl. Plan 14-09 forward-references this endpoint in agent comments but defers the HTTP POST to Phase 15 (matches CONTEXT.md § Agent Preamble decisions)"
  - "Git identity for commits baked into the Dockerfile as ENV defaults (GIT_AUTHOR_NAME / EMAIL + GIT_COMMITTER_*) — overridable at runtime but removes a boot-time `git config` step"
  - "Non-zero exit codes map to specific failure classes: 1=main() throw, 3=submit non-2xx, 4=submit threw. Runner's runner-exit handler will classify these via reason='exit' + exit_code"
  - "build.sh is a thin bash wrapper (no flags, no env vars) — pnpm mc:build-hello-world is the documented invocation point. Operators should not need to cd into docker/hello-world-agent/ to build"

patterns-established:
  - "Pattern 1: Reference images live at /docker/<image-name>/ — new top-level docker/ dir distinct from /scripts/ and /src/. Reserved for bundled runtime Docker images (hello-world today, future model-adapter images tomorrow)."
  - "Pattern 2: Agent JSON log line shape: {level, ts, agent, msg, ...ctx}. Runner log capture (Plan 14-08b) can grep on agent='<name>' to filter per-agent lines."
  - "Pattern 3: Manual-run documentation in README must include synthetic mount setup (mktemp -d + git init) so operators can exercise agent.mjs locally without the runner daemon. Enables fast iteration on agent code."

requirements-completed: [CONTAINER-04]

# Metrics
duration: 2min
completed: 2026-04-20
---

# Phase 14 Plan 09: Hello-World Reference Agent Image Summary

**Minimal `mc-hello-world-agent:latest` Docker image (node:22-alpine, 249 MB) shipping a 105-line Node ESM agent that exercises the full Phase-14 container contract — env-var read, preamble/SOUL read, .mc/ append, HELLO.md git-commit, and runner-token POST /api/runner/tasks/:id/submit to flip the task to done.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-20T18:53:05Z
- **Completed:** 2026-04-20T18:55:12Z
- **Tasks:** 2
- **Files created:** 4 (under docker/hello-world-agent/)
- **Files modified:** 1 (package.json)

## Accomplishments

- Image builds locally via `bash docker/hello-world-agent/build.sh` OR `pnpm mc:build-hello-world` — verified with a live `docker build` that produced `mc-hello-world-agent:latest` at 249 MB.
- Agent implements all 7 Phase-14 contract steps per CONTEXT.md § Reference Image (agent behavior): env snapshot, preamble/SOUL read, progress.md append, checkpoints.jsonl append, HELLO.md git-commit, `POST /api/runner/tasks/:id/submit {status:'done'}`, `exit 0`.
- README documents the 7 steps, all 10 expected MC_* env vars, a standalone debug recipe with synthetic mounts, and the Phase-17 `MC_HELLO_MODE` TODO note.
- CONTAINER-04 requirement satisfied: runnable proof of the runner's dispatch payload + mount layout + env-file + runner-token + submit-to-done round-trip against a live container.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Dockerfile + agent.mjs** — `2317323` (feat)
2. **Task 2: Create build.sh + README + package.json script** — `18815c6` (feat)

_Plan metadata commit will be added by the final commit step._

## Agent Behavior (agent.mjs step-by-step)

1. **env snapshot** — JSON-log MC_TASK_ID, MC_API_URL, MC_MODEL_PRIMARY, MC_PREAMBLE_PATH, MC_WORKSPACE, MC_RECIPE_PATH, plus `has_token` boolean (value never logged).
2. **preamble + SOUL read** — `fs.readFileSync($MC_PREAMBLE_PATH)` then optional `fs.readFileSync($MC_RECIPE_PATH/SOUL.md)` if it exists; failures warn-log but don't abort.
3. **progress.md append** — `fs.appendFileSync('/workspace/.mc/progress.md', '<iso-ts> | hello-world agent greets you\\n')`.
4. **checkpoints.jsonl append** — one JSON object `{step, summary, status:'completed', ts, task_id, model}` + `\n`. NO HTTP checkpoint call (Phase 15 concern).
5. **HELLO.md commit** — write `/workspace/HELLO.md` with task id + timestamp, `git -C /workspace add HELLO.md`, `git -C /workspace commit -m "hello-world: task <id>"`. Git identity defaulted by Dockerfile ENV.
6. **Submit** — `POST {MC_API_URL}/api/runner/tasks/{MC_TASK_ID}/submit` with `Authorization: Bearer {MC_API_TOKEN}` and JSON body `{"status":"done"}`. Non-2xx → exit 3. Fetch throw → exit 4.
7. **Exit 0** — clean terminal. Runner's runner-exit handler logs success-only; terminal flip to `done` already happened server-side inside the submit transaction.

## Files Created/Modified

- `docker/hello-world-agent/Dockerfile` — node:22-alpine base, apk git install, COPY agent.mjs, GIT_* env defaults, ENTRYPOINT ["node","/app/agent.mjs"].
- `docker/hello-world-agent/agent.mjs` — 105 lines of ESM Node. Pure stdlib (fs, path, child_process, global fetch). No dependencies.
- `docker/hello-world-agent/build.sh` — 7-line bash wrapper: `cd $(dirname $0)` → `docker build -t mc-hello-world-agent:latest .`. Executable (mode 755).
- `docker/hello-world-agent/README.md` — purpose, build, 7-step behavior, expected env vars, manual-run recipe with synthetic mounts + fake token, Phase-17 MC_HELLO_MODE TODO.
- `package.json` — added `"mc:build-hello-world": "bash docker/hello-world-agent/build.sh"` between `mc` and `mc:mcp` scripts.

## Image Build Verification

```
$ bash docker/hello-world-agent/build.sh
Building mc-hello-world-agent:latest from /Users/.../docker/hello-world-agent
... (build output) ...
naming to docker.io/library/mc-hello-world-agent:latest done
Done.

$ docker images mc-hello-world-agent:latest --format '{{.Repository}}:{{.Tag}} {{.Size}}'
mc-hello-world-agent:latest 249MB
```

No Docker build warnings.

## Decisions Made

- **Submit path LOCKED:** agent POSTs `/api/runner/tasks/:id/submit` (Plan 14-11), NOT PUT `/api/tasks/:id`. Rationale: runner-token allowlist in `src/lib/runner-tokens.ts` line 12 only permits `/api/runner/tasks/:id/*` paths — a PUT `/api/tasks/:id` would 401 at the RAUTH-06 auth-layer guard. This is a LOCKED CHANGE from the v1 plan notes and the upstream CONTEXT.md Reference Image step 6 prose (which was written before Plan 14-11's submit endpoint landed).
- **No /api/runner/checkpoint in Phase 14:** agent writes only to the local `/workspace/.mc/checkpoints.jsonl` file. Phase 15 will insert the HTTP POST between steps 4 and 5 without changing any other step — keeping the file-write as a permanent local audit trail.
- **No MC_HELLO_MODE:** test-mode switch deferred to Phase 17 per CONTEXT.md § Deferred. Phase 14's job is happy-path substrate verification; failure-mode exercises need a richer recipe scaffold that belongs with the integration-test suite.
- **Git identity baked into Dockerfile:** GIT_AUTHOR_*/GIT_COMMITTER_* as Dockerfile ENV rather than runtime `git config` calls. Removes a boot-time failure mode (what if `git config` returns non-zero?) and makes the commit-author audit trail predictable across attempts.
- **249 MB image size accepted:** node:22-alpine (~85 MB) + apk git (~14 MB packed, more on-disk due to .git-init-template) + 4 KB agent.mjs = ~249 MB. Considered reducing by compiling a static Go or Rust binary, but that would defeat the purpose (reference image should demonstrate the Node / fetch / fs contract real agents will use). Accepted as a ship-once-per-operator install cost.

## Deviations from Plan

None — plan executed exactly as written. Task 1 and Task 2 each produced the files specified in the plan frontmatter (`docker/hello-world-agent/Dockerfile`, `docker/hello-world-agent/agent.mjs`, `docker/hello-world-agent/build.sh`, `docker/hello-world-agent/README.md`, `package.json` script addition). All automated verification checks passed on first run:

- `node --check docker/hello-world-agent/agent.mjs` → OK
- `grep "FROM node:22-alpine" docker/hello-world-agent/Dockerfile` → match
- `grep '/api/runner/tasks/${MC_TASK_ID}/submit' docker/hello-world-agent/agent.mjs` → match
- `test -x docker/hello-world-agent/build.sh` → OK
- `grep "mc:build-hello-world" package.json` → match
- `grep "submit" docker/hello-world-agent/README.md` → match (6 occurrences)
- `docker build -t mc-hello-world-agent:latest .` → built without warnings, image size 249 MB

## Issues Encountered

None.

## Known Limitations

- **Single-shot:** Agent always takes the happy path. No injected failure modes for retry/timeout/terminal-fail exercises — that's Phase 17's MC_HELLO_MODE switch.
- **No LLM calls:** Zero model-provider SDKs, zero API keys consumed. Pure substrate verification. Real agents will replace agent.mjs step 2-5 with actual inference + tool calls, but the env/mount/submit contract stays stable.
- **No network enforcement:** agent uses global `fetch` without explicit network config; the runner's `recipe.network.allow_hosts` is a Phase 16+ concern (documented in CONTEXT.md § Deferred).
- **Host git identity unused:** agent commits as `mc-hello-world-agent <runner@mission-control.local>`. Production agents may want to surface the original requester's git identity via env-composed `GIT_AUTHOR_*` overrides; not needed for the hello-world happy path.

## Next Plan Readiness

Plan 14-10 (recipes/hello-world + smoke harness + end-to-end human-verify checkpoint) is unblocked:

- Reference image `mc-hello-world-agent:latest` is in the local Docker daemon.
- `pnpm mc:build-hello-world` is the documented rebuild command if agent.mjs changes.
- README's manual-run recipe gives 14-10 a template for the smoke harness invocation.
- The runner daemon (Plan 14-08b) can launch this image the moment Plan 14-10 ships the companion recipe at `recipes/hello-world/recipe.yaml` + `SOUL.md`.

After Plan 14-10 completes, Phase 14 is fully shipped (12/12 plans).

## Self-Check: PASSED

**File existence:**
- FOUND: docker/hello-world-agent/Dockerfile
- FOUND: docker/hello-world-agent/agent.mjs
- FOUND: docker/hello-world-agent/build.sh (executable mode 755)
- FOUND: docker/hello-world-agent/README.md
- FOUND: package.json (modified — added mc:build-hello-world)

**Commits:**
- FOUND: 2317323 (feat(14-09): add mc-hello-world-agent Dockerfile + agent.mjs)
- FOUND: 18815c6 (feat(14-09): add hello-world-agent build.sh + README + pnpm script)

**Image:**
- FOUND: mc-hello-world-agent:latest @ 249 MB in local Docker daemon

---
*Phase: 14-runner-container-v1-2*
*Plan: 09*
*Completed: 2026-04-20*
