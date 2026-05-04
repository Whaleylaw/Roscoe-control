import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { startTaskDiscussion, postTaskDiscussionMessage } from '@/lib/waypoint-task-discussion'

let db: Database.Database
let authRole: 'operator' | 'viewer' = 'operator'

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

function req(path: string) {
  return new NextRequest(`http://localhost${path}`)
}

function seedTask(): number {
  const result = db.prepare(`
    INSERT INTO tasks (title, description, status, priority, project_id, assigned_to, created_by, created_at, updated_at, workspace_id)
    VALUES ('Task A', 'desc', 'todo', 'medium', NULL, 'Aegis', 'operator', unixepoch(), unixepoch(), 1)
  `).run()
  return Number(result.lastInsertRowid)
}

async function loadRoute() {
  return import('@/app/api/tasks/[id]/discussion/route')
}

beforeEach(() => {
  vi.resetModules()
  authRole = 'operator'
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('GET /api/tasks/:id/discussion', () => {
  it('returns auth failure envelope when unauthorized', async () => {
    authRole = 'viewer'
    const taskId = seedTask()

    const { GET } = await loadRoute()
    const res = await GET(req(`/api/tasks/${taskId}/discussion`), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ ok: false, action: 'error', error: 'Forbidden' })
  })

  it('returns 400 for invalid task id with consistent envelope', async () => {
    const { GET } = await loadRoute()
    const res = await GET(req('/api/tasks/not-a-number/discussion'), {
      params: Promise.resolve({ id: 'not-a-number' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, action: 'error', error: 'Invalid task ID' })
  })

  it('returns 404 envelope when discussion task is not found', async () => {
    const { GET } = await loadRoute()
    const res = await GET(req('/api/tasks/999999/discussion'), {
      params: Promise.resolve({ id: '999999' }),
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ ok: false, action: 'error', error: 'Task not found' })
  })

  it('returns 500 envelope when discussion read fails unexpectedly', async () => {
    const taskId = seedTask()
    const discussionModule = await import('@/lib/waypoint-task-discussion')
    const listSpy = vi.spyOn(discussionModule, 'listTaskDiscussion').mockImplementationOnce(() => {
      throw new Error('db offline')
    })

    const { GET } = await loadRoute()
    const res = await GET(req(`/api/tasks/${taskId}/discussion`), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ ok: false, action: 'error', error: 'Failed to fetch discussion' })
    listSpy.mockRestore()
  })

  it('returns discussion transcript with parsed metadata', async () => {
    const taskId = seedTask()
    startTaskDiscussion(db, {
      taskId,
      workspaceId: 1,
      actor: 'operator',
      agent: 'Aegis',
    })
    postTaskDiscussionMessage(db, {
      taskId,
      workspaceId: 1,
      from: 'operator',
      content: 'Update status',
    })

    const { GET } = await loadRoute()
    const res = await GET(req(`/api/tasks/${taskId}/discussion`), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, action: 'list_discussion' })
    expect(body.discussion).toMatchObject({ enabled: true, status: 'active', agent: 'Aegis' })
    expect(body.messages[0]).toMatchObject({ content: 'Update status' })
    expect(body.messages[0].metadata).toMatchObject({ kind: 'waypoint_task_discussion', waypoint: true, task_id: taskId })
  })
})
