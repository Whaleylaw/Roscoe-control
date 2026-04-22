import { expect, test } from '@playwright/test'
import { API_KEY_HEADER, createTestProject, createTestTask, deleteTestProject, deleteTestTask } from './helpers'

test.describe('Task Queue API', () => {
  const cleanup: number[] = []
  const cleanupProjects: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestTask(request, id).catch(() => {})
    }
    cleanup.length = 0

    for (const id of cleanupProjects) {
      await deleteTestProject(request, id).catch(() => {})
    }
    cleanupProjects.length = 0
  })

  test('picks the next task and marks it in_progress for agent', async ({ request }) => {
    const low = await createTestTask(request, { priority: 'low', status: 'inbox' })
    const critical = await createTestTask(request, { priority: 'critical', status: 'inbox' })
    cleanup.push(low.id, critical.id)

    const res = await request.get('/api/tasks/queue?agent=queue-agent', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body.reason).toBe('assigned')
    expect(body.task).toBeTruthy()
    expect(body.task.id).toBe(critical.id)
    expect(body.task.status).toBe('in_progress')
    expect(body.task.assigned_to).toBe('queue-agent')
  })

  test('returns current in_progress task as continue_current', async ({ request }) => {
    const task = await createTestTask(request, {
      status: 'in_progress',
      assigned_to: 'queue-agent-2',
      priority: 'high',
    })
    cleanup.push(task.id)

    const res = await request.get('/api/tasks/queue?agent=queue-agent-2', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.reason).toBe('continue_current')
    expect(body.task?.id).toBe(task.id)
  })

  test('validates max_capacity input', async ({ request }) => {
    const res = await request.get('/api/tasks/queue?agent=queue-agent-empty&max_capacity=999', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(400)
  })

  test('uses x-agent-name header when query param is omitted', async ({ request }) => {
    const task = await createTestTask(request, {
      status: 'assigned',
      assigned_to: 'header-agent',
      priority: 'high',
    })
    cleanup.push(task.id)

    const res = await request.get('/api/tasks/queue', {
      headers: { ...API_KEY_HEADER, 'x-agent-name': 'header-agent' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.reason).toBe('assigned')
    expect(body.agent).toBe('header-agent')
    expect(body.task?.id).toBe(task.id)
  })

  test('respects project_id queue scoping filter', async ({ request }) => {
    // E2E covers project_id scoping (which does not require a gsd_plans row).
    // Full gsd_plan_id + cross-filter coverage lives in the mandatory vitest
    // unit file src/app/api/tasks/__tests__/queue-route.test.ts, because the
    // Playwright harness cannot seed gsd_plans rows via REST helpers.
    const projectA = await createTestProject(request)
    const projectB = await createTestProject(request)
    cleanupProjects.push(projectA.id, projectB.id)

    const taskOtherProject = await createTestTask(request, {
      status: 'assigned',
      priority: 'critical',
      project_id: projectB.id,
    })
    const taskScopedA = await createTestTask(request, {
      status: 'assigned',
      priority: 'medium',
      project_id: projectA.id,
    })
    cleanup.push(taskOtherProject.id, taskScopedA.id)

    const res = await request.get(
      `/api/tasks/queue?agent=scoped-agent&project_id=${projectA.id}`,
      { headers: API_KEY_HEADER },
    )

    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.reason).toBe('assigned')
    // Project B's critical task does NOT leak into project A's scoped poll.
    expect(body.task?.id).toBe(taskScopedA.id)
    expect(body.task?.project_id).toBe(projectA.id)
  })

  test('preserves v1.2 behavior when no scoping params are provided (COMPAT-01)', async ({ request }) => {
    const projectA = await createTestProject(request)
    const projectB = await createTestProject(request)
    cleanupProjects.push(projectA.id, projectB.id)

    const lowA = await createTestTask(request, {
      status: 'inbox',
      priority: 'low',
      project_id: projectA.id,
    })
    const criticalB = await createTestTask(request, {
      status: 'inbox',
      priority: 'critical',
      project_id: projectB.id,
    })
    cleanup.push(lowA.id, criticalB.id)

    // No scoping params — unscoped poll must still claim a task. COMPAT-01.
    const res = await request.get('/api/tasks/queue?agent=compat-agent', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.reason).toBe('assigned')
    expect(body.task).toBeTruthy()
    // Existing v1.2 priority-then-created_at ordering still applies: critical > low.
    expect(body.task.status).toBe('in_progress')
    expect(body.task.assigned_to).toBe('compat-agent')
  })

  // Wave coverage mandatory in src/app/api/tasks/__tests__/queue-route.test.ts
  // (vitest with direct better-sqlite3 seeding of gsd_plans). The Playwright
  // harness has no REST path to seed gsd_plans rows without driving the full
  // phase → plan creation flow, which is out of scope for the queue spec.
  // TODO: Once a plan-create helper exists in tests/helpers.ts, this skip
  // can be lifted and the E2E can provide defense-in-depth coverage.
  test.skip('respects wave filter via gsd_plans.wave', async () => {
    // See src/app/api/tasks/__tests__/queue-route.test.ts for mandatory
    // route-handler coverage of the wave filter behavior.
  })

  // Cross-filter 400 mandatory in src/app/api/tasks/__tests__/queue-route.test.ts.
  // The Playwright harness cannot seed a gsd_plans row without the full phase
  // setup, so the 400 case — which depends on an existing plan row — is tested
  // at the vitest route-handler layer instead.
  // TODO: Once a plan-create helper exists in tests/helpers.ts, this skip
  // can be lifted.
  test.skip('400 on cross-filter project/plan mismatch', async () => {
    // See src/app/api/tasks/__tests__/queue-route.test.ts for mandatory
    // route-handler coverage of the project_id/gsd_plan_id cross-filter 400.
  })

  test('capacity check is scoped per filter set', async ({ request }) => {
    // No capacity leak across scopes: an in_progress task for capacity-agent in
    // project A must not consume capacity for a scoped poll against project B.
    const projectA = await createTestProject(request)
    const projectB = await createTestProject(request)
    cleanupProjects.push(projectA.id, projectB.id)

    const existingInProgressA = await createTestTask(request, {
      status: 'in_progress',
      assigned_to: 'capacity-agent',
      priority: 'medium',
      project_id: projectA.id,
    })
    const pollableB = await createTestTask(request, {
      status: 'assigned',
      priority: 'high',
      project_id: projectB.id,
    })
    cleanup.push(existingInProgressA.id, pollableB.id)

    const res = await request.get(
      `/api/tasks/queue?agent=capacity-agent&project_id=${projectB.id}&max_capacity=1`,
      { headers: API_KEY_HEADER },
    )
    expect(res.status()).toBe(200)
    const body = await res.json()
    // The project-A in-progress task does NOT consume project-B capacity. The
    // endpoint either claims the project-B task (reason='assigned') or returns
    // no_tasks_available if no project-B task matches — never at_capacity.
    expect(body.reason).not.toBe('at_capacity')
  })
})
