import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'
import {
  createWorkflowDefinition,
  materializeReadyWorkflowNodes,
  startWorkflowInstance,
} from '@/lib/workflow-engine'

let testDb: Database.Database

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db')
  return { ...actual, getDatabase: () => testDb }
})
vi.mock('@/lib/auth', () => ({
  requireRole: () => ({
    user: {
      id: 1,
      username: 'operator',
      display_name: 'Operator',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
    },
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))

const { POST } = await import('../route')

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
})

afterEach(() => {
  testDb.close()
})

describe('POST /api/quality-review workflow advancement', () => {
  it('approval completes the workflow node and creates the next ready task', async () => {
    const project = testDb.prepare(`
      SELECT id FROM projects
      WHERE workspace_id = 1 AND slug = 'general'
      LIMIT 1
    `).get() as { id: number } | undefined
    expect(project).toBeTruthy()

    const definitionId = createWorkflowDefinition(testDb, `
schema_version: 1
id: route-approval-advancement
name: Route Approval Advancement
subject_type: law_firm_case
nodes:
  first_step:
    type: recipe
    recipe: hello-world
  second_step:
    type: recipe
    recipe: hello-world
    depends_on:
      - first_step
`, 'tester', 1, 1)

    const instance = startWorkflowInstance(testDb, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'abby-sitgraves',
      actor: 'tester',
      workspaceId: 1,
      tenantId: 1,
      now: 1000,
    })
    const materialized = materializeReadyWorkflowNodes(testDb, {
      workflowInstanceId: instance.instance_id,
      projectId: project!.id,
      workspaceId: 1,
      actor: 'tester',
      now: 1001,
    })
    const taskId = materialized.created[0].task_id
    testDb.prepare(`
      UPDATE tasks
      SET status = 'quality_review'
      WHERE id = ?
    `).run(taskId)

    const response = await POST(new Request('http://localhost/api/quality-review', {
      method: 'POST',
      body: JSON.stringify({
        taskId,
        reviewer: 'aegis',
        status: 'approved',
        notes: 'Looks correct.',
      }),
    }) as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.workflow_advancement.materialized.created).toMatchObject([{ node_key: 'second_step' }])
    expect(testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(taskId)).toMatchObject({ status: 'done' })
    expect(testDb.prepare(`
      SELECT status FROM workflow_node_instances
      WHERE workflow_instance_id = ? AND node_key = 'first_step'
    `).get(instance.instance_id)).toMatchObject({ status: 'complete' })
    expect(testDb.prepare(`
      SELECT COUNT(*) AS count FROM tasks
      WHERE metadata LIKE '%"node_key":"second_step"%'
    `).get()).toMatchObject({ count: 1 })
  })
})
