---
phase: 14-runner-container-v1-2
plan: 08a
type: execute
wave: 1
depends_on: [14-01, 14-02, 14-03]
files_modified:
  - src/lib/runner-gc.ts
  - src/lib/runner-reconcile.ts
  - src/lib/runner-timeout.ts
  - src/lib/runner-log-layout.ts
  - src/lib/__tests__/runner-gc.test.ts
  - src/lib/__tests__/runner-reconcile.test.ts
  - src/lib/__tests__/runner-timeout.test.ts
  - src/lib/__tests__/runner-log-layout.test.ts
autonomous: true
requirements: [RUNNER-12, RUNNER-13, RUNNER-14, CONTAINER-03, WORK-07]
locked_decisions:
  - "Pure-logic TS modules ONLY. No child_process, no HTTP, no SSE. Plan 14-08b daemon (scripts/mc-runner.mjs) imports behavior via duplicated inline copies; these modules are the test surface + source of truth."
  - "GC tick schedule (10 min + immediate on boot), destroy sequence (`git worktree remove --force` then `rm -rf` logs), and retention rules (done/cancelled immediate; failed after window) are LOCKED per CONTEXT.md."
  - "Timeout enforcement computed host-side from `mc.runner_started_at` label; remaining-time arithmetic must be resync-safe after reconciliation (Pitfall 9)."
  - "Log layout helper implements CONTEXT.md's locked layout: `.data/runner/logs/task-<id>/attempt-<n>/{stdout.log, stderr.log, meta.json}` + `latest → attempt-<n>/` symlink updated on every attempt start."
  - "meta.json carries {started_at, runner_id, container_id} on attempt start; {exited_at, exit_code, reason} appended on container exit."
must_haves:
  truths:
    - "gcShouldDestroy returns true for done/cancelled regardless of age; returns true for failed only after failed_gc_window_days elapsed"
    - "reconcileContainers partitions {adopt, kill, orphaned} from live docker ps output + pending-tasks snapshot"
    - "computeRemainingTimeoutMs handles startedAt + timeoutSeconds arithmetic with defensive clamping"
    - "runner-log-layout creates attempt dir + writes initial meta.json + atomically updates the `latest` symlink to point at the new attempt dir"
    - "runner-log-layout.finalizeMeta appends exit fields to meta.json without losing the initial fields"
  artifacts:
    - path: "src/lib/runner-gc.ts"
      provides: "gcShouldDestroy(terminalRow, nowUnix, windowDays) + planDestroy(list)"
      exports: ["gcShouldDestroy", "planDestroy"]
    - path: "src/lib/runner-reconcile.ts"
      provides: "reconcileContainers(liveContainers, pendingTasks) → {adopt[], kill[], orphaned[]}"
      exports: ["reconcileContainers"]
    - path: "src/lib/runner-timeout.ts"
      provides: "computeRemainingTimeoutMs(runnerStartedAtUnix, timeoutSeconds, nowUnix)"
      exports: ["computeRemainingTimeoutMs"]
    - path: "src/lib/runner-log-layout.ts"
      provides: "resolveLogPaths(taskId, attempt), ensureAttemptDir(taskId, attempt, meta), updateLatestSymlink(taskId, attempt), finalizeMeta(taskId, attempt, exitFields)"
      exports: ["resolveLogPaths", "ensureAttemptDir", "updateLatestSymlink", "finalizeMeta"]
  key_links:
    - from: "runner-log-layout.updateLatestSymlink"
      to: ".data/runner/logs/task-<id>/latest"
      via: "fs.rmSync(latest, {force:true}) + fs.symlinkSync(targetRelative, latest, 'dir')"
      pattern: "symlinkSync"
    - from: "runner-log-layout.ensureAttemptDir"
      to: "meta.json file write with {started_at, runner_id, container_id}"
      via: "fs.writeFileSync with mode 0600"
      pattern: "meta\\.json"
---

<objective>
Ship the four pure-logic TypeScript helpers the runner daemon needs: GC decision tree, reconciliation diff, timeout arithmetic, and log-layout manager. All four are unit-testable in isolation — no child_process, no HTTP, no filesystem side-effects outside of an injected tmpdir.

Purpose: This is the "half" of the former Plan 14-08 that can be tested meaningfully. Splitting helpers into this plan (14-08a) and orchestration into 14-08b keeps context per plan sane and gives the daemon (14-08b) a pre-tested primitives layer it just wires together.
Output: Four lib modules + four new test suites (one per module).
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/14-runner-container-v1-2/14-CONTEXT.md
@.planning/phases/14-runner-container-v1-2/14-RESEARCH.md
@.planning/phases/14-runner-container-v1-2/14-02-SUMMARY.md

<interfaces>
```typescript
// src/lib/runner-gc.ts
export interface TerminalRow { task_id: number; status: 'done'|'failed'|'cancelled'; terminal_at: number }
export interface DestroyPlan { task_id: number; reason: 'terminal-immediate'|'failed-aged-out' }
export function gcShouldDestroy(row: TerminalRow, nowUnix: number, failedWindowDays: number): boolean
export function planDestroy(rows: TerminalRow[], nowUnix: number, failedWindowDays: number): DestroyPlan[]

// src/lib/runner-reconcile.ts
export interface LiveContainer { container_id: string; labels: Record<string,string>; state: 'running'|'exited' }
export interface PendingTask { id: number; container_id: string; status: string; runner_started_at: number | null }
export function reconcileContainers(live: LiveContainer[], pending: PendingTask[]): {
  adopt: Array<{ task: PendingTask; container: LiveContainer }>,
  kill: LiveContainer[],
  orphaned: PendingTask[]
}

// src/lib/runner-timeout.ts
export function computeRemainingTimeoutMs(runnerStartedAtUnix: number, timeoutSeconds: number, nowUnix: number): number

// src/lib/runner-log-layout.ts
export interface LogPaths {
  attemptDir: string          // .data/runner/logs/task-<id>/attempt-<n>/
  stdoutLog: string           // attemptDir/stdout.log
  stderrLog: string           // attemptDir/stderr.log
  metaJson: string            // attemptDir/meta.json
  latestSymlink: string       // .data/runner/logs/task-<id>/latest (→ attempt-<n>/)
  taskLogRoot: string         // .data/runner/logs/task-<id>/
}

export interface AttemptMetaInit {
  started_at: string          // ISO 8601
  runner_id: string
  container_id: string | null // null until Plan 14-11 container-started fires
}

export interface AttemptMetaExit {
  exited_at: string           // ISO 8601
  exit_code: number | null
  reason: string
}

export function resolveLogPaths(dataDir: string, taskId: number | string, attempt: number): LogPaths
export function ensureAttemptDir(paths: LogPaths, meta: AttemptMetaInit): void
  // Creates attemptDir (recursive), writes meta.json (mode 0600) with meta, creates empty stdout.log + stderr.log.
export function updateLatestSymlink(paths: LogPaths, attempt: number): void
  // Atomically replaces latestSymlink. Implementation: fs.rmSync(latest, {force:true}) then fs.symlinkSync('attempt-<n>', latest, 'dir').
  // Target is RELATIVE (just 'attempt-<n>') so the symlink is portable if the log root is moved.
export function finalizeMeta(paths: LogPaths, exitFields: AttemptMetaExit): void
  // Reads meta.json, merges exitFields, writes back with mode 0600. Preserves original init fields.
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement runner-gc + runner-reconcile + runner-timeout + their unit tests</name>
  <files>src/lib/runner-gc.ts, src/lib/runner-reconcile.ts, src/lib/runner-timeout.ts, src/lib/__tests__/runner-gc.test.ts, src/lib/__tests__/runner-reconcile.test.ts, src/lib/__tests__/runner-timeout.test.ts</files>
  <action>
**src/lib/runner-gc.ts**:
- `gcShouldDestroy({task_id, status, terminal_at}, nowUnix, failedWindowDays)`:
  - status in {'done','cancelled'} → true always
  - status === 'failed' → `(nowUnix - terminal_at) >= failedWindowDays * 86400`
  - otherwise → false
- `planDestroy(rows, nowUnix, failedWindowDays)`:
  - Map rows to DestroyPlan[] filtering by gcShouldDestroy; reason is 'terminal-immediate' for done/cancelled, 'failed-aged-out' for failed past window

Tests (7):
1. WORK-07: done status returns true regardless of terminal_at age
2. cancelled status returns true regardless of age
3. failed status within window returns false
4. failed status at exact window boundary (age == windowSeconds) returns true
5. failed status beyond window returns true
6. unknown status returns false (defensive)
7. planDestroy preserves ordering and filters correctly

**src/lib/runner-reconcile.ts**:
- reconcileContainers(live, pending):
  - Build map by container_id from live (running only)
  - For each pending task: if task.container_id matches a running live container → adopt
  - For each pending task without a match → orphaned
  - For each live container with no matching pending row → kill (task already terminal or unknown)
  - Return {adopt[], kill[], orphaned[]}
  - Live containers in 'exited' state are IGNORED entirely (docker --rm removes them, but --filter may surface them)

Tests (6):
1. RUNNER-13: live running + pending matching → adopt
2. pending task with no live match → orphaned
3. live running container with no pending row → kill
4. live exited containers are ignored entirely (not in any bucket)
5. pending task with container_id starting with 'pending:' (placeholder from claim) + no live match → orphaned (expected; daemon should post runner-exit reason='crash')
6. empty inputs → empty outputs

**src/lib/runner-timeout.ts**:
- computeRemainingTimeoutMs(startedAtUnix, timeoutSeconds, nowUnix):
  - deadline = startedAtUnix + timeoutSeconds
  - `Math.max(0, (deadline - nowUnix) * 1000)`

Tests (5):
1. CONTAINER-03: happy path (started 10s ago, timeout 60s, remaining ~ 50_000 ms)
2. elapsed > timeout returns 0
3. timeout zero returns 0
4. startedAtUnix in the future returns timeout * 1000 clamped (should never happen but defensive)
5. non-finite inputs return 0
  </action>
  <verify>
    <automated>pnpm test src/lib/__tests__/runner-gc.test.ts src/lib/__tests__/runner-reconcile.test.ts src/lib/__tests__/runner-timeout.test.ts -- --run</automated>
  </verify>
  <done>18 tests pass across 3 files; typecheck clean.</done>
</task>

<task type="auto">
  <name>Task 2: Implement runner-log-layout + its unit tests (meta.json + latest symlink)</name>
  <files>src/lib/runner-log-layout.ts, src/lib/__tests__/runner-log-layout.test.ts</files>
  <action>
**src/lib/runner-log-layout.ts**: pure-filesystem helpers implementing CONTEXT.md's locked log layout.

```typescript
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, openSync, closeSync } from 'node:fs'
import { join } from 'node:path'

export function resolveLogPaths(dataDir: string, taskId: number | string, attempt: number): LogPaths {
  const taskLogRoot = join(dataDir, 'runner', 'logs', `task-${taskId}`)
  const attemptDir = join(taskLogRoot, `attempt-${attempt}`)
  return {
    attemptDir,
    stdoutLog: join(attemptDir, 'stdout.log'),
    stderrLog: join(attemptDir, 'stderr.log'),
    metaJson: join(attemptDir, 'meta.json'),
    latestSymlink: join(taskLogRoot, 'latest'),
    taskLogRoot,
  }
}

export function ensureAttemptDir(paths: LogPaths, meta: AttemptMetaInit): void {
  mkdirSync(paths.attemptDir, { recursive: true, mode: 0o700 })
  // Pre-create stdout.log and stderr.log so docker logs -f has target fds
  closeSync(openSync(paths.stdoutLog, 'a', 0o600))
  closeSync(openSync(paths.stderrLog, 'a', 0o600))
  writeFileSync(paths.metaJson, JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 })
}

export function updateLatestSymlink(paths: LogPaths, attempt: number): void {
  // Atomic replace: rm existing (force:true swallows ENOENT) then symlink with RELATIVE target.
  // Relative target means the symlink stays valid if the entire logs dir is moved.
  rmSync(paths.latestSymlink, { force: true })
  symlinkSync(`attempt-${attempt}`, paths.latestSymlink, 'dir')
}

export function finalizeMeta(paths: LogPaths, exitFields: AttemptMetaExit): void {
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(readFileSync(paths.metaJson, 'utf8'))
  } catch { /* missing or malformed — start fresh */ }
  const merged = { ...existing, ...exitFields }
  writeFileSync(paths.metaJson, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 })
}
```

**Tests** (8) at `src/lib/__tests__/runner-log-layout.test.ts`. Use `fs.mkdtempSync(path.join(os.tmpdir(), 'mc-runner-logs-'))` per test for isolation.

1. `resolveLogPaths returns exact layout per CONTEXT.md` — assert each field of the returned object matches the expected absolute path shape
2. `ensureAttemptDir creates attempt-<n>/ and empty stdout.log + stderr.log`
3. `ensureAttemptDir writes meta.json with started_at + runner_id + container_id fields`
4. `ensureAttemptDir is idempotent — calling twice does NOT throw; meta.json is overwritten with the latest init values`
5. `updateLatestSymlink creates latest → attempt-<n>/ symlink with a RELATIVE target`
   - After call: `fs.readlinkSync(paths.latestSymlink) === 'attempt-<n>'`
   - `fs.lstatSync(paths.latestSymlink).isSymbolicLink() === true`
6. `updateLatestSymlink replaces existing symlink — call with attempt=1 then attempt=2; final readlink = 'attempt-2'`
7. `finalizeMeta preserves original init fields (started_at/runner_id/container_id) and appends exit fields (exited_at/exit_code/reason)` — write init with started_at='A', finalize with exit_code=137, read back and assert BOTH started_at AND exit_code are present
8. `finalizeMeta handles missing meta.json gracefully — if file doesn't exist, writes a new one containing only exit fields` (defensive)

Gate symlink assertions with `if (process.platform === 'win32') return` — Windows symlink semantics differ; Phase 14 targets macOS LaunchAgent, Windows support is out of scope.
  </action>
  <verify>
    <automated>pnpm test src/lib/__tests__/runner-log-layout.test.ts -- --run</automated>
  </verify>
  <done>8 tests pass; log layout helper exercises the CONTEXT-locked directory structure + symlink atomicity.</done>
</task>

</tasks>

<verification>
- `pnpm test src/lib/__tests__/runner-gc.test.ts src/lib/__tests__/runner-reconcile.test.ts src/lib/__tests__/runner-timeout.test.ts src/lib/__tests__/runner-log-layout.test.ts -- --run` exits 0 (≥ 26 tests)
- `pnpm typecheck` clean
- `pnpm lint` clean
</verification>

<success_criteria>
Four pure-logic helpers are exported + tested. Plan 14-08b can consume all four by inline duplication in mc-runner.mjs, with these modules as the canonical contract + test surface.
</success_criteria>

<output>
After completion create `.planning/phases/14-runner-container-v1-2/14-08a-SUMMARY.md` documenting:
- Four module signatures
- Log layout directory structure (task-<id>/attempt-<n>/{stdout.log, stderr.log, meta.json} + latest symlink)
- meta.json lifecycle: init on attempt start → finalize on container exit
- Test counts per file
</output>
