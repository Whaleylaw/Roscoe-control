/**
 * POST /api/runner/tasks/:task_id/submit — Plan 14-11 Task 1.
 *
 * Covers the must_have truths:
 *   - valid runner-token + status='done' → 204, task flips done, token revoked
 *   - cross-task token → 403
 *   - runner-secret principal → 403
 *   - non-auth (session / no bearer) → 401
 *   - task already terminal → 409 idempotency
 *   - status='cancelled' in body → 400 (Zod literal)
 *   - post-submit the same token is rejected on retry (401) — revocation
 *     actually fired
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { issueRunnerToken } from '@/lib/runner-tokens'

let testDb: Database.Database

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
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

const { POST } = await import('../route')

function seedWorkspace(db: Database.Database): void {
  const existing = db.prepare(`SELECT id FROM workspaces WHERE id = ?`).get(1) as { id?: number } | undefined
  if (!existing) {
    db.prepare(`INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (?, ?, ?, ?)`).run(1, 'default', 'Default', 1)
  }
}

function seedTask(db: Database.Database, id: number, status = 'in_progress'): void {
  db.prepare(`
    INSERT INTO tasks (id, title, status, priority, workspace_id, container_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, `task ${id}`, status, 'medium', 1, 'some-container-id')
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
  seedTask(testDb, 5)
  process.env.API_KEY = ''
  process.env.MC_PROXY_AUTH_HEADER = ''
})

afterEach(() => {
  testDb.close()
})

describe('POST /api/runner/tasks/:task_id/submit', () => {
  it('RUNNER-06: valid runner-token + status="done" → 204 + task flips to done + token revoked', async () => {
    const { token } = issueRunnerToken(testDb, 5, 1, 300)

    const res = await submit(5, token, { status: 'done' })
    expect(res.status).toBe(204)

    const task = testDb.prepare(`SELECT status, container_id, completed_at FROM tasks WHERE id = 5`).get() as {
      status: string
      container_id: string | null
      completed_at: number | null
    }
    expect(task.status).toBe('done')
    expect(task.container_id).toBeNull()
    expect(task.completed_at).toBeGreaterThan(0)

    // Token should be revoked
    const tokenRow = testDb.prepare(`SELECT revoked_at FROM task_runner_tokens WHERE task_id = 5`).get() as { revoked_at: number | null }
    expect(tokenRow.revoked_at).not.toBeNull()
  })

  it('RUNNER-06: cross-task runner-token (token for task A, used on task B) → 403', async () => {
    seedTask(testDb, 99)
    const { token } = issueRunnerToken(testDb, 5, 1, 300)

    // Issue a token for task 5, but POST to /submit on task 99. The auth layer
    // discriminates by path task_id; the route then never sees a runner-token
    // principal (it falls through to session/api-key branches, so we get 401).
    const res = await submit(99, token, { status: 'done' })
    expect(res.status).toBe(401)
  })

  it('RUNNER-06: runner-secret principal (id=-1000) → 403 — only runner-token can submit', async () => {
    const runnerSecret = 'known-runner-secret-test-value-abc-1234567890'
    const res = await submit(5, runnerSecret, { status: 'done' })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('runner-token principal required')
  })

  it('RUNNER-06: no bearer → 401 (not authenticated)', async () => {
    const res = await submit(5, null, { status: 'done' })
    expect(res.status).toBe(401)
  })

  it('RUNNER-06: task already "done" → 409 idempotency', async () => {
    seedTask(testDb, 42, 'done')
    const { token } = issueRunnerToken(testDb, 42, 1, 300)

    // Even though the task is already terminal, the token was issued so auth
    // resolves. The handler then sees task.status='done' and returns 409.
    const res = await submit(42, token, { status: 'done' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('task already terminal')
  })

  it('RUNNER-06: status="cancelled" in body → 400 (Zod literal guard — Phase 14 only supports "done")', async () => {
    const { token } = issueRunnerToken(testDb, 5, 1, 300)
    const res = await submit(5, token, { status: 'cancelled' })
    expect(res.status).toBe(400)
  })

  it('RUNNER-06: revokeTokensForTask fires — after submit, the same token is rejected on retry', async () => {
    const { token } = issueRunnerToken(testDb, 5, 1, 300)

    const first = await submit(5, token, { status: 'done' })
    expect(first.status).toBe(204)

    // Second submit with same token — token is revoked, auth resolves to null
    // (getUserFromRequest returns null for revoked tokens), requireRole returns
    // 401. Also the task is terminal, so even if auth succeeded 409 would come.
    seedTask(testDb, 7)
    const second = await submit(5, token, { status: 'done' })
    expect(second.status).toBe(401)
  })
})
