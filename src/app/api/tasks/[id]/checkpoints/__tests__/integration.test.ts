/**
 * Phase 15 Plan 15-07 Task 1 — checkpoint POST + GET integration sweep.
 *
 * Purpose: prove the full in-process wiring of the checkpoint API (Plan 15-04
 * + 15-05) composes correctly end-to-end. Unit tests in ./route.test.ts and
 * ./route-blocker.test.ts cover per-case behavior; this file exercises the
 * *cross-module* composition:
 *
 *   - real @/lib/task-checkpoints module (writeCheckpoint, readCheckpoints,
 *     Zod schemas) — NOT mocked
 *   - real @/app/api/tasks/[id]/checkpoints/route POST + GET handlers
 *   - real DB via an in-memory better-sqlite3
 *   - real worktree JSONL round-trip via mkdtemp
 *   - ONLY auth (via runner-token issuance) and event-bus are instrumented
 *
 * Requirement coverage: CP-01..06 + SCHED-06 (task.checkpoint_added).
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

const { POST, GET } = await import('../route')

// -------------------------------------------------------------------------
// Seed + helper functions — single source of truth across test cases.
// -------------------------------------------------------------------------

function seedWorkspace(db: Database.Database, id = 1): void {
  const existing = db.prepare(`SELECT id FROM workspaces WHERE id = ?`).get(id) as
    | { id?: number }
    | undefined
  if (!existing) {
    db.prepare(
      `INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (?, ?, ?, ?)`,
    ).run(id, `ws-${id}`, `Workspace ${id}`, 1)
  }
}

function seedRecipeTask(
  db: Database.Database,
  id: number,
  opts: {
    status?: string
    runner_attempts?: number
    worktree_path?: string | null
    workspace_id?: number
  } = {},
): void {
  db.prepare(
    `INSERT INTO tasks
       (id, title, status, priority, workspace_id, worktree_path,
        runner_attempts, recipe_slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `recipe task ${id}`,
    opts.status ?? 'in_progress',
    'medium',
    opts.workspace_id ?? 1,
    opts.worktree_path ?? null,
    opts.runner_attempts ?? 1,
    'hello-world',
  )
}

function buildReq(
  taskId: number,
  bearer: string | null,
  body: unknown,
  { method = 'POST', query = '' }: { method?: string; query?: string } = {},
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const url = `http://localhost/api/tasks/${taskId}/checkpoints${query}`
  const reqBody =
    body !== undefined && method !== 'GET'
      ? typeof body === 'string'
        ? (body as string)
        : JSON.stringify(body)
      : undefined
  return new NextRequest(url, { method, headers, body: reqBody })
}

async function postCheckpoint(
  taskId: number,
  bearer: string | null,
  body: unknown,
): Promise<Response> {
  return POST(buildReq(taskId, bearer, body), {
    params: Promise.resolve({ id: String(taskId) }),
  })
}

async function getCheckpoints(
  taskId: number,
  bearer: string | null,
  { attempt }: { attempt?: number } = {},
): Promise<Response> {
  const query = attempt !== undefined ? `?attempt=${attempt}` : ''
  return GET(buildReq(taskId, bearer, undefined, { method: 'GET', query }), {
    params: Promise.resolve({ id: String(taskId) }),
  })
}

function jsonlPath(worktree: string): string {
  return path.join(worktree, '.mc', 'checkpoints.jsonl')
}

function readJsonlLines(worktree: string): Record<string, unknown>[] {
  const filePath = jsonlPath(worktree)
  if (!fs.existsSync(filePath)) return []
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function countCheckpointRows(db: Database.Database, taskId: number): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM task_checkpoints WHERE task_id = ?`)
      .get(taskId) as { n: number }
  ).n
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  seedWorkspace(testDb, 1)
  worktreeRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'phase-15-checkpoints-int-'),
  )
  seedRecipeTask(testDb, 42, {
    worktree_path: worktreeRoot,
    runner_attempts: 1,
  })
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
// Integration test cases
// -------------------------------------------------------------------------

describe('Phase 15 Plan 15-07 Task 1 — checkpoint POST + GET integration', () => {
  it('1. full sequence: completed → in_progress → blocked (attempt=1); DB + JSONL + GET all consistent; blocker flips tasks.status and inserts system comment', async () => {
    const { token: t1 } = issueRunnerToken(testDb, 42, 1, 300)
    const r1 = await postCheckpoint(42, t1, {
      step: 'start',
      summary: 'starting run',
      status: 'completed',
    })
    expect(r1.status).toBe(201)

    const { token: t2 } = issueRunnerToken(testDb, 42, 1, 300)
    const r2 = await postCheckpoint(42, t2, {
      step: 'midway',
      summary: 'still going',
      status: 'in_progress',
    })
    expect(r2.status).toBe(201)

    const { token: t3 } = issueRunnerToken(testDb, 42, 1, 300)
    const r3 = await postCheckpoint(42, t3, {
      step: 'halt',
      summary: 'need credentials',
      status: 'blocked',
      blocker_reason: 'MISSING_API_KEY — operator action required',
    })
    expect(r3.status).toBe(201)

    // DB: three rows, attempt=1, ordered by insertion.
    const rows = testDb
      .prepare(
        `SELECT step, status, attempt, blocker_reason
         FROM task_checkpoints WHERE task_id = 42 ORDER BY id ASC`,
      )
      .all() as Array<{
      step: string
      status: string
      attempt: number
      blocker_reason: string | null
    }>
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.step)).toEqual(['start', 'midway', 'halt'])
    expect(rows.map((r) => r.status)).toEqual([
      'completed',
      'in_progress',
      'blocked',
    ])
    expect(rows.every((r) => r.attempt === 1)).toBe(true)
    expect(rows[2].blocker_reason).toBe(
      'MISSING_API_KEY — operator action required',
    )

    // JSONL: three lines in insertion order; field-name symmetry with DB.
    const lines = readJsonlLines(worktreeRoot)
    expect(lines).toHaveLength(3)
    expect(lines.map((l) => l.step)).toEqual(['start', 'midway', 'halt'])
    for (const line of lines) {
      expect(line.task_id).toBe(42)
      expect(line.attempt).toBe(1)
      // JSONL uses `artifacts` field name; DB uses `artifacts_json` column.
      expect(Array.isArray(line.artifacts)).toBe(true)
    }
    expect(lines[2].blocker_reason).toBe(
      'MISSING_API_KEY — operator action required',
    )

    // Task status flipped to awaiting_owner after the blocker.
    const taskRow = testDb
      .prepare(`SELECT status, runner_last_failure_reason FROM tasks WHERE id = 42`)
      .get() as {
      status: string
      runner_last_failure_reason: string | null
    }
    expect(taskRow.status).toBe('awaiting_owner')
    expect(taskRow.runner_last_failure_reason).toContain('blocked:')

    // Exactly ONE system-authored comment (blocker flip commits it atomically).
    const comments = testDb
      .prepare(`SELECT author, content FROM comments WHERE task_id = 42`)
      .all() as Array<{ author: string; content: string }>
    expect(comments).toHaveLength(1)
    expect(comments[0].author).toBe('system')
    expect(comments[0].content).toContain(
      'MISSING_API_KEY — operator action required',
    )

    // GET (no filter) returns ALL three checkpoints ordered (attempt ASC, id ASC).
    const g1 = await getCheckpoints(
      42,
      'test-admin-api-key-aaaaaaaaaaaaaaaaaaa',
    )
    expect(g1.status).toBe(200)
    const body1 = (await g1.json()) as {
      checkpoints: Array<{ step: string; status: string }>
    }
    expect(body1.checkpoints.map((c) => c.step)).toEqual([
      'start',
      'midway',
      'halt',
    ])

    // GET ?attempt=1 returns all three (all are attempt=1).
    const g2 = await getCheckpoints(
      42,
      'test-admin-api-key-aaaaaaaaaaaaaaaaaaa',
      { attempt: 1 },
    )
    expect(g2.status).toBe(200)
    expect(((await g2.json()) as { checkpoints: unknown[] }).checkpoints).toHaveLength(3)

    // GET ?attempt=2 returns [] (no rows for attempt=2).
    const g3 = await getCheckpoints(
      42,
      'test-admin-api-key-aaaaaaaaaaaaaaaaaaa',
      { attempt: 2 },
    )
    expect(g3.status).toBe(200)
    expect(((await g3.json()) as { checkpoints: unknown[] }).checkpoints).toEqual([])

    // Broadcasts: each POST fires task.checkpoint_added (3 frames) + the blocker
    // POST also fires task.status_changed (cause-first ordering per Plan 15-05).
    const types = broadcastMock.mock.calls.map((c) => c[0])
    const checkpointAddedCount = types.filter(
      (t) => t === 'task.checkpoint_added',
    ).length
    const statusChangedCount = types.filter(
      (t) => t === 'task.status_changed',
    ).length
    expect(checkpointAddedCount).toBe(3)
    expect(statusChangedCount).toBe(1)
  })

  it('2. CP-05 artifact matrix: all 6 kinds round-trip through POST → DB → JSONL → GET', async () => {
    const kinds: Array<{
      kind: string
      artifact: Record<string, unknown>
      step: string
    }> = [
      { kind: 'file', artifact: { kind: 'file', path: 'src/out.ts' }, step: 'write-file' },
      { kind: 'url', artifact: { kind: 'url', url: 'https://example.com/x' }, step: 'link-url' },
      {
        kind: 'diff',
        artifact: { kind: 'diff', ref: 'HEAD~1', path: 'src/a.ts' },
        step: 'show-diff',
      },
      {
        kind: 'test_result',
        artifact: { kind: 'test_result', summary: '42 passed' },
        step: 'run-tests',
      },
      {
        kind: 'comment',
        artifact: { kind: 'comment', summary: 'noting progress' },
        step: 'add-comment',
      },
      { kind: 'other', artifact: { kind: 'other', summary: 'misc' }, step: 'other-art' },
    ]

    for (const entry of kinds) {
      const { token } = issueRunnerToken(testDb, 42, 1, 300)
      const res = await postCheckpoint(42, token, {
        step: entry.step,
        summary: `posting ${entry.kind}`,
        status: 'in_progress',
        artifacts: [entry.artifact],
      })
      expect(res.status).toBe(201)
    }

    // All 6 rows landed in DB.
    expect(countCheckpointRows(testDb, 42)).toBe(6)

    // DB round-trip: parse artifacts_json, compare to posted artifact.
    const rows = testDb
      .prepare(
        `SELECT step, artifacts_json FROM task_checkpoints
         WHERE task_id = 42 ORDER BY id ASC`,
      )
      .all() as Array<{ step: string; artifacts_json: string }>
    for (let i = 0; i < kinds.length; i++) {
      const parsed = JSON.parse(rows[i].artifacts_json) as unknown[]
      expect(parsed[0]).toEqual(kinds[i].artifact)
    }

    // JSONL round-trip: 6 lines, each carries the same artifact shape.
    const lines = readJsonlLines(worktreeRoot)
    expect(lines).toHaveLength(6)
    for (let i = 0; i < kinds.length; i++) {
      expect((lines[i].artifacts as unknown[])[0]).toEqual(kinds[i].artifact)
    }

    // GET round-trip: viewer reads back the 6 artifacts already deserialised.
    const res = await getCheckpoints(
      42,
      'test-admin-api-key-aaaaaaaaaaaaaaaaaaa',
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      checkpoints: Array<{ step: string; artifacts: unknown[] }>
    }
    expect(body.checkpoints).toHaveLength(6)
    for (let i = 0; i < kinds.length; i++) {
      expect(body.checkpoints[i].artifacts[0]).toEqual(kinds[i].artifact)
    }
  })

  it('3. CP-02 atomic rollback — fs.appendFileSync throws → 500, DB empty, JSONL size unchanged', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)

    const sizeBefore = fs.existsSync(jsonlPath(worktreeRoot))
      ? fs.statSync(jsonlPath(worktreeRoot)).size
      : 0

    const spy = vi
      .spyOn(fs, 'appendFileSync')
      .mockImplementationOnce(() => {
        throw new Error('ENOSPC simulated')
      })

    const res = await postCheckpoint(42, token, {
      step: 'x',
      summary: 'x',
      status: 'in_progress',
    })
    expect(res.status).toBe(500)
    spy.mockRestore()

    // DB row count unchanged (0).
    expect(countCheckpointRows(testDb, 42)).toBe(0)

    // JSONL size unchanged (file may not exist at all — the throw happened
    // before appendFileSync could create it).
    const sizeAfter = fs.existsSync(jsonlPath(worktreeRoot))
      ? fs.statSync(jsonlPath(worktreeRoot)).size
      : 0
    expect(sizeAfter).toBe(sizeBefore)

    // No broadcast on rollback.
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('4. CP-02 atomic rollback — DB INSERT throws → 500, JSONL truncated to pre-call size', async () => {
    // Seed one completed checkpoint to establish a non-zero JSONL baseline.
    const { token: seedToken } = issueRunnerToken(testDb, 42, 1, 300)
    const seedRes = await postCheckpoint(42, seedToken, {
      step: 'baseline',
      summary: 'seed',
      status: 'in_progress',
    })
    expect(seedRes.status).toBe(201)
    broadcastMock.mockReset()

    const jsonlFilePath = jsonlPath(worktreeRoot)
    const sizeBefore = fs.statSync(jsonlFilePath).size
    expect(sizeBefore).toBeGreaterThan(0)

    // Force the task_checkpoints INSERT to fail by violating a NOT NULL
    // constraint via a spy. Dropping the table mid-transaction achieves the
    // same effect and exercises the rollback code path.
    testDb.exec(`DROP TABLE task_checkpoints`)

    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await postCheckpoint(42, token, {
      step: 'after-drop',
      summary: 'x',
      status: 'in_progress',
    })
    expect(res.status).toBe(500)

    // JSONL size is restored to pre-call size — any bytes written inside the
    // transaction are truncated by the compensating catch-branch in route.ts.
    const sizeAfter = fs.statSync(jsonlFilePath).size
    expect(sizeAfter).toBe(sizeBefore)

    // No broadcast fired on rollback.
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('5. CP-01 status=blocked without blocker_reason → 400 Zod error; no DB/JSONL side-effects', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await postCheckpoint(42, token, {
      step: 'halt',
      summary: 'halt',
      status: 'blocked',
    })
    expect(res.status).toBe(400)
    expect(countCheckpointRows(testDb, 42)).toBe(0)
    expect(readJsonlLines(worktreeRoot)).toHaveLength(0)
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('6. CP-01 status=blocked with whitespace-only blocker_reason → 400 Zod refine', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await postCheckpoint(42, token, {
      step: 'halt',
      summary: 'halt',
      status: 'blocked',
      blocker_reason: '   \t  \n ',
    })
    expect(res.status).toBe(400)
    expect(countCheckpointRows(testDb, 42)).toBe(0)
  })

  it('7. unknown artifact kind → 400 discriminator error; no DB/JSONL side-effects', async () => {
    const { token } = issueRunnerToken(testDb, 42, 1, 300)
    const res = await postCheckpoint(42, token, {
      step: 'x',
      summary: 'x',
      status: 'in_progress',
      artifacts: [{ kind: 'mystery', foo: 'bar' }],
    })
    expect(res.status).toBe(400)
    expect(countCheckpointRows(testDb, 42)).toBe(0)
    expect(readJsonlLines(worktreeRoot)).toHaveLength(0)
  })

  it('8. cross-workspace viewer on GET → 404 masquerade', async () => {
    // Seed task 77 in workspace 2; viewer (admin API key) lives in workspace 1.
    const seedWorkspace2 = (db: Database.Database) => {
      const existing = db
        .prepare(`SELECT id FROM workspaces WHERE id = 2`)
        .get() as { id?: number } | undefined
      if (!existing) {
        db.prepare(
          `INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (2, 'ws-2', 'Workspace 2', 1)`,
        ).run()
      }
    }
    seedWorkspace2(testDb)
    seedRecipeTask(testDb, 77, {
      worktree_path: worktreeRoot,
      workspace_id: 2,
    })

    const res = await getCheckpoints(
      77,
      'test-admin-api-key-aaaaaaaaaaaaaaaaaaa',
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Task not found')
  })

  it('9. attempt filter — sequential attempts each queryable by ?attempt=N', async () => {
    // Post checkpoints for attempt 1.
    const { token: ta1 } = issueRunnerToken(testDb, 42, 1, 300)
    await postCheckpoint(42, ta1, {
      step: 'a1-s1',
      summary: 's',
      status: 'completed',
    })

    // Bump task runner_attempts to 2 so the next POST lands as attempt=2.
    testDb
      .prepare(`UPDATE tasks SET runner_attempts = 2 WHERE id = 42`)
      .run()

    const { token: ta2 } = issueRunnerToken(testDb, 42, 2, 300)
    await postCheckpoint(42, ta2, {
      step: 'a2-s1',
      summary: 's',
      status: 'completed',
    })

    // GET ?attempt=1 → only the a1 rows.
    const g1 = await getCheckpoints(
      42,
      'test-admin-api-key-aaaaaaaaaaaaaaaaaaa',
      { attempt: 1 },
    )
    expect(g1.status).toBe(200)
    const b1 = (await g1.json()) as {
      checkpoints: Array<{ step: string; attempt: number }>
    }
    expect(b1.checkpoints).toHaveLength(1)
    expect(b1.checkpoints[0].step).toBe('a1-s1')
    expect(b1.checkpoints[0].attempt).toBe(1)

    // GET ?attempt=2 → only the a2 rows.
    const g2 = await getCheckpoints(
      42,
      'test-admin-api-key-aaaaaaaaaaaaaaaaaaa',
      { attempt: 2 },
    )
    expect(g2.status).toBe(200)
    const b2 = (await g2.json()) as {
      checkpoints: Array<{ step: string; attempt: number }>
    }
    expect(b2.checkpoints).toHaveLength(1)
    expect(b2.checkpoints[0].step).toBe('a2-s1')
    expect(b2.checkpoints[0].attempt).toBe(2)

    // GET without filter → both rows in (attempt ASC, id ASC) order.
    const gAll = await getCheckpoints(
      42,
      'test-admin-api-key-aaaaaaaaaaaaaaaaaaa',
    )
    expect(gAll.status).toBe(200)
    const bAll = (await gAll.json()) as {
      checkpoints: Array<{ step: string; attempt: number }>
    }
    expect(bAll.checkpoints.map((c) => c.attempt)).toEqual([1, 2])
  })
})
