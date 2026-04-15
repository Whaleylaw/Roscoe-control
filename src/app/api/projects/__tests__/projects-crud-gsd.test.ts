import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Wave 2 Plan 09-02. Covers: GSD-01, GSD-03, GSD-13, GSD-14.
// Extends projects CRUD routes to accept/return the 6 new gsd_* fields,
// validates track/gate_mode on write, and enforces that gsd_phase may
// ONLY be changed via /api/projects/:id/gsd/transition (not PATCH).

// ---------- In-memory project fixture + mock DB ----------

type Row = Record<string, unknown>

// Mutable workspace store keyed by id. Tests reset this in beforeEach.
const projectTable = new Map<number, Row>()
let nextProjectId = 1

function makeProject(overrides: Partial<Row>): Row {
  const id = nextProjectId++
  const now = 1_700_000_000
  const base: Row = {
    id,
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
    gsd_enabled: 0,
    gsd_track: null,
    gsd_phase: 'discuss',
    gsd_gate_mode: 'manual_approval',
    gsd_project_id: null,
    gsd_updated_at: null,
    github_sync_enabled: 0,
    github_labels_initialized: 0,
    github_default_branch: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
  projectTable.set(id, base)
  return base
}

// Captured SQL so acceptance tests can assert column presence.
const capturedSql: string[] = []

vi.mock('@/lib/db', () => {
  function match(sql: string, re: RegExp): boolean {
    return re.test(sql)
  }
  return {
    getDatabase: () => ({
      prepare: (sql: string) => {
        capturedSql.push(sql)
        const trimmed = sql.trim()

        return {
          all: (..._args: unknown[]) => {
            // SELECT FROM projects (list)
            if (match(trimmed, /FROM projects p[\s\S]*GROUP BY p\.id/)) {
              return Array.from(projectTable.values()).map(p => ({
                ...p,
                task_count: 0,
                assigned_agents_csv: null,
                last_activity_at: null,
              }))
            }
            return []
          },
          get: (...args: unknown[]) => {
            // tenant scope guard: SELECT p.id FROM projects p JOIN workspaces ...
            if (match(trimmed, /JOIN workspaces/)) {
              const [id] = args as [number]
              return projectTable.has(id) ? { id } : undefined
            }
            // SELECT * FROM projects WHERE id = ? AND workspace_id = ?
            if (match(trimmed, /SELECT \* FROM projects WHERE id = \? AND workspace_id = \?/)) {
              const [id] = args as [number, number]
              return projectTable.get(id)
            }
            // SELECT id FROM projects WHERE workspace_id = ? AND (slug = ? OR ticket_prefix = ?)
            if (match(trimmed, /AND \(slug = \? OR ticket_prefix = \?\)/)) {
              const [, slug, prefix] = args as [number, string, string]
              for (const p of projectTable.values()) {
                if (p.slug === slug || p.ticket_prefix === prefix) return { id: p.id }
              }
              return undefined
            }
            // SELECT id FROM projects WHERE workspace_id = ? AND ticket_prefix = ? AND id != ?
            if (match(trimmed, /ticket_prefix = \? AND id != \?/)) {
              const [, prefix, notId] = args as [number, string, number]
              for (const p of projectTable.values()) {
                if (p.ticket_prefix === prefix && p.id !== notId) return { id: p.id }
              }
              return undefined
            }
            // Post-INSERT / post-PATCH detail SELECT
            if (match(trimmed, /FROM projects\s+WHERE id = \?\s*(AND workspace_id = \?)?/)) {
              const [id] = args as [number, number?]
              return projectTable.get(id)
            }
            // GET detail with p. aliases
            if (match(trimmed, /FROM projects p\s+WHERE p\.id = \? AND p\.workspace_id = \?/)) {
              const [id] = args as [number, number]
              return projectTable.get(id)
            }
            return undefined
          },
          run: (...args: unknown[]) => {
            // INSERT INTO projects
            if (match(trimmed, /INSERT INTO projects/)) {
              // Match all columns listed in the INSERT. We infer by position.
              // Columns: workspace_id, name, slug, description, ticket_prefix, github_repo,
              //          deadline, color, gsd_enabled, gsd_track, gsd_gate_mode, gsd_project_id
              const [
                workspace_id, name, slug, description, ticket_prefix, github_repo,
                deadline, color, gsd_enabled, gsd_track, gsd_gate_mode, gsd_project_id,
              ] = args as Array<string | number | null>
              const row = makeProject({
                workspace_id: workspace_id ?? 1,
                name,
                slug,
                description,
                ticket_prefix,
                github_repo,
                deadline,
                color,
                gsd_enabled: gsd_enabled ?? 0,
                gsd_track: gsd_track ?? null,
                gsd_gate_mode: gsd_gate_mode ?? 'manual_approval',
                gsd_project_id: gsd_project_id ?? null,
              })
              return { lastInsertRowid: row.id as number, changes: 1 }
            }
            // UPDATE projects SET <...cols...> WHERE id = ? AND workspace_id = ?
            if (match(trimmed, /UPDATE projects\s+SET/)) {
              const m = trimmed.match(/UPDATE projects\s+SET\s+([\s\S]+?)\s+WHERE id = \? AND workspace_id = \?/)
              if (!m) return { changes: 0 }
              const setClause = m[1]
              const cols = setClause.split(',').map(s => s.trim().replace(/\s*=.*$/, ''))
              const paramsArr = args as Array<string | number | null>
              const id = paramsArr[paramsArr.length - 2] as number
              const row = projectTable.get(id)
              if (!row) return { changes: 0 }
              cols.forEach((col, idx) => {
                row[col] = paramsArr[idx] ?? null
              })
              return { changes: 1 }
            }
            return { changes: 0 }
          },
        }
      },
      transaction: (fn: () => void) => () => fn(),
    }),
  }
})

// Role mock — mutable so individual tests can flip to viewer.
const currentAuth: { user: { id: number; username: string; role: string; workspace_id: number; tenant_id: number } } = {
  user: { id: 1, username: 'admin', role: 'operator', workspace_id: 1, tenant_id: 1 },
}

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn((_req: unknown, required: 'viewer' | 'operator' | 'admin') => {
    const role = currentAuth.user.role
    const order = { viewer: 0, operator: 1, admin: 2 }
    if (order[role as keyof typeof order] < order[required]) {
      return { error: 'Forbidden', status: 403 }
    }
    return { user: currentAuth.user }
  }),
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
  projectTable.clear()
  nextProjectId = 1
  capturedSql.length = 0
  currentAuth.user.role = 'operator'
})

afterEach(() => {
  vi.resetModules()
})

// ---------- Tests ----------

describe('projects CRUD — gsd fields (GSD-01, GSD-03, GSD-13, GSD-14)', () => {
  describe('POST /api/projects', () => {
    it('accepts gsd_enabled:true + gsd_track:"ops" + gsd_gate_mode:"manual_approval" and returns all 6 gsd_* fields', async () => {
      const { POST } = await import('@/app/api/projects/route')
      const req = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Alpha',
          ticket_prefix: 'ALPH',
          gsd_enabled: true,
          gsd_track: 'ops',
          gsd_gate_mode: 'manual_approval',
          gsd_project_id: 'my-slug',
        }),
      })
      const res = await POST(req)
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.project).toBeDefined()
      expect(body.project.gsd_enabled).toBe(1)
      expect(body.project.gsd_track).toBe('ops')
      expect(body.project.gsd_phase).toBe('discuss')
      expect(body.project.gsd_gate_mode).toBe('manual_approval')
      expect(body.project.gsd_project_id).toBe('my-slug')
      expect(body.project).toHaveProperty('gsd_updated_at')
    })

    it('rejects invalid gsd_track with 400', async () => {
      const { POST } = await import('@/app/api/projects/route')
      const req = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Alpha',
          ticket_prefix: 'ALPH',
          gsd_track: 'not-a-track',
        }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/Invalid gsd_track/)
    })

    it('rejects invalid gsd_gate_mode with 400', async () => {
      const { POST } = await import('@/app/api/projects/route')
      const req = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Alpha',
          ticket_prefix: 'ALPH',
          gsd_gate_mode: 'not-a-mode',
        }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/Invalid gsd_gate_mode/)
    })

    it('viewer role gets 403 on POST', async () => {
      currentAuth.user.role = 'viewer'
      const { POST } = await import('@/app/api/projects/route')
      const req = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alpha' }),
      })
      const res = await POST(req)
      expect(res.status).toBe(403)
    })
  })

  describe('GET /api/projects (list)', () => {
    it('returns all 6 gsd_* fields on each project row', async () => {
      makeProject({ name: 'Alpha', slug: 'alpha', ticket_prefix: 'ALPH', gsd_enabled: 1, gsd_track: 'product' })
      makeProject({ name: 'Beta', slug: 'beta', ticket_prefix: 'BETA' })

      const { GET } = await import('@/app/api/projects/route')
      const res = await GET(new NextRequest('http://localhost/api/projects'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.projects.length).toBe(2)
      for (const p of body.projects) {
        expect(p).toHaveProperty('gsd_enabled')
        expect(p).toHaveProperty('gsd_track')
        expect(p).toHaveProperty('gsd_phase')
        expect(p).toHaveProperty('gsd_gate_mode')
        expect(p).toHaveProperty('gsd_project_id')
        expect(p).toHaveProperty('gsd_updated_at')
      }
      // And the SELECT SQL cites the six columns explicitly.
      const listSql = capturedSql.find(s => /FROM projects p[\s\S]*GROUP BY p\.id/.test(s))
      expect(listSql).toBeDefined()
      expect(listSql).toMatch(/p\.gsd_enabled/)
      expect(listSql).toMatch(/p\.gsd_track/)
      expect(listSql).toMatch(/p\.gsd_phase/)
      expect(listSql).toMatch(/p\.gsd_gate_mode/)
      expect(listSql).toMatch(/p\.gsd_project_id/)
      expect(listSql).toMatch(/p\.gsd_updated_at/)
    })
  })

  describe('GET /api/projects/:id (detail)', () => {
    it('returns the same 6 gsd_* fields', async () => {
      makeProject({ name: 'Alpha', slug: 'alpha', ticket_prefix: 'ALPH', gsd_enabled: 1, gsd_track: 'ops' })

      const { GET } = await import('@/app/api/projects/[id]/route')
      const req = new NextRequest('http://localhost/api/projects/1')
      const res = await GET(req, { params: Promise.resolve({ id: '1' }) })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.project.gsd_enabled).toBe(1)
      expect(body.project.gsd_track).toBe('ops')
      expect(body.project.gsd_phase).toBe('discuss')
      expect(body.project.gsd_gate_mode).toBe('manual_approval')
      expect(body.project).toHaveProperty('gsd_project_id')
      expect(body.project).toHaveProperty('gsd_updated_at')
    })
  })

  describe('PATCH /api/projects/:id', () => {
    it('accepts partial gsd updates (gsd_enabled)', async () => {
      makeProject({ name: 'Alpha', slug: 'alpha', ticket_prefix: 'ALPH' })

      const { PATCH } = await import('@/app/api/projects/[id]/route')
      const req = new NextRequest('http://localhost/api/projects/1', {
        method: 'PATCH',
        body: JSON.stringify({ gsd_enabled: true }),
      })
      const res = await PATCH(req, { params: Promise.resolve({ id: '1' }) })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.project.gsd_enabled).toBe(1)
    })

    it('accepts gsd_track:null to unset the track', async () => {
      makeProject({ name: 'Alpha', slug: 'alpha', ticket_prefix: 'ALPH', gsd_track: 'ops' })

      const { PATCH } = await import('@/app/api/projects/[id]/route')
      const req = new NextRequest('http://localhost/api/projects/1', {
        method: 'PATCH',
        body: JSON.stringify({ gsd_track: null }),
      })
      const res = await PATCH(req, { params: Promise.resolve({ id: '1' }) })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.project.gsd_track).toBeNull()
    })

    it('does NOT modify gsd_phase when present in PATCH body (must route through /gsd/transition)', async () => {
      makeProject({ name: 'Alpha', slug: 'alpha', ticket_prefix: 'ALPH', gsd_phase: 'discuss' })

      const { PATCH } = await import('@/app/api/projects/[id]/route')
      const req = new NextRequest('http://localhost/api/projects/1', {
        method: 'PATCH',
        body: JSON.stringify({ gsd_phase: 'execute', gsd_enabled: true }),
      })
      const res = await PATCH(req, { params: Promise.resolve({ id: '1' }) })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.project.gsd_phase).toBe('discuss') // unchanged
      expect(body.project.gsd_enabled).toBe(1) // other field applied
    })

    it('rejects invalid gsd_track with 400', async () => {
      makeProject({ name: 'Alpha', slug: 'alpha', ticket_prefix: 'ALPH' })

      const { PATCH } = await import('@/app/api/projects/[id]/route')
      const req = new NextRequest('http://localhost/api/projects/1', {
        method: 'PATCH',
        body: JSON.stringify({ gsd_track: 'bogus' }),
      })
      const res = await PATCH(req, { params: Promise.resolve({ id: '1' }) })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/Invalid gsd_track/)
    })

    it('rejects invalid gsd_gate_mode with 400', async () => {
      makeProject({ name: 'Alpha', slug: 'alpha', ticket_prefix: 'ALPH' })

      const { PATCH } = await import('@/app/api/projects/[id]/route')
      const req = new NextRequest('http://localhost/api/projects/1', {
        method: 'PATCH',
        body: JSON.stringify({ gsd_gate_mode: 'bogus' }),
      })
      const res = await PATCH(req, { params: Promise.resolve({ id: '1' }) })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/Invalid gsd_gate_mode/)
    })

    it('viewer role gets 403 on PATCH when GSD fields present', async () => {
      makeProject({ name: 'Alpha', slug: 'alpha', ticket_prefix: 'ALPH' })
      currentAuth.user.role = 'viewer'

      const { PATCH } = await import('@/app/api/projects/[id]/route')
      const req = new NextRequest('http://localhost/api/projects/1', {
        method: 'PATCH',
        body: JSON.stringify({ gsd_enabled: true }),
      })
      const res = await PATCH(req, { params: Promise.resolve({ id: '1' }) })
      expect(res.status).toBe(403)
    })
  })
})
