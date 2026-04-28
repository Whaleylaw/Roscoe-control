import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'
import {
  advanceWorkflowAfterTaskApproval,
  createWorkflowDefinition,
  materializeReadyWorkflowNodes,
  startWorkflowInstance,
} from '@/lib/workflow-engine'

const forgejoMocks = vi.hoisted(() => ({
  getPullRequest: vi.fn(),
}))

vi.mock('@/lib/task-runtime-settings', () => ({
  getProjectRepoMap: () => ({}),
  getReviewPrSettings: () => ({
    provider: 'forgejo',
    remoteName: 'forgejo',
    forgejoBaseUrl: 'http://localhost:3001',
    forgejoToken: 'secret',
    autoCreate: true,
  }),
}))

vi.mock('@/lib/forgejo-client', () => ({
  createForgejoClient: () => ({
    getPullRequest: forgejoMocks.getPullRequest,
  }),
}))

vi.mock('@/lib/workflow-engine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workflow-engine')>('@/lib/workflow-engine')
  return {
    ...actual,
    advanceWorkflowAfterTaskApproval: vi.fn(actual.advanceWorkflowAfterTaskApproval),
  }
})

const { reconcileOpenReviewPrs } = await import('@/lib/review-prs')

let db: Database.Database

function projectId(): number {
  const project = db.prepare(`
    SELECT id FROM projects
    WHERE workspace_id = 1 AND slug = 'general'
    LIMIT 1
  `).get() as { id: number } | undefined
  if (!project) throw new Error('missing general project')
  return project.id
}

function createWorkflowReviewTask(): number {
  const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: reconcile-review-pr-${Math.random().toString(16).slice(2)}
name: Reconcile Review PR
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
  const instance = startWorkflowInstance(db, {
    definitionId,
    subjectType: 'law_firm_case',
    subjectId: `subject-${definitionId}`,
    actor: 'tester',
    workspaceId: 1,
    tenantId: 1,
    now: 100,
  })
  const materialized = materializeReadyWorkflowNodes(db, {
    workflowInstanceId: instance.instance_id,
    projectId: projectId(),
    workspaceId: 1,
    actor: 'tester',
    now: 101,
  })
  const taskId = materialized.created[0]?.task_id
  if (!taskId) throw new Error('workflow task was not materialized')
  db.prepare(`
    UPDATE tasks
    SET status = 'quality_review', container_id = 'container-1', error_message = 'old error'
    WHERE id = ?
  `).run(taskId)
  return taskId
}

function createStandaloneReviewTask(status = 'quality_review'): number {
  const inserted = db.prepare(`
    INSERT INTO tasks (title, status, priority, workspace_id, container_id, error_message)
    VALUES ('Review PR task', ?, 'medium', 1, 'container-1', 'old error')
  `).run(status)
  return Number(inserted.lastInsertRowid)
}

function insertReviewPr(taskId: number, input: { id?: number; lastCheckedAt?: number | null; prNumber?: number } = {}): number {
  const prNumber = input.prNumber ?? 12
  const inserted = db.prepare(`
    INSERT INTO task_review_prs (
      id, task_id, workspace_id, provider, remote_name, remote_url, repo_owner, repo_name,
      base_ref, head_ref, branch_name, pr_number, pr_url, state, last_checked_at
    ) VALUES (?, ?, 1, 'forgejo', 'forgejo', 'ssh://git@localhost:2222/aaron/FirmVault.git',
      'aaron', 'FirmVault', 'main', 'mc/task-1', 'mc/task-1', ?,
      ?, 'open', ?)
  `).run(
    input.id ?? null,
    taskId,
    prNumber,
    `http://localhost:3001/aaron/FirmVault/pulls/${prNumber}`,
    input.lastCheckedAt ?? null,
  )
  return Number(inserted.lastInsertRowid)
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  forgejoMocks.getPullRequest.mockReset()
  vi.mocked(advanceWorkflowAfterTaskApproval).mockClear()
})

afterEach(() => {
  db.close()
})

describe('reconcileOpenReviewPrs', () => {
  it('marks merged PR task done and advances workflow', async () => {
    const taskId = createWorkflowReviewTask()
    insertReviewPr(taskId)
    forgejoMocks.getPullRequest.mockResolvedValue({
      number: 12,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      state: 'merged',
      head: 'mc/task-1',
      base: 'main',
      mergeCommitSha: 'abc123',
    })

    const result = await reconcileOpenReviewPrs(db, { actor: 'test-reconciler', now: 200 })

    expect(result).toEqual({ checked: 1, merged: [taskId], closed: [], errors: [] })
    expect(db.prepare(`
      SELECT status, container_id, error_message, completed_at, github_pr_state
      FROM tasks WHERE id = ?
    `).get(taskId)).toMatchObject({
      status: 'done',
      container_id: null,
      error_message: null,
      completed_at: 200,
      github_pr_state: 'merged',
    })
    expect(db.prepare(`
      SELECT state, merge_commit_sha, last_checked_at
      FROM task_review_prs WHERE task_id = ?
    `).get(taskId)).toMatchObject({
      state: 'merged',
      merge_commit_sha: 'abc123',
      last_checked_at: 200,
    })
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE metadata LIKE '%"node_key":"second_step"%'
    `).get()).toMatchObject({ count: 1 })
    expect(advanceWorkflowAfterTaskApproval).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        taskId,
        actor: 'test-reconciler',
        now: 200,
        status: 'inbox',
        payload: {
          source: 'review_pr_merged',
          review_pr_id: expect.any(Number),
          pr_number: 12,
          merge_commit_sha: 'abc123',
          merge_detection: 'forgejo_merged',
        },
      }),
    )
  })

  it('treats an open PR as merged when the base ref already contains the head sha', async () => {
    const taskId = createWorkflowReviewTask()
    insertReviewPr(taskId)
    forgejoMocks.getPullRequest.mockResolvedValue({
      number: 12,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      state: 'open',
      head: 'mc/task-1',
      headSha: 'same-sha',
      base: 'main',
      baseSha: 'same-sha',
      mergeCommitSha: null,
    })

    const result = await reconcileOpenReviewPrs(db, { actor: 'test-reconciler', now: 206 })

    expect(result).toEqual({ checked: 1, merged: [taskId], closed: [], errors: [] })
    expect(db.prepare(`
      SELECT status, completed_at, github_pr_state
      FROM tasks WHERE id = ?
    `).get(taskId)).toMatchObject({
      status: 'done',
      completed_at: 206,
      github_pr_state: 'merged',
    })
    expect(db.prepare(`
      SELECT state, merge_commit_sha, last_checked_at
      FROM task_review_prs WHERE task_id = ?
    `).get(taskId)).toMatchObject({
      state: 'merged',
      merge_commit_sha: 'same-sha',
      last_checked_at: 206,
    })
    expect(advanceWorkflowAfterTaskApproval).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        taskId,
        actor: 'test-reconciler',
        now: 206,
        status: 'inbox',
        payload: expect.objectContaining({
          merge_commit_sha: 'same-sha',
          merge_detection: 'base_contains_head',
        }),
      }),
    )
  })

  it('keeps a closed unmerged PR task in quality review and does not advance', async () => {
    const taskId = createStandaloneReviewTask()
    insertReviewPr(taskId)
    forgejoMocks.getPullRequest.mockResolvedValue({
      number: 12,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      state: 'closed',
      head: 'mc/task-1',
      base: 'main',
      mergeCommitSha: null,
    })

    const result = await reconcileOpenReviewPrs(db, { actor: 'test-reconciler', now: 201 })

    expect(result).toEqual({ checked: 1, merged: [], closed: [taskId], errors: [] })
    expect(db.prepare(`
      SELECT status, github_pr_state, container_id, error_message
      FROM tasks WHERE id = ?
    `).get(taskId)).toMatchObject({
      status: 'quality_review',
      github_pr_state: 'closed',
      container_id: 'container-1',
      error_message: 'old error',
    })
    expect(db.prepare(`
      SELECT state, last_checked_at
      FROM task_review_prs WHERE task_id = ?
    `).get(taskId)).toMatchObject({ state: 'closed', last_checked_at: 201 })
    expect(db.prepare(`
      SELECT author, content
      FROM comments
      WHERE task_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(taskId)).toMatchObject({
      author: 'test-reconciler',
      content: expect.stringContaining('closed without merge'),
    })
    expect(advanceWorkflowAfterTaskApproval).not.toHaveBeenCalled()
  })

  it('refreshes an open PR without advancing the task', async () => {
    const taskId = createStandaloneReviewTask()
    insertReviewPr(taskId)
    forgejoMocks.getPullRequest.mockResolvedValue({
      number: 12,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      state: 'open',
      head: 'mc/task-1',
      base: 'main',
      mergeCommitSha: null,
    })

    const result = await reconcileOpenReviewPrs(db, { actor: 'test-reconciler', now: 202 })

    expect(result).toEqual({ checked: 1, merged: [], closed: [], errors: [] })
    expect(db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(taskId)).toMatchObject({ status: 'quality_review' })
    expect(db.prepare(`
      SELECT state, last_checked_at
      FROM task_review_prs WHERE task_id = ?
    `).get(taskId)).toMatchObject({ state: 'open', last_checked_at: 202 })
    expect(advanceWorkflowAfterTaskApproval).not.toHaveBeenCalled()
  })

  it('rolls back task and PR updates when workflow advancement fails', async () => {
    const taskId = createStandaloneReviewTask()
    insertReviewPr(taskId)
    forgejoMocks.getPullRequest.mockResolvedValue({
      number: 12,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      state: 'merged',
      head: 'mc/task-1',
      base: 'main',
      mergeCommitSha: 'abc123',
    })
    vi.mocked(advanceWorkflowAfterTaskApproval).mockImplementationOnce(() => {
      throw new Error('advance failed')
    })

    const result = await reconcileOpenReviewPrs(db, { actor: 'test-reconciler', now: 203 })

    expect(result).toEqual({
      checked: 1,
      merged: [],
      closed: [],
      errors: [{ task_id: taskId, error: 'advance failed' }],
    })
    expect(db.prepare(`
      SELECT status, completed_at, github_pr_state
      FROM tasks WHERE id = ?
    `).get(taskId)).toMatchObject({
      status: 'quality_review',
      completed_at: null,
      github_pr_state: null,
    })
    expect(db.prepare(`
      SELECT state, merge_commit_sha, last_checked_at
      FROM task_review_prs WHERE task_id = ?
    `).get(taskId)).toMatchObject({
      state: 'open',
      merge_commit_sha: null,
      last_checked_at: null,
    })
  })

  it('checks open rows oldest first and honors the limit', async () => {
    const staleTaskId = createStandaloneReviewTask()
    const freshTaskId = createStandaloneReviewTask()
    insertReviewPr(freshTaskId, { lastCheckedAt: 50, prNumber: 13 })
    insertReviewPr(staleTaskId, { lastCheckedAt: 10, prNumber: 12 })
    forgejoMocks.getPullRequest.mockResolvedValue({
      number: 12,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      state: 'open',
      head: 'mc/task-1',
      base: 'main',
      mergeCommitSha: null,
    })

    const result = await reconcileOpenReviewPrs(db, { actor: 'test-reconciler', now: 204, limit: 1 })

    expect(result.checked).toBe(1)
    expect(db.prepare(`SELECT last_checked_at FROM task_review_prs WHERE task_id = ?`).get(staleTaskId)).toMatchObject({ last_checked_at: 204 })
    expect(db.prepare(`SELECT last_checked_at FROM task_review_prs WHERE task_id = ?`).get(freshTaskId)).toMatchObject({ last_checked_at: 50 })
  })

  it('scopes reconciliation to the requested workspace', async () => {
    db.prepare(`
      INSERT INTO workspaces (id, slug, name, tenant_id)
      VALUES (2, 'other', 'Other Workspace', 1)
    `).run()
    const workspaceOneTaskId = createStandaloneReviewTask()
    insertReviewPr(workspaceOneTaskId, { prNumber: 12 })
    const workspaceTwoTaskId = Number(db.prepare(`
      INSERT INTO tasks (title, status, priority, workspace_id, container_id)
      VALUES ('Other workspace review PR task', 'quality_review', 'medium', 2, 'container-2')
    `).run().lastInsertRowid)
    db.prepare(`
      INSERT INTO task_review_prs (
        task_id, workspace_id, provider, remote_name, remote_url, repo_owner, repo_name,
        base_ref, head_ref, branch_name, pr_number, pr_url, state
      ) VALUES (?, 2, 'forgejo', 'forgejo', 'ssh://git@localhost:2222/aaron/FirmVault.git',
        'aaron', 'FirmVault', 'main', 'mc/task-2', 'mc/task-2', 13,
        'http://localhost:3001/aaron/FirmVault/pulls/13', 'open')
    `).run(workspaceTwoTaskId)
    forgejoMocks.getPullRequest.mockResolvedValue({
      number: 12,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      state: 'open',
      head: 'mc/task-1',
      base: 'main',
      mergeCommitSha: null,
    })

    const result = await reconcileOpenReviewPrs(db, { actor: 'test-reconciler', workspaceId: 1, now: 205 })

    expect(result.checked).toBe(1)
    expect(forgejoMocks.getPullRequest).toHaveBeenCalledTimes(1)
    expect(forgejoMocks.getPullRequest).toHaveBeenCalledWith(expect.objectContaining({ number: 12 }))
    expect(db.prepare(`SELECT last_checked_at FROM task_review_prs WHERE task_id = ?`).get(workspaceOneTaskId)).toMatchObject({ last_checked_at: 205 })
    expect(db.prepare(`SELECT last_checked_at FROM task_review_prs WHERE task_id = ?`).get(workspaceTwoTaskId)).toMatchObject({ last_checked_at: null })
  })
})
