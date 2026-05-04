import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { runMigrations } from '@/lib/migrations'

let db: Database.Database
let authRole: 'operator' | 'viewer' = 'operator'
const mutationLimiterMock = vi.fn<() => NextResponse | null>(() => null)

vi.mock('@/lib/db', () => ({
  getDatabase: () => db,
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn((_req: unknown, required: 'viewer' | 'operator' | 'admin') => {
    const order = { viewer: 0, operator: 1, admin: 2 }
    if (order[authRole] < order[required]) {
      return { error: 'Forbidden', status: 403 }
    }
    return {
      user: { id: 1, username: 'operator', display_name: 'Operator', role: authRole, workspace_id: 1, tenant_id: 1 },
    }
  }),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: mutationLimiterMock,
}))

function req(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function reqMalformed(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"agent":',
  })
}

function seedTask(): number {
  const result = db.prepare(`
    INSERT INTO tasks (title, description, status, priority, project_id, assigned_to, created_by, created_at, updated_at, workspace_id)
    VALUES ('Task A', 'desc', 'todo', 'medium', NULL, 'Aegis', 'operator', unixepoch(), unixepoch(), 1)
  `).run()
  return Number(result.lastInsertRowid)
}

async function loadRoute() {
  return import('@/app/api/tasks/[id]/discussion/start/route')
}

beforeEach(() => {
  vi.resetModules()
  authRole = 'operator'
  mutationLimiterMock.mockReset()
  mutationLimiterMock.mockReturnValue(null)
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('POST /api/tasks/:id/discussion/start', () => {
  it('returns auth failure envelope when unauthorized', async () => {
    authRole = 'viewer'
    const taskId = seedTask()

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/tasks/${taskId}/discussion/start`, { agent: 'Aegis' }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ ok: false, action: 'error', error: 'Forbidden' })
  })

  it('returns 400 for invalid task id with consistent envelope', async () => {
    const { POST } = await loadRoute()
    const res = await POST(req('/api/tasks/not-a-number/discussion/start', { agent: 'Aegis' }), {
      params: Promise.resolve({ id: 'not-a-number' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, action: 'error', error: 'Invalid task ID' })
  })

  it('returns 400 for malformed JSON body with standard error envelope', async () => {
    const taskId = seedTask()

    const { POST } = await loadRoute()
    const res = await POST(reqMalformed(`/api/tasks/${taskId}/discussion/start`), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, action: 'error', error: 'Invalid JSON body' })
  })

  it('normalizes rate-limit responses into the waypoint error envelope', async () => {
    const taskId = seedTask()
    mutationLimiterMock.mockReturnValueOnce(NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 }))

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/tasks/${taskId}/discussion/start`, { agent: 'Aegis' }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Too many requests. Please try again later.',
    })
  })

  it('returns normalized validation details for invalid request body', async () => {
    const taskId = seedTask()

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/tasks/${taskId}/discussion/start`, { agent: 123 }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, action: 'error', error: 'Invalid request body' })
    expect(body.details?.[0]).toMatchObject({
      code: expect.any(String),
      path: expect.any(String),
      message: expect.any(String),
    })
  })

  it('starts task discussion and returns standard success envelope', async () => {
    const taskId = seedTask()

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/tasks/${taskId}/discussion/start`, { agent: 'Aegis' }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      action: 'start_discussion',
      discussion: {
        enabled: true,
        status: 'active',
        agent: 'Aegis',
      },
    })
  })
})
