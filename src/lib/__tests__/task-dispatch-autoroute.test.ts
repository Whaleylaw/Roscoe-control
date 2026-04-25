/**
 * Unit tests for autoRouteInboxTasks.
 *
 * Recipe-backed tasks are manual-start only: auto-routing must leave them in
 * inbox so a user can inspect hydrated workflow tasks and deliberately move one
 * to assigned before the recipe runner claims it.
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
  metadata?: Record<string, unknown>
}): number {
  const now = Math.floor(Date.now() / 1000)
  const projectRow = testDb.prepare(`SELECT id FROM projects WHERE workspace_id = ? LIMIT 1`).get(opts.workspace_id ?? 1) as { id: number } | undefined
  const projectId = projectRow?.id ?? 1
  const res = testDb.prepare(`
    INSERT INTO tasks (title, status, priority, project_id, created_at, updated_at, workspace_id, recipe_slug, assigned_to, tags, metadata)
    VALUES (?, 'inbox', ?, ?, ?, ?, ?, ?, ?, '[]', ?)
  `).run(
    opts.title,
    opts.priority ?? 'medium',
    projectId,
    now,
    now,
    opts.workspace_id ?? 1,
    opts.recipe_slug ?? null,
    opts.assigned_to ?? null,
    JSON.stringify(opts.metadata ?? {}),
  )
  return Number(res.lastInsertRowid)
}

// ---- Phase 20 / ROUTE-01 lane-aware test helpers ----------------------------
//
// `gsd_plans` has no `project_id` column; a plan's project is resolved via
// phase → milestone → workstream → project. `autoRouteInboxTasks` only reads
// `gsd_plans.id` and `gsd_plans.status`, so these helpers seed the minimum
// hierarchy needed to get a plan row with the desired status.
//
// The first call seeds a fresh workstream + milestone + phase for each plan
// to keep isolation between cases trivial. Reuses the default workspace/project
// seeded by runMigrations (workspace_id = 1, projects.id = 1).

let hierarchyCounter = 0
function insertPlanHierarchy(opts: { status?: string; wave?: number }): { plan_id: number; phase_id: number } {
  const now = Math.floor(Date.now() / 1000)
  hierarchyCounter += 1
  const suffix = `${Date.now()}-${hierarchyCounter}`
  const projectRow = testDb.prepare(`SELECT id FROM projects WHERE workspace_id = 1 LIMIT 1`).get() as { id: number } | undefined
  const projectId = projectRow?.id ?? 1

  const ws = testDb.prepare(`
    INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run(projectId, `ws-${suffix}`, `Workstream ${suffix}`, now, now)

  const ms = testDb.prepare(`
    INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(projectId, Number(ws.lastInsertRowid), `v-${suffix}`, `Milestone ${suffix}`, now, now)

  const ph = testDb.prepare(`
    INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
    VALUES (?, ?, ?, 'execute', ?, 'active', '[]', ?, ?)
  `).run(Number(ms.lastInsertRowid), `ph-${suffix}`, `phase-${suffix}`, hierarchyCounter, now, now)

  const plan = testDb.prepare(`
    INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?)
  `).run(
    Number(ph.lastInsertRowid),
    `plan-${suffix}`,
    `Plan ${suffix}`,
    opts.wave ?? 1,
    opts.status ?? 'in_progress',
    now,
    now,
  )

  return { plan_id: Number(plan.lastInsertRowid), phase_id: Number(ph.lastInsertRowid) }
}

function insertLaneTask(opts: {
  gsd_plan_id: number
  title: string
  priority?: string
  workspace_id?: number
}): number {
  const now = Math.floor(Date.now() / 1000)
  const projectRow = testDb.prepare(`SELECT id FROM projects WHERE workspace_id = ? LIMIT 1`).get(opts.workspace_id ?? 1) as { id: number } | undefined
  const projectId = projectRow?.id ?? 1
  const res = testDb.prepare(`
    INSERT INTO tasks (title, status, priority, project_id, gsd_plan_id, created_at, updated_at, workspace_id, recipe_slug, assigned_to, tags, metadata)
    VALUES (?, 'inbox', ?, ?, ?, ?, ?, ?, NULL, NULL, '[]', '{}')
  `).run(
    opts.title,
    opts.priority ?? 'medium',
    projectId,
    opts.gsd_plan_id,
    now,
    now,
    opts.workspace_id ?? 1,
  )
  return Number(res.lastInsertRowid)
}

function taskStatus(id: number): string {
  const row = testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as { status: string } | undefined
  return row?.status ?? 'missing'
}

function seedAgent(name: string, role: string = 'agent'): number {
  const now = Math.floor(Date.now() / 1000)
  const res = testDb.prepare(`
    INSERT INTO agents (name, role, status, workspace_id, created_at, updated_at, hidden)
    VALUES (?, ?, 'idle', 1, ?, ?, 0)
  `).run(name, role, now, now)
  return Number(res.lastInsertRowid)
}

function broadcastsForTask(taskId: number, eventName: string): Array<Record<string, unknown>> {
  return broadcast.mock.calls
    .filter(c => c[0] === eventName)
    .map(c => c[1] as Record<string, unknown>)
    .filter(p => (p as { id?: number; task_id?: number }).id === taskId || (p as { task_id?: number }).task_id === taskId)
}

function firstBroadcastIndex(taskId: number, eventName: string): number {
  return broadcast.mock.calls.findIndex(c => {
    if (c[0] !== eventName) return false
    const p = c[1] as { id?: number; task_id?: number }
    return p.id === taskId || p.task_id === taskId
  })
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

describe('autoRouteInboxTasks — recipe tasks are manual-start only', () => {
  it('leaves recipe-tagged inbox tasks in inbox and emits no runner request', async () => {
    const id = insertInboxTask({ title: 'hello', recipe_slug: 'hello-world' })

    const result = await autoRouteInboxTasks()
    expect(result.ok).toBe(true)

    expect(taskStatus(id)).toBe('inbox')

    const runnerRequested = broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested')
    expect(runnerRequested).toHaveLength(0)

    const statusChanged = broadcast.mock.calls.filter((c) => c[0] === 'task.status_changed')
    expect(statusChanged.some((c) => (c[1] as { id: number }).id === id)).toBe(false)
  })

  it('does not route recipe-tagged tasks even when runner_auto_route is true', async () => {
    testDb.prepare(`DELETE FROM agents`).run()

    const id = insertInboxTask({
      title: 'manual recipe task',
      recipe_slug: 'firmvault-workflow-task',
      metadata: { runner_auto_route: true },
    })

    const result = await autoRouteInboxTasks()
    expect(result.ok).toBe(true)

    expect(taskStatus(id)).toBe('inbox')
    const row = testDb.prepare(`SELECT assigned_to FROM tasks WHERE id = ?`).get(id) as { assigned_to: string | null }
    expect(row.assigned_to).toBeNull()
  })

  it('leaves recipe-tagged inbox tasks alone when runner_auto_route is false', async () => {
    const id = insertInboxTask({
      title: 'manual recipe task',
      recipe_slug: 'firmvault-workflow-task',
      metadata: { runner_auto_route: false },
    })

    const result = await autoRouteInboxTasks()
    expect(result.ok).toBe(true)

    expect(taskStatus(id)).toBe('inbox')
    const runnerRequested = broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested')
    expect(runnerRequested).toHaveLength(0)
  })

  it('ignores recipe rows while still routing legacy inbox tasks', async () => {
    seedAgent('agent-1')
    const recipeIds = [
      insertInboxTask({ title: 'r1', recipe_slug: 'hello-world' }),
      insertInboxTask({ title: 'r2', recipe_slug: 'hello-world' }),
      insertInboxTask({ title: 'r3', recipe_slug: 'another-recipe' }),
    ]
    const legacyId = insertInboxTask({ title: 'legacy-a', recipe_slug: null })

    await autoRouteInboxTasks()

    const runnerRequested = broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested')
    expect(runnerRequested).toHaveLength(0)

    for (const id of recipeIds) {
      expect(taskStatus(id)).toBe('inbox')
    }
    expect(taskStatus(legacyId)).toBe('assigned')
  })
})

describe('autoRouteInboxTasks — lane-aware legacy routing (ROUTE-01)', () => {
  it('prefers lane-scoped inbox tasks over unscoped legacy inbox', async () => {
    // Plan in_progress + 1 lane-linked medium task + 1 unscoped critical task.
    // WITHOUT lane preference, the critical unscoped task would win on priority;
    // WITH lane preference, the lane-scoped task must route FIRST across passes.
    seedAgent('agent-1')
    const { plan_id } = insertPlanHierarchy({ status: 'in_progress' })
    const laneTaskId = insertLaneTask({ gsd_plan_id: plan_id, title: 'lane-medium', priority: 'medium' })
    const unscopedId = insertInboxTask({ title: 'unscoped-critical', priority: 'critical' })

    const result = await autoRouteInboxTasks()
    expect(result.ok).toBe(true)

    // Both route (batch cap 5 > 2 rows).
    expect(taskStatus(laneTaskId)).toBe('assigned')
    expect(taskStatus(unscopedId)).toBe('assigned')

    const lanePayloads = broadcastsForTask(laneTaskId, 'task.status_changed')
    const unscopedPayloads = broadcastsForTask(unscopedId, 'task.status_changed')
    expect(lanePayloads.length).toBeGreaterThan(0)
    expect(unscopedPayloads.length).toBeGreaterThan(0)
    expect(lanePayloads[0].reason).toBe('auto_route_lane_scoped')
    expect(unscopedPayloads[0].reason).toBe('auto_route_legacy_fallback')

    // Lane-scoped broadcast fires BEFORE the unscoped one (pass 1 before pass 2).
    const laneIdx = firstBroadcastIndex(laneTaskId, 'task.status_changed')
    const unscopedIdx = firstBroadcastIndex(unscopedId, 'task.status_changed')
    expect(laneIdx).toBeGreaterThanOrEqual(0)
    expect(unscopedIdx).toBeGreaterThan(laneIdx)
  })

  it('within the lane-scoped pass, priority still dominates', async () => {
    seedAgent('agent-1')
    const { plan_id } = insertPlanHierarchy({ status: 'in_progress' })
    const lowId = insertLaneTask({ gsd_plan_id: plan_id, title: 'lane-low', priority: 'low' })
    const highId = insertLaneTask({ gsd_plan_id: plan_id, title: 'lane-high', priority: 'high' })

    await autoRouteInboxTasks()

    const highIdx = firstBroadcastIndex(highId, 'task.status_changed')
    const lowIdx = firstBroadcastIndex(lowId, 'task.status_changed')
    expect(highIdx).toBeGreaterThanOrEqual(0)
    expect(lowIdx).toBeGreaterThan(highIdx)

    // Both lane-scoped (same pass, same reason).
    const highPayload = broadcastsForTask(highId, 'task.status_changed')[0]
    const lowPayload = broadcastsForTask(lowId, 'task.status_changed')[0]
    expect(highPayload.reason).toBe('auto_route_lane_scoped')
    expect(lowPayload.reason).toBe('auto_route_lane_scoped')
  })

  it('falls back to unscoped when no plans are in_progress', async () => {
    // Plan exists but status='draft' (NOT in_progress). A lane-linked task and
    // an unscoped task should both route via the unscoped fallback pass.
    seedAgent('agent-1')
    const { plan_id } = insertPlanHierarchy({ status: 'draft' })
    const laneTaskId = insertLaneTask({ gsd_plan_id: plan_id, title: 'lane-task' })
    const unscopedId = insertInboxTask({ title: 'unscoped' })

    await autoRouteInboxTasks()

    expect(taskStatus(laneTaskId)).toBe('assigned')
    expect(taskStatus(unscopedId)).toBe('assigned')

    // Both broadcasts carry auto_route_legacy_fallback.
    const lanePayloads = broadcastsForTask(laneTaskId, 'task.status_changed')
    const unscopedPayloads = broadcastsForTask(unscopedId, 'task.status_changed')
    expect(lanePayloads[0].reason).toBe('auto_route_legacy_fallback')
    expect(unscopedPayloads[0].reason).toBe('auto_route_legacy_fallback')

    // No auto_route_lane_scoped broadcast anywhere.
    const laneScoped = broadcast.mock.calls.filter(c =>
      c[0] === 'task.status_changed' && (c[1] as { reason?: string }).reason === 'auto_route_lane_scoped',
    )
    expect(laneScoped).toHaveLength(0)
  })

  it('respects the 5-row batch cap across both passes combined', async () => {
    // Seed enough agents to absorb all 5 routes (per-agent capacity is 3 in-progress).
    // The auto-route function flips to 'assigned' (not 'in_progress'), so capacity
    // is fine with one agent — but keep it explicit.
    seedAgent('agent-1')
    const { plan_id } = insertPlanHierarchy({ status: 'in_progress' })
    for (let i = 0; i < 4; i++) {
      insertLaneTask({ gsd_plan_id: plan_id, title: `lane-${i}`, priority: 'medium' })
    }
    const unscopedIds = [
      insertInboxTask({ title: 'unscoped-0' }),
      insertInboxTask({ title: 'unscoped-1' }),
      insertInboxTask({ title: 'unscoped-2' }),
    ]

    await autoRouteInboxTasks()

    const laneScoped = broadcast.mock.calls.filter(c =>
      c[0] === 'task.status_changed' && (c[1] as { reason?: string }).reason === 'auto_route_lane_scoped',
    )
    const fallback = broadcast.mock.calls.filter(c =>
      c[0] === 'task.status_changed' && (c[1] as { reason?: string }).reason === 'auto_route_legacy_fallback',
    )

    expect(laneScoped).toHaveLength(4)
    expect(fallback).toHaveLength(1)

    // Exactly 2 unscoped rows remain 'inbox'.
    const inboxCount = unscopedIds.filter(id => taskStatus(id) === 'inbox').length
    expect(inboxCount).toBe(2)
  })

  it('lane-scoped excludes rows linked to non-in_progress plans', async () => {
    seedAgent('agent-1')
    insertPlanHierarchy({ status: 'in_progress' }) // plan A (active; no tasks linked)
    const planB = insertPlanHierarchy({ status: 'draft' }) // plan B (inactive)
    const taskOnB = insertLaneTask({ gsd_plan_id: planB.plan_id, title: 'on-draft-plan' })

    await autoRouteInboxTasks()

    // Plan-B task MUST route via the unscoped fallback pass — its plan is not in_progress.
    const payloads = broadcastsForTask(taskOnB, 'task.status_changed')
    expect(payloads.length).toBeGreaterThan(0)
    expect(payloads[0].reason).toBe('auto_route_legacy_fallback')
  })

  it('concurrent-modification safety — 0-change UPDATE does not broadcast', async () => {
    const { plan_id } = insertPlanHierarchy({ status: 'in_progress' })
    const id = insertLaneTask({ gsd_plan_id: plan_id, title: 'racing-task' })
    // Simulate a racing tick flipping the row out of 'inbox' before the UPDATE fires.
    testDb.prepare(`UPDATE tasks SET status = 'backlog' WHERE id = ?`).run(id)

    await autoRouteInboxTasks()

    // No status_changed broadcast for the task; still in backlog.
    const payloads = broadcastsForTask(id, 'task.status_changed')
    expect(payloads).toHaveLength(0)
    expect(taskStatus(id)).toBe('backlog')
  })

  it('manual-start recipe regression — recipe rows stay inbox when lane-scoped rows also route', async () => {
    seedAgent('agent-1')
    const { plan_id } = insertPlanHierarchy({ status: 'in_progress' })
    const recipeId = insertInboxTask({ title: 'recipe-row', recipe_slug: 'hello-world' })
    const laneId = insertLaneTask({ gsd_plan_id: plan_id, title: 'lane-row' })

    await autoRouteInboxTasks()

    const recipeRunnerRequested = broadcastsForTask(recipeId, 'task.runner_requested')
    expect(recipeRunnerRequested).toHaveLength(0)
    const recipeStatusChanged = broadcastsForTask(recipeId, 'task.status_changed')
    expect(recipeStatusChanged).toHaveLength(0)
    expect(taskStatus(recipeId)).toBe('inbox')

    // Lane task: emits lane-scoped reason.
    const lanePayloads = broadcastsForTask(laneId, 'task.status_changed')
    expect(lanePayloads[0].reason).toBe('auto_route_lane_scoped')
  })
})
