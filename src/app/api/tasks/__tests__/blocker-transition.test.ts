/**
 * Phase 20 Plan 20-02 (ROUTE-02, COMPAT-03) — legacy blocker contract.
 *
 * Covers:
 *   - Legacy pause: in_progress → awaiting_owner with envelope persisted to
 *     runner_last_failure_reason inside db.transaction().
 *   - Missing-field 400: every permutation of absent blocker_reason /
 *     blocker_kind / resume_hint (single-field and multi-field).
 *   - Invalid blocker_kind enum: 400 from Zod (reached before the handler
 *     branch).
 *   - Recipe-tagged 409 redirect to the checkpoints endpoint.
 *   - Legacy resume: awaiting_owner → assigned clears envelope and preserves
 *     assigned_to.
 *   - Resume on a non-paused task falls through to the generic write path
 *     (no reason: 'blocker_resume_legacy').
 *   - Retry/fail preservation (COMPAT-03): scheduler direct UPDATE still
 *     works without blocker fields.
 *   - Gate-required preserved: awaiting_owner pause does NOT trip GATE_BLOCKED
 *     because awaiting_owner is not a forward-motion target.
 *   - Concurrent-transition 409 when the row was flipped before the PUT
 *     committed.
 *
 * Pattern: in-memory better-sqlite3 + runMigrations + mocked auth /
 * rate-limit / event-bus / mentions, following queue-route.test.ts +
 * route-recipe-emission.test.ts.
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
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
  Task: {},
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: () => ({
    user: {
      id: 7,
      username: 'tester',
      display_name: 'Tester',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
    },
  }),
}))

vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: (...args: unknown[]) => broadcast(...args) },
}))
vi.mock('@/lib/github-sync-engine', () => ({
  pushTaskToGitHub: vi.fn(),
  syncTaskOutbound: vi.fn(),
}))
vi.mock('@/lib/gnap-sync', () => ({
  pushTaskToGnap: vi.fn(),
  removeTaskFromGnap: vi.fn(),
}))
vi.mock('@/lib/mentions', () => ({
  resolveMentionRecipients: () => ({ recipients: [], unresolved: [] }),
}))
vi.mock('@/lib/config', () => ({
  config: { gnap: { enabled: false, autoSync: false, repoPath: '/tmp/noop' } },
}))

import { PUT } from '@/app/api/tasks/[id]/route'

// --- Fixture helpers --------------------------------------------------------

interface SeedTaskOpts {
  id: number
  status: string
  assigned_to?: string | null
  recipe_slug?: string | null
  gate_required?: 0 | 1
  gate_status?: 'not_required' | 'pending' | 'approved' | 'rejected'
  runner_last_failure_reason?: string | null
  dispatch_attempts?: number
  project_id?: number | null
}

function insertLegacyTask(opts: SeedTaskOpts) {
  const now = Math.floor(Date.now() / 1000)
  testDb
    .prepare(
      `INSERT INTO tasks (id, title, status, priority, project_id, workspace_id,
         assigned_to, recipe_slug, runner_last_failure_reason, dispatch_attempts,
         gate_required, gate_status,
         created_at, updated_at)
       VALUES (?, ?, ?, 'medium', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.id,
      `task-${opts.id}`,
      opts.status,
      opts.project_id ?? null,
      opts.assigned_to ?? null,
      opts.recipe_slug ?? null,
      opts.runner_last_failure_reason ?? null,
      opts.dispatch_attempts ?? 0,
      opts.gate_required ?? 0,
      opts.gate_status ?? 'not_required',
      now,
      now,
    )
}

function readTask(id: number): Record<string, any> | undefined {
  return testDb
    .prepare('SELECT * FROM tasks WHERE id = ?')
    .get(id) as Record<string, any> | undefined
}

function makeRequest(id: number, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function broadcastCalls(event: string) {
  return broadcast.mock.calls.filter((c) => c[0] === event)
}

// --- Lifecycle --------------------------------------------------------------

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  broadcast.mockClear()
})

afterEach(() => {
  testDb.close()
  vi.clearAllMocks()
})

// --- Tests ------------------------------------------------------------------

describe('PUT /api/tasks/:id legacy blocker contract (ROUTE-02, COMPAT-03)', () => {
  it('pauses a legacy in_progress task with full envelope', async () => {
    insertLegacyTask({
      id: 100,
      status: 'in_progress',
      assigned_to: 'agent-alice',
      recipe_slug: null,
    })

    const res = await PUT(
      makeRequest(100, {
        status: 'awaiting_owner',
        blocker_reason: 'Need the final budget number from legal',
        blocker_kind: 'needs_input',
        resume_hint: 'Reply in a task comment with the approved budget',
      }),
      { params: Promise.resolve({ id: '100' }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.status).toBe('awaiting_owner')
    // assigned_to MUST be preserved through the pause.
    expect(body.task.assigned_to).toBe('agent-alice')

    const row = readTask(100)!
    expect(row.status).toBe('awaiting_owner')
    expect(row.assigned_to).toBe('agent-alice')
    expect(row.runner_last_failure_reason).not.toBeNull()
    const envelope = JSON.parse(row.runner_last_failure_reason as string)
    expect(envelope).toEqual({
      blocker_reason: 'Need the final budget number from legal',
      blocker_kind: 'needs_input',
      resume_hint: 'Reply in a task comment with the approved budget',
    })

    const statusCalls = broadcastCalls('task.status_changed')
    expect(statusCalls.length).toBe(1)
    expect(statusCalls[0][1]).toMatchObject({
      id: 100,
      status: 'awaiting_owner',
      previous_status: 'in_progress',
      reason: 'blocker_pause_legacy',
      workspace_id: 1,
    })
    // task.updated should also fire for back-compat with existing subscribers.
    const updatedCalls = broadcastCalls('task.updated')
    expect(updatedCalls.length).toBe(1)
    expect(updatedCalls[0][1]).toMatchObject({
      id: 100,
      status: 'awaiting_owner',
    })
  })

  it('returns 400 listing missing fields when blocker_reason is absent', async () => {
    insertLegacyTask({
      id: 101,
      status: 'in_progress',
      assigned_to: 'agent-alice',
      recipe_slug: null,
    })

    const res = await PUT(
      makeRequest(101, {
        status: 'awaiting_owner',
        blocker_kind: 'needs_input',
        resume_hint: 'please reply',
      }),
      { params: Promise.resolve({ id: '101' }) },
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BLOCKER_FIELDS_MISSING')
    expect(body.missing).toEqual(expect.arrayContaining(['blocker_reason']))
    expect(body.error).toMatch(/blocker_reason/)

    const row = readTask(101)!
    expect(row.status).toBe('in_progress')
    expect(row.runner_last_failure_reason).toBeNull()
  })

  it('returns 400 listing missing fields when blocker_kind is absent', async () => {
    insertLegacyTask({
      id: 102,
      status: 'in_progress',
      assigned_to: 'agent-alice',
      recipe_slug: null,
    })

    const res = await PUT(
      makeRequest(102, {
        status: 'awaiting_owner',
        blocker_reason: 'Need info',
        resume_hint: 'please reply',
      }),
      { params: Promise.resolve({ id: '102' }) },
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BLOCKER_FIELDS_MISSING')
    expect(body.missing).toEqual(expect.arrayContaining(['blocker_kind']))
    expect(body.error).toMatch(/blocker_kind/)

    const row = readTask(102)!
    expect(row.status).toBe('in_progress')
  })

  it('returns 400 listing missing fields when resume_hint is absent', async () => {
    insertLegacyTask({
      id: 103,
      status: 'in_progress',
      assigned_to: 'agent-alice',
      recipe_slug: null,
    })

    const res = await PUT(
      makeRequest(103, {
        status: 'awaiting_owner',
        blocker_reason: 'Need info',
        blocker_kind: 'needs_input',
      }),
      { params: Promise.resolve({ id: '103' }) },
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BLOCKER_FIELDS_MISSING')
    expect(body.missing).toEqual(expect.arrayContaining(['resume_hint']))
    expect(body.error).toMatch(/resume_hint/)

    const row = readTask(103)!
    expect(row.status).toBe('in_progress')
  })

  it('returns 400 when multiple fields are missing (listed together)', async () => {
    insertLegacyTask({
      id: 104,
      status: 'in_progress',
      assigned_to: 'agent-alice',
      recipe_slug: null,
    })

    const res = await PUT(
      makeRequest(104, { status: 'awaiting_owner' }),
      { params: Promise.resolve({ id: '104' }) },
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BLOCKER_FIELDS_MISSING')
    expect(body.missing).toEqual(
      expect.arrayContaining(['blocker_reason', 'blocker_kind', 'resume_hint']),
    )

    const row = readTask(104)!
    expect(row.status).toBe('in_progress')
  })

  it('rejects an invalid blocker_kind with a 400 from the Zod schema', async () => {
    insertLegacyTask({
      id: 105,
      status: 'in_progress',
      assigned_to: 'agent-alice',
      recipe_slug: null,
    })

    const res = await PUT(
      makeRequest(105, {
        status: 'awaiting_owner',
        blocker_reason: 'Need info',
        blocker_kind: 'banana',
        resume_hint: 'please reply',
      }),
      { params: Promise.resolve({ id: '105' }) },
    )

    expect(res.status).toBe(400)
    // Schema-layer rejection — the handler never reaches BLOCKER_FIELDS_MISSING.
    const body = await res.json()
    expect(body.code).not.toBe('BLOCKER_FIELDS_MISSING')

    const row = readTask(105)!
    expect(row.status).toBe('in_progress')
    expect(row.runner_last_failure_reason).toBeNull()
  })

  it('rejects a recipe-tagged task with 409 and a redirect message', async () => {
    // Seed the indexed recipe row first so the Phase 13 runtime-context
    // validation in the PUT handler does not short-circuit with
    // RECIPE_NOT_FOUND 400 before our 20-02 blocker branch runs.
    testDb.prepare(`
      INSERT INTO recipes (slug, name, description, when_to_use, image, workspace_mode,
        timeout_seconds, max_concurrent, env_json, secrets_json, tags_json, model_json,
        version, dir_sha, soul_md, error_message, workspace_id, tenant_id)
      VALUES ('hello-world', 'Hello World', 'desc', 'when', 'ubuntu', 'readonly', 600, 1,
        '{}', '[]', '[]', ?, 1, 'sha-hw', NULL, NULL, 1, 1)
    `).run(JSON.stringify({ primary: 'claude-opus-4-7' }))

    insertLegacyTask({
      id: 106,
      status: 'in_progress',
      assigned_to: 'agent-runner',
      recipe_slug: 'hello-world',
    })

    const res = await PUT(
      makeRequest(106, {
        status: 'awaiting_owner',
        blocker_reason: 'Need info',
        blocker_kind: 'needs_input',
        resume_hint: 'please reply',
      }),
      { params: Promise.resolve({ id: '106' }) },
    )

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('RECIPE_BLOCKER_VIA_CHECKPOINTS')
    expect(body.error).toMatch(/checkpoints/i)

    const row = readTask(106)!
    expect(row.status).toBe('in_progress')
    expect(row.runner_last_failure_reason).toBeNull()
  })

  it('resumes a paused legacy task to assigned and clears the envelope', async () => {
    const envelope = JSON.stringify({
      blocker_reason: 'Needed budget',
      blocker_kind: 'needs_input',
      resume_hint: 'Reply with budget',
    })
    insertLegacyTask({
      id: 107,
      status: 'awaiting_owner',
      assigned_to: 'agent-alice',
      recipe_slug: null,
      runner_last_failure_reason: envelope,
    })

    const res = await PUT(
      makeRequest(107, { status: 'assigned' }),
      { params: Promise.resolve({ id: '107' }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.status).toBe('assigned')
    expect(body.task.assigned_to).toBe('agent-alice')

    const row = readTask(107)!
    expect(row.status).toBe('assigned')
    expect(row.assigned_to).toBe('agent-alice')
    expect(row.runner_last_failure_reason).toBeNull()

    const statusCalls = broadcastCalls('task.status_changed')
    expect(statusCalls.length).toBe(1)
    expect(statusCalls[0][1]).toMatchObject({
      id: 107,
      status: 'assigned',
      previous_status: 'awaiting_owner',
      reason: 'blocker_resume_legacy',
      workspace_id: 1,
    })
    const updatedCalls = broadcastCalls('task.updated')
    expect(updatedCalls.length).toBe(1)
  })

  it('resume on a non-paused task falls through to the generic write path', async () => {
    // Seed task in 'inbox' — NOT awaiting_owner. PUT status='assigned' should
    // land via the generic write path (no blocker_resume_legacy reason fires).
    insertLegacyTask({
      id: 108,
      status: 'inbox',
      assigned_to: null,
      recipe_slug: null,
    })

    const res = await PUT(
      makeRequest(108, { status: 'assigned', assigned_to: 'agent-alice' }),
      { params: Promise.resolve({ id: '108' }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.status).toBe('assigned')

    const row = readTask(108)!
    expect(row.status).toBe('assigned')
    // Generic path never touches runner_last_failure_reason; it stays NULL.
    expect(row.runner_last_failure_reason).toBeNull()

    // No blocker_resume_legacy reason fires.
    const statusCalls = broadcastCalls('task.status_changed')
    const legacyResumeCalls = statusCalls.filter(
      (c) => (c[1] as { reason?: string })?.reason === 'blocker_resume_legacy',
    )
    expect(legacyResumeCalls.length).toBe(0)

    // The generic path still emits task.updated (COMPAT-03).
    const updatedCalls = broadcastCalls('task.updated')
    expect(updatedCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('retry/fail preservation (COMPAT-03) — scheduler-driven fail bypasses this branch', async () => {
    // Seed in_progress task that has already reached retry exhaustion in the
    // scheduler path. The scheduler writes directly via db.prepare().run() —
    // this is the preserved legacy semantics. The blocker branch is a new
    // caller-initiated PUT path; it NEVER drives retry/fail.
    insertLegacyTask({
      id: 109,
      status: 'in_progress',
      assigned_to: 'agent-alice',
      recipe_slug: null,
      dispatch_attempts: 4,
    })

    const now = Math.floor(Date.now() / 1000)
    // Simulate the scheduler write directly — sanity check that this column
    // set + status='failed' transition works without any blocker fields.
    testDb
      .prepare(
        `UPDATE tasks
           SET status = ?,
               error_message = ?,
               dispatch_attempts = ?,
               updated_at = ?
         WHERE id = ?`,
      )
      .run('failed', 'Dispatch failed 5 times', 5, now, 109)

    const row = readTask(109)!
    expect(row.status).toBe('failed')
    expect(row.error_message).toBe('Dispatch failed 5 times')
    // The scheduler retry/fail path does NOT write runner_last_failure_reason
    // for legacy tasks — the blocker envelope stays null here.
    expect(row.runner_last_failure_reason).toBeNull()
  })

  it('gate-required task can still be paused (awaiting_owner bypasses gate guard)', async () => {
    insertLegacyTask({
      id: 110,
      status: 'in_progress',
      assigned_to: 'agent-alice',
      recipe_slug: null,
      gate_required: 1,
      gate_status: 'pending',
    })

    const res = await PUT(
      makeRequest(110, {
        status: 'awaiting_owner',
        blocker_reason: 'Need info',
        blocker_kind: 'needs_input',
        resume_hint: 'please reply',
      }),
      { params: Promise.resolve({ id: '110' }) },
    )

    // awaiting_owner is not a forward-motion target; the gate guard must NOT
    // fire (no 403 GATE_BLOCKED).
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.status).toBe('awaiting_owner')

    const row = readTask(110)!
    expect(row.status).toBe('awaiting_owner')
    expect(row.runner_last_failure_reason).not.toBeNull()
  })

  it('concurrent-transition returns 409 when the row was already flipped', async () => {
    // Simulate a concurrent race: at the time the handler read currentTask,
    // the row WAS 'in_progress' (so the pause branch is entered), but by the
    // time the WHERE-guarded UPDATE runs, the scheduler retry/fail path (or
    // another PUT) has flipped the row to 'failed'. The guarded UPDATE's
    // WHERE `status = 'in_progress' AND recipe_slug IS NULL` no longer
    // matches, changes === 0, the transaction throws 'concurrent_transition',
    // and the handler returns 409. The on-disk row is UNCHANGED from the
    // 'failed' state.
    //
    // Implementation: seed the row as 'failed' on-disk, but intercept the
    // handler's initial `SELECT * FROM tasks WHERE id = ? AND workspace_id = ?`
    // to return an 'in_progress' snapshot. This is the cleanest way to
    // simulate the race without crossing transaction boundaries (which
    // better-sqlite3 would roll back on throw).
    insertLegacyTask({
      id: 111,
      status: 'failed', // on-disk state after the concurrent flip
      assigned_to: 'agent-alice',
      recipe_slug: null,
    })

    const originalPrepare = testDb.prepare.bind(testDb)
    let currentTaskSelectFaked = false
    const prepareSpy = vi
      .spyOn(testDb, 'prepare')
      .mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql)
        // Intercept ONLY the first `SELECT * FROM tasks WHERE id = ? AND
        // workspace_id = ?` — that is the handler's currentTask fetch. Return
        // the on-disk row but with status forced to 'in_progress' so the
        // pause branch is entered. The subsequent guarded UPDATE will see
        // the real 'failed' status and match 0 rows.
        if (
          !currentTaskSelectFaked &&
          /^\s*SELECT\s+\*\s+FROM\s+tasks\s+WHERE\s+id\s*=\s*\?\s+AND\s+workspace_id\s*=\s*\?\s*$/i.test(sql)
        ) {
          currentTaskSelectFaked = true
          const originalGet = stmt.get.bind(stmt)
          stmt.get = ((...args: unknown[]) => {
            const row = originalGet(...args) as Record<string, unknown> | undefined
            if (row) row.status = 'in_progress'
            return row
          }) as typeof stmt.get
        }
        return stmt
      })

    const res = await PUT(
      makeRequest(111, {
        status: 'awaiting_owner',
        blocker_reason: 'Need info',
        blocker_kind: 'needs_input',
        resume_hint: 'please reply',
      }),
      { params: Promise.resolve({ id: '111' }) },
    )

    prepareSpy.mockRestore()

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('CONCURRENT_TRANSITION')

    const row = readTask(111)!
    expect(row.status).toBe('failed')
    expect(row.runner_last_failure_reason).toBeNull()
  })
})
