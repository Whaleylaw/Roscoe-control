import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import { createWorkflowDefinition } from '../workflow-engine'
import { startOrReuseWaypointRoute } from '../waypoint'

describe('Waypoint route start/reuse', () => {
  it('starts a new route instance when none exists and reuses active instance by key', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = 1 AND slug = 'general'
        LIMIT 1
      `).get() as { id: number } | undefined
      expect(project).toBeTruthy()

      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: waypoint-plan-execution
name: Waypoint Plan Execution
version: 1
subject_type: waypoint_plan
vars:
  project_id:
    required: true
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
  objective:
    required: true
    type: string
nodes:
  implement_plan:
    type: recipe
    recipe: gsd-coder
`, 'tester', 1, 1)
      expect(definitionId).toBeGreaterThan(0)

      const first = startOrReuseWaypointRoute(db, {
        workspaceId: 1,
        tenantId: 1,
        actor: 'tester',
        projectId: project!.id,
        subjectType: 'waypoint_plan',
        subjectId: '88',
        definitionSlug: 'waypoint-plan-execution',
        definitionVersion: 1,
        vars: {
          project_id: project!.id,
          milestone_id: 9,
          phase_id: 12,
          plan_id: 88,
          objective: 'Execute plan 88',
        },
        now: 9000,
      })

      expect(first.reused).toBe(false)
      expect(first.instanceId).toBeGreaterThan(0)

      const second = startOrReuseWaypointRoute(db, {
        workspaceId: 1,
        tenantId: 1,
        actor: 'tester',
        projectId: project!.id,
        subjectType: 'waypoint_plan',
        subjectId: '88',
        definitionSlug: 'waypoint-plan-execution',
        definitionVersion: 1,
        vars: {
          project_id: project!.id,
          milestone_id: 9,
          phase_id: 12,
          plan_id: 88,
          objective: 'Execute plan 88',
        },
        now: 9001,
      })

      expect(second).toEqual({
        instanceId: first.instanceId,
        reused: true,
      })
    } finally {
      db.close()
    }
  })

  it('rejects route start when project lifecycle is disabled', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = 1 AND slug = 'general'
        LIMIT 1
      `).get() as { id: number } | undefined
      expect(project).toBeTruthy()

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

      expect(() =>
        startOrReuseWaypointRoute(db, {
          workspaceId: 1,
          tenantId: 1,
          actor: 'tester',
          projectId: project!.id,
          subjectType: 'waypoint_plan',
          subjectId: '88',
          definitionSlug: 'waypoint-plan-execution',
          definitionVersion: 1,
          vars: {
            project_id: project!.id,
            plan_id: 88,
            objective: 'Execute plan 88',
          },
          now: 9002,
        }),
      ).toThrow(/Waypoint lifecycle is not enabled/)
    } finally {
      db.close()
    }
  })
})
