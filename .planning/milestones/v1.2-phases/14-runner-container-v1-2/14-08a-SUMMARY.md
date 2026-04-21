---
phase: 14-runner-container-v1-2
plan: 08a
subsystem: runner-daemon-primitives
tags: [runner, gc, reconcile, timeout, log-layout, phase-14]
requires:
  - Phase 14 Plan 14-01 (migrations 060/061 — already present)
  - Phase 14 Plan 14-02 (getFailedGcWindowDays getter — consumed by 14-08b, not imported here)
  - Phase 14 Plan 14-03 (Wave-0 test scaffold pattern)
provides:
  - runner-gc.ts — gcShouldDestroy + planDestroy (done/cancelled immediate, failed after window)
  - runner-reconcile.ts — reconcileContainers (adopt / kill / orphaned partition)
  - runner-timeout.ts — computeRemainingTimeoutMs (defensive clamping, resync-safe)
  - runner-log-layout.ts — resolveLogPaths / ensureAttemptDir / updateLatestSymlink / finalizeMeta
affects:
  - Plan 14-08b (runner daemon `scripts/mc-runner.mjs`) — inlines these four helpers' behavior; this plan is the canonical contract + test surface.
  - Plan 14-11 (container-started / submit routes) — downstream consumer of meta.json's `container_id` field.
tech-stack:
  added: []
  patterns:
    - Pure-logic modules (no child_process, no HTTP, no DB) so unit tests exercise behavior in isolation.
    - Defensive default pattern mirrors Phase 13/14-02 (non-finite / unknown-status / missing-file → documented fallback, never throw).
    - Log-layout helpers accept injected `dataDir` so tests can scope side effects to a per-test tmpdir.
    - Test files mirror CONTEXT.md requirement-ID prefixes (`WORK-07:`, `RUNNER-13:`, `CONTAINER-03:`) so `vitest --reporter=verbose` prints requirement-by-requirement.
key-files:
  created:
    - src/lib/runner-gc.ts
    - src/lib/runner-reconcile.ts
    - src/lib/runner-timeout.ts
    - src/lib/runner-log-layout.ts
    - src/lib/__tests__/runner-gc.test.ts
    - src/lib/__tests__/runner-reconcile.test.ts
    - src/lib/__tests__/runner-timeout.test.ts
    - src/lib/__tests__/runner-log-layout.test.ts
  modified: []
decisions:
  - "Pure-logic TS modules ONLY — no child_process, no HTTP, no SSE side effects. Plan 14-08b daemon (`scripts/mc-runner.mjs`) can either import these (if bundled) or inline-duplicate; either way, THESE modules are the contract + test surface and source of truth."
  - "GC destroy rules locked per 14-CONTEXT.md: `done`/`cancelled` destroy immediately, `failed` destroys after `failed_gc_window_days` elapsed; unknown-status rows are never destroyed (defensive)."
  - "`computeRemainingTimeoutMs` is resync-safe: the runner re-computes remaining time from `mc.runner_started_at` label after any restart rather than starting a local timer, so a crashed-and-relaunched daemon enforces the ORIGINAL deadline (Pitfall 9)."
  - "Exited live containers are IGNORED by `reconcileContainers` — docker --rm removes them on exit, and treating transient exited rows as `kill` would issue `docker kill` against already-removed containers."
  - "`latest` symlink uses a RELATIVE target (`attempt-<n>`, not an absolute path) so the entire logs dir stays portable if moved."
  - "`finalizeMeta` is defensively tolerant of a missing/malformed meta.json — it writes a fresh file rather than throwing, so exit bookkeeping never fails because ensureAttemptDir crashed between mkdir and writeFile."
  - "Symlink-touching tests are gated on `process.platform !== 'win32'` via `it.skipIf` — Phase 14 targets macOS LaunchAgent, Windows is out of scope."
metrics:
  completed_date: 2026-04-20
  duration_minutes: 4
  task_count: 2
  files_changed: 8
  tests_added: 26
requirements: [RUNNER-12, RUNNER-13, RUNNER-14, CONTAINER-03, WORK-07]
---

# Phase 14 Plan 08a: Runner Daemon Primitives Summary

**One-liner:** Four pure-logic TypeScript helpers — GC decision tree, reconciliation diff, timeout arithmetic, and log-layout manager — each with a full Vitest suite so Plan 14-08b (`scripts/mc-runner.mjs`) wires them together without re-validating arithmetic or layout invariants.

## What Shipped

### 1. `src/lib/runner-gc.ts`

Exports `gcShouldDestroy(row, nowUnix, failedWindowDays)` + `planDestroy(rows, nowUnix, failedWindowDays)`.

| Input status               | Destroy decision                                | DestroyPlan.reason      |
| -------------------------- | ----------------------------------------------- | ----------------------- |
| `done`                     | always `true`                                   | `'terminal-immediate'`  |
| `cancelled`                | always `true`                                   | `'terminal-immediate'`  |
| `failed` (within window)   | `false`                                         | (not planned)           |
| `failed` (at/past window)  | `true` (gate: `age >= windowDays * 86_400`)     | `'failed-aged-out'`     |
| unknown                    | `false` (defensive)                             | (not planned)           |

`planDestroy` preserves input ordering — runner daemon can iterate the returned list without re-sorting.

### 2. `src/lib/runner-reconcile.ts`

Exports `reconcileContainers(live, pending)` returning `{adopt[], kill[], orphaned[]}`.

| Live state | Pending match | Bucket     | Daemon action                                                                       |
| ---------- | ------------- | ---------- | ----------------------------------------------------------------------------------- |
| `running`  | yes           | `adopt`    | Attach stdout/stderr streams, resume timeout tracking                              |
| `running`  | no            | `kill`     | `docker kill <container_id>` — task already terminal or unknown                    |
| any        | yes, no live  | `orphaned` | Post `runner-exit` with reason='crash' (daemon → Plan 14-06)                       |
| `exited`   | any           | (ignored)  | `docker --rm` removes on exit; reconcile skips to avoid killing already-gone rows  |

### 3. `src/lib/runner-timeout.ts`

Exports `computeRemainingTimeoutMs(runnerStartedAtUnix, timeoutSeconds, nowUnix)`.

Defensive clamping rules (all return `0` unless noted):

- Any non-finite input → `0` (kill now)
- `timeoutSeconds <= 0` → `0` (kill now)
- `elapsed > timeoutSeconds` → `0` (kill now)
- `elapsed < 0` (startedAt in the future, clock skew guard) → `timeoutSeconds * 1000`
- Normal case → `(timeoutSeconds - elapsed) * 1000`

Resync-safe: the daemon re-computes remaining time from the container's `mc.runner_started_at` label after any restart, so restart does not extend the deadline.

### 4. `src/lib/runner-log-layout.ts`

Exports four functions against the locked layout from 14-CONTEXT.md:

```
.data/runner/logs/task-<id>/
  ├── attempt-<n>/
  │   ├── stdout.log
  │   ├── stderr.log
  │   └── meta.json
  └── latest → attempt-<n>/      (symlink, RELATIVE target)
```

| Function                | Role                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `resolveLogPaths`       | Pure path builder — no I/O. Returns `{attemptDir, stdoutLog, stderrLog, metaJson, latestSymlink, taskLogRoot}`. |
| `ensureAttemptDir`      | `mkdir -p attemptDir` (mode 0700) → create empty `stdout.log` / `stderr.log` (mode 0600) → write initial `meta.json` (mode 0600). Idempotent. |
| `updateLatestSymlink`   | `rmSync(latest, {force:true})` → `symlinkSync('attempt-<n>', latest, 'dir')`. RELATIVE target keeps layout portable. |
| `finalizeMeta`          | Read existing meta.json → merge `{exited_at, exit_code, reason}` → write back. Tolerates missing/malformed existing file. |

### meta.json Lifecycle

```
ensureAttemptDir → meta.json:
  { "started_at": "2026-04-20T12:00:00Z",
    "runner_id":  "runner-local-1",
    "container_id": "c-xyz" | null }

finalizeMeta → meta.json:
  { "started_at": "2026-04-20T12:00:00Z",
    "runner_id":  "runner-local-1",
    "container_id": "c-xyz",
    "exited_at": "2026-04-20T12:05:00Z",
    "exit_code": 137,
    "reason":    "oom" }
```

## Tasks Completed

| # | Name                                                                            | Commit    | Files                                                                                                     |
| - | ------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| 1 | Implement runner-gc + runner-reconcile + runner-timeout + their unit tests      | `c7e84fd` | `src/lib/runner-gc.ts`, `src/lib/runner-reconcile.ts`, `src/lib/runner-timeout.ts`, 3 test files          |
| 2 | Implement runner-log-layout + its unit tests (meta.json + latest symlink)       | `e1cdaff` | `src/lib/runner-log-layout.ts`, `src/lib/__tests__/runner-log-layout.test.ts`                             |

## Test Coverage

| Test file                                              | Tests | Focus                                                                                                 |
| ------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------- |
| `src/lib/__tests__/runner-gc.test.ts`                  | 7     | WORK-07 done-immediate, cancelled-immediate, failed-within-window, failed-at-boundary, failed-beyond, unknown-defensive, planDestroy filter+order |
| `src/lib/__tests__/runner-reconcile.test.ts`           | 6     | RUNNER-13 adopt, orphaned (no match), kill (stray running), exited-ignored, pending-placeholder orphaned, empty |
| `src/lib/__tests__/runner-timeout.test.ts`             | 5     | CONTAINER-03 happy path, elapsed-past-timeout, zero-timeout, future-start clamp, non-finite inputs   |
| `src/lib/__tests__/runner-log-layout.test.ts`          | 8     | layout correctness, ensureAttemptDir (+idempotent), updateLatestSymlink (relative target + replace), finalizeMeta (preserve init + missing file) |
| **Total**                                              | **26**| Plan target ≥ 26 — met                                                                                 |

All 26 tests pass under `pnpm test src/lib/__tests__/runner-{gc,reconcile,timeout,log-layout}.test.ts -- --run`.

## Verification

- `pnpm test src/lib/__tests__/runner-gc.test.ts src/lib/__tests__/runner-reconcile.test.ts src/lib/__tests__/runner-timeout.test.ts src/lib/__tests__/runner-log-layout.test.ts -- --run` → 26/26 pass, 710 ms
- `npx eslint src/lib/runner-{gc,reconcile,timeout,log-layout}.ts src/lib/__tests__/runner-{gc,reconcile,timeout,log-layout}.test.ts` → clean (0 errors, 0 warnings)
- `pnpm typecheck` → the only TS error is the pre-existing `src/app/api/runner/heartbeat/__tests__/route.test.ts:197` response-type mismatch introduced by Plan 14-04 (tracked in `.planning/phases/14-runner-container-v1-2/deferred-items.md`) — out of scope for 14-08a.

## Deviations from Plan

None. Plan 14-08a executed exactly as written — four modules + four test suites shipped with exactly the signatures and behaviors specified in `<interfaces>` + `<tasks>`.

**Pre-existing typecheck noise (out of scope):** `src/app/api/runner/heartbeat/__tests__/route.test.ts:197` has a `TS2345` error introduced in Plan 14-04 (commit `60155f7`), already documented in `deferred-items.md`. Not touched by this plan.

## Key Decisions

- **Pure-logic contract.** Every module is stateless + side-effect-scoped; runner daemon (Plan 14-08b) can embed behavior without pulling in a test harness. The module files are the canonical contract any daemon implementation must honor.
- **Defensive-default everywhere.** Unknown status, non-finite arithmetic, missing meta.json — none throw, all fall back to the documented safe behavior. A corrupt input row cannot brick GC, timeout, or log lifecycle.
- **Relative-target `latest` symlink.** `readlinkSync(latest) === 'attempt-<n>'` — not an absolute path. Keeps `.data/runner/logs/` portable if the operator moves it (bind-mount swaps, tmpfs promotion, etc.).
- **Exited-container ignore rule.** Reconciliation skips `state === 'exited'` entirely — the `docker --rm` flag removes them on exit, and classifying them as kill-targets would error against an already-removed container.

## Entry Point for Plan 14-08b

Plan 14-08b (`scripts/mc-runner.mjs`) can either:

1. **Import these modules directly** if the daemon is compiled through the MC build pipeline (preferred — single source of truth).
2. **Inline-duplicate the function bodies** if the daemon is shipped as a raw .mjs file run outside the bundle. In that case the four source files remain the contract + test surface — any inline copy must honor the same signatures and the same 26-test behavior.

The daemon is expected to call, at the appropriate lifecycle points:

```typescript
// GC tick (every 10 min + on boot)
const terminalRows = await fetch('/api/runner/terminal-tasks?since=...')
const destroyPlans = planDestroy(terminalRows, Math.floor(Date.now() / 1000), getFailedGcWindowDays())
for (const { task_id } of destroyPlans) { /* git worktree remove --force + rm -rf logs */ }

// Boot reconciliation
const live = await dockerPs()       // state + container_id + labels
const pending = await fetch('/api/runner/pending-containers')
const { adopt, kill, orphaned } = reconcileContainers(live, pending)

// Timeout watchdog (per container)
const remaining = computeRemainingTimeoutMs(container.runner_started_at, recipe.timeout_seconds, Math.floor(Date.now() / 1000))
if (remaining === 0) dockerKill(container.container_id)

// Log lifecycle (on attempt start + on container exit)
const paths = resolveLogPaths(dataDir, taskId, attempt)
ensureAttemptDir(paths, { started_at, runner_id, container_id })
updateLatestSymlink(paths, attempt)
// ...container runs...
finalizeMeta(paths, { exited_at, exit_code, reason })
```

## Self-Check: PASSED

- FOUND: src/lib/runner-gc.ts
- FOUND: src/lib/runner-reconcile.ts
- FOUND: src/lib/runner-timeout.ts
- FOUND: src/lib/runner-log-layout.ts
- FOUND: src/lib/__tests__/runner-gc.test.ts
- FOUND: src/lib/__tests__/runner-reconcile.test.ts
- FOUND: src/lib/__tests__/runner-timeout.test.ts
- FOUND: src/lib/__tests__/runner-log-layout.test.ts
- FOUND: commit c7e84fd (Task 1)
- FOUND: commit e1cdaff (Task 2)
