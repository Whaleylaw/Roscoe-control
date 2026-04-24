import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'

// In-memory SQLite shared with the route via vi.mock('@/lib/db').
let db: Database.Database

vi.mock('@/lib/db', () => ({
  getDatabase: () => db,
  db_helpers: {
    logActivity: () => {},
  },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { workspace_id: 1, role: 'admin', username: 'tester' } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('@/lib/sessions', () => ({
  getAllGatewaySessions: vi.fn(() => []),
}))

vi.mock('@/lib/claude-sessions', () => ({
  syncClaudeSessions: vi.fn(async () => ({ ok: true, message: '' })),
  getLocalClaudeSessions: vi.fn(() => []),
}))

vi.mock('@/lib/codex-sessions', () => ({
  scanCodexSessions: vi.fn(() => []),
}))

vi.mock('@/lib/hermes-sessions', () => ({
  scanHermesSessions: vi.fn(() => []),
}))

import { getAllGatewaySessions } from '@/lib/sessions'
import { syncClaudeSessions, getLocalClaudeSessions } from '@/lib/claude-sessions'
import { scanCodexSessions } from '@/lib/codex-sessions'
import { scanHermesSessions } from '@/lib/hermes-sessions'
import { requireRole } from '@/lib/auth'

function setupSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      ticket_prefix TEXT NOT NULL DEFAULT 'T',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(workspace_id, slug)
    );
    CREATE TABLE agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'code',
      status TEXT NOT NULL DEFAULT 'idle',
      hidden INTEGER NOT NULL DEFAULT 0,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE project_agent_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      agent_name TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      assigned_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_id, agent_name)
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'inbox',
      assigned_to TEXT,
      project_id INTEGER,
      workspace_id INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'text',
      metadata TEXT,
      read_at INTEGER,
      created_at INTEGER DEFAULT 0
    );
  `)
}

function seedProject(database: Database.Database, p: { id: number; slug: string; workspaceId?: number }) {
  database
    .prepare(
      'INSERT INTO projects (id, slug, name, ticket_prefix, workspace_id) VALUES (?, ?, ?, ?, ?)',
    )
    .run(p.id, p.slug, p.slug, p.slug.toUpperCase().slice(0, 4), p.workspaceId ?? 1)
}

function seedAgent(
  database: Database.Database,
  a: { name: string; status?: string; workspaceId?: number; hidden?: number },
) {
  database
    .prepare(
      'INSERT OR IGNORE INTO agents (name, role, status, hidden, workspace_id) VALUES (?, ?, ?, ?, ?)',
    )
    .run(a.name, 'code', a.status ?? 'idle', a.hidden ?? 0, a.workspaceId ?? 1)
}

function seedAssignment(
  database: Database.Database,
  a: { projectId: number; agentName: string; role?: string },
) {
  database
    .prepare('INSERT OR IGNORE INTO project_agent_assignments (project_id, agent_name, role) VALUES (?, ?, ?)')
    .run(a.projectId, a.agentName, a.role ?? 'member')
}

function seedTask(
  database: Database.Database,
  t: { title?: string; assignedTo?: string | null; projectId?: number | null; workspaceId?: number },
) {
  database
    .prepare(
      'INSERT INTO tasks (title, assigned_to, project_id, workspace_id) VALUES (?, ?, ?, ?)',
    )
    .run(t.title ?? 't', t.assignedTo ?? null, t.projectId ?? null, t.workspaceId ?? 1)
}

function seedMessage(
  database: Database.Database,
  m: { conversationId: string; content: string; fromAgent?: string; createdAt: number },
) {
  database
    .prepare(
      'INSERT INTO messages (conversation_id, from_agent, content, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(m.conversationId, m.fromAgent ?? 'user', m.content, m.createdAt)
}

async function callGet(id: string, url?: string) {
  const { GET } = await import('@/app/api/projects/[id]/sessions/route')
  const req = new NextRequest(url ?? `http://localhost/api/projects/${id}/sessions`)
  return GET(req, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  db = new Database(':memory:')
  setupSchema(db)
  vi.mocked(getAllGatewaySessions).mockReset().mockReturnValue([])
  vi.mocked(syncClaudeSessions).mockReset().mockResolvedValue({ ok: true, message: '' })
  vi.mocked(getLocalClaudeSessions).mockReset().mockReturnValue([])
  vi.mocked(scanCodexSessions).mockReset().mockReturnValue([])
  vi.mocked(scanHermesSessions).mockReset().mockReturnValue([])
  vi.mocked(requireRole).mockReset().mockReturnValue({
    user: { workspace_id: 1, role: 'admin', username: 'tester' },
  } as any)
})

afterEach(() => {
  db.close()
  vi.resetModules()
})

describe('GET /api/projects/[id]/sessions', () => {
  describe('SESS-01: response shape', () => {
    it('returns { threads: Thread[], runtimeSessions: RuntimeSession[] }', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      const res = await callGet('10')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('threads')
      expect(body).toHaveProperty('runtimeSessions')
      expect(Array.isArray(body.threads)).toBe(true)
      expect(Array.isArray(body.runtimeSessions)).toBe(true)
    })

    it('returns 400 on non-numeric project id', async () => {
      const res = await callGet('abc')
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Invalid project id')
    })

    it('returns 404 when project does not exist', async () => {
      const res = await callGet('99999')
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toBe('Project not found')
    })

    it('requires viewer role (requireRole)', async () => {
      vi.mocked(requireRole).mockReturnValueOnce({ error: 'Unauthorized', status: 401 } as any)
      const res = await callGet('10')
      expect(res.status).toBe(401)
    })
  })

  describe('SESS-01: threads section (D-04, D-06, Pitfall 3 Option B)', () => {
    it('returns one thread per agent in the project (assigned ∪ task-derived) — NO messages required', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      seedAgent(db, { name: 'Aegis' })
      seedAgent(db, { name: 'Hermes' })
      seedAssignment(db, { projectId: 10, agentName: 'aegis' })
      seedTask(db, { assignedTo: 'Hermes', projectId: 10 })
      const res = await callGet('10')
      const body = await res.json()
      const names = body.threads.map((t: any) => t.agentName).sort()
      expect(names).toEqual(['Aegis', 'Hermes'])
    })

    it('marks the primary project agent and returns primaryAgent metadata', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      seedAgent(db, { name: 'Aegis' })
      seedAgent(db, { name: 'Hermes' })
      seedAssignment(db, { projectId: 10, agentName: 'aegis', role: 'primary' })
      seedAssignment(db, { projectId: 10, agentName: 'hermes' })
      const res = await callGet('10')
      const body = await res.json()
      expect(body.primaryAgent).toEqual({ name: 'Aegis', status: 'idle' })
      const primaryThread = body.threads.find((t: any) => t.agentName === 'Aegis')
      expect(primaryThread.isPrimary).toBe(true)
      expect(primaryThread.assignmentRole).toBe('primary')
      const memberThread = body.threads.find((t: any) => t.agentName === 'Hermes')
      expect(memberThread.isPrimary).toBe(false)
      expect(memberThread.assignmentRole).toBe('member')
    })

    it('thread id format is exactly `thread:<projectId>:<agentNameLower>`', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      seedAgent(db, { name: 'Aegis' })
      seedAssignment(db, { projectId: 10, agentName: 'aegis' })
      const res = await callGet('10')
      const body = await res.json()
      expect(body.threads[0].id).toBe('thread:10:aegis')
    })

    it('conversationId format is exactly `project:<projectId>:agent:<agentNameLower>` (uses numeric project.id, not slug — Pitfall 4)', async () => {
      seedProject(db, { id: 10, slug: 'alpha-project' })
      seedAgent(db, { name: 'Aegis' })
      seedAssignment(db, { projectId: 10, agentName: 'aegis' })
      const res = await callGet('10')
      const body = await res.json()
      expect(body.threads[0].conversationId).toBe('project:10:agent:aegis')
      expect(body.threads[0].conversationId).not.toContain('alpha-project')
    })

    it('thread lastMessage is null when no messages exist for the conversationId', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      seedAgent(db, { name: 'Aegis' })
      seedAssignment(db, { projectId: 10, agentName: 'aegis' })
      const res = await callGet('10')
      const body = await res.json()
      expect(body.threads[0].lastMessage).toBeNull()
      expect(body.threads[0].lastActivity).toBe(0)
    })

    it('thread lastMessage is the most recent message.content for the conversationId (ORDER BY created_at DESC LIMIT 1)', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      seedAgent(db, { name: 'Aegis' })
      seedAssignment(db, { projectId: 10, agentName: 'aegis' })
      seedMessage(db, { conversationId: 'project:10:agent:aegis', content: 'first', createdAt: 100 })
      seedMessage(db, { conversationId: 'project:10:agent:aegis', content: 'latest', createdAt: 500 })
      seedMessage(db, { conversationId: 'project:10:agent:aegis', content: 'middle', createdAt: 300 })
      const res = await callGet('10')
      const body = await res.json()
      expect(body.threads[0].lastMessage).toBe('latest')
      expect(body.threads[0].lastActivity).toBe(500)
    })

    it('Pitfall 3: GET does NOT insert placeholder messages — messages table row-count is unchanged before/after the call', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      seedAgent(db, { name: 'Aegis' })
      seedAssignment(db, { projectId: 10, agentName: 'aegis' })
      const before = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c
      await callGet('10')
      const after = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c
      expect(after).toBe(before)
    })

    it('threads are sorted by lastActivity DESC, threads with null lastMessage last', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      seedAgent(db, { name: 'Aegis' })
      seedAgent(db, { name: 'Hermes' })
      seedAgent(db, { name: 'Codex' })
      seedAssignment(db, { projectId: 10, agentName: 'aegis' })
      seedAssignment(db, { projectId: 10, agentName: 'hermes' })
      seedAssignment(db, { projectId: 10, agentName: 'codex' })
      seedMessage(db, { conversationId: 'project:10:agent:aegis', content: 'old', createdAt: 100 })
      seedMessage(db, { conversationId: 'project:10:agent:hermes', content: 'new', createdAt: 999 })
      // Codex has no messages
      const res = await callGet('10')
      const body = await res.json()
      const order = body.threads.map((t: any) => t.agentName)
      expect(order[0]).toBe('Hermes')
      expect(order[1]).toBe('Aegis')
      expect(order[2]).toBe('Codex')
    })
  })

  describe('SESS-01: runtime sessions section (D-05, Open Question 1 resolution)', () => {
    it('includes Claude/Codex/Hermes local sessions AND gateway sessions', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      seedAgent(db, { name: 'Aegis' })
      seedAssignment(db, { projectId: 10, agentName: 'aegis' })
      vi.mocked(getAllGatewaySessions).mockReturnValue([
        { id: 'gw-1', agent: 'aegis', startedAt: 100, active: true } as any,
      ])
      vi.mocked(getLocalClaudeSessions).mockReturnValue([
        { id: 'cl-1', project_slug: 'alpha', startedAt: 200, active: false } as any,
      ])
      vi.mocked(scanCodexSessions).mockReturnValue([
        { id: 'cx-1', project_slug: 'alpha', startedAt: 300, active: false } as any,
      ])
      vi.mocked(scanHermesSessions).mockReturnValue([
        { id: 'hr-1', agent: 'aegis', startedAt: 400, active: true } as any,
      ])
      const res = await callGet('10')
      const body = await res.json()
      const kinds = body.runtimeSessions.map((s: any) => s.kind).sort()
      expect(kinds).toContain('Gateway')
      expect(kinds).toContain('Claude')
      expect(kinds).toContain('Codex')
      expect(kinds).toContain('Hermes')
    })

    it('linkage rule — Rule A (agent-membership): session whose session.agent matches a project-assigned agent is included', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      seedAgent(db, { name: 'Aegis' })
      seedAssignment(db, { projectId: 10, agentName: 'aegis' })
      vi.mocked(getAllGatewaySessions).mockReturnValue([
        { id: 'gw-A', agent: 'aegis', project_slug: 'irrelevant', startedAt: 100, active: true } as any,
      ])
      const res = await callGet('10')
      const body = await res.json()
      expect(body.runtimeSessions.map((s: any) => s.id)).toContain('gw-A')
    })

    it('linkage rule — Rule B (slug match): session whose project_slug === project.slug is included', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      // No project agents at all
      vi.mocked(getAllGatewaySessions).mockReturnValue([
        { id: 'gw-B', agent: 'unknown', project_slug: 'alpha', startedAt: 100, active: true } as any,
      ])
      const res = await callGet('10')
      const body = await res.json()
      expect(body.runtimeSessions.map((s: any) => s.id)).toContain('gw-B')
    })

    it('linkage rule — UNION of A OR B — a session satisfying either rule appears; a session satisfying neither is excluded', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      seedAgent(db, { name: 'Aegis' })
      seedAssignment(db, { projectId: 10, agentName: 'aegis' })
      vi.mocked(getAllGatewaySessions).mockReturnValue([
        { id: 'gw-1', agent: 'aegis', project_slug: 'unrelated', startedAt: 100 } as any, // Rule A
        { id: 'gw-2', agent: 'unknown', project_slug: 'alpha', startedAt: 200 } as any, // Rule B
        { id: 'gw-3', agent: 'unknown', project_slug: 'other', startedAt: 300 } as any, // neither
      ])
      const res = await callGet('10')
      const body = await res.json()
      const ids = body.runtimeSessions.map((s: any) => s.id)
      expect(ids).toContain('gw-1')
      expect(ids).toContain('gw-2')
      expect(ids).not.toContain('gw-3')
    })

    it('runtime session id is the existing session.id/session_key, not a thread: prefix (so router can distinguish)', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      vi.mocked(getAllGatewaySessions).mockReturnValue([
        { id: 'gateway-session-xyz', project_slug: 'alpha', startedAt: 100 } as any,
      ])
      const res = await callGet('10')
      const body = await res.json()
      expect(body.runtimeSessions[0].id).toBe('gateway-session-xyz')
      expect(body.runtimeSessions[0].id).not.toMatch(/^thread:/)
    })

    it('runtime session includes kind (Claude|Codex|Hermes|Gateway), ticketRef, startedAt, status', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      vi.mocked(getAllGatewaySessions).mockReturnValue([
        { id: 'gw-1', project_slug: 'alpha', ticketRef: 'TASK-42', startedAt: 100, active: true } as any,
      ])
      const res = await callGet('10')
      const body = await res.json()
      const s = body.runtimeSessions[0]
      expect(s.kind).toBe('Gateway')
      expect(s.ticketRef).toBe('TASK-42')
      expect(s.startedAt).toBe(100)
      expect(s.status).toBe('running')
    })

    it('runtime sessions are sorted by startedAt DESC', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      vi.mocked(getAllGatewaySessions).mockReturnValue([
        { id: 'a', project_slug: 'alpha', startedAt: 100 } as any,
        { id: 'b', project_slug: 'alpha', startedAt: 500 } as any,
        { id: 'c', project_slug: 'alpha', startedAt: 250 } as any,
      ])
      const res = await callGet('10')
      const body = await res.json()
      const order = body.runtimeSessions.map((s: any) => s.id)
      expect(order).toEqual(['b', 'c', 'a'])
    })
  })

  describe('SESS-01: empty states', () => {
    it('returns { threads: [], runtimeSessions: [] } when no agents are assigned or task-derived', async () => {
      seedProject(db, { id: 10, slug: 'alpha' })
      const res = await callGet('10')
      const body = await res.json()
      expect(body.threads).toEqual([])
      expect(body.runtimeSessions).toEqual([])
    })
  })
})
