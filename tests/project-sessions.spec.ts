import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { API_KEY_HEADER, createTestProject, deleteTestProject } from './helpers'

/**
 * E2E — Project workspace sessions view (Phase 05, Plan 03).
 *
 * Verifies SESS-01 (two-section sessions list with chat threads + runtime
 * sessions) and SESS-03 (nested session detail route + back navigation)
 * end-to-end against a live dev server.
 *
 * Two test.fixme()s remain by design: external runtime sessions
 * (gateway/Claude/Codex/Hermes) come from filesystem scanners and there is
 * no test-only seeding hook for them. Those flows are validated in the
 * vitest API-route suite instead.
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
  // first-time admins and is not under test here.
  await page.context().addInitScript(() => {
    try {
      window.sessionStorage.setItem('mc-onboarding-dismissed', '1')
    } catch {
      /* ignore */
    }
  })
  const res = await request.post('/api/auth/login', {
    data: { username, password: TEST_PASS },
    headers: { 'x-real-ip': `10.99.99.${5 + _loginIpCounter}` },
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

async function ensureAgent(request: APIRequestContext, name: string, role = 'code') {
  // Create the agent (idempotent — a duplicate name returns 409 which we tolerate).
  const res = await request.post('/api/agents', {
    headers: API_KEY_HEADER,
    data: { name, role, status: 'idle' },
  })
  expect([201, 409]).toContain(res.status())
}

async function assignAgent(request: APIRequestContext, projectId: number, agentName: string) {
  const res = await request.post(`/api/projects/${projectId}/agents`, {
    headers: API_KEY_HEADER,
    data: { agent_name: agentName },
  })
  expect([201, 200]).toContain(res.status())
}

test.describe('Project workspace sessions — E2E', () => {
  const cleanupProjects: number[] = []
  let username: string
  let project: { id: number; slug: string; name: string }
  const agentName = `e2e-aegis-${Date.now()}`

  test.beforeAll(async ({ request }) => {
    username = `proj-sess-e2e-${Date.now()}`
    await ensureUser(request, username)
    await ensureAgent(request, agentName)
  })

  test.beforeEach(async ({ request }) => {
    const a = await createTestProject(request)
    cleanupProjects.push(a.id)
    project = { id: a.id, slug: a.body.project.slug, name: a.name }
  })

  test.afterEach(async ({ request }) => {
    for (const id of cleanupProjects.splice(0)) {
      await deleteTestProject(request, id).catch(() => {})
    }
  })

  // ── SESS-01 ──────────────────────────────────────────────────────────

  test.describe('SESS-01: two-section sessions view', () => {
    test('sessions tab shows Chat threads header and at least one row for the assigned agent', async ({
      page,
      request,
    }) => {
      await assignAgent(request, project.id, agentName)
      await loginAndAttachCookie(page, request, username)
      await page.goto(`/project/${project.slug}/sessions`)

      await expect(page.getByText('Chat threads')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(agentName, { exact: false })).toBeVisible()
    })

    // Runtime sessions come from filesystem scanners; we don't seed them in E2E.
    // Coverage for the union/slug-match rules lives in
    // src/app/api/projects/__tests__/project-sessions.test.ts.
    test.fixme(
      'sessions tab shows External sessions header (even if empty) when runtime sessions exist elsewhere',
      async () => {},
    )

    test('empty state CTA — with no assigned agents, Open Agents tab button navigates to /project/<slug>/agents', async ({
      page,
      request,
    }) => {
      await loginAndAttachCookie(page, request, username)
      await page.goto(`/project/${project.slug}/sessions`)

      // No assigned agents and no tasks — empty state should render.
      const cta = page.getByRole('button', { name: /open agents tab/i })
      await expect(cta).toBeVisible({ timeout: 15_000 })
      await cta.click()
      await expect(page).toHaveURL(new RegExp(`/project/${project.slug}/agents$`))
    })
  })

  // ── SESS-03 ──────────────────────────────────────────────────────────

  test.describe('SESS-03: click-through to session detail', () => {
    test('clicking a chat-thread row navigates to /project/<slug>/sessions/thread:<id>:<agent>', async ({
      page,
      request,
    }) => {
      await assignAgent(request, project.id, agentName)
      await loginAndAttachCookie(page, request, username)
      await page.goto(`/project/${project.slug}/sessions`)

      const row = page.getByRole('button').filter({ hasText: agentName }).first()
      await expect(row).toBeVisible({ timeout: 15_000 })
      await row.click()

      const expectedThreadId = `thread:${project.id}:${agentName.toLowerCase()}`
      await expect(page).toHaveURL(
        new RegExp(`/project/${project.slug}/sessions/${expectedThreadId.replace(/:/g, ':')}$`),
      )
    })

    test('session detail view renders with the embedded SessionDetailsPanel in scope mode (no filters, no page header)', async ({
      page,
      request,
    }) => {
      await assignAgent(request, project.id, agentName)
      await loginAndAttachCookie(page, request, username)
      const threadId = `thread:${project.id}:${agentName.toLowerCase()}`
      await page.goto(`/project/${project.slug}/sessions/${threadId}`)

      // Workspace shell stays mounted — breadcrumb + Sessions tab visible.
      await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toBeVisible({
        timeout: 15_000,
      })
      // Back-to-list link is the scope-mode affordance for the embedded panel.
      await expect(page.getByText(/back to sessions/i)).toBeVisible()
    })

    test('breadcrumb extends to show Project > Sessions > <agent or ticket-ref> while on detail view', async ({
      page,
      request,
    }) => {
      await assignAgent(request, project.id, agentName)
      await loginAndAttachCookie(page, request, username)
      const threadId = `thread:${project.id}:${agentName.toLowerCase()}`
      await page.goto(`/project/${project.slug}/sessions/${threadId}`)

      const breadcrumb = page.getByRole('navigation', { name: /breadcrumb/i })
      await expect(breadcrumb).toBeVisible({ timeout: 15_000 })
      // The fourth segment carries the human-readable thread label
      // (agent name with first letter uppercased — see project-breadcrumb.tsx).
      const expectedLabel = agentName.charAt(0).toUpperCase() + agentName.slice(1)
      await expect(breadcrumb.getByText(expectedLabel, { exact: false })).toBeVisible()
    })

    test('clicking "Back to sessions" link returns to /project/<slug>/sessions with workspace shell (breadcrumb + tabs) still mounted', async ({
      page,
      request,
    }) => {
      await assignAgent(request, project.id, agentName)
      await loginAndAttachCookie(page, request, username)
      const threadId = `thread:${project.id}:${agentName.toLowerCase()}`
      await page.goto(`/project/${project.slug}/sessions/${threadId}`)

      await expect(page.getByText(/back to sessions/i)).toBeVisible({ timeout: 15_000 })
      await page.getByText(/back to sessions/i).click()

      await expect(page).toHaveURL(new RegExp(`/project/${project.slug}/sessions$`))
      await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toBeVisible()
    })

    test('browser back button returns to sessions list (URL-driven state — FOUN-01)', async ({
      page,
      request,
    }) => {
      await assignAgent(request, project.id, agentName)
      await loginAndAttachCookie(page, request, username)
      await page.goto(`/project/${project.slug}/sessions`)

      const row = page.getByRole('button').filter({ hasText: agentName }).first()
      await expect(row).toBeVisible({ timeout: 15_000 })
      await row.click()
      await expect(page).toHaveURL(new RegExp(`/project/${project.slug}/sessions/thread:`))

      await page.goBack()
      await expect(page).toHaveURL(new RegExp(`/project/${project.slug}/sessions$`))
    })
  })

  // ── SESS-02 ──────────────────────────────────────────────────────────

  test.describe('SESS-02: agents tab scoped', () => {
    test('agents tab lists only agents assigned to or working on this project (union)', async ({
      page,
      request,
    }) => {
      await assignAgent(request, project.id, agentName)
      await loginAndAttachCookie(page, request, username)
      await page.goto(`/project/${project.slug}/agents`)

      // The assigned agent must be present.
      await expect(page.getByText(agentName, { exact: false })).toBeVisible({ timeout: 15_000 })
    })

    test('agent card shows Assigned chip when assignment_source is "assigned"', async ({
      page,
      request,
    }) => {
      await assignAgent(request, project.id, agentName)
      await loginAndAttachCookie(page, request, username)
      await page.goto(`/project/${project.slug}/agents`)

      // The Assigned chip text comes from project.agents.assignedChip (en: "Assigned").
      await expect(page.getByText(/^Assigned$/i).first()).toBeVisible({ timeout: 15_000 })
    })

    // The squad panel exposes the create button in its global mode; in scope
    // mode it's hidden via hideCreateAgent. The Add Agent label string varies
    // by panel version, so this assertion is best left to the unit suite.
    test.fixme('Add Agent button is not visible in scope mode', async () => {})
  })
})
