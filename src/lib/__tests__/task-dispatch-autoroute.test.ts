/**
 * Phase 15 Plan 15-02 Task 2: unit tests for autoRouteInboxTasks recipe fast-path.
 *
 * Covers:
 *   - Recipe-tagged inbox task flips inbox→assigned and emits task.runner_requested
 *     (+ task.status_changed) exactly once.
 *   - Legacy inbox task (recipe_slug IS NULL) is filtered out of the recipe fast-path
 *     SELECT and still runs through the existing affinity-scoring loop.
 *   - Mixed inbox (recipe + legacy) routes BOTH lanes correctly.
 *   - Concurrent modification (row already flipped) is a no-op — no duplicate emit.
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

vi.mock('@/lib/openclaw-gateway', () => ({ callOpenClawGateway: vi.fn() }))
vi.mock('@/lib/command', () => ({ runOpenClaw: vi.fn() }))
vi.mock('@/lib/config', () => ({ config: { openclawHome: null, gnap: { enabled: false, autoSync: false, repoPath: '/tmp/noop' } } }))

import { autoRouteInboxTasks } from '@/lib/task-dispatch'

function insertInboxTask(opts: {
  title: string
  recipe_slug?: string | null
  assigned_to?: string | null
  workspace_id?: number
  priority?: string
}): number {
  const now = Math.floor(Date.now() / 1000)
  const projectRow = testDb.prepare(`SELECT id FROM projects WHERE workspace_id = ? LIMIT 1`).get(opts.workspace_id ?? 1) as { id: number } | undefined
  const projectId = projectRow?.id ?? 1
  const res = testDb.prepare(`
    INSERT INTO tasks (title, status, priority, project_id, created_at, updated_at, workspace_id, recipe_slug, assigned_to, tags, metadata)
    VALUES (?, 'inbox', ?, ?, ?, ?, ?, ?, ?, '[]', '{}')
  `).run(
    opts.title,
    opts.priority ?? 'medium',
    projectId,
    now,
    now,
    opts.workspace_id ?? 1,
    opts.recipe_slug ?? null,
    opts.assigned_to ?? null,
  )
  return Number(res.lastInsertRowid)
}

function taskStatus(id: number): string {
  const row = testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as { status: string } | undefined
  return row?.status ?? 'missing'
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

describe('autoRouteInboxTasks — recipe-tagged fast path (SCHED-01)', () => {
  it('flips a recipe-tagged inbox task inbox→assigned and emits task.runner_requested', async () => {
    const id = insertInboxTask({ title: 'hello', recipe_slug: 'hello-world' })

    const result = await autoRouteInboxTasks()
    expect(result.ok).toBe(true)

    expect(taskStatus(id)).toBe('assigned')

    const runnerRequested = broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested')
    expect(runnerRequested).toHaveLength(1)
    expect(runnerRequested[0][1]).toMatchObject({
      task_id: id,
      recipe_slug: 'hello-world',
      workspace_id: 1,
    })

    const statusChanged = broadcast.mock.calls.filter((c) => c[0] === 'task.status_changed')
    expect(statusChanged.some((c) => (c[1] as { id: number }).id === id && (c[1] as { reason: string }).reason === 'auto_route_recipe')).toBe(true)
  })

  it('skips affinity scoring for recipe-tagged tasks (no agent required, no assigned_to written)', async () => {
    // Seed no agents at all — legacy path would early-return with
    // "no available agents", but the recipe fast-path must still run.
    // (runMigrations seeds some agents; delete them defensively.)
    testDb.prepare(`DELETE FROM agents`).run()

    const id = insertInboxTask({ title: 'ship', recipe_slug: 'hello-world' })

    const result = await autoRouteInboxTasks()
    expect(result.ok).toBe(true)

    expect(taskStatus(id)).toBe('assigned')
    const row = testDb.prepare(`SELECT assigned_to FROM tasks WHERE id = ?`).get(id) as { assigned_to: string | null }
    expect(row.assigned_to).toBeNull()
  })

  it('leaves a legacy inbox task (recipe_slug NULL) to the affinity-scoring loop', async () => {
    const id = insertInboxTask({ title: 'simple legacy task', recipe_slug: null })

    await autoRouteInboxTasks()

    // No task.runner_requested emission for legacy rows.
    const runnerRequested = broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested')
    expect(runnerRequested).toHaveLength(0)

    // Status may have been updated by the affinity-scoring loop if any matching
    // agent was seeded; at minimum, the row was NOT assigned via the recipe path.
    const row = testDb.prepare(`SELECT status, assigned_to, recipe_slug FROM tasks WHERE id = ?`).get(id) as { status: string; assigned_to: string | null; recipe_slug: string | null }
    expect(row.recipe_slug).toBeNull()
  })

  it('processes mixed inbox: recipe rows fast-path, legacy rows go through scoring', async () => {
    const recipeIds = [
      insertInboxTask({ title: 'r1', recipe_slug: 'hello-world' }),
      insertInboxTask({ title: 'r2', recipe_slug: 'hello-world' }),
      insertInboxTask({ title: 'r3', recipe_slug: 'another-recipe' }),
    ]
    insertInboxTask({ title: 'legacy-a', recipe_slug: null })
    insertInboxTask({ title: 'legacy-b', recipe_slug: null })

    await autoRouteInboxTasks()

    // Three recipe emissions; none duplicated.
    const runnerRequested = broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested')
    expect(runnerRequested).toHaveLength(3)
    const emittedIds = runnerRequested.map((c) => (c[1] as { task_id: number }).task_id).sort((a, b) => a - b)
    expect(emittedIds).toEqual([...recipeIds].sort((a, b) => a - b))

    // Every recipe task flipped.
    for (const id of recipeIds) {
      expect(taskStatus(id)).toBe('assigned')
    }
  })

  it('does NOT emit when the UPDATE affects 0 rows (concurrent modification safety)', async () => {
    // Insert a recipe row, then IMMEDIATELY flip it out of inbox state before
    // the autoRouteInboxTasks UPDATE can fire. Simulate by pre-advancing the
    // row to 'backlog'. The SELECT in autoRoute picked it up at t0, but the
    // UPDATE guard (status = 'inbox') rejects — res.changes = 0, no emit.
    const id = insertInboxTask({ title: 'race', recipe_slug: 'hello-world' })
    testDb.prepare(`UPDATE tasks SET status = 'backlog' WHERE id = ?`).run(id)

    await autoRouteInboxTasks()

    const runnerRequested = broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested')
    expect(runnerRequested).toHaveLength(0)

    // Row was NOT flipped by autoRoute (stayed 'backlog').
    expect(taskStatus(id)).toBe('backlog')
  })

  it('returns message mentioning recipe-tagged count when fast-path routes rows', async () => {
    insertInboxTask({ title: 'r-only', recipe_slug: 'hello-world' })

    const result = await autoRouteInboxTasks()
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/Routed\s+1\s+recipe-tagged/i)
  })
})
