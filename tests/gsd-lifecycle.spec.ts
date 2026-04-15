import { test, expect, Page } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

/**
 * Phase 9 — GSD Native Integration, Plan 09-10 Wave 4 verification sweep.
 *
 * End-to-end cross-layer test covering the full lifecycle contract
 * (GSD-07, GSD-08, GSD-11, GSD-15, GSD-21, GSD-22):
 *
 *   create project (non-GSD)
 *     → enable GSD via PATCH
 *     → bootstrap via UI click (POST /api/projects/:id/gsd/bootstrap)
 *     → assert 8 tasks materialize with gsd_phase + gate flags
 *     → illegal transition (discuss → execute) via API returns 409 ILLEGAL_TRANSITION
 *     → mark DISCUSS-01 done via quality-review (Aegis approval)
 *     → legal transition (discuss → plan) via UI click returns 200
 *     → gate enforcement: PUT status=in_progress on PLAN-02 (gate_required=1) → 403 GATE_BLOCKED
 *     → approve gate via PATCH /api/tasks/:id/gate → 200
 *     → retry PUT status=in_progress → 200 (gate cleared)
 *
 * Design notes:
 *   - Primarily API-driven for determinism; UI click used for the bootstrap
 *     CTA to exercise the LifecycleView React flow end-to-end (per plan step 5).
 *   - Login uses page.request.post('/api/auth/login') per Phase 08-03 precedent
 *     (avoids login-form hydration race).
 *   - Onboarding wizard is suppressed via sessionStorage init script so the
 *     nav rail / lifecycle tab aren't covered.
 *   - The optional SSE real-time assertion is omitted intentionally (plan
 *     labels it STRETCH) — relying on fetchProjects after each mutation.
 */

const TEST_USER = process.env.AUTH_USER || 'testadmin'
const TEST_PASS = process.env.AUTH_PASS || 'testpass1234!'

async function login(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { username: TEST_USER, password: TEST_PASS },
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok()) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`)
  }
}

test.describe('Phase 9: GSD lifecycle end-to-end', () => {
  let projectId: number
  const slug = `e2e-gsd-${Date.now()}`
  const projectName = `E2E GSD ${Date.now()}`

  test.afterAll(async ({ request }) => {
    if (projectId) {
      await request
        .delete(`/api/projects/${projectId}?mode=delete`, { headers: API_KEY_HEADER })
        .catch(() => {})
    }
  })

  test('create → enable GSD → bootstrap → illegal/legal transitions → gate enforcement', async ({
    page,
    context,
    request,
  }) => {
    // Suppress the onboarding wizard — it covers the nav rail + main content
    // for first-time admins and is not part of this flow under test.
    await context.addInitScript(() => {
      try {
        window.sessionStorage.setItem('mc-onboarding-dismissed', '1')
      } catch {
        /* ignore */
      }
    })

    // ── 0. Login ───────────────────────────────────────────
    await login(page)

    // ── 1. Create project (non-GSD initially) ──────────────
    const createRes = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: { name: projectName, slug, ticket_prefix: 'E2EGSD' },
    })
    expect(createRes.status()).toBe(201)
    const created = await createRes.json()
    projectId = created.project.id as number
    expect(typeof projectId).toBe('number')
    expect(created.project.gsd_enabled).toBeFalsy()

    // ── 2. Navigate to lifecycle tab; empty state (non-GSD) should render ──
    // Boot first at root so the full app bootstraps (projects preload, nav
    // rail mounts). A direct /project/<slug>/lifecycle deep-link can land
    // while the boot splash is still up, which races the Lifecycle tab
    // mount. Same pattern established by tests/projects-entry-point.spec.ts.
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(
      page.getByRole('navigation', { name: /main navigation/i })
    ).toBeVisible({ timeout: 30_000 })
    await page.goto(`/project/${slug}/lifecycle`)
    await expect(
      page.getByRole('button', { name: /Enable GSD for this project/i }).first()
    ).toBeVisible({ timeout: 30_000 })

    // ── 3. Enable GSD (PATCH /api/projects/:id) ────────────
    const enableRes = await request.patch(`/api/projects/${projectId}`, {
      headers: API_KEY_HEADER,
      data: { gsd_enabled: 1 },
    })
    expect(enableRes.status()).toBe(200)
    const enabled = await enableRes.json()
    expect(enabled.project.gsd_enabled).toBe(1)

    // Reload — LifecycleView should now show the not-bootstrapped branch.
    await page.reload()
    await expect(
      page.getByRole('button', { name: /Bootstrap phase tasks/i }).first()
    ).toBeVisible({ timeout: 15_000 })

    // ── 4. Bootstrap phase tasks via UI click ─────────────
    // The bootstrap POST takes ~100ms; use waitForResponse to avoid flakes.
    const [bootstrapResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/projects/${projectId}/gsd/bootstrap`) && r.request().method() === 'POST'
      ),
      page.getByRole('button', { name: /Bootstrap phase tasks/i }).first().click(),
    ])
    expect(bootstrapResp.status()).toBe(200)
    const bootstrapBody = await bootstrapResp.json()
    // Default template ships 8 tasks (2 per phase × 4 phases).
    expect(bootstrapBody.created).toBeGreaterThanOrEqual(8)
    expect(Array.isArray(bootstrapBody.tasks)).toBe(true)

    // Confirm phase + gate flags propagated on created tasks.
    const bootstrapTasks = bootstrapBody.tasks as Array<{
      id: number
      gsd_phase: string
      gate_required: number
      gate_status: string
      project_ticket_no: number
    }>
    const phases = new Set(bootstrapTasks.map((x) => x.gsd_phase))
    expect(phases.has('discuss')).toBe(true)
    expect(phases.has('plan')).toBe(true)
    expect(phases.has('execute')).toBe(true)
    expect(phases.has('verify')).toBe(true)
    expect(bootstrapTasks.some((x) => x.gate_required === 1)).toBe(true)

    // ── 5. Illegal transition: discuss → execute → 409 ILLEGAL_TRANSITION ──
    const illegalRes = await request.post(`/api/projects/${projectId}/gsd/transition`, {
      headers: API_KEY_HEADER,
      data: { to_phase: 'execute' },
    })
    expect(illegalRes.status()).toBe(409)
    const illegalBody = await illegalRes.json()
    expect(illegalBody.code).toBe('ILLEGAL_TRANSITION')
    expect(illegalBody.from_phase).toBe('discuss')
    expect(illegalBody.to_phase).toBe('execute')

    // ── 6. Mark a Discuss task done (Aegis approval path) ──
    const firstDiscuss = bootstrapTasks.find((x) => x.gsd_phase === 'discuss')
    expect(firstDiscuss).toBeDefined()
    const discussId = firstDiscuss!.id

    // Posting a quality_review with status='approved' auto-flips the task to 'done'
    // (see src/app/api/quality-review/route.ts:108) — side-stepping the Aegis gate.
    const qrRes = await request.post('/api/quality-review', {
      headers: API_KEY_HEADER,
      data: {
        taskId: discussId,
        reviewer: 'aegis',
        status: 'approved',
        notes: 'E2E: auto-approve to enable discuss→plan transition',
      },
    })
    expect(qrRes.status()).toBe(200)

    // Sanity-check the task is now done
    const discussGet = await request.get(`/api/tasks/${discussId}`, { headers: API_KEY_HEADER })
    expect(discussGet.status()).toBe(200)
    expect((await discussGet.json()).task.status).toBe('done')

    // ── 7. Legal transition: discuss → plan (API) ──────────
    // We intentionally use the API (not the UI) here because the UI's
    // Advance button relies on Zustand-store task state which may lag
    // behind the direct API mutation in step 6. The plan permits this
    // trade-off — the UI Advance button is exercised indirectly via the
    // same POST /api/projects/:id/gsd/transition endpoint.
    const planRes = await request.post(`/api/projects/${projectId}/gsd/transition`, {
      headers: API_KEY_HEADER,
      data: { to_phase: 'plan' },
    })
    expect(planRes.status()).toBe(200)
    const planBody = await planRes.json()
    expect(planBody.to_phase).toBe('plan')
    expect(planBody.project.gsd_phase).toBe('plan')

    // ── 8. Gate enforcement: PUT in_progress on a gated plan task → 403 ──
    const gatedPlan = bootstrapTasks.find(
      (x) => x.gsd_phase === 'plan' && x.gate_required === 1
    )
    expect(gatedPlan).toBeDefined()
    const gatedPlanId = gatedPlan!.id

    const blockedRes = await request.put(`/api/tasks/${gatedPlanId}`, {
      headers: API_KEY_HEADER,
      data: { status: 'in_progress' },
    })
    expect(blockedRes.status()).toBe(403)
    const blockedBody = await blockedRes.json()
    expect(blockedBody.code).toBe('GATE_BLOCKED')

    // ── 9. Approve the gate: PATCH /api/tasks/:id/gate ─────
    const gateRes = await request.patch(`/api/tasks/${gatedPlanId}/gate`, {
      headers: API_KEY_HEADER,
      data: { gate_status: 'approved', note: 'E2E approval' },
    })
    expect(gateRes.status()).toBe(200)
    const gateBody = await gateRes.json()
    expect(gateBody.task.gate_status).toBe('approved')
    expect(gateBody.task.gate_approved_by).toBeTruthy()

    // ── 10. Retry PUT in_progress → 200 (gate cleared) ─────
    const unblockedRes = await request.put(`/api/tasks/${gatedPlanId}`, {
      headers: API_KEY_HEADER,
      data: { status: 'in_progress' },
    })
    expect(unblockedRes.status()).toBe(200)
    const unblockedBody = await unblockedRes.json()
    expect(unblockedBody.task.status).toBe('in_progress')
  })
})
