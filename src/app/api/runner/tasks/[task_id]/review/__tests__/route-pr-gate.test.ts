// @vitest-environment node

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'

let testDb: Database.Database
let authTaskId = 0
const broadcastMock = vi.fn()
const advanceWorkflowAfterTaskApprovalMock = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
}))

vi.mock('@/lib/auth', () => ({
  requireRole: () => ({
    user: {
      id: -2000,
      username: 'runner-token',
      display_name: 'Runner Token',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
      runner_token_task_id: authTaskId,
    },
  }),
}))

vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast: (...args: unknown[]) => broadcastMock(...args),
    on: vi.fn(),
    emit: vi.fn(),
  },
}))

vi.mock('@/lib/review-prs', () => ({
  publishApprovedWorktreeForReview: vi.fn(),
}))

vi.mock('@/lib/workflow-engine', () => ({
  advanceWorkflowAfterTaskApproval: (...args: unknown[]) => advanceWorkflowAfterTaskApprovalMock(...args),
}))

const { POST } = await import('../route')
const { issueRunnerToken } = await import('@/lib/runner-tokens')
const { publishApprovedWorktreeForReview } = await import('@/lib/review-prs')

function seedTask(id: number): void {
  testDb.prepare(`
    INSERT INTO tasks (
      id, title, status, priority, workspace_id, recipe_slug,
      container_id, worktree_path, workspace_source
    ) VALUES (?, ?, 'quality_review', 'medium', 1, 'hello-world', ?, ?, ?)
  `).run(
    id,
    `task ${id}`,
    `container-${id}`,
    `/tmp/task-${id}`,
    JSON.stringify({ project_id: 1, base_ref: 'main' }),
  )
}

type ReviewBody = { verdict: 'approved' | 'rejected' | 'blocked'; notes: string }

function reviewRequest(taskId: number, body: ReviewBody = { verdict: 'approved', notes: 'Looks correct.' }): NextRequest {
  return new NextRequest(`http://localhost/api/runner/tasks/${taskId}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function review(taskId: number, body: ReviewBody = { verdict: 'approved', notes: 'Looks correct.' }) {
  return POST(reviewRequest(taskId, body), {
    params: Promise.resolve({ task_id: String(taskId) }),
  })
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  authTaskId = 0
  broadcastMock.mockReset()
  advanceWorkflowAfterTaskApprovalMock.mockReset()
  vi.mocked(publishApprovedWorktreeForReview).mockReset()
})

afterEach(() => {
  testDb.close()
})

describe('POST /api/runner/tasks/:task_id/review PR gate', () => {
  it('opens a review PR, keeps the task in quality_review, revokes tokens, and does not advance workflow', async () => {
    authTaskId = 44
    seedTask(44)
    issueRunnerToken(testDb, 44, 1, 300)
    vi.mocked(publishApprovedWorktreeForReview).mockResolvedValueOnce({
      published: true,
      provider: 'forgejo',
      state: 'open',
      pr_number: 12,
      pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      branch: 'mc/task-44',
      base_ref: 'main',
    })

    const response = await review(44)

    expect(response.status).toBe(204)
    expect(testDb.prepare(`
      SELECT status, container_id, error_message, completed_at
      FROM tasks
      WHERE id = 44
    `).get()).toMatchObject({
      status: 'quality_review',
      container_id: null,
      error_message: null,
      completed_at: null,
    })
    expect(testDb.prepare(`
      SELECT revoked_at FROM task_runner_tokens WHERE task_id = 44
    `).get()).toMatchObject({ revoked_at: expect.any(Number) })
    expect(testDb.prepare(`
      SELECT content FROM comments WHERE task_id = 44 ORDER BY id DESC LIMIT 1
    `).get()).toMatchObject({ content: expect.stringContaining('http://localhost:3001/aaron/FirmVault/pulls/12') })
    expect(advanceWorkflowAfterTaskApprovalMock).not.toHaveBeenCalled()
    expect(broadcastMock).toHaveBeenCalledWith('task.status_changed', expect.objectContaining({
      task_id: 44,
      status: 'quality_review',
      reason: 'review_pr_opened',
      workspace_id: 1,
    }))
  })

  it('does not record a stale approval if review PR publication succeeds after task leaves quality_review', async () => {
    authTaskId = 48
    seedTask(48)
    issueRunnerToken(testDb, 48, 1, 300)
    vi.mocked(publishApprovedWorktreeForReview).mockImplementationOnce(async () => {
      testDb.prepare(`UPDATE tasks SET status = 'review' WHERE id = 48`).run()
      return {
        published: true,
        provider: 'forgejo',
        state: 'open',
        pr_number: 12,
        pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
        branch: 'mc/task-48',
        base_ref: 'main',
      }
    })

    const response = await review(48)

    expect(response.status).toBe(500)
    expect(testDb.prepare(`
      SELECT status, container_id, error_message, completed_at
      FROM tasks
      WHERE id = 48
    `).get()).toMatchObject({
      status: 'review',
      container_id: 'container-48',
      error_message: null,
      completed_at: null,
    })
    expect(testDb.prepare(`
      SELECT revoked_at FROM task_runner_tokens WHERE task_id = 48
    `).get()).toMatchObject({ revoked_at: null })
    expect(testDb.prepare(`SELECT COUNT(*) AS count FROM quality_reviews WHERE task_id = 48`).get()).toMatchObject({ count: 0 })
    expect(testDb.prepare(`SELECT COUNT(*) AS count FROM comments WHERE task_id = 48`).get()).toMatchObject({ count: 0 })
    expect(advanceWorkflowAfterTaskApprovalMock).not.toHaveBeenCalled()
    expect(broadcastMock).not.toHaveBeenCalledWith('task.status_changed', expect.objectContaining({ reason: 'review_pr_opened' }))
  })

  it('marks done and advances workflow directly when publication reports no changes', async () => {
    authTaskId = 45
    seedTask(45)
    issueRunnerToken(testDb, 45, 1, 300)
    vi.mocked(publishApprovedWorktreeForReview).mockResolvedValueOnce({ published: false, reason: 'no_changes' })

    const response = await review(45)

    expect(response.status).toBe(204)
    expect(testDb.prepare(`
      SELECT status, container_id, error_message, completed_at
      FROM tasks
      WHERE id = 45
    `).get()).toMatchObject({
      status: 'done',
      container_id: null,
      error_message: null,
      completed_at: expect.any(Number),
    })
    expect(testDb.prepare(`
      SELECT revoked_at FROM task_runner_tokens WHERE task_id = 45
    `).get()).toMatchObject({ revoked_at: expect.any(Number) })
    expect(advanceWorkflowAfterTaskApprovalMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock).toHaveBeenCalledWith('task.status_changed', expect.objectContaining({
      task_id: 45,
      status: 'done',
      workspace_id: 1,
    }))
  })

  it('does not leave the task done when direct workflow advancement fails', async () => {
    authTaskId = 46
    seedTask(46)
    issueRunnerToken(testDb, 46, 1, 300)
    vi.mocked(publishApprovedWorktreeForReview).mockResolvedValueOnce({ published: false, reason: 'no_changes' })
    advanceWorkflowAfterTaskApprovalMock.mockImplementationOnce(() => {
      throw new Error('workflow advancement failed')
    })

    const response = await review(46)

    expect(response.status).toBe(500)
    expect(testDb.prepare(`
      SELECT status, container_id, error_message, completed_at
      FROM tasks
      WHERE id = 46
    `).get()).toMatchObject({
      status: 'quality_review',
      container_id: 'container-46',
      error_message: null,
      completed_at: null,
    })
    expect(testDb.prepare(`
      SELECT revoked_at FROM task_runner_tokens WHERE task_id = 46
    `).get()).toMatchObject({ revoked_at: null })
    expect(testDb.prepare(`SELECT COUNT(*) AS count FROM quality_reviews WHERE task_id = 46`).get()).toMatchObject({ count: 0 })
    expect(broadcastMock).not.toHaveBeenCalledWith('task.status_changed', expect.objectContaining({ status: 'done' }))
  })

  it('does not advance a stale approval if the task leaves quality_review during publication', async () => {
    authTaskId = 47
    seedTask(47)
    issueRunnerToken(testDb, 47, 1, 300)
    vi.mocked(publishApprovedWorktreeForReview).mockImplementationOnce(async () => {
      testDb.prepare(`UPDATE tasks SET status = 'review' WHERE id = 47`).run()
      return { published: false, reason: 'no_changes' }
    })

    const response = await review(47)

    expect(response.status).toBe(500)
    expect(testDb.prepare(`
      SELECT status, container_id, error_message, completed_at
      FROM tasks
      WHERE id = 47
    `).get()).toMatchObject({
      status: 'review',
      container_id: 'container-47',
      error_message: null,
      completed_at: null,
    })
    expect(testDb.prepare(`
      SELECT revoked_at FROM task_runner_tokens WHERE task_id = 47
    `).get()).toMatchObject({ revoked_at: null })
    expect(testDb.prepare(`SELECT COUNT(*) AS count FROM quality_reviews WHERE task_id = 47`).get()).toMatchObject({ count: 0 })
    expect(advanceWorkflowAfterTaskApprovalMock).not.toHaveBeenCalled()
    expect(broadcastMock).not.toHaveBeenCalledWith('task.status_changed', expect.objectContaining({ status: 'done' }))
  })

  it('does not record a stale blocker if PR publication fails after task leaves quality_review', async () => {
    authTaskId = 49
    seedTask(49)
    issueRunnerToken(testDb, 49, 1, 300)
    vi.mocked(publishApprovedWorktreeForReview).mockImplementationOnce(async () => {
      testDb.prepare(`UPDATE tasks SET status = 'review' WHERE id = 49`).run()
      throw new Error('forgejo unavailable')
    })

    const response = await review(49)

    expect(response.status).toBe(500)
    expect(testDb.prepare(`
      SELECT status, container_id, error_message, completed_at
      FROM tasks
      WHERE id = 49
    `).get()).toMatchObject({
      status: 'review',
      container_id: 'container-49',
      error_message: null,
      completed_at: null,
    })
    expect(testDb.prepare(`
      SELECT revoked_at FROM task_runner_tokens WHERE task_id = 49
    `).get()).toMatchObject({ revoked_at: null })
    expect(testDb.prepare(`SELECT COUNT(*) AS count FROM quality_reviews WHERE task_id = 49`).get()).toMatchObject({ count: 0 })
    expect(testDb.prepare(`SELECT COUNT(*) AS count FROM comments WHERE task_id = 49`).get()).toMatchObject({ count: 0 })
    expect(broadcastMock).not.toHaveBeenCalledWith('task.status_changed', expect.objectContaining({ reason: 'review_pr_publication_failed' }))
  })

  it('rolls back stale rejected reviews when the guarded transition cannot apply', async () => {
    authTaskId = 50
    seedTask(50)
    issueRunnerToken(testDb, 50, 1, 300)
    testDb.exec(`
      CREATE TRIGGER stale_reject_review
      BEFORE INSERT ON quality_reviews
      WHEN NEW.task_id = 50
      BEGIN
        UPDATE tasks SET status = 'review' WHERE id = 50;
      END;
    `)

    const response = await review(50, { verdict: 'rejected', notes: 'Needs more work.' })

    expect(response.status).toBe(500)
    expect(testDb.prepare(`
      SELECT status, container_id, error_message, completed_at
      FROM tasks
      WHERE id = 50
    `).get()).toMatchObject({
      status: 'quality_review',
      container_id: 'container-50',
      error_message: null,
      completed_at: null,
    })
    expect(testDb.prepare(`
      SELECT revoked_at FROM task_runner_tokens WHERE task_id = 50
    `).get()).toMatchObject({ revoked_at: null })
    expect(testDb.prepare(`SELECT COUNT(*) AS count FROM quality_reviews WHERE task_id = 50`).get()).toMatchObject({ count: 0 })
    expect(testDb.prepare(`SELECT COUNT(*) AS count FROM comments WHERE task_id = 50`).get()).toMatchObject({ count: 0 })
    expect(broadcastMock).not.toHaveBeenCalledWith('task.status_changed', expect.objectContaining({ reason: 'recipe_review_rejected' }))
  })

  it('rolls back stale blocked reviews when the guarded transition cannot apply', async () => {
    authTaskId = 51
    seedTask(51)
    issueRunnerToken(testDb, 51, 1, 300)
    testDb.exec(`
      CREATE TRIGGER stale_blocked_review
      BEFORE INSERT ON quality_reviews
      WHEN NEW.task_id = 51
      BEGIN
        UPDATE tasks SET status = 'review' WHERE id = 51;
      END;
    `)

    const response = await review(51, { verdict: 'blocked', notes: 'Need human input.' })

    expect(response.status).toBe(500)
    expect(testDb.prepare(`
      SELECT status, container_id, error_message, completed_at
      FROM tasks
      WHERE id = 51
    `).get()).toMatchObject({
      status: 'quality_review',
      container_id: 'container-51',
      error_message: null,
      completed_at: null,
    })
    expect(testDb.prepare(`
      SELECT revoked_at FROM task_runner_tokens WHERE task_id = 51
    `).get()).toMatchObject({ revoked_at: null })
    expect(testDb.prepare(`SELECT COUNT(*) AS count FROM quality_reviews WHERE task_id = 51`).get()).toMatchObject({ count: 0 })
    expect(testDb.prepare(`SELECT COUNT(*) AS count FROM comments WHERE task_id = 51`).get()).toMatchObject({ count: 0 })
    expect(broadcastMock).not.toHaveBeenCalledWith('task.status_changed', expect.objectContaining({ reason: 'recipe_review_blocked' }))
  })

  it('moves blocked recipe reviews back to review so the reviewer does not loop', async () => {
    authTaskId = 52
    seedTask(52)
    issueRunnerToken(testDb, 52, 1, 300)

    const response = await review(52, { verdict: 'blocked', notes: 'Need reporting agency.' })

    expect(response.status).toBe(204)
    expect(testDb.prepare(`
      SELECT status, container_id, error_message, completed_at
      FROM tasks
      WHERE id = 52
    `).get()).toMatchObject({
      status: 'review',
      container_id: null,
      error_message: expect.stringContaining('Recipe review blocked: Need reporting agency.'),
      completed_at: null,
    })
    expect(testDb.prepare(`
      SELECT revoked_at FROM task_runner_tokens WHERE task_id = 52
    `).get()).toMatchObject({ revoked_at: expect.any(Number) })
    expect(testDb.prepare(`
      SELECT content FROM comments WHERE task_id = 52 ORDER BY id DESC LIMIT 1
    `).get()).toMatchObject({ content: expect.stringContaining('Quality Review Blocked') })
    expect(broadcastMock).toHaveBeenCalledWith('task.status_changed', expect.objectContaining({
      task_id: 52,
      status: 'review',
      previous_status: 'quality_review',
      reason: 'recipe_review_blocked',
    }))
  })
})
