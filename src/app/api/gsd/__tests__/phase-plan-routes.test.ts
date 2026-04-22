import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'

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

vi.mock('@/lib/workspaces', () => ({
  ensureTenantWorkspaceAccess: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {
    status = 403
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function seedProject() {
  db.prepare(
    `INSERT INTO projects (workspace_id, name, slug, description, ticket_prefix, status, created_at, updated_at)
     VALUES (1, 'Alpha', 'alpha', NULL, 'ALP', 'active', unixepoch(), unixepoch())`,
  ).run()
}

function seedWorkstream() {
  db.prepare(
    `INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
     VALUES (1, 'core', 'Core', 'active', unixepoch(), unixepoch())`,
  ).run()
}

function seedMilestone() {
  db.prepare(
    `INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at)
     VALUES (1, 1, 'v1.2', 'Launch', 'active', unixepoch(), unixepoch())`,
  ).run()
}

async function loadPhaseCollection() {
  return import('@/app/api/gsd/milestones/[milestone_id]/phases/route')
}

async function loadPhaseDetail() {
  return import('@/app/api/gsd/phases/[phase_id]/route')
}

async function loadPhaseTransition() {
  return import('@/app/api/gsd/phases/[phase_id]/transition/route')
}

async function loadPlanCollection() {
  return import('@/app/api/gsd/phases/[phase_id]/plans/route')
}

async function loadPlanDetail() {
  return import('@/app/api/gsd/plans/[plan_id]/route')
}

async function loadPlanTransition() {
  return import('@/app/api/gsd/plans/[plan_id]/transition/route')
}

beforeEach(() => {
  vi.resetModules()
  authRole = 'operator'
  db = new Database(':memory:')
  runMigrations(db)
  seedProject()
  seedWorkstream()
  seedMilestone()
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('Phase 10 phase/plan routes', () => {
  it('POST /api/gsd/milestones/:id/phases creates a phase', async () => {
    const { POST } = await loadPhaseCollection()
    const res = await POST(
      req('/api/gsd/milestones/1/phases', 'POST', {
        phase_key: '10',
        phase_slug: 'phase-10',
        ordering_numeric: 10,
        depends_on_phase_ids: [],
      }),
      { params: Promise.resolve({ milestone_id: '1' }) },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.phase.phase_key).toBe('10')
    expect(body.phase.lifecycle_phase).toBe('discuss')
  })

  it('POST /api/gsd/milestones/:id/phases replays identical creates', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'discuss', 10, 'planned', '[]', unixepoch(), unixepoch())`,
    ).run()

    const { POST } = await loadPhaseCollection()
    const res = await POST(
      req('/api/gsd/milestones/1/phases', 'POST', {
        phase_key: '10',
        phase_slug: 'phase-10',
        ordering_numeric: 10,
        depends_on_phase_ids: [],
      }),
      { params: Promise.resolve({ milestone_id: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.idempotent_replay).toBe(true)
    expect(body.phase.id).toBe(1)
  })

  it('POST /api/gsd/milestones/:id/phases rejects invalid dependency ids', async () => {
    const { POST } = await loadPhaseCollection()
    const res = await POST(
      req('/api/gsd/milestones/1/phases', 'POST', {
        phase_key: '10',
        phase_slug: 'phase-10',
        ordering_numeric: 10,
        depends_on_phase_ids: [999],
      }),
      { params: Promise.resolve({ milestone_id: '1' }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_DEPENDENCIES')
  })

  it('PATCH /api/gsd/phases/:id updates dependencies with optimistic locking', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'discuss', 10, 'planned', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10.1', 'phase-10-1', 'discuss', 10.1, 'planned', '[]', unixepoch(), unixepoch())`,
    ).run()
    const current = db.prepare(`SELECT updated_at FROM gsd_phases WHERE id = 2`).get() as { updated_at: number }

    const { PATCH } = await loadPhaseDetail()
    const res = await PATCH(
      req('/api/gsd/phases/2', 'PATCH', {
        depends_on_phase_ids: [1],
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ phase_id: '2' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.phase.depends_on_phase_ids).toBe('[1]')
  })

  it('POST /api/gsd/phases/:id/transition blocks on earlier incomplete phases', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'done', 10, 'complete', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10.1', 'phase-10-1', 'discuss', 10.1, 'planned', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '11', 'phase-11', 'discuss', 11, 'planned', '[]', unixepoch(), unixepoch())`,
    ).run()
    const current = db.prepare(`SELECT updated_at FROM gsd_phases WHERE id = 3`).get() as { updated_at: number }

    const { POST } = await loadPhaseTransition()
    const res = await POST(
      req('/api/gsd/phases/3/transition', 'POST', {
        to_lifecycle_phase: 'plan',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ phase_id: '3' }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('PHASE_ORDER_BLOCKED')
    expect(body.blocking_phase_ids).toEqual([2])
  })

  it('POST /api/gsd/phases/:id/transition advances legally and flips planned -> active', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'discuss', 10, 'planned', '[]', unixepoch(), unixepoch())`,
    ).run()
    const current = db.prepare(`SELECT updated_at FROM gsd_phases WHERE id = 1`).get() as { updated_at: number }

    const { POST } = await loadPhaseTransition()
    const res = await POST(
      req('/api/gsd/phases/1/transition', 'POST', {
        to_lifecycle_phase: 'plan',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ phase_id: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.phase.lifecycle_phase).toBe('plan')
    expect(body.phase.status).toBe('active')
  })

  it('POST /api/gsd/phases/:id/transition blocks on unresolved gate tasks linked to the phase', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'discuss', 10, 'planned', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO tasks (project_id, title, status, priority, gate_required, gate_status, gsd_phase_id, created_at, updated_at)
       VALUES (1, 'Approval package', 'review', 'high', 1, 'pending', 1, unixepoch(), unixepoch())`,
    ).run()
    const current = db.prepare(`SELECT updated_at FROM gsd_phases WHERE id = 1`).get() as { updated_at: number }

    const { POST } = await loadPhaseTransition()
    const res = await POST(
      req('/api/gsd/phases/1/transition', 'POST', {
        to_lifecycle_phase: 'plan',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ phase_id: '1' }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('GATE_BLOCKED')
    expect(body.blocking_task_ids).toEqual([1])
  })

  it('POST /api/gsd/phases/:id/plans creates a plan', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'plan', 10, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()

    const { POST } = await loadPlanCollection()
    const res = await POST(
      req('/api/gsd/phases/1/plans', 'POST', {
        plan_ref: '10-01',
        title: 'Foundation',
        depends_on_plan_ids: [],
      }),
      { params: Promise.resolve({ phase_id: '1' }) },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.plan.plan_ref).toBe('10-01')
    expect(body.plan.status).toBe('todo')
  })

  it('POST /api/gsd/phases/:id/plans replays identical creates', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'plan', 10, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-01', 'Foundation', 1, 'todo', '[]', unixepoch(), unixepoch())`,
    ).run()

    const { POST } = await loadPlanCollection()
    const res = await POST(
      req('/api/gsd/phases/1/plans', 'POST', {
        plan_ref: '10-01',
        title: 'Foundation',
        depends_on_plan_ids: [],
      }),
      { params: Promise.resolve({ phase_id: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.idempotent_replay).toBe(true)
    expect(body.plan.id).toBe(1)
  })

  it('PATCH /api/gsd/plans/:id updates dependency ids with optimistic locking', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'plan', 10, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-01', 'Foundation', 1, 'done', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-02', 'Service', 1, 'todo', '[]', unixepoch(), unixepoch())`,
    ).run()
    const current = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 2`).get() as { updated_at: number }

    const { PATCH } = await loadPlanDetail()
    const res = await PATCH(
      req('/api/gsd/plans/2', 'PATCH', {
        depends_on_plan_ids: [1],
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '2' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.plan.depends_on_plan_ids).toBe('[1]')
  })

  it('POST /api/gsd/plans/:id/transition blocks when dependent plans are not done', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'plan', 10, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-01', 'Foundation', 1, 'review', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-02', 'Service', 1, 'todo', '[1]', unixepoch(), unixepoch())`,
    ).run()
    const current = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 2`).get() as { updated_at: number }

    const { POST } = await loadPlanTransition()
    const res = await POST(
      req('/api/gsd/plans/2/transition', 'POST', {
        to_status: 'in_progress',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '2' }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('PLAN_DEPENDENCY_BLOCKED')
    expect(body.blocking_plan_ids).toEqual([1])
  })

  it('POST /api/gsd/plans/:id/transition blocks on same-wave resource conflicts', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'execute', 10, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-01', 'Foundation', 1, 'in_progress', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-02', 'UI', 1, 'todo', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, metadata, created_at, updated_at)
       VALUES ('Foundation task', 'in_progress', 'medium', 1, 1, 1, ?, unixepoch(), unixepoch())`,
    ).run(
      JSON.stringify({
        implementation_repo: 'builderz-labs/mission-control',
        code_location: 'src/components/project/lifecycle',
      }),
    )
    db.prepare(
      `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, metadata, created_at, updated_at)
       VALUES ('UI task', 'inbox', 'medium', 1, 1, 2, ?, unixepoch(), unixepoch())`,
    ).run(
      JSON.stringify({
        implementation_repo: 'builderz-labs/mission-control',
        touched_files: ['src/components/project/lifecycle/lifecycle-view.tsx'],
      }),
    )
    const current = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 2`).get() as { updated_at: number }

    const { POST } = await loadPlanTransition()
    const res = await POST(
      req('/api/gsd/plans/2/transition', 'POST', {
        to_status: 'in_progress',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '2' }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('WAVE_CONFLICT_BLOCKED')
    expect(body.blocking_plan_ids).toEqual([1])
    expect(body.conflicting_paths).toEqual(['src/components/project/lifecycle'])
  })

  it('POST /api/gsd/plans/:id/transition blocks on unresolved gate tasks linked to the plan', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'plan', 10, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-01', 'Foundation', 1, 'todo', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO tasks (project_id, title, status, priority, gate_required, gate_status, gsd_plan_id, created_at, updated_at)
       VALUES (1, 'Gate review', 'review', 'high', 1, 'pending', 1, unixepoch(), unixepoch())`,
    ).run()

    const { POST } = await loadPlanTransition()
    const res = await POST(
      req('/api/gsd/plans/1/transition', 'POST', { to_status: 'in_progress' }),
      { params: Promise.resolve({ plan_id: '1' }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('GATE_BLOCKED')
    expect(body.blocking_task_ids).toEqual([1])
  })

  it('POST /api/gsd/plans/:id/transition advances legally after dependencies are done', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '10', 'phase-10', 'plan', 10, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-01', 'Foundation', 1, 'done', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '10-02', 'Service', 1, 'todo', '[1]', unixepoch(), unixepoch())`,
    ).run()
    const current = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 2`).get() as { updated_at: number }

    const { POST } = await loadPlanTransition()
    const res = await POST(
      req('/api/gsd/plans/2/transition', 'POST', {
        to_status: 'in_progress',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '2' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.plan.status).toBe('in_progress')
  })

  it('POST /api/gsd/plans/:id/transition activates only backlog/todo-sourced tasks; skips awaiting_owner/review/in_progress/failed', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '20', 'phase-20', 'execute', 20, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '20-01', 'Execution', 1, 'todo', '[]', unixepoch(), unixepoch())`,
    ).run()

    const statuses: Array<{ title: string; status: string }> = [
      { title: 'Backlog task', status: 'backlog' },
      { title: 'Todo task', status: 'todo' },
      { title: 'Awaiting owner task', status: 'awaiting_owner' },
      { title: 'Review task', status: 'review' },
      { title: 'In progress task', status: 'in_progress' },
      { title: 'Failed task', status: 'failed' },
    ]
    for (const row of statuses) {
      db.prepare(
        `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, created_at, updated_at)
         VALUES (?, ?, 'medium', 1, 1, 1, unixepoch(), unixepoch())`,
      ).run(row.title, row.status)
    }

    const current = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 1`).get() as { updated_at: number }

    const { POST } = await loadPlanTransition()
    const res = await POST(
      req('/api/gsd/plans/1/transition', 'POST', {
        to_status: 'in_progress',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '1' }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.plan.status).toBe('in_progress')
    expect(body.queue_activation.activated).toBe(2)
    expect(body.queue_activation.skipped_by_state).toBe(4)
    expect(body.queue_activation.already_active).toBe(0)
    expect(body.queue_activation.reassigned).toBe(0)

    const backlogRow = db.prepare(`SELECT id FROM tasks WHERE title = 'Backlog task'`).get() as { id: number }
    const todoRow = db.prepare(`SELECT id FROM tasks WHERE title = 'Todo task'`).get() as { id: number }
    expect(body.queue_activation.task_ids.sort()).toEqual([backlogRow.id, todoRow.id].sort())

    const allRows = db.prepare(
      `SELECT title, status FROM tasks WHERE gsd_plan_id = 1 ORDER BY id ASC`,
    ).all() as Array<{ title: string; status: string }>
    const byTitle = new Map(allRows.map((r) => [r.title, r.status]))
    expect(byTitle.get('Backlog task')).toBe('inbox')
    expect(byTitle.get('Todo task')).toBe('inbox')
    expect(byTitle.get('Awaiting owner task')).toBe('awaiting_owner')
    expect(byTitle.get('Review task')).toBe('review')
    expect(byTitle.get('In progress task')).toBe('in_progress')
    expect(byTitle.get('Failed task')).toBe('failed')
  })

  it("POST /api/gsd/plans/:id/transition routes assigned_to tasks to 'assigned', recipe-tagged tasks to 'assigned' without assignee, unassigned to 'inbox'", async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '20', 'phase-20', 'execute', 20, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '20-01', 'Execution', 1, 'todo', '[]', unixepoch(), unixepoch())`,
    ).run()
    // Seed agent 'claude-A' in idle state so the dead-assignee check does NOT fire.
    db.prepare(
      `INSERT INTO agents (name, role, status, workspace_id, created_at, updated_at)
       VALUES ('claude-A', 'developer', 'idle', 1, unixepoch(), unixepoch())`,
    ).run()

    db.prepare(
      `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, assigned_to, created_at, updated_at)
       VALUES ('Assigned task', 'backlog', 'medium', 1, 1, 1, 'claude-A', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, recipe_slug, created_at, updated_at)
       VALUES ('Recipe task', 'backlog', 'medium', 1, 1, 1, 'generic-agent', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, created_at, updated_at)
       VALUES ('Unassigned task', 'backlog', 'medium', 1, 1, 1, unixepoch(), unixepoch())`,
    ).run()

    const current = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 1`).get() as { updated_at: number }

    const { POST } = await loadPlanTransition()
    const res = await POST(
      req('/api/gsd/plans/1/transition', 'POST', {
        to_status: 'in_progress',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '1' }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.queue_activation.activated).toBe(3)
    expect(body.queue_activation.by_status).toEqual({ inbox: 1, assigned: 2 })
    expect(body.queue_activation.reassigned).toBe(0)

    const assigned = db.prepare(`SELECT status, assigned_to FROM tasks WHERE title = 'Assigned task'`).get() as {
      status: string
      assigned_to: string | null
    }
    expect(assigned.status).toBe('assigned')
    expect(assigned.assigned_to).toBe('claude-A')

    const recipe = db.prepare(`SELECT status, assigned_to FROM tasks WHERE title = 'Recipe task'`).get() as {
      status: string
      assigned_to: string | null
    }
    expect(recipe.status).toBe('assigned')
    expect(recipe.assigned_to).toBeNull()

    const unassigned = db.prepare(`SELECT status, assigned_to FROM tasks WHERE title = 'Unassigned task'`).get() as {
      status: string
      assigned_to: string | null
    }
    expect(unassigned.status).toBe('inbox')
    expect(unassigned.assigned_to).toBeNull()
  })

  it('POST /api/gsd/plans/:id/transition counts already-inbox/assigned tasks as already_active without re-updating', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '20', 'phase-20', 'execute', 20, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '20-01', 'Execution', 1, 'todo', '[]', unixepoch(), unixepoch())`,
    ).run()

    // Seed two already-active tasks with an explicit updated_at in the past so the
    // idempotent "do nothing" path leaves the timestamp unchanged.
    const pastTs = 1700000000
    db.prepare(
      `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, created_at, updated_at)
       VALUES ('Backlog task', 'backlog', 'medium', 1, 1, 1, unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, created_at, updated_at)
       VALUES ('Inbox task', 'inbox', 'medium', 1, 1, 1, ?, ?)`,
    ).run(pastTs, pastTs)
    db.prepare(
      `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, created_at, updated_at)
       VALUES ('Assigned task', 'assigned', 'medium', 1, 1, 1, ?, ?)`,
    ).run(pastTs, pastTs)

    const current = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 1`).get() as { updated_at: number }

    const { POST } = await loadPlanTransition()
    const res = await POST(
      req('/api/gsd/plans/1/transition', 'POST', {
        to_status: 'in_progress',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '1' }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.queue_activation.activated).toBe(1)
    expect(body.queue_activation.already_active).toBe(2)
    expect(body.queue_activation.skipped_by_state).toBe(0)

    const inboxUpdatedAt = db.prepare(`SELECT updated_at FROM tasks WHERE title = 'Inbox task'`).get() as {
      updated_at: number
    }
    const assignedUpdatedAt = db.prepare(`SELECT updated_at FROM tasks WHERE title = 'Assigned task'`).get() as {
      updated_at: number
    }
    expect(inboxUpdatedAt.updated_at).toBe(pastTs)
    expect(assignedUpdatedAt.updated_at).toBe(pastTs)
  })

  it('POST /api/gsd/plans/:id/transition is idempotent on re-entry (in_progress -> review -> in_progress activates zero new tasks)', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '20', 'phase-20', 'execute', 20, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '20-01', 'Execution', 1, 'todo', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, created_at, updated_at)
       VALUES ('Backlog task', 'backlog', 'medium', 1, 1, 1, unixepoch(), unixepoch())`,
    ).run()

    const { POST } = await loadPlanTransition()

    // Transition 1: todo -> in_progress (should activate the one backlog task).
    const firstLock = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 1`).get() as { updated_at: number }
    const firstRes = await POST(
      req('/api/gsd/plans/1/transition', 'POST', {
        to_status: 'in_progress',
        expected_updated_at: firstLock.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '1' }) },
    )
    expect(firstRes.status).toBe(200)
    const firstBody = await firstRes.json()
    expect(firstBody.queue_activation.activated).toBe(1)

    // Transition 2: in_progress -> review (valid per NEXT_GSD_PLAN_STATUSES).
    const secondLock = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 1`).get() as { updated_at: number }
    const secondRes = await POST(
      req('/api/gsd/plans/1/transition', 'POST', {
        to_status: 'review',
        expected_updated_at: secondLock.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '1' }) },
    )
    expect(secondRes.status).toBe(200)
    const secondBody = await secondRes.json()
    expect(secondBody.queue_activation).toBeNull()

    // Transition 3: review -> in_progress. The task is already inbox, so activated=0, already_active=1.
    const thirdLock = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 1`).get() as { updated_at: number }
    const thirdRes = await POST(
      req('/api/gsd/plans/1/transition', 'POST', {
        to_status: 'in_progress',
        expected_updated_at: thirdLock.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '1' }) },
    )
    expect(thirdRes.status).toBe(200)
    const thirdBody = await thirdRes.json()
    expect(thirdBody.queue_activation.activated).toBe(0)
    expect(thirdBody.queue_activation.already_active).toBe(1)

    const finalTask = db.prepare(`SELECT status FROM tasks WHERE title = 'Backlog task'`).get() as { status: string }
    expect(finalTask.status).toBe('inbox')
  })

  it('POST /api/gsd/plans/:id/transition gate-blocked transition performs NO activation', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '20', 'phase-20', 'execute', 20, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '20-01', 'Execution', 1, 'todo', '[]', unixepoch(), unixepoch())`,
    ).run()
    // Undone gate task linked to the plan — triggers GATE_BLOCKED pre-write guard.
    db.prepare(
      `INSERT INTO tasks (project_id, workspace_id, title, status, priority, gate_required, gate_status, gsd_plan_id, created_at, updated_at)
       VALUES (1, 1, 'Gate review', 'review', 'high', 1, 'pending', 1, unixepoch(), unixepoch())`,
    ).run()
    // Activation-eligible backlog task linked to same plan — MUST remain backlog if the guard fires.
    db.prepare(
      `INSERT INTO tasks (project_id, workspace_id, title, status, priority, gsd_plan_id, created_at, updated_at)
       VALUES (1, 1, 'Backlog task', 'backlog', 'medium', 1, unixepoch(), unixepoch())`,
    ).run()

    const { POST } = await loadPlanTransition()
    const res = await POST(
      req('/api/gsd/plans/1/transition', 'POST', { to_status: 'in_progress' }),
      { params: Promise.resolve({ plan_id: '1' }) },
    )

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('GATE_BLOCKED')

    // Plan status unchanged.
    const planAfter = db.prepare(`SELECT status FROM gsd_plans WHERE id = 1`).get() as { status: string }
    expect(planAfter.status).toBe('todo')

    // Backlog task unchanged.
    const backlogAfter = db.prepare(`SELECT status FROM tasks WHERE title = 'Backlog task'`).get() as {
      status: string
    }
    expect(backlogAfter.status).toBe('backlog')
  })

  it('POST /api/gsd/plans/:id/transition emits gsd.plan.tasks_activated event with full queue_activation payload', async () => {
    const { eventBus } = await import('@/lib/event-bus')
    const broadcastSpy = vi.spyOn(eventBus, 'broadcast')

    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '20', 'phase-20', 'execute', 20, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '20-01', 'Execution', 1, 'todo', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, created_at, updated_at)
       VALUES ('Backlog task', 'backlog', 'medium', 1, 1, 1, unixepoch(), unixepoch())`,
    ).run()

    const current = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 1`).get() as { updated_at: number }

    const { POST } = await loadPlanTransition()
    const res = await POST(
      req('/api/gsd/plans/1/transition', 'POST', {
        to_status: 'in_progress',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '1' }) },
    )
    expect(res.status).toBe(200)

    const backlogTask = db.prepare(`SELECT id FROM tasks WHERE title = 'Backlog task'`).get() as { id: number }

    const activationCalls = broadcastSpy.mock.calls.filter((call) => call[0] === 'gsd.plan.tasks_activated')
    expect(activationCalls.length).toBe(1)
    const payload = activationCalls[0][1] as {
      plan_id: number
      queue_activation: {
        activated: number
        already_active: number
        skipped_by_state: number
        reassigned: number
        by_status: { inbox: number; assigned: number }
        task_ids: number[]
      }
    }
    expect(payload.plan_id).toBe(1)
    expect(payload.queue_activation).toEqual({
      activated: 1,
      already_active: 0,
      skipped_by_state: 0,
      reassigned: 0,
      by_status: { inbox: 1, assigned: 0 },
      task_ids: [backlogTask.id],
    })

    broadcastSpy.mockRestore()
  })

  it('POST /api/gsd/plans/:id/transition returns queue_activation: null for non-in_progress transitions', async () => {
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at)
       VALUES (1, '20', 'phase-20', 'execute', 20, 'active', '[]', unixepoch(), unixepoch())`,
    ).run()
    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at)
       VALUES (1, '20-01', 'Execution', 1, 'in_progress', '[]', unixepoch(), unixepoch())`,
    ).run()
    // Seed a backlog task linked to the plan — it would be eligible IF this were a transition TO in_progress,
    // but because we're going in_progress -> done the activation path MUST NOT run.
    db.prepare(
      `INSERT INTO tasks (title, status, priority, project_id, workspace_id, gsd_plan_id, created_at, updated_at)
       VALUES ('Backlog task', 'backlog', 'medium', 1, 1, 1, unixepoch(), unixepoch())`,
    ).run()

    const current = db.prepare(`SELECT updated_at FROM gsd_plans WHERE id = 1`).get() as { updated_at: number }

    const { POST } = await loadPlanTransition()
    const res = await POST(
      req('/api/gsd/plans/1/transition', 'POST', {
        to_status: 'done',
        expected_updated_at: current.updated_at,
      }),
      { params: Promise.resolve({ plan_id: '1' }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.plan.status).toBe('done')
    expect(body.queue_activation).toBeNull()

    // Backlog task UNCHANGED.
    const backlogAfter = db.prepare(`SELECT status FROM tasks WHERE title = 'Backlog task'`).get() as {
      status: string
    }
    expect(backlogAfter.status).toBe('backlog')
  })
})
