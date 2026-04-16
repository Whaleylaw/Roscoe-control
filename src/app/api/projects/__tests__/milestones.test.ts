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

function seedWorkstream() {
  db.prepare(
    `INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
     VALUES (1, 'core', 'Core', 'active', unixepoch(), unixepoch())`,
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
  return import('@/app/api/projects/[id]/gsd/milestones/route')
}

async function loadDetail() {
  return import('@/app/api/projects/[id]/gsd/milestones/[milestone_id]/route')
}

async function loadComplete() {
  return import('@/app/api/projects/[id]/gsd/milestones/[milestone_id]/complete/route')
}

beforeEach(() => {
  vi.resetModules()
  authRole = 'operator'
  db = new Database(':memory:')
  runMigrations(db)
  seedProject()
  seedWorkstream()
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('Phase 10 milestone routes', () => {
  it('GET returns project-scoped milestones', async () => {
    db.prepare(
      `INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at)
       VALUES (1, 1, 'v1.2', 'Launch', 'planned', unixepoch(), unixepoch())`,
    ).run()

    const { GET } = await loadCollection()
    const res = await GET(req('/api/projects/1/gsd/milestones'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestones).toHaveLength(1)
    expect(body.milestones[0].version_label).toBe('v1.2')
  })

  it('POST creates a milestone linked to a workstream', async () => {
    const { POST } = await loadCollection()
    const res = await POST(
      req('/api/projects/1/gsd/milestones', 'POST', {
        workstream_id: 1,
        version_label: 'v1.2',
        title: 'Launch',
      }),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.milestone.workstream_id).toBe(1)
    expect(body.milestone.status).toBe('planned')
  })

  it('POST replays identical creates for the same milestone identity', async () => {
    db.prepare(
      `INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at)
       VALUES (1, 1, 'v1.2', 'Launch', 'planned', unixepoch(), unixepoch())`,
    ).run()

    const { POST } = await loadCollection()
    const res = await POST(
      req('/api/projects/1/gsd/milestones', 'POST', {
        workstream_id: 1,
        version_label: 'v1.2',
        title: 'Launch',
      }),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.idempotent_replay).toBe(true)
    expect(body.milestone.id).toBe(1)
  })

  it('POST rejects conflicting creates for the same milestone identity', async () => {
    db.prepare(
      `INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at)
       VALUES (1, 1, 'v1.2', 'Launch', 'planned', unixepoch(), unixepoch())`,
    ).run()

    const { POST } = await loadCollection()
    const res = await POST(
      req('/api/projects/1/gsd/milestones', 'POST', {
        workstream_id: 1,
        version_label: 'v1.2',
        title: 'Launch',
        status: 'active',
      }),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('DUPLICATE_MILESTONE')
  })

  it('POST rejects a missing workstream reference', async () => {
    const { POST } = await loadCollection()
    const res = await POST(
      req('/api/projects/1/gsd/milestones', 'POST', {
        workstream_id: 999,
        version_label: 'v1.2',
        title: 'Launch',
      }),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('WORKSTREAM_NOT_FOUND')
  })

  it('PATCH enforces optimistic locking', async () => {
    db.prepare(
      `INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at)
       VALUES (1, 1, 'v1.2', 'Launch', 'planned', unixepoch(), unixepoch())`,
    ).run()

    const { PATCH } = await loadDetail()
    const res = await PATCH(
      req('/api/projects/1/gsd/milestones/1', 'PATCH', {
        title: 'Launch Updated',
        expected_updated_at: 1,
      }),
      { params: Promise.resolve({ id: '1', milestone_id: '1' }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('OPTIMISTIC_LOCK_FAILED')
  })

  it('PATCH updates milestone fields when row version matches', async () => {
    db.prepare(
      `INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at)
       VALUES (1, 1, 'v1.2', 'Launch', 'planned', unixepoch(), unixepoch())`,
    ).run()
    const current = db.prepare(`SELECT updated_at FROM gsd_milestones WHERE id = 1`).get() as { updated_at: number }

    const { PATCH } = await loadDetail()
    const res = await PATCH(
      req('/api/projects/1/gsd/milestones/1', 'PATCH', {
        workstream_id: null,
        status: 'active',
        title: 'Launch Updated',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ id: '1', milestone_id: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.workstream_id).toBeNull()
    expect(body.milestone.status).toBe('active')
    expect(body.milestone.title).toBe('Launch Updated')
  })

  it('POST complete marks the milestone complete and stamps completed_at', async () => {
    db.prepare(
      `INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at)
       VALUES (1, 1, 'v1.2', 'Launch', 'active', unixepoch(), unixepoch())`,
    ).run()
    const current = db.prepare(`SELECT updated_at FROM gsd_milestones WHERE id = 1`).get() as { updated_at: number }

    const { POST } = await loadComplete()
    const res = await POST(
      req('/api/projects/1/gsd/milestones/1/complete', 'POST', {
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ id: '1', milestone_id: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.status).toBe('complete')
    expect(body.milestone.completed_at).toBeGreaterThan(0)
  })
})
