import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { API_KEY_HEADER, createTestProject, deleteTestProject, createTestTask, deleteTestTask } from './helpers'

/**
 * E2E — Project workspace tasks view (Phase 04, Plan 01).
 *
 * Verifies TASK-02 (create-in-workspace pre-scopes project_id) and
 * TASK-03 (reassign via EditTaskModal uses PUT, reassigned-out task
 * disappears) end-to-end against a live dev server.
 *
 * Pitfall #1: API uses `{ method: 'PUT' }`, NOT PATCH — every
 * assertion below confirms the literal 'PUT' for /api/tasks/[id].
 */

const TEST_API_KEY = process.env.API_KEY || 'test-api-key-e2e-12345'
const TEST_PASS = 'testpass1234!'

async function ensureUser(request: APIRequestContext, username: string) {
  const res = await request.post('/api/auth/users', {
    headers: { 'x-api-key': TEST_API_KEY },
    data: { username, password: TEST_PASS, display_name: username, role: 'admin' },
  })
  expect([201, 409]).toContain(res.status())
}

// Each test in this spec calls loginAndAttachCookie once, and the spec
// has >5 tests. The loginLimiter is keyed by client IP (5/min window), so
// using a single x-real-ip for all tests exhausts the bucket partway
// through the run. Bump a counter per call so each test gets its own
// bucket.
let _loginIpCounter = 0
async function loginAndAttachCookie(page: Page, request: APIRequestContext, username: string) {
  _loginIpCounter += 1
  // Suppress the onboarding wizard — it covers the workspace UI for
  // first-time admins and is not under test here. Same pattern as
  // tests/projects-entry-point.spec.ts.
  await page.context().addInitScript(() => {
    try {
      window.sessionStorage.setItem('mc-onboarding-dismissed', '1')
    } catch {
      /* ignore */
    }
  })
  const res = await request.post('/api/auth/login', {
    data: { username, password: TEST_PASS },
    headers: { 'x-real-ip': `10.99.98.${_loginIpCounter}` },
  })
  expect(res.status()).toBe(200)
  const setCookie = res.headers()['set-cookie'] || ''
  const match = setCookie.match(/(?:__Host-)?mc-session=([^;]+)/)
  expect(match).toBeTruthy()
  const cookieValue = match![1]
  const cookieName = setCookie.includes('__Host-mc-session') ? '__Host-mc-session' : 'mc-session'
  const url = new URL(page.url() === 'about:blank' ? 'http://127.0.0.1:3005/' : page.url())
  await page.context().addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: cookieName === '__Host-mc-session',
      sameSite: 'Lax',
    },
  ])
}

test.describe('Project workspace tasks — E2E', () => {
  const cleanupProjects: number[] = []
  const cleanupTasks: number[] = []
  let username: string
  let primaryProject: { id: number; slug: string; ticket_prefix: string; name: string }
  let secondaryProject: { id: number; slug: string; ticket_prefix: string; name: string }

  test.beforeAll(async ({ request }) => {
    username = `proj-tasks-e2e-${Date.now()}`
    await ensureUser(request, username)
  })

  test.beforeEach(async ({ request }) => {
    const a = await createTestProject(request)
    cleanupProjects.push(a.id)
    primaryProject = { id: a.id, slug: a.body.project.slug, ticket_prefix: a.body.project.ticket_prefix, name: a.name }

    const b = await createTestProject(request)
    cleanupProjects.push(b.id)
    secondaryProject = { id: b.id, slug: b.body.project.slug, ticket_prefix: b.body.project.ticket_prefix, name: b.name }
  })

  test.afterEach(async ({ request }) => {
    for (const id of cleanupTasks.splice(0)) {
      await deleteTestTask(request, id).catch(() => {})
    }
    for (const id of cleanupProjects.splice(0)) {
      await deleteTestProject(request, id).catch(() => {})
    }
  })

  // ─── TASK-02 ───────────────────────────────────────────────────────

  test.describe('TASK-02: creating a task from within the workspace pre-scopes it', () => {
    test('open CreateTaskModal inside workspace — project dropdown defaults to the current project', async ({ page, request }) => {
      await loginAndAttachCookie(page, request, username)
      await page.goto(`/project/${primaryProject.slug}/tasks`)

      // Click "New Task" — the i18n key resolves to the literal "New Task".
      await page.getByRole('button', { name: /new task/i }).click()
      const projectSelect = page.locator('#create-project')
      await expect(projectSelect).toBeVisible()
      await expect(projectSelect).toHaveValue(String(primaryProject.id))
    })

    test('submit CreateTaskModal — POST /api/tasks payload includes the current project_id', async ({ page, request }) => {
      await loginAndAttachCookie(page, request, username)

      let capturedBody: any = null
      await page.route('**/api/tasks', async (route) => {
        const req = route.request()
        if (req.method() === 'POST') {
          capturedBody = JSON.parse(req.postData() || '{}')
        }
        await route.continue()
      })

      await page.goto(`/project/${primaryProject.slug}/tasks`)
      await page.getByRole('button', { name: /new task/i }).click()
      const title = `e2e-workspace-create-${Date.now()}`
      await page.locator('#create-title').fill(title)
      await page.getByRole('button', { name: /^create$/i }).click()

      await expect.poll(() => capturedBody?.project_id).toBe(primaryProject.id)
      expect(capturedBody.title).toBe(title)

      // Cleanup: find the task we just created
      const list = await request.get('/api/tasks', { headers: API_KEY_HEADER })
      const data = await list.json()
      const created = (data.tasks || []).find((t: any) => t.title === title)
      if (created?.id) cleanupTasks.push(created.id)
    })

    test('newly created task appears in the workspace board without switching filter', async ({ page, request }) => {
      await loginAndAttachCookie(page, request, username)
      await page.goto(`/project/${primaryProject.slug}/tasks`)

      await page.getByRole('button', { name: /new task/i }).click()
      const title = `e2e-workspace-appear-${Date.now()}`
      await page.locator('#create-title').fill(title)
      await page.getByRole('button', { name: /^create$/i }).click()

      await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 })

      const list = await request.get('/api/tasks', { headers: API_KEY_HEADER })
      const data = await list.json()
      const created = (data.tasks || []).find((t: any) => t.title === title)
      if (created?.id) cleanupTasks.push(created.id)
    })
  })

  // ─── TASK-03 ───────────────────────────────────────────────────────

  test.describe('TASK-03: reassigning a task via edit modal', () => {
    test('open EditTaskModal — project dropdown is visible with other projects selectable', async ({ page, request }) => {
      await loginAndAttachCookie(page, request, username)
      const seed = await createTestTask(request, { project_id: primaryProject.id })
      cleanupTasks.push(seed.id)

      await page.goto(`/project/${primaryProject.slug}/tasks`)
      await page.getByText(seed.title).first().click()
      // Detail modal opens; click its edit button (aria-label="Edit").
      await page.getByRole('button', { name: /^edit$/i }).first().click()

      const editProjectSelect = page.locator('#edit-project')
      await expect(editProjectSelect).toBeVisible()
      // Must list the secondary project as a selectable reassignment target.
      await expect(editProjectSelect.locator(`option[value="${secondaryProject.id}"]`)).toHaveCount(1)
    })

    test('change project in EditTaskModal and submit — PUT /api/tasks/[id] (NOT PATCH) is called with new project_id', async ({ page, request }) => {
      await loginAndAttachCookie(page, request, username)
      const seed = await createTestTask(request, { project_id: primaryProject.id })
      cleanupTasks.push(seed.id)

      let capturedMethod: string | null = null
      let capturedBody: any = null
      await page.route(`**/api/tasks/${seed.id}`, async (route) => {
        const req = route.request()
        if (req.method() === 'PUT' || req.method() === 'PATCH') {
          capturedMethod = req.method()
          capturedBody = JSON.parse(req.postData() || '{}')
        }
        await route.continue()
      })

      await page.goto(`/project/${primaryProject.slug}/tasks`)
      await page.getByText(seed.title).first().click()
      await page.getByRole('button', { name: /^edit$/i }).first().click()

      await page.locator('#edit-project').selectOption(String(secondaryProject.id))
      await page.getByRole('button', { name: /^save$/i }).click()

      await expect.poll(() => capturedMethod).toBe('PUT')
      expect(capturedBody.project_id).toBe(secondaryProject.id)
    })

    test('reassigned-out task disappears from the workspace board after next re-fetch (pitfall #5)', async ({ page, request }) => {
      await loginAndAttachCookie(page, request, username)
      const seed = await createTestTask(request, { project_id: primaryProject.id })
      cleanupTasks.push(seed.id)

      await page.goto(`/project/${primaryProject.slug}/tasks`)
      await expect(page.getByText(seed.title).first()).toBeVisible()

      await page.getByText(seed.title).first().click()
      await page.getByRole('button', { name: /^edit$/i }).first().click()
      await page.locator('#edit-project').selectOption(String(secondaryProject.id))
      await page.getByRole('button', { name: /^save$/i }).click()

      // Client-side filter (Edit 5) hides the reassigned-out task immediately
      // when storeTasks updates, even before the next API re-fetch.
      await expect(page.getByText(seed.title)).toHaveCount(0, { timeout: 15_000 })
    })
  })
})
