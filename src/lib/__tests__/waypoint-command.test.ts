import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import { executeWaypointCommand, parseWaypointCommand } from '../waypoint-command'
import { startOrReuseWaypointRoute, WAYPOINT_SUBJECT_TYPES } from '../waypoint'
import { createWorkflowDefinition } from '../workflow-engine'

describe('waypoint command parser', () => {
  it('parses status with and without prefix', () => {
    expect(parseWaypointCommand('/waypoint status')).toEqual({ name: 'status' })
    expect(parseWaypointCommand('wp status')).toEqual({ name: 'status' })
  })

  it('parses help by default when empty', () => {
    expect(parseWaypointCommand('/waypoint')).toEqual({ name: 'help' })
    expect(parseWaypointCommand('')).toEqual({ name: 'help' })
  })

  it('parses start plan with defaults', () => {
    expect(parseWaypointCommand('/waypoint start plan --plan-id 88')).toEqual({
      name: 'start',
      target: 'plan',
      planId: 88,
      definitionSlug: 'waypoint-plan-execution',
      definitionVersion: 1,
    })
  })

  it('parses execute alias for plan execution', () => {
    expect(parseWaypointCommand('/waypoint execute --plan-id 88')).toEqual({
      name: 'start',
      target: 'plan',
      planId: 88,
      definitionSlug: 'waypoint-plan-execution',
      definitionVersion: 1,
    })
  })

  it('parses start plan with explicit definition/version', () => {
    expect(
      parseWaypointCommand('/waypoint start plan --plan-id 88 --definition waypoint-project-intake --version 2'),
    ).toEqual({
      name: 'start',
      target: 'plan',
      planId: 88,
      definitionSlug: 'waypoint-project-intake',
      definitionVersion: 2,
    })
  })

  it('parses auto with optional max iterations', () => {
    expect(parseWaypointCommand('/waypoint auto')).toEqual({ name: 'auto' })
    expect(parseWaypointCommand('/waypoint auto --max-iterations 5')).toEqual({
      name: 'auto',
      maxIterations: 5,
    })
  })

  it('parses auto status with optional pagination', () => {
    expect(parseWaypointCommand('/waypoint auto status')).toEqual({ name: 'auto_status' })
    expect(parseWaypointCommand('/waypoint auto status --limit 15 --offset 3')).toEqual({
      name: 'auto_status',
      limit: 15,
      offset: 3,
    })
  })

  it('parses discuss with and without message', () => {
    expect(parseWaypointCommand('/waypoint discuss --task-id 42')).toEqual({ name: 'discuss', taskId: 42 })
    expect(parseWaypointCommand('/waypoint discuss --task-id 42 --message hello there')).toEqual({
      name: 'discuss',
      taskId: 42,
      message: 'hello there',
    })
  })

  it('parses routes/route/route-events/pause/resume commands', () => {
    expect(parseWaypointCommand('/waypoint routes')).toEqual({ name: 'routes' })
    expect(parseWaypointCommand('/waypoint routes --status blocked')).toEqual({ name: 'routes', status: 'blocked' })
    expect(parseWaypointCommand('/waypoint routes --status active --limit 20 --offset 5')).toEqual({
      name: 'routes',
      status: 'active',
      limit: 20,
      offset: 5,
    })
    expect(parseWaypointCommand('/waypoint route --route-id 19')).toEqual({ name: 'route', routeId: 19 })
    expect(parseWaypointCommand('/waypoint route --id 19')).toEqual({ name: 'route', routeId: 19 })
    expect(parseWaypointCommand('/waypoint route-events --route-id 19')).toEqual({
      name: 'route_events',
      routeId: 19,
    })
    expect(parseWaypointCommand('/waypoint events --id 19 --limit 10 --offset 2')).toEqual({
      name: 'route_events',
      routeId: 19,
      limit: 10,
      offset: 2,
    })
    expect(parseWaypointCommand('/waypoint pause --route-id 19')).toEqual({ name: 'pause', routeId: 19 })
    expect(parseWaypointCommand('/waypoint pause --id 19')).toEqual({ name: 'pause', routeId: 19 })
    expect(parseWaypointCommand('/waypoint resume --route-id 19')).toEqual({ name: 'resume', routeId: 19 })
    expect(parseWaypointCommand('/waypoint resume --id 19')).toEqual({ name: 'resume', routeId: 19 })
    expect(parseWaypointCommand('/waypoint gate --route-id 19 --node quality_gate --approve')).toEqual({
      name: 'gate',
      routeId: 19,
      nodeKey: 'quality_gate',
      decision: 'approve',
    })
    expect(parseWaypointCommand('/waypoint gate --id 19 --node quality_gate --approve')).toEqual({
      name: 'gate',
      routeId: 19,
      nodeKey: 'quality_gate',
      decision: 'approve',
    })
    expect(parseWaypointCommand('/waypoint gate --route-id 19 --node quality_gate --reject --note needs changes')).toEqual({
      name: 'gate',
      routeId: 19,
      nodeKey: 'quality_gate',
      decision: 'reject',
      note: 'needs changes',
    })
  })

  it('parses doctor and forensics with defaults and overrides', () => {
    expect(parseWaypointCommand('/waypoint doctor')).toEqual({
      name: 'doctor',
      definitionSlug: 'waypoint-doctor',
      definitionVersion: 1,
    })
    expect(parseWaypointCommand('/waypoint forensics --definition waypoint-forensics-custom --version 2')).toEqual({
      name: 'forensics',
      definitionSlug: 'waypoint-forensics-custom',
      definitionVersion: 2,
    })
  })

  it('rejects invalid commands and malformed flags', () => {
    expect(() => parseWaypointCommand('/waypoint nonsense')).toThrow(/Unknown Waypoint command/)
    expect(() => parseWaypointCommand('/waypoint start plan')).toThrow(/--plan-id/)
    expect(() => parseWaypointCommand('/waypoint auto --max-iterations nope')).toThrow(/max-iterations/)
    expect(() => parseWaypointCommand('/waypoint discuss --task-id nope')).toThrow(/--task-id/)
  })
})

describe('waypoint command execution envelope', () => {
  it('returns consistent ok/command/action envelope for help', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const result = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: 1,
        actor: 'tester',
        rawCommand: '/waypoint help',
      })

      expect(result).toMatchObject({ ok: true, action: 'help', command: { name: 'help' } })
      expect(result).toHaveProperty('message')
    } finally {
      db.close()
    }
  })

  it('returns consistent ok/command/action envelope for status', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general' LIMIT 1`).get() as
        | { id: number }
        | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      const result = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: '/waypoint status',
      })

      expect(result).toMatchObject({ ok: true, action: 'status', command: { name: 'status' } })
      expect(result).toHaveProperty('status.project.id', project!.id)
      expect(result).toHaveProperty('summary.total_routes')
      expect(result).toHaveProperty('summary.active_routes')
      expect(result).toHaveProperty('summary.blocked_routes')
      expect(result).toHaveProperty('summary.complete_routes')
      expect(result).toHaveProperty('summary.cancelled_routes')
      expect(result).toHaveProperty('summary.failed_routes')
      expect(result).toHaveProperty('summary.pending_gates')
      expect(result).toHaveProperty('summary.waiting_on_gate_tasks')
    } finally {
      db.close()
    }
  })

  it('returns consistent ok/command/action envelope for auto status', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general' LIMIT 1`).get() as
        | { id: number }
        | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      const result = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: '/waypoint auto status --limit 5 --offset 0',
      })

      expect(result).toMatchObject({
        ok: true,
        action: 'auto_status',
        command: { name: 'auto_status', limit: 5, offset: 0 },
      })
      expect(result).toHaveProperty('runs')
      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('pagination', { limit: 5, offset: 0 })
    } finally {
      db.close()
    }
  })

  it('returns consistent ok/command/action envelope for discuss', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general' LIMIT 1`).get() as
        | { id: number }
        | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      const now = 8000
      const taskId = Number(db.prepare(`
        INSERT INTO tasks (title, description, status, priority, project_id, assigned_to, created_by, created_at, updated_at, workspace_id)
        VALUES ('Discuss scope', 'Clarify acceptance criteria', 'inbox', 'medium', ?, 'gsd-doc-drafter', 'tester', ?, ?, 1)
      `).run(project!.id, now, now).lastInsertRowid)

      const result = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: `/waypoint discuss --task-id ${taskId} --message hello`,
      })

      expect(result).toMatchObject({
        ok: true,
        action: 'discuss',
        command: { name: 'discuss', taskId, message: 'hello' },
      })
      expect(result).toHaveProperty('discussion.task_id', taskId)
      expect(result).toHaveProperty('discussion.posted_message_id')
      expect(result).toHaveProperty('discussion.message_count', 1)
      expect(result).toHaveProperty('discussion.messages.0.content', 'hello')
    } finally {
      db.close()
    }
  })

  it('returns consistent ok/command/action envelope for routes pagination', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general' LIMIT 1`).get() as
        | { id: number }
        | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      const result = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: '/waypoint routes --limit 10 --offset 0',
      })

      expect(result).toMatchObject({
        ok: true,
        action: 'routes',
        command: { name: 'routes', limit: 10, offset: 0 },
      })
      expect(result).toHaveProperty('routes')
      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('pagination', { limit: 10, offset: 0 })
    } finally {
      db.close()
    }
  })

  it('returns consistent ok/command/action envelope for route detail and route events', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general' LIMIT 1`).get() as
        | { id: number }
        | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      createWorkflowDefinition(db, `
schema_version: 1
id: waypoint-plan-execution
name: Waypoint Plan Execution
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
  implement_plan:
    type: recipe
    recipe: gsd-coder
`, 'tester', 1, 1)

      const route = startOrReuseWaypointRoute(db, {
        workspaceId: 1,
        tenantId: 1,
        actor: 'tester',
        projectId: project!.id,
        subjectType: WAYPOINT_SUBJECT_TYPES.plan,
        subjectId: 99,
        definitionSlug: 'waypoint-plan-execution',
        definitionVersion: 1,
        vars: { project_id: project!.id, plan_id: 99, objective: 'test objective' },
      })

      const routeDetail = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: `/waypoint route --route-id ${route.instanceId}`,
      })

      expect(routeDetail).toMatchObject({
        ok: true,
        action: 'route',
        command: { name: 'route', routeId: route.instanceId },
      })
      expect(routeDetail).toHaveProperty('route.id', route.instanceId)
      expect(routeDetail).toHaveProperty('nodes')
      expect(routeDetail).toHaveProperty('node_count')

      const routeEvents = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: `/waypoint route-events --route-id ${route.instanceId} --limit 10 --offset 0`,
      })

      expect(routeEvents).toMatchObject({
        ok: true,
        action: 'route_events',
        command: { name: 'route_events', routeId: route.instanceId, limit: 10, offset: 0 },
        route_id: route.instanceId,
      })
      expect(routeEvents).toHaveProperty('events')
      expect(routeEvents).toHaveProperty('count')
      expect(routeEvents).toHaveProperty('pagination', { limit: 10, offset: 0 })
    } finally {
      db.close()
    }
  })

  it('returns consistent ok/command/action envelope for auto execution', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general' LIMIT 1`).get() as
        | { id: number }
        | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      const result = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: '/waypoint auto --max-iterations 1',
      })

      expect(result).toMatchObject({
        ok: true,
        action: 'auto',
        command: { name: 'auto', maxIterations: 1 },
      })
      expect(result).toHaveProperty('autopilot')
      expect(result).toHaveProperty('autopilot.iterations')
    } finally {
      db.close()
    }
  })

  it('returns consistent ok/command/action envelope for start and doctor/forensics routes', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general' LIMIT 1`).get() as
        | { id: number }
        | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      const workstreamId = Number(db.prepare(`
        INSERT INTO gsd_workstreams (project_id, key, name, status)
        VALUES (?, 'core', 'Core', 'active')
      `).run(project!.id).lastInsertRowid)
      const milestoneId = Number(db.prepare(`
        INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status)
        VALUES (?, ?, 'v1', 'Milestone 1', 'active')
      `).run(project!.id, workstreamId).lastInsertRowid)
      const phaseId = Number(db.prepare(`
        INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status)
        VALUES (?, 'execute', 'execute', 'delivery', 1, 'active')
      `).run(milestoneId).lastInsertRowid)
      const planId = Number(db.prepare(`
        INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status)
        VALUES (?, 'P1', 'Plan 1', 'wave-1', 'in_progress')
      `).run(phaseId).lastInsertRowid)

      createWorkflowDefinition(db, `
 schema_version: 1
 id: waypoint-plan-execution
 name: Waypoint Plan Execution
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
   implement_plan:
     type: recipe
     recipe: gsd-coder
 `, 'tester', 1, 1)

      createWorkflowDefinition(db, `
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
   inspect:
     type: recipe
     recipe: gsd-generalist
 `, 'tester', 1, 1)

      createWorkflowDefinition(db, `
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
   inspect:
     type: recipe
     recipe: gsd-generalist
 `, 'tester', 1, 1)

      const started = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: `/waypoint start plan --plan-id ${planId}`,
      })
      expect(started).toMatchObject({
        ok: true,
        action: 'start',
        command: { name: 'start', planId, definitionSlug: 'waypoint-plan-execution', definitionVersion: 1 },
      })
      expect(started).toHaveProperty('route.instanceId')

      const executed = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: `/waypoint execute --plan-id ${planId}`,
      })
      expect(executed).toMatchObject({
        ok: true,
        action: 'start',
        command: { name: 'start', planId, definitionSlug: 'waypoint-plan-execution', definitionVersion: 1 },
      })
      expect(executed).toHaveProperty('route.instanceId')

      const doctor = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: '/waypoint doctor',
      })
      expect(doctor).toMatchObject({ ok: true, action: 'doctor', command: { name: 'doctor', definitionSlug: 'waypoint-doctor', definitionVersion: 1 } })
      expect(doctor).toHaveProperty('route.instanceId')

      const forensics = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: '/waypoint forensics',
      })
      expect(forensics).toMatchObject({ ok: true, action: 'forensics', command: { name: 'forensics', definitionSlug: 'waypoint-forensics', definitionVersion: 1 } })
      expect(forensics).toHaveProperty('route.instanceId')
    } finally {
      db.close()
    }
  })

  it('returns consistent ok/command/action envelope for pause/resume and gate decision', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general' LIMIT 1`).get() as
        | { id: number }
        | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      createWorkflowDefinition(db, `
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
`, 'tester', 1, 1)

      const route = startOrReuseWaypointRoute(db, {
        workspaceId: 1,
        tenantId: 1,
        actor: 'tester',
        projectId: project!.id,
        subjectType: WAYPOINT_SUBJECT_TYPES.plan,
        subjectId: 100,
        definitionSlug: 'waypoint-review-flow',
        definitionVersion: 1,
        vars: { project_id: project!.id, plan_id: 100, objective: 'needs review' },
      })

      db.prepare(`UPDATE workflow_instances SET status = 'active', completed_at = NULL WHERE id = ?`).run(route.instanceId)
      db.prepare(`UPDATE workflow_node_instances SET status = 'pending', completed_at = NULL WHERE workflow_instance_id = ?`).run(
        route.instanceId,
      )

      const paused = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: `/waypoint pause --id ${route.instanceId}`,
      })
      expect(paused).toMatchObject({
        ok: true,
        action: 'pause',
        command: { name: 'pause', routeId: route.instanceId },
        route: { id: route.instanceId, status: 'blocked' },
      })

      const resumed = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: `/waypoint resume --id ${route.instanceId}`,
      })
      expect(resumed).toMatchObject({
        ok: true,
        action: 'resume',
        command: { name: 'resume', routeId: route.instanceId },
        route: { id: route.instanceId, status: 'active' },
      })

      const approved = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: `/waypoint gate --id ${route.instanceId} --node quality_gate --approve --note looks good`,
      })
      expect(approved).toMatchObject({
        ok: true,
        action: 'gate',
        command: {
          name: 'gate',
          routeId: route.instanceId,
          nodeKey: 'quality_gate',
          decision: 'approve',
          note: 'looks good',
        },
      })
      expect(approved).toHaveProperty('route.id', route.instanceId)
      expect(approved).toHaveProperty('node.node_key', 'quality_gate')
      expect(approved).toHaveProperty('node.status', 'complete')
    } finally {
      db.close()
    }
  })
})
