/**
 * Phase 20 Plan 20-03 — cross-path blocker event parity (ROUTE-02).
 *
 * Drives the four `task.blocker_transition` emission sites through their real
 * handlers and asserts the same 10 payload keys with consistent types across
 * both paths, both directions.
 *
 * The existing phase-15-blocker-flow-integration.test.ts covers the full
 * recipe blocker → resume worktree + JSONL flow. This file's scope is
 * narrow: event shape parity across paths. It does NOT rebuild the
 * full runner worktree setup (that's already covered) — it only seeds
 * enough state for the four handlers to fire their transitions.
 *
 * Sites:
 *   1. Recipe pause — POST /api/tasks/:id/checkpoints with status='blocked'.
 *   2. Legacy pause — PUT /api/tasks/:id with status='awaiting_owner' + envelope.
 *   3. Legacy resume — PUT /api/tasks/:id with status='assigned' from awaiting_owner.
 *   4. Recipe resume — PUT /api/tasks/:id with status='assigned' from awaiting_owner
 *      on a recipe-tagged task (generic write path).
 */

import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { issueRunnerToken } from '@/lib/runner-tokens'

let testDb: Database.Database
let worktreeRoot: string

const broadcastMock = vi.fn()

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

vi.mock('@/lib/runner-secret', () => ({
  getRunnerSecret: () => 'known-runner-secret-test-value-abc-1234567890',
  ensureRunnerSecret: vi.fn(() => 'known-runner-secret-test-value-abc-1234567890'),
  RUNNER_SECRET_FILENAME: '.data/runner.secret',
}))

vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: vi.fn(),
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  // Real requireRole for runner-token paths; operator for PUT tests overrides
  // via a small wrapper. We use a case-split: when the request carries an
  // Authorization bearer header, defer to the real runner-token auth chain;
  // otherwise return an operator principal for PUT callers.
  return {
    ...actual,
    requireRole: (req: Request, _role: string) => {
      const authHeader = req.headers.get?.('authorization') ?? null
      if (authHeader && authHeader.startsWith('Bearer ')) {
        return actual.requireRole(req as never, _role as never)
      }
      return {
        user: {
          id: 7,
          username: 'tester',
          display_name: 'Tester',
          role: 'operator',
          workspace_id: 1,
          tenant_id: 1,
        },
      }
    },
  }
})

vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: (...args: unknown[]) => broadcastMock(...args) },
}))
vi.mock('@/lib/github-sync-engine', () => ({
  pushTaskToGitHub: vi.fn(),
  syncTaskOutbound: vi.fn(),
}))
vi.mock('@/lib/gnap-sync', () => ({
  pushTaskToGnap: vi.fn(),
  removeTaskFromGnap: vi.fn(),
}))
vi.mock('@/lib/mentions', () => ({
  resolveMentionRecipients: () => ({ recipients: [], unresolved: [] }),
}))
vi.mock('@/lib/config', () => ({
  config: {
    gnap: { enabled: false, autoSync: false, repoPath: '/tmp/noop' },
    openclawHome: null,
  },
}))
vi.mock('@/lib/openclaw-gateway', () => ({ callOpenClawGateway: vi.fn() }))
vi.mock('@/lib/command', () => ({ runOpenClaw: vi.fn() }))

const { POST: checkpointsPOST } = await import('@/app/api/tasks/[id]/checkpoints/route')
const { PUT: tasksPUT } = await import('@/app/api/tasks/[id]/route')
const { autoRouteInboxTasks } = await import('@/lib/task-dispatch')

// ---------- Shape helper ----------------------------------------------------

const EXPECTED_KEYS = [
  'task_id', 'workspace_id', 'direction', 'previous_status', 'status',
  'blocker_reason', 'blocker_kind', 'resume_hint', 'source', 'attempt', 'ts',
].sort()

function assertBlockerTransitionShape(
  payload: Record<string, unknown>,
  expected: Partial<Record<string, unknown>>,
) {
  expect(Object.keys(payload).sort()).toEqual(EXPECTED_KEYS)
  expect(typeof payload.task_id).toBe('number')
  expect(typeof payload.workspace_id).toBe('number')
  expect(['paused', 'resumed']).toContain(payload.direction)
  expect(['recipe', 'legacy']).toContain(payload.source)
  expect(typeof payload.ts).toBe('number')
  // Nullable fields — assert null or string (not undefined).
  for (const k of ['blocker_reason', 'blocker_kind', 'resume_hint'] as const) {
    if (payload[k] !== null) expect(typeof payload[k]).toBe('string')
  }
  // attempt: number on recipe path, null on legacy.
  if (payload.source === 'recipe') {
    expect(typeof payload.attempt === 'number' || payload.attempt === null).toBe(true)
  }
  if (payload.source === 'legacy') {
    expect(payload.attempt).toBeNull()
  }
  // Per-direction invariants.
  if (payload.direction === 'paused') {
    expect(payload.previous_status).toBe('in_progress')
    expect(payload.status).toBe('awaiting_owner')
  } else {
    expect(payload.previous_status).toBe('awaiting_owner')
    expect(payload.status).toBe('assigned')
  }
  // Per-call expected overrides.
  for (const [k, v] of Object.entries(expected)) {
    expect(payload[k]).toEqual(v)
  }
}

function findBlockerEvents(): Array<{ type: string; payload: Record<string, unknown> }> {
  return broadcastMock.mock.calls
    .filter((call) => call[0] === 'task.blocker_transition')
    .map((call) => ({
      type: call[0] as string,
      payload: call[1] as Record<string, unknown>,
    }))
}

// ---------- Fixture helpers -------------------------------------------------

function seedWorkspace() {
  const existing = testDb
    .prepare(`SELECT id FROM workspaces WHERE id = 1`)
    .get() as { id?: number } | undefined
  if (!existing) {
    testDb
      .prepare(
        `INSERT INTO workspaces (id, slug, name, tenant_id)
         VALUES (1, 'ws-1', 'Workspace 1', 1)`,
      )
      .run()
  }
}

interface SeedTaskOpts {
  id: number
  status: string
  assigned_to?: string | null
  recipe_slug?: string | null
  worktree_path?: string | null
  runner_attempts?: number
  runner_last_failure_reason?: string | null
}

function insertTask(opts: SeedTaskOpts) {
  const now = Math.floor(Date.now() / 1000)
  testDb
    .prepare(
      `INSERT INTO tasks
         (id, title, status, priority, workspace_id, assigned_to, recipe_slug,
          worktree_path, runner_attempts, runner_last_failure_reason,
          created_at, updated_at, tags, metadata)
       VALUES (?, ?, ?, 'medium', 1, ?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
    )
    .run(
      opts.id,
      `task-${opts.id}`,
      opts.status,
      opts.assigned_to ?? null,
      opts.recipe_slug ?? null,
      opts.worktree_path ?? null,
      opts.runner_attempts ?? 1,
      opts.runner_last_failure_reason ?? null,
      now,
      now,
    )
}

function insertRecipe(slug: string) {
  testDb
    .prepare(
      `INSERT INTO recipes
         (slug, name, description, when_to_use, image, workspace_mode,
          timeout_seconds, max_concurrent, env_json, secrets_json, tags_json,
          model_json, version, dir_sha, soul_md, error_message, workspace_id, tenant_id)
       VALUES (?, ?, 'desc', 'when', 'ubuntu', 'readonly', 600, 1,
         '{}', '[]', '[]', ?, 1, 'sha-recipe', NULL, NULL, 1, 1)`,
    )
    .run(slug, slug, JSON.stringify({ primary: 'claude-opus-4-7' }))
}

function makePutRequest(id: number, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeCheckpointRequest(
  id: number,
  bearer: string,
  body: unknown,
): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${id}/checkpoints`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  })
}

// ---------- Lifecycle -------------------------------------------------------

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  seedWorkspace()
  worktreeRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'phase-20-blocker-parity-'),
  )
  process.env.API_KEY = 'test-admin-api-key-aaaaaaaaaaaaaaaaaaa'
  process.env.MC_PROXY_AUTH_HEADER = ''
  broadcastMock.mockReset()
})

afterEach(() => {
  testDb.close()
  try {
    fs.rmSync(worktreeRoot, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
  vi.clearAllMocks()
})

// ---------- Tests -----------------------------------------------------------

describe('Phase 20 Plan 20-03 — task.blocker_transition parity (ROUTE-02)', () => {
  it('Site 1 — recipe pause emits one task.blocker_transition with source=recipe, direction=paused', async () => {
    const taskId = 200
    insertRecipe('hello-world')
    insertTask({
      id: taskId,
      status: 'in_progress',
      assigned_to: 'agent-runner',
      recipe_slug: 'hello-world',
      worktree_path: worktreeRoot,
      runner_attempts: 1,
    })
    // Pre-create the .mc/ dir so the checkpoint write path finds a valid
    // worktree. Matches phase-15 integration test seeding.
    fs.mkdirSync(path.join(worktreeRoot, '.mc'), { recursive: true })

    const { token } = issueRunnerToken(testDb, taskId, 1, 300)
    const res = await checkpointsPOST(
      makeCheckpointRequest(taskId, token, {
        step: 'waiting',
        summary: 'need human input',
        status: 'blocked',
        blocker_reason: 'Need the final budget number from legal',
      }),
      { params: Promise.resolve({ id: String(taskId) }) },
    )
    expect(res.status).toBe(201)

    const events = findBlockerEvents()
    expect(events).toHaveLength(1)
    assertBlockerTransitionShape(events[0].payload, {
      task_id: taskId,
      workspace_id: 1,
      source: 'recipe',
      direction: 'paused',
      blocker_kind: null,
      resume_hint: null,
      attempt: 1,
      blocker_reason: 'Need the final budget number from legal',
    })
  })

  it('Site 2 — legacy pause emits one task.blocker_transition with source=legacy, direction=paused, full envelope', async () => {
    const taskId = 201
    insertTask({
      id: taskId,
      status: 'in_progress',
      assigned_to: 'agent-alice',
      recipe_slug: null,
    })

    const res = await tasksPUT(
      makePutRequest(taskId, {
        status: 'awaiting_owner',
        blocker_reason: 'Need budget confirmation',
        blocker_kind: 'needs_input',
        resume_hint: 'reply in a comment',
      }),
      { params: Promise.resolve({ id: String(taskId) }) },
    )
    expect(res.status).toBe(200)

    const events = findBlockerEvents()
    expect(events).toHaveLength(1)
    assertBlockerTransitionShape(events[0].payload, {
      task_id: taskId,
      workspace_id: 1,
      source: 'legacy',
      direction: 'paused',
      blocker_reason: 'Need budget confirmation',
      blocker_kind: 'needs_input',
      resume_hint: 'reply in a comment',
      attempt: null,
    })
  })

  it('Site 3 — legacy resume emits one task.blocker_transition with source=legacy, direction=resumed, pre-clear envelope context', async () => {
    const taskId = 202
    const envelope = JSON.stringify({
      blocker_reason: 'Needed budget',
      blocker_kind: 'needs_input',
      resume_hint: 'Reply with budget',
    })
    insertTask({
      id: taskId,
      status: 'awaiting_owner',
      assigned_to: 'agent-alice',
      recipe_slug: null,
      runner_last_failure_reason: envelope,
    })

    const res = await tasksPUT(
      makePutRequest(taskId, { status: 'assigned' }),
      { params: Promise.resolve({ id: String(taskId) }) },
    )
    expect(res.status).toBe(200)

    const events = findBlockerEvents()
    expect(events).toHaveLength(1)
    assertBlockerTransitionShape(events[0].payload, {
      task_id: taskId,
      workspace_id: 1,
      source: 'legacy',
      direction: 'resumed',
      blocker_reason: 'Needed budget',
      blocker_kind: 'needs_input',
      resume_hint: 'Reply with budget',
      attempt: null,
    })

    // Sanity: DB row cleared.
    const row = testDb
      .prepare('SELECT runner_last_failure_reason FROM tasks WHERE id = ?')
      .get(taskId) as { runner_last_failure_reason: string | null }
    expect(row.runner_last_failure_reason).toBeNull()
  })

  it('Site 4 — recipe resume emits one task.blocker_transition with source=recipe, direction=resumed, best-effort reason', async () => {
    const taskId = 203
    insertRecipe('hello-world')
    insertTask({
      id: taskId,
      status: 'awaiting_owner',
      assigned_to: 'agent-runner',
      recipe_slug: 'hello-world',
      worktree_path: worktreeRoot,
      runner_attempts: 2,
      runner_last_failure_reason: 'blocked:need human input',
    })

    const res = await tasksPUT(
      makePutRequest(taskId, { status: 'assigned' }),
      { params: Promise.resolve({ id: String(taskId) }) },
    )
    expect(res.status).toBe(200)

    const events = findBlockerEvents()
    expect(events).toHaveLength(1)
    assertBlockerTransitionShape(events[0].payload, {
      task_id: taskId,
      workspace_id: 1,
      source: 'recipe',
      direction: 'resumed',
      blocker_reason: 'need human input',
      blocker_kind: null,
      resume_hint: null,
      attempt: 2,
    })
  })

  it('identical key set across all four emission sites', async () => {
    // Drive all four sites in sequence against distinct task ids and capture
    // every payload. Assert the JSON key set (post-sort) is identical across
    // all four — the primary contract of ROUTE-02.
    const capturedPayloads: Array<Record<string, unknown>> = []

    // --- Site 1: recipe pause ---
    insertRecipe('hello-world')
    insertTask({
      id: 300,
      status: 'in_progress',
      assigned_to: 'agent-runner',
      recipe_slug: 'hello-world',
      worktree_path: worktreeRoot,
      runner_attempts: 1,
    })
    fs.mkdirSync(path.join(worktreeRoot, '.mc'), { recursive: true })
    const { token } = issueRunnerToken(testDb, 300, 1, 300)
    await checkpointsPOST(
      makeCheckpointRequest(300, token, {
        step: 'waiting',
        summary: 'blocked',
        status: 'blocked',
        blocker_reason: 'recipe pause reason',
      }),
      { params: Promise.resolve({ id: '300' }) },
    )
    capturedPayloads.push(findBlockerEvents()[0].payload)
    broadcastMock.mockClear()

    // --- Site 2: legacy pause ---
    insertTask({
      id: 301,
      status: 'in_progress',
      assigned_to: 'agent-alice',
      recipe_slug: null,
    })
    await tasksPUT(
      makePutRequest(301, {
        status: 'awaiting_owner',
        blocker_reason: 'Legacy pause reason',
        blocker_kind: 'needs_approval',
        resume_hint: 'approve the gate',
      }),
      { params: Promise.resolve({ id: '301' }) },
    )
    capturedPayloads.push(findBlockerEvents()[0].payload)
    broadcastMock.mockClear()

    // --- Site 3: legacy resume ---
    insertTask({
      id: 302,
      status: 'awaiting_owner',
      assigned_to: 'agent-alice',
      recipe_slug: null,
      runner_last_failure_reason: JSON.stringify({
        blocker_reason: 'prior reason',
        blocker_kind: 'external_dependency',
        resume_hint: 'wait for vendor',
      }),
    })
    await tasksPUT(
      makePutRequest(302, { status: 'assigned' }),
      { params: Promise.resolve({ id: '302' }) },
    )
    capturedPayloads.push(findBlockerEvents()[0].payload)
    broadcastMock.mockClear()

    // --- Site 4: recipe resume ---
    insertTask({
      id: 303,
      status: 'awaiting_owner',
      assigned_to: 'agent-runner',
      recipe_slug: 'hello-world',
      worktree_path: worktreeRoot,
      runner_attempts: 3,
      runner_last_failure_reason: 'blocked:vendor delayed',
    })
    await tasksPUT(
      makePutRequest(303, { status: 'assigned' }),
      { params: Promise.resolve({ id: '303' }) },
    )
    capturedPayloads.push(findBlockerEvents()[0].payload)

    expect(capturedPayloads).toHaveLength(4)
    const keySets = capturedPayloads.map((p) => Object.keys(p).sort())
    // Every payload exposes exactly the same 11 keys in the same order.
    for (let i = 1; i < keySets.length; i++) {
      expect(keySets[i]).toEqual(keySets[0])
    }
    // And every payload's shape passes the helper.
    const expectations: Array<Parameters<typeof assertBlockerTransitionShape>[1]> = [
      { source: 'recipe', direction: 'paused' },
      { source: 'legacy', direction: 'paused' },
      { source: 'legacy', direction: 'resumed' },
      { source: 'recipe', direction: 'resumed' },
    ]
    for (let i = 0; i < capturedPayloads.length; i++) {
      assertBlockerTransitionShape(capturedPayloads[i], expectations[i])
    }
  })

  it('non-blocker status changes do NOT emit task.blocker_transition', async () => {
    // Sequence of legitimate non-blocker PUTs across several distinct tasks —
    // none of them should ever fire task.blocker_transition.
    //
    // inbox → assigned (normal routing / manual)
    insertTask({ id: 400, status: 'inbox', assigned_to: null, recipe_slug: null })
    await tasksPUT(
      makePutRequest(400, { status: 'assigned', assigned_to: 'agent-alice' }),
      { params: Promise.resolve({ id: '400' }) },
    )

    // backlog → inbox (triage)
    insertTask({ id: 401, status: 'backlog', assigned_to: null, recipe_slug: null })
    await tasksPUT(
      makePutRequest(401, { status: 'inbox' }),
      { params: Promise.resolve({ id: '401' }) },
    )

    // review → quality_review (Aegis flow)
    insertTask({ id: 402, status: 'review', assigned_to: 'agent-alice', recipe_slug: null })
    await tasksPUT(
      makePutRequest(402, { status: 'quality_review' }),
      { params: Promise.resolve({ id: '402' }) },
    )

    // Direct scheduler write: in_progress → failed via plain SQL (simulates
    // dispatchAssignedTasks catch branch / requeueStaleTasks max-retries).
    insertTask({ id: 403, status: 'in_progress', assigned_to: 'agent-alice', recipe_slug: null })
    testDb
      .prepare(
        `UPDATE tasks SET status = 'failed', error_message = 'Dispatch failed 5 times',
                          dispatch_attempts = 5, updated_at = unixepoch()
         WHERE id = ?`,
      )
      .run(403)

    const events = findBlockerEvents()
    expect(events).toHaveLength(0)
  })

  it('recipe fast-path autoRoute emissions are unchanged (COMPAT-02 sanity via event stream)', async () => {
    // Seed a recipe-tagged inbox task — exactly what autoRouteInboxTasks
    // should claim via the recipe fast-path block at task-dispatch.ts:1083-1111.
    insertRecipe('hello-world')
    testDb
      .prepare(
        `INSERT INTO tasks (title, status, priority, project_id, created_at,
           updated_at, workspace_id, recipe_slug, assigned_to, tags, metadata)
         VALUES ('auto-route', 'inbox', 'medium', 1, ?, ?, 1, 'hello-world',
           NULL, '[]', '{}')`,
      )
      .run(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))

    await autoRouteInboxTasks()

    const runnerRequestedCalls = broadcastMock.mock.calls.filter(
      (c) => c[0] === 'task.runner_requested',
    )
    const statusChangedAutoRouteRecipe = broadcastMock.mock.calls.filter(
      (c) =>
        c[0] === 'task.status_changed' &&
        (c[1] as { reason?: string })?.reason === 'auto_route_recipe',
    )
    expect(runnerRequestedCalls).toHaveLength(1)
    expect(statusChangedAutoRouteRecipe).toHaveLength(1)

    // Zero blocker-transition events on the auto-route path — auto-routing
    // is not a blocker transition.
    const blockerEvents = findBlockerEvents()
    expect(blockerEvents).toHaveLength(0)
  })
})
