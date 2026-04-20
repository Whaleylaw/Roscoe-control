---
phase: 14-runner-container-v1-2
verified: 2026-04-20T19:42:01Z
resolved: 2026-04-20T20:05:00Z
status: passed
score: 9/9 success criteria verified (Gap 1 resolved via fix commit; Gap 2 deferred to Phase 15 scope)
gaps:
  - truth: "For workspace:worktree recipes, the runner creates/reuses a git worktree, seeds .mc/, and records worktree_path on the task"
    status: resolved
    resolution_commit: "674f417"
    resolution_notes: "Claim route now computes worktree_path = path.join(config.dataDir, 'runner', 'worktrees', `task-${taskId}`) for recipe.workspace_mode='worktree' (null otherwise) and includes it in the atomic UPDATE. New test RUNNER-09 asserts persistence."
    original_reason: "Worktree creation and .mc/ seeding are fully implemented in scripts/mc-runner.mjs and src/lib/runner-worktree.ts. However, the tasks.worktree_path column (added in migration 057) is never written by the claim route, container-started route, or the runner script. RUNNER-09 and SC3 both require this write."
  - truth: "MC flips the runner-online indicator based on heartbeat freshness (offline after 60s silence)"
    status: deferred_to_phase_15
    reason: "The runner_heartbeats table and POST /api/runner/heartbeat UPSERT are shipped (infrastructure layer). The active stale-detection (reconcileRunnerHeartbeat scheduler hook) is explicitly assigned to Phase 15 in ROADMAP.md; the UI banner is Phase 16. Not a Phase 14 gap."
    artifacts:
      - path: "src/lib/scheduler.ts"
        issue: "reconcileRunnerHeartbeat job lands in Phase 15 per roadmap"
human_verification:
  - test: "End-to-end smoke: launch runner, create recipe-tagged task, observe task reaches done"
    expected: "docker image mc-hello-world-agent:latest launches, emits checkpoint, commits HELLO.md, posts /submit → task.status=done"
    why_human: "Operator confirmed 'approved' on 2026-04-20; smoke log not captured to disk (server cwd mismatch). Full automated coverage deferred to Phase 17 integration suite."
---

# Phase 14: Runner Daemon & Container Execution — Verification Report

**Phase Goal:** A standalone runner process can claim recipe-tagged tasks, launch short-lived containers against a per-task git worktree, monitor exit, and safely preserve state across crashes so a retry resumes without redoing work.
**Verified:** 2026-04-20T19:42:01Z
**Status:** gaps_found (2 partial gaps; neither blocks Phase 15 transition)
**Re-verification:** No — initial phase-level verification (14-10-VERIFICATION.md covered plan 10 smoke checkpoint only)

---

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                             | Status      | Evidence                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Operator launches runner from LaunchAgent template; it registers, heartbeats, subscribes SSE      | PARTIAL     | `scripts/mc-runner.mjs` boots, reads `.data/runner.secret`, sends 10s heartbeats via POST /api/runner/heartbeat, subscribes SSE + 15s poll. The "MC flips offline after 60s" logic (`reconcileRunnerHeartbeat`) is Phase 15. DB infrastructure (runner_heartbeats) ships here. |
| 2   | Runner atomically claims recipe-tagged tasks; enforces concurrency caps; 409 on over-cap           | VERIFIED    | `src/app/api/runner/claim/[task_id]/route.ts` (365 lines): atomic UPDATE WHERE status='assigned' AND container_id IS NULL; `validateHostPathAgainstAllowlist` called at claim time (RUNNER-07); global cap via `runner_config.max_concurrent_containers` + per-recipe `max_concurrent` checked via active-count query (runner script lines 598–615). |
| 3   | Runner creates/reuses git worktree; seeds .mc/; records worktree_path on task                     | PARTIAL     | Worktree creation (`git worktree add`) and `.mc/` seeding (task.json, progress.md, checkpoints.jsonl, .gitignore) implemented in `scripts/mc-runner.mjs` lines 927–964 and `src/lib/runner-worktree.ts`. **tasks.worktree_path column is never written** (see Gaps). |
| 4   | Container launched via `docker run --rm -d` with documented mounts, env vars, secrets            | VERIFIED    | `src/lib/runner-docker.ts` `buildDockerRunArgs()` + `writeEnvFile()` (219 lines). Env includes MC_API_URL, MC_TASK_ID, MC_API_TOKEN, MC_WORKSPACE, MC_RECIPE_PATH, MC_MODEL_PRIMARY, MC_MODEL_FALLBACK, MC_MODEL_PROVIDER, MC_MODEL_PARAMS_JSON (claim route line 326–343). Secrets loaded from `.data/runner/secrets/<NAME>` at claim time (runner script line 995). |
| 5   | First attempt gets short preamble; resume attempt gets long preamble with task.json/progress.md/checkpoints.jsonl instructions | VERIFIED | `src/lib/runner-preamble.ts` (194 lines): `buildFirstAttemptPreamble()` / `buildResumePreamble()` with full discriminated dispatch on `isResuming`. Staged to `/recipe/PREAMBLE.md` via `stageRecipe()`. |
| 6   | Container hard-killed at timeout_seconds; logs streamed; runner posts runner-exit; retry cap enforced | VERIFIED | `scripts/mc-runner.mjs` lines 1057–1072: `setTimeout(() => docker stop --time=15)`. Log streaming via `docker logs -f` (lines 842–843). `runner-exit` route (273 lines): `resolvedMaxAttempts = task.runner_max_attempts ?? recipeMaxAttempts ?? 3`; exceeding cap transitions to `failed`. |
| 7   | Worktrees preserved across crashes/retries; GC destroys on done/cancelled/aged-failed            | VERIFIED    | `src/lib/runner-gc.ts`: `gcShouldDestroy()` — done/cancelled immediate, failed after window, unknown never. Runner GC tick (lines 708–758): `git worktree remove --force` + `rm -rf`. 10-min interval + boot sweep. |
| 8   | Post-crash reconcile: runner adopts or kills orphaned containers; token revoked + worktree destroyed on terminal | VERIFIED | `src/lib/runner-reconcile.ts` + runner script `reconcileAtBoot()` (lines 448–568). Token revocation: `revokeTokensForTask` called at terminal exit (runner-exit route line 240). |
| 9   | `mc-hello-world-agent` reference image exercises full checkpoint → submit flow                   | HUMAN       | `docker/hello-world-agent/agent.mjs` (109 lines): reads /recipe, writes checkpoints.jsonl, commits HELLO.md, POSTs /api/runner/tasks/:id/submit → done. Operator confirmed run passed 2026-04-20 (no disk artifacts). |

**Score:** 7/9 truths fully verified (2 partial, 1 human-dependent)

---

### Required Artifacts

| Artifact                                                        | Purpose                              | Status     | Size / Evidence                                    |
| --------------------------------------------------------------- | ------------------------------------ | ---------- | -------------------------------------------------- |
| `scripts/mc-runner.mjs`                                         | Standalone runner daemon             | VERIFIED   | 1,114 lines; substantive boot + claim + GC logic   |
| `scripts/com.missioncontrol.runner.plist`                       | macOS LaunchAgent template           | VERIFIED   | Present; KeepAlive + ThrottleInterval 30           |
| `scripts/mc-runner-smoke.sh`                                    | E2E smoke harness                    | VERIFIED   | Present; parses clean; preflight chain passes      |
| `src/lib/runner-claim.ts`                                       | Claim + concurrency helpers          | VERIFIED   | 433 lines                                          |
| `src/lib/runner-docker.ts`                                      | Docker run argv + env-file builder   | VERIFIED   | 219 lines                                          |
| `src/lib/runner-worktree.ts`                                    | .mc/ seeding helpers                 | VERIFIED   | 152 lines                                          |
| `src/lib/runner-preamble.ts`                                    | First + resume preamble generators   | VERIFIED   | 194 lines                                          |
| `src/lib/runner-gc.ts`                                          | GC destroy decision tree             | VERIFIED   | 72 lines                                           |
| `src/lib/runner-reconcile.ts`                                   | Adopt/kill/orphan diff               | VERIFIED   | 83 lines                                           |
| `src/lib/runner-tokens.ts`                                      | Issue + revoke runner tokens         | VERIFIED   | 102 lines                                          |
| `src/lib/runner-secret.ts`                                      | .data/runner.secret auto-gen         | VERIFIED   | Present                                            |
| `src/lib/runner-timeout.ts`                                     | Remaining timeout arithmetic         | VERIFIED   | Present                                            |
| `src/lib/runner-log-layout.ts`                                  | Log path layout + meta.json          | VERIFIED   | Present                                            |
| `src/app/api/runner/claim/[task_id]/route.ts`                   | POST claim endpoint                  | VERIFIED   | 365 lines                                          |
| `src/app/api/runner/heartbeat/route.ts`                         | POST heartbeat endpoint              | VERIFIED   | 90 lines; UPSERT on runner_heartbeats              |
| `src/app/api/runner/ready-tasks/route.ts`                       | GET poll endpoint                    | VERIFIED   | 95 lines                                           |
| `src/app/api/runner/pending-containers/route.ts`                | GET reconcile endpoint               | VERIFIED   | 65 lines                                           |
| `src/app/api/runner/terminal-tasks/route.ts`                    | GET GC endpoint                      | VERIFIED   | 99 lines                                           |
| `src/app/api/runner/config/route.ts`                            | GET config endpoint                  | VERIFIED   | 50 lines                                           |
| `src/app/api/runner/tasks/[task_id]/runner-exit/route.ts`       | POST exit + retry/fail driver        | VERIFIED   | 273 lines; revokeTokensForTask on terminal         |
| `src/app/api/runner/tasks/[task_id]/container-started/route.ts` | POST container_id swap               | VERIFIED   | 116 lines                                          |
| `src/app/api/runner/tasks/[task_id]/submit/route.ts`            | POST agent submit → done             | VERIFIED   | 137 lines                                          |
| `recipes/hello-world/recipe.yaml`                               | Reference recipe                     | VERIFIED   | 17 lines; parses against model registry            |
| `recipes/hello-world/SOUL.md`                                   | Agent instructions                   | VERIFIED   | 14 lines                                           |
| `docker/hello-world-agent/Dockerfile`                           | Reference container image            | VERIFIED   | 18 lines; FROM node:22-alpine                      |
| `docker/hello-world-agent/agent.mjs`                            | Reference agent script               | VERIFIED   | 109 lines; checkpoint + submit flow                |

---

### Key Link Verification

| From                        | To                                               | Via                            | Status      | Detail                                                              |
| --------------------------- | ------------------------------------------------ | ------------------------------ | ----------- | ------------------------------------------------------------------- |
| `mc-runner.mjs`             | `POST /api/runner/heartbeat`                     | `mcFetch` Bearer runner-secret | WIRED       | `heartbeatTick()` lines 575–587; drift-resistant setTimeout chain  |
| `mc-runner.mjs`             | `GET /api/runner/ready-tasks`                    | `mcFetch` + `pollTick()`       | WIRED       | Lines 632–698; 15s setInterval fallback                            |
| `mc-runner.mjs`             | `POST /api/runner/claim/:task_id`                | `tryClaim()` → `runContainer()`| WIRED       | Lines 764–790; SSE frame + poll both call `tryClaim`               |
| `mc-runner.mjs`             | `docker run --rm -d`                             | `buildDockerRunArgs()` inlined | WIRED       | Lines 1006–1023; spawnSync with env-file                           |
| `mc-runner.mjs`             | `POST /api/runner/tasks/:id/container-started`   | `mcFetch` post docker run      | WIRED       | Lines 1040–1051                                                    |
| `mc-runner.mjs`             | `POST /api/runner/tasks/:id/runner-exit`         | `postRunnerExit()`             | WIRED       | Lines 792–806; called on all exit paths including timeout          |
| `runner-exit/route.ts`      | `revokeTokensForTask`                            | `import @/lib/runner-tokens`   | WIRED       | Line 7 import; line 240 call inside terminal transaction           |
| `runner-exit/route.ts`      | Retry state machine                              | `runner_attempts < max`        | WIRED       | Lines 171–246; `status → assigned` on retry, `failed` on cap hit  |
| `claim/route.ts`            | `composeEnvMap` (MC_MODEL_* vars)                | `resolveEffectiveModel()`      | WIRED       | Lines 318–343; model_override ?? recipe.model.primary              |
| `claim/route.ts`            | `validateHostPathAgainstAllowlist`               | `import @/lib/...`             | WIRED       | Lines 187–228; symlink resolution + allowlist re-check at claim    |
| `mc-runner.mjs`             | `GET /api/runner/pending-containers`             | `reconcileAtBoot()`            | WIRED       | Lines 451–567; docker ps diff on boot                             |
| `mc-runner.mjs`             | `GET /api/runner/terminal-tasks`                 | `gcTick()`                     | WIRED       | Lines 708–754; 10-min + boot sweep                                |
| `tasks.worktree_path`       | (written nowhere)                                | —                              | NOT WIRED   | Column exists (migration 057) but never SET by any route or script |

---

### Requirements Coverage

| Requirement  | Source Plan(s)   | Description (abbreviated)                           | Status      | Evidence                                                    |
| ------------ | ---------------- | --------------------------------------------------- | ----------- | ----------------------------------------------------------- |
| RUNNER-01    | 14-08b           | Standalone `scripts/mc-runner.mjs` + LaunchAgent    | SATISFIED   | `scripts/mc-runner.mjs` (1114 lines) + plist present        |
| RUNNER-02    | 14-08b           | Register with MC via `.data/runner.secret`          | SATISFIED   | Boot step 1: reads runner.secret; heartbeat sends it         |
| RUNNER-03    | 14-08b           | Subscribe `task.runner_requested` SSE               | SATISFIED   | `subscribeSSE()` lines 623–695; SSE reconnect with backoff  |
| RUNNER-04    | 14-08b           | 15s poll fallback via `/api/runner/ready-tasks`     | SATISFIED   | `pollTick()` + `setInterval(pollTick, 15000)`               |
| RUNNER-05    | 14-01, 14-04     | 10s heartbeats; MC offline after 60s silence        | PARTIAL     | Heartbeat POST + runner_heartbeats table shipped. `reconcileRunnerHeartbeat` (Phase 15) does the 60s stale flip. |
| RUNNER-06    | 14-05, 14-11     | Atomic claim → dispatch payload + token             | SATISFIED   | Claim route 365 lines; token issued in same transaction      |
| RUNNER-07    | 14-05            | Re-validate mounts at claim; symlink resolution     | SATISFIED   | `validateHostPathAgainstAllowlist` called in claim route     |
| RUNNER-08    | 14-02, 14-05     | Global + per-recipe concurrency caps; 409 on over-cap| SATISFIED  | Global cap from `runnerConfig.max_concurrent_containers`; runner-side guard before tryClaim |
| RUNNER-09    | 14-07, 14-08b    | Create/reuse worktree; seed .mc/; record worktree_path | PARTIAL  | Worktree + .mc/ implemented. `tasks.worktree_path` never written. |
| RUNNER-10    | 14-07, 14-08b    | `docker run --rm -d` with mounts + env + log stream | SATISFIED   | `buildDockerRunArgs()` + `watchContainerExit()`             |
| RUNNER-11    | 14-06, 14-08b    | Wait for exit; post runner-exit; MC drives retry    | SATISFIED   | `watchContainerExit` → `postRunnerExit` → runner-exit route |
| RUNNER-12    | 14-08a, 14-08b   | Gracefully stop on blocked checkpoint; preserve worktree | SATISFIED | Phase 14 scope: worktree NOT destroyed on kill (GC-only). Checkpoint surface (Phase 15). |
| RUNNER-13    | 14-08a, 14-08b   | Post-crash reconcile orphaned containers            | SATISFIED   | `reconcileAtBoot()` + `reconcileContainers()` diff          |
| RUNNER-14    | 14-08a, 14-08b   | On terminal status: revoke token + destroy worktree | SATISFIED   | `revokeTokensForTask` in runner-exit route; GC destroys worktree |
| CONTAINER-01 | 14-07, 14-05     | MC_* env vars + secrets via --env-file              | SATISFIED   | `writeEnvFile()` + secrets from `.data/runner/secrets/`     |
| CONTAINER-02 | 14-07, 14-08b    | /workspace, /recipe, /refs/, /skills/ mounts       | SATISFIED   | `buildDockerRunArgs()` mount flags verified in docker-args tests |
| CONTAINER-03 | 14-08a, 14-08b   | Hard-kill at timeout_seconds; report reason=timeout | SATISFIED   | `computeRemainingTimeoutMs()` + `setTimeout → docker stop`  |
| CONTAINER-04 | 14-09, 14-10     | `mc-hello-world-agent` reference image              | SATISFIED   | Dockerfile + agent.mjs + build.sh + recipe.yaml all present |
| WORK-01      | 14-07            | Seed .mc/ files on first launch                     | SATISFIED   | `seedMcDir()` in runner-worktree.ts + inlined in runner     |
| WORK-02      | 14-07            | task.json shape: task_id, recipe_slug, attempt, is_resuming, prior_attempts[] | SATISFIED | `McTaskJson` type; `writeMcTaskJson()` |
| WORK-03      | 14-08a, 14-08b   | Worktree preserved across crashes; destroyed on terminal | SATISFIED | GC: done/cancelled immediate; failed after window; unknown never |
| WORK-04      | 14-07            | Resume preamble: read progress.md + checkpoints.jsonl + git state | SATISFIED | `buildResumePreamble()` in runner-preamble.ts |
| WORK-05      | 14-07            | First-attempt preamble: write notes to progress.md  | SATISFIED   | `buildFirstAttemptPreamble()` in runner-preamble.ts         |
| WORK-06      | 14-02, 14-06     | runner_max_attempts (default 3, recipe-overridable) | SATISFIED   | `resolvedMaxAttempts = task.runner_max_attempts ?? recipeMaxAttempts ?? 3` |
| WORK-07      | 14-08a, 14-08b   | GC job prunes worktrees for long-terminal tasks     | SATISFIED   | `gcTick()` 10-min interval; `gcShouldDestroy()` + `planDestroy()` |
| MODEL-04     | 14-05            | Effective model = task.model_override ?? recipe.model.primary | SATISFIED | `resolveEffectiveModel()` in runner-claim.ts; MC_MODEL_* in env |

**Orphaned requirements from REQUIREMENTS.md assigned to Phase 14:** None detected.

---

### Anti-Patterns Found

| File                            | Pattern                                               | Severity | Impact                          |
| ------------------------------- | ----------------------------------------------------- | -------- | ------------------------------- |
| `src/lib/runner-worktree.ts`    | `return null` (lines 86, 91)                          | INFO     | Intentional defensive returns for ENOENT/parse-fail — correct pattern, not a stub |
| `scripts/mc-runner.mjs` L482   | `return null` inside reconcile path                   | INFO     | Intentional skip of pending-placeholder containers — not a stub |
| `scripts/mc-runner.mjs` L618   | SSE "placeholder" comment                             | INFO     | Documented design note that SSE emission starts in Phase 15 — not a code stub |

No blocker or warning-level anti-patterns found. All `return null` occurrences are defensive-default patterns with documented rationale.

---

### Test Coverage

- **Unit tests (src/lib/__tests__/runner-*.test.ts + auth-runner-*.test.ts):** 14 test files, 2,712 lines
- **Route integration tests (src/app/api/runner/*/__tests__/route.test.ts):** 9 test files, 2,278 lines
- **Total test suite:** 2,057 tests pass, 0 fail, 44 todo (`pnpm vitest run` 2026-04-20)
- **TypeScript:** `pnpm tsc --noEmit` passes cleanly

---

### Human Verification Required

#### 1. End-to-End Smoke Run

**Test:** With MC server running from repo root (cwd has `recipes/`), run `bash scripts/mc-runner-smoke.sh hello-world`. Observe task transitions through `assigned → in_progress → done` with worktree artifacts.
**Expected:** `HELLO.md` committed in worktree; `.mc/checkpoints.jsonl` has one entry; `docker ps` shows no lingering container; smoke script prints "SMOKE PASSED".
**Why human:** Operator confirmed "approved" on 2026-04-20 but log was not captured to disk. Phase 17 integration suite (`tests/runner-container-e2e.spec.ts`) automates this with deterministic artifact paths.

---

### Gaps Summary

Two gaps found, neither of which blocks the Phase 15 transition:

**Gap 1 — `tasks.worktree_path` never written (RUNNER-09 / SC3):**
The column exists (migration 057) and CONTEXT.md specifies writing it, but no API route or runner code path executes `UPDATE tasks SET worktree_path = ?`. The worktree is correctly created at the deterministic path `.data/runner/worktrees/task-<id>/` so the path is implicitly known from task_id, but Phase 15's checkpoint handler will benefit from a persisted path for the `blocked→awaiting_owner` flow. Recommend adding `worktree_path = ?` to the `UPDATE tasks SET ...` in `src/app/api/runner/claim/[task_id]/route.ts` (the path is known there: `.data/runner/worktrees/task-<id>/`).

**Gap 2 — `reconcileRunnerHeartbeat` not implemented (RUNNER-05 / SC1 partial):**
The runner_heartbeats table and POST /api/runner/heartbeat are fully operational. The 60-second stale-detection logic (`reconcileRunnerHeartbeat` scheduler job) is explicitly assigned to Phase 15 in the ROADMAP. The UI banner is Phase 16. This is an intentional phase split, not a missed delivery. REQUIREMENTS.md marks RUNNER-05 as Complete; this reflects that the data infrastructure is Phase 14 and the active detection is Phase 15.

**Recommendation:** Given that Gap 2 is explicitly scoped to Phase 15 (already planned), and Gap 1 is a single-line omission (adding `worktree_path` to the claim UPDATE), the team may choose to: (a) fix Gap 1 in a quick follow-up before Phase 15 begins, or (b) include it as the first task of Phase 15's `container-started` route enhancement since Phase 15 needs `worktree_path` for the `blocked` checkpoint flow. Gap 2 proceeds naturally as part of Phase 15's scheduler hooks deliverable.

---

_Verified: 2026-04-20T19:42:01Z_
_Verifier: Claude (gsd-verifier) — phase-level initial verification_
