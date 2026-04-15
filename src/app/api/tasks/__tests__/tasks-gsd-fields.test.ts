import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Covers: GSD-04, GSD-13.
// GET /api/tasks, GET /api/tasks/:id, and GET /api/projects/:id/tasks
// include gsd_phase + gate_* fields so the task board + task card can
// render phase and gate badges without extra round-trips.
//
// Audit (Wave 2d): all three handlers use `SELECT t.*` — new columns
// from migration 052 flow through automatically. These tests lock that
// behavior so future refactors to explicit column lists won't silently
// drop GSD fields.

// --- shared fixtures ---------------------------------------------------------
const gsdTaskRow = {
  id: 101,
  workspace_id: 1,
  project_id: 5,
  title: 'Gate task',
  description: '',
  status: 'todo',
  priority: 'medium',
  assigned_to: null,
  tags: '[]',
  metadata: '{}',
  created_at: 1000,
  updated_at: 2000,
  project_name: 'Alpha',
  project_prefix: 'ALPH',
  project_ticket_no: 1,
  // Migration 052 columns:
  gsd_phase: 'plan',
  gate_required: 1,
  gate_status: 'pending',
  gate_approved_by: null,
  gate_approved_at: null,
  depends_on_task_ids: null,
}

const nonGsdTaskRow = {
  id: 102,
  workspace_id: 1,
  project_id: 5,
  title: 'Regular task',
  description: '',
  status: 'todo',
  priority: 'low',
  assigned_to: null,
  tags: '[]',
  metadata: '{}',
  created_at: 1100,
  updated_at: 2100,
  project_name: 'Alpha',
  project_prefix: 'ALPH',
  project_ticket_no: 2,
  gsd_phase: null,
  gate_required: 0,
  gate_status: 'not_required',
  gate_approved_by: null,
  gate_approved_at: null,
  depends_on_task_ids: null,
}

// --- shared mocks ------------------------------------------------------------
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({
    user: { id: 1, username: 'admin', role: 'admin', workspace_id: 1, tenant_id: 1 },
  })),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('@/lib/workspaces', () => ({
  ensureTenantWorkspaceAccess: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {
    status = 403
  },
}))

const prepareMock = vi.fn()
vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => prepareMock(sql),
  }),
  db_helpers: {
    logActivity: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/tasks — gsd fields (GSD-04, GSD-13)', () => {
  it('GET /api/tasks returns gsd_phase + gate_* fields on each task', async () => {
    prepareMock.mockImplementation((sql: string) => {
      // Order matters: the main SELECT also contains `SELECT COUNT(*)` as a
      // correlated subquery for comment_count, so test for the FROM tasks t
      // list query first before the pure COUNT pagination query.
      if (/^\s*SELECT\s+COUNT\(\*\)\s+as\s+total/i.test(sql)) {
        return { get: () => ({ total: 2 }) }
      }
      if (sql.includes('FROM tasks t')) {
        return { all: () => [gsdTaskRow, nonGsdTaskRow] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { GET } = await import('@/app/api/tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/tasks'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.tasks)).toBe(true)
    expect(body.tasks.length).toBe(2)
    for (const t of body.tasks) {
      expect(t).toHaveProperty('gsd_phase')
      expect(t).toHaveProperty('gate_required')
      expect(t).toHaveProperty('gate_status')
      expect(t).toHaveProperty('gate_approved_by')
      expect(t).toHaveProperty('gate_approved_at')
    }
    // GSD task: meaningful values
    const gsd = body.tasks.find((t: { id: number }) => t.id === 101)
    expect(gsd.gsd_phase).toBe('plan')
    expect(gsd.gate_required).toBe(1)
    expect(gsd.gate_status).toBe('pending')
    // Non-GSD task: expected defaults
    const plain = body.tasks.find((t: { id: number }) => t.id === 102)
    expect(plain.gsd_phase).toBeNull()
    expect(plain.gate_required).toBe(0)
    expect(plain.gate_status).toBe('not_required')
  })

  it('GET /api/tasks SELECT is t.* (so migration 052 columns flow through)', async () => {
    const capturedSql: string[] = []
    prepareMock.mockImplementation((sql: string) => {
      capturedSql.push(sql)
      if (/^\s*SELECT\s+COUNT\(\*\)\s+as\s+total/i.test(sql)) {
        return { get: () => ({ total: 0 }) }
      }
      return { all: () => [] }
    })

    const { GET } = await import('@/app/api/tasks/route')
    await GET(new NextRequest('http://localhost/api/tasks'))
    const selectSql = capturedSql.find((s) => /FROM\s+tasks\s+t/i.test(s))
    expect(selectSql).toBeDefined()
    // Must project the tasks row wholesale — do NOT allow a future refactor
    // to switch to an explicit column list that forgets the GSD columns.
    expect(selectSql!).toMatch(/SELECT\s+t\.\*/)
  })
})

describe('GET /api/tasks/:id — gsd fields (GSD-04, GSD-13)', () => {
  it('returns gsd_phase + gate_* fields on the task', async () => {
    prepareMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM tasks t')) {
        return { get: () => gsdTaskRow }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { GET } = await import('@/app/api/tasks/[id]/route')
    const res = await GET(
      new NextRequest('http://localhost/api/tasks/101'),
      { params: Promise.resolve({ id: '101' }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task).toHaveProperty('gsd_phase', 'plan')
    expect(body.task).toHaveProperty('gate_required', 1)
    expect(body.task).toHaveProperty('gate_status', 'pending')
    expect(body.task).toHaveProperty('gate_approved_by', null)
    expect(body.task).toHaveProperty('gate_approved_at', null)
  })

  it('GET /api/tasks/:id SELECT is t.* (so migration 052 columns flow through)', async () => {
    const capturedSql: string[] = []
    prepareMock.mockImplementation((sql: string) => {
      capturedSql.push(sql)
      return { get: () => gsdTaskRow }
    })

    const { GET } = await import('@/app/api/tasks/[id]/route')
    await GET(
      new NextRequest('http://localhost/api/tasks/101'),
      { params: Promise.resolve({ id: '101' }) }
    )
    const selectSql = capturedSql.find((s) => /FROM\s+tasks\s+t/i.test(s))
    expect(selectSql).toBeDefined()
    expect(selectSql!).toMatch(/SELECT\s+t\.\*/)
  })
})

describe('GET /api/projects/:id/tasks — gsd fields (GSD-04, GSD-13)', () => {
  it('returns gsd_phase + gate_* fields on each project-scoped task', async () => {
    prepareMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM projects p') && sql.includes('JOIN workspaces w')) {
        return { get: () => ({ id: 5 }) }
      }
      if (sql.includes('FROM projects') && sql.includes('ticket_prefix')) {
        return { get: () => ({ id: 5, name: 'Alpha', slug: 'alpha' }) }
      }
      if (sql.includes('FROM tasks t')) {
        return { all: () => [gsdTaskRow, nonGsdTaskRow] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { GET } = await import('@/app/api/projects/[id]/tasks/route')
    const res = await GET(
      new NextRequest('http://localhost/api/projects/5/tasks'),
      { params: Promise.resolve({ id: '5' }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.tasks)).toBe(true)
    expect(body.tasks.length).toBe(2)
    for (const t of body.tasks) {
      expect(t).toHaveProperty('gsd_phase')
      expect(t).toHaveProperty('gate_required')
      expect(t).toHaveProperty('gate_status')
      expect(t).toHaveProperty('gate_approved_by')
      expect(t).toHaveProperty('gate_approved_at')
    }
  })

  it('GET /api/projects/:id/tasks SELECT is t.* (so migration 052 columns flow through)', async () => {
    const capturedSql: string[] = []
    prepareMock.mockImplementation((sql: string) => {
      capturedSql.push(sql)
      if (sql.includes('FROM projects p') && sql.includes('JOIN workspaces w')) {
        return { get: () => ({ id: 5 }) }
      }
      if (sql.includes('FROM projects') && sql.includes('ticket_prefix')) {
        return { get: () => ({ id: 5 }) }
      }
      return { all: () => [] }
    })

    const { GET } = await import('@/app/api/projects/[id]/tasks/route')
    await GET(
      new NextRequest('http://localhost/api/projects/5/tasks'),
      { params: Promise.resolve({ id: '5' }) }
    )
    const selectSql = capturedSql.find((s) => /FROM\s+tasks\s+t/i.test(s))
    expect(selectSql).toBeDefined()
    expect(selectSql!).toMatch(/SELECT\s+t\.\*/)
  })
})
