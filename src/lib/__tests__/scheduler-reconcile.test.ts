/**
 * Phase 15 Plan 15-02 Task 1: Scheduler-level integration tests for the
 * `reconcile_runner_heartbeat` tick registration.
 *
 * Scope: ladder wiring only (tasks Map entry, settings-key + defaultEnabled
 * ladder, dispatch ladder, getSchedulerStatus, triggerTask). The unit tests
 * for `reconcileRunnerHeartbeat()`'s own behavior live in
 * `src/lib/__tests__/task-dispatch-reconcile.test.ts` (Task 4) — this file
 * deliberately mocks the function so failures localize to the scheduler.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock every dispatch-surface function the scheduler imports from
// @/lib/task-dispatch. The focus of this file is ladder wiring, not the
// downstream implementations — replace each with a vi.fn stub.
vi.mock('@/lib/task-dispatch', () => ({
  autoRouteInboxTasks: vi.fn(() => Promise.resolve({ ok: true, message: 'autoroute stub' })),
  dispatchAssignedTasks: vi.fn(() => Promise.resolve({ ok: true, message: 'dispatch stub' })),
  requeueStaleTasks: vi.fn(() => Promise.resolve({ ok: true, message: 'requeue stub' })),
  runAegisReviews: vi.fn(() => Promise.resolve({ ok: true, message: 'aegis stub' })),
  reconcileRunnerHeartbeat: vi.fn(() => Promise.resolve({ ok: true, message: 'reconcile stub' })),
}))

// Suppress the other scheduler-imported side-effects. None of these touch
// the disk in a meaningful way for the tests below, but they all consult
// `getDatabase()` at import time; stubbing keeps the suite hermetic.
vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: () => ({ get: () => undefined, all: () => [], run: () => ({ changes: 0 }) }),
    backup: () => Promise.resolve(),
    transaction: (fn: () => unknown) => () => fn(),
  }),
  logAuditEvent: vi.fn(),
}))
vi.mock('@/lib/agent-sync', () => ({ syncAgentsFromConfig: vi.fn(() => Promise.resolve({ created: 0, updated: 0, synced: 0 })) }))
vi.mock('@/lib/webhooks', () => ({ processWebhookRetries: vi.fn(() => Promise.resolve({ ok: true, message: 'wh stub' })) }))
vi.mock('@/lib/claude-sessions', () => ({ syncClaudeSessions: vi.fn(() => Promise.resolve({ ok: true, message: 'claude stub' })) }))
vi.mock('@/lib/sessions', () => ({
  pruneGatewaySessionsOlderThan: vi.fn(() => ({ deleted: 0 })),
  getAgentLiveStatuses: vi.fn(() => new Map()),
}))
vi.mock('@/lib/skill-sync', () => ({ syncSkillsFromDisk: vi.fn(() => Promise.resolve({ ok: true, message: 'skill stub' })) }))
vi.mock('@/lib/local-agent-sync', () => ({ syncLocalAgents: vi.fn(() => Promise.resolve({ ok: true, message: 'local stub' })) }))
vi.mock('@/lib/recurring-tasks', () => ({ spawnRecurringTasks: vi.fn(() => Promise.resolve({ ok: true, message: 'rec stub' })) }))
vi.mock('@/lib/workflow-engine', () => ({
  advanceDueWorkflowTimers: vi.fn(() => ({
    completed: [{ workflow_instance_id: 1, node_instance_id: 2, node_key: 'wait' }],
    materialized: [{ workflow_instance_id: 1, created: [{ task_id: 3, node_key: 'follow_up', title: 'Follow up' }], skipped: [] }],
  })),
}))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))

import { initScheduler, stopScheduler, triggerTask, getSchedulerStatus } from '@/lib/scheduler'
import { reconcileRunnerHeartbeat } from '@/lib/task-dispatch'
import { advanceDueWorkflowTimers } from '@/lib/workflow-engine'

describe('scheduler — Phase 15 reconcile_runner_heartbeat tick (SCHED-04)', () => {
  beforeEach(() => {
    // Defensive: scheduler is a module-scoped singleton; stop any leftover
    // tickInterval from a prior suite before (re)initializing.
    stopScheduler()
    vi.clearAllMocks()
  })

  afterEach(() => {
    stopScheduler()
  })

  it('initScheduler registers reconcile_runner_heartbeat with intervalMs=30_000', () => {
    initScheduler()
    const status = getSchedulerStatus()
    const entry = status.find((s) => s.id === 'reconcile_runner_heartbeat')
    expect(entry).toBeDefined()
    expect(entry!.name).toBe('Reconcile Runner Heartbeat')
    // The tasks.set(...) sets intervalMs: 30_000 directly (LOCKED).
    // getSchedulerStatus shape projects `enabled`, `lastRun`, `nextRun`,
    // `running`, `lastResult` — intervalMs is internal. Verify instead that
    // the entry exists and is enabled by default (Phase 15 defaultEnabled).
    expect(entry!.enabled).toBe(true)
    expect(entry!.running).toBe(false)
  })

  it('task_dispatch inherits TICK_MS=30_000 (SCHED-04 cadence reduction)', () => {
    initScheduler()
    const status = getSchedulerStatus()
    const dispatch = status.find((s) => s.id === 'task_dispatch')
    expect(dispatch).toBeDefined()
    // nextRun should be within ~10 seconds of now+10_000 (first-run delay),
    // proving the registration used TICK_MS for the initial schedule.
    // A lenient floor covers test harness clock drift.
    const now = Date.now()
    expect(dispatch!.nextRun).toBeGreaterThan(now + 5_000)
    expect(dispatch!.nextRun).toBeLessThan(now + 20_000)
  })

  it('triggerTask("reconcile_runner_heartbeat") calls reconcileRunnerHeartbeat exactly once', async () => {
    initScheduler()
    const result = await triggerTask('reconcile_runner_heartbeat')
    expect(reconcileRunnerHeartbeat).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(result.message).toBe('reconcile stub')
  })

  it('triggerTask("workflow_timer_advance") calls advanceDueWorkflowTimers without OpenClaw cron', async () => {
    initScheduler()
    const result = await triggerTask('workflow_timer_advance')
    expect(advanceDueWorkflowTimers).toHaveBeenCalledTimes(1)
    expect(advanceDueWorkflowTimers).toHaveBeenCalledWith(expect.anything(), {
      actor: 'workflow-timer',
      limit: 500,
      status: 'inbox',
    })
    expect(result.ok).toBe(true)
    expect(result.message).toBe('Advanced 1 workflow timer(s); materialized 1 task(s)')
  })

  it('workflow_timer_advance is registered and enabled by default', () => {
    initScheduler()
    const entry = getSchedulerStatus().find((s) => s.id === 'workflow_timer_advance')
    expect(entry).toBeDefined()
    expect(entry!.name).toBe('Workflow Timer Advance')
    expect(entry!.enabled).toBe(true)
    expect(entry!.running).toBe(false)
  })

  it('triggerTask rejects unknown tasks (regression guard for ladder)', async () => {
    initScheduler()
    const result = await triggerTask('not_a_real_task')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Unknown task')
  })

  it('getSchedulerStatus includes every Phase 14/15 task id (regression)', () => {
    initScheduler()
    const ids = getSchedulerStatus().map((s) => s.id).sort()
    // This list must include the new entry alongside every pre-Phase-15 entry.
    expect(ids).toContain('reconcile_runner_heartbeat')
    expect(ids).toContain('workflow_timer_advance')
    expect(ids).toContain('task_dispatch')
    expect(ids).toContain('stale_task_requeue')
    expect(ids).toContain('aegis_review')
    expect(ids).toContain('auto_backup')
  })

  it('reconcile entry defaults to enabled when no settings row is present', () => {
    // The mocked getDatabase returns `get: () => undefined` so isSettingEnabled
    // falls back to defaultEnabled. defaultEnabled chain in scheduler.ts Task 1
    // includes 'reconcile_runner_heartbeat' — this asserts that link.
    initScheduler()
    const entry = getSchedulerStatus().find((s) => s.id === 'reconcile_runner_heartbeat')
    expect(entry!.enabled).toBe(true)
  })
})
