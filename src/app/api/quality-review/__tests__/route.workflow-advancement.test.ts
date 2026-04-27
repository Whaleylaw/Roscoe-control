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
vi.mock('@/lib/review-prs', () => ({
  publishApprovedWorktreeForReview: vi.fn(),
}))

const { POST } = await import('../route')
const { publishApprovedWorktreeForReview } = await import('@/lib/review-prs')

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  vi.mocked(publishApprovedWorktreeForReview).mockReset()
  vi.mocked(publishApprovedWorktreeForReview).mockResolvedValue({ published: false, reason: 'not_worktree_task' })
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

  it('approval publishes a review PR but does not mark done or advance workflow while PR is open', async () => {
    vi.mocked(publishApprovedWorktreeForReview).mockResolvedValueOnce({
      published: true,
      provider: 'forgejo',
      state: 'open',
      pr_number: 12,
      pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      branch: 'mc/task-1',
      base_ref: 'main',
    })

    const project = testDb.prepare(`
      SELECT id FROM projects
      WHERE workspace_id = 1 AND slug = 'general'
      LIMIT 1
    `).get() as { id: number } | undefined
    expect(project).toBeTruthy()

    const definitionId = createWorkflowDefinition(testDb, `
schema_version: 1
id: route-approval-review-pr
name: Route Approval Review PR
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
      now: 2000,
    })
    const materialized = materializeReadyWorkflowNodes(testDb, {
      workflowInstanceId: instance.instance_id,
      projectId: project!.id,
      workspaceId: 1,
      actor: 'tester',
      now: 2001,
    })
    const taskId = materialized.created[0].task_id
    testDb.prepare(`
      UPDATE tasks
      SET status = 'quality_review', worktree_path = '/tmp/task-worktree'
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
    expect(body.workflow_advancement).toBeNull()
    expect(body.review_pr).toMatchObject({
      published: true,
      pr_number: 12,
      pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
    })
    expect(testDb.prepare(`SELECT status, completed_at FROM tasks WHERE id = ?`).get(taskId)).toMatchObject({
      status: 'quality_review',
      completed_at: null,
    })
    expect(testDb.prepare(`
      SELECT status FROM workflow_node_instances
      WHERE workflow_instance_id = ? AND node_key = 'first_step'
    `).get(instance.instance_id)).toMatchObject({ status: 'running' })
    expect(testDb.prepare(`
      SELECT COUNT(*) AS count FROM tasks
      WHERE metadata LIKE '%"node_key":"second_step"%'
    `).get()).toMatchObject({ count: 0 })
    expect(testDb.prepare(`
      SELECT content FROM comments
      WHERE task_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(taskId)).toMatchObject({ content: expect.stringContaining('http://localhost:3001/aaron/FirmVault/pulls/12') })
  })

  it('approval does not mark done or advance workflow when review PR publication fails', async () => {
    vi.mocked(publishApprovedWorktreeForReview).mockRejectedValueOnce(new Error('target repo has uncommitted changes'))

    const project = testDb.prepare(`
      SELECT id FROM projects
      WHERE workspace_id = 1 AND slug = 'general'
      LIMIT 1
    `).get() as { id: number } | undefined
    expect(project).toBeTruthy()

    const definitionId = createWorkflowDefinition(testDb, `
schema_version: 1
id: route-approval-publication-failure
name: Route Approval Publication Failure
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
      now: 2000,
    })
    const materialized = materializeReadyWorkflowNodes(testDb, {
      workflowInstanceId: instance.instance_id,
      projectId: project!.id,
      workspaceId: 1,
      actor: 'tester',
      now: 2001,
    })
    const taskId = materialized.created[0].task_id
    testDb.prepare(`
      UPDATE tasks
      SET status = 'quality_review', worktree_path = '/tmp/task-worktree'
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

    expect(response.status).toBe(409)
    expect(body).toMatchObject({ success: false, error: 'Review PR publication failed' })
    expect(testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(taskId)).toMatchObject({ status: 'quality_review' })
    expect(testDb.prepare(`
      SELECT status FROM workflow_node_instances
      WHERE workflow_instance_id = ? AND node_key = 'first_step'
    `).get(instance.instance_id)).toMatchObject({ status: 'running' })
    expect(testDb.prepare(`
      SELECT COUNT(*) AS count FROM tasks
      WHERE metadata LIKE '%"node_key":"second_step"%'
    `).get()).toMatchObject({ count: 0 })
  })
})
