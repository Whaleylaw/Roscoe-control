/**
 * POST + GET /api/tasks/:id/checkpoints — Plan 15-04 Task 2.
 *
 * POST (runner authenticated):
 *   - runner-token principal (id=-2000) scoped to the path :id → 201 happy path
 *   - runner-secret principal (id=-1000) → 201 for daemon-side preflight blockers
 *   - non-runner-token principal (e.g. API-key admin) → 403
 *   - cross-task runner-token → 401 (auth.ts refuses to issue the principal)
 *     OR 403 if we simulate the defense-in-depth gate firing (hard to hit
 *     through real auth since auth.ts already rejects; documented below).
 *   - invalid task id in path → 400
 *   - task not found → 404
 *   - task status != in_progress → 409
 *   - malformed JSON body → 400
 *   - Zod schema failure → 400 + issues array
 *   - blocker without blocker_reason → 400 (Zod refine)
 *   - blocker with blocker_reason → 201; DB + JSONL persist it;
 *     eventBus broadcast includes blocker_reason
 *   - artifact kind='file' with path → 201
 *   - artifact kind='unknown' → 400
 *   - JSONL append failure → 500; rollback leaves DB + JSONL in pre-call state
 *   - task.worktree_path = NULL → 201; no fs operation attempted
 *   - rate limiter blocks → short-circuits with limiter response
 *
 * GET (viewer authenticated):
 *   - same-workspace viewer, no filter → 200 with ordered array
 *   - ?attempt=1 filter → 200 with filtered array
 *   - cross-workspace viewer → 404 (masquerade)
 *   - task not found → 404
 *   - ?attempt=abc / negative → 400
 *   - no checkpoints → 200 { checkpoints: [] }
 */

import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { issueRunnerToken } from '@/lib/runner-tokens'

let testDb: Database.Database
let worktreeRoot: string

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
  getRunnerSecret: () => 'known-runner-secret-test-value-abc-1234567890',
  ensureRunnerSecret: vi.fn(() => 'known-runner-secret-test-value-abc-1234567890'),
  RUNNER_SECRET_FILENAME: '.data/runner.secret',
}))

vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: vi.fn(),
}))

// Rate limiter default: pass-through. Individual tests override per-request.
let rateLimiterReturn: ReturnType<typeof vi.fn> = vi.fn(() => null)
vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: (req: Request) => rateLimiterReturn(req),
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: (...args: unknown[]) => broadcastMock(...args), on: vi.fn(), emit: vi.fn() },
}))

const { POST, GET } = await import('../route')

function seedWorkspace(db: Database.Database, id = 1): void {
  const existing = db.prepare(`SELECT id FROM workspaces WHERE id = ?`).get(id) as
    | { id?: number }
    | undefined
  if (!existing) {
    db.prepare(
      `INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (?, ?, ?, ?)`,
    ).run(id, `ws-${id}`, `Workspace ${id}`, 1)
  }
}

function seedTask(
  db: Database.Database,
  id: number,
  opts: {
    status?: string
    worktree_path?: string | null
    runner_attempts?: number
    workspace_id?: number
    recipe_slug?: string | null
  } = {},
): void {
  const status = opts.status ?? 'in_progress'
  const worktreePath = opts.worktree_path ?? null
  const attempts = opts.runner_attempts ?? 1
  const workspace_id = opts.workspace_id ?? 1
  const recipeSlug = opts.recipe_slug ?? null
  db.prepare(
    `INSERT INTO tasks
       (id, title, status, priority, workspace_id, worktree_path, runner_attempts, recipe_slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `task ${id}`, status, 'medium', workspace_id, worktreePath, attempts, recipeSlug)
}

function buildReq(
  taskId: number,
  bearer: string | null,
  body: unknown,
  { method = 'POST', query = '' }: { method?: string; query?: string } = {},
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const url = `http://localhost/api/tasks/${taskId}/checkpoints${query}`
  const reqBody =
    body !== undefined && method !== 'GET'
      ? typeof body === 'string'
        ? (body as string)
        : JSON.stringify(body)
      : undefined
  return new NextRequest(url, { method, headers, body: reqBody })
}

async function callPost(
  taskId: number,
  bearer: string | null,
  body: unknown,
): Promise<Response> {
  return POST(buildReq(taskId, bearer, body), {
    params: Promise.resolve({ id: String(taskId) }),
  })
}

async function callGet(
  taskId: number,
  bearer: string | null,
  query: string = '',
): Promise<Response> {
  return GET(
    buildReq(taskId, bearer, undefined, { method: 'GET', query }),
    { params: Promise.resolve({ id: String(taskId) }) },
  )
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  seedWorkspace(testDb, 1)
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoints-route-test-'))
  seedTask(testDb, 42, { worktree_path: worktreeRoot, runner_attempts: 1 })
  process.env.API_KEY = 'test-admin-api-key-aaaaaaaaaaaaaaaaaaa'
  process.env.MC_PROXY_AUTH_HEADER = ''
  broadcastMock.mockReset()
  rateLimiterReturn = vi.fn(() => null)
})

afterEach(() => {
  testDb.close()
  try {
    fs.rmSync(worktreeRoot, { recursive: true, force: true })
  } catch {
    // non-fatal
  }
  vi.restoreAllMocks()
})

// ---------- POST tests ----------

describe('POST /api/tasks/:id/checkpoints', () => {
  it('happy path: runner-token → 201, DB row, JSONL line, broadcast fires', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await callPost(42, token, {
      step: 'init',
      summary: 'started',
      status: 'completed',
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeGreaterThan(0)
    expect(body.attempt).toBe(1)
    expect(body.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // DB row
    const row = testDb
      .prepare(`SELECT * FROM task_checkpoints WHERE task_id = 42`)
      .get() as { step: string; status: string; attempt: number }
    expect(row.step).toBe('init')
    expect(row.status).toBe('completed')
    expect(row.attempt).toBe(1)

    // JSONL
    const jsonlPath = path.join(worktreeRoot, '.mc', 'checkpoints.jsonl')
    expect(fs.existsSync(jsonlPath)).toBe(true)
    const line = JSON.parse(fs.readFileSync(jsonlPath, 'utf8').trim())
    expect(line.task_id).toBe(42)
    expect(line.step).toBe('init')

    // Broadcast
    expect(broadcastMock).toHaveBeenCalledTimes(1)
    const [eventType, payload] = broadcastMock.mock.calls[0]
    expect(eventType).toBe('task.checkpoint_added')
    expect(payload.checkpoint_id).toBe(body.id)
    expect(payload.task_id).toBe(42)
    expect(payload.attempt).toBe(1)
    expect(payload.status).toBe('completed')
    expect(payload.step).toBe('init')
    expect(payload.workspace_id).toBe(1)
  })

  it('happy path: runner-secret daemon principal → 201 for preflight checkpoint', async () => {
    const res = await callPost(42, 'known-runner-secret-test-value-abc-1234567890', {
      step: 'runner-secret-preflight',
      summary: 'missing secret',
      status: 'blocked',
      blocker_reason: 'OPENROUTER_API_KEY is missing',
    })
    expect(res.status).toBe(201)
    const row = testDb
      .prepare(`SELECT step, status, blocker_reason FROM task_checkpoints WHERE task_id = 42`)
      .get() as { step: string; status: string; blocker_reason: string }
    expect(row.step).toBe('runner-secret-preflight')
    expect(row.status).toBe('blocked')
    expect(row.blocker_reason).toBe('OPENROUTER_API_KEY is missing')
  })

  it('non-runner-token principal (admin API key, id=0) → 403', async () => {
    const res = await callPost(42, 'test-admin-api-key-aaaaaaaaaaaaaaaaaaa', {
      step: 'init',
      summary: 's',
      status: 'completed',
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('runner principal required')
  })

  it('cross-task runner-token (token for task A, path task B) → 401 (auth layer rejects)', async () => {
    seedTask(testDb, 99, { worktree_path: worktreeRoot })
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    // The auth.ts gate only issues a runner-token principal when
    // verified.task_id === path :id. Mismatch falls through to session/api-key
    // branches, and with no valid cookie/apikey we end up at 401.
    const res = await callPost(99, token, {
      step: 'x',
      summary: 'x',
      status: 'completed',
    })
    expect(res.status).toBe(401)
  })

  it('invalid task ID in path (e.g. 0) → 4xx (auth rejects cross-task)', async () => {
    // Path task_id=0 but runner-token was issued for task 42. The auth.ts
    // layer's verifyRunnerToken(token).task_id=42 !== pathTaskId=0 branch
    // falls through to session/api-key auth, which fails → 401. If we ever
    // flip the allowlist regex to reject zero, the 400 branch would fire.
    // Either outcome is acceptable for "invalid task id rejected before
    // touching the handler" behaviour.
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await callPost(0, token, {
      step: 'x',
      summary: 'x',
      status: 'completed',
    })
    expect([400, 401, 403]).toContain(res.status)
  })

  it('no bearer → 401', async () => {
    const res = await callPost(42, null, {
      step: 'x',
      summary: 'x',
      status: 'completed',
    })
    expect(res.status).toBe(401)
  })

  it('task not found → 404', async () => {
    // Seed task 9999 so we can issue a runner-token for it (FK requires
    // tasks row), then delete the task so the POST handler's SELECT returns
    // undefined. The token row still exists and is unrevoked, so auth.ts
    // resolves the runner-token principal and the handler's SELECT hits the
    // 404 branch.
    seedTask(testDb, 9999, { worktree_path: worktreeRoot })
    const { token } = issueRunnerToken(testDb, 9999, 1, 300)
    testDb.prepare(`DELETE FROM tasks WHERE id = 9999`).run()
    // Re-issue the token row directly, since the DELETE CASCADE will have
    // nuked task_runner_tokens rows for 9999. But we cannot re-issue without
    // the task FK — so instead we seed a fresh task row and re-delete just
    // the parent row surreptitiously? Simpler: disable FK enforcement, then
    // delete only the tasks row so the token row remains.
    testDb.pragma('foreign_keys = OFF')
    seedTask(testDb, 9999, { worktree_path: worktreeRoot })
    const { token: token2 } = issueRunnerToken(testDb, 9999, 2, 300)
    testDb.prepare(`DELETE FROM tasks WHERE id = 9999`).run()
    testDb.pragma('foreign_keys = ON')

    const res = await callPost(9999, token2, {
      step: 'x',
      summary: 'x',
      status: 'completed',
    })
    expect(res.status).toBe(404)
    void token
  })

  it('task status != in_progress (e.g. done) → 409', async () => {
    testDb
      .prepare(`UPDATE tasks SET status = 'done' WHERE id = 42`)
      .run()
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await callPost(42, token, {
      step: 'x',
      summary: 'x',
      status: 'completed',
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('in_progress')
    expect(body.error).toContain('done')
  })

  it('malformed JSON body → 400', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await callPost(42, token, '{not-json')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not valid JSON/i)
  })

  it('Zod validation failure (empty step) → 400 with issues array', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await callPost(42, token, {
      step: '',
      summary: 'x',
      status: 'completed',
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid checkpoint body')
    expect(Array.isArray(body.issues)).toBe(true)
    expect(body.issues.length).toBeGreaterThan(0)
  })

  it('status=blocked without blocker_reason → 400 (Zod refine)', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await callPost(42, token, {
      step: 'halt',
      summary: 's',
      status: 'blocked',
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(JSON.stringify(body.issues)).toContain('blocker_reason')
  })

  it('status=blocked with blocker_reason → 201; DB + JSONL + broadcast include blocker_reason', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await callPost(42, token, {
      step: 'halt',
      summary: 'blocked',
      status: 'blocked',
      blocker_reason: 'missing API key',
    })
    expect(res.status).toBe(201)

    const row = testDb
      .prepare(`SELECT blocker_reason, status FROM task_checkpoints WHERE task_id = 42`)
      .get() as { blocker_reason: string | null; status: string }
    expect(row.status).toBe('blocked')
    expect(row.blocker_reason).toBe('missing API key')

    const jsonlPath = path.join(worktreeRoot, '.mc', 'checkpoints.jsonl')
    const line = JSON.parse(fs.readFileSync(jsonlPath, 'utf8').trim())
    expect(line.blocker_reason).toBe('missing API key')

    // Plan 15-05 wires a pre-checkpoint `task.status_changed` broadcast on
    // the blocker path — find the task.checkpoint_added frame by type.
    const checkpointCall = broadcastMock.mock.calls.find(
      ([type]) => type === 'task.checkpoint_added',
    )
    expect(checkpointCall).toBeDefined()
    const [, payload] = checkpointCall!
    expect(payload.status).toBe('blocked')
    expect(payload.blocker_reason).toBe('missing API key')
  })

  it('status=blocked on a recipe task moves the task to review for user handoff', async () => {
    seedTask(testDb, 77, {
      worktree_path: worktreeRoot,
      runner_attempts: 1,
      recipe_slug: 'firmvault-pip-confirm-approval',
    })
    const { token } = issueRunnerToken(testDb, 77, 1, 300)
    const res = await callPost(77, token, {
      step: 'needs-confirmation',
      summary: 'found claim information but needs human confirmation',
      status: 'blocked',
      blocker_reason: 'Carrier and claim number found; human confirmation needed before marking PIP approved.',
    })
    expect(res.status).toBe(201)

    const task = testDb
      .prepare(`SELECT status, runner_last_failure_reason FROM tasks WHERE id = 77`)
      .get() as { status: string; runner_last_failure_reason: string | null }
    expect(task.status).toBe('review')
    expect(task.runner_last_failure_reason).toContain('blocked:Carrier and claim number found')

    const statusCall = broadcastMock.mock.calls.find(
      ([type]) => type === 'task.status_changed',
    )
    expect(statusCall).toBeDefined()
    expect(statusCall![1]).toMatchObject({
      task_id: 77,
      status: 'review',
      previous_status: 'in_progress',
      reason: 'blocked_checkpoint',
    })
  })

  it('artifact kind=file with path → 201; JSONL contains the artifact', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await callPost(42, token, {
      step: 'touch',
      summary: 'wrote file',
      status: 'completed',
      artifacts: [{ kind: 'file', path: 'hello.txt' }],
    })
    expect(res.status).toBe(201)
    const jsonlPath = path.join(worktreeRoot, '.mc', 'checkpoints.jsonl')
    const line = JSON.parse(fs.readFileSync(jsonlPath, 'utf8').trim())
    expect(line.artifacts).toEqual([{ kind: 'file', path: 'hello.txt' }])
  })

  it('artifact kind=unknown → 400 (discriminator error)', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await callPost(42, token, {
      step: 'x',
      summary: 'x',
      status: 'completed',
      artifacts: [{ kind: 'mystery', foo: 'bar' }],
    })
    expect(res.status).toBe(400)
  })

  it('atomic rollback: JSONL appendFileSync throw → 500; DB empty; JSONL back to pre-call size', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('ENOSPC simulated')
    })

    const res = await callPost(42, token, {
      step: 'x',
      summary: 'x',
      status: 'completed',
    })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/persist checkpoint/i)

    spy.mockRestore()

    // DB empty
    const count = (
      testDb
        .prepare(`SELECT COUNT(*) AS n FROM task_checkpoints WHERE task_id = 42`)
        .get() as { n: number }
    ).n
    expect(count).toBe(0)

    // JSONL did not grow (file may not exist at all — appendFileSync threw
    // before it could create it; either way size stays 0).
    const jsonlPath = path.join(worktreeRoot, '.mc', 'checkpoints.jsonl')
    const size = fs.existsSync(jsonlPath) ? fs.statSync(jsonlPath).size : 0
    expect(size).toBe(0)

    // Broadcast must NOT fire on rollback.
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('task.worktree_path=NULL → 201; no fs write attempted', async () => {
    seedTask(testDb, 84, { worktree_path: null, runner_attempts: 1 })
    const { token } = issueRunnerToken(testDb, 84, 1, 300)

    const mkdir = vi.spyOn(fs, 'mkdirSync')
    const append = vi.spyOn(fs, 'appendFileSync')

    const res = await callPost(84, token, {
      step: 'no-worktree',
      summary: 's',
      status: 'completed',
    })
    expect(res.status).toBe(201)

    expect(mkdir).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()

    const row = testDb
      .prepare(`SELECT id FROM task_checkpoints WHERE task_id = 84`)
      .get()
    expect(row).toBeTruthy()
  })

  it('rate limiter blocks → short-circuits with limiter response', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const { NextResponse } = await import('next/server')
    rateLimiterReturn = vi.fn(() =>
      NextResponse.json({ error: 'Too many requests' }, { status: 429 }),
    )

    const res = await callPost(42, token, {
      step: 'x',
      summary: 'x',
      status: 'completed',
    })
    expect(res.status).toBe(429)

    const count = (
      testDb
        .prepare(`SELECT COUNT(*) AS n FROM task_checkpoints WHERE task_id = 42`)
        .get() as { n: number }
    ).n
    expect(count).toBe(0)
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('broadcast fires AFTER DB commit — can observe committed row in the same tick', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)

    let committedCountAtBroadcast: number | null = null
    broadcastMock.mockImplementation(() => {
      committedCountAtBroadcast = (
        testDb
          .prepare(`SELECT COUNT(*) AS n FROM task_checkpoints WHERE task_id = 42`)
          .get() as { n: number }
      ).n
    })

    const res = await callPost(42, token, {
      step: 'x',
      summary: 'x',
      status: 'in_progress',
    })
    expect(res.status).toBe(201)
    expect(committedCountAtBroadcast).toBe(1)
  })
})

// ---------- GET tests ----------

describe('GET /api/tasks/:id/checkpoints', () => {
  beforeEach(() => {
    // Seed a few checkpoints in varying attempts
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    // Use the route to plant rows so the worktree JSONL exists + DB is realistic.
    // (Direct INSERTs would skip the JSONL but that's fine for GET testing —
    // we only need DB rows, and readCheckpoints only reads DB.)
    testDb.prepare(
      `INSERT INTO task_checkpoints (task_id, attempt, step, summary, status, artifacts_json, created_at)
       VALUES (42, 1, 'a1-first', 's', 'completed', '[]', 1000),
              (42, 1, 'a1-second', 's', 'in_progress', '[]', 1001),
              (42, 2, 'a2-first', 's', 'completed', '[]', 1002)`,
    ).run()
    void token
  })

  it('viewer in same workspace, no filter → 200, ordered by (attempt ASC, id ASC)', async () => {
    const res = await callGet(42, 'test-admin-api-key-aaaaaaaaaaaaaaaaaaa')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checkpoints.map((c: { step: string }) => c.step)).toEqual([
      'a1-first',
      'a1-second',
      'a2-first',
    ])
  })

  it('?attempt=1 filter → 200, only attempt=1 rows', async () => {
    const res = await callGet(42, 'test-admin-api-key-aaaaaaaaaaaaaaaaaaa', '?attempt=1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checkpoints).toHaveLength(2)
    expect(body.checkpoints.every((c: { attempt: number }) => c.attempt === 1)).toBe(true)
  })

  it('?attempt=abc → 400', async () => {
    const res = await callGet(42, 'test-admin-api-key-aaaaaaaaaaaaaaaaaaa', '?attempt=abc')
    expect(res.status).toBe(400)
  })

  it('?attempt=-5 → 400', async () => {
    const res = await callGet(42, 'test-admin-api-key-aaaaaaaaaaaaaaaaaaa', '?attempt=-5')
    expect(res.status).toBe(400)
  })

  it('cross-workspace viewer → 404 (masquerade)', async () => {
    // Seed a second workspace and put task 77 in it.
    seedWorkspace(testDb, 2)
    seedTask(testDb, 77, { workspace_id: 2 })

    // Admin API-key principal lives in workspace 1 by default (getDefaultWorkspaceContext).
    const res = await callGet(77, 'test-admin-api-key-aaaaaaaaaaaaaaaaaaa')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Task not found')
  })

  it('task not found → 404', async () => {
    const res = await callGet(9999, 'test-admin-api-key-aaaaaaaaaaaaaaaaaaa')
    expect(res.status).toBe(404)
  })

  it('no checkpoints for a task → 200 { checkpoints: [] }', async () => {
    seedTask(testDb, 55)
    const res = await callGet(55, 'test-admin-api-key-aaaaaaaaaaaaaaaaaaa')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checkpoints).toEqual([])
  })

  it('unauthenticated → 401', async () => {
    const res = await callGet(42, null)
    expect(res.status).toBe(401)
  })
})
