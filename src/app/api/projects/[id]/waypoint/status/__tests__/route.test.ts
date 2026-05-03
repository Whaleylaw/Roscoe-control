import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'

let db: Database.Database
let authRole: 'admin' | 'operator' | 'viewer' = 'viewer'

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
      user: { id: 1, username: 'viewer', role: authRole, workspace_id: 1, tenant_id: 1 },
    }
  }),
}))

vi.mock('@/lib/workspaces', () => ({
  ensureTenantWorkspaceAccess: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {
    status = 403
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

function req(path: string) {
  return new NextRequest(`http://localhost${path}`)
}

function seedProject(input: { gsdEnabled: number }): number {
  const result = db.prepare(
    `INSERT INTO projects (
       workspace_id, name, slug, description, ticket_prefix, status,
       gsd_enabled, gsd_track, gsd_phase, gsd_gate_mode, gsd_project_id, gsd_updated_at,
       created_at, updated_at
     ) VALUES (
       1, 'Alpha', 'alpha', NULL, 'ALP', 'active',
       ?, 'product', 'plan', 'manual_approval', 'umbrella-1', unixepoch(),
       unixepoch(), unixepoch()
     )`,
  ).run(input.gsdEnabled)
  return Number(result.lastInsertRowid)
}

async function loadRoute() {
  return import('@/app/api/projects/[id]/waypoint/status/route')
}

beforeEach(() => {
  vi.resetModules()
  authRole = 'viewer'
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('GET /api/projects/:id/waypoint/status', () => {
  it('returns 409 when project lifecycle is not enabled', async () => {
    const projectId = seedProject({ gsdEnabled: 0 })

    const { GET } = await loadRoute()
    const res = await GET(req(`/api/projects/${projectId}/waypoint/status`), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'Waypoint lifecycle is not enabled for this project',
    })
  })

  it('returns waypoint status payload when lifecycle is enabled', async () => {
    const projectId = seedProject({ gsdEnabled: 1 })

    const { GET } = await loadRoute()
    const res = await GET(req(`/api/projects/${projectId}/waypoint/status`), {
      params: Promise.resolve({ id: String(projectId) }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.action).toBe('status')
    expect(body.status.project).toMatchObject({ id: projectId, waypoint_enabled: true })
    expect(Array.isArray(body.status.next_actions)).toBe(true)
    expect(body.summary).toMatchObject({
      total_routes: expect.any(Number),
      active_routes: expect.any(Number),
      blocked_routes: expect.any(Number),
      complete_routes: expect.any(Number),
      cancelled_routes: expect.any(Number),
      failed_routes: expect.any(Number),
      pending_gates: expect.any(Number),
      waiting_on_gate_tasks: expect.any(Number),
    })
  })
})
