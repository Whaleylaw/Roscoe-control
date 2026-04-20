/**
 * POST /api/tasks/:id/checkpoints — blocker-branch tests (Plan 15-05 Task 1).
 *
 * Complements the Plan 15-04 test file (./route.test.ts) which covers the
 * non-blocker POST + GET paths. This file focuses on the atomic blocker
 * state machine:
 *   - status='blocked' flips tasks.status='in_progress' → 'awaiting_owner'
 *   - A system-authored comment INSERT lands in the SAME transaction
 *   - `task.status_changed` broadcast fires BEFORE `task.checkpoint_added`
 *   - The transaction rolls back when the tasks UPDATE or comment INSERT
 *     raises (simulated via race condition or injected throw)
 *   - Non-blocker statuses leave the tasks row and comments table untouched
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

const { POST } = await import('../route')

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
  } = {},
): void {
  const status = opts.status ?? 'in_progress'
  const worktreePath = opts.worktree_path ?? null
  const attempts = opts.runner_attempts ?? 1
  const workspace_id = opts.workspace_id ?? 1
  db.prepare(
    `INSERT INTO tasks
       (id, title, status, priority, workspace_id, worktree_path, runner_attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `task ${id}`, status, 'medium', workspace_id, worktreePath, attempts)
}

function buildReq(
  taskId: number,
  bearer: string | null,
  body: unknown,
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const url = `http://localhost/api/tasks/${taskId}/checkpoints`
  const reqBody =
    body !== undefined
      ? typeof body === 'string'
        ? (body as string)
        : JSON.stringify(body)
      : undefined
  return new NextRequest(url, { method: 'POST', headers, body: reqBody })
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

function getTaskStatus(taskId: number): string {
  return (
    testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(taskId) as {
      status: string
    }
  ).status
}

function countComments(taskId: number): number {
  return (
    testDb
      .prepare(`SELECT COUNT(*) AS n FROM comments WHERE task_id = ?`)
      .get(taskId) as { n: number }
  ).n
}

function countCheckpoints(taskId: number): number {
  return (
    testDb
      .prepare(`SELECT COUNT(*) AS n FROM task_checkpoints WHERE task_id = ?`)
      .get(taskId) as { n: number }
  ).n
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  seedWorkspace(testDb, 1)
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoints-blocker-test-'))
  seedTask(testDb, 42, { worktree_path: worktreeRoot, runner_attempts: 2 })
  process.env.API_KEY = 'test-admin-api-key-aaaaaaaaaaaaaaaaaaa'
  process.env.MC_PROXY_AUTH_HEADER = ''
  broadcastMock.mockReset()
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

describe('POST /api/tasks/:id/checkpoints — blocker branch (Plan 15-05)', () => {
  it('status=blocked → 201; tasks flips to awaiting_owner; system comment inserted; broadcasts task.status_changed + task.checkpoint_added with blocker_reason', async () => {
    const { token } = issueRunnerToken(testDb, 42, 2, 300)
    const res = await callPost(42, token, {
      step: 'wait-for-input',
      summary: 'cannot proceed without the API key',
      status: 'blocked',
      blocker_reason: 'Missing ANTHROPIC_API_KEY in environment',
    })
    expect(res.status).toBe(201)

    // Task status flipped atomically.
    expect(getTaskStatus(42)).toBe('awaiting_owner')

    // Task row carries the blocker reason marker.
    const row = testDb
      .prepare(`SELECT runner_last_failure_reason FROM tasks WHERE id = 42`)
      .get() as { runner_last_failure_reason: string | null }
    expect(row.runner_last_failure_reason).toContain('blocked:')
    expect(row.runner_last_failure_reason).toContain(
      'Missing ANTHROPIC_API_KEY',
    )

    // Checkpoint row persisted.
    expect(countCheckpoints(42)).toBe(1)
    const cp = testDb
      .prepare(
        `SELECT status, blocker_reason FROM task_checkpoints WHERE task_id = 42`,
      )
      .get() as { status: string; blocker_reason: string | null }
    expect(cp.status).toBe('blocked')
    expect(cp.blocker_reason).toBe('Missing ANTHROPIC_API_KEY in environment')

    // System comment inserted in the SAME transaction.
    const comments = testDb
      .prepare(
        `SELECT author, content FROM comments WHERE task_id = 42 ORDER BY id ASC`,
      )
      .all() as Array<{ author: string; content: string }>
    expect(comments).toHaveLength(1)
    expect(comments[0].author).toBe('system')
    expect(comments[0].content).toContain('Missing ANTHROPIC_API_KEY')
    expect(comments[0].content).toContain('attempt 2')

    // JSONL line written to the worktree.
    const jsonlPath = path.join(worktreeRoot, '.mc', 'checkpoints.jsonl')
    expect(fs.existsSync(jsonlPath)).toBe(true)
    const line = JSON.parse(fs.readFileSync(jsonlPath, 'utf8').trim())
    expect(line.blocker_reason).toBe('Missing ANTHROPIC_API_KEY in environment')

    // Two broadcasts: task.status_changed (first) + task.checkpoint_added.
    expect(broadcastMock).toHaveBeenCalledTimes(2)
    const [statusChangedType, statusChangedPayload] = broadcastMock.mock.calls[0]
    expect(statusChangedType).toBe('task.status_changed')
    expect(statusChangedPayload).toMatchObject({
      id: 42,
      status: 'awaiting_owner',
      previous_status: 'in_progress',
      reason: 'blocked_checkpoint',
      workspace_id: 1,
    })
    const [checkpointType, checkpointPayload] = broadcastMock.mock.calls[1]
    expect(checkpointType).toBe('task.checkpoint_added')
    expect(checkpointPayload).toMatchObject({
      task_id: 42,
      attempt: 2,
      status: 'blocked',
      blocker_reason: 'Missing ANTHROPIC_API_KEY in environment',
      workspace_id: 1,
    })
  })

  it('status=blocked but task status is not in_progress (race) → 409; tasks + comments + checkpoint all unchanged; JSONL back to pre-call size', async () => {
    // Seed a task already in `awaiting_owner` — the guard at the route level
    // (task.status !== 'in_progress' → 409) fires BEFORE the transaction. The
    // checkpoint INSERT never happens; comments stay empty; no broadcast.
    seedTask(testDb, 99, {
      status: 'awaiting_owner',
      worktree_path: worktreeRoot,
      runner_attempts: 1,
    })
    const { token } = issueRunnerToken(testDb, 99, 1, 300)

    const jsonlPath = path.join(worktreeRoot, '.mc', 'checkpoints.jsonl')
    const sizeBefore = fs.existsSync(jsonlPath) ? fs.statSync(jsonlPath).size : 0

    const res = await callPost(99, token, {
      step: 'halt',
      summary: 'second blocker',
      status: 'blocked',
      blocker_reason: 'network unreachable',
    })
    expect(res.status).toBe(409)

    // Task row unchanged.
    expect(getTaskStatus(99)).toBe('awaiting_owner')
    // No checkpoint inserted.
    expect(countCheckpoints(99)).toBe(0)
    // No comment inserted.
    expect(countComments(99)).toBe(0)
    // JSONL file size unchanged.
    const sizeAfter = fs.existsSync(jsonlPath) ? fs.statSync(jsonlPath).size : 0
    expect(sizeAfter).toBe(sizeBefore)
    // No broadcasts fired.
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('status=blocked but onInsert throws (simulated via DB corruption on comments INSERT) → 500; transaction rolls back; tasks untouched; JSONL truncated', async () => {
    const { token } = issueRunnerToken(testDb, 42, 2, 300)

    const jsonlPath = path.join(worktreeRoot, '.mc', 'checkpoints.jsonl')
    const sizeBefore = fs.existsSync(jsonlPath) ? fs.statSync(jsonlPath).size : 0

    // Break the comments INSERT by dropping the `author` column's NOT NULL
    // guarantee via a schema change that makes subsequent inserts fail. We
    // drop the comments table entirely so the INSERT raises — the whole
    // transaction must roll back: no checkpoint row, no status flip, no
    // broadcast.
    testDb.exec(`DROP TABLE comments`)

    const res = await callPost(42, token, {
      step: 'halt',
      summary: 'third blocker',
      status: 'blocked',
      blocker_reason: 'database corrupted',
    })
    expect(res.status).toBe(500)

    // Task row still in_progress — blocker flip rolled back.
    expect(getTaskStatus(42)).toBe('in_progress')
    // No checkpoint persisted.
    expect(countCheckpoints(42)).toBe(0)
    // JSONL truncated back (or never grew past pre-call size).
    const sizeAfter = fs.existsSync(jsonlPath) ? fs.statSync(jsonlPath).size : 0
    expect(sizeAfter).toBe(sizeBefore)
    // No broadcasts fired on rollback.
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('status=completed (non-blocker) → 201; tasks row UNCHANGED; comments UNCHANGED; single task.checkpoint_added broadcast without blocker_reason; no task.status_changed', async () => {
    const { token } = issueRunnerToken(testDb, 42, 2, 300)
    const res = await callPost(42, token, {
      step: 'finish',
      summary: 'wrote output',
      status: 'completed',
    })
    expect(res.status).toBe(201)

    // Task status unchanged.
    expect(getTaskStatus(42)).toBe('in_progress')
    // No comments added.
    expect(countComments(42)).toBe(0)
    // Checkpoint inserted.
    expect(countCheckpoints(42)).toBe(1)

    // Exactly one broadcast — task.checkpoint_added — with NO blocker_reason.
    expect(broadcastMock).toHaveBeenCalledTimes(1)
    const [type, payload] = broadcastMock.mock.calls[0]
    expect(type).toBe('task.checkpoint_added')
    expect(payload).not.toHaveProperty('blocker_reason')
    expect(payload.status).toBe('completed')
  })

  it('status=in_progress (progress update) → 201; no state transitions; single broadcast; no task.status_changed', async () => {
    const { token } = issueRunnerToken(testDb, 42, 2, 300)
    const res = await callPost(42, token, {
      step: 'halfway',
      summary: 'still going',
      status: 'in_progress',
    })
    expect(res.status).toBe(201)

    expect(getTaskStatus(42)).toBe('in_progress')
    expect(countComments(42)).toBe(0)

    expect(broadcastMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock.mock.calls[0][0]).toBe('task.checkpoint_added')
  })

  it('two sequential blocker POSTs → first flips to awaiting_owner + second returns 409 (task.status guard); only ONE comment inserted across both calls', async () => {
    // First blocker: 201, flip to awaiting_owner.
    const first = issueRunnerToken(testDb, 42, 2, 300)
    const res1 = await callPost(42, first.token, {
      step: 'halt',
      summary: 'first blocker',
      status: 'blocked',
      blocker_reason: 'API key missing',
    })
    expect(res1.status).toBe(201)
    expect(getTaskStatus(42)).toBe('awaiting_owner')
    expect(countComments(42)).toBe(1)

    // Reset broadcast mock so we can isolate the second call's emissions.
    broadcastMock.mockReset()

    // Second blocker: task is now awaiting_owner so the route-level
    // task.status !== 'in_progress' guard returns 409 BEFORE the atomic
    // transaction runs. No additional comment; no checkpoint row.
    const second = issueRunnerToken(testDb, 42, 2, 300)
    const res2 = await callPost(42, second.token, {
      step: 'halt-again',
      summary: 'second blocker',
      status: 'blocked',
      blocker_reason: 'also missing secret',
    })
    expect(res2.status).toBe(409)
    expect(getTaskStatus(42)).toBe('awaiting_owner')
    expect(countComments(42)).toBe(1)
    expect(countCheckpoints(42)).toBe(1)
    expect(broadcastMock).not.toHaveBeenCalled()
  })
})
