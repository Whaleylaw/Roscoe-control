import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'

// Phase 19-01 / QUEUE-01 mandatory route-handler unit coverage.
//
// These tests exercise GET /api/tasks/queue directly against an in-memory
// better-sqlite3 DB. They close the coverage gap left by tests/task-queue.spec.ts —
// the Playwright harness cannot easily seed gsd_plans rows, which makes the
// wave-filter and cross-filter 400 Playwright tests skippable. This file makes
// those two behaviors mandatory (non-skippable) vitest assertions.

let db: Database.Database
let authRole: 'admin' | 'operator' | 'viewer' = 'operator'

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
      user: { id: 1, username: 'operator', role: authRole, workspace_id: 1, tenant_id: 1 },
    }
  }),
}))

vi.mock('@/lib/rate-limit', () => ({
  agentTaskLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

function req(url: string) {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' })
}

async function loadQueueRoute() {
  return import('@/app/api/tasks/queue/route')
}

// --- Fixture seeding helpers ------------------------------------------------

function seedProject(id: number, slug: string, prefix: string) {
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, slug, description, ticket_prefix, status, created_at, updated_at)
     VALUES (?, 1, ?, ?, NULL, ?, 'active', unixepoch(), unixepoch())`,
  ).run(id, `Project ${slug}`, slug, prefix)
}

function seedWorkstream(id: number, projectId: number) {
  db.prepare(
    `INSERT INTO gsd_workstreams (id, project_id, key, name, status, created_at, updated_at)
     VALUES (?, ?, 'core', 'Core', 'active', unixepoch(), unixepoch())`,
  ).run(id, projectId)
}

function seedMilestone(id: number, projectId: number, workstreamId: number) {
  db.prepare(
    `INSERT INTO gsd_milestones (id, project_id, workstream_id, version_label, title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'v1.0', 'Launch', 'active', unixepoch(), unixepoch())`,
  ).run(id, projectId, workstreamId)
}

function seedPhase(id: number, milestoneId: number, key: string, order: number) {
  db.prepare(
    `INSERT INTO gsd_phases (id, milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'execute', ?, 'active', '[]', unixepoch(), unixepoch())`,
  ).run(id, milestoneId, key, `phase-${key}`, order)
}

function seedPlan(id: number, phaseId: number, ref: string, wave: number) {
  db.prepare(
    `INSERT INTO gsd_plans (id, phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'in_progress', '[]', unixepoch(), unixepoch())`,
  ).run(id, phaseId, ref, `Plan ${ref}`, wave)
}

function seedTask(opts: {
  id: number
  projectId: number
  planId: number | null
  status: string
  priority?: string
  createdAt?: number
}) {
  const created = opts.createdAt ?? 1000 + opts.id
  db.prepare(
    `INSERT INTO tasks (id, title, status, priority, project_id, workspace_id, gsd_plan_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(
    opts.id,
    `task-${opts.id}`,
    opts.status,
    opts.priority ?? 'medium',
    opts.projectId,
    opts.planId,
    created,
    created,
  )
}

// --- Lifecycle --------------------------------------------------------------

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

// --- Tests ------------------------------------------------------------------

describe('Phase 19-01 GET /api/tasks/queue scoping', () => {
  it('applies wave filter against gsd_plans.wave', async () => {
    // Single project, two plans with different wave values, one task per plan.
    seedProject(10, 'alpha', 'ALP')
    seedWorkstream(100, 10)
    seedMilestone(1000, 10, 100)
    seedPhase(10_000, 1000, '20', 20)
    seedPlan(1, 10_000, '20-01', 1) // wave 1
    seedPlan(2, 10_000, '20-02', 2) // wave 2
    seedTask({ id: 501, projectId: 10, planId: 1, status: 'assigned', priority: 'medium' })
    seedTask({ id: 502, projectId: 10, planId: 2, status: 'assigned', priority: 'medium' })

    const { GET } = await loadQueueRoute()

    // wave=1 MUST return the task on plan 1 (wave=1), NEVER the task on plan 2.
    const resWave1 = await GET(req('/api/tasks/queue?agent=wave-unit-agent&wave=1'))
    expect(resWave1.status).toBe(200)
    const bodyWave1 = await resWave1.json()
    expect(bodyWave1.reason).toBe('assigned')
    expect(bodyWave1.task?.id).toBe(501)
    expect(bodyWave1.task?.gsd_plan_id).toBe(1)

    // Clean up: revert the claim so the next poll sees a fresh state and
    // re-seed task 502 as assigned (already is — wave=2 path).
    db.prepare(`UPDATE tasks SET status = 'assigned', assigned_to = NULL WHERE id = ?`).run(501)

    // wave=99 matches no plan → no tasks available.
    const resWave99 = await GET(req('/api/tasks/queue?agent=wave-unit-agent-2&wave=99'))
    expect(resWave99.status).toBe(200)
    const bodyWave99 = await resWave99.json()
    expect(bodyWave99.reason).toBe('no_tasks_available')
    expect(bodyWave99.task).toBeNull()

    // wave=2 MUST return the task on plan 2, NEVER the task on plan 1.
    const resWave2 = await GET(req('/api/tasks/queue?agent=wave-unit-agent-3&wave=2'))
    expect(resWave2.status).toBe(200)
    const bodyWave2 = await resWave2.json()
    expect(bodyWave2.reason).toBe('assigned')
    expect(bodyWave2.task?.id).toBe(502)
    expect(bodyWave2.task?.gsd_plan_id).toBe(2)
  })

  it('returns 400 when project_id and gsd_plan_id conflict', async () => {
    // Project A with plan pA1 (plan.project_id = A.id); project B (no plans).
    seedProject(10, 'alpha', 'ALP')
    seedProject(20, 'bravo', 'BRV')
    seedWorkstream(100, 10)
    seedMilestone(1000, 10, 100)
    seedPhase(10_000, 1000, '20', 20)
    seedPlan(7, 10_000, '20-01', 1) // plan 7 belongs to project 10

    const { GET } = await loadQueueRoute()

    // Cross-filter mismatch: plan 7 belongs to project 10 but caller passes project_id=20.
    const resMismatch = await GET(
      req('/api/tasks/queue?agent=x&project_id=20&gsd_plan_id=7'),
    )
    expect(resMismatch.status).toBe(400)
    const bodyMismatch = await resMismatch.json()
    expect(bodyMismatch.error).toMatch(/belongs to project/)
    // Must name BOTH ids so the caller can disambiguate.
    expect(bodyMismatch.error).toContain('7')
    expect(bodyMismatch.error).toContain('20')
    expect(bodyMismatch.error).toContain('10')

    // Matching project must NOT 400 — returns 200 (no tasks to claim in this
    // seed, but the point is: no cross-filter rejection).
    const resMatching = await GET(
      req('/api/tasks/queue?agent=x&project_id=10&gsd_plan_id=7'),
    )
    expect(resMatching.status).toBe(200)
  })

  it('returns 400 when gsd_plan_id does not exist and project_id is also provided', async () => {
    // Defense-in-depth for the cross-filter validation path: a non-existent plan
    // with a project_id filter is a 400, not a silent-empty 200.
    seedProject(10, 'alpha', 'ALP')

    const { GET } = await loadQueueRoute()
    const res = await GET(req('/api/tasks/queue?agent=x&project_id=10&gsd_plan_id=9999'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/gsd_plan_id 9999/)
    expect(body.error).toMatch(/not found/)
  })

  it('preserves unscoped v1.2 behavior when no scoping params are provided (COMPAT-01)', async () => {
    // Two projects, tasks with distinct priorities. Unscoped poll must still
    // claim a task — the new (? IS NULL OR ...) clauses must reduce to TRUE.
    seedProject(10, 'alpha', 'ALP')
    seedProject(20, 'bravo', 'BRV')
    seedTask({ id: 301, projectId: 10, planId: null, status: 'inbox', priority: 'low' })
    seedTask({ id: 302, projectId: 20, planId: null, status: 'inbox', priority: 'critical' })

    const { GET } = await loadQueueRoute()
    const res = await GET(req('/api/tasks/queue?agent=compat-unit-agent'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reason).toBe('assigned')
    // v1.2 priority ordering: critical beats low → task 302 is claimed first.
    expect(body.task?.id).toBe(302)
    expect(body.task?.status).toBe('in_progress')
  })
})
