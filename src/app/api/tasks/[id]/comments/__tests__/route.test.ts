import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'

const gatewayCall = vi.hoisted(() => vi.fn())
const logActivity = vi.hoisted(() => vi.fn())
const ensureTaskSubscription = vi.hoisted(() => vi.fn())
const createNotification = vi.hoisted(() => vi.fn())
const eventBroadcast = vi.hoisted(() => vi.fn())

let db: Database.Database

vi.mock('@/lib/db', () => ({
  getDatabase: () => db,
  db_helpers: {
    logActivity,
    ensureTaskSubscription,
    createNotification,
    getTaskSubscribers: vi.fn(() => []),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({
    user: {
      id: 1,
      username: 'operator',
      display_name: 'Operator',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
    },
  })),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/openclaw-gateway', () => ({
  callOpenClawGateway: gatewayCall,
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast: eventBroadcast,
  },
}))

vi.mock('@/lib/config', () => ({
  config: {
    hermesApiUrl: 'http://hermes-default.local',
  },
}))

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/tasks/1/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function postComment(taskId = 1, body: Record<string, unknown> = { content: 'Owner reply' }) {
  const { POST } = await import('@/app/api/tasks/[id]/comments/route')
  return POST(req(body), { params: Promise.resolve({ id: String(taskId) }) })
}

function seedTask(overrides: {
  id?: number
  assigned_to?: string | null
  metadata?: Record<string, unknown> | string | null
  title?: string
  project_id?: number | null
} = {}) {
  const metadata = typeof overrides.metadata === 'string'
    ? overrides.metadata
    : JSON.stringify(overrides.metadata ?? {})

  db.prepare(
    `INSERT INTO tasks (id, title, status, priority, assigned_to, metadata, workspace_id, project_id, created_at, updated_at)
     VALUES (?, ?, 'in_progress', 'medium', ?, ?, 1, ?, 1000, 1000)`,
  ).run(
    overrides.id ?? 1,
    overrides.title ?? 'Relay target task',
    overrides.assigned_to ?? null,
    metadata,
    Object.prototype.hasOwnProperty.call(overrides, 'project_id') ? overrides.project_id : 42,
  )
}

function seedAgent(overrides: {
  name?: string
  session_key?: string | null
  runtime_type?: string | null
  config?: Record<string, unknown> | string | null
} = {}) {
  const config = typeof overrides.config === 'string'
    ? overrides.config
    : JSON.stringify(overrides.config ?? {})

  db.prepare(
    `INSERT INTO agents (name, role, status, session_key, runtime_type, config, workspace_id, created_at, updated_at)
     VALUES (?, 'worker', 'idle', ?, ?, ?, 1, 1000, 1000)`,
  ).run(overrides.name ?? 'relay-agent', overrides.session_key ?? null, overrides.runtime_type ?? null, config)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  db.prepare(`
    INSERT OR IGNORE INTO projects (id, workspace_id, name, slug, description, ticket_prefix, status, created_at, updated_at)
    VALUES (42, 1, 'Test Project', 'test-project', 'Test project', 'TEST', 'active', 1000, 1000)
  `).run()
  gatewayCall.mockResolvedValue({ status: 'ok' })
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  db.close()
})

describe('POST /api/tasks/:id/comments relay behavior', () => {
  it('relays to the dispatch session from task metadata first', async () => {
    seedTask({
      assigned_to: 'relay-agent',
      metadata: { dispatch_session_id: 'dispatch-session-1' },
    })
    seedAgent({ name: 'relay-agent', session_key: 'agent-session-1' })

    const res = await postComment()
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.comment.content).toBe('Owner reply')
    expect(body.relay).toMatchObject({
      attempted: true,
      relayed: true,
      channel: 'dispatch_session',
      session_id: 'dispatch-session-1',
    })
    expect(gatewayCall).toHaveBeenCalledTimes(1)
    expect(gatewayCall).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        sessionKey: 'dispatch-session-1',
        message: expect.stringContaining('Owner reply'),
        deliver: false,
      }),
      45_000,
    )
    expect(logActivity).toHaveBeenCalledWith(
      'task_comment_relayed',
      'comment',
      body.comment.id,
      'Operator',
      expect.stringContaining('relay-agent'),
      expect.objectContaining({ relay_channel: 'dispatch_session' }),
      1,
    )
    expect(body.session_log).toMatchObject({
      recorded: true,
      conversation_id: 'project:42:agent:relay-agent',
    })

    const sessionMessage = db.prepare(`
      SELECT conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id
      FROM messages
      WHERE id = ?
    `).get(body.session_log.message_id) as any

    expect(sessionMessage).toMatchObject({
      conversation_id: 'project:42:agent:relay-agent',
      from_agent: 'Operator',
      to_agent: 'relay-agent',
      message_type: 'text',
      workspace_id: 1,
    })
    expect(sessionMessage.content).toContain('Task ID: 1')
    expect(sessionMessage.content).toContain('Owner reply')
    expect(JSON.parse(sessionMessage.metadata)).toMatchObject({
      kind: 'task_comment',
      task_id: 1,
      task_title: 'Relay target task',
      author: 'Operator',
      project_id: 42,
    })
    expect(eventBroadcast).toHaveBeenCalledWith(
      'chat.message',
      expect.objectContaining({
        conversation_id: 'project:42:agent:relay-agent',
        from_agent: 'Operator',
      }),
    )
  })

  it('falls back to the agent session when the dispatch session relay fails', async () => {
    seedTask({
      assigned_to: 'relay-agent',
      metadata: { dispatch_session_id: 'dispatch-session-1' },
    })
    seedAgent({ name: 'relay-agent', session_key: 'agent-session-1' })
    gatewayCall
      .mockRejectedValueOnce(new Error('dispatch unavailable'))
      .mockResolvedValueOnce({ status: 'started' })

    const res = await postComment()
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.relay).toMatchObject({
      attempted: true,
      relayed: true,
      channel: 'agent_session',
      session_id: 'agent-session-1',
    })
    expect(gatewayCall).toHaveBeenCalledTimes(2)
    expect(gatewayCall.mock.calls[1][1]).toEqual(expect.objectContaining({
      sessionKey: 'agent-session-1',
      deliver: false,
    }))
  })

  it('starts an async Hermes run and records the completed reply as a task comment', async () => {
    seedTask({ assigned_to: 'relay-agent' })
    seedAgent({
      name: 'relay-agent',
      runtime_type: 'hermes',
      config: {
        hermesApiUrl: 'http://hermes-agent.local',
        hermesApiKey: 'secret-key',
        dispatchModel: 'openai/gpt-5.3-codex',
      },
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: 'run-hermes-1', status: 'started' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(
        'data: {"event":"run.completed","run_id":"run-hermes-1","output":"Hermes saw the comment."}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const res = await postComment()
    const body = await res.json()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(res.status).toBe(201)
    expect(body.relay).toMatchObject({
      attempted: true,
      relayed: true,
      channel: 'hermes_run',
      run_id: 'run-hermes-1',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://hermes-agent.local/v1/runs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-key',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('Owner reply'),
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://hermes-agent.local/v1/runs/run-hermes-1/events',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-key',
        }),
      }),
    )

    const replyComment = db.prepare(`
      SELECT author, content, parent_id
      FROM comments
      WHERE task_id = 1 AND author = 'relay-agent'
    `).get() as any
    expect(replyComment).toEqual({
      author: 'relay-agent',
      content: 'Hermes saw the comment.',
      parent_id: body.comment.id,
    })

    const replyMessage = db.prepare(`
      SELECT conversation_id, from_agent, to_agent, content
      FROM messages
      WHERE from_agent = 'relay-agent'
    `).get() as any
    expect(replyMessage).toEqual({
      conversation_id: 'project:42:agent:relay-agent',
      from_agent: 'relay-agent',
      to_agent: 'Operator',
      content: 'Hermes saw the comment.',
    })
  })

  it('skips relay when the comment author is the task assignee', async () => {
    seedTask({ assigned_to: 'Operator' })
    seedAgent({ name: 'Operator', session_key: 'agent-session-1' })

    const res = await postComment()
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.relay).toEqual({
      attempted: false,
      relayed: false,
      reason: 'author_is_assignee',
    })
    expect(gatewayCall).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('records assignee-authored comments in the project session without looping relay back to the assignee', async () => {
    seedTask({ assigned_to: 'Operator' })
    seedAgent({ name: 'Operator', session_key: 'agent-session-1' })

    const res = await postComment()
    const body = await res.json()
    const sessionMessage = db.prepare(`
      SELECT conversation_id, from_agent, to_agent, content
      FROM messages
      WHERE id = ?
    `).get(body.session_log.message_id) as any

    expect(res.status).toBe(201)
    expect(body.relay).toEqual({
      attempted: false,
      relayed: false,
      reason: 'author_is_assignee',
    })
    expect(body.session_log).toMatchObject({
      recorded: true,
      conversation_id: 'project:42:agent:operator',
    })
    expect(sessionMessage).toMatchObject({
      conversation_id: 'project:42:agent:operator',
      from_agent: 'Operator',
      to_agent: null,
    })
  })

  it('skips project session logging when the task is not attached to a project', async () => {
    seedTask({ assigned_to: 'relay-agent', project_id: null })
    seedAgent({ name: 'relay-agent', session_key: 'agent-session-1' })

    const res = await postComment()
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.session_log).toEqual({
      recorded: false,
      reason: 'task_without_project',
    })
  })

  it('persists the comment even when every relay path fails', async () => {
    seedTask({ assigned_to: 'relay-agent' })
    seedAgent({ name: 'relay-agent', session_key: 'agent-session-1' })
    gatewayCall.mockRejectedValue(new Error('gateway down'))

    const res = await postComment()
    const body = await res.json()
    const stored = db.prepare(
      `SELECT content FROM comments WHERE id = ? AND task_id = ?`,
    ).get(body.comment.id, 1) as { content: string } | undefined

    expect(res.status).toBe(201)
    expect(stored?.content).toBe('Owner reply')
    expect(body.relay).toMatchObject({
      attempted: true,
      relayed: false,
      reason: 'agent_session_unavailable',
    })
  })
})
