/**
 * Phase 15 Plan 15-07 Task 3 — blocker → resume full-flow integration.
 *
 * Purpose: end-to-end integration of the 5-phase blocker → resume flow
 * documented in 15-CONTEXT.md § "Blocker & Resume Flow". This test composes
 * the real modules delivered by Plans 15-03, 15-04, 15-05:
 *
 *   Phase 1 — seed task in_progress with recipe_slug, runner_attempts=1,
 *             worktree_path pointing at mkdtemp; pre-populate progress.md
 *             and checkpoints.jsonl.
 *   Phase 2 — agent POSTs a `status: blocked` checkpoint via the REAL POST
 *             handler (src/app/api/tasks/[id]/checkpoints/route.ts).
 *             Assert atomic 4-op transaction: task_checkpoints INSERT +
 *             JSONL append + tasks.status flip + system comment INSERT.
 *   Phase 3 — owner flips awaiting_owner → assigned (simulated via direct
 *             SQL UPDATE per the plan — exercising PUT /api/tasks/:id is
 *             Phase 10 territory). Bump runner_attempts to 2 to simulate the
 *             claim-time increment.
 *   Phase 4 — resolveResumeMarker(db, taskId) called directly; MUST return
 *             { blocker_reason, at_iso } from the latest-and-blocked rule.
 *   Phase 5 — seedMcDir(worktree, { task: {..., is_resuming: true}, resume_marker })
 *             called directly (simulating the daemon's inline call). Assert the
 *             LOCKED marker line is appended to progress.md, checkpoints.jsonl
 *             is PRESERVED, and task.json is REWRITTEN with attempt=2,
 *             is_resuming=true, prior_attempts carrying the previous attempt.
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
}))

vi.mock('@/lib/runner-secret', () => ({
  getRunnerSecret: () => 'known-runner-secret-test-value-abc-1234567890',
  ensureRunnerSecret: vi.fn(() => 'known-runner-secret-test-value-abc-1234567890'),
  RUNNER_SECRET_FILENAME: '.data/runner.secret',
}))

vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: () => null,
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast: (...args: unknown[]) => broadcastMock(...args),
    on: vi.fn(),
    emit: vi.fn(),
  },
}))

import type { McTaskJson } from '@/lib/runner-worktree'

const { POST } = await import('@/app/api/tasks/[id]/checkpoints/route')
const { resolveResumeMarker } = await import('@/lib/runner-claim')
const { seedMcDir } = await import('@/lib/runner-worktree')
// McTaskJson imported purely for type-assertion below (reference keeps the
// compiler honest when we construct the seedMcDir input).
void ({} as McTaskJson | null)

const TASK_ID = 42
const RECIPE_SLUG = 'hello-world'

function seedWorkspace(): void {
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

function buildReq(
  bearer: string | null,
  body: unknown,
): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const url = `http://localhost/api/tasks/${TASK_ID}/checkpoints`
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  seedWorkspace()
  worktreeRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'phase-15-blocker-flow-'),
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
  vi.restoreAllMocks()
})

// -------------------------------------------------------------------------
// End-to-end test — one large `it(...)` covering all 5 phases.
// -------------------------------------------------------------------------

describe('Phase 15 end-to-end: blocker → awaiting_owner → resume → progress.md marker', () => {
  it('exercises the full 5-phase flow across POST handler + resolveResumeMarker + seedMcDir', async () => {
    // -----------------------------------------------------------------
    // Phase 1 — seed.
    // -----------------------------------------------------------------
    testDb
      .prepare(
        `INSERT INTO tasks
           (id, title, status, priority, workspace_id, worktree_path,
            runner_attempts, recipe_slug)
         VALUES (?, ?, 'in_progress', 'medium', 1, ?, 1, ?)`,
      )
      .run(TASK_ID, `task ${TASK_ID}`, worktreeRoot, RECIPE_SLUG)

    // Pre-populate .mc/ so preservation semantics can be asserted after
    // the blocker POST. This mimics a runner that already started processing.
    const mcDir = path.join(worktreeRoot, '.mc')
    fs.mkdirSync(mcDir, { recursive: true })
    const initialProgress = `# Progress — Task ${TASK_ID}\n\nInitial progress.\n`
    fs.writeFileSync(path.join(mcDir, 'progress.md'), initialProgress)
    const preExistingCheckpointLine = JSON.stringify({
      id: 0,
      task_id: TASK_ID,
      attempt: 1,
      ts: new Date().toISOString(),
      step: 'pre-existing',
      summary: 'pre-existing completed step',
      status: 'completed',
      artifacts: [],
      next_step: null,
      blocker_reason: null,
      tokens_used: null,
      duration_ms: null,
    })
    fs.writeFileSync(
      path.join(mcDir, 'checkpoints.jsonl'),
      preExistingCheckpointLine + '\n',
    )
    const jsonlSizeAtPhase1End = fs.statSync(
      path.join(mcDir, 'checkpoints.jsonl'),
    ).size

    // -----------------------------------------------------------------
    // Phase 2 — agent POSTs blocker checkpoint.
    // -----------------------------------------------------------------
    const blockerReason = 'AWS_ACCESS_KEY expired — rotate in console'
    const { token } = issueRunnerToken(testDb, TASK_ID, 1, 300)
    const res = await POST(
      buildReq(token, {
        step: 'waiting-for-review',
        summary: 'need secret rotation',
        status: 'blocked',
        blocker_reason: blockerReason,
      }),
      { params: Promise.resolve({ id: String(TASK_ID) }) },
    )
    expect(res.status).toBe(201)

    // Task status atomically flipped to awaiting_owner.
    const afterBlockerTask = testDb
      .prepare(`SELECT status, runner_last_failure_reason FROM tasks WHERE id = ?`)
      .get(TASK_ID) as {
      status: string
      runner_last_failure_reason: string | null
    }
    expect(afterBlockerTask.status).toBe('awaiting_owner')
    expect(afterBlockerTask.runner_last_failure_reason).toContain('blocked:')
    expect(afterBlockerTask.runner_last_failure_reason).toContain(
      'AWS_ACCESS_KEY',
    )

    // task_checkpoints: exactly ONE row (the blocker). The pre-existing JSONL
    // line we wrote in Phase 1 was NEVER inserted into the DB — we only
    // count rows landed via the route handler.
    const checkpointRows = testDb
      .prepare(
        `SELECT attempt, status, blocker_reason FROM task_checkpoints
         WHERE task_id = ? ORDER BY id ASC`,
      )
      .all(TASK_ID) as Array<{
      attempt: number
      status: string
      blocker_reason: string | null
    }>
    expect(checkpointRows).toHaveLength(1)
    expect(checkpointRows[0].status).toBe('blocked')
    expect(checkpointRows[0].attempt).toBe(1)
    expect(checkpointRows[0].blocker_reason).toBe(blockerReason)

    // JSONL file: Phase 1's pre-existing line + the new blocker line = 2 lines.
    const jsonlAfterBlocker = fs
      .readFileSync(path.join(mcDir, 'checkpoints.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
    expect(jsonlAfterBlocker).toHaveLength(2)
    const blockerJsonLine = JSON.parse(
      jsonlAfterBlocker[jsonlAfterBlocker.length - 1],
    ) as { status: string; blocker_reason: string; task_id: number }
    expect(blockerJsonLine.status).toBe('blocked')
    expect(blockerJsonLine.blocker_reason).toBe(blockerReason)
    expect(blockerJsonLine.task_id).toBe(TASK_ID)

    // Exactly ONE system-authored comment inserted in the same transaction.
    const comments = testDb
      .prepare(
        `SELECT author, content FROM comments
         WHERE task_id = ? AND author = 'system' ORDER BY id ASC`,
      )
      .all(TASK_ID) as Array<{ author: string; content: string }>
    expect(comments).toHaveLength(1)
    expect(comments[0].content).toContain(blockerReason)
    expect(comments[0].content).toContain('attempt 1')

    // Broadcasts: task.status_changed (reason='blocked_checkpoint') AND
    // task.checkpoint_added (with blocker_reason). Status_changed fires FIRST
    // per Plan 15-05's cause-before-effect ordering.
    const types = broadcastMock.mock.calls.map((c) => c[0])
    expect(types).toEqual(['task.status_changed', 'task.checkpoint_added'])
    const checkpointFrame = broadcastMock.mock.calls.find(
      (c) => c[0] === 'task.checkpoint_added',
    )
    expect(checkpointFrame).toBeDefined()
    const [, checkpointPayload] = checkpointFrame!
    expect(checkpointPayload).toMatchObject({
      task_id: TASK_ID,
      attempt: 1,
      status: 'blocked',
      blocker_reason: blockerReason,
      workspace_id: 1,
    })
    const statusFrame = broadcastMock.mock.calls.find(
      (c) => c[0] === 'task.status_changed',
    )
    expect(statusFrame).toBeDefined()
    const [, statusPayload] = statusFrame!
    expect(statusPayload).toMatchObject({
      id: TASK_ID,
      status: 'awaiting_owner',
      previous_status: 'in_progress',
      reason: 'blocked_checkpoint',
    })

    // -----------------------------------------------------------------
    // Phase 3 — owner flips awaiting_owner → assigned; claim-time attempt bump.
    // -----------------------------------------------------------------
    testDb
      .prepare(
        `UPDATE tasks SET status = 'assigned', runner_attempts = 2 WHERE id = ?`,
      )
      .run(TASK_ID)

    // -----------------------------------------------------------------
    // Phase 4 — claim-time resume_marker resolution.
    // -----------------------------------------------------------------
    const marker = resolveResumeMarker(testDb, TASK_ID)
    expect(marker).not.toBeNull()
    expect(marker!.blocker_reason).toBe(blockerReason)
    // ISO-8601 UTC timestamp.
    expect(marker!.at_iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

    // -----------------------------------------------------------------
    // Phase 5 — seedMcDir simulation (daemon inline call).
    // -----------------------------------------------------------------
    const priorAttemptIso = new Date().toISOString()
    seedMcDir(worktreeRoot, {
      task: {
        task_id: String(TASK_ID),
        recipe_slug: RECIPE_SLUG,
        attempt: 2,
        is_resuming: true,
        prior_attempts: [
          {
            started_at: priorAttemptIso,
            exit_code: null,
            failure_reason: 'blocked',
          },
        ],
      },
      resume_marker: marker,
    })

    // progress.md: pre-existing content preserved + LOCKED marker line appended.
    const progressAfterSeed = fs.readFileSync(
      path.join(mcDir, 'progress.md'),
      'utf8',
    )
    // Pre-existing content is untouched.
    expect(progressAfterSeed.startsWith(initialProgress)).toBe(true)
    // Marker line appended with exact format.
    const expectedMarker = `${marker!.at_iso} | <<< RESUMED AFTER BLOCKER: ${blockerReason} >>>\n`
    expect(progressAfterSeed).toBe(initialProgress + expectedMarker)

    // checkpoints.jsonl: UNCHANGED from Phase 2 (seedMcDir preserves it on resume).
    const jsonlSizeAfterSeed = fs.statSync(
      path.join(mcDir, 'checkpoints.jsonl'),
    ).size
    // Size equals (phase-1 pre-existing line) + (phase-2 blocker line) —
    // i.e., seedMcDir did NOT touch the file on the resume path.
    expect(jsonlSizeAfterSeed).toBeGreaterThan(jsonlSizeAtPhase1End)
    const jsonlLinesAfterSeed = fs
      .readFileSync(path.join(mcDir, 'checkpoints.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
    expect(jsonlLinesAfterSeed).toHaveLength(2) // pre-existing + blocker; unchanged.

    // task.json: REWRITTEN with attempt=2, is_resuming=true, prior_attempts
    // carrying the previous attempt.
    const taskJsonRaw = fs.readFileSync(
      path.join(mcDir, 'task.json'),
      'utf8',
    )
    const taskJson = JSON.parse(taskJsonRaw) as {
      task_id: string
      recipe_slug: string
      attempt: number
      is_resuming: boolean
      prior_attempts: Array<{
        started_at: string
        exit_code: number | null
        failure_reason: string | null
      }>
    }
    expect(taskJson.task_id).toBe(String(TASK_ID))
    expect(taskJson.recipe_slug).toBe(RECIPE_SLUG)
    expect(taskJson.attempt).toBe(2)
    expect(taskJson.is_resuming).toBe(true)
    expect(taskJson.prior_attempts).toHaveLength(1)
    expect(taskJson.prior_attempts[0]).toMatchObject({
      started_at: priorAttemptIso,
      exit_code: null,
      failure_reason: 'blocked',
    })

    // .gitignore: literal '*\n' (rewritten every time by seedMcDir).
    const gitignore = fs.readFileSync(
      path.join(mcDir, '.gitignore'),
      'utf8',
    )
    expect(gitignore).toBe('*\n')
  })
})
