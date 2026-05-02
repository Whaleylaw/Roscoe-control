import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { createWorkflowDefinition } from '@/lib/workflow-engine'

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

function req(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
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
  return import('@/app/api/projects/[id]/waypoint/command/route')
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

describe('POST /api/projects/:id/waypoint/command', () => {
  it('rejects viewer role', async () => {
    authRole = 'viewer'
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: '/waypoint status' }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(403)
  })

  it('returns 409 when waypoint lifecycle is not enabled', async () => {
    const projectId = seedProject({ gsdEnabled: 0 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: '/waypoint status' }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'Waypoint lifecycle is not enabled for this project',
    })
  })

  it('returns status command output when lifecycle is enabled', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: '/waypoint status' }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.command).toEqual({ name: 'status' })
    expect(body.status.project).toMatchObject({ id: projectId, waypoint_enabled: true })
  })

  it('starts a plan route', async () => {
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
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint start plan --plan-id ${planId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.command).toMatchObject({ name: 'start', target: 'plan', planId })
    expect(body.route.instanceId).toBeTypeOf('number')
  })

  it('starts a project doctor route', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    createWorkflowDefinition(
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

    const { POST } = await loadRoute()
    const res = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: '/waypoint doctor',
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.command).toEqual({ name: 'doctor', definitionSlug: 'waypoint-doctor', definitionVersion: 1 })
    expect(body.route.instanceId).toBeTypeOf('number')
  })

  it('starts a project forensics route', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    createWorkflowDefinition(
      db,
      `
schema_version: 1
id: waypoint-forensics
name: Waypoint Forensics
version: 1
subject_type: waypoint_project
vars:
  project_id:
    required: true
    type: number
nodes:
  reconstruct:
    type: recipe
    recipe: gsd-researcher
`,
      'tester',
      1,
      1,
    )

    const { POST } = await loadRoute()
    const res = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: '/waypoint forensics',
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.command).toEqual({
      name: 'forensics',
      definitionSlug: 'waypoint-forensics',
      definitionVersion: 1,
    })
    expect(body.route.instanceId).toBeTypeOf('number')
  })

  it('lists routes and supports pause/resume', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    createWorkflowDefinition(
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

    const { POST } = await loadRoute()
    const startRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: '/waypoint doctor',
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    const startBody = await startRes.json()
    const routeId = Number(startBody.route.instanceId)

    const listRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: '/waypoint routes',
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    expect(listBody.ok).toBe(true)
    expect(listBody.count).toBeGreaterThan(0)

    const detailRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint route --route-id ${routeId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    expect(detailRes.status).toBe(200)
    const detailBody = await detailRes.json()
    expect(detailBody.ok).toBe(true)
    expect(detailBody.route.id).toBe(routeId)
    expect(detailBody.node_count).toBeGreaterThanOrEqual(1)

    const pauseRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint pause --route-id ${routeId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    const pauseBody = await pauseRes.json()
    expect(pauseBody.route.status).toBe('blocked')

    const resumeRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint resume --route-id ${routeId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    const resumeBody = await resumeRes.json()
    expect(resumeBody.route.status).toBe('active')
  })

  it('starts task discussion and posts a message', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })
    const inserted = db
      .prepare(`INSERT INTO tasks (title, status, priority, workspace_id, project_id) VALUES ('Discuss scope', 'todo', 'medium', 1, ?)`)
      .run(projectId)
    const taskId = Number(inserted.lastInsertRowid)

    const { POST } = await loadRoute()
    const res = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint discuss --task-id ${taskId} --message Clarify acceptance criteria`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.command).toEqual({
      name: 'discuss',
      taskId,
      message: 'Clarify acceptance criteria',
    })
    expect(body.discussion.task_id).toBe(taskId)
    expect(body.discussion.message_count).toBe(1)
  })

  it('returns 400 for malformed command payload', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: 123 as unknown as string }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid request body')
  })
})
