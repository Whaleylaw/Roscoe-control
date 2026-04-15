import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Covers: GSD-08, GSD-09, GSD-10, GSD-12, GSD-28.
// POST /api/projects/:id/gsd/transition enforces legal phase progression
// (discuss → plan → execute → verify → done) with structured 409 codes,
// Zod 400 for body shape, waiver semantics on execute → verify (D-26, D-29),
// Pitfall 4 dual-timestamp update, and eventBus broadcast (GSD-28).

// --- per-test mutable fixtures ----------------------------------------------

let currentProject:
  | {
      id: number
      workspace_id: number
      gsd_phase: string
      gsd_enabled: number
    }
  | null = null
// Count of tasks returned by the rule SELECT COUNT(*) queries.
// Test flips this between 0 and ≥1 per scenario.
let ruleCountResult = 0
const capturedSql: string[] = []
const capturedUpdates: Array<{ sql: string; args: any[] }> = []

// --- module mocks -----------------------------------------------------------

vi.mock('@/lib/db', () => {
  const prepare = (sql: string) => {
    capturedSql.push(sql)
    const isProjectSelect = /FROM\s+projects\s+WHERE\s+id\s*=\s*\?/i.test(sql)
    const isTaskCount = /FROM\s+tasks/i.test(sql) && /COUNT\(\*\)/i.test(sql)
    const isUpdateProject = /^\s*UPDATE\s+projects/i.test(sql)
    return {
      get: (...args: any[]) => {
        if (isProjectSelect) return currentProject
        if (isTaskCount) return { n: ruleCountResult }
        return undefined
      },
      all: () => [],
      run: (...args: any[]) => {
        if (isUpdateProject) capturedUpdates.push({ sql, args })
        // Also advance the in-memory project so the post-update SELECT returns
        // the new phase.
        if (isUpdateProject && currentProject) {
          currentProject = { ...currentProject, gsd_phase: args[0] }
        }
        return { changes: 1, lastInsertRowid: 0 }
      },
    }
  }
  const logActivity = vi.fn()
  return {
    getDatabase: () => ({ prepare }),
    db_helpers: { logActivity },
  }
})

// Store a stable reference to the broadcast mock so each test can assert it.
const broadcastMock = vi.fn()
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: broadcastMock },
}))

let authRole: 'admin' | 'operator' | 'viewer' = 'operator'
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn((_req: any, required: string) => {
    const ranks: Record<string, number> = { viewer: 1, operator: 2, admin: 3 }
    if (ranks[authRole] < ranks[required]) {
      return { error: 'Forbidden', status: 403 }
    }
    return {
      user: {
        id: 42,
        username: 'tester',
        role: authRole,
        workspace_id: 1,
        tenant_id: 1,
      },
    }
  }),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/workspaces', () => ({
  ensureTenantWorkspaceAccess: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {
    status = 403
    constructor(msg: string) {
      super(msg)
      this.name = 'ForbiddenError'
    }
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

// --- helpers ----------------------------------------------------------------

function buildReq(body: any) {
  return new NextRequest('http://localhost/api/projects/1/gsd/transition', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function loadHandler() {
  const mod = await import('@/app/api/projects/[id]/gsd/transition/route')
  return mod.POST
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  capturedSql.length = 0
  capturedUpdates.length = 0
  broadcastMock.mockReset()
  ruleCountResult = 0
  authRole = 'operator'
  currentProject = {
    id: 1,
    workspace_id: 1,
    gsd_phase: 'discuss',
    gsd_enabled: 1,
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

// --- tests ------------------------------------------------------------------

describe('POST /api/projects/:id/gsd/transition (GSD-08/09/10/12/28)', () => {
  it('Test 1: viewer role gets 403 (D-10 / GSD-12)', async () => {
    authRole = 'viewer'
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'plan' }), makeParams('1'))
    expect(res.status).toBe(403)
  })

  it('Test 2: invalid to_phase → 400 (Zod enum reject)', async () => {
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'bogus' }), makeParams('1'))
    expect(res.status).toBe(400)
  })

  it('Test 3: waive_remaining:true without reason → 400 (Zod refine path:["reason"])', async () => {
    const POST = await loadHandler()
    const res = await POST(
      buildReq({ to_phase: 'verify', waive_remaining: true }),
      makeParams('1'),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(JSON.stringify(body)).toMatch(/reason/i)
  })

  it('Test 4: discuss → execute (skip plan) → 409 ILLEGAL_TRANSITION (D-28)', async () => {
    currentProject!.gsd_phase = 'discuss'
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'execute' }), makeParams('1'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('ILLEGAL_TRANSITION')
    expect(body.from_phase).toBe('discuss')
    expect(body.to_phase).toBe('execute')
  })

  it('Test 5: discuss → plan with 0 done discuss tasks → 409 DISCUSS_REQUIRES_ONE_DONE (D-24)', async () => {
    currentProject!.gsd_phase = 'discuss'
    ruleCountResult = 0
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'plan' }), makeParams('1'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('DISCUSS_REQUIRES_ONE_DONE')
  })

  it('Test 6: discuss → plan with ≥1 done discuss task → 200 and phase advances', async () => {
    currentProject!.gsd_phase = 'discuss'
    ruleCountResult = 1
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'plan' }), makeParams('1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.to_phase).toBe('plan')
    expect(body.from_phase).toBe('discuss')
  })

  it('Test 7: plan → execute with 0 approved+done plan tasks → 409 PLAN_REQUIRES_APPROVED_PACKAGE (D-25)', async () => {
    currentProject!.gsd_phase = 'plan'
    ruleCountResult = 0
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'execute' }), makeParams('1'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('PLAN_REQUIRES_APPROVED_PACKAGE')
  })

  it('Test 8: plan → execute with ≥1 approved+done plan task → 200', async () => {
    currentProject!.gsd_phase = 'plan'
    ruleCountResult = 1
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'execute' }), makeParams('1'))
    expect(res.status).toBe(200)
  })

  it('Test 9: execute → verify with open exec tasks and no waiver → 409 EXECUTE_TASKS_INCOMPLETE (D-26)', async () => {
    currentProject!.gsd_phase = 'execute'
    ruleCountResult = 3 // 3 open execute tasks
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'verify' }), makeParams('1'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('EXECUTE_TASKS_INCOMPLETE')
    expect(body.open_count).toBe(3)
  })

  it('Test 10: execute → verify with waive_remaining:true + reason → 200 (D-29)', async () => {
    currentProject!.gsd_phase = 'execute'
    ruleCountResult = 3 // still open, but waiver provided
    const POST = await loadHandler()
    const res = await POST(
      buildReq({ to_phase: 'verify', waive_remaining: true, reason: 'partial ship' }),
      makeParams('1'),
    )
    expect(res.status).toBe(200)
  })

  it('Test 11: verify → done with 0 done verify tasks → 409 VERIFY_REQUIRES_ONE_DONE (D-27)', async () => {
    currentProject!.gsd_phase = 'verify'
    ruleCountResult = 0
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'done' }), makeParams('1'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('VERIFY_REQUIRES_ONE_DONE')
  })

  it('Test 12: verify → done with ≥1 done verify task → 200', async () => {
    currentProject!.gsd_phase = 'verify'
    ruleCountResult = 1
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'done' }), makeParams('1'))
    expect(res.status).toBe(200)
  })

  it('Test 13: successful transition updates gsd_phase, gsd_updated_at AND updated_at (Pitfall 4)', async () => {
    currentProject!.gsd_phase = 'discuss'
    ruleCountResult = 1
    const POST = await loadHandler()
    await POST(buildReq({ to_phase: 'plan' }), makeParams('1'))
    expect(capturedUpdates.length).toBeGreaterThanOrEqual(1)
    const upd = capturedUpdates.find((u) => /UPDATE\s+projects/i.test(u.sql))
    expect(upd).toBeDefined()
    expect(upd!.sql).toMatch(/gsd_phase\s*=\s*\?/)
    expect(upd!.sql).toMatch(/gsd_updated_at\s*=\s*unixepoch\(\)/)
    expect(upd!.sql).toMatch(/updated_at\s*=\s*unixepoch\(\)/)
  })

  it('Test 14: successful transition broadcasts project.gsd.transition with expected payload (GSD-28)', async () => {
    currentProject!.gsd_phase = 'discuss'
    ruleCountResult = 1
    const POST = await loadHandler()
    await POST(buildReq({ to_phase: 'plan', reason: 'ready' }), makeParams('1'))
    expect(broadcastMock).toHaveBeenCalled()
    const call = broadcastMock.mock.calls.find((c) => c[0] === 'project.gsd.transition')
    expect(call).toBeDefined()
    const [, payload] = call!
    expect(payload.project_id).toBe(1)
    expect(payload.from_phase).toBe('discuss')
    expect(payload.to_phase).toBe('plan')
    expect(payload.actor).toBe('tester')
    expect(payload.reason).toBe('ready')
    expect(payload.waived).toBe(false)
    expect(payload.workspace_id).toBe(1)
  })

  it('Test 15: successful transition logs activity type "project_gsd_transition"', async () => {
    currentProject!.gsd_phase = 'discuss'
    ruleCountResult = 1
    const { db_helpers } = await import('@/lib/db')
    const POST = await loadHandler()
    await POST(buildReq({ to_phase: 'plan' }), makeParams('1'))
    expect(db_helpers.logActivity).toHaveBeenCalled()
    const firstCall = (db_helpers.logActivity as any).mock.calls[0]
    expect(firstCall[0]).toBe('project_gsd_transition')
    expect(firstCall[1]).toBe('project')
    expect(firstCall[2]).toBe(1)
  })

  it('Test 16: missing project → 404 PROJECT_NOT_FOUND', async () => {
    currentProject = null
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'plan' }), makeParams('1'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('PROJECT_NOT_FOUND')
  })

  it('Test 17: invalid project id (non-numeric) → 400', async () => {
    const POST = await loadHandler()
    const res = await POST(buildReq({ to_phase: 'plan' }), makeParams('not-a-number'))
    expect(res.status).toBe(400)
  })

  it('Test 18: waived broadcast carries waived:true and the reason', async () => {
    currentProject!.gsd_phase = 'execute'
    ruleCountResult = 2 // open tasks
    const POST = await loadHandler()
    const res = await POST(
      buildReq({ to_phase: 'verify', waive_remaining: true, reason: 'shipping anyway' }),
      makeParams('1'),
    )
    expect(res.status).toBe(200)
    const call = broadcastMock.mock.calls.find((c) => c[0] === 'project.gsd.transition')
    expect(call).toBeDefined()
    expect(call![1].waived).toBe(true)
    expect(call![1].reason).toBe('shipping anyway')
  })
})
