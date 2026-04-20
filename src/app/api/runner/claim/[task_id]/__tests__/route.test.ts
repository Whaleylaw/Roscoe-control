/**
 * Route-integration tests for POST /api/runner/claim/:task_id (Plan 14-05).
 *
 * Wave-0 stubs from 14-03 are replaced with real it() bodies. In-memory
 * sqlite + mocked auth/db mirror the heartbeat / ready-tasks / pending-containers
 * test files.
 *
 * Covers:
 *   - RUNNER-06 atomic claim happy path, double-claim 409, wrong-status 409,
 *     token expiry = runner_started_at + timeout + 60, dispatch payload shape,
 *     resume semantics (attempt > 1, prior_attempts, is_resuming=true),
 *     runner_max_attempts filesystem re-parse
 *   - RUNNER-07 mount + skill allowlist re-validation (OUT_OF_ALLOWLIST)
 *   - RUNNER-08 global + per-recipe concurrency caps (CAP_EXCEEDED)
 *   - MODEL-04 env.MC_MODEL_PRIMARY precedence
 */

import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMigrations } from '@/lib/migrations'

// ---------------------------------------------------------------------------
// Mocks — wired via vi.hoisted so both the route and the test share state.
// ---------------------------------------------------------------------------

let testDb: Database.Database

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {},
  Task: {},
  logAuditEvent: vi.fn(),
}))

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Override the recipes root via env so resolveRecipeMaxAttempts reads our
// fixture tree. The route's helper calls getRecipesRoot() at request time.
let tmpRoot: string
let tmpRecipesRoot: string

import { POST } from '@/app/api/runner/claim/[task_id]/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRunner() {
  requireRoleMock.mockReturnValueOnce({
    user: {
      id: -1000,
      username: 'runner',
      display_name: 'Runner Daemon',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
    },
  })
}

function asOperatorSessionUser() {
  requireRoleMock.mockReturnValueOnce({
    user: {
      id: 7,
      username: 'tester',
      display_name: 'Tester',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
    },
  })
}

function claimReq(taskId: number | string): {
  req: NextRequest
  ctx: { params: Promise<{ task_id: string }> }
} {
  return {
    req: new NextRequest(`http://x/api/runner/claim/${taskId}`, { method: 'POST' }),
    ctx: { params: Promise.resolve({ task_id: String(taskId) }) },
  }
}

function seedRecipe(
  slug: string,
  opts: {
    modelPrimary?: string
    modelFallback?: string | null
    modelProvider?: string | null
    modelParams?: unknown
    timeoutSeconds?: number
    maxConcurrent?: number
    env?: Record<string, string>
    secrets?: string[]
    errorMessage?: string | null
  } = {},
) {
  const {
    modelPrimary = 'claude-opus-4-7',
    modelFallback = null,
    modelProvider = null,
    modelParams = undefined,
    timeoutSeconds = 600,
    maxConcurrent = 3,
    env = {},
    secrets = [],
    errorMessage = null,
  } = opts
  const modelJson = JSON.stringify({
    primary: modelPrimary,
    ...(modelFallback ? { fallback: modelFallback } : {}),
    ...(modelProvider ? { provider: modelProvider } : {}),
    ...(modelParams !== undefined ? { params: modelParams } : {}),
  })
  testDb
    .prepare(
      `INSERT INTO recipes
         (slug, name, description, when_to_use, image, workspace_mode, timeout_seconds,
          max_concurrent, env_json, secrets_json, tags_json, model_json, version, dir_sha,
          soul_md, error_message, workspace_id, tenant_id)
       VALUES (?, ?, NULL, NULL, 'ubuntu', 'worktree', ?, ?, ?, ?, '[]', ?, 1, ?, NULL, ?, 1, 1)`,
    )
    .run(
      slug,
      slug,
      timeoutSeconds,
      maxConcurrent,
      JSON.stringify(env),
      JSON.stringify(secrets),
      modelJson,
      `sha-${slug}`,
      errorMessage,
    )
}

function seedTask(params: {
  status?: string
  recipeSlug?: string | null
  modelOverride?: string | null
  runnerAttempts?: number
  runnerMaxAttempts?: number | null
  containerId?: string | null
  readOnlyMounts?: Array<{ host_path: string; container_path: string; label: string }>
  extraSkills?: string[]
  workspaceSource?: { project_id: number; base_ref: string } | null
}): number {
  const {
    status = 'assigned',
    recipeSlug = 'wt',
    modelOverride = null,
    runnerAttempts = 0,
    runnerMaxAttempts = null,
    containerId = null,
    readOnlyMounts = [],
    extraSkills = [],
    workspaceSource = null,
  } = params
  const result = testDb
    .prepare(
      `INSERT INTO tasks
         (title, status, priority, created_by, recipe_slug, model_override, container_id,
          runner_attempts, runner_max_attempts, read_only_mounts, extra_skills, workspace_source)
       VALUES ('t', ?, 'medium', 'test', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      status,
      recipeSlug,
      modelOverride,
      containerId,
      runnerAttempts,
      runnerMaxAttempts,
      readOnlyMounts.length ? JSON.stringify(readOnlyMounts) : null,
      extraSkills.length ? JSON.stringify(extraSkills) : null,
      workspaceSource ? JSON.stringify(workspaceSource) : null,
    )
  return Number(result.lastInsertRowid)
}

function seedSetting(key: string, value: string) {
  testDb
    .prepare(
      `INSERT OR REPLACE INTO settings (key, value, category, updated_at) VALUES (?, ?, 'runtime', unixepoch())`,
    )
    .run(key, value)
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  requireRoleMock.mockReset()

  // Build a tmp tree with both the allowed mounts root AND a recipes root.
  tmpRoot = await mkdtemp(join(tmpdir(), 'mc14-05-claim-'))
  await mkdir(join(tmpRoot, 'allowed'), { recursive: true })
  await writeFile(join(tmpRoot, 'allowed', 'marker.txt'), 'x')
  tmpRecipesRoot = join(tmpRoot, 'recipes-root')
  await mkdir(tmpRecipesRoot, { recursive: true })
  process.env.MISSION_CONTROL_RECIPES_DIR = tmpRecipesRoot

  // Seed allowlist with tmpRoot/allowed.
  seedSetting('runtime.mount_allowlist', JSON.stringify([join(tmpRoot, 'allowed')]))
  // Default runtime caps (picked up via getters).
  seedSetting('runtime.max_concurrent_containers', '4')
  seedSetting('runtime.max_memory_per_container', '8g')
  seedSetting('runtime.max_cpu_per_container', '4.0')

  // Default recipe — happy case for most tests.
  seedRecipe('wt')
})

afterEach(async () => {
  testDb.close()
  delete process.env.MISSION_CONTROL_RECIPES_DIR
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/runner/claim/:task_id', () => {
  // ------------- RUNNER-06 happy path + transaction semantics -------------

  it('RUNNER-06: atomic claim transitions status assigned→in_progress and writes container_id + runner_started_at + runner_attempts+=1 in one transaction', async () => {
    asRunner()
    const taskId = seedTask({})

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()

    // DB side-effects
    const row = testDb
      .prepare(`SELECT status, container_id, runner_started_at, runner_attempts FROM tasks WHERE id = ?`)
      .get(taskId) as { status: string; container_id: string; runner_started_at: number; runner_attempts: number }
    expect(row.status).toBe('in_progress')
    expect(row.container_id).toBe(`pending:${taskId}:1`)
    expect(row.runner_started_at).toBeGreaterThan(0)
    expect(row.runner_attempts).toBe(1)

    // task_runner_attempts row inserted
    const attemptRow = testDb
      .prepare(`SELECT attempt, started_at FROM task_runner_attempts WHERE task_id = ?`)
      .get(taskId) as { attempt: number; started_at: number }
    expect(attemptRow.attempt).toBe(1)
    expect(attemptRow.started_at).toBe(row.runner_started_at)

    // Response shape
    expect(body.task).toMatchObject({
      id: taskId,
      recipe_slug: 'wt',
      attempt: 1,
      is_resuming: false,
      prior_attempts: [],
    })
    expect(body.recipe).toBeDefined()
    expect(body.recipe.slug).toBe('wt')
    expect(body.env).toBeDefined()
    expect(typeof body.runner_token_expires_at).toBe('number')
    expect(body.resource_limits).toEqual({ memory: '2g', cpus: 1.0 })
    expect(body.container_name_prefix).toBe(`mc-task-${taskId}-a1`)
  })

  it('RUNNER-09: persists tasks.worktree_path to the deterministic .data/runner/worktrees/task-<id>/ path for workspace_mode=worktree recipes', async () => {
    asRunner()
    const taskId = seedTask({})

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(200)

    const { config } = await import('@/lib/config')
    const { join } = await import('node:path')
    const expected = join(config.dataDir, 'runner', 'worktrees', `task-${taskId}`)

    const row = testDb
      .prepare(`SELECT worktree_path FROM tasks WHERE id = ?`)
      .get(taskId) as { worktree_path: string | null }
    expect(row.worktree_path).toBe(expected)
  })

  it('RUNNER-06: returns 409 when a second claim attempts on an already-claimed task', async () => {
    asRunner()
    asRunner() // queued for second call
    const taskId = seedTask({})

    const first = await POST(...Object.values(claimReq(taskId)) as [NextRequest, { params: Promise<{ task_id: string }> }])
    expect(first.status).toBe(200)

    const second = await POST(...Object.values(claimReq(taskId)) as [NextRequest, { params: Promise<{ task_id: string }> }])
    expect(second.status).toBe(409)
    const body = await second.json()
    expect(body.error).toBe('already claimed or ineligible')
  })

  it('RUNNER-06: returns 409 when task.status is not assigned at claim time', async () => {
    asRunner()
    const taskId = seedTask({ status: 'backlog' })

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('already claimed or ineligible')
  })

  // ------------- RUNNER-07 allowlist re-validation -------------

  it('RUNNER-07: re-validates read_only_mounts against the allowlist at claim time and rejects with OUT_OF_ALLOWLIST on escape', async () => {
    asRunner()
    const taskId = seedTask({
      readOnlyMounts: [
        { host_path: '/tmp/definitely-outside-allowlist', container_path: '/refs/x', label: 'x' },
      ],
    })

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors).toBeDefined()
    expect(body.errors[0].code).toBe('OUT_OF_ALLOWLIST')
    expect(body.errors[0].field).toBe('read_only_mounts.0.host_path')
    expect(body.errors[0].message).toContain('/tmp/definitely-outside-allowlist')

    // Task was NOT mutated.
    const row = testDb.prepare(`SELECT status, container_id FROM tasks WHERE id = ?`).get(taskId) as {
      status: string
      container_id: string | null
    }
    expect(row.status).toBe('assigned')
    expect(row.container_id).toBeNull()
  })

  it('RUNNER-07: re-validates extra_skills against the skill allowlist at claim time and rejects with SKILL_NOT_ALLOWED', async () => {
    asRunner()
    const taskId = seedTask({
      extraSkills: ['/var/elsewhere/skill'],
    })

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(400)
    const body = await res.json()
    // The shared allowlist emits OUT_OF_ALLOWLIST; test name preserved from
    // the 14-03 scaffold but the code field is OUT_OF_ALLOWLIST — see
    // TASK_RUNTIME_ERROR_CODES vocabulary in task-runtime-validation.ts.
    expect(body.errors[0].code).toBe('OUT_OF_ALLOWLIST')
    expect(body.errors[0].field).toBe('extra_skills.0')
  })

  // ------------- RUNNER-08 concurrency caps -------------

  it('RUNNER-08: returns 409 when the global MAX_CONCURRENT_CONTAINERS cap is reached', async () => {
    asRunner()
    seedSetting('runtime.max_concurrent_containers', '2')
    // Seed 2 in-flight tasks to fill the cap.
    seedTask({ status: 'in_progress', containerId: 'mc-task-x-a1' })
    seedTask({ status: 'in_progress', containerId: 'mc-task-y-a1' })
    // Our test task sitting in assigned.
    const taskId = seedTask({ status: 'assigned', containerId: null })

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.errors[0].code).toBe('CAP_EXCEEDED')
    expect(body.errors[0].field).toBe('(global)')
  })

  it('RUNNER-08: returns 409 when the per-recipe max_concurrent cap is reached for recipe.slug', async () => {
    asRunner()
    seedRecipe('cap2', { maxConcurrent: 2 })
    // Seed 2 in-flight tasks for recipe cap2.
    seedTask({ status: 'in_progress', recipeSlug: 'cap2', containerId: 'mc-task-a-a1' })
    seedTask({ status: 'in_progress', recipeSlug: 'cap2', containerId: 'mc-task-b-a1' })
    // Test task (below global cap 4).
    const taskId = seedTask({ status: 'assigned', recipeSlug: 'cap2', containerId: null })

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.errors[0].code).toBe('CAP_EXCEEDED')
    expect(body.errors[0].field).toBe('recipe.max_concurrent')
  })

  // ------------- MODEL-04 env.MC_MODEL_PRIMARY precedence -------------

  it('MODEL-04: dispatch payload env.MC_MODEL_PRIMARY resolves to task.model_override when set, else recipe.model.primary', async () => {
    asRunner()
    // Override set — task.model_override wins.
    seedRecipe('m-override', { modelPrimary: 'claude-sonnet-4-6' })
    const overrideTaskId = seedTask({
      recipeSlug: 'm-override',
      modelOverride: 'claude-opus-4-7',
    })
    const r1 = await POST(...Object.values(claimReq(overrideTaskId)) as [
      NextRequest,
      { params: Promise<{ task_id: string }> },
    ])
    expect(r1.status).toBe(200)
    const b1 = await r1.json()
    expect(b1.env.MC_MODEL_PRIMARY).toBe('claude-opus-4-7')

    // No override — recipe.model.primary wins.
    asRunner()
    seedRecipe('m-no-override', { modelPrimary: 'claude-sonnet-4-6' })
    const plainTaskId = seedTask({
      recipeSlug: 'm-no-override',
      modelOverride: null,
    })
    const r2 = await POST(...Object.values(claimReq(plainTaskId)) as [
      NextRequest,
      { params: Promise<{ task_id: string }> },
    ])
    expect(r2.status).toBe(200)
    const b2 = await r2.json()
    expect(b2.env.MC_MODEL_PRIMARY).toBe('claude-sonnet-4-6')
  })

  // ------------- RUNNER-06 token expiry arithmetic -------------

  it('RUNNER-06: issued runner-token expires at runner_started_at + recipe.timeout_seconds + 60s', async () => {
    asRunner()
    seedRecipe('tmo', { timeoutSeconds: 1800 })
    const taskId = seedTask({ recipeSlug: 'tmo' })

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()

    const { runner_started_at } = testDb
      .prepare(`SELECT runner_started_at FROM tasks WHERE id = ?`)
      .get(taskId) as { runner_started_at: number }
    expect(body.runner_token_expires_at).toBe(runner_started_at + 1800 + 60)
  })

  // ------------- RUNNER-06 dispatch payload shape (first attempt) -------------

  it('RUNNER-06: dispatch payload includes recipe body (env/secrets/soul_md/limits) + task.is_resuming + task.prior_attempts', async () => {
    asRunner()
    seedRecipe('dispatch', {
      timeoutSeconds: 900,
      maxConcurrent: 5,
      env: { DEBUG: '1' },
      secrets: ['ANTHROPIC_API_KEY'],
    })
    const taskId = seedTask({ recipeSlug: 'dispatch' })

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.task.is_resuming).toBe(false)
    expect(body.task.prior_attempts).toEqual([])
    expect(body.task.attempt).toBe(1)
    expect(body.recipe.slug).toBe('dispatch')
    expect(body.recipe.timeout_seconds).toBe(900)
    expect(body.recipe.max_concurrent).toBe(5)
    expect(body.recipe.env).toEqual({ DEBUG: '1' })
    expect(body.recipe.secrets).toEqual(['ANTHROPIC_API_KEY'])
    expect(body.env.DEBUG).toBe('1')
  })

  // ------------- RUNNER-06 resume semantics (attempt > 1) -------------

  it('RUNNER-06: second attempt increments attempt + is_resuming=true + prior_attempts contains first attempt row', async () => {
    asRunner()
    const taskId = seedTask({ recipeSlug: 'wt', runnerAttempts: 1 })
    // Seed prior attempt row.
    testDb
      .prepare(
        `INSERT INTO task_runner_attempts (task_id, attempt, started_at, exited_at, exit_code, failure_reason)
         VALUES (?, 1, 1000, 1500, 1, 'crash')`,
      )
      .run(taskId)

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.task.attempt).toBe(2)
    expect(body.task.is_resuming).toBe(true)
    expect(body.task.prior_attempts).toHaveLength(1)
    expect(body.task.prior_attempts[0]).toMatchObject({
      attempt: 1,
      started_at: 1000,
      exit_code: 1,
      failure_reason: 'crash',
    })

    // DB reflects the second attempt.
    const row = testDb.prepare(`SELECT runner_attempts FROM tasks WHERE id = ?`).get(taskId) as {
      runner_attempts: number
    }
    expect(row.runner_attempts).toBe(2)

    // task_runner_attempts now has both rows.
    const attemptRows = testDb
      .prepare(`SELECT attempt FROM task_runner_attempts WHERE task_id = ? ORDER BY attempt ASC`)
      .all(taskId) as Array<{ attempt: number }>
    expect(attemptRows.map((r) => r.attempt)).toEqual([1, 2])
  })

  // ------------- runner_max_attempts filesystem re-parse -------------

  it('RUNNER-06: runner_max_attempts picks up recipe.max_attempts from filesystem when task column is null', async () => {
    asRunner()
    // Write a real recipe.yaml with max_attempts: 5 to the tmp recipes root.
    const recipeDir = join(tmpRecipesRoot, 'with-max')
    await mkdir(recipeDir, { recursive: true })
    await writeFile(
      join(recipeDir, 'recipe.yaml'),
      [
        'slug: with-max',
        'name: With Max',
        'image: some-img',
        'workspace_mode: worktree',
        'timeout_seconds: 300',
        'max_attempts: 5',
        'model:',
        '  primary: claude-sonnet-4-6',
      ].join('\n') + '\n',
      'utf8',
    )
    // Seed an indexed row with the same slug (recipes DB has no max_attempts
    // column — the value must come from the filesystem re-parse).
    seedRecipe('with-max', { modelPrimary: 'claude-sonnet-4-6' })
    const taskId = seedTask({ recipeSlug: 'with-max', runnerMaxAttempts: null })

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.runner_max_attempts).toBe(5)
  })

  // ------------- Auth / 403 for non-runner principals -------------

  it('returns 403 when the principal is operator-session rather than runner-secret (user.id !== -1000)', async () => {
    asOperatorSessionUser()
    const taskId = seedTask({})

    const { req, ctx } = claimReq(taskId)
    const res = await POST(req, ctx)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('runner-secret')
  })

  it('returns 404 when the task does not exist', async () => {
    asRunner()
    const { req, ctx } = claimReq(99999)
    const res = await POST(req, ctx)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('task not found')
  })
})
