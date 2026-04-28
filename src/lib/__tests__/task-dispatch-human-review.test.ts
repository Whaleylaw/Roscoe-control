import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'

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
  it('does not auto-review human workflow review gates in review or quality_review', async () => {
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
        (6101, 'Human review gate', 'Owner answers a workflow question.', 'review', 'medium', 1, ?, NULL, unixepoch(), unixepoch()),
        (6102, 'Human gate in quality', 'Quality should be explicit/manual.', 'quality_review', 'medium', 1, ?, NULL, unixepoch(), unixepoch())
    `).run(metadata, metadata)

    const result = await runAegisReviews()

    expect(result).toEqual({ ok: true, message: 'No tasks awaiting review' })
    expect(runOpenClaw).not.toHaveBeenCalled()
    expect(testDb.prepare(`SELECT status FROM tasks WHERE id = 6101`).get()).toMatchObject({ status: 'review' })
    expect(testDb.prepare(`SELECT status FROM tasks WHERE id = 6102`).get()).toMatchObject({ status: 'quality_review' })
  })
})
