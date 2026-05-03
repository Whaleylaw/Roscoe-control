import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { createWorkflowDefinition } from '@/lib/workflow-engine'

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

function seedWaypointPlan(projectId: number): number {
  const ws = db.prepare(
    `INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
     VALUES (?, 'core', 'WS-1', 'active', unixepoch(), unixepoch())`,
  ).run(projectId)
  const workstreamId = Number(ws.lastInsertRowid)

  const ms = db.prepare(
    `INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at)
     VALUES (?, ?, 'v1', 'MS-1', 'active', unixepoch(), unixepoch())`,
  ).run(projectId, workstreamId)
  const milestoneId = Number(ms.lastInsertRowid)

  const ph = db.prepare(
    `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
     VALUES (?, '10', 'execute-phase', 'execute', 10, 'active', '[]', unixepoch(), unixepoch())`,
  ).run(milestoneId)
  const phaseId = Number(ph.lastInsertRowid)

  const pl = db.prepare(
    `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
     VALUES (?, 'P-1', 'Plan-1', 1, 'todo', '[]', unixepoch(), unixepoch())`,
  ).run(phaseId)

  return Number(pl.lastInsertRowid)
}

async function loadRoute() {
  return import('@/app/api/projects/[id]/waypoint/routes/route')
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

describe('POST /api/projects/:id/waypoint/routes', () => {
  it('rejects viewer role', async () => {
    authRole = 'viewer'
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/routes`, { subject: 'plan', plan_id: 1 }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(403)
  })

  it('returns 409 when waypoint lifecycle is not enabled', async () => {
    const projectId = seedProject({ gsdEnabled: 0 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/routes`, { subject: 'plan', plan_id: 1 }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, action: 'error' })
  })

  it('starts a typed plan route', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })
    const planId = seedWaypointPlan(projectId)

    createWorkflowDefinition(
      db,
      `
schema_version: 1
id: waypoint-plan-execution
name: Waypoint Plan Execution
version: 1
subject_type: waypoint_plan
vars:
  project_id:
    required: true
    type: number
  workstream_id:
    required: false
    type: number
  milestone_id:
    required: true
    type: number
  phase_id:
    required: true
    type: number
  plan_id:
    required: true
    type: number
  workspace_id:
    required: true
    type: number
nodes:
  implement_plan:
    type: recipe
    recipe: gsd-coder
`,
      'tester',
      1,
      1,
    )

    const { POST } = await loadRoute()
    const res = await POST(
      req(`/api/projects/${projectId}/waypoint/routes`, {
        subject: 'plan',
        plan_id: planId,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      action: 'start_route',
      subject: 'plan',
      plan_id: planId,
      definition_slug: 'waypoint-plan-execution',
      definition_version: 1,
    })
    expect(body.reused).toBeTypeOf('boolean')
    expect(body.workflow_instance_id).toBeTypeOf('number')
  })
})

describe('GET /api/projects/:id/waypoint/routes', () => {
  it('returns consistent error envelope for invalid query params', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/routes?limit=999`), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ ok: false, action: 'error', error: 'Invalid query params' })
  })

  it('lists routes with status filter and pagination', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })
    const planId = seedWaypointPlan(projectId)

    createWorkflowDefinition(
      db,
      `
schema_version: 1
id: waypoint-plan-execution
name: Waypoint Plan Execution
version: 1
subject_type: waypoint_plan
vars:
  project_id:
    required: true
    type: number
  workstream_id:
    required: false
    type: number
  milestone_id:
    required: true
    type: number
  phase_id:
    required: true
    type: number
  plan_id:
    required: true
    type: number
  workspace_id:
    required: true
    type: number
nodes:
  implement_plan:
    type: recipe
    recipe: gsd-coder
`,
      'tester',
      1,
      1,
    )

    const { POST, GET } = await loadRoute()
    await POST(
      req(`/api/projects/${projectId}/waypoint/routes`, {
        subject: 'plan',
        plan_id: planId,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/routes?status=active&limit=10&offset=0`), {
      params: Promise.resolve({ id: String(projectId) }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.action).toBe('list_routes')
    expect(body.filters).toMatchObject({ status: 'active' })
    expect(body.pagination).toMatchObject({ limit: 10, offset: 0 })
    expect(body.count).toBeGreaterThanOrEqual(1)
  })
})
