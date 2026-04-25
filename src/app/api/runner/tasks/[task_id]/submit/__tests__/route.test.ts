// @vitest-environment node
/**
 * POST /api/runner/tasks/:task_id/submit — Phase 17 Plan 17-01 Task 2.
 *
 * Covers the D-01 scope expansion: submit route now flips
 * `in_progress → review` (NOT directly to `done`). The existing
 * runAegisReviews() scheduler owns the final hop. Tests enforce the
 * must_have truths in 17-01-PLAN.md:
 *
 *   1. flips status in_progress → review on successful submit
 *   2. revokes the runner-token atomically with the review flip
 *   3. broadcasts task.status_changed with previous_status=in_progress,
 *      status=review
 *   4. rejects with 403 when token taskId does not match path taskId
 *   5. returns 409 idempotently when task is already in review
 *   6. returns 409 when task is already done
 *
 * Pattern: Phase 15-07 LOCKED boundary-mock (vi.mock db/runner-secret/
 * event-bus/rate-limit/security-events + import handler AFTER mocks).
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'

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
  getRunnerSecret: () => 'test-runner-secret-abcdefghijklmnop',
  ensureRunnerSecret: vi.fn(() => 'test-runner-secret-abcdefghijklmnop'),
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

// Import handler + token helper AFTER mocks so module bindings point at mocks.
const { POST } = await import('../route')
const { issueRunnerToken } = await import('@/lib/runner-tokens')

function seedWorkspace(db: Database.Database): void {
  const existing = db
    .prepare(`SELECT id FROM workspaces WHERE id = ?`)
    .get(1) as { id?: number } | undefined
  if (!existing) {
    db.prepare(
      `INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (?, ?, ?, ?)`,
    ).run(1, 'default', 'Default', 1)
  }
}

function seedTask(
  db: Database.Database,
  id: number,
  status = 'in_progress',
  opts: { container_id?: string | null; recipe_slug?: string | null } = {},
): void {
  db.prepare(
    `INSERT INTO tasks (id, title, status, priority, workspace_id, container_id, recipe_slug)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `task ${id}`,
    status,
    'medium',
    1,
    opts.container_id ?? 'test-container-1',
    opts.recipe_slug ?? 'hello-world',
  )
}

function submitReq(taskId: number, bearer: string | null, body: unknown): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  return new NextRequest(`http://localhost/api/runner/tasks/${taskId}/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function submit(taskId: number, bearer: string | null, body: unknown) {
  return POST(submitReq(taskId, bearer, body), {
    params: Promise.resolve({ task_id: String(taskId) }),
  })
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  seedWorkspace(testDb)
  broadcastMock.mockReset()
  process.env.API_KEY = ''
  process.env.MC_PROXY_AUTH_HEADER = ''
})

afterEach(() => {
  testDb.close()
})

describe('POST /api/runner/tasks/:task_id/submit — Phase 17 D-01 review gate', () => {
  it('flips status in_progress → review on successful submit', async () => {
    seedTask(testDb, 5, 'in_progress')
    const { token } = issueRunnerToken(testDb, 5, 1, 300)

    const res = await submit(5, token, { status: 'done' })
    expect(res.status).toBe(204)

    const row = testDb
      .prepare(
        `SELECT status, container_id, completed_at FROM tasks WHERE id = 5`,
      )
      .get() as {
      status: string
      container_id: string | null
      completed_at: number | null
    }
    expect(row.status).toBe('review')
    expect(row.container_id).toBeNull()
    // completed_at MUST NOT be set on the review flip; Aegis sets it on the
    // final done flip (if/when a dedicated column is added).
    expect(row.completed_at).toBeNull()
  })

  it('revokes the runner-token atomically with the review flip', async () => {
    seedTask(testDb, 5, 'in_progress')
    const nowAtStart = Math.floor(Date.now() / 1000)
    const { token } = issueRunnerToken(testDb, 5, 1, 300)

    const res = await submit(5, token, { status: 'done' })
    expect(res.status).toBe(204)

    const tokenRow = testDb
      .prepare(
        `SELECT revoked_at FROM task_runner_tokens WHERE task_id = ?`,
      )
      .get(5) as { revoked_at: number | null }

    expect(tokenRow.revoked_at).not.toBeNull()
    expect(tokenRow.revoked_at).toBeGreaterThan(0)
    // revoked_at should equal the nowUnix the route used (within 2s of test start).
    expect(tokenRow.revoked_at!).toBeGreaterThanOrEqual(nowAtStart - 1)
    expect(tokenRow.revoked_at!).toBeLessThanOrEqual(nowAtStart + 2)
  })

  it('broadcasts task.status_changed with previous_status=in_progress, status=review', async () => {
    seedTask(testDb, 5, 'in_progress')
    const { token } = issueRunnerToken(testDb, 5, 1, 300)

    const res = await submit(5, token, { status: 'done' })
    expect(res.status).toBe(204)

    // DB update happened before the broadcast assertion — verify cause (status
    // change) is committed before effect (broadcast) is observed.
    const statusBeforeBroadcastCheck = (
      testDb
        .prepare(`SELECT status FROM tasks WHERE id = 5`)
        .get() as { status: string }
    ).status
    expect(statusBeforeBroadcastCheck).toBe('review')

    expect(broadcastMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock.mock.calls[0][0]).toBe('task.status_changed')
    expect(broadcastMock.mock.calls[0][1]).toMatchObject({
      task_id: 5,
      status: 'review',
      previous_status: 'in_progress',
      workspace_id: 1,
      at: expect.any(Number),
    })
  })

  it('adds the runner resolution as a task comment when submitting for review', async () => {
    seedTask(testDb, 9, 'in_progress', { recipe_slug: 'firmvault-pip-confirm-approval' })
    const { token } = issueRunnerToken(testDb, 9, 1, 300)

    const res = await submit(9, token, {
      status: 'done',
      resolution: [
        'Confirmed the PIP claim is not approved yet.',
        'Reviewed case insurance notes and found missing carrier acknowledgement.',
        'No vault files were changed.',
      ].join('\n'),
    })
    expect(res.status).toBe(204)

    const comment = testDb
      .prepare(
        `SELECT task_id, author, content, workspace_id
           FROM comments
          WHERE task_id = ?
          ORDER BY id DESC
          LIMIT 1`,
      )
      .get(9) as {
      task_id: number
      author: string
      content: string
      workspace_id: number
    }

    expect(comment).toMatchObject({
      task_id: 9,
      author: 'recipe-runner',
      workspace_id: 1,
    })
    expect(comment.content).toContain('Confirmed the PIP claim is not approved yet.')
    expect(comment.content).toContain('No vault files were changed.')
  })

  it('rejects with 403 when token taskId does not match path taskId', async () => {
    seedTask(testDb, 5, 'in_progress')
    seedTask(testDb, 6, 'in_progress')
    // Mint token for task 5, but POST to /submit on task 6.
    const { token } = issueRunnerToken(testDb, 5, 1, 300)

    const res = await submit(6, token, { status: 'done' })
    // The auth layer's runner-token principal is only issued when the path
    // task_id matches the token's embedded task_id. A cross-task attempt
    // fails upstream (401) rather than reaching the route's in-route 403.
    // Either way the task is unchanged and no broadcast fired — which is
    // what RTEST-02 depends on.
    expect([401, 403]).toContain(res.status)

    const row6 = testDb
      .prepare(`SELECT status FROM tasks WHERE id = 6`)
      .get() as { status: string }
    expect(row6.status).toBe('in_progress')

    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('returns 409 idempotently when task is already in review', async () => {
    // Review-status tasks cannot be re-submitted — the runner's contract with
    // this task ended at the first successful submit. ALREADY_SETTLED enforces
    // this so a network-retry after a successful 204 doesn't double-broadcast.
    seedTask(testDb, 7, 'review')
    const { token } = issueRunnerToken(testDb, 7, 1, 300)

    const res = await submit(7, token, { status: 'done' })
    expect(res.status).toBe(409)

    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('returns 409 when task is already done', async () => {
    seedTask(testDb, 8, 'done')
    const { token } = issueRunnerToken(testDb, 8, 1, 300)

    const res = await submit(8, token, { status: 'done' })
    expect(res.status).toBe(409)

    expect(broadcastMock).not.toHaveBeenCalled()
  })
})
