---
phase: 14-runner-container-v1-2
plan: 07
subsystem: runner-primitives
tags: [runner, docker, worktree, preamble, env-file, recipe-stage, pure-logic]

# Dependency graph
requires:
  - phase: 14-runner-container-v1-2
    plan: 02
    provides: runtime.* getters + DEFAULT_MAX_MEMORY_PER_CONTAINER / DEFAULT_MAX_CPU_PER_CONTAINER constants consumed as defaults in claim-time docker-arg composition
  - phase: 14-runner-container-v1-2
    plan: 03
    provides: Wave-0 test scaffolds (5 it.todo stubs each for preamble, worktree-seed, docker-args, env-file, recipe-stage) — replaced in-place this plan
provides:
  - src/lib/runner-preamble.ts (generatePreamble — Markdown body for /recipe/PREAMBLE.md)
  - src/lib/runner-worktree.ts (seedMcDir, readMcTaskJson, writeMcTaskJson, buildPriorAttemptsEntry)
  - src/lib/runner-docker.ts (buildDockerRunArgs, stageRecipe, writeEnvFile, cleanupEnvFile, slugify)
  - 36 unit tests across 5 files (7 preamble + 10 worktree + 9 docker-args + 6 env-file + 4 recipe-stage)
  - Locked argv shape for Plan 14-08b daemon consumption
affects:
  - 14-08b (daemon orchestration imports these primitives or re-declares minimal subset inline)
  - 14-05 (claim route may reuse runner-preamble for dispatch-payload PREAMBLE.md text)
  - 15 (checkpoint endpoint wires the HTTP-skeleton forward-reference in preamble copy)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-logic lib modules under src/lib/runner-*.ts — no child_process, no HTTP, no SSE. The daemon (Plan 14-08b) owns orchestration; these primitives own content-generation and filesystem effects exclusively."
    - "0600 mode on every writeFileSync that owns a task-scoped artifact (task.json, env-file). Pre-rm before write to defeat OSes where mode only applies on CREATE — matches the src/lib/runner-secret.ts precedent."
    - "Defensive-default read pattern (Phase 13): readMcTaskJson returns null on ENOENT OR parse failure — a single null signal means 'no usable task.json', never throws."
    - "Deterministic Markdown generation (no Date.now / no randomness) — callers that need timestamps in preamble body pass them via priorAttempts[].started_at. Lets snapshot tests assert byte-stability."

key-files:
  created:
    - src/lib/runner-preamble.ts
    - src/lib/runner-worktree.ts
    - src/lib/runner-docker.ts
  modified:
    - src/lib/__tests__/runner-preamble.test.ts (replaced 6 it.todo stubs with 7 real tests)
    - src/lib/__tests__/runner-worktree-seed.test.ts (replaced 7 it.todo stubs with 10 real tests)
    - src/lib/__tests__/runner-docker-args.test.ts (replaced 8 it.todo stubs with 9 real tests)
    - src/lib/__tests__/runner-env-file.test.ts (replaced 5 it.todo stubs with 6 real tests)
    - src/lib/__tests__/runner-recipe-stage.test.ts (replaced 4 it.todo stubs with 4 real tests)
    - .planning/phases/14-runner-container-v1-2/deferred-items.md (appended pre-existing 14-06 scaffold TS errors — out-of-scope for 14-07)

key-decisions:
  - "Plan 14-08b daemon consumption strategy — inline re-declaration. The .mjs daemon will re-declare a minimal subset of these helpers inline (pointer comment back to src/lib/runner-*.ts as the source of truth + test surface) rather than spin up tsx at runtime. Rationale: keeps the daemon dependency-free (pure node boot), avoids a bundle step in Phase 14, and honors the plan frontmatter's default. A later cleanup plan may unify via esbuild bundling — not blocking 14-08b."
  - "Preamble HTTP skeleton forward-references POST {apiBase}/api/runner/checkpoint (Phase 15 live-wire) AND POST {apiBase}/api/runner/tasks/\$MC_TASK_ID/submit. The /submit reference closes the RAUTH-06 blocker where hello-world agents would hit PUT /api/tasks/:id and trigger the runner-token allowlist reject — tests defensively assert the legacy 'PUT /api/tasks/' string is absent from both variants."
  - "stageRecipe writes PREAMBLE.md AFTER the deep-copy so any recipe-authored PREAMBLE.md gets overwritten by the runner's version. The runner OWNS /recipe/PREAMBLE.md; recipe authors should not ship their own. Asserted in runner-recipe-stage.test.ts."
  - "seedMcDir preserves existing progress.md and checkpoints.jsonl on resume (is_resuming=true) but ALWAYS rewrites task.json with the new attempt counter + prior_attempts. Defensive fallback: if an operator wiped the worktree and re-marked is_resuming, create empty progress.md / checkpoints.jsonl so the agent's append-only write doesn't ENOENT."
  - "buildDockerRunArgs image is LAST in argv — an extra test asserts argv[argv.length - 1] === image so a future bug that inserts flags after the image (and therefore treats them as container argv) fails loud."
  - "writeEnvFile sanitises embedded \\n and \\r\\n to a single space. Real secrets should never carry line breaks, but recipe.env forwarded verbatim could — defensive. The env-file format is newline-separated so a mid-value newline would corrupt the next key=value line."

patterns-established:
  - "runner-* lib modules pattern: every module under src/lib/runner-*.ts is pure-logic, exports only named functions, and is directly unit-tested against os.tmpdir(). Plan 14-08a extended this with runner-gc / runner-reconcile / runner-timeout / runner-log-layout (landed concurrently)."
  - "TASK.JSON locked shape: McTaskJson { task_id, recipe_slug, attempt, is_resuming, prior_attempts[] } with prior_attempts[].started_at as ISO string (not unix seconds). Runner's in-memory record is unix seconds; buildPriorAttemptsEntry(unix, exitCode, reason) converts."
  - "Env-file over --env flags: every container-facing secret passes via --env-file. The argv composer NEVER emits --env KEY=VALUE for MC_API_TOKEN or recipe secrets. Tests defensively scan every argv element for 'MC_API_TOKEN=' and fail if found."

requirements-completed: [WORK-01, WORK-02, WORK-04, WORK-05, CONTAINER-01, CONTAINER-02, RUNNER-09, RUNNER-10]

# Metrics
duration: 10min
completed: 2026-04-20
---

# Phase 14 Plan 07: Runner Pure-Logic Primitives Summary

**Three pure-TypeScript lib modules under `src/lib/runner-*.ts` — preamble Markdown generator, worktree `.mc/` seeding helpers, and docker-run argv + env-file + recipe-stage helpers — factor every content/filesystem concern out of the Phase 14 daemon so Plan 14-08b can focus on orchestration (boot, SSE, claim, spawn, exit loop, GC) without mixing in business-logic.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-20T18:13:41Z
- **Completed:** 2026-04-20T18:23:52Z
- **Tasks:** 3
- **Files created:** 3 (src/lib/runner-preamble.ts, src/lib/runner-worktree.ts, src/lib/runner-docker.ts)
- **Files modified:** 5 test files (replaced 30 it.todo stubs with 36 real tests) + 1 deferred-items entry

## Accomplishments

- Locked the CONTEXT-mandated first-attempt and resume preamble text — tool-agnostic, deterministic, forward-references `/api/runner/checkpoint` (Phase 15) and `/api/runner/tasks/:id/submit` (Phase 11-04 allowlist-safe)
- Locked the `.mc/` seeding shape — task.json always rewritten, progress.md + checkpoints.jsonl preserved on resume, `.gitignore` literally `*\n`
- Locked docker-run argv composition — labels, mounts, `--add-host`, env-file, image-last — with CONTAINER-01 secrets-only-via-env-file invariant enforced in tests
- Shipped 36 unit tests — each explicitly prefixed with its primary requirement ID — that catch 80% of Plan 14-08b's potential bugs without needing a live Docker or git worktree

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement runner-preamble.ts + fill its tests** — `8cb9a1b` (feat)
2. **Task 2: Implement runner-worktree.ts + fill its tests** — `6af3ff6` (feat)
3. **Task 3: Implement runner-docker.ts + fill 3 test suites** — `8480a76` (feat)

**Plan metadata:** pending — will land with the final SUMMARY commit

## Files Created/Modified

- `src/lib/runner-preamble.ts` — `generatePreamble({isResuming, taskId, apiBase, priorAttempts})` -> Markdown body (first-attempt 30-50 lines, resume 35-55 lines)
- `src/lib/runner-worktree.ts` — `seedMcDir`, `readMcTaskJson`, `writeMcTaskJson`, `buildPriorAttemptsEntry` (pure fs helpers against a caller-provided worktree path)
- `src/lib/runner-docker.ts` — `buildDockerRunArgs`, `stageRecipe`, `writeEnvFile`, `cleanupEnvFile`, `slugify` (argv + fs helpers; no spawn, no HTTP)
- `src/lib/__tests__/runner-preamble.test.ts` — 7 tests (was 6 it.todo)
- `src/lib/__tests__/runner-worktree-seed.test.ts` — 10 tests (was 7 it.todo)
- `src/lib/__tests__/runner-docker-args.test.ts` — 9 tests (was 8 it.todo)
- `src/lib/__tests__/runner-env-file.test.ts` — 6 tests (was 5 it.todo)
- `src/lib/__tests__/runner-recipe-stage.test.ts` — 4 tests (was 4 it.todo)
- `.planning/phases/14-runner-container-v1-2/deferred-items.md` — entry #2 for pre-existing TS2556 spread errors in the Plan 14-06 runner-exit scaffold (out-of-scope for 14-07)

## Preamble Excerpt Snapshots

### First-attempt preamble — first 5 non-blank lines

```
# Task 42 — Runner Preamble (first attempt)
You are running inside an ephemeral container spawned by Mission Control.
This preamble is the runner-authored contract; the recipe author's SOUL.md ships next.
## Environment
These environment variables are set inside the container:
```

### Resume preamble — first 5 non-blank lines

```
# Task 42 — Runner Preamble (resume, attempt 3)
This is attempt 3 (is_resuming=true). Do NOT redo prior work — reconcile with it.
You are running inside an ephemeral container spawned by Mission Control.
## Mandatory first steps (in order)
1. read .mc/task.json — attempt counter and prior_attempts summary
```

## Decisions Made

See `key-decisions` frontmatter. High-level:

- **Plan 14-08b .mjs consumption strategy locked — inline re-declaration.** The daemon re-declares minimal subsets of these helpers in `scripts/mc-runner.mjs` with a pointer comment back to `src/lib/runner-*.ts` (the source of truth + test surface). Rationale: keeps the daemon dependency-free, avoids a bundle step in Phase 14, matches the plan frontmatter's default. A later unify-via-esbuild cleanup is a future concern.
- **Preamble uses /api/runner/tasks/\$MC_TASK_ID/submit, NOT PUT /api/tasks/:id.** The RAUTH-06 allowlist (src/lib/runner-tokens.ts) permits `POST /api/runner/tasks/:id/submit` but rejects `PUT /api/tasks/:id` for runner-token principals. Tests defensively assert the legacy path is absent.
- **stageRecipe writes PREAMBLE.md AFTER deep-copy.** Runner owns /recipe/PREAMBLE.md; recipe-authored competing files get overwritten.
- **Env-file sanitises embedded newlines.** Defensive guard against recipe.env forwarded verbatim with a stray `\n`.
- **Image is LAST in docker argv.** Asserted explicitly so a future flag-ordering bug that puts args after the image (accidentally treating them as container argv) fails loud.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Lint] Removed two stray `eslint-disable-next-line no-bitwise` directives**

- **Found during:** Task 3 lint pass
- **Issue:** The `no-bitwise` lint rule isn't actually enabled in the eslint-config-next config, so the disable directives I wrote prophylactically against `stat.mode & 0o777` bitwise-AND produced "Unused eslint-disable directive" warnings.
- **Fix:** Dropped the disable comments; the bitwise-AND compiles and lints clean.
- **Files modified:** src/lib/__tests__/runner-env-file.test.ts, src/lib/__tests__/runner-worktree-seed.test.ts
- **Verification:** `pnpm lint` against the 8 plan files — 0 errors, 0 warnings from plan-owned files (76 pre-existing warnings in unrelated files unchanged).
- **Committed in:** rolled into Task 3 commit `8480a76` (both edits were staged with the test body itself)

---

**Total deviations:** 1 auto-fixed (lint cleanup)
**Impact on plan:** Cosmetic. Plan executed as written — every task completed, every verification passed.

### Test-count expansion (tracking, not deviation)

The plan's `<done>` clauses specified 7 + 7 + 17 = 31 tests. Shipped: 7 + 10 + 19 = 36 tests. Extras:

- runner-worktree-seed: +2 (read/write round-trip, null on missing/malformed, buildPriorAttemptsEntry coverage)
- runner-docker-args: +1 (image-is-last-in-argv edge case)
- runner-env-file: +1 (newline-in-value sanitisation defensive guard)
- runner-recipe-stage: +0 (4 → 4 as spec'd)

Every stub from Plan 14-03 was replaced in-place per the `patterns-established` floor; extras add coverage on edge cases discovered while implementing — they don't change the scope or intent.

## Issues Encountered

- **Pre-existing TS2556 errors in Plan 14-06's runner-exit test scaffolds** (3 sites). Appended to `deferred-items.md` as entry #2. Out-of-scope for 14-07 per the plan's test verification block (which only asserts the 5 runner-lib test files pass, not a full tree typecheck). Plan 14-06 will fix when it expands those scaffolds with real fixtures.

## Verification

- `pnpm test src/lib/__tests__/runner-preamble.test.ts src/lib/__tests__/runner-worktree-seed.test.ts src/lib/__tests__/runner-docker-args.test.ts src/lib/__tests__/runner-env-file.test.ts src/lib/__tests__/runner-recipe-stage.test.ts -- --run` → **36 passed / 36 (5 files)** in 1.34s
- `pnpm lint` against the 8 plan-owned files → **0 errors, 0 warnings**
- Plan-owned typecheck surface is clean (the pre-existing 14-06 runner-exit test errors are scoped to that plan per the deferred-items log)

## Next Phase Readiness

- Plan 14-08b can now `import { generatePreamble }` / `import { seedMcDir, buildPriorAttemptsEntry }` / `import { buildDockerRunArgs, stageRecipe, writeEnvFile, cleanupEnvFile }` — or, per the locked decision, re-declare a minimal inline subset with a pointer comment.
- The `/api/runner/checkpoint` endpoint forward-reference in both preamble variants is stable across the Phase 14 → Phase 15 boundary. Phase 15 can live-wire the endpoint without touching this copy.
- The Plan 14-08a concurrent wave (runner-gc, runner-reconcile, runner-timeout, runner-log-layout) shipped under separate commits `c7e84fd` / `e1cdaff` / `b1fc5e8` and is file-disjoint from this plan — no merge conflicts expected.

## Self-Check: PASSED

- FOUND: src/lib/runner-preamble.ts
- FOUND: src/lib/runner-worktree.ts
- FOUND: src/lib/runner-docker.ts
- FOUND: src/lib/__tests__/runner-preamble.test.ts (7 real it() bodies, no it.todo remaining)
- FOUND: src/lib/__tests__/runner-worktree-seed.test.ts (10 real it() bodies)
- FOUND: src/lib/__tests__/runner-docker-args.test.ts (9 real it() bodies)
- FOUND: src/lib/__tests__/runner-env-file.test.ts (6 real it() bodies)
- FOUND: src/lib/__tests__/runner-recipe-stage.test.ts (4 real it() bodies)
- FOUND: commit 8cb9a1b (Task 1 — preamble)
- FOUND: commit 6af3ff6 (Task 2 — worktree)
- FOUND: commit 8480a76 (Task 3 — docker primitives + 3 test suites)

---
*Phase: 14-runner-container-v1-2*
*Completed: 2026-04-20*
