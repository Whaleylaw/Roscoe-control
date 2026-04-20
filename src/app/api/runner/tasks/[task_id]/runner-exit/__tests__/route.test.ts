/**
 * Integration tests for POST /api/runner/tasks/:task_id/runner-exit (Plan 14-06).
 *
 * Each it() replaces an it.todo() stub from the Wave-0 scaffold (Plan 14-03).
 * Uses the in-memory better-sqlite3 + vi.mock pattern established by
 * src/app/api/runner/heartbeat/__tests__/route.test.ts.
 *
 * Covers RUNNER-11 (exit reporting drives retry/terminal + token revocation)
 * and WORK-06 (resolved cap precedence: task override > recipe.yaml > default 3).
 */

import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMigrations } from '@/lib/migrations'

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

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

const loggerWarnSpy = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: (...args: unknown[]) => loggerWarnSpy(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Imports AFTER mocks so the route picks them up.
import { POST } from '@/app/api/runner/tasks/[task_id]/runner-exit/route'
import { mutationLimiter } from '@/lib/rate-limit'

function asRunner() {
  // Matches the runner-SECRET branch in src/lib/auth.ts — id=-1000.
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

function asSessionOperator() {
  // Real logged-in operator user via session cookie — NOT the runner principal.
  // Route should 403 at the id-guard.
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

function asAuthFailure(status: 401 | 403 = 401) {
  requireRoleMock.mockReturnValueOnce({
    error: status === 401 ? 'Authentication required' : 'Requires operator role or higher',
    status,
  })
}

function makePost(
  taskId: number,
  body: unknown,
  headers: Record<string, string> = {},
): { req: NextRequest; params: Promise<{ task_id: string }> } {
  const req = new NextRequest(`http://localhost/api/runner/tasks/${taskId}/runner-exit`, {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    body: JSON.stringify(body),
  })
  return { req, params: Promise.resolve({ task_id: String(taskId) }) }
}

function seedTask(opts: {
  status?: string
  recipe_slug?: string | null
  runner_attempts?: number
  runner_max_attempts?: number | null
  container_id?: string | null
  runner_started_at?: number | null
}): number {
  const {
    status = 'in_progress',
    recipe_slug = 'hello-world',
    runner_attempts = 0,
    runner_max_attempts = null,
    container_id = null,
    runner_started_at = null,
  } = opts
  const result = testDb
    .prepare(
      `INSERT INTO tasks (title, status, recipe_slug, runner_attempts, runner_max_attempts,
                           container_id, runner_started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      't',
      status,
      recipe_slug,
      runner_attempts,
      runner_max_attempts,
      container_id,
      runner_started_at,
    )
  return Number(result.lastInsertRowid)
}

function seedAttempt(taskId: number, attempt: number, startedAt = 1_700_000_000) {
  testDb
    .prepare(
      `INSERT INTO task_runner_attempts (task_id, attempt, started_at) VALUES (?, ?, ?)`,
    )
    .run(taskId, attempt, startedAt)
}

function seedRunnerToken(
  taskId: number,
  attempt: number,
  tokenHash = 'hash-' + taskId + '-' + attempt,
  expiresAt = 9_999_999_999,
) {
  testDb
    .prepare(
      `INSERT INTO task_runner_tokens (task_id, attempt, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(taskId, attempt, tokenHash, expiresAt)
}

function getTask(taskId: number) {
  return testDb
    .prepare(
      `SELECT status, container_id, runner_started_at, runner_last_failure_reason,
              runner_attempts, runner_max_attempts
       FROM tasks WHERE id = ?`,
    )
    .get(taskId) as {
    status: string
    container_id: string | null
    runner_started_at: number | null
    runner_last_failure_reason: string | null
    runner_attempts: number
    runner_max_attempts: number | null
  }
}

function getAttempt(taskId: number, attempt: number) {
  return testDb
    .prepare(
      `SELECT attempt, exited_at, exit_code, failure_reason, stderr_tail
       FROM task_runner_attempts WHERE task_id = ? AND attempt = ?`,
    )
    .get(taskId, attempt) as
    | {
        attempt: number
        exited_at: number | null
        exit_code: number | null
        failure_reason: string | null
        stderr_tail: string | null
      }
    | undefined
}

let recipesRoot: string | null = null
const originalRecipesRootEnv = process.env.MISSION_CONTROL_RECIPES_DIR

beforeEach(async () => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  requireRoleMock.mockReset()
  vi.mocked(mutationLimiter).mockReset()
  vi.mocked(mutationLimiter).mockReturnValue(null)
  loggerWarnSpy.mockReset()
  recipesRoot = null
  delete process.env.MISSION_CONTROL_RECIPES_DIR
})

afterEach(async () => {
  testDb.close()
  if (recipesRoot) {
    await rm(recipesRoot, { recursive: true, force: true })
  }
  if (originalRecipesRootEnv === undefined) {
    delete process.env.MISSION_CONTROL_RECIPES_DIR
  } else {
    process.env.MISSION_CONTROL_RECIPES_DIR = originalRecipesRootEnv
  }
})

async function stageRecipeYaml(slug: string, body: string): Promise<string> {
  if (!recipesRoot) {
    recipesRoot = await mkdtemp(join(tmpdir(), 'mc14-06-'))
    process.env.MISSION_CONTROL_RECIPES_DIR = recipesRoot
  }
  await mkdir(join(recipesRoot, slug), { recursive: true })
  await writeFile(join(recipesRoot, slug, 'recipe.yaml'), body, 'utf8')
  return join(recipesRoot, slug, 'recipe.yaml')
}

function validRecipeYaml(overrides: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    slug: 'hello-world',
    name: 'Hello World',
    image: 'alpine',
    workspace_mode: 'worktree',
    timeout_seconds: 600,
    model: { primary: 'claude-opus-4-7' },
    ...overrides,
  }
  const lines: string[] = []
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      lines.push(`${k}:`)
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        lines.push(`  ${k2}: ${JSON.stringify(v2)}`)
      }
    } else if (v !== undefined) {
      lines.push(`${k}: ${JSON.stringify(v)}`)
    }
  }
  return lines.join('\n') + '\n'
}

describe('POST /api/runner/tasks/:task_id/runner-exit', () => {
  // --------------------------------------------------------------------------
  // 1. Successful exit persists attempt row and does NOT change task.status.
  // --------------------------------------------------------------------------
  it('RUNNER-11: successful exit (exit_code=0, reason=exit) persists task_runner_attempts row and does NOT change task.status', async () => {
    const taskId = seedTask({
      status: 'in_progress',
      runner_attempts: 1,
      container_id: 'pending:1:1',
      runner_max_attempts: 3,
    })
    seedAttempt(taskId, 1, 1_700_000_000)

    asRunner()
    const { req, params } = makePost(taskId, { exit_code: 0, reason: 'exit', attempt: 1 })
    const res = await POST(req, { params })

    expect(res.status).toBe(204)

    // task.status untouched — /submit owns the terminal flip.
    const task = getTask(taskId)
    expect(task.status).toBe('in_progress')
    expect(task.container_id).toBe('pending:1:1')

    // Attempt row updated.
    const att = getAttempt(taskId, 1)
    expect(att).toBeDefined()
    expect(att!.exited_at).toBeGreaterThan(0)
    expect(att!.exit_code).toBe(0)
    // failure_reason formula: reason='exit' && exit_code !== null → `exit:${exit_code}`.
    // exit_code=0 is non-null, so we get 'exit:0' — encodes the exit code even on
    // the happy path so the attempt-history UI can show '0' vs a missing run.
    expect(att!.failure_reason).toBe('exit:0')
    expect(att!.stderr_tail).toBeNull()
  })

  // --------------------------------------------------------------------------
  // 2. Non-zero exit with attempts < max → retry (assigned + container cleared).
  // --------------------------------------------------------------------------
  it('RUNNER-11: non-zero exit with attempts < max → status becomes assigned + container_id cleared', async () => {
    const taskId = seedTask({
      status: 'in_progress',
      runner_attempts: 1,
      runner_max_attempts: 3,
      container_id: 'pending:1:1',
      runner_started_at: 1_699_999_000,
    })
    seedAttempt(taskId, 1)

    asRunner()
    const { req, params } = makePost(taskId, {
      exit_code: 137,
      reason: 'exit',
      attempt: 1,
      stderr_tail: 'OOM killer',
    })
    const res = await POST(req, { params })

    expect(res.status).toBe(204)

    const task = getTask(taskId)
    expect(task.status).toBe('assigned')
    expect(task.container_id).toBeNull()
    expect(task.runner_started_at).toBeNull()
    expect(task.runner_last_failure_reason).toBe('exit:137')

    const att = getAttempt(taskId, 1)
    expect(att!.exit_code).toBe(137)
    expect(att!.failure_reason).toBe('exit:137')
    expect(att!.stderr_tail).toBe('OOM killer')
  })

  // --------------------------------------------------------------------------
  // 3. Attempts >= max → terminal fail + tokens revoked.
  // --------------------------------------------------------------------------
  it('WORK-06: attempts >= max → status=failed + runner_last_failure_reason + tokens revoked', async () => {
    const taskId = seedTask({
      status: 'in_progress',
      runner_attempts: 3,
      runner_max_attempts: 3,
      container_id: 'pending:1:3',
    })
    seedAttempt(taskId, 3)
    seedRunnerToken(taskId, 3)
    // Second active token to prove revocation affects ALL non-revoked rows.
    seedRunnerToken(taskId, 2, 'hash-other', 9_999_999_999)

    asRunner()
    const { req, params } = makePost(taskId, { exit_code: null, reason: 'timeout', attempt: 3 })
    const res = await POST(req, { params })

    expect(res.status).toBe(204)

    const task = getTask(taskId)
    expect(task.status).toBe('failed')
    expect(task.container_id).toBeNull()
    expect(task.runner_last_failure_reason).toBe('timeout')

    // Both tokens revoked atomically with the status flip.
    const tokens = testDb
      .prepare(
        `SELECT attempt, revoked_at FROM task_runner_tokens WHERE task_id = ? ORDER BY attempt ASC`,
      )
      .all(taskId) as Array<{ attempt: number; revoked_at: number | null }>
    expect(tokens).toHaveLength(2)
    for (const row of tokens) {
      expect(row.revoked_at).not.toBeNull()
      expect(row.revoked_at).toBeGreaterThan(0)
    }
  })

  // --------------------------------------------------------------------------
  // 4. Cap resolution precedence: task.runner_max_attempts ?? recipe.max_attempts ?? 3.
  // --------------------------------------------------------------------------
  it('WORK-06: max resolves via task.runner_max_attempts ?? resolveRecipeMaxAttempts ?? 3', async () => {
    // (a) Task override null, recipe.yaml declares max_attempts=5 →
    //     runner_attempts=5 should trigger terminal fail.
    await stageRecipeYaml('hello-world', validRecipeYaml({ max_attempts: 5 }))
    const taskIdRecipe = seedTask({
      status: 'in_progress',
      runner_attempts: 5,
      runner_max_attempts: null,
      container_id: 'pending:1:5',
    })
    seedAttempt(taskIdRecipe, 5)
    seedRunnerToken(taskIdRecipe, 5)

    asRunner()
    const recipeCall = makePost(taskIdRecipe, { exit_code: 1, reason: 'exit', attempt: 5 })
    const resRecipe = await POST(recipeCall.req, { params: recipeCall.params })
    expect(resRecipe.status).toBe(204)
    expect(getTask(taskIdRecipe).status).toBe('failed')

    // (b) Task override null, recipe.yaml has NO max_attempts → default 3;
    //     runner_attempts=3 should trigger terminal fail.
    await stageRecipeYaml('fallback-recipe', validRecipeYaml({ slug: 'fallback-recipe' }))
    const taskIdFallback = seedTask({
      status: 'in_progress',
      recipe_slug: 'fallback-recipe',
      runner_attempts: 3,
      runner_max_attempts: null,
      container_id: 'pending:2:3',
    })
    seedAttempt(taskIdFallback, 3)

    asRunner()
    const fallbackCall = makePost(taskIdFallback, { exit_code: 1, reason: 'exit', attempt: 3 })
    const resFallback = await POST(fallbackCall.req, { params: fallbackCall.params })
    expect(resFallback.status).toBe(204)
    expect(getTask(taskIdFallback).status).toBe('failed')

    // (c) Default (3) — one below should retry rather than fail.
    const taskIdRetry = seedTask({
      status: 'in_progress',
      recipe_slug: 'fallback-recipe',
      runner_attempts: 2,
      runner_max_attempts: null,
      container_id: 'pending:3:2',
    })
    seedAttempt(taskIdRetry, 2)

    asRunner()
    const retryCall = makePost(taskIdRetry, { exit_code: 1, reason: 'exit', attempt: 2 })
    const resRetry = await POST(retryCall.req, { params: retryCall.params })
    expect(resRetry.status).toBe(204)
    expect(getTask(taskIdRetry).status).toBe('assigned')
  })

  // --------------------------------------------------------------------------
  // 5. Non-runner principal → 403.
  // --------------------------------------------------------------------------
  it('RUNNER-11: rejects non-runner-secret bearer with 403', async () => {
    const taskId = seedTask({ status: 'in_progress', runner_attempts: 1 })
    seedAttempt(taskId, 1)

    asSessionOperator()
    const { req, params } = makePost(taskId, { exit_code: 1, reason: 'exit', attempt: 1 })
    const res = await POST(req, { params })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/runner-secret/i)

    // Also cover the 401 path for completeness — no bearer at all.
    asAuthFailure(401)
    const second = makePost(taskId, { exit_code: 1, reason: 'exit', attempt: 1 })
    const res2 = await POST(second.req, { params: second.params })
    expect(res2.status).toBe(401)

    // State should be unchanged after both rejections.
    const task = getTask(taskId)
    expect(task.status).toBe('in_progress')
    expect(task.runner_last_failure_reason).toBeNull()
  })

  // --------------------------------------------------------------------------
  // 6. 409 when task is already terminal (idempotency).
  // --------------------------------------------------------------------------
  it('RUNNER-11: 409 when task already terminal (idempotency)', async () => {
    const taskId = seedTask({
      status: 'failed',
      runner_attempts: 3,
      runner_max_attempts: 3,
    })
    seedAttempt(taskId, 3)

    asRunner()
    const { req, params } = makePost(taskId, { exit_code: 1, reason: 'exit', attempt: 3 })
    const res = await POST(req, { params })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/terminal/i)
    expect(body.status).toBe('failed')

    // Attempt row untouched — idempotency guard prevents the UPDATE.
    const att = getAttempt(taskId, 3)
    expect(att!.exited_at).toBeNull()
    expect(att!.exit_code).toBeNull()
  })

  // --------------------------------------------------------------------------
  // 7. worktree_create_failed forces immediate fail even when attempts < max.
  // --------------------------------------------------------------------------
  it("RUNNER-11: reason='worktree_create_failed' forces immediate fail even when attempts < max", async () => {
    const taskId = seedTask({
      status: 'in_progress',
      runner_attempts: 1,
      runner_max_attempts: 5,
      container_id: 'pending:1:1',
    })
    seedAttempt(taskId, 1)
    seedRunnerToken(taskId, 1)

    asRunner()
    const { req, params } = makePost(taskId, {
      exit_code: null,
      reason: 'worktree_create_failed',
      attempt: 1,
    })
    const res = await POST(req, { params })

    expect(res.status).toBe(204)

    // Terminal fail despite only 1 of 5 attempts used.
    const task = getTask(taskId)
    expect(task.status).toBe('failed')
    expect(task.runner_last_failure_reason).toBe('worktree_create_failed')
    expect(task.container_id).toBeNull()

    // Token revoked.
    const token = testDb
      .prepare(`SELECT revoked_at FROM task_runner_tokens WHERE task_id = ?`)
      .get(taskId) as { revoked_at: number | null }
    expect(token.revoked_at).not.toBeNull()
  })

  // --------------------------------------------------------------------------
  // 8. Missing task_runner_attempts row — defensive warn-log + continue.
  // --------------------------------------------------------------------------
  it('RUNNER-11: missing task_runner_attempts row — UPDATE affects 0 rows — handler warn-logs and still transitions status', async () => {
    const taskId = seedTask({
      status: 'in_progress',
      runner_attempts: 1,
      runner_max_attempts: 3,
      container_id: 'pending:1:1',
    })
    // Intentionally NO seedAttempt — the row the claim route should have
    // inserted is missing. Handler must still flip the status.

    asRunner()
    const { req, params } = makePost(taskId, { exit_code: 1, reason: 'exit', attempt: 1 })
    const res = await POST(req, { params })

    expect(res.status).toBe(204)

    // Status still transitions (retry branch — attempts 1 < max 3).
    const task = getTask(taskId)
    expect(task.status).toBe('assigned')
    expect(task.container_id).toBeNull()
    expect(task.runner_last_failure_reason).toBe('exit:1')

    // Defensive warn-log fired — payload shape is documented in route.ts.
    expect(loggerWarnSpy).toHaveBeenCalledTimes(1)
    const [payload, message] = loggerWarnSpy.mock.calls[0]
    expect(payload).toMatchObject({ task_id: taskId, attempt: 1 })
    expect(message).toMatch(/task_runner_attempts UPDATE affected 0 rows/i)
  })
})
