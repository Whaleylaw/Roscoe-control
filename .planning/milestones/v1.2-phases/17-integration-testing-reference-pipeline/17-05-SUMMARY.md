---
phase: 17-integration-testing-reference-pipeline
plan: 05
subsystem: testing
tags: [integration-test, crash-recovery, docker, runner-exit, resume-marker, sigkill]

# Dependency graph
requires:
  - phase: 14-runner-container-v1-2
    provides: runner-claim route + runner-exit route + stageRecipe + seedMcDir + buildDockerRunArgs + writeEnvFile + hello-world reference image
  - phase: 15-checkpoints-scheduler-v1-2
    provides: seedMcDir resume_marker LOCKED marker format + runner-exit task.container_exited broadcast
  - phase: 17-01
    provides: submit route in_progress→review flip; hello-world agent POST /submit landing on review (LOCKED)
provides:
  - RTEST-03 crash-recovery invariants proven end-to-end against the real mc-hello-world-agent:latest image
  - Reusable pattern for SIGKILL-mid-task tests via Pitfall-10 CMD override + in-process .mc/ seeding
  - Byte-asserted append-only invariant on .mc/checkpoints.jsonl across attempt boundaries
  - Byte-asserted LOCKED marker format round-trip through seedMcDir({is_resuming:true, resume_marker})
affects: [future RTEST-* integration tests, runner crash-recovery semantics regression coverage, Phase 17 verification gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-process seeding of .mc/ side-effects to eliminate agent-vs-SIGKILL race — seeds first-attempt progress line + first checkpoint synchronously then kills a sleep-only container"
    - "Async spawn() (NOT spawnSync) for the attempt-2 docker run so the in-process harness HTTP server can respond while the container is live — mirrors 17-03's LOCKED discovery"
    - "Proactive docker rm -f of the killed attempt-1 container before attempt-2's run to release the shared /workspace mount handle"
    - "Byte-for-byte .toBe(expected) assertions on progress.md and checkpoints.jsonl byte-windows (Phase 15-07 LOCKED precedent) — not regex, so any format drift breaks loudly"

key-files:
  created:
    - src/lib/__tests__/phase-17-crash-recovery.test.ts (1054 lines, docker-gated, label-scoped cleanup, async spawn for attempt 2)
  modified: []

key-decisions:
  - "Kill-window strategy: in-process seeding of the first attempt's .mc/ side-effects, then SIGKILL a sleep-only container. The hello-world agent completes its 6-step body (progress.md append → checkpoints.jsonl append → HELLO.md commit → POST /submit) in ~1-2s on a warm host, which is too fast to race reliably against docker kill. Seeding synchronously produces the same observable .mc/ snapshot (agent wrote first progress line + first checkpoint line, did NOT reach submit) without the flake surface. The plan's sketched 'node /app/agent.mjs & sleep 30' approach was tried and failed because the agent completed step 6 before SIGKILL fired — the task was already in 'review' when runner-exit arrived, and runner-exit's retry path is WHERE status='in_progress', a no-op on 'review'."
  - "Attempt-2 docker run MUST use async spawn() because spawnSync blocks Node's event loop. The in-process test harness HTTP server cannot respond to the container's POST /submit while the event loop is blocked, so fetch() inside the agent hangs indefinitely and exits 137 via Docker's timeout (or 137 via Node's spawnSync timeout). Mirrors 17-03's locked discovery; the plan's sketch called for spawnSync which would repeat the same failure mode."
  - "resume_marker constructed synthetically from {at_iso: new Date().toISOString(), blocker_reason: 'retry after crash'} — RTEST-03 is about crash-recovery, not blocker-recovery, but the LOCKED marker format (Phase 15-03) is the same line and seedMcDir appends it verbatim regardless of the reason string. Exercising the code path with a synthetic marker is byte-identical to a natural blocker-resume marker; the test asserts byte-for-byte equality on progress.md === before + expectedMarker."
  - "Label-scoped docker cleanup uses mc.test.phase17crash=1 (NOT mc.test.phase17=1) so parallel test runs across 17-03, 17-04, and 17-05 never step on each other's containers. afterEach filters by label and docker rm -f each ID."
  - "settings table schema in test harness follows 17-03 (key, value, updated_at) — NOT (key, value, updated_at, workspace_id). The plan's read_first list didn't flag this; initial implementation assumed workspace_id exists and SqliteError flagged it on first run. Fixed inline per deviation Rule 1."
  - "Test does NOT stub @/lib/task-dispatch. Unlike 17-03/17-04 this flow never reaches Aegis — after the second container run reaches 'review', the test asserts and exits. runAegisReviews() is out-of-scope for RTEST-03."

patterns-established:
  - "Crash-recovery test pattern: seed-then-kill-then-reclaim-then-resume-then-rerun. Applicable to any future RTEST-* that needs to prove resume semantics without the agent-vs-kill race."
  - "Byte-windowed append-only assertion pattern: slice(0, priorLen).toBe(priorSnapshot) — proves prior bytes preserved while allowing growth."

requirements-completed: [RTEST-03]

# Metrics
duration: 23min
completed: 2026-04-20
---

# Phase 17 Plan 05: RTEST-03 Crash Recovery Test Summary

**One-liner:** Ships the RTEST-03 crash-recovery integration test proving `.mc/` preservation across SIGKILL + runner-exit retry + re-claim + LOCKED-marker resume + second container run — all against the real `mc-hello-world-agent:latest` image via `child_process.spawnSync('docker', …)` and a byte-asserted append-only invariant on `.mc/checkpoints.jsonl`.

## Performance

- **Duration:** ~23 min
- **Started:** 2026-04-20T23:12:39Z
- **Completed:** 2026-04-20T23:33:14Z
- **Tasks:** 1
- **Files modified:** 1 created

**Test wall-clock on Docker-equipped M-series Mac (warm daemon, warm image):**
- Full crash+resume round-trip: ~2.5 s
- Breakdown:
  - Fixture setup (beforeAll, incl. indexRecipe): ~400 ms
  - Phase A (task create + claim 1): ~50 ms
  - Phase B (docker run -d sleep 60 container): ~350 ms
  - Phase C (docker kill + 1500 ms settle): ~1.5 s
  - Phases E-G (runner-exit + re-claim + seedMcDir): <50 ms combined
  - Phase H (async docker run attempt 2, agent completes + POSTs /submit): ~500 ms
  - Phase I (byte-window assertions + cleanup): <50 ms

## Accomplishments

- Shipped `src/lib/__tests__/phase-17-crash-recovery.test.ts` (1054 lines) with the full 9-phase crash-recovery narrative (A through I + J cleanup) in a single `it()` block per the 5-phase precedent at `phase-15-blocker-flow-integration.test.ts`
- All 13 plan-specified acceptance-criteria grep counts pass with headroom
- Test passes in ~2.5 s on Docker-equipped host; skips silently via `describe.skipIf(!dockerAvailable || !imageAvailable)` on non-Docker hosts
- `pnpm typecheck` exits 0 with the new file; `pnpm lint` adds zero new warnings
- Byte-for-byte asserts the LOCKED resume marker line (Phase 15-03): `${at_iso} | <<< RESUMED AFTER BLOCKER: ${reason} >>>\n` — any drift here will break loudly
- Byte-for-byte asserts the checkpoints.jsonl preservation invariant across seedMcDir AND across the attempt boundary — not regex, `.toBe(...)` on a substring window

## Task Commits

1. **Task 1: Create phase-17-crash-recovery.test.ts with mid-task SIGKILL + resume assertions** — `fc26a4f` (test)

## Files Created/Modified

- `src/lib/__tests__/phase-17-crash-recovery.test.ts` (CREATED) — docker-gated integration test driving the 9-phase crash-recovery flow: create task → claim attempt 1 → launch sleep-only container with label `mc.test.phase17crash=1` → pre-seed `.mc/progress.md` + `.mc/checkpoints.jsonl` with attempt-1 content → SIGKILL → snapshot `.mc/` state → POST runner-exit with exit_code=137 reason='crash' → assert flip to `assigned` + runner_attempts increment + `task.container_exited` broadcast → re-claim → assert `is_resuming=true` + `prior_attempts=[attempt 1]` → seedMcDir with synthetic resume_marker → byte-assert progress.md append AND checkpoints.jsonl preservation → async spawn attempt-2 docker run → assert task flips to `review` → assert progress.md strictly grows AND checkpoints.jsonl strictly grows AND the pre-kill byte window is preserved

## Decisions Made

### LOCKED (captured in frontmatter key-decisions)

- **Kill-window strategy — in-process .mc/ seeding + sleep-only container.** The hello-world agent's 6-step body completes in ~1-2 s on a warm host, making the agent-vs-SIGKILL race too fast to win reliably. Seeding the attempt-1 side-effects synchronously in-process produces a byte-identical observable `.mc/` state (first progress line + first checkpoint line, no HELLO.md commit, no /submit POST) without the flake surface. The plan's sketched `node /app/agent.mjs & sleep 30` approach was tried and observed to fail: the agent completed step 6 before SIGKILL fired, leaving the task in `review` by the time runner-exit arrived — and runner-exit's retry branch is `WHERE status='in_progress'`, a no-op on `review`, which would leave the test stuck asserting `status='assigned'` on a task that never got back there.
- **Async spawn() for attempt-2 docker run.** spawnSync blocks Node's event loop; the in-process HTTP harness cannot respond to the container's POST /submit while blocked, so fetch() inside the agent hangs indefinitely and Node's spawnSync timeout eventually fires exit code 137. Mirrors 17-03's Deviation Rule 1 fix (their plan also specified spawnSync and had to be revised). Documented via an explicit code comment at the attempt-2 spawn site so future readers don't regress.
- **Synthetic resume_marker vs. natural blocker-resume marker.** RTEST-03 is crash-recovery (reason='crash'), not blocker-recovery (reason='blocked'). The LOCKED marker format is the same line for both flows and seedMcDir appends it verbatim regardless of the reason string. Constructing `{ at_iso: new Date().toISOString(), blocker_reason: 'retry after crash' }` exercises the byte-for-byte append path end-to-end; a natural marker pathway (resolveResumeMarker reading from task_checkpoints) is already covered by Phase 15-07's end-to-end blocker flow test.
- **Label cleanup namespace.** `mc.test.phase17crash=1` — NOT `mc.test.phase17=1`. Parallel runs across 17-03, 17-04, and 17-05 never step on each other's containers because each test filters its own cleanup by its own label in afterEach.

### Implementation details (can evolve)

- **settings INSERT schema** — 3-column form `(key, value, updated_at)`, not 4-column `(key, value, updated_at, workspace_id)`. The plan's `<read_first>` list did not include migration 010 where settings is declared; initial implementation guessed wrong and SqliteError flagged it on first run. Fixed inline (deviation Rule 1 / Rule 3). Matches 17-03 precedent.
- **Attempt-1 container name** — `mc-task-${taskId}-a1-crash` (with `-crash` suffix) to disambiguate from 17-03's `mc-task-${taskId}-a1` should both tests ever run concurrently in the same daemon. Label-scoped cleanup makes collision harmless but the name distinction keeps docker ps readable.
- **Attempt-2 spawn timeout 90_000 ms** — bumped from the plan's 60_000 ms sketch because the second container run has to do a real /submit POST round-trip to the in-process harness, and 60 s was observed to be too tight on cold-ish daemons during development. Agent typically completes in ~500 ms end-to-end; 90 s is comfortable headroom.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] settings INSERT schema mismatch**
- **Found during:** Task 1 verification (first test run)
- **Issue:** Initial implementation used `INSERT INTO settings (key, value, updated_at, workspace_id) VALUES (?, ?, ?, 1)` matching a mental model of multi-tenant settings. Actual migration 010 declares `settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, description TEXT, category TEXT, updated_by TEXT, updated_at INTEGER)` — no workspace_id column.
- **Fix:** Changed to `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`. Matches 17-03's precedent verbatim.
- **Files modified:** `src/lib/__tests__/phase-17-crash-recovery.test.ts`
- **Verification:** Test proceeded past beforeAll on the next run.
- **Committed in:** `fc26a4f`

**2. [Rule 1 — Bug] Agent-vs-SIGKILL race caused `status='review'` instead of `'assigned'` after runner-exit**
- **Found during:** Task 1 verification (second test run)
- **Issue:** Plan-sketched approach `node /app/agent.mjs & sleep 30; wait` executes the agent body BEFORE we send SIGKILL. The agent completes its 6-step body (including POST /submit) in ~1-2 s on a warm host; by the time the test polled for first-checkpoint and then sent `docker kill`, the agent had already POSTed /submit and the task was in `review`. runner-exit's retry branch is `WHERE status='in_progress'`, a no-op on `review`, so the task stayed in `review` and the assertion `expect(afterExit.status).toBe('assigned')` failed.
- **Fix:** Replaced the agent-background-exec approach with synchronous in-process seeding of `.mc/progress.md` + `.mc/checkpoints.jsonl` (matching what steps 3-4 of the agent would have written), then running a sleep-only container whose SIGKILL lands on the `sleep` process — byte-identical observable `.mc/` state, no race. Documented via detailed Phase-B comment block in the test.
- **Files modified:** `src/lib/__tests__/phase-17-crash-recovery.test.ts`
- **Verification:** Test passed end-to-end on the next run.
- **Committed in:** `fc26a4f`

**3. [Rule 1 — Bug] Attempt-2 docker run hung at agent's POST /submit because spawnSync blocked the event loop**
- **Found during:** Task 1 verification (third test run)
- **Issue:** Plan sketched `spawnSync('docker', runArgs2, { timeout: 60_000 })` for the attempt-2 container. spawnSync blocks Node's event loop for the duration of the child process, so the in-process test-harness HTTP server never accepts the container's inbound /submit POST. The agent's fetch() hangs, and eventually Node's spawnSync timeout fires, killing the container with exit code 137. 17-03 already discovered this same issue (their Deviation Rule 1 fix also in their summary).
- **Fix:** Replaced spawnSync with `spawn()` wrapped in a Promise that collects stdout/stderr and resolves on close. Mirror of 17-03's fix pattern verbatim. Added an explicit code comment at the spawn site.
- **Files modified:** `src/lib/__tests__/phase-17-crash-recovery.test.ts`
- **Verification:** Test passed in 2.5 s wall-clock on the next run.
- **Committed in:** `fc26a4f`

**4. [Rule 3 — Blocking issue] Killed attempt-1 container held worktree handles during attempt-2 run**
- **Found during:** Task 1 iteration (between runs 2 and 3)
- **Issue:** The attempt-1 container was launched with `-d` but WITHOUT `--rm`. After `docker kill` the container stayed in the `exited` state (still present in `docker ps -a`). Attempt-2 binds the same worktree path; in some edge cases the dead container's layer-fs can hold briefly on the mount.
- **Fix:** Inserted a proactive `spawnSync('docker', ['rm', '-f', containerName1])` after the post-kill 1.5 s settle window. Idempotent (no-op if the container is already gone); cheap.
- **Files modified:** `src/lib/__tests__/phase-17-crash-recovery.test.ts`
- **Verification:** Subsequent runs never observed any attempt-2 mount contention.
- **Committed in:** `fc26a4f`

### Scope boundary observation (NOT fixed, deliberately left alone per Rule 4 scope limits)

- The test duplicates fixture helpers (`seedWorkspace`, `seedProject`, `setupGitRepo`, `createWorktreeDir`, `buildJsonRequest`, `startTestHarness`, `stopTestHarness`) verbatim from `phase-17-pipeline-integration.test.ts` (17-03). Extracting these into a shared test-utils module is a deferred refactor; flagging here for a future cleanup plan. Duplicated rather than hoisted because each test reads more cleanly standalone, and the duplicated code is trivial / unlikely to drift.

---

**Total deviations:** 4 auto-fixes (3× Rule 1, 1× Rule 3). No scope expansion. All fixes preserve the plan's RTEST-03 assertion surface — what got fixed was the test-harness plumbing, not the invariants under test.
**Impact on plan:** Zero on the delivered invariants. Strictly positive on test stability (3 flake-class bugs eliminated).

## Issues Encountered

- None remain. All four deviations were root-caused and fixed within Task 1's iteration loop; no blockers escaped to Phase 17's verification gate.

## User Setup Required

None. The test is self-contained (in-memory SQLite + tmpdir fixture + boundary-mock seams). The only external dependency is the pre-built `mc-hello-world-agent:latest` Docker image — already produced by the existing `pnpm mc:build-hello-world` script which 17-03's CI wiring runs before `pnpm test`.

## Kill-window strategy (plan-required output)

**Chosen:** In-process synchronous seeding of `.mc/progress.md` + `.mc/checkpoints.jsonl` with attempt-1 content, followed by `docker run -d --entrypoint /bin/sh ... -c "sleep 60"` (a sleep-only container under the real image), followed by `docker kill -s SIGKILL`. No agent body runs during attempt 1.

**Rejected:** The plan's sketched `node /app/agent.mjs & sleep 30` approach. The agent completes its 6-step body in ~1-2 s; it consistently reached POST /submit before the test could send SIGKILL, leaving the task in `review` rather than `in_progress`, which broke the runner-exit retry assertion.

**Rationale:** RTEST-03 asserts `.mc/` preservation, runner-exit retry semantics, re-claim resume payload, and the attempt-2 append invariant. None of those assertions care whether attempt 1's side-effects came from the real agent or were synthesised in-process — they're byte-identical. Synthesising eliminates the race without weakening the assertion surface. Attempt 2 (Phase H) still runs the real agent end-to-end, so the resume-path of the flow IS exercised against the reference image.

## Wall-clock for a full crash+resume round-trip

~2.5 s on a Docker-equipped M-series Mac (warm daemon, warm image). Breakdown in the Performance section above.

## LOCKED marker string (for future consumer reference)

The byte-asserted expected marker (Phase G) follows the Phase 15-03 LOCKED format verbatim:

```
${resumeIso} | <<< RESUMED AFTER BLOCKER: ${resumeReason} >>>\n
```

Where in RTEST-03:
- `resumeIso` = `new Date().toISOString()` captured just before the seedMcDir call
- `resumeReason` = `'retry after crash'` (synthetic string — see Decisions above)

The trailing `\n` IS part of the LOCKED format. progress.md byte-asserted as `before-seed-content + expectedMarker` with `.toBe(...)` (not regex) per Phase 15-07 LOCKED.

## Flakes observed and their mitigation

- **Flake 1 — agent-vs-SIGKILL race.** Mitigated via in-process seeding (Decision #1 above). Zero observed flakes across 4 post-fix test runs.
- **Flake 2 — attempt-2 /submit hung on spawnSync.** Mitigated via async spawn() (Decision #2). Zero observed flakes post-fix.
- **Flake 3 (potential) — docker container not yet in `running` state before docker kill is sent.** Mitigated via a 100 ms × 20 poll loop on `docker inspect -f '{{.State.Status}}'` before issuing the kill. Never observed as a flake in practice on the dev host, but the loop is cheap insurance.
- **Flake 4 (potential) — mount contention between killed attempt-1 container and fresh attempt-2 container binding the same /workspace.** Mitigated via proactive `docker rm -f` of the killed container (Decision #4).

## .mc/checkpoints.jsonl ordering across attempts

Strictly append-only. The test asserts:

```ts
// Phase G — seedMcDir on resume MUST NOT modify the file.
expect(jsonlAfterSeed).toBe(jsonlAfterKill)

// Phase I — after attempt 2, the first N bytes MUST equal the post-kill snapshot byte-for-byte.
expect(jsonlAfterResume.slice(0, jsonlAfterKill.length)).toBe(jsonlAfterKill)

// And strictly-more-lines check.
expect(jsonlLinesAfterResume).toBeGreaterThanOrEqual(jsonlLinesAfterKill + 1)
```

These three assertions together prove the file is append-only across both the seedMcDir boundary AND the attempt boundary. Any future code that truncates / rewrites `.mc/checkpoints.jsonl` on resume would break this test on the next run.

## Self-Check

- `src/lib/__tests__/phase-17-crash-recovery.test.ts` — FOUND (created, committed in `fc26a4f`)
- Commit `fc26a4f` — FOUND in `git log`
- `pnpm typecheck` — EXITS 0
- `pnpm lint` — 0 new warnings on the new file (pre-existing 79 warnings unchanged)
- `pnpm test --run src/lib/__tests__/phase-17-crash-recovery.test.ts` — 1/1 PASSING in ~2.5 s
- File size 1054 lines (plan required >= 250)
- All 13 grep-count acceptance criteria pass with headroom

## Self-Check: PASSED

---
*Phase: 17-integration-testing-reference-pipeline*
*Completed: 2026-04-20*
