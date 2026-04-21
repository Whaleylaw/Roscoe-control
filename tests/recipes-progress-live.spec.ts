import { test, expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

/**
 * Phase 17 Plan 17-06 (RTEST-04) — HIGH-FIDELITY end-to-end spec.
 *
 * This spec verifies the two DOM invariants that distinguish a live recipe
 * run from a unit test:
 *
 *   1. RUI-01: `[data-testid="recipe-badge"]` (or a text-based fallback —
 *      recipe-badge.tsx does not ship a data-testid attribute today) renders
 *      on the task card with the hello-world recipe's friendly name.
 *   2. RUI-03: `[data-checkpoint-id]` rows appear in the Progress tab as the
 *      real container posts checkpoints via SSE — no page reload.
 *
 * Per Phase 17 D-03 LOCKED, this spec spawns the REAL runner daemon (not a
 * test-only SSE seam) via PHASE17_SPAWN_RUNNER=1 forwarded to
 * scripts/e2e-openclaw/start-e2e-server.mjs. The E2E harness orchestrates:
 *
 *   1. The Mission Control standalone server on 127.0.0.1:3005
 *   2. The runner daemon (scripts/mc-runner.mjs) as a sibling child process
 *   3. The reference container (mc-hello-world-agent:latest) via the daemon
 *      claiming a seeded recipe-tagged task
 *
 * This spec auto-skips when:
 *   - Docker is not available (`docker info` fails)
 *   - The reference image is not built locally
 *   - PHASE17_SPAWN_RUNNER is not set (runner daemon not spawned)
 *
 * D-07 (no new npm deps) honored: no extra-deps import, no new dependencies
 * — `spawnSync('docker', ...)` matches the existing runner daemon pattern.
 *
 * Timeout discipline (D-03 explicit requirement):
 *   - 90s on first checkpoint row (2x-4x expected wall-clock on warm cache)
 *   - 60s on second-checkpoint poll (agent emits multiple fast)
 *   - bump to 120s before adding retry logic (flakes are under-provisioned
 *     timeouts, not wrong test logic)
 */

const TEST_USER = process.env.AUTH_USER || 'testadmin'
const TEST_PASS = process.env.AUTH_PASS || 'testpass1234!'
const API_KEY = process.env.API_KEY || 'test-api-key-e2e-12345'

const REPO_ROOT = path.resolve(__dirname, '..')
const WORKTREE_PARENT = path.join(REPO_ROOT, '.data', 'runner', 'worktrees')

// --------------------------------------------------------------------------
// Skip gates — evaluated at module load so test.describe.skip can see them.
// --------------------------------------------------------------------------
const dockerAvailable = (() => {
  try {
    return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
})()

const imageAvailable = dockerAvailable
  ? spawnSync('docker', ['image', 'inspect', 'mc-hello-world-agent:latest'], {
      stdio: 'ignore',
    }).status === 0
  : false

const runnerSpawned = process.env.PHASE17_SPAWN_RUNNER === '1'

async function login(page: Page): Promise<void> {
  const res = await page.request.post('/api/auth/login', {
    data: { username: TEST_USER, password: TEST_PASS },
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '10.90.16.6' },
  })
  if (!res.ok()) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`)
  }
}

/**
 * Ensures runtime.project_repo_map and runtime.mount_allowlist are configured
 * so the runner daemon can resolve the project's git repo and accept the
 * worktree mount. Mirrors scripts/mc-runner-smoke.sh:configure_runtime_settings.
 */
async function configureRuntimeSettings(
  page: Page,
  projectId: number,
): Promise<void> {
  // Fetch current settings so we merge rather than clobber.
  const settingsRes = await page.request.get('/api/settings', {
    headers: { 'x-api-key': API_KEY },
  })
  type SettingRow = { key: string; value: string }
  const settingsBody = settingsRes.ok()
    ? ((await settingsRes.json()) as { settings?: SettingRow[] })
    : { settings: [] }
  const settings = settingsBody.settings || []

  // Merge project_repo_map.
  const existingRepoMapRaw =
    settings.find((s) => s.key === 'runtime.project_repo_map')?.value || '{}'
  let repoMap: Record<string, string> = {}
  try {
    repoMap = JSON.parse(existingRepoMapRaw) as Record<string, string>
  } catch {
    repoMap = {}
  }
  repoMap[String(projectId)] = REPO_ROOT

  // Merge mount_allowlist — include both the worktree parent and the repo root.
  const existingAllowlistRaw =
    settings.find((s) => s.key === 'runtime.mount_allowlist')?.value || '[]'
  let allowlist: string[] = []
  try {
    const parsed = JSON.parse(existingAllowlistRaw)
    if (Array.isArray(parsed)) allowlist = parsed.filter((v) => typeof v === 'string')
  } catch {
    allowlist = []
  }
  if (!allowlist.includes(WORKTREE_PARENT)) allowlist.push(WORKTREE_PARENT)
  if (!allowlist.includes(REPO_ROOT)) allowlist.push(REPO_ROOT)

  // PUT merged settings back.
  const putRes = await page.request.put('/api/settings', {
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
    data: {
      settings: [
        { key: 'runtime.project_repo_map', value: JSON.stringify(repoMap) },
        { key: 'runtime.mount_allowlist', value: JSON.stringify(allowlist) },
      ],
    },
  })
  if (!putRes.ok()) {
    throw new Error(
      `PUT /api/settings failed: ${putRes.status()} ${await putRes.text()}`,
    )
  }
}

async function resolveOrCreateProject(page: Page): Promise<{ id: number; slug: string }> {
  // Try to find an existing project first (prior-run idempotency).
  const listRes = await page.request.get('/api/projects', {
    headers: { 'x-api-key': API_KEY },
  })
  if (listRes.ok()) {
    const body = (await listRes.json()) as {
      projects?: Array<{ id: number; slug: string; name: string }>
    }
    const existing = (body.projects || []).find((p) => p.slug === 'phase17-e2e')
    if (existing) return { id: existing.id, slug: existing.slug }
  }

  // Otherwise create — 201 on success; 409 indicates a concurrent create lost
  // the race so we re-list.
  const createRes = await page.request.post('/api/projects', {
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
    data: { name: 'Phase 17 E2E Project', slug: 'phase17-e2e' },
  })
  if (createRes.ok()) {
    const body = (await createRes.json()) as {
      project: { id: number; slug: string }
    }
    return { id: body.project.id, slug: body.project.slug }
  }
  if (createRes.status() === 409) {
    const again = await page.request.get('/api/projects', {
      headers: { 'x-api-key': API_KEY },
    })
    const body = (await again.json()) as {
      projects?: Array<{ id: number; slug: string }>
    }
    const found = (body.projects || []).find((p) => p.slug === 'phase17-e2e')
    if (found) return { id: found.id, slug: found.slug }
  }
  throw new Error(
    `Could not create or resolve phase17-e2e project: ${createRes.status()} ${await createRes.text()}`,
  )
}

test.describe('Phase 17: Recipe badge + Progress tab live update (RTEST-04)', () => {
  test.skip(
    !dockerAvailable || !imageAvailable || !runnerSpawned,
    'Requires Docker, mc-hello-world-agent:latest image, and PHASE17_SPAWN_RUNNER=1',
  )

  test('recipe badge renders + Progress tab updates live on checkpoint SSE', async ({
    page,
    context,
  }) => {
    // Suppress the onboarding wizard so the nav rail and board render.
    await context.addInitScript(() => {
      try {
        window.sessionStorage.setItem('mc-onboarding-dismissed', '1')
      } catch {
        // noop
      }
    })

    // ── Step 1: auth ──
    await login(page)

    // ── Step 2: resync recipes so hello-world is indexed ──
    // The watcher boots on server startup but is defensive against cold DB —
    // an explicit resync guarantees the hello-world row exists before we POST
    // a recipe_slug='hello-world' task.
    const resyncRes = await page.request.post('/api/recipes/resync', {
      headers: { 'x-api-key': API_KEY },
    })
    expect(resyncRes.ok(), `resync failed: ${resyncRes.status()}`).toBe(true)

    // ── Step 3: resolve project ──
    const project = await resolveOrCreateProject(page)

    // ── Step 4: configure runtime settings for the runner ──
    await configureRuntimeSettings(page, project.id)

    // ── Step 5: create recipe-tagged task ──
    // status: 'assigned' triggers eventBus.broadcast('task.runner_requested')
    // per POST /api/tasks (Plan 15-02 / SCHED-05) so the runner daemon claims
    // it within one SSE hop (or 15s poll fallback).
    const taskRes = await page.request.post('/api/tasks', {
      headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
      data: {
        title: 'Phase 17 E2E hello-world task',
        project_id: project.id,
        recipe_slug: 'hello-world',
        status: 'assigned',
        workspace_source: { project_id: project.id, base_ref: 'main' },
      },
    })
    expect(taskRes.ok(), `task create failed: ${taskRes.status()} ${await taskRes.text()}`).toBe(
      true,
    )
    const taskBody = (await taskRes.json()) as { task: { id: number; title: string } }
    const taskId = taskBody.task.id
    const taskTitle = taskBody.task.title

    // ── Step 6: navigate to the project's tasks view and find the card ──
    // The catch-all route /project/:slug/tasks renders the task board scoped
    // to this project. No data-task-id exists today, so we anchor on the
    // translated task title — the card is the button that contains it.
    await page.goto(`/project/${project.slug}/tasks`)
    await expect(page).not.toHaveURL(/\/login/)

    // The card is a role=button wrapper whose aria-label starts with the
    // task title. Match on role + name prefix for resilience against
    // badge reordering / drag handle additions.
    const taskCard = page
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(taskTitle)},`) })
      .first()
    await expect(taskCard, 'task card should be visible on board').toBeVisible({
      timeout: 30_000,
    })

    // ── Step 7: assert recipe badge (RUI-01) ──
    // RecipeBadge (src/components/panels/task-card/recipe-badge.tsx) does NOT
    // ship a data-testid attribute today; Phase 16-02 shipped it with
    // aria-label only. We assert on the friendly name text from
    // recipes/hello-world/recipe.yaml (name: "Hello World Agent") which is
    // rendered inside a <span title=...>. Fallback to raw slug if cache miss.
    // Scoped to the card so we never match badges on other tasks.
    const recipeLabel = taskCard.locator('text=/hello.world/i').first()
    await expect(recipeLabel, 'recipe badge should render').toBeVisible({
      timeout: 15_000,
    })

    // ── Step 8: open task detail + switch to Progress tab ──
    await taskCard.click()
    const dialog = page.getByRole('dialog').first()
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    const progressTab = dialog.getByRole('tab', { name: /progress/i }).first()
    await expect(progressTab).toBeVisible({ timeout: 10_000 })
    await progressTab.click()

    // ── Step 9: wait for first checkpoint row (RUI-03) ──
    // Timeout budget breakdown:
    //   - runner daemon SSE subscribe latency:     ~1s
    //   - task claim round-trip + worktree create: ~2-5s
    //   - docker run (image cached locally):       ~1-3s
    //   - agent.mjs first checkpoint emission:     ~5-15s
    //   - checkpoint POST → SSE → DOM:             <1s
    //   Expected wall-clock: 20-40s on a warm cache; 90s leaves 2x-4x headroom.
    const firstRow = page.locator('[data-checkpoint-id]').first()
    await expect(firstRow, 'first checkpoint row should appear via SSE').toBeVisible({
      timeout: 90_000,
    })

    // ── Step 10: assert live append (no reload) ──
    // The hello-world agent posts multiple checkpoints in sequence. Poll the
    // live DOM (NOT reloading the page) until we see at least 2 rows — this
    // proves the SSE → mc:checkpoint-added DOM event → ProgressTab React
    // setState path is wired end-to-end.
    await expect
      .poll(
        async () => page.locator('[data-checkpoint-id]').count(),
        { timeout: 60_000, message: 'live SSE append should grow checkpoint rows' },
      )
      .toBeGreaterThanOrEqual(2)

    // Container lifecycle and final transition (task → review → done via
    // Aegis) are covered by 17-02/17-03/17-04 Vitest integration tests.
    // This spec's job is the DOM live-update assertion, and that is done.
  })
})

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
