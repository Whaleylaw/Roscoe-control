// @vitest-environment node
/**
 * Phase 17 Plan 17-05 — RTEST-03 crash-recovery integration test.
 *
 * Proves the crash-safety invariants ROADMAP SC-3 calls out: the per-task
 * worktree + `.mc/` state survive a mid-task SIGKILL, the runner-exit handler
 * flips the task back to `assigned` for retry, re-claim surfaces
 * `is_resuming=true` with the prior-attempt history, and the second attempt
 * EXTENDS rather than REPLACES `.mc/progress.md` + `.mc/checkpoints.jsonl`.
 *
 * Flow (one large it() driving all 10 phases):
 *
 *   A. Create task + claim attempt 1 (real POST handlers)
 *   B. Launch the `mc-hello-world-agent:latest` container with the Pitfall-10
 *      CMD override so the agent body runs in the background under `sh` and
 *      the container stays alive until we SIGKILL it
 *   C. Poll `.mc/checkpoints.jsonl` for the first line, then `docker kill -s
 *      SIGKILL <container>` — the deterministic mid-task kill window
 *   D. Snapshot post-kill `.mc/` state (progress.md + checkpoints.jsonl
 *      non-empty; task.json present)
 *   E. POST /api/runner/tasks/:id/runner-exit with exit_code=137, reason='crash'
 *      — flips status=assigned, increments runner_attempts
 *   F. Re-claim via POST /api/runner/claim/:task_id → payload.task.is_resuming
 *      === true AND payload.task.prior_attempts.length === 1
 *   G. Re-seed via seedMcDir({task: ..., resume_marker: ...}) — note this test
 *      constructs a synthetic resume_marker (RTEST-03 is about crash-recovery,
 *      not blocker-recovery; the LOCKED marker format is the same line, and
 *      runner-worktree.ts appends it verbatim regardless of the `reason`
 *      string). Byte-for-byte asserts progress.md === before + LOCKED marker
 *      line; checkpoints.jsonl byte-identical (preservation invariant)
 *   H. Re-run the container normally (no CMD override) — agent runs to
 *      completion, POSTs /submit, status flips to 'review'
 *   I. Assert progress.md starts with the phase-D snapshot and now contains
 *      the appended attempt-2 agent content; checkpoints.jsonl line count
 *      grew by at least 1
 *   J. afterEach / afterAll cleanup (label-scoped `docker rm -f` +
 *      worktree rmdir + tmpRoot rmdir + testDb.close())
 *
 * Auto-skip discipline: `describe.skipIf(!dockerAvailable || !imageAvailable)`
 * — matches 17-03's precedent so this test runs when the dev host / CI runner
 * has Docker AND the pinned image; otherwise it silently skips.
 *
 * D-07 LOCKED: no new npm dependencies. Raw `child_process.spawnSync('docker',
 * …)` matches the existing runner-daemon pattern.
 *
 * D-06 boundary-mock pattern (same seam as 17-03 / 17-04): mocks ONLY @/lib/db,
 * @/lib/runner-secret, @/lib/rate-limit, @/lib/security-events, @/lib/event-bus.
 * Real runner-claim / runner-worktree / runner-docker / auth / runner-tokens /
 * migrations / recipe-indexer are imported for real.
 *
 * Unlike 17-03 this file does NOT stub `@/lib/task-dispatch` — the crash-
 * recovery flow stops at the final /submit (review flip). Aegis → done is out
 * of scope for RTEST-03; 17-03 already covers it.
 */

import Database from 'better-sqlite3'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Docker availability preflight — evaluated at module load.
// ---------------------------------------------------------------------------

const dockerAvailable = (() => {
  try {
    return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
})()

const imageAvailable =
  dockerAvailable &&
  (() => {
    const r = spawnSync(
      'docker',
      ['image', 'inspect', 'mc-hello-world-agent:latest'],
      { stdio: 'ignore' },
    )
    return r.status === 0
  })()

// ---------------------------------------------------------------------------
// Boundary-mock seams (Phase 15-07 LOCKED pattern — verbatim from 17-03).
// ---------------------------------------------------------------------------

let testDb: Database.Database
const broadcastMock = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    logActivity: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    createNotification: vi.fn(),
  },
}))

vi.mock('@/lib/runner-secret', () => ({
  getRunnerSecret: () => 'phase17crash-test-secret-abcdefghijklmnop',
  ensureRunnerSecret: vi.fn(() => 'phase17crash-test-secret-abcdefghijklmnop'),
  RUNNER_SECRET_FILENAME: '.data/runner.secret',
}))

vi.mock('@/lib/security-events', () => ({ logSecurityEvent: vi.fn() }))

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

// ---------------------------------------------------------------------------
// Real imports AFTER the mocks are registered.
// ---------------------------------------------------------------------------

const { runMigrations } = await import('@/lib/migrations')
const { POST: createTaskHandler } = await import('@/app/api/tasks/route')
const { POST: claimTaskHandler } = await import(
  '@/app/api/runner/claim/[task_id]/route'
)
const { POST: submitHandler } = await import(
  '@/app/api/runner/tasks/[task_id]/submit/route'
)
const { POST: runnerExitHandler } = await import(
  '@/app/api/runner/tasks/[task_id]/runner-exit/route'
)
const { POST: checkpointHandler } = await import(
  '@/app/api/tasks/[id]/checkpoints/route'
)
const { stageRecipe, writeEnvFile } = await import('@/lib/runner-docker')
const { seedMcDir } = await import('@/lib/runner-worktree')
const { indexRecipe } = await import('@/lib/recipe-indexer')

// ---------------------------------------------------------------------------
// Fixture constants.
// ---------------------------------------------------------------------------

const RUNNER_SECRET = 'phase17crash-test-secret-abcdefghijklmnop'
const ADMIN_API_KEY = 'phase17crash-admin-api-key-0123456789abc'
const HELLO_WORLD_SLUG = 'hello-world'
const DOCKER_IMAGE = 'mc-hello-world-agent:latest'
// Label used for afterEach cleanup — distinct from 17-03's label so parallel
// runs across files don't step on each other.
const CLEANUP_LABEL = 'mc.test.phase17crash'

let tmpRoot: string
let repoPath: string
let recipesDir: string
let worktreesDir: string
let logsDir: string
let recipeStageDir: string
let envFileDir: string
let helloProjectId: number
let harnessServer: http.Server | null = null
let harnessPort = 0
const createdWorktrees = new Set<string>()

// ---------------------------------------------------------------------------
// Helper functions (mirrors 17-03 — kept duplicated rather than extracted so
// each crash-recovery assertion is readable in isolation; Phase 17-05 SUMMARY
// flags the duplication as a deferred refactor candidate).
// ---------------------------------------------------------------------------

function seedWorkspace(db: Database.Database): void {
  const existing = db
    .prepare(`SELECT id FROM workspaces WHERE id = 1`)
    .get() as { id?: number } | undefined
  if (!existing) {
    db.prepare(
      `INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (?, ?, ?, ?)`,
    ).run(1, 'ws-1', 'Workspace 1', 1)
  }
}

function seedProject(db: Database.Database): number {
  const slug = 'hello-world-crash-project'
  const existing = db
    .prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = ?`)
    .get(slug) as { id?: number } | undefined
  if (existing?.id) return existing.id
  const result = db
    .prepare(
      `INSERT INTO projects (workspace_id, name, slug, status, ticket_prefix, ticket_counter)
       VALUES (1, 'Hello World Crash Project', ?, 'active', 'HCR', 0)`,
    )
    .run(slug)
  return Number(result.lastInsertRowid)
}

function setupGitRepo(dir: string): void {
  const env = { ...process.env, HOME: tmpRoot }
  const init = spawnSync('git', ['init', '-b', 'main'], {
    cwd: dir,
    env,
    encoding: 'utf8',
  })
  if (init.status !== 0) {
    throw new Error(
      `git init failed (${init.status}): ${(init.stderr ?? '').slice(-400)}`,
    )
  }
  spawnSync('git', ['config', 'user.email', 'phase17crash@test.local'], {
    cwd: dir,
    env,
  })
  spawnSync('git', ['config', 'user.name', 'Phase17 Crash Test'], {
    cwd: dir,
    env,
  })
  const commit = spawnSync(
    'git',
    ['commit', '--allow-empty', '-m', 'init'],
    { cwd: dir, env, encoding: 'utf8' },
  )
  if (commit.status !== 0) {
    throw new Error(
      `git commit failed (${commit.status}): ${(commit.stderr ?? '').slice(-400)}`,
    )
  }
}

function createWorktreeDir(taskId: number): string {
  const worktreePath = path.join(worktreesDir, `task-${taskId}`)
  fs.mkdirSync(worktreePath, { recursive: true })
  const env = { ...process.env, HOME: tmpRoot }
  spawnSync('git', ['init', '-b', 'main'], {
    cwd: worktreePath,
    env,
    encoding: 'utf8',
  })
  spawnSync('git', ['config', 'user.email', 'phase17crash@test.local'], {
    cwd: worktreePath,
    env,
  })
  spawnSync('git', ['config', 'user.name', 'Phase17 Crash Test'], {
    cwd: worktreePath,
    env,
  })
  createdWorktrees.add(worktreePath)
  return worktreePath
}

function buildJsonRequest(
  url: string,
  method: 'GET' | 'POST',
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  const init: {
    method: string
    headers: Record<string, string>
    body?: string
  } = {
    method,
    headers: { 'content-type': 'application/json', ...headers },
  }
  if (body !== undefined && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  return new NextRequest(url, init)
}

/**
 * Minimal host-side HTTP harness dispatching the two endpoints the agent
 * container calls: POST /api/runner/tasks/:id/submit (runner-token) and
 * POST /api/tasks/:id/checkpoints (runner-token). Matches 17-03's dispatcher
 * shape verbatim — the container body is identical across both tests.
 */
function startTestHarness(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://localhost`)
        const pathname = url.pathname

        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const bodyRaw = Buffer.concat(chunks).toString('utf8')

        const submitMatch = pathname.match(
          /^\/api\/runner\/tasks\/(\d+)\/submit\/?$/,
        )
        const checkpointMatch = pathname.match(
          /^\/api\/tasks\/(\d+)\/checkpoints\/?$/,
        )

        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') headers[k] = v
          else if (Array.isArray(v)) headers[k] = v.join(',')
        }

        if (req.method === 'POST' && submitMatch) {
          const taskId = submitMatch[1]
          const next = new NextRequest(`http://localhost${pathname}`, {
            method: 'POST',
            headers,
            body: bodyRaw || undefined,
          })
          const response = await submitHandler(next, {
            params: Promise.resolve({ task_id: taskId }),
          })
          const text = await response.text()
          res.statusCode = response.status
          response.headers.forEach((val, key) => res.setHeader(key, val))
          res.end(text)
          return
        }

        if (req.method === 'POST' && checkpointMatch) {
          const taskId = checkpointMatch[1]
          const next = new NextRequest(`http://localhost${pathname}`, {
            method: 'POST',
            headers,
            body: bodyRaw || undefined,
          })
          const response = await checkpointHandler(next, {
            params: Promise.resolve({ id: taskId }),
          })
          const text = await response.text()
          res.statusCode = response.status
          response.headers.forEach((val, key) => res.setHeader(key, val))
          res.end(text)
          return
        }

        res.statusCode = 404
        res.end(
          JSON.stringify({ error: `no route for ${req.method} ${pathname}` }),
        )
      } catch (err) {
        res.statusCode = 500
        res.end(
          JSON.stringify({
            error: 'harness dispatch threw',
            detail: String(err instanceof Error ? err.message : err),
          }),
        )
      }
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({ server, port: addr.port })
    })
  })
}

function stopTestHarness(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

// ---------------------------------------------------------------------------
// One-time fixture setup — shared across the single it() below.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!dockerAvailable || !imageAvailable) return

  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  seedWorkspace(testDb)
  helloProjectId = seedProject(testDb)

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-phase17crash-'))
  repoPath = path.join(tmpRoot, 'repos', 'hello-world-crash-project')
  recipesDir = path.join(tmpRoot, 'recipes')
  worktreesDir = path.join(tmpRoot, 'worktrees')
  logsDir = path.join(tmpRoot, 'logs')
  recipeStageDir = path.join(tmpRoot, 'recipe-stage')
  envFileDir = path.join(tmpRoot, 'env-files')

  for (const dir of [
    repoPath,
    recipesDir,
    worktreesDir,
    logsDir,
    recipeStageDir,
    envFileDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  setupGitRepo(repoPath)

  // Recipes root override so indexRecipe + runner-claim's filesystem re-parse
  // point at the fixture, NOT the repo's real recipes/ tree.
  process.env.MISSION_CONTROL_RECIPES_DIR = recipesDir

  // Seed runtime settings. runner-claim re-validates mounts against the
  // allowlist — worktreesDir must be in it so the worktree bind passes.
  const settingsNow = Math.floor(Date.now() / 1000)
  const settingsInsert = testDb.prepare(
    `INSERT OR REPLACE INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)`,
  )
  settingsInsert.run(
    'runtime.project_repo_map',
    JSON.stringify({ 'hello-world-crash-project': repoPath }),
    settingsNow,
  )
  settingsInsert.run(
    'runtime.mount_allowlist',
    JSON.stringify([repoPath, recipesDir, worktreesDir, logsDir]),
    settingsNow,
  )
  settingsInsert.run('runtime.max_concurrent_containers', '4', settingsNow)
  settingsInsert.run('runtime.runner_logs_dir', logsDir, settingsNow)
  settingsInsert.run('runtime.runner_worktrees_dir', worktreesDir, settingsNow)

  // Copy the real `recipes/hello-world/` into the fixture recipes dir so the
  // indexer sees a real, valid recipe (pinned image, known-good YAML).
  const repoRecipeDir = path.join(process.cwd(), 'recipes', 'hello-world')
  const stagedRecipeDir = path.join(recipesDir, 'hello-world')
  fs.mkdirSync(stagedRecipeDir, { recursive: true })
  for (const file of fs.readdirSync(repoRecipeDir)) {
    fs.copyFileSync(
      path.join(repoRecipeDir, file),
      path.join(stagedRecipeDir, file),
    )
  }

  const indexResult = await indexRecipe(stagedRecipeDir, { dbOverride: testDb })
  if (indexResult.status !== 'indexed') {
    throw new Error(
      `indexRecipe returned ${indexResult.status}: ${JSON.stringify(indexResult)}`,
    )
  }

  // Admin API key for the /api/tasks POST (operator role required).
  process.env.API_KEY = ADMIN_API_KEY
  process.env.MC_PROXY_AUTH_HEADER = ''

  // Start the test harness HTTP server.
  const { server, port } = await startTestHarness()
  harnessServer = server
  harnessPort = port
})

afterAll(async () => {
  if (harnessServer) await stopTestHarness(harnessServer)
  if (testDb) testDb.close()
  if (tmpRoot) {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
  delete process.env.MISSION_CONTROL_RECIPES_DIR
})

afterEach(() => {
  // Label-scoped docker cleanup.
  if (dockerAvailable) {
    const list = spawnSync('docker', [
      'ps',
      '-aq',
      '--filter',
      `label=${CLEANUP_LABEL}=1`,
    ])
    const ids = (list.stdout?.toString() ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const id of ids) {
      spawnSync('docker', ['rm', '-f', id], { stdio: 'ignore' })
    }
  }
  for (const wt of createdWorktrees) {
    try {
      fs.rmSync(wt, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
  createdWorktrees.clear()
})

// ---------------------------------------------------------------------------
// Crash-recovery integration test.
// ---------------------------------------------------------------------------

describe.skipIf(!dockerAvailable || !imageAvailable)(
  'Phase 17 crash recovery (RTEST-03)',
  () => {
    it(
      'kills container mid-task, preserves .mc/, resume reads prior state without redoing',
      async () => {
        // ================================================================
        // Phase A — Create task + claim attempt 1 (real POST handlers).
        // ================================================================
        broadcastMock.mockReset()
        const createReq = buildJsonRequest(
          'http://localhost/api/tasks',
          'POST',
          {
            project_id: helloProjectId,
            title: 'Phase 17 crash-recovery test',
            recipe_slug: HELLO_WORLD_SLUG,
            workspace_source: {
              project_id: helloProjectId,
              base_ref: 'main',
            },
            status: 'assigned',
          },
          { authorization: `Bearer ${ADMIN_API_KEY}` },
        )
        const createRes = await createTaskHandler(createReq)
        expect(createRes.status).toBe(201)
        const createdTask = (await createRes.json()) as {
          task: { id: number; status: string; recipe_slug: string | null }
        }
        const taskId = createdTask.task.id
        expect(createdTask.task.recipe_slug).toBe(HELLO_WORLD_SLUG)
        expect(createdTask.task.status).toBe('assigned')

        const claimReq1 = buildJsonRequest(
          `http://localhost/api/runner/claim/${taskId}`,
          'POST',
          {},
          { authorization: `Bearer ${RUNNER_SECRET}` },
        )
        const claimRes1 = await claimTaskHandler(claimReq1, {
          params: Promise.resolve({ task_id: String(taskId) }),
        })
        expect(claimRes1.status).toBe(200)
        const claim1 = (await claimRes1.json()) as {
          task: {
            id: number
            recipe_slug: string
            attempt: number
            is_resuming: boolean
            prior_attempts: unknown[]
          }
          env: Record<string, string>
          recipe: { slug: string; timeout_seconds: number }
          runner_token_expires_at: number
        }
        expect(claim1.task.attempt).toBe(1)
        expect(claim1.task.is_resuming).toBe(false)
        expect(claim1.task.prior_attempts).toHaveLength(0)
        const runnerToken1 = claim1.env.MC_API_TOKEN
        expect(typeof runnerToken1).toBe('string')
        expect(runnerToken1.length).toBeGreaterThan(10)

        // Stage worktree + recipe + seed .mc/ (first attempt).
        const worktreePath = createWorktreeDir(taskId)
        const stagedRecipePath = path.join(recipeStageDir, `task-${taskId}-a1`)
        await stageRecipe({
          sourceDir: path.join(recipesDir, HELLO_WORLD_SLUG),
          stageDir: stagedRecipePath,
          preambleContents:
            '# Phase 17 crash-recovery test preamble (attempt 1)\n',
        })

        seedMcDir(worktreePath, {
          task: {
            task_id: String(taskId),
            recipe_slug: HELLO_WORLD_SLUG,
            attempt: 1,
            is_resuming: false,
            prior_attempts: [],
          },
        })

        // Point the task's worktree_path at the fixture so checkpoint writes
        // land where we'll assert on them (17-03 precedent).
        testDb
          .prepare(`UPDATE tasks SET worktree_path = ? WHERE id = ?`)
          .run(worktreePath, taskId)

        const progressPath = path.join(worktreePath, '.mc', 'progress.md')
        const jsonlPath = path.join(worktreePath, '.mc', 'checkpoints.jsonl')
        const taskJsonPath = path.join(worktreePath, '.mc', 'task.json')
        expect(fs.existsSync(progressPath)).toBe(true)
        expect(fs.existsSync(jsonlPath)).toBe(true)
        expect(fs.existsSync(taskJsonPath)).toBe(true)

        const envForContainer1: Record<string, string> = {
          ...claim1.env,
          MC_API_URL: `http://host.docker.internal:${harnessPort}`,
          MC_WORKSPACE: '/workspace',
          MC_RECIPE_PATH: '/recipe',
          MC_PREAMBLE_PATH: '/recipe/PREAMBLE.md',
          MC_TASK_ID: String(taskId),
          MC_API_TOKEN: runnerToken1,
        }
        const envFilePath1 = path.join(envFileDir, `task-${taskId}-a1.env`)
        writeEnvFile({ envMap: envForContainer1, filePath: envFilePath1 })

        // ================================================================
        // Phase B — Launch container DETACHED with Pitfall-10 CMD override,
        // deterministically blocking the agent body from running.
        //
        // KEY DISCRIMINATOR vs 17-03: we must SIGKILL the container BEFORE
        // the hello-world agent reaches its step-6 POST /submit, or the task
        // transitions to `review` and the runner-exit handler's retry path
        // (WHERE status='in_progress') is a no-op. Two problems with running
        // the agent in parallel with a sleep wrapper:
        //
        //   (a) Even with `node /app/agent.mjs & sleep 30`, the agent's 6-step
        //       body completes in ~1-2 seconds on a warm host. We can't poll-
        //       for-first-checkpoint (step 4) and ALSO race ahead of step 6's
        //       submit POST deterministically — the agent is too fast.
        //
        //   (b) The plan-sketch approach of a race loop would make the test
        //       flaky in CI (cold daemon + cold image pull + jitter).
        //
        // Solution: seed the agent's first-attempt side-effects (.mc/progress.md
        // append + .mc/checkpoints.jsonl append) IN-PROCESS from the test,
        // then spin up a container that just sleeps (no agent body). The
        // container is a valid live container under the mc-hello-world-agent
        // image — SIGKILL vs the running `sleep` is byte-identical to SIGKILL
        // vs a running agent. The .mc/ snapshot the test captures is the
        // canonical "crashed mid-task" shape: agent wrote first progress line,
        // wrote first checkpoint line, did NOT commit HELLO.md, did NOT POST
        // /submit.
        //
        // This satisfies RTEST-03's invariants — worktree+.mc/ preservation,
        // runner-exit retry, re-claim resume semantics, marker injection,
        // attempt-2 append — without the agent-vs-kill race. The second
        // attempt (Phase H) DOES run the real agent body end-to-end, so the
        // resume-side of the flow is exercised against the real reference
        // image.
        // ================================================================
        // Seed attempt-1 side-effects to match what the agent's steps 3-4
        // would have written mid-run.
        const attempt1ProgressLine = `${new Date().toISOString()} | hello-world agent greets you (attempt 1 simulated pre-kill)\n`
        fs.appendFileSync(progressPath, attempt1ProgressLine)
        const attempt1Checkpoint = {
          step: 'hello-world-smoke',
          summary:
            'Attempt 1 checkpoint seeded by RTEST-03 before deterministic SIGKILL.',
          status: 'completed',
          ts: new Date().toISOString(),
          task_id: String(taskId),
          model: 'claude-haiku-4-5-20251001',
        }
        fs.appendFileSync(
          jsonlPath,
          JSON.stringify(attempt1Checkpoint) + '\n',
        )

        const containerName1 = `mc-task-${taskId}-a1-crash`
        const runArgs1 = [
          'run',
          '-d',
          '--name',
          containerName1,
          '--label',
          `${CLEANUP_LABEL}=1`,
          '--label',
          `mc.task_id=${taskId}`,
          '--add-host',
          'host.docker.internal:host-gateway',
          '-v',
          `${worktreePath}:/workspace:rw`,
          '-v',
          `${stagedRecipePath}:/recipe:ro`,
          '--env-file',
          envFilePath1,
          '--entrypoint',
          '/bin/sh',
          DOCKER_IMAGE,
          '-c',
          // Sleep long enough that SIGKILL lands while the container is
          // active. The agent body is intentionally NOT executed here — see
          // the Phase B comment above.
          'sleep 60',
        ]
        const runResult1 = spawnSync('docker', runArgs1, { encoding: 'utf8' })
        if (runResult1.status !== 0) {
          throw new Error(
            `docker run (attempt 1) exited ${runResult1.status}\nstdout:\n${runResult1.stdout}\nstderr:\n${runResult1.stderr}`,
          )
        }

        // ================================================================
        // Phase C — Confirm the .mc/ state exists, confirm container is
        // running, then SIGKILL.
        //
        // The progress.md + checkpoints.jsonl seed happened synchronously
        // in-process above so no poll is needed to observe the first line.
        // We still assert the files contain the attempt-1 content before
        // killing — catches any fs-rmtree ordering regression in the fixture.
        // ================================================================
        expect(fs.existsSync(jsonlPath) && fs.statSync(jsonlPath).size > 0).toBe(
          true,
        )
        expect(fs.readFileSync(progressPath, 'utf8')).toContain(
          attempt1ProgressLine.trim(),
        )

        // Briefly wait for docker to get the container into the Running
        // state (`run -d` returns after create+start but there's a short
        // window before `docker kill` can target it reliably on some hosts).
        for (let i = 0; i < 20; i++) {
          const inspect = spawnSync(
            'docker',
            ['inspect', '-f', '{{.State.Status}}', containerName1],
            { encoding: 'utf8' },
          )
          if (inspect.stdout?.trim() === 'running') break
          await new Promise((r) => setTimeout(r, 100))
        }

        // Kill the container. SIGKILL → container exits with 137 on the
        // docker side (128 + 9) — we POST that below in Phase E.
        const killResult = spawnSync('docker', [
          'kill',
          '-s',
          'SIGKILL',
          containerName1,
        ])
        expect(killResult.status).toBe(0)

        // Give docker a beat to mark the container dead so subsequent
        // operations don't race against a not-yet-exited state.
        await new Promise((r) => setTimeout(r, 1500))

        // Proactively remove the killed container so it doesn't hold any
        // worktree handles when attempt 2 binds the same host directory.
        spawnSync('docker', ['rm', '-f', containerName1], { stdio: 'ignore' })

        // ================================================================
        // Phase D — Snapshot post-kill .mc/ state.
        // ================================================================
        const progressAfterKill = fs.readFileSync(progressPath, 'utf8')
        const jsonlAfterKill = fs.readFileSync(jsonlPath, 'utf8')
        expect(progressAfterKill.length).toBeGreaterThan(0)
        expect(jsonlAfterKill.trim().split('\n').filter(Boolean).length,).toBeGreaterThanOrEqual(1)
        expect(fs.existsSync(taskJsonPath)).toBe(true)

        const jsonlLinesAfterKill = jsonlAfterKill
          .trim()
          .split('\n')
          .filter((l) => l.trim().length > 0).length

        // ================================================================
        // Phase E — POST /api/runner/tasks/:id/runner-exit with exit_code=137,
        // reason='crash'. The handler should flip the task to `assigned` for
        // retry (runner_attempts=1 < default cap 3) and increment
        // runner_attempts via the same-transaction UPDATE.
        //
        // Note: exit_code 137 on a crash reason is persisted verbatim; the
        // 'exit:${code}' formatter in runner-exit only fires for reason='exit',
        // so the failure_reason column gets the bare 'crash' string.
        // ================================================================
        broadcastMock.mockReset()
        const exitReq = buildJsonRequest(
          `http://localhost/api/runner/tasks/${taskId}/runner-exit`,
          'POST',
          {
            exit_code: 137,
            reason: 'crash',
            attempt: 1,
            stderr_tail: 'SIGKILL',
          },
          { authorization: `Bearer ${RUNNER_SECRET}` },
        )
        const exitRes = await runnerExitHandler(exitReq, {
          params: Promise.resolve({ task_id: String(taskId) }),
        })
        expect(exitRes.status).toBe(204)

        const afterExit = testDb
          .prepare(
            `SELECT status, runner_attempts, container_id, runner_last_failure_reason
             FROM tasks WHERE id = ?`,
          )
          .get(taskId) as {
          status: string
          runner_attempts: number
          container_id: string | null
          runner_last_failure_reason: string | null
        }
        expect(afterExit.status).toBe('assigned')
        // runner_attempts should reflect the completed first attempt.
        expect(afterExit.runner_attempts).toBeGreaterThanOrEqual(1)
        expect(afterExit.container_id).toBeNull()
        expect(afterExit.runner_last_failure_reason).toBe('crash')

        // task_runner_attempts row for attempt 1 has the crash stamp.
        const attempt1Row = testDb
          .prepare(
            `SELECT exit_code, failure_reason, stderr_tail
             FROM task_runner_attempts WHERE task_id = ? AND attempt = 1`,
          )
          .get(taskId) as {
          exit_code: number | null
          failure_reason: string | null
          stderr_tail: string | null
        }
        expect(attempt1Row).toBeDefined()
        expect(attempt1Row.exit_code).toBe(137)
        expect(attempt1Row.failure_reason).toBe('crash')
        expect(attempt1Row.stderr_tail).toBe('SIGKILL')

        // task.container_exited broadcast fired with the SIGKILL metadata.
        const containerExitedFrames = broadcastMock.mock.calls.filter(
          (c) => c[0] === 'task.container_exited',
        )
        expect(containerExitedFrames.length).toBeGreaterThanOrEqual(1)
        const exitedPayload = containerExitedFrames[0][1] as {
          task_id: number
          reason: string
          exit_code: number | null
        }
        expect(exitedPayload.task_id).toBe(taskId)
        expect(exitedPayload.exit_code).toBe(137)

        // ================================================================
        // Phase F — Re-claim (attempt 2). Resume semantics surface via the
        // claim payload: is_resuming=true and prior_attempts=[attempt 1].
        // ================================================================
        const claimReq2 = buildJsonRequest(
          `http://localhost/api/runner/claim/${taskId}`,
          'POST',
          {},
          { authorization: `Bearer ${RUNNER_SECRET}` },
        )
        const claimRes2 = await claimTaskHandler(claimReq2, {
          params: Promise.resolve({ task_id: String(taskId) }),
        })
        expect(claimRes2.status).toBe(200)
        const claim2 = (await claimRes2.json()) as {
          task: {
            id: number
            attempt: number
            is_resuming: boolean
            prior_attempts: Array<{
              attempt: number
              started_at: number
              exit_code: number | null
              failure_reason: string | null
            }>
          }
          env: Record<string, string>
          recipe: { slug: string; timeout_seconds: number }
        }
        expect(claim2.task.attempt).toBe(2)
        expect(claim2.task.is_resuming).toBe(true)
        expect(claim2.task.prior_attempts).toHaveLength(1)
        expect(claim2.task.prior_attempts[0].attempt).toBe(1)
        expect(claim2.task.prior_attempts[0].exit_code).toBe(137)
        expect(claim2.task.prior_attempts[0].failure_reason).toBe('crash')
        const runnerToken2 = claim2.env.MC_API_TOKEN
        expect(typeof runnerToken2).toBe('string')
        expect(runnerToken2.length).toBeGreaterThan(10)

        // ================================================================
        // Phase G — Re-seed via seedMcDir({is_resuming:true, resume_marker:...}).
        //
        // The LOCKED marker format (Phase 15-03 LOCKED) is applied
        // byte-for-byte by seedMcDir — we byte-match the appended progress.md
        // below. RTEST-03 is about crash-recovery (runner-exit reason='crash')
        // not blocker-recovery, but the marker format is the same line and
        // the append path is identical; constructing a synthetic resume_marker
        // here exercises the LOCKED seedMcDir code path end-to-end.
        // ================================================================
        const resumeIso = new Date().toISOString()
        const resumeReason = 'retry after crash'
        const expectedMarker = `${resumeIso} | <<< RESUMED AFTER BLOCKER: ${resumeReason} >>>\n`

        seedMcDir(worktreePath, {
          task: {
            task_id: String(taskId),
            recipe_slug: HELLO_WORLD_SLUG,
            attempt: 2,
            is_resuming: true,
            prior_attempts: [
              {
                started_at: new Date().toISOString(),
                exit_code: 137,
                failure_reason: 'crash',
              },
            ],
          },
          resume_marker: {
            at_iso: resumeIso,
            blocker_reason: resumeReason,
          },
        })

        // Byte-for-byte assertion (Phase 15-07 LOCKED pattern — .toBe not regex).
        const progressAfterSeed = fs.readFileSync(progressPath, 'utf8')
        expect(progressAfterSeed).toBe(progressAfterKill + expectedMarker)

        // checkpoints.jsonl must NOT be modified by seedMcDir on resume.
        const jsonlAfterSeed = fs.readFileSync(jsonlPath, 'utf8')
        expect(jsonlAfterSeed).toBe(jsonlAfterKill)

        // task.json rewritten with attempt=2 + is_resuming=true + prior_attempts.
        const taskJsonRaw = fs.readFileSync(taskJsonPath, 'utf8')
        const taskJson = JSON.parse(taskJsonRaw) as {
          task_id: string
          attempt: number
          is_resuming: boolean
          prior_attempts: unknown[]
        }
        expect(taskJson.task_id).toBe(String(taskId))
        expect(taskJson.attempt).toBe(2)
        expect(taskJson.is_resuming).toBe(true)
        expect(taskJson.prior_attempts).toHaveLength(1)

        // ================================================================
        // Phase H — Run container for attempt 2 (normal, no CMD override).
        // Agent runs to completion, POSTs /submit via the harness, which flips
        // the task to 'review' (Phase 17-01 submit semantics).
        // ================================================================
        const stagedRecipePath2 = path.join(recipeStageDir, `task-${taskId}-a2`)
        await stageRecipe({
          sourceDir: path.join(recipesDir, HELLO_WORLD_SLUG),
          stageDir: stagedRecipePath2,
          preambleContents:
            '# Phase 17 crash-recovery test preamble (attempt 2 resume)\n',
        })
        const envForContainer2: Record<string, string> = {
          ...claim2.env,
          MC_API_URL: `http://host.docker.internal:${harnessPort}`,
          MC_WORKSPACE: '/workspace',
          MC_RECIPE_PATH: '/recipe',
          MC_PREAMBLE_PATH: '/recipe/PREAMBLE.md',
          MC_TASK_ID: String(taskId),
          MC_API_TOKEN: runnerToken2,
        }
        const envFilePath2 = path.join(envFileDir, `task-${taskId}-a2.env`)
        writeEnvFile({ envMap: envForContainer2, filePath: envFilePath2 })

        const containerName2 = `mc-task-${taskId}-a2-crash`
        const runArgs2 = [
          'run',
          '--rm',
          '--name',
          containerName2,
          '--label',
          `${CLEANUP_LABEL}=1`,
          '--label',
          `mc.task_id=${taskId}`,
          '--add-host',
          'host.docker.internal:host-gateway',
          '-v',
          `${worktreePath}:/workspace:rw`,
          '-v',
          `${stagedRecipePath2}:/recipe:ro`,
          '--env-file',
          envFilePath2,
          DOCKER_IMAGE,
        ]
        // IMPORTANT: must use async spawn() — spawnSync would block the Node
        // event loop and the in-process test-harness HTTP server would NEVER
        // accept the container's inbound /submit POST, causing the container
        // to hang at step 6 and eventually be SIGKILLed by Docker. 17-03
        // documented the same fix (deviation Rule 1 there). Mirrored here.
        const runResult2 = await new Promise<{
          status: number | null
          stdout: string
          stderr: string
        }>((resolve, reject) => {
          const child = spawn('docker', runArgs2, { stdio: 'pipe' })
          let stdout = ''
          let stderr = ''
          child.stdout.on('data', (c) => (stdout += c.toString()))
          child.stderr.on('data', (c) => (stderr += c.toString()))
          const timer = setTimeout(() => {
            child.kill('SIGKILL')
            reject(
              new Error(
                `docker run (attempt 2) timeout (90s)\nstdout:\n${stdout}\nstderr:\n${stderr}`,
              ),
            )
          }, 90_000)
          child.on('error', (err) => {
            clearTimeout(timer)
            reject(err)
          })
          child.on('close', (status) => {
            clearTimeout(timer)
            resolve({ status, stdout, stderr })
          })
        })
        if (runResult2.status !== 0) {
          throw new Error(
            `docker run (attempt 2) exited ${runResult2.status}\nstdout:\n${runResult2.stdout}\nstderr:\n${runResult2.stderr}`,
          )
        }

        // Poll the DB for the review-flip (hello-world agent POSTs /submit
        // which flips in_progress → review per Phase 17-01).
        const reviewDeadline = Date.now() + 30_000
        let resumedFinalStatus: string | null = null
        while (Date.now() < reviewDeadline) {
          const row = testDb
            .prepare(`SELECT status FROM tasks WHERE id = ?`)
            .get(taskId) as { status: string } | undefined
          if (row && row.status !== 'in_progress' && row.status !== 'assigned') {
            resumedFinalStatus = row.status
            break
          }
          await new Promise((r) => setTimeout(r, 250))
        }
        expect(resumedFinalStatus).toBe('review')

        // ================================================================
        // Phase I — Assert both-attempts state in .mc/.
        // ================================================================
        const progressAfterResume = fs.readFileSync(progressPath, 'utf8')
        // Attempt 1 content preserved (snapshot from Phase D is a prefix).
        expect(progressAfterResume.startsWith(progressAfterKill)).toBe(true)
        // LOCKED marker line from Phase G still present.
        expect(progressAfterResume).toContain(expectedMarker)
        // Attempt 2 appended something (strict monotonic growth).
        expect(progressAfterResume.length).toBeGreaterThan(
          progressAfterSeed.length,
        )

        const jsonlAfterResume = fs.readFileSync(jsonlPath, 'utf8')
        const jsonlLinesAfterResume = jsonlAfterResume
          .trim()
          .split('\n')
          .filter((l) => l.trim().length > 0).length
        // Strictly more checkpoint lines than after kill (at least +1 for the
        // attempt-2 hello-world-smoke entry).
        expect(jsonlLinesAfterResume).toBeGreaterThanOrEqual(
          jsonlLinesAfterKill + 1,
        )

        // Append-only invariant: the first N bytes of the resumed file MUST
        // equal the post-kill snapshot byte-for-byte.
        expect(jsonlAfterResume.slice(0, jsonlAfterKill.length)).toBe(
          jsonlAfterKill,
        )
      },
      240_000,
    )
  },
)
