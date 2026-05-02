import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import {
  createWorkflowDefinition,
  materializeReadyWorkflowNodes,
  startWorkflowInstance,
} from '@/lib/workflow-engine'

let testDb: Database.Database

const runOpenClaw = vi.fn()
const broadcast = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    logActivity: vi.fn(),
    createNotification: vi.fn(),
    ensureTaskSubscription: vi.fn(),
  },
}))

vi.mock('@/lib/command', () => ({
  runOpenClaw: (...args: unknown[]) => runOpenClaw(...args),
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: (...args: unknown[]) => broadcast(...args) },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/config', () => ({
  config: { openclawHome: null },
}))

vi.mock('@/lib/github-sync-engine', () => ({
  syncTaskOutbound: vi.fn(),
}))

vi.mock('@/lib/worktree-promotion', () => ({
  promoteApprovedWorktree: vi.fn(),
}))

const { runAegisReviews } = await import('@/lib/task-dispatch')

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  runOpenClaw.mockReset()
  broadcast.mockReset()
})

describe('runAegisReviews human workflow gates', () => {
  function projectId(): number {
    const project = testDb.prepare(`
      SELECT id FROM projects
      WHERE workspace_id = 1 AND slug = 'general'
      LIMIT 1
    `).get() as { id: number } | undefined
    if (!project) throw new Error('missing general project')
    return project.id
  }

  it('does not auto-review human workflow review gates while they are still in review', async () => {
    const metadata = JSON.stringify({
      workflow: {
        workflow_instance_id: 18,
        node_key: 'confirm_onboarding_documents',
        node_type: 'review',
        recipe_slug: null,
      },
    })
    testDb.prepare(`
      INSERT INTO tasks (id, title, description, status, priority, workspace_id, metadata, recipe_slug, created_at, updated_at)
      VALUES
        (6101, 'Human review gate', 'Owner answers a workflow question.', 'review', 'medium', 1, ?, NULL, unixepoch(), unixepoch())
    `).run(metadata)

    const result = await runAegisReviews()

    expect(result).toEqual({ ok: true, message: 'No tasks awaiting review' })
    expect(runOpenClaw).not.toHaveBeenCalled()
    expect(testDb.prepare(`SELECT status FROM tasks WHERE id = 6101`).get()).toMatchObject({ status: 'review' })
  })

  it('blocks a human workflow review gate in quality_review until an owner comment exists', async () => {
    const metadata = JSON.stringify({
      workflow: {
        workflow_instance_id: 18,
        node_key: 'confirm_onboarding_documents',
        node_type: 'review',
        recipe_slug: null,
      },
    })
    testDb.prepare(`
      INSERT INTO tasks (id, title, description, status, priority, workspace_id, metadata, recipe_slug, created_at, updated_at)
      VALUES (6102, 'Human gate in quality', 'Quality should require a human answer.', 'quality_review', 'medium', 1, ?, NULL, 100, 101)
    `).run(metadata)

    const result = await runAegisReviews()

    expect(result).toEqual({ ok: true, message: 'Human workflow reviews: 0 approved, 1 blocked' })
    expect(runOpenClaw).not.toHaveBeenCalled()
    expect(testDb.prepare(`SELECT status, error_message FROM tasks WHERE id = 6102`).get()).toMatchObject({
      status: 'quality_review',
      error_message: expect.stringContaining('requires an owner comment'),
    })
  })

  it('approves a human workflow review gate with an owner comment and advances the workflow', async () => {
    const definitionId = createWorkflowDefinition(testDb, `
schema_version: 1
id: human-review-quality-gate-test
name: Human Review Quality Gate Test
subject_type: law_firm_case
nodes:
  human_send_packet:
    type: review
    review:
      mode: human
    completes:
      - law_firm.landmarks.packet_sent
  follow_up:
    type: recipe
    recipe: hello-world
    depends_on:
      - human_send_packet
`, 'tester', 1, 1)
    const instance = startWorkflowInstance(testDb, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-case',
      actor: 'tester',
      workspaceId: 1,
      tenantId: 1,
      now: 100,
    })
    const materialized = materializeReadyWorkflowNodes(testDb, {
      workflowInstanceId: instance.instance_id,
      projectId: projectId(),
      workspaceId: 1,
      actor: 'tester',
      now: 101,
    })
    const taskId = materialized.created[0]?.task_id
    expect(taskId).toBeTruthy()
    testDb.prepare(`UPDATE tasks SET status = 'quality_review', updated_at = 102 WHERE id = ?`).run(taskId)
    testDb.prepare(`
      INSERT INTO comments (task_id, author, content, created_at, workspace_id)
      VALUES (?, 'Aaron', 'Packet sent by regular mail. No claim number yet.', 103, 1)
    `).run(taskId)

    const result = await runAegisReviews()

    expect(result).toEqual({ ok: true, message: 'Human workflow reviews: 1 approved, 0 blocked' })
    expect(runOpenClaw).not.toHaveBeenCalled()
    expect(testDb.prepare(`SELECT status, error_message FROM tasks WHERE id = ?`).get(taskId)).toMatchObject({
      status: 'done',
      error_message: null,
    })
    expect(testDb.prepare(`
      SELECT status FROM workflow_node_instances
      WHERE workflow_instance_id = ? AND node_key = 'human_send_packet'
    `).get(instance.instance_id)).toMatchObject({ status: 'complete' })
    expect(testDb.prepare(`
      SELECT status FROM workflow_node_dependencies
      WHERE workflow_instance_id = ? AND node_key = 'follow_up'
    `).get(instance.instance_id)).toMatchObject({ status: 'satisfied' })
    expect(testDb.prepare(`
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE metadata LIKE '%"node_key":"follow_up"%'
    `).get()).toMatchObject({ count: 1 })
    expect(testDb.prepare(`
      SELECT reviewer, status, notes FROM quality_reviews
      WHERE task_id = ?
    `).get(taskId)).toMatchObject({
      reviewer: 'human-workflow-review',
      status: 'approved',
      notes: expect.stringContaining('Packet sent by regular mail'),
    })
  })
})
