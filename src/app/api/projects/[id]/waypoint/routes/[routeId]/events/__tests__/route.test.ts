import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { createWorkflowDefinition, startWorkflowInstance } from '@/lib/workflow-engine'

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

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

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

function seedDoctorRoute(projectId: number): number {
  const definitionId = createWorkflowDefinition(
    db,
    `
schema_version: 1
id: waypoint-doctor
name: Waypoint Doctor
version: 1
subject_type: waypoint_project
vars:
  project_id:
    required: true
    type: number
nodes:
  diagnose:
    type: recipe
    recipe: gsd-debugger
`,
    'tester',
    1,
    1,
  )

  const started = startWorkflowInstance(db, {
    workflowKey: `waypoint_project:${projectId}:waypoint-doctor:v1`,
    definitionId,
    subjectType: 'waypoint_project',
    subjectId: String(projectId),
    vars: { project_id: projectId, workspace_id: 1 },
    actor: 'tester',
    workspaceId: 1,
    tenantId: 1,
  })

  return started.instance_id
}

async function loadRoute() {
  return import('@/app/api/projects/[id]/waypoint/routes/[routeId]/events/route')
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

describe('GET /api/projects/:id/waypoint/routes/:routeId/events', () => {
  it('rejects viewer role', async () => {
    authRole = 'viewer'
    const projectId = seedProject({ gsdEnabled: 1 })
    const routeId = seedDoctorRoute(projectId)

    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/routes/${routeId}/events`), {
      params: Promise.resolve({ id: String(projectId), routeId: String(routeId) }),
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, action: 'error', error: 'Forbidden' })
  })

  it('returns consistent forbidden envelope when workspace access is denied', async () => {
    const { ensureTenantWorkspaceAccess, ForbiddenError } = await import('@/lib/workspaces')
    vi.mocked(ensureTenantWorkspaceAccess).mockImplementationOnce(() => {
      throw new ForbiddenError('Workspace access denied')
    })

    const projectId = seedProject({ gsdEnabled: 1 })
    const routeId = seedDoctorRoute(projectId)

    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/routes/${routeId}/events`), {
      params: Promise.resolve({ id: String(projectId), routeId: String(routeId) }),
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Workspace access denied',
    })
  })

  it('returns 409 when waypoint lifecycle is not enabled', async () => {
    const projectId = seedProject({ gsdEnabled: 0 })
    const routeId = seedDoctorRoute(projectId)

    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/routes/${routeId}/events`), {
      params: Promise.resolve({ id: String(projectId), routeId: String(routeId) }),
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: false,
      action: 'error',
      error: 'Waypoint lifecycle is not enabled for this project',
    })
  })

  it('returns route events request error as 400 when route lookup fails', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })
    const routeId = seedDoctorRoute(projectId)

    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/routes/${routeId + 1}/events?limit=5&offset=0`), {
      params: Promise.resolve({ id: String(projectId), routeId: String(routeId + 1) }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, action: 'error' })
    expect(body.error).toContain('not found')
  })

  it('returns consistent error envelope for invalid query params', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })
    const routeId = seedDoctorRoute(projectId)

    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/routes/${routeId}/events?limit=0&offset=nope`), {
      params: Promise.resolve({ id: String(projectId), routeId: String(routeId) }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.action).toBe('error')
    expect(body.error).toBe('Invalid query params')
    expect(body.details?.[0]).toMatchObject({
      code: expect.any(String),
      path: expect.any(String),
      message: expect.any(String),
    })
  })

  it('returns route events with success envelope', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })
    const routeId = seedDoctorRoute(projectId)

    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/routes/${routeId}/events?limit=5&offset=0`), {
      params: Promise.resolve({ id: String(projectId), routeId: String(routeId) }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      action: 'list_route_events',
      route_id: routeId,
      pagination: { limit: 5, offset: 0 },
    })
    expect(Array.isArray(body.events)).toBe(true)
  })

  it('returns consistent 500 envelope for non-Error failures', async () => {
    vi.doMock('@/lib/waypoint-command', async () => {
      const actual = await vi.importActual<typeof import('@/lib/waypoint-command')>('@/lib/waypoint-command')
      return {
        ...actual,
        listWaypointRouteEvents: () => {
          throw 'boom'
        },
      }
    })

    const projectId = seedProject({ gsdEnabled: 1 })
    const routeId = seedDoctorRoute(projectId)

    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/routes/${routeId}/events`), {
      params: Promise.resolve({ id: String(projectId), routeId: String(routeId) }),
    })

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Failed to fetch Waypoint route events',
    })
  })
})
