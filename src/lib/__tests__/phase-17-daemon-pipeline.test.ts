// @vitest-environment node
/**
 * Phase 17 Plan 17-04 — daemon-subprocess integration test (RTEST-02 full lane).
 *
 * Companion to Plan 17-03's direct-helpers test. Where 17-03 directly invokes
 * `@/lib/runner-*` helpers + the claim route in-process, this file spawns the
 * REAL `scripts/mc-runner.mjs` runner daemon as a child process pointed at a
 * live HTTP test server (dynamic port) and lets the daemon's boot loop —
 * register → heartbeat → SSE subscribe → 15s poll → claim → docker run →
 * submit → review-flip → Aegis approval → done — drive the pipeline end-to-end.
 *
 * Highest-fidelity coverage for RTEST-02. Slower than 17-03 (~60-180s) because
 * it exercises the real daemon boot-loop + real SSE subscriber + real 15s
 * poll fallback + real docker run against the mc-hello-world-agent image.
 *
 * Seam choices (LOCKED per Plan 17-04):
 *   - Docker-gated: describe.skipIf(!dockerAvailable || !imageAvailable) so
 *     the test skips silently on CI hosts without Docker.
 *   - D-06 boundary-mock for runAegisReviews: stubbed. runAegisReviews calls
 *     into the Anthropic SDK (or the OpenClaw gateway) via runOpenClaw. Tests
 *     never have Aegis credentials and the gateway is not available — we stub
 *     so the test asserts the DB state machine (review → done + completed_at
 *     set) without making a real external API call.
 *   - No external docker-helper npm deps (D-07 LOCKED): raw spawnSync('docker',
 *     …) per scripts/mc-runner.mjs precedent.
 */

import Database from 'better-sqlite3'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// -------------------------------------------------------------------------
// Docker preflight — computed at module load. describe.skipIf reads these.
// -------------------------------------------------------------------------
const dockerAvailable = (() => {
  try {
    const r = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 })
    return r.status === 0
  } catch {
    return false
  }
})()

const imageAvailable = dockerAvailable && (() => {
  try {
    const r = spawnSync('docker', ['image', 'inspect', 'mc-hello-world-agent:latest'], {
      stdio: 'ignore',
      timeout: 10_000,
    })
    return r.status === 0
  } catch {
    return false
  }
})()

// -------------------------------------------------------------------------
// Test fixture state — holds the in-memory DB, broadcast sink, tmpdirs.
// -------------------------------------------------------------------------
let testDb: Database.Database
const broadcastMock = vi.fn()

// -------------------------------------------------------------------------
// Boundary mocks (D-06 LOCKED pattern). Mock ONLY the database, runner-secret,
// security-events, rate-limit, event-bus, and task-dispatch seams. Everything
// else (routes, runner-claim, runner-docker, runner-worktree, recipe-indexer,
// task-checkpoints, migrations) runs for real.
// -------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    logActivity: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    createNotification: vi.fn(),
  },
}))

vi.mock('@/lib/runner-secret', () => ({
  getRunnerSecret: () => 'phase17-test-secret-abcdefghijklmnop',
  ensureRunnerSecret: vi.fn(() => 'phase17-test-secret-abcdefghijklmnop'),
  RUNNER_SECRET_FILENAME: '.data/runner.secret',
}))

vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: () => null,
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast: (...args: unknown[]) => broadcastMock(...args),
    on: vi.fn(),
    emit: vi.fn(),
  },
}))

// D-06 boundary-mock: stub Aegis verdict. runAegisReviews() requires either
// an Anthropic API key (getAnthropicApiKey()) or an OpenClaw gateway — neither
// is available in test environments. The stub performs the SAME DB transition
// the real function would do on verdict=approved: flip review → done and set
// completed_at. This keeps the test asserting the real DB state machine while
// bypassing the external API call. Plan 17-04 grep-verifies this choice via
// [grep of this file for the mock call returns exactly 1 match].
vi.mock('@/lib/task-dispatch', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/task-dispatch')>()
  return {
    ...actual,
    runAegisReviews: vi.fn().mockImplementation(async () => {
      const reviewTasks = testDb
        .prepare("SELECT id FROM tasks WHERE status IN ('review', 'quality_review')")
        .all() as { id: number }[]
      const now = Math.floor(Date.now() / 1000)
      for (const t of reviewTasks) {
        testDb
          .prepare("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?")
          .run(now, now, t.id)
      }
      return { ok: true, message: `Approved ${reviewTasks.length} task(s) (stubbed for test)` }
    }),
  }
})

// -------------------------------------------------------------------------
// Imports that must follow the vi.mock calls so they pick up the mocked
// modules — match Phase 15-07 LOCKED pattern.
// -------------------------------------------------------------------------
const { runMigrations } = await import('@/lib/migrations')
const { indexRecipe } = await import('@/lib/recipe-indexer')
const runAegisReviewsMod = await import('@/lib/task-dispatch')

// -------------------------------------------------------------------------
// Test server — a minimal HTTP server that dispatches to real Next.js route
// handlers. The spawned daemon subprocess reaches this server via MC_URL.
// Because the server is imported inside THIS test process, it picks up the
// vi.mock bindings (testDb, runner-secret, rate-limit, etc).
// -------------------------------------------------------------------------

type Handler = (req: import('next/server').NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response

async function loadHandlers() {
  const [
    { GET: configGET },
    { POST: heartbeatPOST },
    { GET: readyTasksGET },
    { GET: pendingContainersGET },
    { GET: terminalTasksGET },
    { POST: claimPOST },
    { POST: runnerExitPOST },
    { POST: submitPOST },
    { POST: containerStartedPOST },
    { POST: checkpointsPOST },
  ] = await Promise.all([
    import('@/app/api/runner/config/route'),
    import('@/app/api/runner/heartbeat/route'),
    import('@/app/api/runner/ready-tasks/route'),
    import('@/app/api/runner/pending-containers/route'),
    import('@/app/api/runner/terminal-tasks/route'),
    import('@/app/api/runner/claim/[task_id]/route'),
    import('@/app/api/runner/tasks/[task_id]/runner-exit/route'),
    import('@/app/api/runner/tasks/[task_id]/submit/route'),
    import('@/app/api/runner/tasks/[task_id]/container-started/route'),
    import('@/app/api/tasks/[id]/checkpoints/route'),
  ])
  return {
    configGET: configGET as unknown as Handler,
    heartbeatPOST: heartbeatPOST as unknown as Handler,
    readyTasksGET: readyTasksGET as unknown as Handler,
    pendingContainersGET: pendingContainersGET as unknown as Handler,
    terminalTasksGET: terminalTasksGET as unknown as Handler,
    claimPOST: claimPOST as unknown as Handler,
    runnerExitPOST: runnerExitPOST as unknown as Handler,
    submitPOST: submitPOST as unknown as Handler,
    containerStartedPOST: containerStartedPOST as unknown as Handler,
    checkpointsPOST: checkpointsPOST as unknown as Handler,
  }
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function startTestServer(): Promise<{ server: http.Server; port: number }> {
  const handlers = await loadHandlers()
  const { NextRequest } = await import('next/server')

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`)
      const method = req.method ?? 'GET'

      // /api/events — minimal SSE keep-alive so daemon SSE subscriber stays
      // connected. No real event forwarding — daemon's 15s poll fallback is
      // what actually drives task claims in this test.
      if (url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        res.write(':ok\n\n')
        const keepalive = setInterval(() => {
          try {
            res.write(':keepalive\n\n')
          } catch {
            clearInterval(keepalive)
          }
        }, 15_000)
        req.on('close', () => clearInterval(keepalive))
        return
      }

      const bodyBuf = (method === 'POST' || method === 'PUT' || method === 'PATCH')
        ? await readBody(req)
        : Buffer.alloc(0)

      const nextReq = new NextRequest(
        new URL(req.url ?? '/', `http://127.0.0.1:${(server.address() as AddressInfo).port}`),
        {
          method,
          headers: Object.entries(req.headers).reduce<Record<string, string>>((acc, [k, v]) => {
            if (typeof v === 'string') acc[k] = v
            else if (Array.isArray(v)) acc[k] = v.join(', ')
            return acc
          }, {}),
          body: bodyBuf.length > 0 ? new Uint8Array(bodyBuf) : undefined,
        },
      )

      // Route table — delegate to imported handlers with path param extraction.
      let response: Response | null = null

      if (url.pathname === '/api/runner/config' && method === 'GET') {
        response = await handlers.configGET(nextReq, { params: Promise.resolve({}) })
      } else if (url.pathname === '/api/runner/heartbeat' && method === 'POST') {
        response = await handlers.heartbeatPOST(nextReq, { params: Promise.resolve({}) })
      } else if (url.pathname === '/api/runner/ready-tasks' && method === 'GET') {
        response = await handlers.readyTasksGET(nextReq, { params: Promise.resolve({}) })
      } else if (url.pathname === '/api/runner/pending-containers' && method === 'GET') {
        response = await handlers.pendingContainersGET(nextReq, { params: Promise.resolve({}) })
      } else if (url.pathname === '/api/runner/terminal-tasks' && method === 'GET') {
        response = await handlers.terminalTasksGET(nextReq, { params: Promise.resolve({}) })
      } else {
        // Parameterized routes
        const claimMatch = url.pathname.match(/^\/api\/runner\/claim\/(\d+)$/)
        const runnerExitMatch = url.pathname.match(/^\/api\/runner\/tasks\/(\d+)\/runner-exit$/)
        const submitMatch = url.pathname.match(/^\/api\/runner\/tasks\/(\d+)\/submit$/)
        const containerStartedMatch = url.pathname.match(/^\/api\/runner\/tasks\/(\d+)\/container-started$/)
        const checkpointsMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/checkpoints$/)

        if (claimMatch && method === 'POST') {
          response = await handlers.claimPOST(nextReq, { params: Promise.resolve({ task_id: claimMatch[1] }) })
        } else if (runnerExitMatch && method === 'POST') {
          response = await handlers.runnerExitPOST(nextReq, { params: Promise.resolve({ task_id: runnerExitMatch[1] }) })
        } else if (submitMatch && method === 'POST') {
          response = await handlers.submitPOST(nextReq, { params: Promise.resolve({ task_id: submitMatch[1] }) })
        } else if (containerStartedMatch && method === 'POST') {
          response = await handlers.containerStartedPOST(nextReq, { params: Promise.resolve({ task_id: containerStartedMatch[1] }) })
        } else if (checkpointsMatch && method === 'POST') {
          response = await handlers.checkpointsPOST(nextReq, { params: Promise.resolve({ id: checkpointsMatch[1] }) })
        }
      }

      if (!response) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found', path: url.pathname }))
        return
      }

      const respBody = await response.text()
      const respHeaders: Record<string, string> = {}
      response.headers.forEach((v, k) => { respHeaders[k] = v })
      res.writeHead(response.status, respHeaders)
      res.end(respBody)
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Test server dispatch error', detail: String(err) }))
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return { server, port }
}

// -------------------------------------------------------------------------
// Git repo bootstrap — the worktree step needs a real git source repo with at
// least one commit on the `main` branch. Mirrors the Phase 14-10 smoke
// harness's setup step.
// -------------------------------------------------------------------------
function setupGitRepo(repoPath: string, scratchParent: string): void {
  // Create a scratch working repo first (with a commit on main), then clone
  // it non-bare to `repoPath` but immediately detach HEAD so the daemon can
  // create worktrees from `main` without the "already used by worktree" error.
  const scratchRepo = path.join(scratchParent, 'scratch-init')
  fs.mkdirSync(scratchRepo, { recursive: true })
  const runIn = (cwd: string, args: string[]) => {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
    if (r.status !== 0) {
      throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${r.stderr?.slice(0, 200)}`)
    }
  }
  runIn(scratchRepo, ['init', '-q', '-b', 'main'])
  runIn(scratchRepo, ['config', 'user.email', 'phase17-daemon@test.local'])
  runIn(scratchRepo, ['config', 'user.name', 'Phase17 Daemon Test'])
  runIn(scratchRepo, ['commit', '--allow-empty', '-m', 'initial commit on main'])

  // Clone into repoPath non-bare (runner daemon runs `git worktree add` which
  // needs a non-bare repo). Then detach HEAD so `main` is not the active
  // branch at repoPath — worktree add for `main` will succeed.
  fs.mkdirSync(path.dirname(repoPath), { recursive: true })
  const cloneR = spawnSync('git', ['clone', '--no-local', scratchRepo, repoPath], { encoding: 'utf8' })
  if (cloneR.status !== 0) {
    throw new Error(`git clone failed: ${cloneR.stderr?.slice(0, 200)}`)
  }
  runIn(repoPath, ['config', 'user.email', 'phase17-daemon@test.local'])
  runIn(repoPath, ['config', 'user.name', 'Phase17 Daemon Test'])
  // Detach HEAD so `main` is no longer an actively checked-out branch.
  runIn(repoPath, ['checkout', '--detach'])
}

// -------------------------------------------------------------------------
// Describe block — the full daemon-subprocess pipeline.
// -------------------------------------------------------------------------

describe.skipIf(!dockerAvailable || !imageAvailable)(
  'Phase 17 daemon-subprocess pipeline integration (RTEST-02 full lane)',
  () => {
    let tmpRoot: string
    let repoPath: string
    let recipesDir: string
    let worktreesDir: string
    let logsDir: string
    let runnerDataDir: string
    let runnerSecretsDir: string
    let server: http.Server | null = null
    let port: number
    let projectId = 0
    let daemon: ChildProcessByStdio<null, Readable, Readable> | null = null
    const daemonLogs: string[] = []
    const createdWorktrees: string[] = []
    let taskId = 0

    beforeAll(async () => {
      // 1. Initialise in-memory testDb with full migrations.
      testDb = new Database(':memory:')
      testDb.pragma('foreign_keys = ON')
      runMigrations(testDb)

      // 2. Seed the default workspace row (required by FK on tasks.workspace_id).
      const existingWs = testDb.prepare(`SELECT id FROM workspaces WHERE id = 1`).get() as { id?: number } | undefined
      if (!existingWs) {
        testDb
          .prepare(`INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (1, 'ws-1', 'Workspace 1', 1)`)
          .run()
      }

      // 3. Seed a project row used as workspace_source.project_id. Use INSERT
      // and let SQLite assign the id to avoid colliding with the migration's
      // default 'general' project seed.
      const projInfo = testDb
        .prepare(`INSERT INTO projects (slug, name, ticket_prefix, workspace_id) VALUES ('phase17-proj', 'Phase 17 Project', 'P17', 1)`)
        .run()
      projectId = Number(projInfo.lastInsertRowid)

      // 4. Create the mkdtemp layout.
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-phase17-daemon-'))
      repoPath = path.join(tmpRoot, 'repos', 'phase17-proj')
      recipesDir = path.join(tmpRoot, 'recipes')
      worktreesDir = path.join(tmpRoot, 'worktrees')
      logsDir = path.join(tmpRoot, 'logs')
      runnerDataDir = path.join(tmpRoot, 'runner-data')
      runnerSecretsDir = path.join(tmpRoot, 'runner-secrets')
      fs.mkdirSync(recipesDir, { recursive: true })
      fs.mkdirSync(worktreesDir, { recursive: true })
      fs.mkdirSync(logsDir, { recursive: true })
      fs.mkdirSync(runnerDataDir, { recursive: true })
      fs.mkdirSync(runnerSecretsDir, { recursive: true })

      // 5. Write runner.secret at the daemon's expected location — the
      // subprocess does NOT inherit vi.mock, so it reads from disk.
      fs.writeFileSync(
        path.join(runnerDataDir, 'runner.secret'),
        'phase17-test-secret-abcdefghijklmnop',
        { mode: 0o600 },
      )

      // 6. Bootstrap the git source repo.
      setupGitRepo(repoPath, tmpRoot)

      // 7. Seed the runtime.* settings rows the claim route + daemon config
      // endpoint consume.
      const now = Math.floor(Date.now() / 1000)
      const settingsStmt = testDb.prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
      )
      // project_repo_map keys are project_id numbers as strings per
      // src/lib/task-runtime-settings.ts getProjectRepoMap contract and
      // scripts/mc-runner.mjs line 962 (`project_repo_map?.[String(projectId)]`).
      settingsStmt.run(
        'runtime.project_repo_map',
        JSON.stringify({ [String(projectId)]: repoPath }),
        now,
      )
      settingsStmt.run(
        'runtime.mount_allowlist',
        JSON.stringify([repoPath, recipesDir, worktreesDir, logsDir, tmpRoot]),
        now,
      )
      settingsStmt.run('runtime.max_concurrent_containers', '4', now)
      settingsStmt.run('runtime.runner_worktrees_dir', worktreesDir, now)
      settingsStmt.run('runtime.runner_logs_dir', logsDir, now)
      settingsStmt.run('runtime.runner_secrets_dir', runnerSecretsDir, now)

      // 8. Copy the real hello-world recipe into recipesDir and index it.
      const srcRecipeDir = path.resolve('recipes/hello-world')
      const destRecipeDir = path.join(recipesDir, 'hello-world')
      fs.cpSync(srcRecipeDir, destRecipeDir, { recursive: true })
      // Set MISSION_CONTROL_RECIPES_DIR so getRecipesRoot() finds our copy
      // when resolveRecipeMaxAttempts re-parses recipe.yaml at claim time.
      process.env.MISSION_CONTROL_RECIPES_DIR = recipesDir
      const indexResult = await indexRecipe(destRecipeDir, {})
      if (indexResult.status !== 'indexed') {
        throw new Error(`hello-world recipe failed to index: ${JSON.stringify(indexResult)}`)
      }

      // 9. Start the HTTP test server.
      const started = await startTestServer()
      server = started.server
      port = started.port
      // The claim route composes MC_API_URL from `host.docker.internal:${PORT}`
      // (src/app/api/runner/claim/[task_id]/route.ts#338). Set PORT so the
      // container inside docker reaches our dynamic-port test server.
      process.env.PORT = String(port)
    }, 60_000)

    afterAll(async () => {
      // 1. Kill daemon if still running.
      if (daemon && !daemon.killed) {
        daemon.kill('SIGTERM')
        await new Promise((r) => setTimeout(r, 2000))
        if (!daemon.killed) daemon.kill('SIGKILL')
      }

      // 2. Label-scoped docker cleanup. The daemon applies mc.task_id label
      // (via composeDockerArgs), so filter on that.
      if (taskId > 0) {
        try {
          const psResult = spawnSync(
            'docker',
            ['ps', '-aq', '--filter', `label=mc.task_id=${taskId}`],
            { encoding: 'utf8', timeout: 15_000 },
          )
          if (psResult.status === 0 && psResult.stdout) {
            const ids = psResult.stdout.trim().split(/\s+/).filter(Boolean)
            for (const id of ids) {
              spawnSync('docker', ['rm', '-f', id], { stdio: 'ignore', timeout: 15_000 })
            }
          }
        } catch {
          // best effort
        }
      }

      // 3. Remove worktrees.
      for (const wt of createdWorktrees) {
        try { fs.rmSync(wt, { recursive: true, force: true }) } catch { /* ignore */ }
      }

      // 4. Close server + DB + tmpdir.
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()))
      }
      try { testDb?.close() } catch { /* ignore */ }
      if (tmpRoot) {
        try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    }, 30_000)

    it('full pipeline via scripts/mc-runner.mjs daemon', async () => {
      // ----- Phase A — create a recipe-tagged task in status=assigned.
      const insertStmt = testDb.prepare(
        `INSERT INTO tasks
           (title, status, priority, workspace_id, project_id, recipe_slug, workspace_source, runner_attempts)
         VALUES (?, 'assigned', 'medium', 1, ?, ?, ?, 0)`,
      )
      const info = insertStmt.run(
        'Phase 17 daemon pipeline test',
        projectId,
        'hello-world',
        JSON.stringify({ project_id: projectId, base_ref: 'main' }),
      )
      taskId = Number(info.lastInsertRowid)
      expect(taskId).toBeGreaterThan(0)

      const initialTask = testDb
        .prepare(`SELECT id, status, recipe_slug FROM tasks WHERE id = ?`)
        .get(taskId) as { id: number; status: string; recipe_slug: string } | undefined
      expect(initialTask?.status).toBe('assigned')
      expect(initialTask?.recipe_slug).toBe('hello-world')

      // ----- Phase B — spawn the daemon subprocess.
      const repoRoot = path.resolve('.')
      const daemonEnv: NodeJS.ProcessEnv = {
        ...process.env,
        MC_URL: `http://127.0.0.1:${port}`,
        MISSION_CONTROL_DATA_DIR: runnerDataDir,
        MC_RUNNER_SECRETS_DIR: runnerSecretsDir,
        MISSION_CONTROL_RECIPES_DIR: recipesDir,
        // Avoid loading the project's real .env files into the daemon process.
        NODE_ENV: 'test',
      }

      daemon = spawn('node', ['scripts/mc-runner.mjs'], {
        cwd: repoRoot,
        env: daemonEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      daemon.stdout.on('data', (c) => daemonLogs.push('[stdout] ' + c.toString()))
      daemon.stderr.on('data', (c) => daemonLogs.push('[stderr] ' + c.toString()))
      daemon.on('error', (err) => daemonLogs.push('[spawn-error] ' + String(err)))

      // ----- Phase C — wait for daemon to claim + container to exit + submit.
      // The daemon polls ready-tasks every 15s. Container should start within
      // ~20s, hello-world agent runs in ~5-10s, submit flips to 'review' next.
      const deadline = Date.now() + 150_000
      let finalStatus: string | null = null
      let sawInProgress = false
      let sawReviewOrDone = false
      while (Date.now() < deadline) {
        const row = testDb
          .prepare(`SELECT status FROM tasks WHERE id = ?`)
          .get(taskId) as { status: string } | undefined
        if (row?.status === 'in_progress') sawInProgress = true
        if (row?.status === 'review' || row?.status === 'done' || row?.status === 'quality_review') {
          sawReviewOrDone = true
          finalStatus = row.status
          break
        }
        if (row?.status === 'failed' || row?.status === 'cancelled') {
          finalStatus = row.status
          // Look up any attempt rows to help diagnose.
          const attempts = testDb
            .prepare(`SELECT attempt, failure_reason, exit_code FROM task_runner_attempts WHERE task_id = ? ORDER BY attempt ASC`)
            .all(taskId)
          daemonLogs.push(`[diag] task reached terminal status=${row.status}; attempts=${JSON.stringify(attempts)}`)
          break
        }
        await new Promise((r) => setTimeout(r, 500))
      }

      // Track any worktree the daemon created for cleanup.
      const expectedWorktree = path.join(worktreesDir, `task-${taskId}`)
      if (fs.existsSync(expectedWorktree)) createdWorktrees.push(expectedWorktree)

      if (!sawReviewOrDone) {
        throw new Error(
          `Daemon did not drive task ${taskId} to review/done within 150s. Last status: ${finalStatus}. ` +
          `Daemon logs (last 4000 chars):\n${daemonLogs.join('').slice(-4000)}`,
        )
      }

      // sawInProgress is best-effort: the state transition assigned → in_progress
      // → review can elapse faster than the 500ms poll interval on hot Docker
      // caches. Reaching 'review' (or done/quality_review) is proof the daemon
      // did claim (which is the transition the claim route writes in_progress).
      if (!['review', 'quality_review', 'done'].includes(finalStatus ?? '')) {
        // Dump logs file for inspection
        const logFile = path.join(os.tmpdir(), `phase17-daemon-last-run-${Date.now()}.log`)
        fs.writeFileSync(logFile, daemonLogs.join(''), 'utf8')
        throw new Error(
          `Pipeline failed: sawInProgress=${sawInProgress} finalStatus=${finalStatus}; full logs at ${logFile}. ` +
          `Last 4000 chars:\n${daemonLogs.join('').slice(-4000)}`,
        )
      }

      // ----- Phase D — assert the Phase 17-01 review-flip shape.
      const postSubmit = testDb
        .prepare(`SELECT status, container_id, completed_at FROM tasks WHERE id = ?`)
        .get(taskId) as { status: string; container_id: string | null; completed_at: number | null }
      // If the flip reached 'review', container_id cleared and completed_at null.
      if (postSubmit.status === 'review') {
        expect(postSubmit.container_id).toBeNull()
        expect(postSubmit.completed_at).toBeNull()
      }

      // Check checkpoints row count >= 1 (hello-world agent appends 1 checkpoint
      // to /workspace/.mc/checkpoints.jsonl only — it does NOT POST to the
      // checkpoints API, so task_checkpoints DB count may be 0; the JSONL file
      // is the authoritative source for this agent).
      const jsonlPath = path.join(expectedWorktree, '.mc', 'checkpoints.jsonl')
      if (fs.existsSync(jsonlPath)) {
        const jsonlContent = fs.readFileSync(jsonlPath, 'utf8')
        const jsonlLines = jsonlContent.trim().split('\n').filter(Boolean)
        expect(jsonlLines.length).toBeGreaterThanOrEqual(1)
      }

      // Runner-token should be revoked at the review-flip.
      if (postSubmit.status === 'review') {
        const tokenRow = testDb
          .prepare(`SELECT revoked_at FROM task_runner_tokens WHERE task_id = ? ORDER BY id DESC LIMIT 1`)
          .get(taskId) as { revoked_at: number | null } | undefined
        expect(tokenRow?.revoked_at).toBeTruthy()
      }

      // ----- Phase E — Aegis review (the D-06 boundary stub defined above).
      const aegisResult = await runAegisReviewsMod.runAegisReviews()
      expect(aegisResult.ok).toBe(true)

      // Poll DB for final status flip from 'review' → 'done'.
      const aegisDeadline = Date.now() + 10_000
      let doneRow: { status: string; completed_at: number | null } | undefined
      while (Date.now() < aegisDeadline) {
        doneRow = testDb
          .prepare(`SELECT status, completed_at FROM tasks WHERE id = ?`)
          .get(taskId) as { status: string; completed_at: number | null }
        if (doneRow?.status === 'done') break
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(doneRow?.status).toBe('done')
      expect(doneRow?.completed_at).toBeGreaterThan(0)

      // Diagnostic: log the daemon's observed state transitions so SUMMARY.md
      // has confirmation the daemon actually drove the pipeline (not a false
      // positive where Aegis fired before the container ever ran).
      const attempts = testDb
        .prepare(`SELECT attempt, exit_code, failure_reason, started_at, exited_at FROM task_runner_attempts WHERE task_id = ? ORDER BY attempt ASC`)
        .all(taskId)
      expect(attempts.length).toBeGreaterThanOrEqual(1)

      // ----- Phase F — graceful daemon shutdown.
      if (daemon && !daemon.killed) {
        daemon.kill('SIGTERM')
        await new Promise((r) => setTimeout(r, 2000))
        if (!daemon.killed) daemon.kill('SIGKILL')
      }
    }, 180_000)
  },
)
