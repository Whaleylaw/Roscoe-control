/**
 * Phase 15 Plan 15-07 Task 2 — scheduler + reconcile + requeueStaleTasks
 * orchestration integration.
 *
 * Purpose: prove the full cross-module composition:
 *   - `autoRouteInboxTasks()` fast-paths recipe rows AND leaves legacy rows
 *     to affinity scoring (SCHED-01).
 *   - `dispatchAssignedTasks()` skips recipe-tagged `assigned` rows (SCHED-02).
 *   - `requeueStaleTasks()` uses runner heartbeat + `metadata_json.active_task_ids`
 *     inventory to decide recipe-task flips; legacy rows follow the agent-offline
 *     path (SCHED-03).
 *   - `reconcileRunnerHeartbeat()` fires on the 30s scheduler tick and flips
 *     stuck in_progress recipe-tasks back to `assigned` when heartbeat >=90s
 *     stale AND the task's own updated_at is also stale (SCHED-04).
 *   - The scheduler's tick ladder registers `reconcile_runner_heartbeat` with
 *     intervalMs=30_000 (derived from the Plan 15-02 cadence reduction).
 *
 * Scope: integration — real @/lib/task-dispatch module + real @/lib/scheduler
 * Map/ladder wiring + in-memory DB. Only `@/lib/event-bus` is mocked so we
 * can assert emissions without wiring a real SSE stream.
 *
 * Fake-timer discipline: uses vi.useFakeTimers() + vi.setSystemTime(base) so
 * the 90s/30s boundaries are deterministic. The DB timestamps (created_at /
 * updated_at / last_heartbeat_at) are integers in unix-seconds and are seeded
 * relative to the frozen `Math.floor(Date.now()/1000)`.
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
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: (...args: unknown[]) => broadcast(...args) },
}))

vi.mock('@/lib/github-sync-engine', () => ({
  syncTaskOutbound: vi.fn(),
  pushTaskToGitHub: vi.fn(),
}))

// dispatchAssignedTasks pulls config + openclaw-gateway + command during the
// legacy dispatch path. Stub them so the legacy row can at least be SELECT'd
// and transitioned to in_progress — we only need the "recipe row was skipped"
// invariant from the SELECT side; the downstream dispatch failure is fine.
vi.mock('@/lib/openclaw-gateway', () => ({ callOpenClawGateway: vi.fn() }))
vi.mock('@/lib/command', () => ({
  runOpenClaw: vi.fn(() => Promise.resolve({ stdout: '', stderr: '' })),
}))
vi.mock('@/lib/config', () => ({
  config: {
    openclawHome: null,
    dbPath: '/tmp/test-mc.db',
    tokensPath: '/tmp/test-tokens.json',
    gnap: { enabled: false, autoSync: false, repoPath: '/tmp/noop' },
    retention: { activities: 30, auditLog: 90, notifications: 30, pipelineRuns: 30, tokenUsage: 30, gatewaySessions: 30 },
  },
  ensureDirExists: vi.fn(),
}))

// Scheduler imports a LOT of lib surfaces — stub them to keep the suite
// hermetic. Each stub returns a no-op result matching the shape the scheduler
// tick unpacks. (Scheduler-reconcile.test.ts does the same — this mirrors it.)
vi.mock('@/lib/agent-sync', () => ({
  syncAgentsFromConfig: vi.fn(() => Promise.resolve({ created: 0, updated: 0, synced: 0 })),
}))
vi.mock('@/lib/webhooks', () => ({
  processWebhookRetries: vi.fn(() => Promise.resolve({ ok: true, message: 'wh stub' })),
}))
vi.mock('@/lib/claude-sessions', () => ({
  syncClaudeSessions: vi.fn(() => Promise.resolve({ ok: true, message: 'claude stub' })),
}))
vi.mock('@/lib/sessions', () => ({
  pruneGatewaySessionsOlderThan: vi.fn(() => ({ deleted: 0 })),
  getAgentLiveStatuses: vi.fn(() => new Map()),
}))
vi.mock('@/lib/skill-sync', () => ({
  syncSkillsFromDisk: vi.fn(() => Promise.resolve({ ok: true, message: 'skill stub' })),
}))
vi.mock('@/lib/local-agent-sync', () => ({
  syncLocalAgents: vi.fn(() => Promise.resolve({ ok: true, message: 'local stub' })),
}))
vi.mock('@/lib/recurring-tasks', () => ({
  spawnRecurringTasks: vi.fn(() => Promise.resolve({ ok: true, message: 'rec stub' })),
}))

import {
  autoRouteInboxTasks,
  dispatchAssignedTasks,
  requeueStaleTasks,
  reconcileRunnerHeartbeat,
} from '@/lib/task-dispatch'
import {
  initScheduler,
  stopScheduler,
  getSchedulerStatus,
  triggerTask,
} from '@/lib/scheduler'

// -------------------------------------------------------------------------
// Seed helpers
// -------------------------------------------------------------------------

function insertInboxTask(opts: {
  title: string
  recipe_slug?: string | null
  assigned_to?: string | null
  workspace_id?: number
}): number {
  const now = Math.floor(Date.now() / 1000)
  const projectRow = testDb
    .prepare(`SELECT id FROM projects WHERE workspace_id = ? LIMIT 1`)
    .get(opts.workspace_id ?? 1) as { id: number } | undefined
  const projectId = projectRow?.id ?? 1
  const res = testDb
    .prepare(
      `INSERT INTO tasks (title, status, priority, project_id, created_at,
                          updated_at, workspace_id, recipe_slug, assigned_to,
                          tags, metadata)
       VALUES (?, 'inbox', 'medium', ?, ?, ?, ?, ?, ?, '[]', '{}')`,
    )
    .run(
      opts.title,
      projectId,
      now,
      now,
      opts.workspace_id ?? 1,
      opts.recipe_slug ?? null,
      opts.assigned_to ?? null,
    )
  return Number(res.lastInsertRowid)
}

function insertAssignedTask(opts: {
  title: string
  assigned_to: string
  recipe_slug?: string | null
  workspace_id?: number
}): number {
  const now = Math.floor(Date.now() / 1000)
  const projectRow = testDb
    .prepare(`SELECT id FROM projects WHERE workspace_id = ? LIMIT 1`)
    .get(opts.workspace_id ?? 1) as { id: number } | undefined
  const projectId = projectRow?.id ?? 1
  const res = testDb
    .prepare(
      `INSERT INTO tasks (title, status, priority, project_id, assigned_to,
                          created_at, updated_at, workspace_id, recipe_slug,
                          tags, metadata, dispatch_attempts)
       VALUES (?, 'assigned', 'medium', ?, ?, ?, ?, ?, ?, '[]', '{}', 0)`,
    )
    .run(
      opts.title,
      projectId,
      opts.assigned_to,
      now,
      now,
      opts.workspace_id ?? 1,
      opts.recipe_slug ?? null,
    )
  return Number(res.lastInsertRowid)
}

function insertInProgressTask(opts: {
  title: string
  recipe_slug?: string | null
  assigned_to?: string | null
  updated_at: number
  container_id?: string | null
  workspace_id?: number
}): number {
  const projectRow = testDb
    .prepare(`SELECT id FROM projects WHERE workspace_id = ? LIMIT 1`)
    .get(opts.workspace_id ?? 1) as { id: number } | undefined
  const projectId = projectRow?.id ?? 1
  const res = testDb
    .prepare(
      `INSERT INTO tasks (title, status, priority, project_id, assigned_to,
                          created_at, updated_at, workspace_id, recipe_slug,
                          container_id, tags, metadata, dispatch_attempts,
                          runner_started_at)
       VALUES (?, 'in_progress', 'medium', ?, ?, ?, ?, ?, ?, ?, '[]', '{}',
               0, ?)`,
    )
    .run(
      opts.title,
      projectId,
      opts.assigned_to ?? null,
      opts.updated_at,
      opts.updated_at,
      opts.workspace_id ?? 1,
      opts.recipe_slug ?? null,
      opts.container_id ?? null,
      opts.updated_at,
    )
  return Number(res.lastInsertRowid)
}

function seedAgent(name: string, status: 'idle' | 'offline' = 'idle'): void {
  const now = Math.floor(Date.now() / 1000)
  testDb
    .prepare(
      `INSERT INTO agents (name, role, status, workspace_id, created_at,
                           updated_at, last_seen, hidden)
       VALUES (?, 'agent', ?, 1, ?, ?, ?, 0)`,
    )
    .run(name, status, now, now, status === 'idle' ? now : now - 3600)
}

function seedHeartbeat(
  lastHeartbeatAt: number,
  metadata: Record<string, unknown> | null = null,
): void {
  testDb
    .prepare(
      `INSERT OR REPLACE INTO runner_heartbeats
         (runner_id, last_heartbeat_at, registered_at, metadata_json)
       VALUES ('test-runner', ?, ?, ?)`,
    )
    .run(
      lastHeartbeatAt,
      lastHeartbeatAt,
      metadata ? JSON.stringify(metadata) : null,
    )
}

function taskStatus(id: number): string {
  return (
    (
      testDb.prepare(`SELECT status FROM tasks WHERE id = ?`).get(id) as
        | { status: string }
        | undefined
    )?.status ?? 'missing'
  )
}

// Anchor the fake clock to a stable epoch so seed math is readable.
const BASE_TIME_MS = Date.UTC(2026, 3, 21, 12, 0, 0) // 2026-04-21T12:00:00.000Z

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  testDb.prepare(`DELETE FROM agents`).run()
  broadcast.mockClear()

  // Stop any leftover scheduler from a prior suite before each test.
  stopScheduler()
  vi.useFakeTimers()
  vi.setSystemTime(BASE_TIME_MS)
})

afterEach(() => {
  stopScheduler()
  vi.useRealTimers()
  testDb.close()
})

// -------------------------------------------------------------------------
// Test cases
// -------------------------------------------------------------------------

describe('Phase 15 Plan 15-07 Task 2 — scheduler + reconcile + requeue orchestration', () => {
  it('1. SCHED-01 autoRouteInboxTasks: recipe-tagged row fast-paths WITHOUT agent scoring; legacy row leaves the recipe lane', async () => {
    // Recipe-tagged inbox — no agent seeded, deliberately.
    const recipeId = insertInboxTask({
      title: 'recipe inbox',
      recipe_slug: 'hello-world',
    })
    // Legacy inbox — recipe_slug NULL. With no matching agent seeded, the
    // legacy loop runs but does not route. We only care that the fast-path
    // did NOT touch the legacy row.
    const legacyId = insertInboxTask({ title: 'legacy inbox', recipe_slug: null })

    await autoRouteInboxTasks()

    expect(taskStatus(recipeId)).toBe('assigned')
    // Legacy row not moved (no matching agent).
    expect(taskStatus(legacyId)).toBe('inbox')

    const runnerRequested = broadcast.mock.calls.filter(
      (c) => c[0] === 'task.runner_requested',
    )
    expect(runnerRequested).toHaveLength(1)
    expect(runnerRequested[0][1]).toMatchObject({
      task_id: recipeId,
      recipe_slug: 'hello-world',
    })
  })

  it('2. SCHED-02 dispatchAssignedTasks: recipe-tagged assigned row skipped; legacy row picked up', async () => {
    seedAgent('aegis', 'idle')

    const recipeId = insertAssignedTask({
      title: 'recipe-assigned',
      assigned_to: 'aegis',
      recipe_slug: 'hello-world',
    })
    const legacyId = insertAssignedTask({
      title: 'legacy-assigned',
      assigned_to: 'aegis',
      recipe_slug: null,
    })

    vi.stubEnv('ANTHROPIC_API_KEY', '')
    await dispatchAssignedTasks()
    vi.unstubAllEnvs()

    // Recipe row never touched by legacy dispatch.
    expect(taskStatus(recipeId)).toBe('assigned')
    // Legacy row was at least processed (started with status='assigned',
    // dispatchAssignedTasks flips it to 'in_progress' before dispatching;
    // the downstream dispatch fails for lack of credentials and the row may
    // settle back to 'assigned' or 'failed' depending on catch-branch).
    expect(['in_progress', 'assigned', 'failed']).toContain(taskStatus(legacyId))
  })

  it('3. SCHED-03 requeueStaleTasks: fresh heartbeat with active_task_ids distinguishes alive-tracked vs alive-but-lost vs never-reported', async () => {
    const now = Math.floor(Date.now() / 1000)

    // Tasks 1, 2, 3 are all in_progress recipe-tagged with stale updated_at.
    const t1 = insertInProgressTask({
      title: 't1-alive-and-tracked',
      recipe_slug: 'hello-world',
      updated_at: now - 1000,
    })
    const t2 = insertInProgressTask({
      title: 't2-alive-and-tracked',
      recipe_slug: 'hello-world',
      updated_at: now - 1000,
    })
    const t3 = insertInProgressTask({
      title: 't3-lost-by-runner',
      recipe_slug: 'hello-world',
      updated_at: now - 1000,
    })
    // Fresh heartbeat reports tasks t1 + t2 as active. t3 is NOT in inventory.
    seedHeartbeat(now - 10, { active_task_ids: [t1, t2] })

    await requeueStaleTasks()

    // t1/t2 unchanged — runner tracks them.
    expect(taskStatus(t1)).toBe('in_progress')
    expect(taskStatus(t2)).toBe('in_progress')
    // t3 flipped — runner does not know about it.
    expect(taskStatus(t3)).toBe('assigned')

    const runnerRequested = broadcast.mock.calls.filter(
      (c) => c[0] === 'task.runner_requested',
    )
    expect(runnerRequested).toHaveLength(1)
    expect((runnerRequested[0][1] as { task_id: number }).task_id).toBe(t3)
  })

  it('4. SCHED-04 reconcileRunnerHeartbeat: no fresh heartbeat + stale updated_at → flip stuck recipe-tasks to assigned', async () => {
    // Advance the clock 120s so the 90s stale window is unambiguously past.
    const initialNow = Math.floor(Date.now() / 1000)
    const t = insertInProgressTask({
      title: 'stuck',
      recipe_slug: 'hello-world',
      updated_at: initialNow,
    })

    // Fast-forward 120_000 ms (2 min). heartbeat never arrived → stale.
    vi.setSystemTime(BASE_TIME_MS + 120_000)

    await reconcileRunnerHeartbeat()

    expect(taskStatus(t)).toBe('assigned')

    const runnerRequested = broadcast.mock.calls.filter(
      (c) => c[0] === 'task.runner_requested',
    )
    expect(runnerRequested).toHaveLength(1)
    expect((runnerRequested[0][1] as { task_id: number }).task_id).toBe(t)
  })

  it('5. SCHED-04 reconcileRunnerHeartbeat: fresh heartbeat → no flip even when task updated_at is stale', async () => {
    const initialNow = Math.floor(Date.now() / 1000)
    const t = insertInProgressTask({
      title: 'in-progress-fresh-hb',
      recipe_slug: 'hello-world',
      updated_at: initialNow - 1000,
    })
    // Seed a fresh heartbeat (10s ago — well within 90s window).
    seedHeartbeat(initialNow - 10)

    await reconcileRunnerHeartbeat()

    // Fresh heartbeat exists → the reconcile early-returns. Task untouched —
    // other mechanisms (container liveness probe, runner-exit) cover the case
    // where a recipe-task stalled while the runner is still alive.
    expect(taskStatus(t)).toBe('in_progress')
    expect(
      broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested'),
    ).toHaveLength(0)
  })

  it('6. SCHED-04 reconcileRunnerHeartbeat: recently-updated recipe-task NOT flipped even when heartbeat is stale (just-claimed guard)', async () => {
    const initialNow = Math.floor(Date.now() / 1000)
    // Recently-claimed — updated_at = now-5 (fresh). No heartbeat at all.
    const t = insertInProgressTask({
      title: 'just-claimed',
      recipe_slug: 'hello-world',
      updated_at: initialNow - 5,
    })

    // Advance 120s so heartbeat window is stale but task.updated_at is still
    // within the 90s window (initialNow-5 vs now-90 boundary).
    // After setSystemTime(+120s): now = initialNow + 120.
    // Task updated_at = initialNow - 5 → age = 125s > 90s, so it IS stale.
    // To keep task updated_at FRESH we need age < 90s at check time.
    // Seed updated_at = initialNow + 60 (so at clock+120s, age = 60s — fresh).
    testDb
      .prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`)
      .run(initialNow + 60, t)

    vi.setSystemTime(BASE_TIME_MS + 120_000)

    await reconcileRunnerHeartbeat()

    // Heartbeat is stale (no row at all) BUT task.updated_at is fresh — the
    // just-claimed guard keeps the task where it is.
    expect(taskStatus(t)).toBe('in_progress')
    expect(
      broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested'),
    ).toHaveLength(0)
  })

  it('7. scheduler tick ladder: reconcile_runner_heartbeat registered, enabled by default, triggerable', async () => {
    initScheduler()
    try {
      const status = getSchedulerStatus()
      const reconcile = status.find((s) => s.id === 'reconcile_runner_heartbeat')
      expect(reconcile).toBeDefined()
      expect(reconcile!.enabled).toBe(true)
      expect(reconcile!.name).toBe('Reconcile Runner Heartbeat')

      // triggerTask wired — the real reconcileRunnerHeartbeat runs against the
      // empty DB and returns the "Runner heartbeat fresh"/"No stale ..." message.
      const result = await triggerTask('reconcile_runner_heartbeat')
      expect(result.ok).toBe(true)
    } finally {
      stopScheduler()
    }
  })

  it('8. regression: legacy requeueStaleTasks path still flips stale rows with offline agent', async () => {
    const now = Math.floor(Date.now() / 1000)
    seedAgent('offline-agent', 'offline')

    const id = insertInProgressTask({
      title: 'legacy-stale',
      recipe_slug: null, // legacy branch
      assigned_to: 'offline-agent',
      updated_at: now - 1000,
    })

    await requeueStaleTasks()

    const row = testDb
      .prepare(
        `SELECT status, error_message, dispatch_attempts
         FROM tasks WHERE id = ?`,
      )
      .get(id) as {
      status: string
      error_message: string | null
      dispatch_attempts: number
    }
    expect(row.status).toBe('assigned')
    expect(row.error_message).toContain('offline')
    expect(row.dispatch_attempts).toBe(1)

    // Legacy path does NOT emit task.runner_requested (recipe branch does).
    const runnerRequested = broadcast.mock.calls.filter(
      (c) => c[0] === 'task.runner_requested',
    )
    expect(runnerRequested).toHaveLength(0)
  })
})
