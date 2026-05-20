import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import {
  createWorkflowDefinition,
  materializeReadyWorkflowNodes,
  startWorkflowInstance,
} from '../workflow-engine'

describe('Waypoint workflow materialization', () => {
  it('materializes Waypoint recipe nodes with lifecycle task metadata', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = 1 AND slug = 'general'
        LIMIT 1
      `).get() as { id: number } | undefined
      expect(project).toBeTruthy()

      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: waypoint-test-materialization
name: Waypoint Test Materialization
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
nodes:
  implement_plan:
    type: recipe
    recipe: gsd-coder
`, 'tester', 1, 1)

      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'waypoint_plan',
        subjectId: '88',
        workflowKey: 'waypoint:waypoint_plan:88:waypoint-test-materialization:v1',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        vars: {
          project_id: project!.id,
          workstream_id: 7,
          milestone_id: 9,
          phase_id: 12,
          plan_id: 88,
        },
        now: 7000,
      })

      const materialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project!.id,
        workspaceId: 1,
        actor: 'tester',
        now: 7001,
      })

      expect(materialized.created).toMatchObject([{ node_key: 'implement_plan' }])
      const task = db.prepare(`
        SELECT gsd_workstream_id, gsd_milestone_id, gsd_phase_id, gsd_plan_id, metadata
        FROM tasks
        WHERE id = ?
      `).get(materialized.created[0].task_id) as {
        gsd_workstream_id: number | null
        gsd_milestone_id: number | null
        gsd_phase_id: number | null
        gsd_plan_id: number | null
        metadata: string
      }

      expect(task).toMatchObject({
        gsd_workstream_id: 7,
        gsd_milestone_id: 9,
        gsd_phase_id: 12,
        gsd_plan_id: 88,
      })
      expect(JSON.parse(task.metadata)).toMatchObject({
        waypoint: {
          project_id: project!.id,
          workstream_id: 7,
          milestone_id: 9,
          phase_id: 12,
          plan_id: 88,
        },
      })
    } finally {
      db.close()
    }
  })

  it('enables task-scoped discussion metadata from Waypoint node config', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = 1 AND slug = 'general'
        LIMIT 1
      `).get() as { id: number } | undefined
      expect(project).toBeTruthy()

      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: waypoint-test-discussion-materialization
name: Waypoint Test Discussion Materialization
subject_type: waypoint_plan
vars:
  project_id:
    required: true
    type: number
  plan_id:
    required: true
    type: number
nodes:
  discuss_plan:
    type: recipe
    recipe: gsd-doc-drafter
    config:
      waypoint:
        discussion:
          enabled: true
          agent: gsd-doc-drafter
          prompt: Clarify project objective and acceptance criteria with the operator.
`, 'tester', 1, 1)

      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'waypoint_plan',
        subjectId: '88',
        workflowKey: 'waypoint:waypoint_plan:88:waypoint-test-discussion-materialization:v1',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        vars: {
          project_id: project!.id,
          plan_id: 88,
        },
        now: 7100,
      })

      const materialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project!.id,
        workspaceId: 1,
        actor: 'tester',
        now: 7101,
      })

      const task = db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(materialized.created[0].task_id) as { metadata: string }
      expect(JSON.parse(task.metadata)).toMatchObject({
        waypoint: {
          discussion: {
            enabled: true,
            mode: 'agent_chat',
            conversation_id: `task:${materialized.created[0].task_id}:discussion:gsd-doc-drafter`,
            agent: 'gsd-doc-drafter',
            prompt: 'Clarify project objective and acceptance criteria with the operator.',
            status: 'pending',
          },
        },
      })
    } finally {
      db.close()
    }
  })
})
