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

function seedProject() {
  db.prepare(
    `INSERT INTO projects (
       workspace_id, name, slug, description, ticket_prefix, status,
       gsd_enabled, gsd_track, gsd_phase, gsd_gate_mode, gsd_project_id, gsd_updated_at,
       created_at, updated_at
     ) VALUES (
       1, 'Alpha', 'alpha', NULL, 'ALP', 'active',
       1, 'product', 'plan', 'manual_approval', 'umbrella-1', unixepoch(),
       unixepoch(), unixepoch()
     )`,
  ).run()
}

async function loadRoute() {
  return import('@/app/api/projects/[id]/gsd/lifecycle-graph/route')
}

beforeEach(() => {
  vi.resetModules()
  authRole = 'viewer'
  db = new Database(':memory:')
  runMigrations(db)
  seedProject()
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('GET /api/projects/:id/gsd/lifecycle-graph', () => {
  it('returns nested workstream -> milestone -> phase -> plan graph with rollups', async () => {
    db.prepare(
      `INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
       VALUES (1, 'core', 'Core', 'active', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at)
       VALUES (1, 1, 'v1.2', 'Launch', 'active', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'plan', 10, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-01', 'Foundation', 1, 'in_progress', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-02', 'UI', 1, 'review', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO tasks (title, description, status, priority, project_id, gate_required, gate_status, gsd_phase, created_at, updated_at)
       VALUES ('Gate task', 'd', 'review', 'medium', 1, 1, 'pending', 'plan', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO tasks (title, description, status, priority, project_id, gsd_plan_id, metadata, created_at, updated_at)
       VALUES ('Plan 1', 'd', 'in_progress', 'medium', 1, 1, ?, unixepoch(), unixepoch())`,
    ).run(JSON.stringify({
      implementation_repo: 'builderz-labs/mission-control',
      code_location: 'src/components/project/lifecycle',
    }))
    db.prepare(
      `INSERT INTO tasks (title, description, status, priority, project_id, gsd_plan_id, metadata, created_at, updated_at)
       VALUES ('Plan 2', 'd', 'review', 'medium', 1, 2, ?, unixepoch(), unixepoch())`,
    ).run(JSON.stringify({
      implementation_repo: 'builderz-labs/mission-control',
      touched_files: ['src/components/project/lifecycle/lifecycle-view.tsx'],
    }))

    const { GET } = await loadRoute()
    const res = await GET(req('/api/projects/1/gsd/lifecycle-graph'), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.rollups.active_workstreams).toBe(1)
    expect(body.rollups.active_milestones).toBe(1)
    expect(body.rollups.active_phases).toBe(1)
    expect(body.rollups.in_progress_plans).toBe(1)
    expect(body.rollups.blocked_gates).toBe(1)
    expect(body.rollups.wave_conflicts).toBe(1)

    expect(body.workstreams).toHaveLength(1)
    expect(body.workstreams[0].milestones).toHaveLength(1)
    expect(body.workstreams[0].milestones[0].phases).toHaveLength(1)
    expect(body.workstreams[0].milestones[0].phases[0].plans).toHaveLength(2)
    expect(body.legacy.fallback_active).toBe(false)
  })

  it('returns legacy fallback when no Phase 10 hierarchy exists yet', async () => {
    db.prepare(
      `INSERT INTO tasks (title, description, status, priority, project_id, gate_required, gate_status, gsd_phase, created_at, updated_at)
       VALUES ('Legacy discuss', 'd', 'done', 'medium', 1, 0, 'not_required', 'discuss', unixepoch(), unixepoch())`,
    ).run()

    const { GET } = await loadRoute()
    const res = await GET(req('/api/projects/1/gsd/lifecycle-graph'), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.workstreams).toHaveLength(0)
    expect(body.unscopedMilestones).toHaveLength(0)
    expect(body.legacy.enabled).toBe(true)
    expect(typeof body.legacy.current_phase).toBe('string')
    expect(body.legacy.fallback_active).toBe(true)
    expect(body.legacy.task_counts[0]).toEqual({ phase: 'discuss', count: 1 })
  })

  it('does not force legacy fallback for a freshly enabled project with no legacy tasks', async () => {
    db.prepare(`DELETE FROM tasks WHERE project_id = 1`).run()

    const { GET } = await loadRoute()
    const res = await GET(req('/api/projects/1/gsd/lifecycle-graph'), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.workstreams).toHaveLength(0)
    expect(body.unscopedMilestones).toHaveLength(0)
    expect(body.legacy.enabled).toBe(false)
    expect(body.legacy.fallback_active).toBe(false)
  })
})
