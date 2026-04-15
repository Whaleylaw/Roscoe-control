import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Covers: GSD-05, GSD-11, GSD-12, GSD-28 (Pitfall 6 double-broadcast).
// PATCH /api/tasks/:id/gate records gate_status transitions by
// operator users, stamps approver + timestamp, broadcasts events.

// --- auth mock (role-aware) --------------------------------------------------
type AuthResult =
  | { user: { id: number; username: string; role: string; workspace_id: number; tenant_id: number } }
  | { error: string; status: number }
const requireRoleMock = vi.fn<(req: unknown, role: string) => AuthResult>(() => ({
  user: { id: 10, username: 'opuser', role: 'operator', workspace_id: 1, tenant_id: 1 },
}))

// --- validation mock ---------------------------------------------------------
const validateBodyMock = vi.fn(async (req: Request) => {
  const body = await req.json().catch(() => ({}))
  // Mirror the real Zod behavior for the enum values we care about.
  if (body && (body.gate_status === 'approved' || body.gate_status === 'rejected')) {
    return { data: { gate_status: body.gate_status, note: body.note } }
  }
  return {
    error: new Response(JSON.stringify({ error: 'Invalid gate_status' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  }
})

// --- rate-limit mock ---------------------------------------------------------
const mutationLimiterMock = vi.fn(() => null)

// --- workspaces mock ---------------------------------------------------------
const ensureTenantWorkspaceAccessMock = vi.fn()

// --- event-bus spy -----------------------------------------------------------
const broadcastMock = vi.fn()

// --- db spies ----------------------------------------------------------------
const logActivityMock = vi.fn()

// In-memory task fixture store keyed by id.
const taskFixtures: Record<number, Record<string, unknown> | undefined> = {}

const runMock = vi.fn()

function prepareImpl(sql: string) {
  if (sql.includes('SELECT * FROM tasks')) {
    return {
      get: (taskId: number, _workspaceId: number) => taskFixtures[taskId],
    }
  }
  if (sql.includes('UPDATE tasks')) {
    return {
      run: (gateStatus: string, approver: string, approvedAt: number, updatedAt: number, taskId: number, _ws: number) => {
        runMock(gateStatus, approver, approvedAt, updatedAt, taskId, _ws)
        const row = taskFixtures[taskId]
        if (row) {
          row.gate_status = gateStatus
          row.gate_approved_by = approver
          row.gate_approved_at = approvedAt
          row.updated_at = updatedAt
        }
        return { changes: 1 }
      },
    }
  }
  throw new Error(`Unexpected SQL in gate.test.ts: ${sql}`)
}

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => prepareImpl(sql),
  }),
  db_helpers: {
    logActivity: (...args: unknown[]) => logActivityMock(...args),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: (req: unknown, role: string) => requireRoleMock(req, role),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: mutationLimiterMock,
}))

vi.mock('@/lib/validation', () => ({
  validateBody: validateBodyMock,
  taskGatePatchSchema: {},
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: broadcastMock },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('@/lib/workspaces', () => ({
  ensureTenantWorkspaceAccess: ensureTenantWorkspaceAccessMock,
  ForbiddenError: class ForbiddenError extends Error {
    status = 403
  },
}))

function makeRequest(id: number | string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${id}/gate`, {
    method: 'PATCH',
    body: JSON.stringify(body ?? {}),
    headers: { 'content-type': 'application/json' },
  })
}

function seedTask(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    id: 42,
    workspace_id: 1,
    title: 'Gate task',
    status: 'todo',
    gsd_phase: 'plan',
    gate_required: 1,
    gate_status: 'pending',
    gate_approved_by: null,
    gate_approved_at: null,
    updated_at: 1000,
  }
  const merged = { ...base, ...overrides }
  taskFixtures[merged.id as number] = merged
  return merged
}

describe('PATCH /api/tasks/:id/gate (GSD-05, GSD-11, GSD-12, GSD-28)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const k of Object.keys(taskFixtures)) delete taskFixtures[Number(k)]
    // Default role: operator. Tests override for viewer case.
    requireRoleMock.mockImplementation((): AuthResult => ({
      user: { id: 10, username: 'opuser', role: 'operator', workspace_id: 1, tenant_id: 1 },
    }))
  })

  it('viewer role gets 403', async () => {
    requireRoleMock.mockImplementationOnce((): AuthResult => ({
      error: 'Forbidden',
      status: 403,
    }))
    const { PATCH } = await import('@/app/api/tasks/[id]/gate/route')
    seedTask()
    const res = await PATCH(makeRequest(42, { gate_status: 'approved' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).toBe(403)
  })

  it('operator PATCH gate_status="approved" records gate_approved_by=auth.user.username, gate_approved_at=unixepoch()', async () => {
    seedTask()
    const before = Math.floor(Date.now() / 1000)
    const { PATCH } = await import('@/app/api/tasks/[id]/gate/route')
    const res = await PATCH(makeRequest(42, { gate_status: 'approved' }), {
      params: Promise.resolve({ id: '42' }),
    })
    const after = Math.floor(Date.now() / 1000)
    expect(res.status).toBe(200)
    const row = taskFixtures[42] as Record<string, unknown>
    expect(row.gate_status).toBe('approved')
    expect(row.gate_approved_by).toBe('opuser')
    const ts = row.gate_approved_at as number
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after + 1)
  })

  it('operator PATCH gate_status="rejected" with note records approver + timestamp and logActivity captures note', async () => {
    seedTask()
    const { PATCH } = await import('@/app/api/tasks/[id]/gate/route')
    const res = await PATCH(makeRequest(42, { gate_status: 'rejected', note: 'incomplete' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).toBe(200)
    expect((taskFixtures[42] as Record<string, unknown>).gate_status).toBe('rejected')
    // logActivity should have been called and include the note somewhere in its args.
    expect(logActivityMock).toHaveBeenCalled()
    const firstCall = logActivityMock.mock.calls[0]
    const serialized = JSON.stringify(firstCall)
    expect(serialized).toContain('task_gate_changed')
    expect(serialized).toContain('incomplete')
  })

  it('PATCH gate_status="pending" → 400 (Zod enum rejects)', async () => {
    seedTask()
    const { PATCH } = await import('@/app/api/tasks/[id]/gate/route')
    const res = await PATCH(makeRequest(42, { gate_status: 'pending' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).toBe(400)
  })

  it('PATCH on task with gate_required=0 → 400 code:"NO_GATE"', async () => {
    seedTask({ gate_required: 0 })
    const { PATCH } = await import('@/app/api/tasks/[id]/gate/route')
    const res = await PATCH(makeRequest(42, { gate_status: 'approved' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('NO_GATE')
  })

  it('PATCH on missing task → 404 code:"TASK_NOT_FOUND"', async () => {
    // No seeded fixture.
    const { PATCH } = await import('@/app/api/tasks/[id]/gate/route')
    const res = await PATCH(makeRequest(999, { gate_status: 'approved' }), {
      params: Promise.resolve({ id: '999' }),
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('TASK_NOT_FOUND')
  })

  it('on success eventBus.broadcast called with "task.gate.changed" AND "task.updated" (Pitfall 6)', async () => {
    seedTask()
    const { PATCH } = await import('@/app/api/tasks/[id]/gate/route')
    const res = await PATCH(makeRequest(42, { gate_status: 'approved' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).toBe(200)
    const types = broadcastMock.mock.calls.map((c) => c[0])
    expect(types).toContain('task.gate.changed')
    expect(types).toContain('task.updated')
    expect(broadcastMock).toHaveBeenCalledTimes(2)
  })

  it('on success db_helpers.logActivity called with type "task_gate_changed"', async () => {
    seedTask()
    const { PATCH } = await import('@/app/api/tasks/[id]/gate/route')
    const res = await PATCH(makeRequest(42, { gate_status: 'approved' }), {
      params: Promise.resolve({ id: '42' }),
    })
    expect(res.status).toBe(200)
    expect(logActivityMock).toHaveBeenCalled()
    const firstCall = logActivityMock.mock.calls[0]
    expect(firstCall[0]).toBe('task_gate_changed')
  })
})
