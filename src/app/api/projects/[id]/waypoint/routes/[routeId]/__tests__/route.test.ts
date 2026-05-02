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
  const ws = db.prepare(`INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at) VALUES (?, 'core', 'WS-1', 'active', unixepoch(), unixepoch())`).run(projectId)
  const workstreamId = Number(ws.lastInsertRowid)
  const ms = db.prepare(`INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at) VALUES (?, ?, 'v1', 'MS-1', 'active', unixepoch(), unixepoch())`).run(projectId, workstreamId)
  const milestoneId = Number(ms.lastInsertRowid)
  const ph = db.prepare(`INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at) VALUES (?, '10', 'execute-phase', 'execute', 10, 'active', '[]', unixepoch(), unixepoch())`).run(milestoneId)
  const phaseId = Number(ph.lastInsertRowid)
  const pl = db.prepare(`INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at) VALUES (?, 'P-1', 'Plan-1', 1, 'todo', '[]', unixepoch(), unixepoch())`).run(phaseId)
  return Number(pl.lastInsertRowid)
}

function seedRoute(projectId: number, planId: number): number {
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

  const scope = db
    .prepare(`SELECT gpl.id AS plan_id, gp.id AS phase_id, gm.id AS milestone_id, gm.workstream_id FROM gsd_plans gpl JOIN gsd_phases gp ON gp.id = gpl.phase_id JOIN gsd_milestones gm ON gm.id = gp.milestone_id WHERE gpl.id = ? LIMIT 1`)
    .get(planId) as { plan_id: number; phase_id: number; milestone_id: number; workstream_id: number | null }

  const route = startOrReuseWaypointRoute(db, {
    workspaceId: 1,
    tenantId: 1,
    actor: 'tester',
    projectId,
    subjectType: WAYPOINT_SUBJECT_TYPES.plan,
    subjectId: planId,
    definitionSlug: 'waypoint-plan-execution',
    definitionVersion: 1,
    vars: {
      project_id: projectId,
      workstream_id: scope.workstream_id,
      milestone_id: scope.milestone_id,
      phase_id: scope.phase_id,
      plan_id: scope.plan_id,
      workspace_id: 1,
      objective: 'Plan-1',
    },
  })

  return route.instanceId
}

async function loadRoute() {
  return import('@/app/api/projects/[id]/waypoint/routes/[routeId]/route')
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

describe('GET /api/projects/:id/waypoint/routes/:routeId', () => {
  it('rejects viewer role', async () => {
    authRole = 'viewer'
    const projectId = seedProject({ gsdEnabled: 1 })
    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/routes/1`), {
      params: Promise.resolve({ id: String(projectId), routeId: '1' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns route detail with nodes', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })
    const planId = seedWaypointPlan(projectId)
    const routeId = seedRoute(projectId, planId)

    const { GET } = await loadRoute()
    const res = await GET(getReq(`/api/projects/${projectId}/waypoint/routes/${routeId}`), {
      params: Promise.resolve({ id: String(projectId), routeId: String(routeId) }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.action).toBe('get_route')
    expect(body.route.id).toBe(routeId)
    expect(body.node_count).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(body.nodes)).toBe(true)
  })
})
