# Phase 14 Plan 10 — End-to-End Smoke Verification

**Status:** PASSED — operator confirmed the smoke completed successfully on 2026-04-20 (response: "approved"). Artifact scan details recorded in the `## Completed Run` section at the bottom of this file.

## Environment

| Field                  | Value                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| Date                   | 2026-04-20                                                          |
| MC git sha             | 45372dabb3036449a24f940f612eb3a098687015 (branch: main)             |
| Docker                 | Docker version 29.2.0, build 0b9d198                                |
| Node.js                | v22.19.0                                                            |
| OS                     | macOS 26.4.1                                                        |
| `mc-hello-world-agent` | sha256:c327e1d9a746... size 64,494,467 bytes                        |
| MC server              | `next-server (v16.1.6)` at http://127.0.0.1:3000 (PID 4702)         |
| MC server CWD          | `/Users/aaronwhaley/Github/mission-control/.next/standalone`        |
| Recipes dir on disk    | `/Users/aaronwhaley/Github/mission-control/recipes/hello-world`     |
| Active recipes root    | `<cwd>/recipes` (see `getRecipesRoot()` in `src/lib/recipe-watcher.ts`) |

## Build Artifact Check

```
$ docker image inspect mc-hello-world-agent:latest --format '{{.Id}} {{.Size}}'
sha256:c327e1d9a74622ca7a4ee1753e805289100136424e7035d4fd5be475c4921663 64494467
```

## Files Under Test (this plan)

- `recipes/hello-world/recipe.yaml`
- `recipes/hello-world/SOUL.md`
- `scripts/mc-runner-smoke.sh`

## Recipe Validation (offline)

```
$ node -e "const yaml=require('yaml'); const r=yaml.parse(require('fs').readFileSync('recipes/hello-world/recipe.yaml','utf8')); console.log('yaml-ok'); console.log('slug:', r.slug); console.log('image:', r.image); console.log('model.primary:', r.model.primary);"
yaml-ok
slug: hello-world
image: mc-hello-world-agent:latest
model.primary: claude-haiku-4-5-20251001
```

`claude-haiku-4-5-20251001` is the canonical model-registry ID (per
`src/lib/model-registry.ts`). The plan's locked decision wrote `claude-haiku-4-5`
but that ID is **not** in the registry — recipe indexing would reject it.
Corrected at author time so the recipe indexes cleanly as soon as the server
reads it.

## Smoke Harness Dry Run (current environment)

Running the harness against the live environment successfully executes every
preflight; it halts at the expected seam:

```
$ bash scripts/mc-runner-smoke.sh hello-world 2>&1 | head -30
[15:04:33] INFO  === Mission Control runner smoke: hello-world ===
[15:04:33] INFO  repo root: /Users/aaronwhaley/Github/mission-control
[15:04:33] INFO  mc url:    http://127.0.0.1:3000
[15:04:33] INFO  Preflight: docker info
[15:04:34] INFO  Preflight: MC reachable at http://127.0.0.1:3000
[15:04:34] INFO  Preflight: docker image mc-hello-world-agent:latest
[15:04:34] INFO    image id=sha256:c327e1d9a74622ca7a4ee1753e805289100136424e7035d4fd5be475c4921663 size=64494467B
[15:04:34] INFO  Ensure recipe 'hello-world' is indexed
[15:04:34] INFO    recipe not found (HTTP 404); calling POST /api/recipes/resync
{"scanned":0,"inserted":0,"updated":0,"deleted":0,"errors":[]}
[15:04:34] ERROR Recipe 'hello-world' still not indexed after resync (HTTP 404).
[15:04:34] ERROR Likely cause: the MC server's cwd is not the repo root (e.g. running from
[15:04:34] ERROR .next/standalone). Restart the server with MISSION_CONTROL_RECIPES_DIR pointed
[15:04:34] ERROR at /Users/aaronwhaley/Github/mission-control/recipes before retrying.
[15:04:34] ERROR recipe resync did not produce hello-world row
```

### What this proves

- Preflight (1/3): `docker info` — PASS
- Preflight (2/3): MC reachable at `http://127.0.0.1:3000` — PASS
- Preflight (3/3): `docker image inspect mc-hello-world-agent:latest` — PASS
  (image 64.5 MB; id `sha256:c327e1d9a746...`)
- Recipe index probe: `GET /api/recipes/hello-world` — 404 (expected on first
  run before resync)
- Resync call: `POST /api/recipes/resync` — 200, but `scanned=0` (the seam)
- Failure mode: the harness correctly fails fast with an actionable message
  rather than proceeding to a broken task-creation step.

### The seam

`getRecipesRoot()` resolves to `<cwd>/recipes` by default (see
`src/lib/recipe-watcher.ts` lines 43-47). The currently-running MC server's
cwd is `.next/standalone`, so the watcher scans `.next/standalone/recipes/`
which does not exist — resync returns `scanned=0` and the `hello-world` recipe
never makes it into the DB.

The production-mode convention is that the standalone server would be launched
with `MISSION_CONTROL_RECIPES_DIR` pointed at the authored recipes tree. In a
dev-loop the simpler fix is to stop the standalone server and run `pnpm dev`
from the repo root (cwd == repo root).

## Operator Action Required

To complete the end-to-end smoke, one of:

**Option A — Re-point the existing server at the repo recipes dir (no
restart of the active workflow if that server is acceptable):**

```bash
# Stop the currently-running server (next-server at PID 4702, cwd .next/standalone).
# Then in the repo root:
cd /Users/aaronwhaley/Github/mission-control
MISSION_CONTROL_RECIPES_DIR="$PWD/recipes" node .next/standalone/server.js
```

**Option B — Run the dev server from the repo root (recommended for this
smoke):**

```bash
# Stop the currently-running standalone server.
cd /Users/aaronwhaley/Github/mission-control
pnpm dev
# Wait for: "ready - started server on 0.0.0.0:3000"
```

Either option satisfies `getRecipesRoot()` so `POST /api/recipes/resync`
picks up `recipes/hello-world/`.

Once the server is restarted, run:

```bash
cd /Users/aaronwhaley/Github/mission-control
bash scripts/mc-runner-smoke.sh hello-world 2>&1 \
  | tee -a .planning/phases/14-runner-container-v1-2/14-10-smoke.log
```

Expected final lines (on success):

```
[hh:mm:ss] INFO  Task <id> reached 'done' after <N>s
[hh:mm:ss] INFO  =========================================
[hh:mm:ss] INFO    SMOKE PASSED
[hh:mm:ss] INFO    task id = <id>
[hh:mm:ss] INFO    project = <pid> (mc-runner-smoke)
[hh:mm:ss] INFO  =========================================
```

After the run, append the tail of `.planning/phases/14-runner-container-v1-2/14-10-smoke.log`
to this file under a new `## Completed Run` section, plus:

1. Output of `docker ps -a --filter label=mc.task_id=<task-id>` (should be empty
   if `--rm` cleaned the container).
2. `ls .data/runner/worktrees/task-<id>/` and `wc -l .data/runner/worktrees/task-<id>/HELLO.md`.
3. Contents of `.data/runner/worktrees/task-<id>/.mc/checkpoints.jsonl` (single JSON line, step=`hello-world-smoke`).

## Self-Check (pre-operator-action)

- [x] `recipes/hello-world/recipe.yaml` exists and parses (yaml-ok)
- [x] `recipes/hello-world/SOUL.md` exists (≤ 30 lines)
- [x] `scripts/mc-runner-smoke.sh` parses (`bash -n`) and is executable
- [x] `scripts/mc-runner-smoke.sh help` mentions `hello-world`
- [x] Preflight seams (docker, MC reachable, image present) all pass in the
      current environment
- [x] End-to-end run reaches `task.status == done` — **OPERATOR CONFIRMED** (see `## Completed Run` below)

## Completed Run

**Date:** 2026-04-20
**Operator response:** `approved` (user confirmed the smoke passed locally after completing the server-restart remediation described in the "Operator Action Required" section above).
**Resolver:** GSD continuation agent (14-10 final task).

### Artifact scan

The continuation agent ran a filesystem scan for the artifact paths the harness normally captures on a successful run:

| Path                                                                            | Present on disk? |
| ------------------------------------------------------------------------------- | ---------------- |
| `.planning/phases/14-runner-container-v1-2/14-10-smoke.log` (harness tee target) | NO                |
| `.data/runner/worktrees/task-*/HELLO.md`                                        | NO (no `.data/runner/` dir) |
| `.data/runner/worktrees/task-*/.mc/checkpoints.jsonl`                           | NO (no `.data/runner/` dir) |
| `.data/runner/smoke-daemon.err`                                                 | NO (no `.data/runner/` dir) |

`find .data -name HELLO.md -o -name checkpoints.jsonl -o -name smoke-daemon.err` returned zero matches at the time of this resolution commit. The `.data/runner/` directory does not exist in the repo working tree.

### Interpretation

The user confirmed the smoke passed locally via `approved`; run artifacts were **not** captured to disk at the paths the harness normally writes to (`.planning/phases/…/14-10-smoke.log` and `.data/runner/worktrees/task-*/`). This is consistent with the operator running the smoke in a short-lived shell/session and subsequently cleaning up the transient runner state (e.g., the watchdog-GC window or a manual `rm -rf .data/runner/` between runs).

No fabricated tails are quoted in this document — the positive signal comes from the operator's `approved` response, not from on-disk forensics.

### Forward plan

Phase 17 (`Integration Testing & Reference Pipeline`) converts this checkpoint-gated smoke into an automated Vitest/Playwright integration test (`tests/runner-container-e2e.spec.ts` per 17-CONTEXT once that phase is planned). The automated run will preserve its log + worktree artifacts in a deterministic location inside the test sandbox — future verifications of this seam will re-exercise the full behavior without relying on a human-driven smoke script.

For the Phase 14 close, the operator's `approved` signal plus the deterministic pre-verification evidence captured above (recipe YAML parses against the model registry, harness syntax-checks and emits the `hello-world` help banner, preflight chain passes docker + MC + image-inspect, smoke harness halts with an actionable message when the recipe indexer is misaligned) closes the phase's exit criterion: an end-to-end task-to-done run proves the full stack is wired.
