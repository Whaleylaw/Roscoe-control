/**
 * Phase 15 Plan 15-02 Task 5: POST /api/tasks emits task.runner_requested when
 * a new task is created `status='assigned' && recipe_slug` (SCHED-05).
 *
 * Pattern mirrors src/app/api/tasks/__tests__/route.runtime-context.test.ts —
 * in-memory better-sqlite3 DB + runMigrations + mocked auth/rate-limit/event-bus.
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'

let testDb: Database.Database
const broadcast = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    logActivity: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    createNotification: vi.fn(),
  },
  Task: {},
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: () => ({
    user: {
      id: 7,
      username: 'tester',
      display_name: 'Tester',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
    },
  }),
}))

vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: (...args: unknown[]) => broadcast(...args) },
}))
vi.mock('@/lib/github-sync-engine', () => ({
  pushTaskToGitHub: vi.fn(),
  syncTaskOutbound: vi.fn(),
}))
vi.mock('@/lib/gnap-sync', () => ({ pushTaskToGnap: vi.fn() }))
vi.mock('@/lib/mentions', () => ({
  resolveMentionRecipients: () => ({ recipients: [], unresolved: [] }),
}))
vi.mock('@/lib/config', () => ({
  config: { gnap: { enabled: false, autoSync: false, repoPath: '/tmp/noop' } },
}))

import { POST } from '@/app/api/tasks/route'

function seedRecipe(slug: string, workspaceMode: 'worktree' | 'readonly' = 'readonly') {
  testDb.prepare(`
    INSERT INTO recipes (slug, name, description, when_to_use, image, workspace_mode,
      timeout_seconds, max_concurrent, env_json, secrets_json, tags_json, model_json,
      version, dir_sha, soul_md, error_message, workspace_id, tenant_id)
    VALUES (?, ?, 'desc', 'when', 'ubuntu', ?, 600, 1, '{}', '[]', '[]', ?, 1, 'sha', NULL, NULL, 1, 1)
  `).run(slug, slug, workspaceMode, JSON.stringify({ primary: 'claude-opus-4-7' }))
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  broadcast.mockClear()
})

afterEach(() => {
  testDb.close()
})

function jsonReq(body: unknown): NextRequest {
  return new NextRequest('http://x/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readBody(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function runnerRequestedCalls() {
  return broadcast.mock.calls.filter((c) => c[0] === 'task.runner_requested')
}

describe('POST /api/tasks — task.runner_requested emission (SCHED-05)', () => {
  it('status=assigned + recipe_slug → emits task.runner_requested exactly once', async () => {
    seedRecipe('hello-world')
    const res = await POST(jsonReq({ title: 'emit-me', status: 'assigned', recipe_slug: 'hello-world' }))
    expect(res.status).toBe(201)
    const body = await readBody(res)

    const calls = runnerRequestedCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toMatchObject({
      task_id: body.task.id,
      recipe_slug: 'hello-world',
      workspace_id: 1,
    })
  })

  it('status=inbox + recipe_slug (no assigned_to) → does NOT emit', async () => {
    // No assigned_to, so normalizeTaskCreateStatus leaves status='inbox'.
    // autoRouteInboxTasks will emit later — this handler must not.
    seedRecipe('hello-world')
    const res = await POST(jsonReq({ title: 'inbox-recipe', status: 'inbox', recipe_slug: 'hello-world' }))
    expect(res.status).toBe(201)
    expect(runnerRequestedCalls()).toHaveLength(0)
  })

  it('status=inbox + assigned_to (auto-upgrade to assigned) + NO recipe → does NOT emit', async () => {
    // normalizeTaskCreateStatus flips status to 'assigned' because assigned_to is set.
    // No recipe_slug → no runner involvement → no emit.
    const res = await POST(jsonReq({ title: 'legacy-assign', status: 'inbox', assigned_to: 'aegis' }))
    expect(res.status).toBe(201)
    expect(runnerRequestedCalls()).toHaveLength(0)
  })

  it('status=assigned + recipe_slug + assigned_to → emits (recipe wins)', async () => {
    // Even when assigned_to is set alongside recipe_slug, the recipe path takes
    // precedence: the runner-token holder claims via the Phase 14 daemon.
    seedRecipe('hello-world')
    const res = await POST(jsonReq({
      title: 'both-fields',
      status: 'assigned',
      recipe_slug: 'hello-world',
      assigned_to: 'aegis',
    }))
    expect(res.status).toBe(201)
    const body = await readBody(res)

    const calls = runnerRequestedCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toMatchObject({ task_id: body.task.id, recipe_slug: 'hello-world' })
  })

  it('unknown recipe_slug → 400 + no broadcast of any kind', async () => {
    const res = await POST(jsonReq({ title: 'missing-recipe', status: 'assigned', recipe_slug: 'not-there' }))
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors[0].code).toBe('RECIPE_NOT_FOUND')

    expect(broadcast).not.toHaveBeenCalled()
  })

  it('auto-upgrade (inbox→assigned via assigned_to) WITH recipe_slug → emits', async () => {
    // Body requests status='inbox', but assigned_to is set AND recipe_slug is
    // provided. normalizeTaskCreateStatus flips to 'assigned'. The handler
    // reads parsedTask.status (post-normalize) so the emission fires.
    seedRecipe('hello-world')
    const res = await POST(jsonReq({
      title: 'auto-upgrade-with-recipe',
      status: 'inbox',
      assigned_to: 'aegis',
      recipe_slug: 'hello-world',
    }))
    expect(res.status).toBe(201)
    const body = await readBody(res)
    expect(body.task.status).toBe('assigned')

    const calls = runnerRequestedCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toMatchObject({ task_id: body.task.id, recipe_slug: 'hello-world' })
  })
})
