/**
 * Phase 15 Plan 15-02 Task 3 (Part B): requeueStaleTasks recipe-tagged branch.
 *
 * Scope:
 *   - Recipe-tagged stale rows use runner-heartbeat + runner-inventory probe
 *     (NOT agent.status).
 *   - No fresh heartbeat → task flips back to 'assigned' with
 *     runner_last_failure_reason='runner_heartbeat_stale'. Emits task.runner_requested.
 *   - Fresh heartbeat AND task id NOT in active_task_ids → flip.
 *   - Fresh heartbeat AND task id IN active_task_ids → skip (runner knows about it).
 *   - Legacy stale rows with offline agent still flip (regression guard).
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'

let testDb: Database.Database
const broadcast = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    logActivity: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    createNotification: vi.fn(),
  },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: (...args: unknown[]) => broadcast(...args) },
}))

vi.mock('@/lib/github-sync-engine', () => ({
  syncTaskOutbound: vi.fn(),
  pushTaskToGitHub: vi.fn(),
}))

import { requeueStaleTasks } from '@/lib/task-dispatch'

function insertInProgressTask(opts: {
  title: string
  assigned_to?: string | null
  recipe_slug?: string | null
  workspace_id?: number
  updated_at: number
  container_id?: string | null
}): number {
  const projectRow = testDb.prepare(`SELECT id FROM projects WHERE workspace_id = ? LIMIT 1`).get(opts.workspace_id ?? 1) as { id: number } | undefined
  const projectId = projectRow?.id ?? 1
  const res = testDb.prepare(`
    INSERT INTO tasks (title, status, priority, project_id, assigned_to, created_at, updated_at, workspace_id, recipe_slug, container_id, tags, metadata, dispatch_attempts)
    VALUES (?, 'in_progress', 'medium', ?, ?, ?, ?, ?, ?, ?, '[]', '{}', 0)
  `).run(
    opts.title,
    projectId,
    opts.assigned_to ?? null,
    opts.updated_at,
    opts.updated_at,
    opts.workspace_id ?? 1,
    opts.recipe_slug ?? null,
    opts.container_id ?? null,
  )
  return Number(res.lastInsertRowid)
}

function seedHeartbeat(lastHeartbeatAt: number, metadata: Record<string, unknown> | null = null) {
  testDb.prepare(`
    INSERT OR REPLACE INTO runner_heartbeats (runner_id, last_heartbeat_at, registered_at, metadata_json)
    VALUES ('test-runner', ?, ?, ?)
  `).run(lastHeartbeatAt, lastHeartbeatAt, metadata ? JSON.stringify(metadata) : null)
}

function seedAgent(name: string, status: 'idle' | 'offline') {
  const now = Math.floor(Date.now() / 1000)
  testDb.prepare(`
    INSERT INTO agents (name, role, status, workspace_id, created_at, updated_at, last_seen, hidden)
    VALUES (?, 'agent', ?, 1, ?, ?, ?, 0)
  `).run(name, status, now, now, status === 'idle' ? now : now - 3600)
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  testDb.prepare(`DELETE FROM agents`).run()
  broadcast.mockClear()
})

afterEach(() => {
  testDb.close()
})

describe('requeueStaleTasks — recipe-tagged branch (SCHED-03)', () => {
  it('flips recipe-tagged stale row when NO heartbeat row exists', async () => {
    const now = Math.floor(Date.now() / 1000)
    const id = insertInProgressTask({
      title: 'r-stale',
      recipe_slug: 'hello-world',
      updated_at: now - 700, // 10 min ago
      container_id: 'pending:123:1',
    })

    const result = await requeueStaleTasks()
    expect(result.ok).toBe(true)

    const row = testDb.prepare(`
      SELECT status, container_id, runner_started_at, runner_last_failure_reason
      FROM tasks WHERE id = ?
    `).get(id) as { status: string; container_id: string | null; runner_started_at: number | null; runner_last_failure_reason: string | null }

    expect(row.status).toBe('assigned')
    expect(row.container_id).toBeNull()
    expect(row.runner_started_at).toBeNull()
    expect(row.runner_last_failure_reason).toBe('runner_heartbeat_stale')

    const runnerRequested = broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested')
    expect(runnerRequested).toHaveLength(1)
    expect(runnerRequested[0][1]).toMatchObject({
      task_id: id,
      recipe_slug: 'hello-world',
      workspace_id: 1,
    })
  })

  it('flips recipe-tagged stale row when fresh heartbeat omits task from active_task_ids', async () => {
    const now = Math.floor(Date.now() / 1000)
    const id = insertInProgressTask({
      title: 'not-in-inventory',
      recipe_slug: 'hello-world',
      updated_at: now - 700,
    })
    // Fresh heartbeat reports different task ids — the one we just inserted is NOT in inventory.
    seedHeartbeat(now - 10, { active_task_ids: [id + 100, id + 200] })

    await requeueStaleTasks()

    const row = testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as { status: string }
    expect(row.status).toBe('assigned')

    expect(broadcast.mock.calls.some((c) => c[0] === 'task.runner_requested')).toBe(true)
  })

  it('SKIPS recipe-tagged stale row when fresh heartbeat reports it as active', async () => {
    const now = Math.floor(Date.now() / 1000)
    const id = insertInProgressTask({
      title: 'in-inventory',
      recipe_slug: 'hello-world',
      updated_at: now - 700,
    })
    seedHeartbeat(now - 10, { active_task_ids: [id] }) // runner knows about it

    await requeueStaleTasks()

    const row = testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as { status: string }
    expect(row.status).toBe('in_progress') // NOT flipped

    const runnerRequested = broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested')
    expect(runnerRequested).toHaveLength(0)
  })

  it('SKIPS recipe-tagged stale row when heartbeat is fresh but inventory is absent', async () => {
    // Fresh heartbeat without active_task_ids in metadata — conservative skip
    // (we can't tell whether the runner actively tracks this task).
    const now = Math.floor(Date.now() / 1000)
    seedHeartbeat(now - 10, null)
    const id = insertInProgressTask({
      title: 'missing-inventory',
      recipe_slug: 'hello-world',
      updated_at: now - 700,
    })

    await requeueStaleTasks()

    const row = testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as { status: string }
    expect(row.status).toBe('in_progress')

    expect(broadcast.mock.calls.some((c) => c[0] === 'task.runner_requested')).toBe(false)
  })

  it('flips legacy stale row with offline agent (regression guard)', async () => {
    const now = Math.floor(Date.now() / 1000)
    seedAgent('offline-agent', 'offline')
    const id = insertInProgressTask({
      title: 'legacy-stale',
      assigned_to: 'offline-agent',
      recipe_slug: null,
      updated_at: now - 700,
    })

    await requeueStaleTasks()

    const row = testDb.prepare(`SELECT status, error_message, dispatch_attempts FROM tasks WHERE id = ?`).get(id) as { status: string; error_message: string; dispatch_attempts: number }
    expect(row.status).toBe('assigned')
    expect(row.error_message).toContain('offline')
    expect(row.dispatch_attempts).toBe(1)
  })

  it('leaves legacy stale row alone when the assigned agent is still online (regression guard)', async () => {
    const now = Math.floor(Date.now() / 1000)
    seedAgent('live-agent', 'idle')
    const id = insertInProgressTask({
      title: 'legacy-live',
      assigned_to: 'live-agent',
      recipe_slug: null,
      updated_at: now - 700,
    })

    await requeueStaleTasks()

    const row = testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as { status: string }
    expect(row.status).toBe('in_progress')
  })

  it('malformed metadata_json on heartbeat is treated as absent inventory', async () => {
    const now = Math.floor(Date.now() / 1000)
    // Insert a heartbeat with invalid JSON in metadata_json; isRecipeTaskStuck
    // should swallow the JSON parse error and fall through to "inventory absent"
    // (which means skip — we can't tell).
    testDb.prepare(`
      INSERT OR REPLACE INTO runner_heartbeats (runner_id, last_heartbeat_at, registered_at, metadata_json)
      VALUES ('test-runner', ?, ?, 'not-valid-json{{{')
    `).run(now - 10, now - 10)

    const id = insertInProgressTask({
      title: 'malformed-hb',
      recipe_slug: 'hello-world',
      updated_at: now - 700,
    })

    const result = await requeueStaleTasks()
    expect(result.ok).toBe(true)

    const row = testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as { status: string }
    expect(row.status).toBe('in_progress')
  })
})
