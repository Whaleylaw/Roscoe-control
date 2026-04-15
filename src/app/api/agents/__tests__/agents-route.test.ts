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
  requireRole: () => ({ user: { workspace_id: 1, role: 'admin', username: 'tester' } }),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: () => null,
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: () => {}, emit: () => {} },
}))

vi.mock('@/lib/agent-templates', () => ({
  getTemplate: () => null,
  buildAgentConfig: () => ({}),
}))

vi.mock('@/lib/agent-sync', () => ({
  writeAgentToConfig: async () => {},
  // Pass-through so JSON.parse(config || '{}') goes straight back as-is.
  enrichAgentConfigFromWorkspace: (cfg: any) => cfg,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('@/lib/validation', () => ({
  validateBody: async () => ({ data: {} }),
  createAgentSchema: {},
}))

vi.mock('@/lib/command', () => ({
  runOpenClaw: async () => '',
}))

vi.mock('@/lib/config', () => ({
  config: { openclawStateDir: null, homeDir: '/tmp' },
}))

vi.mock('@/lib/paths', () => ({
  resolveWithin: (...parts: string[]) => parts.join('/'),
}))

function setupSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      session_key TEXT,
      soul_content TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen INTEGER,
      last_activity TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      config TEXT,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      hidden INTEGER NOT NULL DEFAULT 0,
      runtime_type TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      workspace_id INTEGER NOT NULL DEFAULT 1
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
  `)
}

function seedFixtures(database: Database.Database) {
  // Projects
  database
    .prepare(`INSERT INTO projects (id, name, slug, workspace_id) VALUES (?, ?, ?, ?)`)
    .run(10, 'Alpha', 'alpha', 1)
  database
    .prepare(`INSERT INTO projects (id, name, slug, workspace_id) VALUES (?, ?, ?, ?)`)
    .run(20, 'Beta', 'beta', 1)

  // Agents — Aegis canonical casing, Hermes, Codex, plus an Orphan never on this project.
  const insertAgent = database.prepare(
    `INSERT INTO agents (id, name, role, status, created_at, updated_at, workspace_id, hidden, config)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insertAgent.run(1, 'Aegis', 'code', 'idle', 1000, 1000, 1, 0, null)
  insertAgent.run(2, 'Hermes', 'planner', 'busy', 1100, 1100, 1, 0, null)
  insertAgent.run(3, 'Codex', 'reviewer', 'idle', 1200, 1200, 1, 0, null)
  insertAgent.run(4, 'Orphan', 'misc', 'offline', 1300, 1300, 1, 0, null)
  insertAgent.run(5, 'Hidden', 'misc', 'offline', 1400, 1400, 1, 1, null)

  // project_agent_assignments — 'aegis' (lowercase) for project 10 to exercise Pitfall 6 dedupe.
  database
    .prepare(`INSERT INTO project_agent_assignments (project_id, agent_name) VALUES (?, ?)`)
    .run(10, 'aegis')

  // Tasks — Hermes (task-derived only on project 10), Aegis on project 10 (overlap with assignment),
  // Aegis on project 20 (out-of-scope to test stat scoping), Codex on project 20 only.
  const insertTask = database.prepare(
    `INSERT INTO tasks (title, status, assigned_to, project_id, workspace_id) VALUES (?, ?, ?, ?, ?)`,
  )
  insertTask.run('T-1', 'in_progress', 'Hermes', 10, 1)
  insertTask.run('T-2', 'assigned', 'Aegis', 10, 1)
  insertTask.run('T-3', 'done', 'Aegis', 10, 1)
  insertTask.run('T-4', 'in_progress', 'Aegis', 20, 1)
  insertTask.run('T-5', 'in_progress', 'Codex', 20, 1)
  // A task assigned outside any project (project_id NULL) — must not affect scoped queries.
  insertTask.run('T-6', 'in_progress', 'Aegis', null, 1)
}

beforeEach(() => {
  db = new Database(':memory:')
  setupSchema(db)
  seedFixtures(db)
  vi.resetModules()
})

afterEach(() => {
  db.close()
})

describe('GET /api/agents', () => {
  describe('existing behavior (no project_id) — regression guard', () => {
    it('returns all workspace agents when project_id is omitted', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const req = new NextRequest('http://localhost/api/agents')
      const res = await GET(req)
      const body = await res.json()
      const names = body.agents.map((a: { name: string }) => a.name).sort()
      // Hidden=1 row excluded by default.
      expect(names).toEqual(['Aegis', 'Codex', 'Hermes', 'Orphan'])
    })

    it('respects existing filters status, role, show_hidden', async () => {
      const { GET } = await import('@/app/api/agents/route')
      // status filter
      const idleRes = await GET(new NextRequest('http://localhost/api/agents?status=idle'))
      const idleBody = await idleRes.json()
      expect(idleBody.agents.map((a: any) => a.name).sort()).toEqual(['Aegis', 'Codex'])

      // role filter
      const planRes = await GET(new NextRequest('http://localhost/api/agents?role=planner'))
      const planBody = await planRes.json()
      expect(planBody.agents.map((a: any) => a.name)).toEqual(['Hermes'])

      // show_hidden
      const hiddenRes = await GET(new NextRequest('http://localhost/api/agents?show_hidden=true'))
      const hiddenBody = await hiddenRes.json()
      expect(hiddenBody.agents.map((a: any) => a.name)).toContain('Hidden')
    })

    it('task counts are unscoped (count all tasks for each agent) when project_id is omitted', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents'))
      const body = await res.json()
      const aegis = body.agents.find((a: any) => a.name === 'Aegis')
      // T-2, T-3, T-4, T-6 — 4 tasks total across all projects (and one with NULL project).
      expect(aegis.taskStats.total).toBe(4)
    })
  })

  describe('SESS-02: project_id union filter', () => {
    it('returns agents explicitly assigned via project_agent_assignments for the given project_id', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=10'))
      const body = await res.json()
      expect(body.agents.map((a: any) => a.name)).toContain('Aegis')
    })

    it('returns agents whose name appears in tasks.assigned_to for any task with project_id=<id> (task-derived)', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=10'))
      const body = await res.json()
      expect(body.agents.map((a: any) => a.name)).toContain('Hermes')
    })

    it('returns UNION — agent present in either source is included', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=10'))
      const body = await res.json()
      const names = body.agents.map((a: any) => a.name).sort()
      expect(names).toEqual(['Aegis', 'Hermes'])
    })

    it('excludes agents that are in neither assignments nor project tasks', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=10'))
      const body = await res.json()
      const names = body.agents.map((a: any) => a.name)
      expect(names).not.toContain('Codex')
      expect(names).not.toContain('Orphan')
    })
  })

  describe('SESS-02: dedupe with LOWER() comparison (Pitfall 6)', () => {
    it('agent whose canonical name is "Aegis" and whose project_agent_assignments row is "aegis" appears exactly once', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=10'))
      const body = await res.json()
      const aegisHits = body.agents.filter((a: any) => a.name.toLowerCase() === 'aegis')
      expect(aegisHits).toHaveLength(1)
    })

    it('dedupe returns the canonical casing from agents.name, not the source-table casing', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=10'))
      const body = await res.json()
      const aegis = body.agents.find((a: any) => a.name.toLowerCase() === 'aegis')
      expect(aegis.name).toBe('Aegis')
    })
  })

  describe('SESS-02: assignment_source field per agent', () => {
    it('agents from project_agent_assignments have assignment_source="assigned"', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=10'))
      const body = await res.json()
      const aegis = body.agents.find((a: any) => a.name === 'Aegis')
      expect(aegis.assignment_source).toBe('assigned')
    })

    it('agents only from tasks.assigned_to have assignment_source="task"', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=10'))
      const body = await res.json()
      const hermes = body.agents.find((a: any) => a.name === 'Hermes')
      expect(hermes.assignment_source).toBe('task')
    })

    it('agents in both sources have assignment_source="assigned" (assigned takes precedence — D-03)', async () => {
      const { GET } = await import('@/app/api/agents/route')
      // Aegis is in BOTH project_agent_assignments AND tasks (via T-2/T-3 on project 10).
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=10'))
      const body = await res.json()
      const aegis = body.agents.find((a: any) => a.name === 'Aegis')
      expect(aegis.assignment_source).toBe('assigned')
    })
  })

  describe('SESS-02: taskStats scoped to project_id', () => {
    it('taskStats.total counts only tasks with project_id=<id> when project_id param is present', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=10'))
      const body = await res.json()
      const aegis = body.agents.find((a: any) => a.name === 'Aegis')
      // Project 10 only: T-2, T-3 → 2 tasks (not the NULL-project T-6, not the project-20 T-4).
      expect(aegis.taskStats.total).toBe(2)
    })

    it('taskStats.active (assigned+in_progress) is likewise scoped to the project_id', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=10'))
      const body = await res.json()
      const aegis = body.agents.find((a: any) => a.name === 'Aegis')
      // Project 10: T-2 assigned, T-3 done → 1 assigned, 0 in_progress.
      expect(aegis.taskStats.assigned).toBe(1)
      expect(aegis.taskStats.in_progress).toBe(0)
    })

    it('agent with tasks in another project has taskStats.total=0 in the scoped response if not assigned here', async () => {
      const { GET } = await import('@/app/api/agents/route')
      // Codex has tasks ONLY on project 20. Asking for project 10 should not include Codex at all,
      // but if we scope to project 20 then Codex appears with project-scoped taskStats.
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=20'))
      const body = await res.json()
      const codex = body.agents.find((a: any) => a.name === 'Codex')
      expect(codex).toBeDefined()
      expect(codex.taskStats.total).toBe(1) // Only T-5 on project 20
    })
  })

  describe('SESS-02: invalid project_id handling', () => {
    it('returns 400 when project_id is non-numeric', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=abc'))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Invalid project_id')
    })

    it('returns empty agents array (200) when project_id is numeric but does not exist', async () => {
      const { GET } = await import('@/app/api/agents/route')
      const res = await GET(new NextRequest('http://localhost/api/agents?project_id=99999'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.agents).toEqual([])
    })
  })
})
