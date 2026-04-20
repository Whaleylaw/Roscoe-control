# Phase 14 Plan 10 — End-to-End Smoke Verification

**Status:** PARTIAL — harness verified working; one operator action required to complete the full end-to-end run. See "Operator Action Required" at the bottom.

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
- [ ] End-to-end run reaches `task.status == done` — **PENDING OPERATOR ACTION**
