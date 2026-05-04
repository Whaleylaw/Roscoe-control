import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { startTaskDiscussion } from '@/lib/waypoint-task-discussion'

let db: Database.Database

const broadcast = vi.fn()
const mutationLimiterMock = vi.fn<() => NextResponse | null>(() => null)

vi.mock('@/lib/db', () => ({
  getDatabase: () => db,
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({
    user: { id: 1, username: 'operator', display_name: 'Operator', role: 'operator', workspace_id: 1, tenant_id: 1 },
  })),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: mutationLimiterMock,
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast,
  },
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
    body: '{"content":',
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
  return import('@/app/api/tasks/[id]/discussion/messages/route')
}

beforeEach(() => {
  vi.resetModules()
  mutationLimiterMock.mockReset()
  mutationLimiterMock.mockReturnValue(null)
  db = new Database(':memory:')
  runMigrations(db)
  broadcast.mockReset()
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('POST /api/tasks/:id/discussion/messages', () => {
  it('returns 400 for non-positive task ids', async () => {
    const { POST } = await loadRoute()

    const zero = await POST(req('/api/tasks/0/discussion/messages', { content: 'hello' }), {
      params: Promise.resolve({ id: '0' }),
    })
    const negative = await POST(req('/api/tasks/-7/discussion/messages', { content: 'hello' }), {
      params: Promise.resolve({ id: '-7' }),
    })

    expect(zero.status).toBe(400)
    await expect(zero.json()).resolves.toEqual({ ok: false, action: 'error', error: 'Invalid task ID' })
    expect(negative.status).toBe(400)
    await expect(negative.json()).resolves.toEqual({ ok: false, action: 'error', error: 'Invalid task ID' })
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed JSON body with standard error envelope', async () => {
    const taskId = seedTask()
    const { POST } = await loadRoute()

    const res = await POST(reqMalformed(`/api/tasks/${taskId}/discussion/messages`), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, action: 'error', error: 'Invalid JSON body' })
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('returns normalized validation details for invalid request body', async () => {
    const taskId = seedTask()
    const { POST } = await loadRoute()

    const res = await POST(req(`/api/tasks/${taskId}/discussion/messages`, { content: 42 }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, action: 'error', error: 'Invalid request body' })
    expect(body.details?.[0]).toMatchObject({
      code: expect.any(String),
      path: 'content',
      message: expect.any(String),
    })
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('rejects unknown request-body keys with normalized validation details', async () => {
    const taskId = seedTask()
    const { POST } = await loadRoute()

    const res = await POST(req(`/api/tasks/${taskId}/discussion/messages`, { content: 'Ship it', junk: true }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, action: 'error', error: 'Invalid request body' })
    expect(body.details?.[0]).toMatchObject({
      code: expect.any(String),
      path: '$',
      message: expect.any(String),
    })
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('returns 409 when waypoint discussion is not enabled for the task', async () => {
    const taskId = seedTask()
    const { POST } = await loadRoute()

    const res = await POST(req(`/api/tasks/${taskId}/discussion/messages`, { content: 'hello' }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Waypoint discussion is not enabled for this task',
    })
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('normalizes rate-limit responses into waypoint error envelope', async () => {
    const taskId = seedTask()
    mutationLimiterMock.mockReturnValueOnce(NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 }))
    const { POST } = await loadRoute()

    const res = await POST(req(`/api/tasks/${taskId}/discussion/messages`, { content: 'hello' }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      action: 'error',
      error: 'Too many requests. Please try again later.',
    })
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('posts a discussion message and emits chat.message event', async () => {
    const taskId = seedTask()
    startTaskDiscussion(db, {
      taskId,
      workspaceId: 1,
      actor: 'operator',
      agent: 'Aegis',
    })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/tasks/${taskId}/discussion/messages`, { content: 'Ship it', to: 'Aegis' }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.discussion).toMatchObject({ enabled: true, status: 'active', agent: 'Aegis' })
    expect(body.auto_response).toEqual({ requested: false, agent: 'Aegis' })
    expect(body.message.content).toBe('Ship it')
    expect(body.message.metadata).toMatchObject({ kind: 'waypoint_task_discussion', waypoint: true, task_id: taskId })
    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith('chat.message', expect.objectContaining({ id: body.message.id, content: 'Ship it' }))
  })

  it('does not request auto-response when globally disabled even if task metadata enables it', async () => {
    vi.stubEnv('WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED', '0')
    const taskId = seedTask()
    const started = startTaskDiscussion(db, {
      taskId,
      workspaceId: 1,
      actor: 'operator',
      agent: 'Aegis',
    })

    const metadata = JSON.parse(started.task.metadata || '{}')
    metadata.waypoint = metadata.waypoint || {}
    metadata.waypoint.discussion = {
      ...(metadata.waypoint.discussion || {}),
      auto_response: {
        enabled: true,
      },
    }
    db.prepare('UPDATE tasks SET metadata = ?, updated_at = unixepoch() WHERE id = ?').run(JSON.stringify(metadata), taskId)

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/tasks/${taskId}/discussion/messages`, { content: 'Please draft acceptance criteria' }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.auto_response).toEqual({ requested: false, agent: 'Aegis', reason: 'global_disabled' })
    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith('chat.message', expect.objectContaining({ id: body.message.id }))
  })

  it('requests auto-response only when explicitly enabled in discussion metadata and globally allowed', async () => {
    vi.stubEnv('WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED', '1')
    const taskId = seedTask()
    const started = startTaskDiscussion(db, {
      taskId,
      workspaceId: 1,
      actor: 'operator',
      agent: 'Aegis',
    })

    const metadata = JSON.parse(started.task.metadata || '{}')
    metadata.waypoint = metadata.waypoint || {}
    metadata.waypoint.discussion = {
      ...(metadata.waypoint.discussion || {}),
      auto_response: {
        enabled: true,
      },
    }
    db.prepare('UPDATE tasks SET metadata = ?, updated_at = unixepoch() WHERE id = ?').run(JSON.stringify(metadata), taskId)

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/tasks/${taskId}/discussion/messages`, { content: 'Please draft acceptance criteria' }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.auto_response).toEqual({ requested: true, agent: 'Aegis' })
    expect(broadcast).toHaveBeenCalledWith('chat.message', expect.objectContaining({ id: body.message.id }))
    expect(broadcast).toHaveBeenCalledWith(
      'waypoint.discussion.auto_response.requested',
      expect.objectContaining({
        task_id: taskId,
        conversation_id: started.discussion.conversation_id,
        agent: 'Aegis',
        message_id: body.message.id,
        content: 'Please draft acceptance criteria',
      }),
    )
  })

  it('does not fail message persistence when auto-response dispatch broadcast throws', async () => {
    const taskId = seedTask()
    const started = startTaskDiscussion(db, {
      taskId,
      workspaceId: 1,
      actor: 'operator',
      agent: 'Aegis',
    })

    const metadata = JSON.parse(started.task.metadata || '{}')
    metadata.waypoint = metadata.waypoint || {}
    metadata.waypoint.discussion = {
      ...(metadata.waypoint.discussion || {}),
      auto_response: { enabled: true },
    }
    db.prepare('UPDATE tasks SET metadata = ?, updated_at = unixepoch() WHERE id = ?').run(JSON.stringify(metadata), taskId)

    broadcast.mockImplementation((eventName: string) => {
      if (eventName === 'waypoint.discussion.auto_response.requested') {
        throw new Error('dispatch unavailable')
      }
      return undefined
    })

    const { POST } = await loadRoute()
    const res = await POST(req(`/api/tasks/${taskId}/discussion/messages`, { content: 'Keep message even if dispatch fails' }), {
      params: Promise.resolve({ id: String(taskId) }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      action: 'post_discussion_message',
      auto_response: { requested: true, agent: 'Aegis' },
    })

    const persisted = db
      .prepare('SELECT content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1')
      .get(started.discussion.conversation_id) as { content: string } | undefined
    expect(persisted?.content).toBe('Keep message even if dispatch fails')
  })
})
