import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import { createWorkflowDefinition, startWorkflowInstance } from '../workflow-engine'
import { getWaypointStatus } from '../waypoint'

describe('Waypoint status read model', () => {
  it('aggregates project lifecycle, routes, nodes, and tasks', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`
        SELECT id, name FROM projects
        WHERE workspace_id = 1 AND slug = 'general'
        LIMIT 1
      `).get() as { id: number; name: string } | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      const workstreamId = Number(db.prepare(`
        INSERT INTO gsd_workstreams (project_id, key, name, status)
        VALUES (?, 'core', 'Core', 'active')
      `).run(project!.id).lastInsertRowid)
      const milestoneId = Number(db.prepare(`
        INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status)
        VALUES (?, ?, 'M1', 'Milestone 1', 'active')
      `).run(project!.id, workstreamId).lastInsertRowid)
      const phaseId = Number(db.prepare(`
        INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status)
        VALUES (?, 'execute', 'execute', 'execute', 1, 'active')
      `).run(milestoneId).lastInsertRowid)
      const planId = Number(db.prepare(`
        INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status)
        VALUES (?, 'P1', 'Plan 1', 1, 'in_progress')
      `).run(phaseId).lastInsertRowid)

      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: waypoint-status-test
name: Waypoint Status Test
subject_type: waypoint_plan
nodes:
  implement_plan:
    type: recipe
    recipe: gsd-coder
`, 'tester', 1, 1)
      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'waypoint_plan',
        subjectId: String(planId),
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        vars: {
          project_id: project!.id,
          workstream_id: workstreamId,
          milestone_id: milestoneId,
          phase_id: phaseId,
          plan_id: planId,
        },
        now: 8000,
      })

      const taskId = Number(db.prepare(`
        INSERT INTO tasks (
          title, description, status, priority, project_id, project_ticket_no, created_by,
          created_at, updated_at, tags, metadata, workspace_id,
          gsd_workstream_id, gsd_milestone_id, gsd_phase_id, gsd_plan_id
        ) VALUES ('Implement plan', 'body', 'inbox', 'medium', ?, 1, 'tester', 8001, 8001, '[]', '{}', 1, ?, ?, ?, ?)
      `).run(project!.id, workstreamId, milestoneId, phaseId, planId).lastInsertRowid)
      db.prepare(`UPDATE workflow_node_instances SET task_id = ?, status = 'running' WHERE workflow_instance_id = ? AND node_key = 'implement_plan'`).run(taskId, instance.instance_id)

      const status = getWaypointStatus(db, { projectId: project!.id, workspaceId: 1 })

      expect(status.project).toMatchObject({ id: project!.id, name: project!.name, waypoint_enabled: true })
      expect(status.lifecycle.workstreams).toMatchObject([{ id: workstreamId, key: 'core', status: 'active' }])
      expect(status.lifecycle.milestones).toMatchObject([{ id: milestoneId, title: 'Milestone 1', status: 'active' }])
      expect(status.lifecycle.active_phase).toMatchObject({ id: phaseId, phase_key: 'execute' })
      expect(status.lifecycle.active_plan).toMatchObject({ id: planId, plan_ref: 'P1' })
      expect(status.routes).toMatchObject([
        {
          workflow_instance_id: instance.instance_id,
          definition_slug: 'waypoint-status-test',
          subject_type: 'waypoint_plan',
          subject_id: String(planId),
          status: 'active',
          nodes: [{ node_key: 'implement_plan', status: 'running', task_id: taskId }],
        },
      ])
      expect(status.tasks.active).toMatchObject([{ id: taskId, title: 'Implement plan', gsd_plan_id: planId }])
      expect(status.next_actions).toContain('Continue active Waypoint tasks or wait for their completion.')
    } finally {
      db.close()
    }
  })
})
