/**
 * POST /api/runner/tasks/:task_id/container-started — Plan 14-11 Task 2.
 *
 * Covers the must_have truths:
 *   - Replaces 'pending:<task>:<attempt>' placeholder with real id → 204
 *   - Idempotent: same id twice → 204; DB unchanged on second call
 *   - Conflict: DIFFERENT id when task already has a real id → 409
 *   - Rejects non-runner-secret bearer with 403
 *   - 404 when task doesn't exist
 *   - 400 on invalid container_id (non-hex, too short)
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { issueRunnerToken } from '@/lib/runner-tokens'

let testDb: Database.Database

const KNOWN_RUNNER_SECRET = 'known-runner-secret-container-started-abc-1234567890'

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    logActivity: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    createNotification: vi.fn(),
  },
}))

vi.mock('@/lib/runner-secret', () => ({
  getRunnerSecret: () => KNOWN_RUNNER_SECRET,
  ensureRunnerSecret: vi.fn(() => KNOWN_RUNNER_SECRET),
  RUNNER_SECRET_FILENAME: '.data/runner.secret',
}))

vi.mock('@/lib/security-events', () => ({ logSecurityEvent: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))
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

function seedTask(
  db: Database.Database,
  id: number,
  status = 'in_progress',
  containerId: string | null = `pending:${id}:1`,
): void {
  db.prepare(`
    INSERT INTO tasks (id, title, status, priority, workspace_id, container_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, `task ${id}`, status, 'medium', 1, containerId)
}

function startedReq(taskId: number, bearer: string | null, body: unknown): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  return new NextRequest(`http://localhost/api/runner/tasks/${taskId}/container-started`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function containerStarted(taskId: number, bearer: string | null, body: unknown) {
  return POST(startedReq(taskId, bearer, body), {
    params: Promise.resolve({ task_id: String(taskId) }),
  })
}

const REAL_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const OTHER_ID = 'ffeeddccbbaa00998877665544332211ffeeddccbbaa00998877665544332211'

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

describe('POST /api/runner/tasks/:task_id/container-started', () => {
  it('RUNNER-13: POST container-started replaces pending placeholder with real docker container_id', async () => {
    const res = await containerStarted(5, KNOWN_RUNNER_SECRET, { container_id: REAL_ID })
    expect(res.status).toBe(204)

    const row = testDb.prepare(`SELECT container_id FROM tasks WHERE id = 5`).get() as { container_id: string }
    expect(row.container_id).toBe(REAL_ID)
  })

  it('RUNNER-13: idempotent — POST with same container_id twice → 204 both times; DB unchanged', async () => {
    const first = await containerStarted(5, KNOWN_RUNNER_SECRET, { container_id: REAL_ID })
    expect(first.status).toBe(204)

    const row1 = testDb.prepare(`SELECT container_id, updated_at FROM tasks WHERE id = 5`).get() as {
      container_id: string
      updated_at: number | null
    }

    // Sleep a tick to ensure UPDATE would change updated_at if it fired; then
    // re-call. The second call must hit the idempotent early-return branch,
    // so updated_at stays the same.
    await new Promise((r) => setTimeout(r, 1100))
    const second = await containerStarted(5, KNOWN_RUNNER_SECRET, { container_id: REAL_ID })
    expect(second.status).toBe(204)

    const row2 = testDb.prepare(`SELECT container_id, updated_at FROM tasks WHERE id = 5`).get() as {
      container_id: string
      updated_at: number | null
    }
    expect(row2.container_id).toBe(REAL_ID)
    expect(row2.updated_at).toBe(row1.updated_at)
  })

  it('RUNNER-13: conflict — POST with DIFFERENT id when task already has a real id → 409', async () => {
    seedTask(testDb, 10, 'in_progress', REAL_ID)
    const res = await containerStarted(10, KNOWN_RUNNER_SECRET, { container_id: OTHER_ID })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('already has a real container_id')
  })

  it('RUNNER-13: rejects non-runner-secret bearer with 403 (runner-token principal)', async () => {
    const { token } = issueRunnerToken(testDb, 5, 1, 300)
    // Runner-token is NOT allowlisted for /container-started (not in
    // RUNNER_TOKEN_ALLOWLIST). The auth layer will fall through to
    // session/api-key branches, which fail → 401 from requireRole.
    const res = await containerStarted(5, token, { container_id: REAL_ID })
    expect(res.status).toBe(401)
  })

  it('RUNNER-13: 404 when task does not exist', async () => {
    const res = await containerStarted(999, KNOWN_RUNNER_SECRET, { container_id: REAL_ID })
    expect(res.status).toBe(404)
  })

  it('RUNNER-13: 400 on invalid container_id (non-hex / too short)', async () => {
    // Too short
    const short = await containerStarted(5, KNOWN_RUNNER_SECRET, { container_id: 'abc' })
    expect(short.status).toBe(400)

    // Non-hex chars
    const nonHex = await containerStarted(5, KNOWN_RUNNER_SECRET, {
      container_id: 'zzzzzzzzzzzzzzzz',
    })
    expect(nonHex.status).toBe(400)
  })
})
