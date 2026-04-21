/**
 * Tests for GET /api/runtime/runner-status (Phase 16 Wave-0 — Plan 16-01 Task 1 Step 9).
 *
 * Viewer-authenticated runner status summary. Covers:
 *   1. Unauthenticated request → 401.
 *   2. Fresh heartbeat + 3 waiting recipe-tasks → 200 {online:true, ...}.
 *   3. No fresh heartbeat (or older than 90s) → 200 {online:false, last_heartbeat_at:null, tasks_waiting:N}.
 *   4. DB throws → 500.
 *
 * Boundary-mock-only pattern per Phase 15-07 LOCKED discipline: @/lib/db is
 * mocked to hand back an in-memory SQLite; @/lib/logger is mocked for silence;
 * the route module is imported for real.
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'

let testDb: Database.Database

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    logActivity: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    createNotification: vi.fn(),
  },
}))

vi.mock('@/lib/security-events', () => ({ logSecurityEvent: vi.fn() }))
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

const loggerErrorMock = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => loggerErrorMock(...args),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

const { GET } = await import('../route')

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

function seedHeartbeat(
  db: Database.Database,
  runnerId: string,
  lastHeartbeatAt: number,
  metadataJson: string | null = null,
): void {
  db.prepare(
    `INSERT INTO runner_heartbeats (runner_id, last_heartbeat_at, registered_at, metadata_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(runner_id) DO UPDATE SET
       last_heartbeat_at = excluded.last_heartbeat_at,
       metadata_json = excluded.metadata_json`,
  ).run(runnerId, lastHeartbeatAt, lastHeartbeatAt, metadataJson)
}

function seedTask(
  db: Database.Database,
  id: number,
  opts: {
    status?: string
    recipe_slug?: string | null
    workspace_id?: number
  } = {},
): void {
  const status = opts.status ?? 'inbox'
  const recipeSlug = opts.recipe_slug ?? null
  const workspaceId = opts.workspace_id ?? 1
  db.prepare(
    `INSERT INTO tasks
       (id, title, status, priority, workspace_id, recipe_slug)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, `task ${id}`, status, 'medium', workspaceId, recipeSlug)
}

function statusReq(bearer: string | null): NextRequest {
  const headers: Record<string, string> = {}
  if (bearer) headers.authorization = `Bearer ${bearer}`
  return new NextRequest('http://localhost/api/runtime/runner-status', {
    method: 'GET',
    headers,
  })
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  seedWorkspace(testDb, 1)
  process.env.API_KEY = 'test-admin-api-key-runner-status-aaaaaa'
  process.env.MC_PROXY_AUTH_HEADER = ''
  loggerErrorMock.mockReset()
})

afterEach(() => {
  testDb.close()
  vi.restoreAllMocks()
})

describe('GET /api/runtime/runner-status', () => {
  it('RUI-02: unauthenticated request → 401', async () => {
    const res = await GET(statusReq(null))
    expect(res.status).toBe(401)
  })

  it('RUI-02: fresh heartbeat + 3 waiting recipe-tasks → online:true with count', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    seedHeartbeat(testDb, 'runner-main', nowSec - 5)
    seedTask(testDb, 1, { recipe_slug: 'r1', status: 'inbox', workspace_id: 1 })
    seedTask(testDb, 2, { recipe_slug: 'r1', status: 'assigned', workspace_id: 1 })
    seedTask(testDb, 3, { recipe_slug: 'r2', status: 'inbox', workspace_id: 1 })
    // Non-recipe task must NOT count.
    seedTask(testDb, 4, { recipe_slug: null, status: 'inbox', workspace_id: 1 })
    // Non-waiting recipe task must NOT count.
    seedTask(testDb, 5, { recipe_slug: 'r3', status: 'in_progress', workspace_id: 1 })

    const res = await GET(statusReq(process.env.API_KEY as string))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      online: boolean
      last_heartbeat_at: number | null
      tasks_waiting: number
    }
    expect(body.online).toBe(true)
    expect(body.last_heartbeat_at).toBe(nowSec - 5)
    expect(body.tasks_waiting).toBe(3)
  })

  it('RUI-02: stale heartbeat (older than 90s) → online:false, last_heartbeat_at:null, tasks_waiting still counted', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    seedHeartbeat(testDb, 'runner-old', nowSec - 600)
    seedTask(testDb, 1, { recipe_slug: 'r1', status: 'inbox', workspace_id: 1 })
    seedTask(testDb, 2, { recipe_slug: 'r1', status: 'assigned', workspace_id: 1 })

    const res = await GET(statusReq(process.env.API_KEY as string))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      online: boolean
      last_heartbeat_at: number | null
      tasks_waiting: number
    }
    expect(body.online).toBe(false)
    expect(body.last_heartbeat_at).toBeNull()
    expect(body.tasks_waiting).toBe(2)
  })

  it('RUI-02: no heartbeat at all → online:false, tasks_waiting:0', async () => {
    const res = await GET(statusReq(process.env.API_KEY as string))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      online: boolean
      last_heartbeat_at: number | null
      tasks_waiting: number
    }
    expect(body).toEqual({
      online: false,
      last_heartbeat_at: null,
      tasks_waiting: 0,
    })
  })

  it('RUI-02: prefers the freshest heartbeat when multiple runners are live', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    seedHeartbeat(testDb, 'runner-older', nowSec - 60)
    seedHeartbeat(testDb, 'runner-newer', nowSec - 3)

    const res = await GET(statusReq(process.env.API_KEY as string))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      online: boolean
      last_heartbeat_at: number | null
    }
    expect(body.online).toBe(true)
    expect(body.last_heartbeat_at).toBe(nowSec - 3)
  })

  it('RUI-02: workspace-scoped waiting count (tasks in other workspaces excluded)', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    seedHeartbeat(testDb, 'runner-main', nowSec - 5)
    seedWorkspace(testDb, 2)
    seedTask(testDb, 1, { recipe_slug: 'r1', status: 'inbox', workspace_id: 1 })
    seedTask(testDb, 2, { recipe_slug: 'r1', status: 'inbox', workspace_id: 2 })
    seedTask(testDb, 3, { recipe_slug: 'r1', status: 'inbox', workspace_id: 2 })

    // API_KEY resolves as admin in workspace 1 — only its single waiting task counts.
    const res = await GET(statusReq(process.env.API_KEY as string))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tasks_waiting: number }
    expect(body.tasks_waiting).toBe(1)
  })

  it('RUI-02: DB throws → 500 with logged error', async () => {
    // Close the DB to force the prepared statement to throw inside GET.
    testDb.close()
    const res = await GET(statusReq(process.env.API_KEY as string))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Failed to read runner status')
    expect(loggerErrorMock).toHaveBeenCalled()

    // Reopen for afterEach's testDb.close() not to throw on a double-close.
    testDb = new Database(':memory:')
  })
})
