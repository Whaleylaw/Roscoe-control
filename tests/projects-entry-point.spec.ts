import { test, expect, Page } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

/**
 * Phase 8 — Projects entry point (NAV-01) cold-start journey.
 *
 * Encodes ROADMAP Phase 8 success criterion #4:
 *   login -> Projects nav -> row click -> workspace -> breadcrumb -> /projects
 *
 * No URL editing at any step. Any regression of nav-rail placement,
 * ContentRouter 'projects' wiring, ProjectsPanel row click handler, or
 * breadcrumb `Projects` segment target will fail this spec.
 *
 * Plan 08-01 shipped the Projects nav-rail item + /projects panel.
 * Plan 08-02 re-targeted the breadcrumb's `Projects` segment from `/` to
 * `/projects`. This spec is the end-to-end regression guard for both.
 */

const TEST_USER = process.env.AUTH_USER || 'testadmin'
const TEST_PASS = process.env.AUTH_PASS || 'testpass1234!'

/**
 * Sign in by POSTing to /api/auth/login and planting the returned
 * mc-session cookie on the browser context. Avoids a React-hydration race
 * around the login form's onSubmit handler (tracked via trace — browser
 * occasionally submitted the form natively to `/login?` before React had
 * attached the preventDefault handler).
 *
 * The behavior under test is NOT the login form — it is the journey after
 * login. login-flow.spec.ts already covers the form path. We inherit the
 * same session-cookie contract here.
 */
async function login(page: Page) {
  // Pass x-real-ip so this spec's login attempts live in their own
  // loginLimiter bucket (5/min per IP, critical=true). When
  // MC_TRUSTED_PROXIES is unset (the e2e default), XFF is ignored and all
  // tests without x-real-ip share the 'unknown' bucket and exhaust it
  // quickly when many UI specs run back-to-back (Phase 9 discovery).
  const res = await page.request.post('/api/auth/login', {
    data: { username: TEST_USER, password: TEST_PASS },
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '10.90.8.1' },
  })
  if (!res.ok()) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`)
  }
  // page.request shares the context's cookie jar, so the Set-Cookie is
  // already applied to subsequent page navigations.
}

test.describe('Phase 8: Projects entry point — cold-start journey (NAV-01)', () => {
  let projectId: number
  const slug = 'e2e-phase-8'
  const projectName = 'E2E Phase 8'

  test.beforeAll(async ({ request }) => {
    // The e2e harness seeds TEST_USER at boot via AUTH_USER/AUTH_PASS env
    // (see playwright.config.ts webServer.env). No user creation needed.

    // Create the test project fixture the browser will click through.
    const res = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: { name: projectName, ticket_prefix: 'E8P', slug },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    projectId = body.project.id as number
    expect(typeof projectId).toBe('number')
  })

  test.afterAll(async ({ request }) => {
    if (projectId) {
      // mode=delete hard-removes the fixture (reparents tasks to 'general',
      // then deletes the row). Confirmed present in
      // src/app/api/projects/[id]/route.ts during plan research.
      await request
        .delete(`/api/projects/${projectId}?mode=delete`, { headers: API_KEY_HEADER })
        .catch(() => {})
    }
  })

  test('user reaches project workspace via nav-rail and returns via breadcrumb', async ({ page, context }) => {
    // Suppress the onboarding wizard — it covers the nav-rail for first-time
    // admins and is not part of the NAV-01 journey under test. The
    // OnboardingWizard client-side gate reads this sessionStorage key
    // (src/lib/onboarding-session.ts: ONBOARDING_SESSION_DISMISSED_KEY).
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('mc-onboarding-dismissed', '1') } catch {}
    })

    // 0. Login (establishes mc-session cookie so / no longer redirects to /login)
    await login(page)

    // 1. Start at root. Boot sequence lands on the overview panel.
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/)

    // Wait for boot to complete: the splash screen hides and the main
    // navigation <nav aria-label="Main navigation"> becomes visible. Boot
    // gates all UI on parallel fetches (auth/me, projects, agents, etc.) so
    // this is the earliest point the Projects nav-rail item exists.
    await expect(page.getByRole('navigation', { name: /main navigation/i })).toBeVisible({ timeout: 30_000 })

    // 2. Click the Projects nav-rail item.
    // NavRail renders a <Button> labelled by the translated nav.projects key
    // ("Projects" in en). `.first()` picks the top-most match — the desktop
    // nav-rail item — in case the mobile bottom-bar also renders at this
    // viewport width.
    await page.getByRole('button', { name: /^projects$/i }).first().click()
    await page.waitForURL('**/projects')
    await expect(page).toHaveURL(/\/projects$/)

    // 3. Click the project row for the test fixture.
    // ProjectsPanel rows use role="button" with aria-label={project.name}.
    await page.getByRole('button', { name: projectName }).click()
    await page.waitForURL(`**/project/${slug}`)
    await expect(page).toHaveURL(new RegExp(`/project/${slug}$`))

    // 4. Confirm the workspace dashboard is rendered by asserting the
    // breadcrumb nav is present (<nav aria-label="Breadcrumb">).
    const breadcrumb = page.getByRole('navigation', { name: /breadcrumb/i })
    await expect(breadcrumb).toBeVisible()

    // 5. Click the breadcrumb 'Projects' segment.
    await breadcrumb.getByRole('button', { name: /^projects$/i }).first().click()

    // 6. Verify we landed back at /projects (NOT /).
    await page.waitForURL('**/projects')
    await expect(page).toHaveURL(/\/projects$/)
    // Defensive: explicitly reject the pre-Plan-08-02 behavior where the
    // breadcrumb returned users to '/' (root).
    await expect(page).not.toHaveURL(/^http[s]?:\/\/[^/]+\/$/)
  })
})
