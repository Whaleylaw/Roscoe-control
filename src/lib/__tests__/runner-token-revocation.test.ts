import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared in-memory DB for auth lookups + the route handler.
let testDb: Database.Database

// Auth mock — route uses requireRole; return a fixed operator user.
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({
    user: { id: 1, username: 'tester', display_name: 'Tester', role: 'operator', workspace_id: 1, tenant_id: 1, created_at: 0, updated_at: 0, last_login_at: null },
  })),
}))

vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))

// Mention resolver must not hit the DB for users table lookups (no seeded users).
vi.mock('@/lib/mentions', () => ({
  resolveMentionRecipients: vi.fn(() => ({ recipients: [], unresolved: [] })),
}))

// validateBody passes through the body fields — the route's own body destructuring
// is what we need to exercise.
vi.mock('@/lib/validation', async () => {
  const actual = await vi.importActual<typeof import('@/lib/validation')>('@/lib/validation')
  return {
    ...actual,
    validateBody: vi.fn(async (req: Request) => {
      const json = await req.json()
      return { data: json }
    }),
  }
})

// task-status — pass-through normalization so we can steer status directly.
vi.mock('@/lib/task-status', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-status')>('@/lib/task-status')
  return {
    ...actual,
    normalizeTaskUpdateStatus: vi.fn(({ requestedStatus }: { requestedStatus?: string }) => requestedStatus),
  }
})

vi.mock('@/lib/github-sync-engine', () => ({ syncTaskOutbound: vi.fn() }))
vi.mock('@/lib/gnap-sync', () => ({ pushTaskToGnap: vi.fn(), removeTaskFromGnap: vi.fn() }))
vi.mock('@/lib/config', () => ({ config: { gnap: { enabled: false, autoSync: false, repoPath: '' } } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))

// getDatabase + db_helpers — real in-memory DB; helpers stubbed so the route's activity
// logging and notifications don't require additional schema wiring.
vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    createNotification: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    logActivity: vi.fn(),
  },
}))

import { runMigrations } from '@/lib/migrations'
import {
  issueRunnerToken,
  verifyRunnerToken,
  revokeTokensForTask,
} from '@/lib/runner-tokens'
import { PUT } from '@/app/api/tasks/[id]/route'

function seedWorkspace(db: Database.Database): void {
  const existing = db.prepare(`SELECT id FROM workspaces WHERE id = ?`).get(1) as { id?: number } | undefined
  if (!existing) {
    db.prepare(`INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (?, ?, ?, ?)`).run(
      1, 'default', 'Default', 1,
    )
  }
}

function seedTask(db: Database.Database, id: number, overrides: Partial<{ status: string }> = {}): void {
  const status = overrides.status ?? 'in_progress'
  db.prepare(
    `INSERT INTO tasks (id, title, status, priority, workspace_id, project_id) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, `task ${id}`, status, 'medium', 1, null)
}

function seedAegisApproval(db: Database.Database, taskId: number): void {
  // quality_reviews has task_id, reviewer, status, workspace_id, created_at
  db.prepare(
    `INSERT INTO quality_reviews (task_id, reviewer, status, workspace_id, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(taskId, 'aegis', 'approved', 1, Math.floor(Date.now() / 1000))
}

describe('PUT /api/tasks/[id] — runner-token revocation on terminal transitions', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.pragma('foreign_keys = ON')
    runMigrations(testDb)
    seedWorkspace(testDb)
  })

  afterEach(() => {
    testDb.close()
  })

  it('revokes ALL live tokens when task flips in_progress → done (atomic in one transaction)', async () => {
    seedTask(testDb, 5, { status: 'in_progress' })
    seedAegisApproval(testDb, 5)
    const { token: t1 } = issueRunnerToken(testDb, 5, 1, 300)
    const { token: t2 } = issueRunnerToken(testDb, 5, 2, 300)

    expect(verifyRunnerToken(testDb, t1)).not.toBeNull()
    expect(verifyRunnerToken(testDb, t2)).not.toBeNull()

    const request = new NextRequest('http://localhost/api/tasks/5', {
      method: 'PUT',
      body: JSON.stringify({ status: 'done' }),
      headers: { 'content-type': 'application/json' },
    })
    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) })
    expect(response.status).toBe(200)

    // Status flipped
    const task = testDb.prepare(`SELECT status FROM tasks WHERE id = 5`).get() as { status: string }
    expect(task.status).toBe('done')

    // BOTH tokens revoked
    expect(verifyRunnerToken(testDb, t1)).toBeNull()
    expect(verifyRunnerToken(testDb, t2)).toBeNull()

    const rows = testDb.prepare(`SELECT revoked_at FROM task_runner_tokens WHERE task_id = 5`).all() as Array<{ revoked_at: number | null }>
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row.revoked_at).not.toBeNull()
    }
  })

  it('revokes tokens when task flips in_progress → failed', async () => {
    seedTask(testDb, 5, { status: 'in_progress' })
    const { token } = issueRunnerToken(testDb, 5, 1, 300)

    const request = new NextRequest('http://localhost/api/tasks/5', {
      method: 'PUT',
      body: JSON.stringify({ status: 'failed' }),
      headers: { 'content-type': 'application/json' },
    })
    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) })
    expect(response.status).toBe(200)

    expect(verifyRunnerToken(testDb, token)).toBeNull()
  })

  it('does NOT revoke tokens on non-terminal transitions (inbox → in_progress)', async () => {
    seedTask(testDb, 5, { status: 'inbox' })
    const { token } = issueRunnerToken(testDb, 5, 1, 300)

    const request = new NextRequest('http://localhost/api/tasks/5', {
      method: 'PUT',
      body: JSON.stringify({ status: 'in_progress' }),
      headers: { 'content-type': 'application/json' },
    })
    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) })
    expect(response.status).toBe(200)

    // Token still valid
    expect(verifyRunnerToken(testDb, token)).not.toBeNull()
  })

  it('does NOT revoke tokens on terminal→terminal writes (done already; no-op)', async () => {
    // Start in 'done' — isTerminalTransition guard blocks re-revocation.
    seedTask(testDb, 5, { status: 'done' })
    seedAegisApproval(testDb, 5)
    const { token } = issueRunnerToken(testDb, 5, 1, 300)

    // Write status: 'done' again (idempotent re-write).
    const request = new NextRequest('http://localhost/api/tasks/5', {
      method: 'PUT',
      body: JSON.stringify({ status: 'done' }),
      headers: { 'content-type': 'application/json' },
    })
    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) })
    expect(response.status).toBe(200)

    // Token still un-revoked (the guard prevented re-revocation).
    const row = testDb.prepare(`SELECT revoked_at FROM task_runner_tokens WHERE task_id = 5`).get() as { revoked_at: number | null }
    expect(row.revoked_at).toBeNull()
    expect(verifyRunnerToken(testDb, token)).not.toBeNull()
  })

  it('revocation is task-scoped — other tasks’ tokens remain valid', async () => {
    seedTask(testDb, 5, { status: 'in_progress' })
    seedAegisApproval(testDb, 5)
    seedTask(testDb, 6, { status: 'in_progress' })
    const { token: t5 } = issueRunnerToken(testDb, 5, 1, 300)
    const { token: t6 } = issueRunnerToken(testDb, 6, 1, 300)

    const request = new NextRequest('http://localhost/api/tasks/5', {
      method: 'PUT',
      body: JSON.stringify({ status: 'done' }),
      headers: { 'content-type': 'application/json' },
    })
    await PUT(request, { params: Promise.resolve({ id: '5' }) })

    expect(verifyRunnerToken(testDb, t5)).toBeNull()
    expect(verifyRunnerToken(testDb, t6)).not.toBeNull()
  })

  it('atomicity: if the transaction throws, the status UPDATE rolls back AND tokens remain un-revoked', () => {
    seedTask(testDb, 5, { status: 'in_progress' })
    const { token } = issueRunnerToken(testDb, 5, 1, 300)

    // Directly exercise the transaction shape with a forced throw between UPDATE and revoke,
    // to prove db.transaction() rolls both back together. This mirrors the exact pattern used
    // by the PUT handler.
    expect(() => {
      testDb.transaction(() => {
        testDb.prepare(`UPDATE tasks SET status = ? WHERE id = ? AND workspace_id = ?`).run('done', 5, 1)
        revokeTokensForTask(testDb, 5)
        throw new Error('simulated post-revoke crash')
      })()
    }).toThrow('simulated post-revoke crash')

    // Both changes rolled back
    const task = testDb.prepare(`SELECT status FROM tasks WHERE id = 5`).get() as { status: string }
    expect(task.status).toBe('in_progress')  // NOT 'done'
    expect(verifyRunnerToken(testDb, token)).not.toBeNull()  // token still valid
  })

  it('revokeTokensForTask alone is idempotent and safe under repeated calls (documents same-tx contract)', () => {
    seedTask(testDb, 5, { status: 'in_progress' })
    issueRunnerToken(testDb, 5, 1, 300)

    const first = revokeTokensForTask(testDb, 5)
    const second = revokeTokensForTask(testDb, 5)
    expect(first.revokedCount).toBe(1)
    expect(second.revokedCount).toBe(0)
  })
})
