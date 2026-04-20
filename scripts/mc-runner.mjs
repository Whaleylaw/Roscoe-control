#!/usr/bin/env node
/**
 * Mission Control Runner Daemon (Phase 14 Plan 14-08b).
 *
 * Standalone Node ESM process that orchestrates the container runtime for
 * recipe-tagged tasks. Boots, heartbeats, consumes SSE `task.runner_requested`
 * events (+ 15s poll fallback), atomically claims tasks via
 * POST /api/runner/claim/:task_id, seeds the worktree, launches the container
 * via `docker run --rm -d`, reports back via
 * POST /api/runner/tasks/:id/container-started and
 * POST /api/runner/tasks/:id/runner-exit, and runs a 10-minute GC tick against
 * GET /api/runner/terminal-tasks.
 *
 * Boot sequence (LOCKED per 14-CONTEXT.md):
 *   1. read .data/runner.secret  (exit 1 if missing)
 *   2. docker info               (exit 2 if Docker daemon unreachable)
 *   3. GET /api/runner/config    (exit 1 if endpoint unreachable)
 *   4. reconcile orphaned containers
 *   5. register + start heartbeat loop
 *   6. SSE subscribe + 15s poll
 *   7. start GC tick (immediate + every 10 min)
 *
 * Inlined helpers: minimal copies of generatePreamble / seedMcDir /
 * buildDockerRunArgs / stageRecipe / writeEnvFile / cleanupEnvFile /
 * gcShouldDestroy / reconcileContainers / computeRemainingTimeoutMs /
 * resolveLogPaths / ensureAttemptDir / updateLatestSymlink / finalizeMeta.
 * Pointer comments list the canonical source-of-truth for each block.
 *
 * Usage:
 *   MC_URL=http://127.0.0.1:3000 \
 *   MISSION_CONTROL_DATA_DIR=/abs/path/.data \
 *   node scripts/mc-runner.mjs
 *
 * Exit codes:
 *   1  fatal bootstrap failure (missing secret, unreachable /api/runner/config)
 *   2  Docker daemon unreachable
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'

// ======================================================
// Config resolution
// ======================================================

const DATA_DIR = process.env.MISSION_CONTROL_DATA_DIR || path.join(process.cwd(), '.data')
const MC_URL = (process.env.MC_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const RUNNER_ID = process.env.RUNNER_ID || `runner-${os.hostname()}-${process.pid}`
const HEARTBEAT_INTERVAL_MS = 10_000
const POLL_INTERVAL_MS = 15_000
const GC_INTERVAL_MS = 10 * 60 * 1000

// ======================================================
// Minimal JSON-line logger (Open Question #3 — see 14-08b-PLAN locked_decisions)
// ======================================================

function log(level, msg, ctx = {}) {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), msg, ...ctx }))
}

// ======================================================
// INLINED helpers
// Source of truth: src/lib/runner-*.ts (tested in src/lib/__tests__/).
// This file duplicates a minimal subset for the .mjs daemon — keep in sync.
// ======================================================

// NOTE: mirrors src/lib/runner-log-layout.ts. Keep in sync.
function resolveLogPaths(dataDir, taskId, attempt) {
  const taskLogRoot = path.join(dataDir, 'runner', 'logs', `task-${taskId}`)
  const attemptDir = path.join(taskLogRoot, `attempt-${attempt}`)
  return {
    attemptDir,
    stdoutLog: path.join(attemptDir, 'stdout.log'),
    stderrLog: path.join(attemptDir, 'stderr.log'),
    metaJson: path.join(attemptDir, 'meta.json'),
    latestSymlink: path.join(taskLogRoot, 'latest'),
    taskLogRoot,
  }
}

function ensureAttemptDir(paths, meta) {
  fs.mkdirSync(paths.attemptDir, { recursive: true, mode: 0o700 })
  fs.closeSync(fs.openSync(paths.stdoutLog, 'a', 0o600))
  fs.closeSync(fs.openSync(paths.stderrLog, 'a', 0o600))
  fs.writeFileSync(paths.metaJson, JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 })
}

function updateLatestSymlink(paths, attempt) {
  fs.rmSync(paths.latestSymlink, { force: true })
  fs.symlinkSync(`attempt-${attempt}`, paths.latestSymlink, 'dir')
}

function finalizeMeta(paths, exitFields) {
  let existing = {}
  try {
    existing = JSON.parse(fs.readFileSync(paths.metaJson, 'utf8'))
  } catch {
    // missing or malformed — start fresh
  }
  const merged = { ...existing, ...exitFields }
  fs.writeFileSync(paths.metaJson, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 })
}

// NOTE: mirrors src/lib/runner-timeout.ts. Keep in sync.
function computeRemainingTimeoutMs(runnerStartedAtUnix, timeoutSeconds, nowUnix) {
  if (
    !Number.isFinite(runnerStartedAtUnix) ||
    !Number.isFinite(timeoutSeconds) ||
    !Number.isFinite(nowUnix)
  ) {
    return 0
  }
  if (timeoutSeconds <= 0) return 0
  const elapsed = nowUnix - runnerStartedAtUnix
  if (elapsed < 0) return timeoutSeconds * 1000
  const remainingSeconds = timeoutSeconds - elapsed
  if (remainingSeconds <= 0) return 0
  return remainingSeconds * 1000
}

// NOTE: mirrors src/lib/runner-gc.ts. Keep in sync.
function gcShouldDestroy(row, nowUnix, failedWindowDays) {
  if (row.status === 'done' || row.status === 'cancelled') return true
  if (row.status === 'failed') {
    const ageSeconds = nowUnix - row.terminal_at
    const windowSeconds = failedWindowDays * 86_400
    return ageSeconds >= windowSeconds
  }
  return false
}

// NOTE: mirrors src/lib/runner-reconcile.ts. Keep in sync.
function reconcileContainers(live, pending) {
  const adopt = []
  const kill = []
  const orphaned = []
  const runningLive = live.filter((c) => c.state === 'running')
  const liveById = new Map()
  for (const c of runningLive) liveById.set(c.container_id, c)
  const adoptedIds = new Set()
  for (const task of pending) {
    const match = liveById.get(task.container_id)
    if (match) {
      adopt.push({ task, container: match })
      adoptedIds.add(match.container_id)
    } else {
      orphaned.push(task)
    }
  }
  for (const c of runningLive) {
    if (!adoptedIds.has(c.container_id)) kill.push(c)
  }
  return { adopt, kill, orphaned }
}

// NOTE: mirrors src/lib/runner-docker.ts slugify. Keep in sync.
function slugify(label) {
  return String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// NOTE: mirrors src/lib/runner-docker.ts buildDockerRunArgs. Keep in sync.
// CONTAINER-01 invariant: no --env flag carries MC_API_TOKEN. Secrets via --env-file only.
function buildDockerRunArgs(input) {
  const {
    image,
    taskId,
    attempt,
    recipeSlug,
    runnerId,
    runnerStartedAtIso,
    containerName,
    worktreePath,
    recipeStagePath,
    readOnlyMounts,
    extraSkills,
    envFilePath,
    memory,
    cpus,
    networkHostGateway,
  } = input

  const argv = [
    'run',
    '--rm',
    '-d',
    '--name', containerName,
    '--label', `mc.task_id=${taskId}`,
    '--label', `mc.recipe_slug=${recipeSlug}`,
    '--label', `mc.attempt=${attempt}`,
    '--label', `mc.runner_id=${runnerId}`,
    '--label', `mc.runner_started_at=${runnerStartedAtIso}`,
    '--memory', memory,
    '--cpus', String(cpus),
  ]
  if (networkHostGateway !== false) {
    argv.push('--add-host', 'host.docker.internal:host-gateway')
  }
  argv.push('--env-file', envFilePath)
  argv.push('-v', `${worktreePath}:/workspace:rw`)
  argv.push('-v', `${recipeStagePath}:/recipe:ro`)
  for (const mount of readOnlyMounts) {
    const containerPath = mount.container_path ?? `/refs/${slugify(mount.label)}`
    argv.push('-v', `${mount.host_path}:${containerPath}:ro`)
  }
  for (const skill of extraSkills) {
    argv.push('-v', `${skill}:/skills/${path.basename(skill)}:ro`)
  }
  argv.push(image)
  return argv
}

// NOTE: mirrors src/lib/runner-docker.ts stageRecipe. Keep in sync.
async function stageRecipe(sourceDir, stageDir, preambleContents) {
  await fs.promises.mkdir(stageDir, { recursive: true })
  await fs.promises.cp(sourceDir, stageDir, { recursive: true, force: true })
  await fs.promises.writeFile(path.join(stageDir, 'PREAMBLE.md'), preambleContents)
}

// NOTE: mirrors src/lib/runner-docker.ts writeEnvFile / cleanupEnvFile. Keep in sync.
function writeEnvFile(envMap, filePath) {
  const lines = []
  for (const [key, value] of Object.entries(envMap)) {
    const safe = String(value).replace(/\r?\n/g, ' ')
    lines.push(`${key}=${safe}`)
  }
  const body = lines.join('\n') + '\n'
  try { fs.rmSync(filePath, { force: true }) } catch {}
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, body, { mode: 0o600 })
}

function cleanupEnvFile(filePath) {
  try { fs.rmSync(filePath, { force: true }) } catch {}
}

// NOTE: mirrors src/lib/runner-worktree.ts seedMcDir. Keep in sync.
function seedMcDir(worktreePath, task) {
  const mcDir = path.join(worktreePath, '.mc')
  fs.mkdirSync(mcDir, { recursive: true })

  const taskJsonPath = path.join(mcDir, 'task.json')
  const progressPath = path.join(mcDir, 'progress.md')
  const checkpointsPath = path.join(mcDir, 'checkpoints.jsonl')
  const gitignorePath = path.join(mcDir, '.gitignore')

  // task.json always rewritten
  try { fs.rmSync(taskJsonPath, { force: true }) } catch {}
  fs.writeFileSync(taskJsonPath, JSON.stringify(task, null, 2), { mode: 0o600 })

  if (!task.is_resuming) {
    fs.writeFileSync(progressPath, `# Progress — Task ${task.task_id}\n\n`)
    fs.writeFileSync(checkpointsPath, '')
  } else {
    if (!fs.existsSync(progressPath)) {
      fs.writeFileSync(progressPath, `# Progress — Task ${task.task_id}\n\n`)
    }
    if (!fs.existsSync(checkpointsPath)) {
      fs.writeFileSync(checkpointsPath, '')
    }
  }

  fs.writeFileSync(gitignorePath, '*\n')
}

// NOTE: mirrors src/lib/runner-preamble.ts generatePreamble. Keep in sync.
// Minimal two-variant text — full byte-stable version is the .ts module.
function generatePreamble(input) {
  const { isResuming, taskId, apiBase, priorAttempts } = input
  const skeleton = [
    '## Emitting checkpoints',
    '',
    'As you make progress, POST a checkpoint so Mission Control and any watcher can follow along:',
    '',
    '```',
    `POST ${apiBase}/api/runner/checkpoint`,
    'Authorization: Bearer $MC_API_TOKEN',
    'Content-Type: application/json',
    '',
    '{ "task_id": $MC_TASK_ID, "step": "short-slug", "status": "in_progress", "summary": "what you just did" }',
    '```',
    '',
    '## Finishing',
    '',
    'When finished, POST your result to the submit endpoint, then exit with code 0:',
    '',
    '```',
    `POST ${apiBase}/api/runner/tasks/$MC_TASK_ID/submit`,
    'Authorization: Bearer $MC_API_TOKEN',
    'Content-Type: application/json',
    '',
    '{ "status": "done" }',
    '```',
  ].join('\n')

  if (!isResuming) {
    const lines = [
      `# Task ${taskId} — Runner Preamble (first attempt)`,
      '',
      'You are running inside an ephemeral container spawned by Mission Control.',
      'This preamble is the runner-authored contract; the recipe author\'s SOUL.md ships next.',
      '',
      '## Environment',
      '',
      'These environment variables are set inside the container:',
      '',
      '- `MC_TASK_ID` — the task identifier',
      '- `MC_API_URL` — Mission Control base URL (reach it via host-gateway)',
      '- `MC_API_TOKEN` — per-task runner bearer; short-lived, task-scoped',
      '- `MC_MODEL_PRIMARY` — the model identifier resolved for this task',
      '- `MC_WORKSPACE` — absolute path to the mounted worktree (`/workspace`)',
      '- `MC_RECIPE_PATH` — absolute path to the read-only recipe mount (`/recipe`)',
      '- `MC_PREAMBLE_PATH` — path to THIS file; read it first, then `/recipe/SOUL.md`',
      '',
      '## Filesystem contract',
      '',
      'Read `/recipe/SOUL.md` after this file — it is the task-specific instructions authored with the recipe.',
      '',
      'As you work, append a line to `/workspace/.mc/progress.md` for each meaningful step.',
      'Append a JSON line to `/workspace/.mc/checkpoints.jsonl` for each checkpoint you emit.',
      '',
      skeleton,
      '',
    ]
    return lines.join('\n') + '\n'
  }

  const attemptNumber = priorAttempts.length + 1
  const priorText = priorAttempts.length === 0
    ? '- (no prior attempts recorded)'
    : priorAttempts
        .map((a, idx) => {
          const when = a.started_at || 'unknown'
          const code = a.exit_code === null || a.exit_code === undefined ? 'null' : String(a.exit_code)
          const reason = a.failure_reason || 'null'
          return `- attempt ${idx + 1}: started_at=${when}, exit_code=${code}, failure_reason=${reason}`
        })
        .join('\n')

  const lines = [
    `# Task ${taskId} — Runner Preamble (resume, attempt ${attemptNumber})`,
    '',
    `This is attempt ${attemptNumber} (is_resuming=true). Do NOT redo prior work — reconcile with it.`,
    'You are running inside an ephemeral container spawned by Mission Control.',
    '',
    '## Mandatory first steps (in order)',
    '',
    '1. read .mc/task.json — attempt counter and prior_attempts summary',
    '2. read .mc/progress.md — append-only work log from prior attempts',
    '3. read .mc/checkpoints.jsonl — one JSON line per checkpoint',
    '4. run `git -C /workspace status` to see uncommitted changes',
    '5. run `git -C /workspace log --oneline` to see what was committed previously',
    '6. re-read /recipe/SOUL.md for the task-specific instructions',
    '',
    '## Reconciliation rules',
    '',
    '- Trust git over progress.md when they conflict.',
    '- If a prior attempt committed the deliverable but did not submit, submit now and exit.',
    `- Append new notes under a \`## attempt ${attemptNumber}\` header in progress.md.`,
    '',
    '## Prior attempts',
    '',
    priorText,
    '',
    skeleton,
    '',
  ]
  return lines.join('\n') + '\n'
}

// ======================================================
// Boot: Step 1 — read .data/runner.secret
// ======================================================

let secret
try {
  secret = fs.readFileSync(path.join(DATA_DIR, 'runner.secret'), 'utf8').trim()
  if (!secret) throw new Error('empty')
} catch {
  console.error(`runner.secret missing or empty at ${path.join(DATA_DIR, 'runner.secret')}`)
  console.error('Run the MC server once (e.g. `pnpm dev`) to auto-generate it.')
  process.exit(1)
}

// ======================================================
// Boot: Step 2 — docker info
// ======================================================

function probeDocker() {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore' })
  return r.status === 0
}

if (!probeDocker()) {
  console.error('Docker daemon unreachable at default socket. Start Docker and re-launch the runner.')
  process.exit(2)
}

// ======================================================
// Fetch helper (all MC calls go through this)
// ======================================================

async function mcFetch(routePath, init = {}) {
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  }
  return fetch(`${MC_URL}${routePath}`, { ...init, headers })
}

// ======================================================
// Boot: Step 3 — GET /api/runner/config
// ======================================================

let runnerConfig
try {
  const res = await mcFetch('/api/runner/config')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  runnerConfig = await res.json()
  log('info', 'config loaded', {
    project_repo_map_size: Object.keys(runnerConfig.project_repo_map || {}).length,
    failed_gc_window_days: runnerConfig.failed_gc_window_days,
    max_concurrent_containers: runnerConfig.max_concurrent_containers,
  })
} catch (err) {
  console.error(
    `Failed to fetch /api/runner/config: ${String(err)}. Is MC running at ${MC_URL}?`,
  )
  process.exit(1)
}

log('info', 'runner boot', { runner_id: RUNNER_ID, mc_url: MC_URL, data_dir: DATA_DIR })

// ======================================================
// In-memory task tracking
// ======================================================

// taskId -> { containerId, attempt, timeoutHandle, timeoutFired, logPaths, envFilePath, logsProc }
const activeTasks = new Map()
const inFlightClaims = new Set()

// ======================================================
// Boot: Step 4 — reconcile orphaned containers
// ======================================================

async function reconcileAtBoot() {
  let live = []
  try {
    const dockerPs = spawnSync(
      'docker',
      ['ps', '-a', '--filter', 'label=mc.task_id', '--format', '{{json .}}'],
      { encoding: 'utf8' },
    )
    if (dockerPs.status === 0 && dockerPs.stdout) {
      live = dockerPs.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            const row = JSON.parse(line)
            // docker ps JSON row: {ID, Labels (comma-separated "k=v"), State, ...}
            const labels = {}
            const rawLabels = typeof row.Labels === 'string' ? row.Labels : ''
            for (const pair of rawLabels.split(',')) {
              const eq = pair.indexOf('=')
              if (eq === -1) continue
              labels[pair.slice(0, eq)] = pair.slice(eq + 1)
            }
            const state = (row.State || '').toLowerCase()
            return {
              container_id: row.ID,
              labels,
              state: state === 'running' ? 'running' : 'exited',
            }
          } catch {
            return null
          }
        })
        .filter(Boolean)
    }
  } catch (err) {
    log('warn', 'reconcile: docker ps failed', { err: String(err) })
  }

  let pending = []
  try {
    const res = await mcFetch('/api/runner/pending-containers')
    if (res.ok) {
      const body = await res.json()
      pending = body.tasks || []
    } else {
      log('warn', 'reconcile: pending-containers GET non-OK', { status: res.status })
    }
  } catch (err) {
    log('warn', 'reconcile: pending-containers fetch failed', { err: String(err) })
  }

  const { adopt, kill, orphaned } = reconcileContainers(live, pending)
  log('info', 'reconcile', {
    adopt: adopt.length,
    kill: kill.length,
    orphaned: orphaned.length,
  })

  // Adopt: set up a new timeout watcher anchored on mc.runner_started_at label
  // so the ORIGINAL deadline is preserved across runner restarts (Pitfall 9).
  for (const { task, container } of adopt) {
    try {
      const startedIso = container.labels?.['mc.runner_started_at']
      const attemptLabel = Number(container.labels?.['mc.attempt']) || 1
      const startedAtUnix = startedIso
        ? Math.floor(new Date(startedIso).getTime() / 1000)
        : task.runner_started_at ?? Math.floor(Date.now() / 1000)
      // Recipe timeout is not returned by pending-containers; fetch via config
      // would require a per-recipe roundtrip. Use a conservative fallback —
      // the adopt path is a best-effort reconcile; the container will exit and
      // runner-exit will fire regardless. A real-world restart fetches the
      // recipe via claim again only on a fresh attempt; here we track exit.
      const timeoutSeconds = 3600 // defensive fallback — adopt path only
      const nowUnix = Math.floor(Date.now() / 1000)
      const remainingMs = computeRemainingTimeoutMs(startedAtUnix, timeoutSeconds, nowUnix)
      const logPaths = resolveLogPaths(DATA_DIR, task.id, attemptLabel)
      const timeoutHandle = setTimeout(() => {
        log('warn', 'adopt: timeout reached, stopping container', { task_id: task.id })
        spawnSync('docker', ['stop', '--time=15', container.container_id])
      }, remainingMs)
      activeTasks.set(task.id, {
        containerId: container.container_id,
        attempt: attemptLabel,
        timeoutHandle,
        timeoutFired: false,
        logPaths,
        envFilePath: null,
      })
      // Wait for exit in background.
      watchContainerExit(task.id, container.container_id, attemptLabel, logPaths).catch((err) => {
        log('error', 'adopt: watch failed', { task_id: task.id, err: String(err) })
      })
    } catch (err) {
      log('error', 'adopt failed', { task_id: task.id, err: String(err) })
    }
  }

  // Kill orphaned live containers (running containers without a pending task row).
  for (const c of kill) {
    try {
      spawnSync('docker', ['kill', c.container_id])
      log('info', 'reconcile: killed orphan container', { container_id: c.container_id })
    } catch (err) {
      log('warn', 'reconcile: kill failed', { container_id: c.container_id, err: String(err) })
    }
  }

  // Orphaned tasks (pending row but no live container) → post runner-exit reason='crash'.
  for (const t of orphaned) {
    // Skip if container_id is a pending placeholder — the task was claimed but
    // docker run never succeeded (or we crashed between claim and run). Still
    // report as crash so MC can retry.
    await postRunnerExit(t.id, Math.max(1, t.runner_attempts || 1), null, 'crash', undefined)
  }
}

await reconcileAtBoot()

// ======================================================
// Boot: Step 5 — heartbeat loop (drift-resistant; Pitfall 1)
// ======================================================

async function heartbeatTick() {
  const start = Date.now()
  try {
    // Phase 15-06 (SCHED-03): expose the daemon's in-memory activeTasks Map
    // as metadata.active_task_ids so requeueStaleTasks (Plan 15-02) can
    // decide whether MC's in_progress recipe-tasks are actually still being
    // tracked by this runner. Empty array is meaningful (runner alive, no
    // containers); an omitted field would be ambiguous.
    const active_task_ids = Array.from(activeTasks.keys())
    await mcFetch('/api/runner/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        runner_id: RUNNER_ID,
        ts: start,
        metadata: { active_task_ids },
      }),
    })
  } catch (err) {
    log('warn', 'heartbeat failed', { err: String(err) })
  }
  const delay = Math.max(HEARTBEAT_INTERVAL_MS - (Date.now() - start), 100)
  setTimeout(heartbeatTick, delay)
}
heartbeatTick()

// ======================================================
// Boot: Step 6 — SSE subscribe + 15s poll fallback
// ======================================================

async function handleRunnerRequested(taskId) {
  if (activeTasks.has(taskId) || inFlightClaims.has(taskId)) return
  // Respect local concurrency awareness; the claim route is the authoritative
  // gate, but skipping locally avoids burning an HTTP round-trip we'll lose.
  const cap = Number(runnerConfig.max_concurrent_containers) || Infinity
  if (activeTasks.size >= cap) {
    log('info', 'skip claim: local cap reached', { task_id: taskId, active: activeTasks.size, cap })
    return
  }
  inFlightClaims.add(taskId)
  try {
    await tryClaim(taskId)
  } catch (err) {
    log('error', 'handleRunnerRequested threw', { task_id: taskId, err: String(err) })
  } finally {
    inFlightClaims.delete(taskId)
  }
}

/**
 * Subscribe to GET /api/events (text/event-stream). Parses SSE frames and
 * dispatches `task.runner_requested` events to handleRunnerRequested.
 *
 * Phase 14 note: the `task.runner_requested` emission wires live in Phase 15.
 * Until then this subscriber stays connected as a placeholder and the 15s
 * poll carries the real claim traffic.
 *
 * Pattern 2 (from 14-RESEARCH.md): fetch + ReadableStream + newline splitter.
 */
async function subscribeSSE() {
  const url = `${MC_URL}/api/events`
  const backoffMs = [1_000, 2_000, 5_000, 10_000, 15_000]
  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${secret}`, Accept: 'text/event-stream' },
      })
      if (!res.ok || !res.body) {
        throw new Error(`SSE non-OK: ${res.status}`)
      }
      log('info', 'SSE subscribed; task.runner_requested emission starts in Phase 15 — relying on 15s poll until then')
      attempt = 0

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Split on blank line (SSE frame boundary).
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          // Each frame has one or more `data: ...` lines. Concat them.
          const dataLines = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
          if (dataLines.length === 0) continue
          const payload = dataLines.join('\n')
          try {
            const evt = JSON.parse(payload)
            if (evt && evt.type === 'task.runner_requested' && evt.data && evt.data.task_id) {
              handleRunnerRequested(Number(evt.data.task_id))
            }
          } catch {
            // ignore malformed frames / comments / heartbeats
          }
        }
      }
      log('warn', 'SSE stream ended; reconnecting')
    } catch (err) {
      log('warn', 'SSE error', { err: String(err) })
    }
    const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)]
    attempt += 1
    await new Promise((r) => setTimeout(r, delay))
  }
}

async function pollTick() {
  try {
    const res = await mcFetch('/api/runner/ready-tasks')
    if (!res.ok) {
      log('warn', 'poll non-OK', { status: res.status })
      return
    }
    const body = await res.json()
    for (const t of body.tasks || []) {
      handleRunnerRequested(t.id)
    }
  } catch (err) {
    log('warn', 'poll failed', { err: String(err) })
  }
}

// Kick off SSE without awaiting (runs forever).
subscribeSSE()
// Poll on boot + every 15s.
pollTick()
setInterval(pollTick, POLL_INTERVAL_MS)

// ======================================================
// Boot: Step 7 — GC tick (immediate + every 10 min)
// ======================================================

// Initialize scan cursor 24h in the past so the first boot sweep catches any
// terminal transitions that happened while the runner was down.
let lastGcScanIso = new Date(Date.now() - 24 * 3_600_000).toISOString()

async function gcTick() {
  try {
    const res = await mcFetch(
      `/api/runner/terminal-tasks?since=${encodeURIComponent(lastGcScanIso)}`,
    )
    if (!res.ok) {
      log('warn', 'gc: terminal-tasks non-OK', { status: res.status })
      return
    }
    const body = await res.json()
    const rows = body.tasks || []
    const nowUnix = Math.floor(Date.now() / 1000)
    const failedWindow = Number(runnerConfig.failed_gc_window_days) || 7
    const plan = rows.filter((row) => gcShouldDestroy(row, nowUnix, failedWindow))
    for (const row of plan) {
      const taskId = row.task_id
      const worktreePath = path.join(DATA_DIR, 'runner', 'worktrees', `task-${taskId}`)
      const logsPath = path.join(DATA_DIR, 'runner', 'logs', `task-${taskId}`)
      // Destroy sequence: `git worktree remove --force <path>` then `rm -rf`.
      try {
        if (fs.existsSync(worktreePath)) {
          // Find the repo the worktree belongs to. Walk the map and pick any
          // repo path; git worktree remove is a noop on a wrong repo so we
          // fall back to rm -rf if the git call fails.
          let removed = false
          for (const repoPath of Object.values(runnerConfig.project_repo_map || {})) {
            const r = spawnSync('git', ['-C', String(repoPath), 'worktree', 'remove', '--force', worktreePath], { stdio: 'ignore' })
            if (r.status === 0) { removed = true; break }
          }
          if (!removed) {
            fs.rmSync(worktreePath, { recursive: true, force: true })
          }
        }
      } catch (err) {
        log('warn', 'gc: worktree remove failed', { task_id: taskId, err: String(err) })
      }
      try {
        fs.rmSync(logsPath, { recursive: true, force: true })
      } catch (err) {
        log('warn', 'gc: logs remove failed', { task_id: taskId, err: String(err) })
      }
      log('info', 'gc: destroyed', { task_id: taskId, status: row.status })
    }
    lastGcScanIso = new Date().toISOString()
  } catch (err) {
    log('warn', 'gc failed', { err: String(err) })
  }
}

gcTick()
setInterval(gcTick, GC_INTERVAL_MS)

// ======================================================
// Core flow: claim → run → exit
// ======================================================

async function tryClaim(taskId) {
  let res
  try {
    res = await mcFetch(`/api/runner/claim/${taskId}`, { method: 'POST' })
  } catch (err) {
    log('error', 'claim fetch failed', { task_id: taskId, err: String(err) })
    return
  }
  if (res.status === 409) {
    // Race: someone else claimed it or status changed. Silent.
    return
  }
  if (!res.ok) {
    log('error', 'claim non-OK', { task_id: taskId, status: res.status })
    return
  }
  let dispatch
  try {
    dispatch = await res.json()
  } catch (err) {
    log('error', 'claim body parse failed', { task_id: taskId, err: String(err) })
    return
  }
  await runContainer(dispatch).catch((err) => {
    log('error', 'runContainer threw', { task_id: taskId, err: String(err) })
  })
}

async function postRunnerExit(taskId, attempt, exitCode, reason, stderrTail) {
  try {
    const body = { exit_code: exitCode, reason, attempt }
    if (stderrTail !== undefined && stderrTail !== null) body.stderr_tail = stderrTail
    const res = await mcFetch(`/api/runner/tasks/${taskId}/runner-exit`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!res.ok && res.status !== 409) {
      log('warn', 'runner-exit non-OK', { task_id: taskId, status: res.status })
    }
  } catch (err) {
    log('error', 'runner-exit post failed', { task_id: taskId, err: String(err) })
  }
}

/**
 * Load recipe-declared secrets from .data/runner/secrets/<NAME>.
 * Missing files are logged + omitted (no hard fail) per plan.
 * Returns { ENV_NAME: value, ... } for merging into env-file.
 */
function loadRecipeSecrets(secretNames) {
  const out = {}
  for (const name of secretNames || []) {
    const p = path.join(DATA_DIR, 'runner', 'secrets', name)
    try {
      const raw = fs.readFileSync(p, 'utf8').trim()
      if (raw) out[name] = raw
      else log('warn', 'recipe secret empty', { name })
    } catch {
      log('warn', 'recipe secret missing', { name, path: p })
    }
  }
  return out
}

/**
 * Spawn a background `docker logs -f` and `docker wait` chain. Waits for the
 * container to exit, then finalizes meta + posts runner-exit + cleans env-file.
 *
 * Used by BOTH adopted containers (from reconcile) and freshly-spawned ones.
 * The adopt path sets a default reason='crash' on unexpected exit because we
 * don't carry the timeout state across restart.
 */
async function watchContainerExit(taskId, containerId, attempt, logPaths, envFilePath) {
  // Pipe docker logs -f to stdout/stderr log files.
  let stdoutFd, stderrFd, logsProc
  try {
    stdoutFd = fs.openSync(logPaths.stdoutLog, 'a', 0o600)
    stderrFd = fs.openSync(logPaths.stderrLog, 'a', 0o600)
    logsProc = spawn('docker', ['logs', '-f', containerId], {
      stdio: ['ignore', stdoutFd, stderrFd],
    })
    logsProc.on('error', (err) => {
      log('warn', 'docker logs -f error', { task_id: taskId, err: String(err) })
    })
  } catch (err) {
    log('warn', 'docker logs -f spawn failed', { task_id: taskId, err: String(err) })
  }
  const existing = activeTasks.get(taskId)
  if (existing) existing.logsProc = logsProc

  // Block on docker wait. spawnSync blocks this async function until exit.
  const waitR = spawnSync('docker', ['wait', containerId], { encoding: 'utf8' })
  const exitCode = Number((waitR.stdout || '').trim())
  const tracked = activeTasks.get(taskId)
  const timeoutFired = tracked ? tracked.timeoutFired : false
  if (tracked && tracked.timeoutHandle) clearTimeout(tracked.timeoutHandle)

  let reason
  if (timeoutFired) reason = 'timeout'
  else if (exitCode === 137) reason = 'oom'
  else if (Number.isFinite(exitCode) && exitCode === 0) reason = 'exit'
  else if (Number.isFinite(exitCode)) reason = 'exit'
  else reason = 'crash'

  let stderrTail
  try {
    stderrTail = fs.readFileSync(logPaths.stderrLog, 'utf8').slice(-16_000)
  } catch {
    stderrTail = undefined
  }

  finalizeMeta(logPaths, {
    exited_at: new Date().toISOString(),
    exit_code: Number.isFinite(exitCode) ? exitCode : null,
    reason,
  })

  // Close fds.
  try { if (stdoutFd !== undefined) fs.closeSync(stdoutFd) } catch {}
  try { if (stderrFd !== undefined) fs.closeSync(stderrFd) } catch {}

  if (envFilePath) cleanupEnvFile(envFilePath)

  await postRunnerExit(
    taskId,
    attempt,
    Number.isFinite(exitCode) ? exitCode : null,
    reason,
    stderrTail,
  )

  activeTasks.delete(taskId)
}

async function runContainer(dispatch) {
  const { task, recipe, env, resource_limits, container_name_prefix } = dispatch
  const attempt = task.attempt
  const runnerStartedAtIso = new Date().toISOString()
  const taskId = task.id

  // Step 1: resolve repo source from runnerConfig.project_repo_map.
  const projectId = task.workspace_source?.project_id
  const repoPath = runnerConfig.project_repo_map?.[String(projectId)]
  if (!repoPath) {
    await postRunnerExit(
      taskId,
      attempt,
      null,
      'worktree_create_failed',
      `project_repo_map missing entry for project_id=${projectId}`,
    )
    return
  }

  // Step 2: log layout.
  const logPaths = resolveLogPaths(DATA_DIR, taskId, attempt)
  ensureAttemptDir(logPaths, {
    started_at: runnerStartedAtIso,
    runner_id: RUNNER_ID,
    container_id: null,
  })
  updateLatestSymlink(logPaths, attempt)

  // Step 3: git worktree add or reuse.
  const worktreePath = path.join(DATA_DIR, 'runner', 'worktrees', `task-${taskId}`)
  try {
    const fetchR = spawnSync('git', ['-C', repoPath, 'fetch', '--all', '--prune'], {
      stdio: 'ignore',
    })
    if (fetchR.status !== 0) {
      log('warn', 'git fetch non-zero (continuing)', { task_id: taskId, repo: repoPath })
    }
    if (!fs.existsSync(worktreePath)) {
      const baseRef = task.workspace_source?.base_ref || 'main'
      const addR = spawnSync(
        'git',
        ['-C', repoPath, 'worktree', 'add', worktreePath, baseRef],
        { stdio: 'inherit' },
      )
      if (addR.status !== 0) {
        throw new Error(`git worktree add exited ${addR.status}`)
      }
    }
  } catch (err) {
    await postRunnerExit(taskId, attempt, null, 'worktree_create_failed', String(err))
    return
  }

  // Step 4: seed .mc/.
  try {
    seedMcDir(worktreePath, {
      task_id: String(taskId),
      recipe_slug: task.recipe_slug,
      attempt,
      is_resuming: Boolean(task.is_resuming),
      prior_attempts: task.prior_attempts || [],
    })
  } catch (err) {
    await postRunnerExit(taskId, attempt, null, 'worktree_create_failed', `seedMcDir failed: ${String(err)}`)
    return
  }

  // Step 5: stage recipe + PREAMBLE.md.
  // Stage path MUST resolve OUTSIDE MISSION_CONTROL_RECIPES_DIR (Pitfall 10).
  const stageDir = path.join(DATA_DIR, 'runner', 'recipe-stage', `task-${taskId}`, `attempt-${attempt}`)
  const preambleText = generatePreamble({
    isResuming: Boolean(task.is_resuming),
    taskId,
    apiBase: env.MC_API_URL || `http://host.docker.internal:${process.env.PORT || '3000'}`,
    priorAttempts: (task.prior_attempts || []).map((pa) => ({
      started_at: pa.started_at,
      exit_code: pa.exit_code ?? null,
      failure_reason: pa.failure_reason ?? null,
    })),
  })
  // Find the recipe source directory via MC's recipes root. We need a local
  // recipes path — recipe.recipe_path (from getIndexedRecipeBySlug) is the
  // canonical record, but is not in the claim response. Fall back to the
  // conventional <cwd>/recipes/<slug>/ layout (Phase 12-03 locked default).
  const recipesRoot =
    process.env.MISSION_CONTROL_RECIPES_DIR || path.join(process.cwd(), 'recipes')
  const recipeSource = path.join(recipesRoot, task.recipe_slug)
  try {
    await stageRecipe(recipeSource, stageDir, preambleText)
  } catch (err) {
    await postRunnerExit(taskId, attempt, null, 'worktree_create_failed', `stageRecipe failed: ${String(err)}`)
    return
  }

  // Step 6: env-file.
  // Merge recipe-declared secrets from .data/runner/secrets/<NAME>.
  const secretEnv = loadRecipeSecrets(recipe.secrets || [])
  const fullEnv = { ...env, ...secretEnv }
  const envFilePath = path.join(DATA_DIR, 'runner', 'env', `task-${taskId}-a${attempt}.env`)
  try {
    writeEnvFile(fullEnv, envFilePath)
  } catch (err) {
    await postRunnerExit(taskId, attempt, null, 'docker_error', `writeEnvFile failed: ${String(err)}`)
    return
  }

  // Step 7: docker run --rm -d.
  const argv = buildDockerRunArgs({
    image: recipe.image,
    taskId,
    attempt,
    recipeSlug: task.recipe_slug,
    runnerId: RUNNER_ID,
    runnerStartedAtIso,
    containerName: container_name_prefix,
    worktreePath,
    recipeStagePath: stageDir,
    readOnlyMounts: task.read_only_mounts || [],
    extraSkills: task.extra_skills || [],
    envFilePath,
    memory: resource_limits.memory,
    cpus: resource_limits.cpus,
  })

  const runR = spawnSync('docker', argv, { encoding: 'utf8' })
  if (runR.status !== 0) {
    const stderrTail = (runR.stderr || '').slice(-16_000)
    log('error', 'docker run failed', { task_id: taskId, status: runR.status, stderr_tail: stderrTail })
    finalizeMeta(logPaths, {
      exited_at: new Date().toISOString(),
      exit_code: null,
      reason: 'docker_error',
    })
    cleanupEnvFile(envFilePath)
    await postRunnerExit(taskId, attempt, null, 'docker_error', stderrTail)
    return
  }

  const containerId = (runR.stdout || '').trim()
  log('info', 'container started', { task_id: taskId, attempt, container_id: containerId })

  // Step 8: container-started (Plan 14-11).
  try {
    const csRes = await mcFetch(`/api/runner/tasks/${taskId}/container-started`, {
      method: 'POST',
      body: JSON.stringify({ container_id: containerId }),
    })
    if (!csRes.ok && csRes.status !== 409 && csRes.status !== 204) {
      log('warn', 'container-started non-OK', { task_id: taskId, status: csRes.status })
    }
  } catch (err) {
    log('warn', 'container-started threw', { task_id: taskId, err: String(err) })
  }

  // Step 9: update meta.json with real container_id.
  finalizeMeta(logPaths, { container_id: containerId })

  // Step 10: install host-side timeout.
  const nowUnix = Math.floor(Date.now() / 1000)
  const startedAtUnix = Math.floor(new Date(runnerStartedAtIso).getTime() / 1000)
  const remainingMs = computeRemainingTimeoutMs(startedAtUnix, recipe.timeout_seconds, nowUnix)
  const tracked = {
    containerId,
    attempt,
    timeoutHandle: null,
    timeoutFired: false,
    logPaths,
    envFilePath,
  }
  tracked.timeoutHandle = setTimeout(() => {
    tracked.timeoutFired = true
    log('warn', 'timeout reached, stopping container', { task_id: taskId })
    spawnSync('docker', ['stop', '--time=15', containerId])
  }, remainingMs)
  activeTasks.set(taskId, tracked)

  // Step 11: watch for exit (async — returns when container exits).
  await watchContainerExit(taskId, containerId, attempt, logPaths, envFilePath)
}

// ======================================================
// Graceful shutdown + SIGHUP config reload
// ======================================================

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  log('info', 'shutting down', { signal, active_tasks: activeTasks.size })
  // Note: SIGINT/SIGTERM do NOT post runner-exit for active tasks. A fresh
  // runner boot reconciles orphaned containers and posts runner-exit
  // reason='crash' for any task whose container is no longer live. This is an
  // intentional tradeoff — the daemon can crash unexpectedly anyway, so the
  // graceful path uses the same recovery mechanism.
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.on('SIGHUP', async () => {
  try {
    const res = await mcFetch('/api/runner/config')
    if (res.ok) {
      runnerConfig = await res.json()
      log('info', 'config reloaded via SIGHUP')
    } else {
      log('warn', 'SIGHUP config reload non-OK', { status: res.status })
    }
  } catch (err) {
    log('warn', 'SIGHUP config reload failed', { err: String(err) })
  }
})

// Keep the event loop alive.
process.stdin.resume()
