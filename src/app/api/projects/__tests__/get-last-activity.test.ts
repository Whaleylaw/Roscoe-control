import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Captured SQL strings passed to db.prepare — one entry per prepare() call.
const capturedSql: string[] = []

// Fixture rows returned by the prepared statement's .all() in the GET path.
// Test 2: a project with a non-null last_activity_at (unix ms).
// Test 3: a project with last_activity_at === null.
const fixtureRows = [
  {
    id: 1,
    workspace_id: 1,
    name: 'Alpha',
    slug: 'alpha',
    description: null,
    ticket_prefix: 'ALPH',
    ticket_counter: 0,
    status: 'active',
    github_repo: null,
    deadline: null,
    color: null,
    github_sync_enabled: 0,
    github_labels_initialized: 0,
    github_default_branch: null,
    created_at: 1_699_000_000,
    updated_at: 1_699_000_000,
    task_count: 3,
    assigned_agents_csv: null,
    last_activity_at: 1_700_000_000_000,
  },
  {
    id: 2,
    workspace_id: 1,
    name: 'Beta',
    slug: 'beta',
    description: null,
    ticket_prefix: 'BETA',
    ticket_counter: 0,
    status: 'active',
    github_repo: null,
    deadline: null,
    color: null,
    github_sync_enabled: 0,
    github_labels_initialized: 0,
    github_default_branch: null,
    created_at: 1_699_000_000,
    updated_at: 1_699_000_000,
    task_count: 0,
    assigned_agents_csv: null,
    last_activity_at: null,
  },
]

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => {
      capturedSql.push(sql)
      return {
        all: () => fixtureRows,
        get: () => undefined,
        run: () => ({ lastInsertRowid: 0, changes: 0 }),
      }
    },
  }),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({
    user: { id: 1, username: 'admin', role: 'admin', workspace_id: 1, tenant_id: 1 },
  })),
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

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

beforeEach(() => {
  capturedSql.length = 0
})

afterEach(() => {
  vi.resetModules()
})

describe('GET /api/projects — last_activity_at', () => {
  it('Test 1: returns 200 with projects[] where each row has a last_activity_at key', async () => {
    const { GET } = await import('@/app/api/projects/route')
    const req = new NextRequest('http://localhost/api/projects')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.projects)).toBe(true)
    expect(body.projects.length).toBe(2)
    for (const p of body.projects) {
      expect(p).toHaveProperty('last_activity_at')
    }
  })

  it('Test 2: project with tasks returns last_activity_at as a number (unix ms)', async () => {
    const { GET } = await import('@/app/api/projects/route')
    const req = new NextRequest('http://localhost/api/projects')
    const res = await GET(req)
    const body = await res.json()
    expect(body.projects[0].last_activity_at).toBe(1_700_000_000_000)
    expect(typeof body.projects[0].last_activity_at).toBe('number')
  })

  it('Test 3: project with no tasks returns last_activity_at: null', async () => {
    const { GET } = await import('@/app/api/projects/route')
    const req = new NextRequest('http://localhost/api/projects')
    const res = await GET(req)
    const body = await res.json()
    expect(body.projects[1].last_activity_at).toBeNull()
  })

  it('Test 4a: SQL contains LEFT JOIN tasks t ON t.project_id = p.id', async () => {
    const { GET } = await import('@/app/api/projects/route')
    const req = new NextRequest('http://localhost/api/projects')
    await GET(req)
    // The first prepare() call is the SELECT for the GET handler.
    const sql = capturedSql[0]
    expect(sql).toBeDefined()
    expect(sql).toMatch(/LEFT JOIN\s+tasks\s+t\s+ON\s+t\.project_id\s*=\s*p\.id/)
  })

  it('Test 4b: SQL contains MAX(t.updated_at)', async () => {
    const { GET } = await import('@/app/api/projects/route')
    const req = new NextRequest('http://localhost/api/projects')
    await GET(req)
    const sql = capturedSql[0]
    expect(sql).toMatch(/MAX\(t\.updated_at\)/)
  })

  it('Test 4c: SQL contains GROUP BY p.id', async () => {
    const { GET } = await import('@/app/api/projects/route')
    const req = new NextRequest('http://localhost/api/projects')
    await GET(req)
    const sql = capturedSql[0]
    expect(sql).toMatch(/GROUP BY\s+p\.id/)
  })
})
