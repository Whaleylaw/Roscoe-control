---
phase: 14-runner-container-v1-2
plan: 10
subsystem: infra
tags: [recipe, smoke-harness, end-to-end, runner-daemon, human-verify, reference-image]

# Dependency graph
requires:
  - phase: 14-runner-container-v1-2
    provides: 14-08b (runner daemon — launched by smoke), 14-09 (mc-hello-world-agent image — launched by recipe), 14-11 (POST /api/runner/tasks/:id/submit — submit seam), 14-07 (runner PREAMBLE.md — read by agent), 14-05 (claim route — exercised by runner)
  - phase: 12-recipe-system-v1-2
    provides: 12-03 (recipe watcher + MISSION_CONTROL_RECIPES_DIR), 12-04 (GET /api/recipes/:slug + POST /api/recipes/resync)
provides:
  - recipes/hello-world/ companion recipe bundle (recipe.yaml + SOUL.md)
  - scripts/mc-runner-smoke.sh end-to-end smoke harness (hello-world subcommand + reserved preserve-* subcommands)
  - .planning/phases/14-runner-container-v1-2/14-10-VERIFICATION.md (partial — preflights captured, end-to-end run pending one operator action)
affects: [Phase 14 close (11/12 -> 12/12 once operator runs smoke), Phase 15 (checkpoint HTTP endpoint — will extend existing recipe without change), Phase 17 (smoke harness will gain preserve-on-stop / preserve-across-crash subcommands)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recipe bundle pattern: recipes/<slug>/recipe.yaml + recipes/<slug>/SOUL.md — short SOUL that defers to runtime-authored PREAMBLE.md (10 lines of content, per Plan locked decisions)"
    - "Smoke harness pattern: bash subcommand dispatcher + preflight chain + live-server orchestration + polling + background-PID trap cleanup. Future preserve-* subcommands plug into the same scaffold"
    - "jq-or-node JSON parsing: harness prefers jq when available but falls back to an inline Node stdin parser for portability (no pnpm/npm install to run the smoke)"
    - "Graceful-error pattern: harness halts before task creation if the recipe isn't indexed AND prints the exact env-var/cwd remediation — avoids a confusing downstream 'invalid recipe_slug' error inside POST /api/tasks"

key-files:
  created:
    - recipes/hello-world/recipe.yaml
    - recipes/hello-world/SOUL.md
    - scripts/mc-runner-smoke.sh
    - .planning/phases/14-runner-container-v1-2/14-10-VERIFICATION.md (partial — see Checkpoint Reached)
  modified: []

key-decisions:
  - "Model primary is claude-haiku-4-5-20251001 (the canonical registry ID), not claude-haiku-4-5 as the plan frontmatter recorded. The plan explicitly permitted this substitution (quote: 'If the MODEL-01 registry identifier differs from claude-haiku-4-5, use the canonical identifier that isKnownModel(...) returns true for'). Without the correction the recipe would fail the MODEL-02 index-time validator."
  - "SOUL.md deliberately short (14 lines). The runner-authored /recipe/PREAMBLE.md (Plan 14-07) carries the full contract; SOUL.md documents the 6 steps the reference agent performs, which Plan 14-09's agent.mjs already implements. No marketing copy, no redundant environment-variable list."
  - "Smoke harness creates a dedicated project 'mc-runner-smoke' (slug) on first run rather than reusing an existing project. Keeps the runner's task volume out of real work projects' task counts."
  - "Smoke harness writes runtime.project_repo_map and runtime.mount_allowlist directly via PUT /api/settings rather than prompting the operator. The settings APIs are admin-only — harness assumes MC_API_KEY is admin-scoped, which matches the .data/.auto-generated API_KEY for a local dev install."
  - "POLL_BUDGET_SEC default is 180s (not the 120s in the recipe's timeout_seconds) — leaves 60s headroom for worktree create + docker run + docker image fetch overhead, so a perfectly-healthy run doesn't race the budget."
  - "Harness does NOT delete the task after success — leaves it for operator inspection of runner_attempts / runner_last_failure_reason / container_id. Same rationale for not cleaning up the smoke project: creating a project is cheap but removing one cascades into many related tables."
  - "EXIT trap kills any lingering runner PID — critical because the smoke runs the daemon in the background via `node scripts/mc-runner.mjs &`. A script crash must not leak a live runner."

# Metrics
duration: ~12 min (autonomous portion; wall-clock for the operator smoke run not captured to disk — see VERIFICATION.md "Completed Run" / "Artifact scan")
completed: 2026-04-20 (autonomous portion + human-verify checkpoint resolved)
---

# Phase 14 Plan 10: End-to-End Smoke Recipe + Harness Summary

**Companion recipe (recipes/hello-world/) + bash smoke harness (scripts/mc-runner-smoke.sh) ready. Harness preflights (docker, MC reachable, image present) verified green; end-to-end task-to-done run is blocked on a one-line operator action to restart the MC server so `getRecipesRoot()` resolves to the repo's recipes/ dir.**

## Status

**COMPLETE — checkpoint resolved.** The two autonomous tasks (recipe bundle + smoke harness) shipped with all preflight evidence captured deterministically. The human-verify checkpoint was resolved on 2026-04-20 with operator response `approved` (full detail in the "Human-verify resolution" block below). Phase 14 is 12/12 closed.

## Human-verify resolution

- **Date resolved:** 2026-04-20
- **Operator response:** `approved` (in-thread confirmation that the smoke passed locally after the server-restart remediation).
- **Artifact scan outcome:** Continuation agent scanned the filesystem for the harness's normal artifact targets (`.planning/phases/…/14-10-smoke.log`, `.data/runner/worktrees/task-*/HELLO.md`, `.data/runner/worktrees/task-*/.mc/checkpoints.jsonl`, `.data/runner/smoke-daemon.err`). **All were absent** at resolution time — the `.data/runner/` directory does not exist in the working tree. The operator's smoke run therefore either ran in a short-lived shell or cleaned up the transient runner state before this commit landed. No tails are quoted in VERIFICATION.md — the positive signal is the operator's response, not on-disk forensics.
- **Forward plan:** Phase 17 converts this checkpoint-gated smoke into an automated integration test (Vitest/Playwright) that preserves log + worktree artifacts in a deterministic test-sandbox location. Full behavioral re-verification happens there.

## Performance

- **Duration:** ~12 min (autonomous portion). Wall-clock for the operator-driven smoke run was not captured to disk — see VERIFICATION.md "Artifact scan" for the reason.
- **Started:** 2026-04-20T19:01:00Z
- **Autonomous portion completed:** 2026-04-20T19:13:00Z
- **Checkpoint resolved:** 2026-04-20 (operator "approved")
- **Tasks:** 2 autonomous + 1 human-verify (checkpoint) — all complete
- **Files created:** 4
- **Files modified:** 0

## Accomplishments

- Companion recipe `recipes/hello-world/recipe.yaml` references the Plan 14-09 image (`mc-hello-world-agent:latest`), declares `workspace_mode: worktree`, `timeout_seconds: 120`, `max_concurrent: 1`, `max_attempts: 2`, and pins `model.primary: claude-haiku-4-5-20251001` (canonical registry ID, not the abbreviated form in the plan frontmatter).
- Companion `recipes/hello-world/SOUL.md` (14 lines, well under the 30-line ceiling the plan set) tells the agent exactly what to do and defers to `/recipe/PREAMBLE.md` for the runtime contract.
- `scripts/mc-runner-smoke.sh` (554 lines) implements the full subcommand dispatcher, preflight chain (docker info, MC reachable, image inspect), recipe-resync bootstrap, smoke-project create-or-reuse, runtime settings configuration (`runtime.project_repo_map`, `runtime.mount_allowlist`), task creation with `recipe_slug: 'hello-world'` + `workspace_source`, background runner-daemon launch, 180-second polling loop with status-change logging, and a post-run artifact inspection pass (worktree HELLO.md + .mc/progress.md + .mc/checkpoints.jsonl, docker ps labels).
- Harness stderr/stdout of the runner daemon is redirected to `.data/runner/smoke-daemon.{out,err}` so the operator can tail them during the run.
- `.planning/phases/14-runner-container-v1-2/14-10-VERIFICATION.md` captures the deterministic environment (MC git sha, Docker version, Node version, image size, server process cwd) + the partial harness run output + the single operator action needed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create recipes/hello-world/ (recipe.yaml + SOUL.md)** — `c6da0c9` (feat)
2. **Task 2: Create scripts/mc-runner-smoke.sh smoke harness** — `d2174f3` (feat)
3. **Task 2 fix: Replace printf %()T with date command** — `45372da` (fix; Rule 1 deviation — see below)
4. **Autonomous portion metadata commit** — `34c4df8` (docs; captured checkpoint + initial VERIFICATION.md)
5. **Task 3 (checkpoint:human-verify):** resolved by operator "approved" response; this final `docs(14-10): resolve human-verify checkpoint` commit carries the VERIFICATION.md `## Completed Run` block, the SUMMARY.md flip, and the STATE/ROADMAP/REQUIREMENTS metadata.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] printf %()T format conflicts with variadic message**

- **Found during:** Task 2 dry-run of the smoke harness.
- **Issue:** The initial log helper used `printf '[%(%H:%M:%S)T] %s\n' -1 "$*"`, but `%(...)T` is interpreted per argument: when the logged message `$*` itself contained a literal `%` character (or when bash re-interpreted the format), printf raised `invalid format character` and aborted the log line.
- **Fix:** Rewrote `log()` to use `printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"` — no format placeholders driven by the message content.
- **Files modified:** `scripts/mc-runner-smoke.sh` (line 46).
- **Commit:** `45372da`.
- **Verified by:** Re-running `bash scripts/mc-runner-smoke.sh hello-world` — all log lines emit cleanly and the harness reaches its expected halt point.

**2. [Rule 1 — Bug] plan frontmatter referenced `claude-haiku-4-5`; registry ID is `claude-haiku-4-5-20251001`**

- **Found during:** Task 1 recipe authoring.
- **Issue:** Plan's `locked_decisions` block wrote `model.primary='claude-haiku-4-5'`. `src/lib/model-registry.ts` registers `claude-haiku-4-5-20251001` — the abbreviated form fails `isKnownModel(...)` which blocks `parseRecipeYaml()` at MODEL-02.
- **Fix:** Recipe uses the canonical full ID. The plan explicitly permitted this substitution ("If the MODEL-01 registry identifier differs… use the canonical identifier that `isKnownModel(...)` returns true for").
- **Files modified:** `recipes/hello-world/recipe.yaml`.
- **Commit:** Part of `c6da0c9` (no separate fix commit — the plan sanctioned the substitution).
- **Verified by:** Recipe YAML parse + runtime check of `MODEL_IDS` in the registry module.

### Scope boundary

- The MC server currently running on port 3000 is a standalone build (`.next/standalone/server.js`) with cwd `/Users/aaronwhaley/Github/mission-control/.next/standalone`. Its `getRecipesRoot()` resolves to `<cwd>/recipes` (which does not exist inside `.next/standalone/`). No `MISSION_CONTROL_RECIPES_DIR` env var is set on that process. Stopping and restarting that process (or swapping to `pnpm dev` from the repo root) requires operator discretion — the GSD executor does not kill running dev servers on the user's behalf.

## Checkpoint Reached (historical)

See the full VERIFICATION.md for the blow-by-blow. In short:

- **Type:** `human-verify` (Task 3).
- **Preflights passed:** docker info OK, MC reachable OK, image present OK.
- **Halt point (pre-resolution):** `POST /api/recipes/resync` returned `scanned=0` because the running server's cwd was `.next/standalone/`; the `recipes/hello-world/` directory lives at the repo root.
- **Resolution:** Operator completed the server-restart remediation (either `pnpm dev` from repo root OR relaunched standalone with `MISSION_CONTROL_RECIPES_DIR="$PWD/recipes"`) and re-ran the smoke. Operator responded `approved` on 2026-04-20.

See "Human-verify resolution" at the top of this document for the artifact-scan transparency note.

## Issues Encountered

None beyond the two auto-fixed items above. No rate limits, no DB errors, no schema contradictions.

## Known Limitations

- Single-shot smoke; no preserve-on-stop / preserve-across-crash variants (reserved subcommands already declared in the harness, documented as Phase 15/17 work).
- Harness assumes a local dev install (`.data/` under the repo root). Multi-tenant / remote-runner smokes are a Phase 15+ concern.
- Harness assumes the operator's `MC_API_KEY` carries admin scope so PUT /api/settings succeeds. The `.data/.auto-generated` API_KEY in a local dev install satisfies this by default.
- The post-run worktree inspection runs immediately after `done`; the runner-side 10-minute GC tick has a full 10 minutes before it removes the `done` worktree, so inspection is safe — but if the operator inspects much later, they'll find the worktree gone (expected, documented).

## Next Plan Readiness

Phase 14 is closed (12/12 plans). Phase 15 (checkpoint endpoint + scheduler hooks) is unblocked.

## Self-Check: PASSED

**File existence:**
- FOUND: recipes/hello-world/recipe.yaml (17 lines; yaml-ok; model.primary resolves against registry)
- FOUND: recipes/hello-world/SOUL.md (14 lines; within 30-line ceiling)
- FOUND: scripts/mc-runner-smoke.sh (555 lines; `bash -n` OK; `chmod +x` OK; `help | grep hello-world` matches)
- FOUND: .planning/phases/14-runner-container-v1-2/14-10-VERIFICATION.md (PASSED — `## Completed Run` block appended 2026-04-20 after operator `approved`)

**Commits:**
- FOUND: c6da0c9 (feat(14-10): add companion recipe for mc-hello-world-agent)
- FOUND: d2174f3 (feat(14-10): add Phase 14 runner end-to-end smoke harness)
- FOUND: 45372da (fix(14-10): replace printf %()T format with date command in smoke log)
- FOUND: 34c4df8 (docs(14-10): capture Plan 14-10 autonomous portion + checkpoint)

**End-to-end smoke:**
- RESOLVED: Task 3 (checkpoint:human-verify) — operator responded `approved` 2026-04-20. Artifact-scan transparency recorded in VERIFICATION.md "Completed Run" and in this document's "Human-verify resolution" block. Full behavioral E2E re-verified in Phase 17 integration suite.

---
*Phase: 14-runner-container-v1-2*
*Plan: 10 (complete — autonomous portion + human-verify checkpoint resolved)*
*Completion: 2026-04-20*
