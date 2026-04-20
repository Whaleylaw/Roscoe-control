---
phase: 14-runner-container-v1-2
plan: 08b
type: execute
wave: 2
depends_on: [14-04, 14-05, 14-06, 14-07, 14-08a, 14-11]
files_modified:
  - scripts/mc-runner.mjs
  - scripts/com.missioncontrol.runner.plist
  - scripts/README.runner.md
autonomous: true
requirements: [RUNNER-01, RUNNER-02, RUNNER-03, RUNNER-04, RUNNER-05, RUNNER-06, RUNNER-07, RUNNER-08, RUNNER-09, RUNNER-10, RUNNER-11, RUNNER-12, RUNNER-13, RUNNER-14, CONTAINER-03, WORK-03, WORK-06, WORK-07, MODEL-04]
locked_decisions:
  - "Open Question #3: runner logger → local minimal logger (console.log JSON lines with {level, ts, msg, ...ctx}). Avoid bundling TS pino from @/lib/logger into a .mjs script."
  - "mc-runner.mjs inlines minimal copies of generatePreamble / seedMcDir / buildDockerRunArgs / writeEnvFile / stageRecipe / gcShouldDestroy / reconcileContainers / computeRemainingTimeoutMs / resolveLogPaths / ensureAttemptDir / updateLatestSymlink / finalizeMeta behaviors by RE-DECLARING them in-file with a comment pointing back to src/lib/runner-*.ts as the source of truth. Tests in 14-07 + 14-08a cover canonical behavior; this duplication is intentional until a future bundle step."
  - "project_repo_map resolution: daemon calls `GET /api/runner/config` (Plan 14-11) on startup and on SIGHUP reload. NO env-var fallback; the config endpoint is the single source of truth."
  - "Timeout enforcement = host-side setTimeout with ability to resync elapsed from label mc.runner_started_at after reconciliation (Pitfall 9)."
  - "GC tick: every 10 minutes + immediate on boot. Destroy sequence: `git worktree remove --force` then `rm -rf` logs."
  - "Boot sequence order is LOCKED per CONTEXT.md: 1) read secret, 2) docker info, 3) GET /api/runner/config, 4) reconcile, 5) register+heartbeat, 6) SSE + poll, 7) GC tick."
  - "After `docker run` returns a real container_id, daemon POSTs to /api/runner/tasks/:task_id/container-started (Plan 14-11). On success, updates local activeTasks map. On 409, logs and continues (race tolerated)."
  - "Log layout: daemon calls resolveLogPaths(DATA_DIR, taskId, attempt) then ensureAttemptDir({started_at, runner_id, container_id:null}) then updateLatestSymlink(attempt). After docker run returns the id, daemon overwrites meta.json via finalizeMeta-like merge (or a second ensureAttemptDir with the container_id). On container exit, finalizeMeta({exited_at, exit_code, reason})."
  - "LaunchAgent uses KeepAlive + ThrottleInterval 30 so Docker-down backoff is clean."
  - "Behavioral end-to-end verification lives in Plan 14-10 human-verify + Phase 17 integration suite. This plan's automated verify is scoped to syntax + file-presence + no-secret-required bootstrap (exit 1 with distinct stderr when .data/runner.secret is missing)."
must_haves:
  truths:
    - "scripts/mc-runner.mjs starts, reads .data/runner.secret, probes docker info, exits 1 on missing secret or exits 2 on docker-down"
    - "Runner fetches GET /api/runner/config at startup; fallback is to exit 1 if the endpoint is unreachable (no silent defaults)"
    - "Runner reconciles orphaned containers at boot — docker ps --filter label=mc.task_id cross-ref /api/runner/pending-containers"
    - "Runner heartbeats every 10s (self-scheduled, drift-resistant) via POST /api/runner/heartbeat"
    - "Runner subscribes to /api/events SSE, consumes task.runner_requested frames, + polls /api/runner/ready-tasks every 15s"
    - "On claim success, runner creates/reuses git worktree, seeds .mc/, stages recipe + PREAMBLE.md, writes env-file, spawns docker run --rm -d, calls /api/runner/tasks/:id/container-started with the real container_id, and pipes docker logs -f to .data/runner/logs/task-<id>/attempt-<n>/{stdout.log, stderr.log} (with meta.json + latest symlink per Plan 14-08a layout)"
    - "Runner enforces recipe.timeout_seconds with docker stop --time=15; posts runner-exit with exit_code/reason/stderr_tail AND finalizes meta.json after exit"
    - "Runner GC tick (every 10 min + boot) calls /api/runner/terminal-tasks?since=<last_scan>; destroys worktrees + logs for done/cancelled immediately; preserves failed tasks for failed_gc_window_days"
    - "Runner never includes MC_API_TOKEN in argv — only env-file"
    - "Docker daemon down during runtime: container spawn fails → posts runner-exit reason='docker_error' to unstick task"
  artifacts:
    - path: "scripts/mc-runner.mjs"
      provides: "Standalone Node ESM runner daemon"
      min_lines: 600
    - path: "scripts/com.missioncontrol.runner.plist"
      provides: "macOS LaunchAgent template with placeholders"
    - path: "scripts/README.runner.md"
      provides: "Install/run instructions for operators"
  key_links:
    - from: "scripts/mc-runner.mjs boot"
      to: "src/lib/runner-secret.ts"
      via: "reads .data/runner.secret file directly (not via getRunnerSecret import since .mjs)"
      pattern: "runner.secret"
    - from: "scripts/mc-runner.mjs SSE consumer"
      to: "GET /api/events"
      via: "fetch + ReadableStream (Pattern 2 from research)"
      pattern: "text/event-stream"
    - from: "scripts/mc-runner.mjs claim flow"
      to: "POST /api/runner/claim/:task_id"
      via: "fetch with Bearer runner-secret"
      pattern: "/api/runner/claim/"
    - from: "scripts/mc-runner.mjs post-docker-run"
      to: "POST /api/runner/tasks/:task_id/container-started (Plan 14-11)"
      via: "fetch with Bearer runner-secret, body {container_id}"
      pattern: "container-started"
    - from: "scripts/mc-runner.mjs exit handler"
      to: "POST /api/runner/tasks/:task_id/runner-exit"
      via: "fetch with Bearer runner-secret"
      pattern: "/runner-exit"
    - from: "scripts/mc-runner.mjs startup"
      to: "GET /api/runner/config (Plan 14-11)"
      via: "fetch with Bearer runner-secret"
      pattern: "/api/runner/config"
    - from: "scripts/mc-runner.mjs log setup"
      to: "resolveLogPaths + ensureAttemptDir + updateLatestSymlink (Plan 14-08a)"
      via: "inlined behavior mirroring src/lib/runner-log-layout.ts"
      pattern: "attempt-"
    - from: "scripts/mc-runner.mjs exit handler"
      to: "finalizeMeta (Plan 14-08a mirror)"
      via: "meta.json merge after container exit"
      pattern: "meta\\.json"
    - from: "scripts/mc-runner.mjs GC tick"
      to: "GET /api/runner/terminal-tasks?since="
      via: "fetch with Bearer runner-secret"
      pattern: "/api/runner/terminal-tasks"
---

<objective>
Ship the standalone runner daemon `scripts/mc-runner.mjs` + its macOS LaunchAgent template + install README. This is the single largest Phase 14 artifact — the orchestration layer that consumes every API endpoint (Plans 14-04/05/06/11) and every pure-logic primitive (Plans 14-07/08a) to launch real containers against a real worktree.

Purpose: With all substrate + primitives + endpoints in place, the daemon is the final orchestration layer. The helpers shipped in Plan 14-08a (+ the endpoints in Plan 14-11) let this plan focus purely on wire-up: boot, SSE, claim, run, exit, GC loops.
Output: Daemon + LaunchAgent + README (three files).
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/14-runner-container-v1-2/14-CONTEXT.md
@.planning/phases/14-runner-container-v1-2/14-RESEARCH.md
@.planning/phases/14-runner-container-v1-2/14-04-SUMMARY.md
@.planning/phases/14-runner-container-v1-2/14-05-SUMMARY.md
@.planning/phases/14-runner-container-v1-2/14-06-SUMMARY.md
@.planning/phases/14-runner-container-v1-2/14-07-SUMMARY.md
@.planning/phases/14-runner-container-v1-2/14-08a-SUMMARY.md
@.planning/phases/14-runner-container-v1-2/14-11-SUMMARY.md

@scripts/mc-cli.cjs
@src/lib/runner-secret.ts

<interfaces>
Dispatch payload from Plan 14-05 claim route:
```typescript
{
  task: { id, recipe_slug, workspace_source, read_only_mounts, extra_skills, attempt, is_resuming, prior_attempts, runner_max_attempts },
  recipe: RecipeRow,
  env: Record<string, string>,
  runner_token_expires_at: number,
  resource_limits: { memory: string, cpus: number },
  container_name_prefix: string,
}
```

Config response from Plan 14-11 GET /api/runner/config:
```typescript
{
  project_repo_map: Record<string, string>,
  max_memory_per_container: string,
  max_cpu_per_container: number,
  failed_gc_window_days: number,
  max_concurrent_containers: number
}
```

container-started request body (Plan 14-11):
```typescript
{ container_id: string }  // real docker container_id after `docker run`
```

runner-exit request body (Plan 14-06):
```typescript
{ exit_code: number | null, reason: string, stderr_tail?: string, attempt: number }
```

Log layout contract (Plan 14-08a):
- `.data/runner/logs/task-<id>/attempt-<n>/{stdout.log, stderr.log, meta.json}`
- `.data/runner/logs/task-<id>/latest → attempt-<n>` (relative symlink, updated each attempt)
- meta.json init: {started_at, runner_id, container_id}
- meta.json finalize: append {exited_at, exit_code, reason}
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement scripts/mc-runner.mjs (the daemon itself)</name>
  <files>scripts/mc-runner.mjs</files>
  <action>
Create `scripts/mc-runner.mjs` as a Node ESM script (shebang `#!/usr/bin/env node`).

**Structure** (top-down; ~700-900 lines total, split into labeled sections):

```javascript
#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// ======================================================
// Config resolution
// ======================================================
const DATA_DIR = process.env.MISSION_CONTROL_DATA_DIR || path.join(process.cwd(), '.data')
const MC_URL = process.env.MC_URL || 'http://127.0.0.1:3000'
const RUNNER_ID = process.env.RUNNER_ID || `runner-${os.hostname()}-${process.pid}`
const HEARTBEAT_INTERVAL_MS = 10_000
const POLL_INTERVAL_MS = 15_000
const GC_INTERVAL_MS = 10 * 60 * 1000

// ======================================================
// Minimal JSON-line logger (Open Question #3 lock)
// ======================================================
function log(level, msg, ctx = {}) {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), msg, ...ctx }))
}

// ======================================================
// INLINED helpers (source of truth: src/lib/runner-*.ts)
// ======================================================
// Mirror these from:
//   - src/lib/runner-preamble.ts::generatePreamble (Plan 14-07)
//   - src/lib/runner-worktree.ts::seedMcDir (Plan 14-07)
//   - src/lib/runner-docker.ts::buildDockerRunArgs / stageRecipe / writeEnvFile / cleanupEnvFile (Plan 14-07)
//   - src/lib/runner-gc.ts::gcShouldDestroy (Plan 14-08a)
//   - src/lib/runner-reconcile.ts::reconcileContainers (Plan 14-08a)
//   - src/lib/runner-timeout.ts::computeRemainingTimeoutMs (Plan 14-08a)
//   - src/lib/runner-log-layout.ts::resolveLogPaths / ensureAttemptDir / updateLatestSymlink / finalizeMeta (Plan 14-08a)
// Prefix each block with: // NOTE: mirrors src/lib/runner-<name>.ts. Keep in sync.

// ======================================================
// Boot
// ======================================================

// Step 1: read runner.secret
let secret
try {
  secret = fs.readFileSync(path.join(DATA_DIR, 'runner.secret'), 'utf8').trim()
  if (!secret) throw new Error('empty')
} catch (err) {
  console.error('runner.secret missing or empty')
  process.exit(1)
}

// Step 2: docker info
async function probeDocker() {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore' })
  return r.status === 0
}
if (!(await probeDocker())) {
  console.error('Docker daemon unreachable at default socket. Start Docker and re-launch the runner.')
  process.exit(2)
}

// Fetch helper
async function mcFetch(routePath, init = {}) {
  const headers = { ...init.headers, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }
  return fetch(`${MC_URL}${routePath}`, { ...init, headers })
}

// Step 3: GET /api/runner/config (Plan 14-11) — one-shot read; exit 1 if unreachable
let runnerConfig
try {
  const res = await mcFetch('/api/runner/config')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  runnerConfig = await res.json()
  log('info', 'config loaded', {
    project_repo_map_size: Object.keys(runnerConfig.project_repo_map).length,
    failed_gc_window_days: runnerConfig.failed_gc_window_days,
  })
} catch (err) {
  console.error(`Failed to fetch /api/runner/config: ${err}. Is MC running at ${MC_URL}?`)
  process.exit(1)
}

// Step 4: reconcile orphaned containers
async function reconcileAtBoot() {
  const dockerPs = spawnSync('docker', ['ps','-a','--filter','label=mc.task_id','--format','{{json .}}'], { encoding: 'utf8' })
  const live = dockerPs.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const pendRes = await mcFetch('/api/runner/pending-containers')
  const { tasks: pending = [] } = await pendRes.json()
  const { adopt, kill, orphaned } = /* inlined reconcileContainers */ ...
  log('info', 'reconcile', { adopt: adopt.length, kill: kill.length, orphaned: orphaned.length })
  // Adopt: set up timeout watcher using computeRemainingTimeoutMs(task.runner_started_at, recipe.timeout_seconds, nowUnix)
  // Kill: `docker kill <id>` for each
  // Orphaned: post runner-exit with reason='crash' for each
  //   await mcFetch(`/api/runner/tasks/${t.id}/runner-exit`, { method:'POST', body: JSON.stringify({exit_code:null, reason:'crash', attempt: <latest known>}) })
}
await reconcileAtBoot()

// Step 5: heartbeat loop (drift-resistant per Pitfall 1)
async function heartbeatTick() {
  const start = Date.now()
  try {
    await mcFetch('/api/runner/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ runner_id: RUNNER_ID, ts: start }),
    })
  } catch (err) {
    log('warn', 'heartbeat failed', { err: String(err) })
  }
  const delay = Math.max(HEARTBEAT_INTERVAL_MS - (Date.now() - start), 100)
  setTimeout(heartbeatTick, delay)
}
heartbeatTick()

// Step 6: SSE + poll
const activeTasks = new Map() // taskId -> { containerId, attempt, timeoutHandle, recipe, logPaths }
const inFlightClaims = new Set()

async function handleRunnerRequested(taskId) {
  if (activeTasks.has(taskId) || inFlightClaims.has(taskId)) return
  inFlightClaims.add(taskId)
  try { await tryClaim(taskId) } finally { inFlightClaims.delete(taskId) }
}

async function subscribeSSE() { /* Pattern 2 from research doc */ }
async function pollTick() {
  try {
    const res = await mcFetch('/api/runner/ready-tasks')
    const { tasks = [] } = await res.json()
    for (const t of tasks) handleRunnerRequested(t.id)
  } catch (err) {
    log('warn', 'poll failed', { err: String(err) })
  }
}
subscribeSSE()
setInterval(pollTick, POLL_INTERVAL_MS)

// Step 7: GC tick
let lastGcScanIso = new Date(Date.now() - 24*3600*1000).toISOString()
async function gcTick() {
  try {
    const res = await mcFetch(`/api/runner/terminal-tasks?since=${encodeURIComponent(lastGcScanIso)}`)
    const { tasks = [] } = await res.json()
    const nowUnix = Math.floor(Date.now() / 1000)
    const plan = tasks.filter(t => /* inlined gcShouldDestroy */ ...)
    for (const t of plan) {
      const worktreePath = path.join(DATA_DIR, 'runner', 'worktrees', `task-${t.task_id}`)
      const logsPath = path.join(DATA_DIR, 'runner', 'logs', `task-${t.task_id}`)
      // git worktree remove --force <worktreePath>
      // rm -rf <logsPath>
    }
    lastGcScanIso = new Date().toISOString()
  } catch (err) {
    log('warn', 'gc failed', { err: String(err) })
  }
}
gcTick()
setInterval(gcTick, GC_INTERVAL_MS)

// ======================================================
// Core claim → run → exit flow
// ======================================================
async function tryClaim(taskId) {
  const res = await mcFetch(`/api/runner/claim/${taskId}`, { method: 'POST' })
  if (res.status === 409) return
  if (!res.ok) { log('error', 'claim failed', { taskId, status: res.status }); return }
  const dispatch = await res.json()
  await runContainer(dispatch)
}

async function runContainer(dispatch) {
  const { task, recipe, env, resource_limits, container_name_prefix } = dispatch
  const attempt = task.attempt
  const runnerStartedAtIso = new Date().toISOString()

  // 1. Resolve repo source path from runnerConfig.project_repo_map
  const projectId = task.workspace_source?.project_id
  const repoPath = runnerConfig.project_repo_map[String(projectId)]
  if (!repoPath) {
    // Config missing; post runner-exit reason='worktree_create_failed'
    await postRunnerExit(task.id, attempt, null, 'worktree_create_failed', `project_repo_map missing entry for project_id=${projectId}`)
    return
  }

  // 2. Log layout setup (Plan 14-08a mirror)
  const logPaths = resolveLogPaths(DATA_DIR, task.id, attempt)
  ensureAttemptDir(logPaths, { started_at: runnerStartedAtIso, runner_id: RUNNER_ID, container_id: null })
  updateLatestSymlink(logPaths, attempt)

  // 3. git worktree add/reuse
  const worktreePath = path.join(DATA_DIR, 'runner', 'worktrees', `task-${task.id}`)
  try {
    spawnSync('git', ['-C', repoPath, 'fetch', '--all', '--prune'], { stdio: 'inherit' })
    if (!fs.existsSync(worktreePath)) {
      const baseRef = task.workspace_source?.base_ref || 'main'
      const r = spawnSync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, baseRef], { stdio: 'inherit' })
      if (r.status !== 0) throw new Error('git worktree add failed')
    }
  } catch (err) {
    await postRunnerExit(task.id, attempt, null, 'worktree_create_failed', String(err))
    return
  }

  // 4. Seed .mc/ (inlined seedMcDir)
  // 5. Stage recipe + PREAMBLE.md (inlined stageRecipe + generatePreamble)
  // 6. Write env-file (inlined writeEnvFile)

  // 7. docker run --rm -d
  const args = buildDockerRunArgs({ image: recipe.image, /* ... */ memory: resource_limits.memory, cpus: resource_limits.cpus })
  const runR = spawnSync('docker', args, { encoding: 'utf8' })
  if (runR.status !== 0) {
    await postRunnerExit(task.id, attempt, null, 'docker_error', runR.stderr?.slice(0, 16_000))
    return
  }
  const containerId = runR.stdout.trim()

  // 8. POST /api/runner/tasks/:task_id/container-started (Plan 14-11)
  try {
    const csRes = await mcFetch(`/api/runner/tasks/${task.id}/container-started`, {
      method: 'POST',
      body: JSON.stringify({ container_id: containerId }),
    })
    if (!csRes.ok && csRes.status !== 409) {
      log('warn', 'container-started failed', { task_id: task.id, status: csRes.status })
    }
  } catch (err) {
    log('warn', 'container-started threw', { err: String(err) })
  }

  // 9. Update meta.json with real container_id (re-use ensureAttemptDir init-style write or finalizeMeta partial)
  finalizeMeta(logPaths, /* treating as partial update */ { container_id: containerId })
  //   ^ finalizeMeta preserves existing keys and overwrites container_id

  // 10. Pipe docker logs -f to stdout.log + stderr.log
  const stdoutFd = fs.openSync(logPaths.stdoutLog, 'a', 0o600)
  const stderrFd = fs.openSync(logPaths.stderrLog, 'a', 0o600)
  const logsProc = spawn('docker', ['logs','-f',containerId], { stdio: ['ignore', stdoutFd, stderrFd] })

  // 11. Host-side timeout
  const nowUnix = Math.floor(Date.now() / 1000)
  const remainingMs = computeRemainingTimeoutMs(nowUnix, recipe.timeout_seconds, nowUnix)
  const timeoutHandle = setTimeout(() => {
    spawnSync('docker', ['stop', '--time=15', containerId])
  }, remainingMs)

  // 12. Wait for container exit
  const waitProc = spawnSync('docker', ['wait', containerId], { encoding: 'utf8' })
  clearTimeout(timeoutHandle)
  const exitCode = Number(waitProc.stdout.trim())
  const reason = timeoutFiredFlag ? 'timeout' : (exitCode === 137 ? 'oom' : 'exit')

  // 13. Read stderr tail for runner-exit body
  const stderrTail = (() => { try { return fs.readFileSync(logPaths.stderrLog, 'utf8').slice(-16_000) } catch { return undefined } })()

  // 14. Finalize meta.json with exit fields (Plan 14-08a locked layout)
  finalizeMeta(logPaths, { exited_at: new Date().toISOString(), exit_code: exitCode, reason })

  // 15. Cleanup env-file
  cleanupEnvFile(envFilePath)

  // 16. POST /api/runner/tasks/:task_id/runner-exit
  await postRunnerExit(task.id, attempt, exitCode, reason, stderrTail)

  activeTasks.delete(task.id)
}

async function postRunnerExit(taskId, attempt, exitCode, reason, stderrTail) {
  try {
    await mcFetch(`/api/runner/tasks/${taskId}/runner-exit`, {
      method: 'POST',
      body: JSON.stringify({ exit_code: exitCode, reason, stderr_tail: stderrTail, attempt }),
    })
  } catch (err) {
    log('error', 'runner-exit post failed', { task_id: taskId, err: String(err) })
  }
}

// On SIGTERM / SIGINT: graceful shutdown
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('SIGHUP', async () => {
  // Re-fetch runner config
  try {
    const res = await mcFetch('/api/runner/config')
    if (res.ok) runnerConfig = await res.json()
    log('info', 'config reloaded via SIGHUP')
  } catch (err) {
    log('warn', 'SIGHUP config reload failed', { err: String(err) })
  }
})
```

Essential nuances:
- SSE frames: parse per Pattern 2 from research; events that include `"type":"task.runner_requested"` trigger handleRunnerRequested(taskId). Phase 15 wires the emission — Phase 14 traffic relies on 15s poll. Log at boot: `log('info', 'SSE subscribed; task.runner_requested emission starts in Phase 15 — relying on 15s poll until then')`.
- Secrets: per-task recipe-declared secrets loaded from `.data/runner/secrets/<SECRET_NAME>` — files are read at claim time and merged into the env-file. Missing secret → log warn + omit key.
- Concurrency: global tracked via `activeTasks.size` + `runnerConfig.max_concurrent_containers`. Claim route enforces too, so daemon just trusts the dispatch response.

Shoot for a file in the 700-900 line range. Comment sections with `// ======================================================` headers.
  </action>
  <verify>
    <automated>node --check scripts/mc-runner.mjs && rm -rf /tmp/mc-runner-bootstrap-test && mkdir -p /tmp/mc-runner-bootstrap-test && (cd /tmp/mc-runner-bootstrap-test && MISSION_CONTROL_DATA_DIR=/tmp/mc-runner-bootstrap-test node '/Users/aaronwhaley/Github/mission-control/scripts/mc-runner.mjs' 2>&1; echo "exit=$?") | tee /tmp/mc-runner-exit.log && grep -q "runner.secret missing" /tmp/mc-runner-exit.log && grep -q "exit=1" /tmp/mc-runner-exit.log</automated>
  </verify>
  <done>scripts/mc-runner.mjs passes node --check; running it without a .data/runner.secret file exits 1 with stderr containing "runner.secret missing".</done>
</task>

<task type="auto">
  <name>Task 2: Create LaunchAgent plist + install README</name>
  <files>scripts/com.missioncontrol.runner.plist, scripts/README.runner.md</files>
  <action>
**scripts/com.missioncontrol.runner.plist**: Template per Research doc's Code Example. Placeholders for:
- Label: `com.missioncontrol.runner`
- ProgramArguments: `/usr/local/bin/node` + `__MC_ROOT__/scripts/mc-runner.mjs`
- WorkingDirectory: `__MC_ROOT__`
- EnvironmentVariables: MC_URL, MISSION_CONTROL_DATA_DIR, PATH
- KeepAlive true
- ThrottleInterval 30 (per CONTEXT.md "Docker-down backoff")
- StandardOutPath / StandardErrorPath under `__MC_ROOT__/.data/runner/daemon.log` + daemon.err

Include a header comment explaining that __MC_ROOT__ is a sed placeholder for the install script (if any); otherwise operators search-replace manually per README.

**scripts/README.runner.md**:

Sections (concise):
- "What the runner does" (one paragraph)
- "Prerequisites" — Docker Desktop running, Node 22+, `.data/runner.secret` exists (auto-gen via src/lib/runner-secret.ts)
- "First run (foreground)": `node scripts/mc-runner.mjs` from repo root
- "LaunchAgent install (macOS)":
  1. Copy template to `~/Library/LaunchAgents/com.missioncontrol.runner.plist`
  2. Search-replace `__MC_ROOT__` with absolute repo path
  3. `launchctl load ~/Library/LaunchAgents/com.missioncontrol.runner.plist`
  4. `launchctl kickstart gui/<uid>/com.missioncontrol.runner`
  5. Check: `tail -f .data/runner/daemon.err`
- "Project-repo mapping": describes `runtime.project_repo_map` setting + that the runner fetches it via `GET /api/runner/config` at startup, so PUT /api/settings writes take effect after a `launchctl kickstart` (or SIGHUP)
- "Recipe-declared secrets": drop `.data/runner/secrets/<NAME>` files, mode 0600, contents are the raw secret value
- "Logs layout": point operators at `.data/runner/logs/task-<id>/latest/` for tailing live runs — symlink always points at the active attempt
- "Troubleshooting":
  - runner exits 1: missing .data/runner.secret — run `pnpm dev` once to auto-generate; OR /api/runner/config unreachable — ensure `pnpm dev` is running
  - runner exits 2: docker not running — open Docker Desktop
  - task stays 'assigned': check daemon.err for claim errors
  - container doesn't start: check `.data/runner/logs/task-<id>/latest/stderr.log`
  - task container_id stuck at 'pending:*': daemon's /api/runner/tasks/:id/container-started call failed — check daemon.err
- "Uninstall": `launchctl unload` + delete plist

Keep it under 170 lines. No marketing copy.
  </action>
  <verify>
    <automated>test -f scripts/com.missioncontrol.runner.plist && test -f scripts/README.runner.md && grep -q "KeepAlive" scripts/com.missioncontrol.runner.plist && grep -q "runner.secret" scripts/README.runner.md && grep -q "latest" scripts/README.runner.md</automated>
  </verify>
  <done>Both files exist; plist has KeepAlive + ThrottleInterval 30; README has all sections above including the logs-layout pointer to the latest symlink.</done>
</task>

</tasks>

<verification>
- `node --check scripts/mc-runner.mjs` exits 0
- `pnpm lint` clean (scripts/**.mjs linted if included in eslint config; if not, verify syntax via `node --check`)
- Manual bootstrap spot-check (in automated verify above): running the daemon without a `.data/runner.secret` file exits 1 with the expected stderr.
- End-to-end behavioral verification lives in Plan 14-10 human-verify + Phase 17 integration tests. This plan's automated verify is scoped to syntax + file-presence + no-secret-required bootstrap exit path.
</verification>

<success_criteria>
Daemon is ready to be smoke-tested against the reference image (Plan 14-09 + 14-10). All pure-logic pieces (Plans 14-07, 14-08a) are TS + unit-tested; all orchestration is inline .mjs with source-of-truth pointers. LaunchAgent installs cleanly via README. /api/runner/config + /api/runner/tasks/:id/container-started (Plan 14-11) are the integration seams that unblock real container_id reconciliation.
</success_criteria>

<output>
After completion create `.planning/phases/14-runner-container-v1-2/14-08b-SUMMARY.md` documenting:
- Daemon file layout (lines per section)
- Confirmation that /api/runner/config resolves project_repo_map (NOT an env-var fallback)
- How orphaned tasks are recovered on boot (reconcile flow using helpers from 14-08a)
- Log layout behavior in practice (meta.json + latest symlink per attempt)
- Known limitations (e.g., SIGINT doesn't post runner-exit; next boot reconciles)
</output>
