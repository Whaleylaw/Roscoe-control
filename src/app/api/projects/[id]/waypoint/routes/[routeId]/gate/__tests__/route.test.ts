import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { createWorkflowDefinition } from '@/lib/workflow-engine'
import { startOrReuseWaypointRoute, WAYPOINT_SUBJECT_TYPES } from '@/lib/waypoint'

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

function postReq(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function seedProject(gsdEnabled: number): number {
  const result = db.prepare(`INSERT INTO projects (workspace_id,name,slug,ticket_prefix,status,gsd_enabled,created_at,updated_at) VALUES (1,'Alpha','alpha','ALP','active',?,unixepoch(),unixepoch())`).run(gsdEnabled)
  return Number(result.lastInsertRowid)
}

function seedPlan(projectId: number): number {
  const ws = db.prepare(`INSERT INTO gsd_workstreams (project_id,key,name,status,created_at,updated_at) VALUES (?, 'core', 'WS-1','active',unixepoch(),unixepoch())`).run(projectId)
  const ms = db.prepare(`INSERT INTO gsd_milestones (project_id,workstream_id,version_label,title,status,created_at,updated_at) VALUES (?, ?, 'v1', 'MS-1','active',unixepoch(),unixepoch())`).run(projectId, Number(ws.lastInsertRowid))
  const ph = db.prepare(`INSERT INTO gsd_phases (milestone_id,phase_key,phase_slug,lifecycle_phase,ordering_numeric,status,depends_on_phase_ids,created_at,updated_at) VALUES (?, '10', 'execute-phase','execute',10,'active','[]',unixepoch(),unixepoch())`).run(Number(ms.lastInsertRowid))
  const pl = db.prepare(`INSERT INTO gsd_plans (phase_id,plan_ref,title,wave,status,depends_on_plan_ids,created_at,updated_at) VALUES (?, 'P-1', 'Plan-1',1,'todo','[]',unixepoch(),unixepoch())`).run(Number(ph.lastInsertRowid))
  return Number(pl.lastInsertRowid)
}

function seedRoute(projectId: number, planId: number): number {
  createWorkflowDefinition(db, `
schema_version: 1
id: waypoint-plan-execution
name: Waypoint Plan Execution
version: 1
subject_type: waypoint_plan
vars:
  project_id: { required: true, type: number }
  milestone_id: { required: true, type: number }
  phase_id: { required: true, type: number }
  plan_id: { required: true, type: number }
  workspace_id: { required: true, type: number }
nodes:
  quality_gate:
    type: review
    review:
      mode: human
`, 'tester', 1, 1)

  const scope = db.prepare(`SELECT gpl.id AS plan_id, gp.id AS phase_id, gm.id AS milestone_id FROM gsd_plans gpl JOIN gsd_phases gp ON gp.id = gpl.phase_id JOIN gsd_milestones gm ON gm.id = gp.milestone_id WHERE gpl.id = ? LIMIT 1`).get(planId) as { plan_id: number; phase_id: number; milestone_id: number }

  const route = startOrReuseWaypointRoute(db, {
    workspaceId: 1,
    tenantId: 1,
    actor: 'tester',
    projectId,
    subjectType: WAYPOINT_SUBJECT_TYPES.plan,
    subjectId: planId,
    definitionSlug: 'waypoint-plan-execution',
    definitionVersion: 1,
    vars: { project_id: projectId, milestone_id: scope.milestone_id, phase_id: scope.phase_id, plan_id: scope.plan_id, workspace_id: 1 },
  })
  return route.instanceId
}

async function loadRoute() {
  return import('@/app/api/projects/[id]/waypoint/routes/[routeId]/gate/route')
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

describe('POST /api/projects/:id/waypoint/routes/:routeId/gate', () => {
  it('rejects viewer role', async () => {
    authRole = 'viewer'
    const projectId = seedProject(1)
    const { POST } = await loadRoute()
    const res = await POST(postReq(`/api/projects/${projectId}/waypoint/routes/1/gate`, { node_key: 'quality_gate', decision: 'approve' }), { params: Promise.resolve({ id: String(projectId), routeId: '1' }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, action: 'route_gate', error: 'Forbidden' })
  })

  it('approves a gate node', async () => {
    const projectId = seedProject(1)
    const planId = seedPlan(projectId)
    const routeId = seedRoute(projectId, planId)

    const { POST } = await loadRoute()
    const res = await POST(postReq(`/api/projects/${projectId}/waypoint/routes/${routeId}/gate`, { node_key: 'quality_gate', decision: 'approve', note: 'looks good' }), { params: Promise.resolve({ id: String(projectId), routeId: String(routeId) }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.action).toBe('approve_gate')
    expect(body.node.status).toBe('complete')
  })
})
