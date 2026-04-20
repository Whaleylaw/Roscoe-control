import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Covers: GSD-15, GSD-16, D-30, D-31, D-32 (Phase 09 gate enforcement on forward motion).
// PUT /api/tasks/:id status transitions are BLOCKED from moving forward
// (in_progress/done) while gate_required=1 and gate_status != "approved".
// Backward/lateral motions (backlog, review, awaiting_owner) remain allowed
// per D-31. Rejected status behaves same as pending per D-32.
//
// Note: the task status enum in the schema is
//   ['backlog','inbox','assigned','awaiting_owner','in_progress','review','quality_review','done','failed']
// so D-31 backward/lateral motion is tested with 'backlog', 'review', 'awaiting_owner'.

// --- auth mock (role-aware) --------------------------------------------------
type AuthResult =
  | { user: { id: number; username: string; role: string; workspace_id: number; tenant_id: number } }
  | { error: string; status: number }
const requireRoleMock = vi.fn<(req: unknown, role: string) => AuthResult>(() => ({
  user: { id: 10, username: 'opuser', role: 'operator', workspace_id: 1, tenant_id: 1 },
}))

// --- validation mock (pass-through: whatever body, echo data) ----------------
const validateBodyMock = vi.fn(async (req: Request) => {
  const body = await req.json().catch(() => ({}))
  return { data: body }
})

// --- rate-limit mock ---------------------------------------------------------
const mutationLimiterMock = vi.fn(() => null)

// --- mentions mock (no mentions in status-change bodies) ---------------------
const resolveMentionRecipientsMock = vi.fn(() => ({ recipients: [], unresolved: [] }))

// --- github/gnap outbound mock (no-op) --------------------------------------
const syncTaskOutboundMock = vi.fn()
const removeTaskFromGnapMock = vi.fn()

// --- event-bus spy -----------------------------------------------------------
const broadcastMock = vi.fn()

// --- db spies ----------------------------------------------------------------
const logActivityMock = vi.fn()
const createNotificationMock = vi.fn()
const ensureTaskSubscriptionMock = vi.fn()

// In-memory task fixture store keyed by id.
const taskFixtures: Record<number, Record<string, unknown> | undefined> = {}

function prepareImpl(sql: string) {
  // The route executes several prepared statements in a PUT flow:
  //  - SELECT * FROM tasks WHERE id = ? AND workspace_id = ?       (currentTask)
  //  - SELECT value FROM settings WHERE key = ?                     (Phase 13 caps/allowlist)
  //  - (maybe) project lookups / ticket counter updates
  //  - UPDATE tasks SET ... WHERE id = ? AND workspace_id = ?      (writes)
  //  - SELECT t.*, p.name ... FROM tasks t LEFT JOIN projects p    (re-fetch)
  //  - quality_reviews SELECT                                       (aegis check)
  if (/^\s*SELECT\s+\*\s+FROM\s+tasks\b/i.test(sql)) {
    return {
      get: (taskId: number, _ws: number) => taskFixtures[taskId],
    }
  }
  if (/SELECT\s+value\s+FROM\s+settings\s+WHERE\s+key/i.test(sql)) {
    // Phase 13: runtime settings getters (mount allowlist + caps). Returning
    // undefined falls back to defaults (empty allowlist, default caps 10/20).
    // Gate-block tests never exercise runtime-context fields, so the default
    // state is fine — the route's runtime-context block is a no-op when the
    // PATCH body has no recipe_slug/mounts/skills.
    return {
      get: (_key: string) => undefined,
    }
  }
  if (/SELECT\s+status\s+FROM\s+quality_reviews/i.test(sql)) {
    // For tests that let the flow reach the Aegis check, we return 'approved'
    // so Aegis does not block — isolating the gate-block test from Aegis.
    return {
      get: (_taskId: number, _ws: number) => ({ status: 'approved' }),
    }
  }
  if (/^\s*UPDATE\s+tasks\b/i.test(sql)) {
    return {
      run: (...params: unknown[]) => {
        const taskId = params[params.length - 2] as number
        const row = taskFixtures[taskId]
        if (row) row.updated_at = Math.floor(Date.now() / 1000)
        return { changes: 1 }
      },
    }
  }
  if (/FROM\s+tasks\s+t\s+LEFT\s+JOIN\s+projects/i.test(sql)) {
    return {
      get: (taskId: number, _ws: number) => taskFixtures[taskId],
    }
  }
  // Fallback — return a chain-safe stub. Unknown SQL should not crash the flow.
  return {
    get: () => undefined,
    run: () => ({ changes: 0 }),
    all: () => [],
  }
}

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => prepareImpl(sql),
    // Plan 11-04: the PUT route wraps UPDATE + runner-token revocation in a
    // db.transaction(() => { ... })() block. Mock it as an immediate-runner:
    // call the fn synchronously, return its result. Better-sqlite3 itself
    // behaves the same for a successful transaction.
    transaction: (fn: () => unknown) => () => fn(),
  }),
  db_helpers: {
    logActivity: (...args: unknown[]) => logActivityMock(...args),
    createNotification: (...args: unknown[]) => createNotificationMock(...args),
    ensureTaskSubscription: (...args: unknown[]) => ensureTaskSubscriptionMock(...args),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: (req: unknown, role: string) => requireRoleMock(req, role),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: mutationLimiterMock,
}))

vi.mock('@/lib/validation', async () => {
  const actual = await vi.importActual<typeof import('@/lib/validation')>('@/lib/validation')
  return {
    ...actual,
    validateBody: validateBodyMock,
  }
})

vi.mock('@/lib/mentions', () => ({
  resolveMentionRecipients: resolveMentionRecipientsMock,
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: broadcastMock },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('@/lib/task-status', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return actual
})

vi.mock('@/lib/github-sync-engine', () => ({
  syncTaskOutbound: syncTaskOutboundMock,
}))

vi.mock('@/lib/gnap-sync', () => ({
  removeTaskFromGnap: removeTaskFromGnapMock,
}))

vi.mock('@/lib/config', () => ({
  config: { gnap: { enabled: false, autoSync: false } },
}))

function makeRequest(id: number | string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body ?? {}),
    headers: { 'content-type': 'application/json' },
  })
}

function seedTask(overrides: Partial<Record<string, unknown>> = {}) {
  const base: Record<string, unknown> = {
    id: 42,
    workspace_id: 1,
    title: 'Gated task',
    description: '',
    status: 'inbox',
    priority: 'medium',
    project_id: null,
    assigned_to: null,
    gsd_phase: 'plan',
    gate_required: 1,
    gate_status: 'pending',
    gate_approved_by: null,
    gate_approved_at: null,
    updated_at: 1000,
    completed_at: null,
    tags: null,
    metadata: null,
  }
  const merged = { ...base, ...overrides }
  taskFixtures[merged.id as number] = merged
  return merged
}

describe('PUT /api/tasks/:id gate enforcement (GSD-15, GSD-16, D-30, D-31, D-32)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const k of Object.keys(taskFixtures)) delete taskFixtures[Number(k)]
    requireRoleMock.mockImplementation((): AuthResult => ({
      user: { id: 10, username: 'opuser', role: 'operator', workspace_id: 1, tenant_id: 1 },
    }))
  })

  it('blocks status="in_progress" on gate_required=1, gate_status="pending" with 403 code="GATE_BLOCKED" (GSD-15, D-30)', async () => {
    seedTask({ gate_required: 1, gate_status: 'pending' })
    const { PUT } = await import('@/app/api/tasks/[id]/route')
    const res = await PUT(makeRequest(42, { status: 'in_progress' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('GATE_BLOCKED')
    expect(body.gate_status).toBe('pending')
    expect(body.gate_required).toBe(1)
  })

  it('blocks status="done" on gate_required=1, gate_status="pending" with 403 code="GATE_BLOCKED" (GSD-15)', async () => {
    seedTask({ gate_required: 1, gate_status: 'pending' })
    const { PUT } = await import('@/app/api/tasks/[id]/route')
    const res = await PUT(makeRequest(42, { status: 'done' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('GATE_BLOCKED')
  })

  it('allows status="in_progress" once gate_status="approved" (GSD-15 unblock path)', async () => {
    seedTask({ gate_required: 1, gate_status: 'approved' })
    const { PUT } = await import('@/app/api/tasks/[id]/route')
    const res = await PUT(makeRequest(42, { status: 'in_progress' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(200)
  })

  it('allows status="backlog" on gate_required=1, gate_status="pending" (D-31 backward motion)', async () => {
    seedTask({ gate_required: 1, gate_status: 'pending' })
    const { PUT } = await import('@/app/api/tasks/[id]/route')
    const res = await PUT(makeRequest(42, { status: 'backlog' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(200)
  })

  it('allows status="review" on gate_required=1, gate_status="pending" (D-31 lateral motion)', async () => {
    seedTask({ gate_required: 1, gate_status: 'pending' })
    const { PUT } = await import('@/app/api/tasks/[id]/route')
    const res = await PUT(makeRequest(42, { status: 'review' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(200)
  })

  it('allows status="awaiting_owner" on gate_required=1, gate_status="pending" (D-31 sideways motion)', async () => {
    seedTask({ gate_required: 1, gate_status: 'pending' })
    const { PUT } = await import('@/app/api/tasks/[id]/route')
    const res = await PUT(makeRequest(42, { status: 'awaiting_owner' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(200)
  })

  it('blocks status="in_progress" when gate_status="rejected" same as pending (D-32)', async () => {
    seedTask({ gate_required: 1, gate_status: 'rejected' })
    const { PUT } = await import('@/app/api/tasks/[id]/route')
    const res = await PUT(makeRequest(42, { status: 'in_progress' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('GATE_BLOCKED')
    expect(body.gate_status).toBe('rejected')
  })

  it('allows status="in_progress" on gate_required=0, gate_status="not_required" (non-gated bypass)', async () => {
    seedTask({ gate_required: 0, gate_status: 'not_required' })
    const { PUT } = await import('@/app/api/tasks/[id]/route')
    const res = await PUT(makeRequest(42, { status: 'in_progress' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(200)
  })

  it('403 response body exposes gate_status and gate_required context fields (UI-SPEC error shape)', async () => {
    seedTask({ gate_required: 1, gate_status: 'pending' })
    const { PUT } = await import('@/app/api/tasks/[id]/route')
    const res = await PUT(makeRequest(42, { status: 'done' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toHaveProperty('gate_status')
    expect(body).toHaveProperty('gate_required')
    expect(body.gate_required).toBe(1)
    expect(typeof body.error).toBe('string')
  })
})
