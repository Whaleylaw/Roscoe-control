// Phase 09 Plan 03 — POST /api/projects/:id/gsd/bootstrap
// Covers: GSD-07, GSD-11 (role), GSD-12 (event broadcast), GSD-17, GSD-19.
//
// Contract:
//   First run on a fresh project → created:8, skipped:0
//   Re-run → created:0, skipped:8 (idempotent per D-19 / Pitfall 3)
//   Default template seeds DISCUSS-01/02 + PLAN-01/02 + EXEC-01/02 + VERIFY-01/02
//   PLAN-02 and EXEC-02 have gate_required=1, gate_status='pending'
//   All others gate_required=0, gate_status='not_required'
//   projects.ticket_counter bumps once per created task
//   metadata.gsd_ticket_ref stores the logical ref
//   eventBus.broadcast('task.created', …) fires once per created task
//   db_helpers.logActivity called with type 'project_gsd_bootstrap'
//   viewer role → 403
//   missing project → 404 { code: 'PROJECT_NOT_FOUND' }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'

let db: Database.Database
const broadcastMock = vi.fn()
const logActivityMock = vi.fn()
const ensureTenantAccessMock = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: () => db,
  db_helpers: {
    logActivity: (...args: any[]) => logActivityMock(...args),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({
    user: { id: 1, workspace_id: 1, tenant_id: 1, role: 'operator', username: 'tester' },
  })),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/workspaces', async () => {
  const actual = await vi.importActual<any>('@/lib/workspaces')
  return {
    ...actual,
    ensureTenantWorkspaceAccess: (...args: any[]) => ensureTenantAccessMock(...args),
  }
})

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast: (...args: any[]) => broadcastMock(...args),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

import { requireRole } from '@/lib/auth'

function setupSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      ticket_prefix TEXT NOT NULL DEFAULT 'T',
      ticket_counter INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      gsd_enabled INTEGER NOT NULL DEFAULT 0,
      gsd_track TEXT,
      gsd_phase TEXT NOT NULL DEFAULT 'discuss',
      gsd_gate_mode TEXT NOT NULL DEFAULT 'manual_approval',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority TEXT NOT NULL DEFAULT 'medium',
      project_id INTEGER,
      project_ticket_no INTEGER,
      created_by TEXT,
      gsd_phase TEXT,
      gate_required INTEGER NOT NULL DEFAULT 0,
      gate_status TEXT NOT NULL DEFAULT 'not_required',
      gate_approved_by TEXT,
      gate_approved_at INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `)
}

function seedProject(
  database: Database.Database,
  p: { id: number; slug?: string; workspaceId?: number; gsdTrack?: string | null } = { id: 1 },
) {
  database
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, slug, ticket_prefix, gsd_track)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.id,
      p.workspaceId ?? 1,
      p.slug ?? `project-${p.id}`,
      p.slug ?? `project-${p.id}`,
      'PRJ',
      p.gsdTrack ?? null,
    )
}

async function callPost(id: string) {
  const { POST } = await import('@/app/api/projects/[id]/gsd/bootstrap/route')
  const req = new NextRequest(`http://localhost/api/projects/${id}/gsd/bootstrap`, {
    method: 'POST',
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  db = new Database(':memory:')
  setupSchema(db)
  broadcastMock.mockReset()
  logActivityMock.mockReset()
  ensureTenantAccessMock.mockReset()
  vi.mocked(requireRole).mockReset().mockReturnValue({
    user: { id: 1, workspace_id: 1, tenant_id: 1, role: 'operator', username: 'tester' },
  } as any)
})

afterEach(() => {
  db.close()
  vi.resetModules()
})

describe('POST /api/projects/[id]/gsd/bootstrap (GSD-07, GSD-11, GSD-12, GSD-17, GSD-19)', () => {
  it('viewer role → 403', async () => {
    vi.mocked(requireRole).mockReturnValueOnce({
      error: 'Requires operator role or higher',
      status: 403,
    } as any)
    seedProject(db, { id: 1 })
    const res = await callPost('1')
    expect(res.status).toBe(403)
  })

  it('returns 404 PROJECT_NOT_FOUND when project does not exist', async () => {
    const res = await callPost('999')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('PROJECT_NOT_FOUND')
  })

  it('returns 400 on non-numeric project id', async () => {
    const res = await callPost('abc')
    expect(res.status).toBe(400)
  })

  it('operator on fresh project → 200, { created: 8, skipped: 0 } with 8 tasks seeded (DISCUSS/PLAN/EXEC/VERIFY × 2)', async () => {
    seedProject(db, { id: 1 })
    const res = await callPost('1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(8)
    expect(body.skipped).toBe(0)
    expect(Array.isArray(body.tasks)).toBe(true)
    expect(body.tasks).toHaveLength(8)

    const phaseCounts = db
      .prepare(
        `SELECT gsd_phase, COUNT(*) AS n FROM tasks WHERE project_id = 1 GROUP BY gsd_phase ORDER BY gsd_phase`,
      )
      .all() as { gsd_phase: string; n: number }[]
    const byPhase = Object.fromEntries(phaseCounts.map((r) => [r.gsd_phase, r.n]))
    expect(byPhase).toEqual({ discuss: 2, execute: 2, plan: 2, verify: 2 })
  })

  it('created tasks carry metadata.gsd_ticket_ref for each logical ref', async () => {
    seedProject(db, { id: 1 })
    await callPost('1')
    const rows = db
      .prepare(
        `SELECT json_extract(COALESCE(metadata,'{}'), '$.gsd_ticket_ref') AS ref
         FROM tasks WHERE project_id = 1 ORDER BY id`,
      )
      .all() as { ref: string }[]
    const refs = rows.map((r) => r.ref).sort()
    expect(refs).toEqual([
      'DISCUSS-01', 'DISCUSS-02',
      'EXEC-01', 'EXEC-02',
      'PLAN-01', 'PLAN-02',
      'VERIFY-01', 'VERIFY-02',
    ])
  })

  it('PLAN-02 row has gate_required=1, gate_status="pending"; DISCUSS-01 has gate_required=0, gate_status="not_required"', async () => {
    seedProject(db, { id: 1 })
    await callPost('1')
    const plan02 = db
      .prepare(
        `SELECT gate_required, gate_status FROM tasks
         WHERE project_id = 1
           AND json_extract(COALESCE(metadata,'{}'), '$.gsd_ticket_ref') = 'PLAN-02'`,
      )
      .get() as { gate_required: number; gate_status: string }
    expect(plan02.gate_required).toBe(1)
    expect(plan02.gate_status).toBe('pending')

    const discuss01 = db
      .prepare(
        `SELECT gate_required, gate_status FROM tasks
         WHERE project_id = 1
           AND json_extract(COALESCE(metadata,'{}'), '$.gsd_ticket_ref') = 'DISCUSS-01'`,
      )
      .get() as { gate_required: number; gate_status: string }
    expect(discuss01.gate_required).toBe(0)
    expect(discuss01.gate_status).toBe('not_required')
  })

  it('bumps projects.ticket_counter by 8 on first bootstrap (Pitfall 3)', async () => {
    seedProject(db, { id: 1 })
    const before = (
      db.prepare('SELECT ticket_counter FROM projects WHERE id = 1').get() as {
        ticket_counter: number
      }
    ).ticket_counter
    await callPost('1')
    const after = (
      db.prepare('SELECT ticket_counter FROM projects WHERE id = 1').get() as {
        ticket_counter: number
      }
    ).ticket_counter
    expect(after - before).toBe(8)
  })

  it('re-running bootstrap returns { created: 0, skipped: 8 } — idempotent per D-19 / GSD-19', async () => {
    seedProject(db, { id: 1 })
    await callPost('1')
    const res2 = await callPost('1')
    const body2 = await res2.json()
    expect(body2.created).toBe(0)
    expect(body2.skipped).toBe(8)
    const count = (db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE project_id = 1').get() as {
      n: number
    }).n
    expect(count).toBe(8)
  })

  it('bootstrap with gsd_track="nonexistent" falls back to DEFAULT_TEMPLATE and still creates 8 tasks (GSD-17 soft miss)', async () => {
    // 'nonexistent' is not in GSD_TRACKS → loadGsdTemplate normalizes to default.json which also doesn't exist → DEFAULT_TEMPLATE
    seedProject(db, { id: 1, gsdTrack: 'nonexistent' })
    const res = await callPost('1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(8)
  })

  it('eventBus.broadcast("task.created", …) called 8 times on first run (GSD-12)', async () => {
    seedProject(db, { id: 1 })
    await callPost('1')
    const taskCreatedCalls = broadcastMock.mock.calls.filter((c) => c[0] === 'task.created')
    expect(taskCreatedCalls).toHaveLength(8)
  })

  it('eventBus.broadcast NOT called for skipped tasks on re-run', async () => {
    seedProject(db, { id: 1 })
    await callPost('1')
    broadcastMock.mockClear()
    await callPost('1')
    const taskCreatedCalls = broadcastMock.mock.calls.filter((c) => c[0] === 'task.created')
    expect(taskCreatedCalls).toHaveLength(0)
  })

  it('db_helpers.logActivity called with type "project_gsd_bootstrap"', async () => {
    seedProject(db, { id: 1 })
    await callPost('1')
    expect(logActivityMock).toHaveBeenCalled()
    const call = logActivityMock.mock.calls.find((c) => c[0] === 'project_gsd_bootstrap')
    expect(call).toBeDefined()
    expect(call![1]).toBe('project')
    expect(call![2]).toBe(1)
  })
})
