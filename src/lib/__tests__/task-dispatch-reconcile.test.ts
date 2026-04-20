/**
 * Phase 15 Plan 15-02 Task 4: reconcileRunnerHeartbeat unit tests.
 *
 * Scope: behavior of the pure function on realistic DB state combinations.
 * Scheduler-ladder integration lives in src/lib/__tests__/scheduler-reconcile.test.ts
 * (Task 1); these tests exercise the heartbeat-freshness branches and the
 * recipe-task flipping logic directly.
 *
 * LOCKED: STALE_WINDOW_SECS = 90 per .planning/.../15-CONTEXT.md § Heartbeat
 * & Stale Detection. Any change to that window breaks Phase 15 SC guarantees.
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

import { reconcileRunnerHeartbeat } from '@/lib/task-dispatch'

function seedHeartbeat(lastHeartbeatAt: number) {
  testDb.prepare(`
    INSERT OR REPLACE INTO runner_heartbeats (runner_id, last_heartbeat_at, registered_at, metadata_json)
    VALUES ('test-runner', ?, ?, NULL)
  `).run(lastHeartbeatAt, lastHeartbeatAt)
}

function insertInProgress(opts: {
  title: string
  recipe_slug: string | null
  updated_at: number
  container_id?: string | null
  workspace_id?: number
}): number {
  const projectRow = testDb.prepare(`SELECT id FROM projects WHERE workspace_id = ? LIMIT 1`).get(opts.workspace_id ?? 1) as { id: number } | undefined
  const projectId = projectRow?.id ?? 1
  const res = testDb.prepare(`
    INSERT INTO tasks (title, status, priority, project_id, created_at, updated_at, workspace_id, recipe_slug, container_id, tags, metadata, dispatch_attempts, runner_started_at)
    VALUES (?, 'in_progress', 'medium', ?, ?, ?, ?, ?, ?, '[]', '{}', 0, ?)
  `).run(
    opts.title,
    projectId,
    opts.updated_at,
    opts.updated_at,
    opts.workspace_id ?? 1,
    opts.recipe_slug,
    opts.container_id ?? null,
    opts.updated_at,
  )
  return Number(res.lastInsertRowid)
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  broadcast.mockClear()
})

afterEach(() => {
  testDb.close()
})

describe('reconcileRunnerHeartbeat — behavior (SCHED-04)', () => {
  it('returns "No stale in_progress recipe-tasks" when heartbeats empty AND no recipe rows', async () => {
    const result = await reconcileRunnerHeartbeat()
    expect(result.ok).toBe(true)
    expect(result.message).toBe('No stale in_progress recipe-tasks')
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('returns "Runner heartbeat fresh" and performs no DB updates when a heartbeat is fresh', async () => {
    const now = Math.floor(Date.now() / 1000)
    seedHeartbeat(now - 10) // 10s old, well within 90s window
    const id = insertInProgress({
      title: 'stale-row',
      recipe_slug: 'hello-world',
      updated_at: now - 300,
    })

    const result = await reconcileRunnerHeartbeat()
    expect(result.ok).toBe(true)
    expect(result.message).toBe('Runner heartbeat fresh')

    const row = testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as { status: string }
    expect(row.status).toBe('in_progress') // untouched

    expect(broadcast).not.toHaveBeenCalled()
  })

  it('flips stale in_progress recipe-task when heartbeat is stale AND task updated_at < now-90s', async () => {
    const now = Math.floor(Date.now() / 1000)
    seedHeartbeat(now - 300) // stale heartbeat (5 min old)
    const id = insertInProgress({
      title: 'flip-me',
      recipe_slug: 'hello-world',
      updated_at: now - 100, // 100s > 90s threshold
      container_id: 'docker-xyz',
    })

    const result = await reconcileRunnerHeartbeat()
    expect(result.ok).toBe(true)
    expect(result.message).toBe('Flipped 1 stale recipe-task(s) back to assigned')

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
    expect(runnerRequested[0][1]).toMatchObject({ task_id: id, recipe_slug: 'hello-world' })

    const statusChanged = broadcast.mock.calls.filter((c) => c[0] === 'task.status_changed')
    expect(statusChanged).toHaveLength(1)
    expect(statusChanged[0][1]).toMatchObject({ id, status: 'assigned', previous_status: 'in_progress', reason: 'runner_heartbeat_stale' })
  })

  it('SKIPS recent in_progress recipe-task even when heartbeat is absent (updated_at filter)', async () => {
    const now = Math.floor(Date.now() / 1000)
    // No heartbeat at all — reconciler moves to "no fresh heartbeat" branch.
    const id = insertInProgress({
      title: 'recent-flip-target',
      recipe_slug: 'hello-world',
      updated_at: now - 5, // 5s ago — still within 90s window
    })

    const result = await reconcileRunnerHeartbeat()
    expect(result.ok).toBe(true)
    // No rows qualify as stuck (updated_at filter rejects them).
    expect(result.message).toBe('No stale in_progress recipe-tasks')

    const row = testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as { status: string }
    expect(row.status).toBe('in_progress')
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('does NOT flip non-recipe stale in_progress tasks (recipe_slug IS NOT NULL filter)', async () => {
    const now = Math.floor(Date.now() / 1000)
    const id = insertInProgress({
      title: 'legacy-stale',
      recipe_slug: null,
      updated_at: now - 300, // stale
    })

    const result = await reconcileRunnerHeartbeat()
    expect(result.ok).toBe(true)
    expect(result.message).toBe('No stale in_progress recipe-tasks')

    const row = testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as { status: string }
    expect(row.status).toBe('in_progress')
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('flips multiple stale recipe-tasks in a single tick and emits per-row', async () => {
    const now = Math.floor(Date.now() / 1000)
    // No heartbeat row → stale branch triggers.
    const ids = [
      insertInProgress({ title: 'a', recipe_slug: 'hello-world', updated_at: now - 200 }),
      insertInProgress({ title: 'b', recipe_slug: 'hello-world', updated_at: now - 200 }),
      insertInProgress({ title: 'c', recipe_slug: 'another', updated_at: now - 200 }),
    ]

    const result = await reconcileRunnerHeartbeat()
    expect(result.ok).toBe(true)
    expect(result.message).toBe('Flipped 3 stale recipe-task(s) back to assigned')

    for (const id of ids) {
      const row = testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as { status: string }
      expect(row.status).toBe('assigned')
    }

    const runnerRequested = broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested')
    expect(runnerRequested).toHaveLength(3)
  })

  it('heartbeat exactly at 90s boundary: stale (strict less-than comparison)', async () => {
    // last_heartbeat_at >= nowUnix - 90 → fresh. So at last_heartbeat_at = now-90,
    // (now-90) >= (now-90) is TRUE → fresh. Only now-91 and older is stale.
    const now = Math.floor(Date.now() / 1000)
    seedHeartbeat(now - 91) // one second past the window
    insertInProgress({
      title: 'boundary',
      recipe_slug: 'hello-world',
      updated_at: now - 200,
    })

    const result = await reconcileRunnerHeartbeat()
    expect(result.ok).toBe(true)
    // Heartbeat is stale (91 > 90) → stale branch proceeds → flip happens
    expect(result.message).toBe('Flipped 1 stale recipe-task(s) back to assigned')
  })
})
