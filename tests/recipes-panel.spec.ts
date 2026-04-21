import { test, expect, Page } from '@playwright/test'

/**
 * Phase 16 — Recipes Panel (RUI-06) happy-path spec.
 *
 * Encodes the truth axiom:
 *   "A 'Recipes' entry appears in the main nav rail and routes to a
 *    Recipes panel"
 *
 * Any regression of:
 *   - nav-rail `{ id: 'recipes', ... }` item removal
 *   - ContentRouter `case 'recipes'` deletion
 *   - navItemTranslationKeys `recipes: 'recipes'` mapping drop
 *   - `nav.recipes` / `recipesPanel.*` i18n key drift
 *
 * will fail this spec.
 *
 * Phase 17 RTEST will extend this with fuller E2E coverage against real
 * recipe fixtures (Resync counts, SSE refresh, view-toggle soul_md).
 * For Phase 16 we assert only the panel chrome so the spec stays resilient
 * across dev environments that may or may not have recipes indexed.
 */

const TEST_USER = process.env.AUTH_USER || 'testadmin'
const TEST_PASS = process.env.AUTH_PASS || 'testpass1234!'

async function login(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { username: TEST_USER, password: TEST_PASS },
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '10.90.16.6' },
  })
  if (!res.ok()) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`)
  }
}

test.describe('Phase 16: Recipes Panel (RUI-06)', () => {
  test('nav rail Recipes item opens /recipes panel with heading and Resync button', async ({
    page,
    context,
  }) => {
    // Suppress onboarding wizard — it blocks the nav rail for first-run admins.
    await context.addInitScript(() => {
      try {
        window.sessionStorage.setItem('mc-onboarding-dismissed', '1')
      } catch {}
    })

    await login(page)
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/)

    // Wait for boot: main navigation is the earliest stable signal that all
    // nav items have rendered.
    await expect(
      page.getByRole('navigation', { name: /main navigation/i }),
    ).toBeVisible({ timeout: 30_000 })

    // Click the Recipes nav-rail button (renders as a Button / role=button
    // with the translated 'nav.recipes' label — "Recipes" in en).
    await page.getByRole('button', { name: /^recipes$/i }).first().click()

    // URL updates to /recipes via the catch-all panel route.
    await page.waitForURL('**/recipes')
    await expect(page).toHaveURL(/\/recipes$/)

    // Panel heading renders (keyed to recipesPanel.title).
    await expect(
      page.getByRole('heading', { name: /^recipes$/i }),
    ).toBeVisible()

    // Resync button renders (keyed to recipesPanel.resync).
    await expect(
      page.getByRole('button', { name: /^resync$/i }),
    ).toBeVisible()
  })
})
