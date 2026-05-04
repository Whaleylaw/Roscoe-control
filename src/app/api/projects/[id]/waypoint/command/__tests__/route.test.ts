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
  it('rejects viewer role with a consistent error envelope', async () => {
    authRole = 'viewer'
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: '/waypoint status' }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Forbidden',
    })
  })

  it('returns consistent forbidden envelope when workspace access is denied', async () => {
    const { ensureTenantWorkspaceAccess, ForbiddenError } = await import('@/lib/workspaces')
    vi.mocked(ensureTenantWorkspaceAccess).mockImplementationOnce(() => {
      throw new ForbiddenError('Workspace access denied')
    })

    const projectId = seedProject({ gsdEnabled: 1 })
    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: '/waypoint status' }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Workspace access denied',
    })
  })

  it('returns consistent error envelope for invalid project id', async () => {
    const { POST } = await loadRoute()
    const res = await POST(req('/api/projects/not-a-number/waypoint/command', { command: '/waypoint status' }), {
      params: Promise.resolve({ id: 'not-a-number' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Invalid project ID',
    })
  })

  it('returns consistent error envelope when project is missing', async () => {
    const { POST } = await loadRoute()
    const res = await POST(req('/api/projects/999999/waypoint/command', { command: '/waypoint status' }), {
      params: Promise.resolve({ id: '999999' }),
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Project not found',
    })
  })

  it('returns 409 when waypoint lifecycle is not enabled', async () => {
    const projectId = seedProject({ gsdEnabled: 0 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: '/waypoint status' }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Waypoint lifecycle is not enabled for this project',
    })
  })

  it('returns structured envelope for invalid request body', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: '' }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.action).toBe('error')
    expect(body.error).toBe('Invalid request body')
    expect(body.details?.[0]).toMatchObject({
      code: expect.any(String),
      path: expect.any(String),
      message: expect.any(String),
    })
  })

  it('returns structured envelope for malformed JSON body', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const malformed = new NextRequest(`http://localhost/api/projects/${projectId}/waypoint/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"command":',
    })

    const res = await POST(malformed, {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.action).toBe('error')
    expect(body.error).toBe('Invalid request body')
    expect(Array.isArray(body.details)).toBe(true)
  })

  it('rejects whitespace-only command bodies instead of treating them as help', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: '   ' }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.action).toBe('error')
    expect(body.error).toBe('Invalid request body')
  })

  it('returns parsed command envelope when execution fails after body parse', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: '/waypoint route --route-id 999999',
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: `Route 999999 not found for project ${projectId}`,
      details: {
        command: { name: 'route', routeId: 999999 },
      },
    })
  })

  it('returns null command envelope when parse fails', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: '/wp execute --id nope',
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Missing or invalid --plan-id',
    })
  })

  it('returns null command envelope for auto status parse failures', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: '/wp auto status --limit nope',
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Invalid --limit value',
    })
  })

  it('returns status command output when lifecycle is enabled', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: '/wp status' }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.command).toEqual({ name: 'status' })
    expect(body.status.project).toMatchObject({ id: projectId, waypoint_enabled: true })
    expect(body.summary).toMatchObject({
      active_routes: expect.any(Number),
      blocked_routes: expect.any(Number),
      pending_gates: expect.any(Number),
      waiting_on_gate_tasks: expect.any(Number),
    })
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
    const started = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint start plan --plan-id ${planId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(started.status).toBe(200)
    const startedBody = await started.json()
    expect(startedBody.ok).toBe(true)
    expect(startedBody.command).toMatchObject({ name: 'start', target: 'plan', planId })
    expect(startedBody.route.instanceId).toBeTypeOf('number')

    const executed = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/wp execute --id ${planId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(executed.status).toBe(200)
    const executedBody = await executed.json()
    expect(executedBody.ok).toBe(true)
    expect(executedBody.command).toMatchObject({ name: 'start', target: 'plan', planId })
    expect(executedBody.route.instanceId).toBeTypeOf('number')
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

    const eventsRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint events --id ${routeId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    expect(eventsRes.status).toBe(200)
    const eventsBody = await eventsRes.json()
    expect(eventsBody.ok).toBe(true)
    expect(eventsBody.route_id).toBe(routeId)
    expect(eventsBody.count).toBeGreaterThanOrEqual(1)

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

  it('supports /wp discuss alias without message and returns consistent envelope', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })
    const inserted = db
      .prepare(`INSERT INTO tasks (title, status, priority, workspace_id, project_id) VALUES ('Discuss risks', 'todo', 'medium', 1, ?)`)
      .run(projectId)
    const taskId = Number(inserted.lastInsertRowid)

    const { POST } = await loadRoute()
    const res = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/wp discuss --task-id ${taskId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      action: 'discuss',
      command: { name: 'discuss', taskId },
    })
    expect(body.discussion.task_id).toBe(taskId)
    expect(body.discussion.posted_message_id).toBeNull()
    expect(body.discussion.message_count).toBe(0)
    expect(Array.isArray(body.discussion.messages)).toBe(true)
  })

  it('returns autopilot run history via auto status command', async () => {
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
    expect(startRes.status).toBe(200)

    const autoRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: '/waypoint auto --max-iterations 1',
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    expect(autoRes.status).toBe(200)

    const statusRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: '/waypoint auto status --limit 5 --offset 0',
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(statusRes.status).toBe(200)
    const statusBody = await statusRes.json()
    expect(statusBody.ok).toBe(true)
    expect(statusBody.action).toBe('auto_status')
    expect(statusBody.command).toEqual({ name: 'auto_status', limit: 5, offset: 0 })
    expect(Array.isArray(statusBody.runs)).toBe(true)
    expect(statusBody.count).toBeGreaterThanOrEqual(1)
    expect(statusBody.pagination).toEqual({ limit: 5, offset: 0 })
  })

  it('applies gate approve decision with consistent command/action envelope', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    createWorkflowDefinition(
      db,
      `
schema_version: 1
id: waypoint-review-flow
name: Waypoint Review Flow
version: 1
subject_type: waypoint_plan
vars:
  project_id:
    required: true
    type: number
  plan_id:
    required: true
    type: number
  objective:
    required: true
    type: string
nodes:
  quality_gate:
    type: gate
`,
      'tester',
      1,
      1,
    )

    const planId = seedWaypointPlan(projectId)
    const { POST } = await loadRoute()

    const startRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint start plan --plan-id ${planId} --definition waypoint-review-flow`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    expect(startRes.status).toBe(200)
    const startBody = await startRes.json()
    const routeId = Number(startBody.route.instanceId)

    db.prepare(`UPDATE workflow_instances SET status = 'active', completed_at = NULL WHERE id = ?`).run(routeId)
    db.prepare(`UPDATE workflow_node_instances SET status = 'pending', completed_at = NULL WHERE workflow_instance_id = ?`).run(routeId)

    const gateRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint gate --route-id ${routeId} --node quality_gate --approve --note looks good`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(gateRes.status).toBe(200)
    const gateBody = await gateRes.json()
    expect(gateBody.ok).toBe(true)
    expect(gateBody.action).toBe('gate')
    expect(gateBody.command).toEqual({
      name: 'gate',
      routeId,
      nodeKey: 'quality_gate',
      decision: 'approve',
      note: 'looks good',
    })
    expect(gateBody.route.id).toBe(routeId)
    expect(gateBody.node.node_key).toBe('quality_gate')
    expect(gateBody.node.status).toBe('complete')
  })

  it('supports /wp route and /wp events aliases with --id parity', async () => {
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
    const startRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint start plan --plan-id ${planId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    expect(startRes.status).toBe(200)
    const startBody = await startRes.json()
    const routeId = Number(startBody.route.instanceId)

    const routeRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/wp route --id ${routeId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(routeRes.status).toBe(200)
    await expect(routeRes.json()).resolves.toMatchObject({
      ok: true,
      action: 'route',
      command: { name: 'route', routeId },
      route: { id: routeId },
    })

    const eventsRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/wp events --id ${routeId} --limit 5 --offset 0`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )

    expect(eventsRes.status).toBe(200)
    await expect(eventsRes.json()).resolves.toMatchObject({
      ok: true,
      action: 'route_events',
      command: { name: 'route_events', routeId, limit: 5, offset: 0 },
      pagination: { limit: 5, offset: 0 },
    })
  })

  it('supports /wp pause and /wp resume aliases with --id parity', async () => {
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
    const startRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint start plan --plan-id ${planId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    expect(startRes.status).toBe(200)
    const startBody = await startRes.json()
    const routeId = Number(startBody.route.instanceId)

    const pauseRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/wp pause --id ${routeId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    expect(pauseRes.status).toBe(200)
    await expect(pauseRes.json()).resolves.toMatchObject({
      ok: true,
      action: 'pause',
      command: { name: 'pause', routeId },
      route: { id: routeId, status: 'blocked' },
    })

    const resumeRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/wp resume --id ${routeId}`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    expect(resumeRes.status).toBe(200)
    await expect(resumeRes.json()).resolves.toMatchObject({
      ok: true,
      action: 'resume',
      command: { name: 'resume', routeId },
      route: { id: routeId, status: 'active' },
    })
  })

  it('supports /wp gate alias with --id parity', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })
    const planId = seedWaypointPlan(projectId)

    createWorkflowDefinition(
      db,
      `
schema_version: 1
id: waypoint-review-flow
name: Waypoint Review Flow
version: 1
subject_type: waypoint_plan
vars:
  project_id:
    required: true
    type: number
  plan_id:
    required: true
    type: number
  objective:
    required: true
    type: string
nodes:
  quality_gate:
    type: gate
`,
      'tester',
      1,
      1,
    )

    const { POST } = await loadRoute()
    const startRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/waypoint start plan --plan-id ${planId} --definition waypoint-review-flow`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    expect(startRes.status).toBe(200)
    const startBody = await startRes.json()
    const routeId = Number(startBody.route.instanceId)

    db.prepare(`UPDATE workflow_instances SET status = 'active', completed_at = NULL WHERE id = ?`).run(routeId)
    db.prepare(`UPDATE workflow_node_instances SET status = 'pending', completed_at = NULL WHERE workflow_instance_id = ?`).run(routeId)

    const gateRes = await POST(
      req(`/api/projects/${projectId}/waypoint/command`, {
        command: `/wp gate --id ${routeId} --node quality_gate --approve --note alias parity`,
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    )
    expect(gateRes.status).toBe(200)
    await expect(gateRes.json()).resolves.toMatchObject({
      ok: true,
      action: 'gate',
      command: {
        name: 'gate',
        routeId,
        nodeKey: 'quality_gate',
        decision: 'approve',
        note: 'alias parity',
      },
      node: { node_key: 'quality_gate', status: 'complete' },
    })
  })

  it('returns consistent error envelope for malformed command payload', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: 123 as unknown as string }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      action: 'error',
      error: 'Invalid request body',
    })
  })

  it('returns consistent error envelope when command execution fails', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/projects/${projectId}/waypoint/command`, { command: '/waypoint nope' }), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      action: 'error',
      error: 'Unknown Waypoint command: nope',
    })
  })
})
