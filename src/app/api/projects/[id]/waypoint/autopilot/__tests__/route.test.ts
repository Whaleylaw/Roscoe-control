import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'

let db: Database.Database
let authRole: 'admin' | 'operator' | 'viewer' = 'operator'

vi.mock('@/lib/db', () => ({ getDatabase: () => db }))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn((_req: unknown, required: 'viewer' | 'operator' | 'admin') => {
    const order = { viewer: 0, operator: 1, admin: 2 }
    if (order[authRole] < order[required]) return { error: 'Forbidden', status: 403 }
    return { user: { id: 1, username: 'operator', role: authRole, workspace_id: 1, tenant_id: 1 } }
  }),
}))

vi.mock('@/lib/workspaces', () => ({
  ensureTenantWorkspaceAccess: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {
    status = 403
  },
}))

vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }))

function req(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getReq(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: 'GET' })
}

function seedProject(input: { gsdEnabled: number }): number {
  const result = db.prepare(
    `INSERT INTO projects (
       workspace_id, name, slug, description, ticket_prefix, status,
       gsd_enabled, gsd_track, gsd_phase, gsd_gate_mode, gsd_project_id, gsd_updated_at,
       created_at, updated_at
     ) VALUES (
       1, 'Alpha', 'alpha', NULL, 'ALP', 'active',
       ?, 'product', 'plan', 'manual_approval', 'umbrella-1', unixepoch(),
       unixepoch(), unixepoch()
     )`,
  ).run(input.gsdEnabled)
  return Number(result.lastInsertRowid)
}

async function loadRoute() {
  return import('@/app/api/projects/[id]/waypoint/autopilot/route')
}

beforeEach(() => {
  vi.resetModules()
  authRole = 'operator'
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('POST /api/projects/:id/waypoint/autopilot', () => {
  it('rejects viewer role', async () => {
    authRole = 'viewer'
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/autopilot`, {}), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(403)
  })

  it('returns 409 when waypoint lifecycle is not enabled', async () => {
    const projectId = seedProject({ gsdEnabled: 0 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/autopilot`, {}), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(409)
  })

  it('runs bounded autopilot and returns result', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/autopilot`, { max_iterations: 3 }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      action: 'autopilot',
      result: {
        iterations: 1,
      },
    })
    expect(typeof body.result.stopReason).toBe('string')
  })
})

describe('GET /api/projects/:id/waypoint/autopilot', () => {
  it('returns autopilot run history payload', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/autopilot?limit=5&offset=0`), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.action).toBe('autopilot_status')
    expect(Array.isArray(body.runs)).toBe(true)
    expect(body.pagination).toEqual({ limit: 5, offset: 0 })
  })

  it('returns 400 for invalid pagination', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/autopilot?limit=0`), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(400)
  })
})
