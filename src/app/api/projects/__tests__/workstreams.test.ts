import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'

let db: Database.Database
let authRole: 'admin' | 'operator' | 'viewer' = 'operator'

vi.mock('@/lib/db', () => ({
  getDatabase: () => db,
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn((_req: unknown, required: 'viewer' | 'operator' | 'admin') => {
    const order = { viewer: 0, operator: 1, admin: 2 }
    if (order[authRole] < order[required]) {
      return { error: 'Forbidden', status: 403 }
    }
    return {
      user: { id: 1, username: 'operator', role: authRole, workspace_id: 1, tenant_id: 1 },
    }
  }),
}))

vi.mock('@/lib/workspaces', () => ({
  ensureTenantWorkspaceAccess: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {
    status = 403
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

function seedProject() {
  db.prepare(
    `INSERT INTO projects (workspace_id, name, slug, description, ticket_prefix, status, created_at, updated_at)
     VALUES (1, 'Alpha', 'alpha', NULL, 'ALP', 'active', unixepoch(), unixepoch())`,
  ).run()
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function loadCollection() {
  return import('@/app/api/projects/[id]/gsd/workstreams/route')
}

async function loadDetail() {
  return import('@/app/api/projects/[id]/gsd/workstreams/[ws_id]/route')
}

async function loadComplete() {
  return import('@/app/api/projects/[id]/gsd/workstreams/[ws_id]/complete/route')
}

beforeEach(() => {
  vi.resetModules()
  authRole = 'operator'
  db = new Database(':memory:')
  runMigrations(db)
  seedProject()
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('Phase 10 workstream routes', () => {
  it('GET returns project-scoped workstreams', async () => {
    db.prepare(
      `INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
       VALUES (1, 'core', 'Core', 'active', unixepoch(), unixepoch())`,
    ).run()

    const { GET } = await loadCollection()
    const res = await GET(req('/api/projects/1/gsd/workstreams'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.workstreams).toHaveLength(1)
    expect(body.workstreams[0].key).toBe('core')
  })

  it('POST creates a workstream with default active status', async () => {
    const { POST } = await loadCollection()
    const res = await POST(
      req('/api/projects/1/gsd/workstreams', 'POST', { key: 'platform', name: 'Platform' }),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.workstream.key).toBe('platform')
    expect(body.workstream.status).toBe('active')
  })

  it('POST replays identical creates for the same workstream key', async () => {
    db.prepare(
      `INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
       VALUES (1, 'core', 'Core', 'active', unixepoch(), unixepoch())`,
    ).run()

    const { POST } = await loadCollection()
    const res = await POST(
      req('/api/projects/1/gsd/workstreams', 'POST', { key: 'core', name: 'Core', status: 'active' }),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.idempotent_replay).toBe(true)
    expect(body.workstream.id).toBe(1)
  })

  it('POST rejects conflicting creates for the same workstream key', async () => {
    db.prepare(
      `INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
       VALUES (1, 'core', 'Core', 'active', unixepoch(), unixepoch())`,
    ).run()

    const { POST } = await loadCollection()
    const res = await POST(
      req('/api/projects/1/gsd/workstreams', 'POST', { key: 'core', name: 'Duplicate Core' }),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('DUPLICATE_KEY')
  })

  it('PATCH enforces optimistic locking', async () => {
    db.prepare(
      `INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
       VALUES (1, 'core', 'Core', 'active', unixepoch(), unixepoch())`,
    ).run()

    const { PATCH } = await loadDetail()
    const res = await PATCH(
      req('/api/projects/1/gsd/workstreams/1', 'PATCH', {
        name: 'Core Renamed',
        expected_updated_at: 123,
      }),
      { params: Promise.resolve({ id: '1', ws_id: '1' }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('OPTIMISTIC_LOCK_FAILED')
  })

  it('PATCH updates key/name/status when the row version matches', async () => {
    db.prepare(
      `INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
       VALUES (1, 'core', 'Core', 'active', unixepoch(), unixepoch())`,
    ).run()
    const current = db.prepare(`SELECT updated_at FROM gsd_workstreams WHERE id = 1`).get() as { updated_at: number }

    const { PATCH } = await loadDetail()
    const res = await PATCH(
      req('/api/projects/1/gsd/workstreams/1', 'PATCH', {
        key: 'core-v2',
        name: 'Core V2',
        status: 'paused',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ id: '1', ws_id: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.workstream.key).toBe('core-v2')
    expect(body.workstream.name).toBe('Core V2')
    expect(body.workstream.status).toBe('paused')
  })

  it('POST complete marks the workstream complete', async () => {
    db.prepare(
      `INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
       VALUES (1, 'core', 'Core', 'active', unixepoch(), unixepoch())`,
    ).run()
    const current = db.prepare(`SELECT updated_at FROM gsd_workstreams WHERE id = 1`).get() as { updated_at: number }

    const { POST } = await loadComplete()
    const res = await POST(
      req('/api/projects/1/gsd/workstreams/1/complete', 'POST', {
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ id: '1', ws_id: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.workstream.status).toBe('complete')
  })
})
