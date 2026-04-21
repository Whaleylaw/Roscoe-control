/**
 * Unit tests for src/lib/task-checkpoints.ts (Plan 15-04 Task 1).
 *
 * Covers:
 *   - Zod schemas (CheckpointBodySchema + ArtifactSchema discriminated union).
 *   - writeCheckpoint atomic DB+JSONL contract.
 *   - readCheckpoints filter + ordering (CP-06).
 *
 * Plan 17-02 GAP AUDIT (RTEST-01 sharp-edge checklist):
 *   - blocked-without-reason rejection     → PRE-EXISTING (line 78-89)
 *   - blocked-with-reason acceptance       → PRE-EXISTING (line 101-109)
 *   - blocked-with-whitespace-only reason  → PRE-EXISTING (line 91-99)
 *   - blocked-with-empty-string reason     → NEWLY ADDED by 17-02 (below)
 */

import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import {
  ArtifactSchema,
  CheckpointBodySchema,
  readCheckpoints,
  writeCheckpoint,
  type Artifact,
  type CheckpointBody,
} from '@/lib/task-checkpoints'

let testDb: Database.Database
let worktreeRoot: string

function seedWorkspace(db: Database.Database): void {
  const existing = db.prepare(`SELECT id FROM workspaces WHERE id = ?`).get(1) as
    | { id?: number }
    | undefined
  if (!existing) {
    db.prepare(
      `INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (?, ?, ?, ?)`,
    ).run(1, 'default', 'Default', 1)
  }
}

function seedTask(db: Database.Database, id: number): void {
  db.prepare(
    `INSERT INTO tasks (id, title, status, priority, workspace_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, `task ${id}`, 'in_progress', 'medium', 1)
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  seedWorkspace(testDb)
  seedTask(testDb, 100)
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-checkpoints-test-'))
})

afterEach(() => {
  testDb.close()
  try {
    fs.rmSync(worktreeRoot, { recursive: true, force: true })
  } catch {
    // non-fatal cleanup
  }
  vi.restoreAllMocks()
})

// ---------- Zod schema tests ----------

describe('CheckpointBodySchema', () => {
  it('accepts a minimal valid body (step, summary, status=completed)', () => {
    const body: CheckpointBody = {
      step: 'init',
      summary: 'started',
      status: 'completed',
    }
    const parsed = CheckpointBodySchema.safeParse(body)
    expect(parsed.success).toBe(true)
  })

  it('rejects status=blocked when blocker_reason is missing', () => {
    const parsed = CheckpointBodySchema.safeParse({
      step: 'work',
      summary: 'halted',
      status: 'blocked',
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join(' | ')
      expect(msg).toContain('status=blocked requires non-empty blocker_reason')
    }
  })

  it('rejects status=blocked when blocker_reason is whitespace-only', () => {
    const parsed = CheckpointBodySchema.safeParse({
      step: 'work',
      summary: 'halted',
      status: 'blocked',
      blocker_reason: '   ',
    })
    expect(parsed.success).toBe(false)
  })

  // Plan 17-02 gap-fill: empty-string variant distinct from whitespace-only.
  // The schema declares blocker_reason as z.string().max(2000).optional() with
  // a refine that calls .trim().length > 0 — an empty string must fail the
  // refine the same way whitespace-only does. Pins that contract.
  it('rejects status=blocked when blocker_reason is an empty string', () => {
    const parsed = CheckpointBodySchema.safeParse({
      step: 'work',
      summary: 'halted',
      status: 'blocked',
      blocker_reason: '',
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join(' | ')
      expect(msg).toContain('status=blocked requires non-empty blocker_reason')
    }
  })

  it('accepts status=blocked with a non-empty blocker_reason', () => {
    const parsed = CheckpointBodySchema.safeParse({
      step: 'work',
      summary: 'halted',
      status: 'blocked',
      blocker_reason: 'API key missing',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts an empty artifacts array', () => {
    const parsed = CheckpointBodySchema.safeParse({
      step: 'work',
      summary: 'progress',
      status: 'in_progress',
      artifacts: [],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects artifacts array larger than 50', () => {
    const many = Array.from(
      { length: 51 },
      (_, i) => ({ kind: 'file', path: `f-${i}.txt` }) as Artifact,
    )
    const parsed = CheckpointBodySchema.safeParse({
      step: 'work',
      summary: 'progress',
      status: 'in_progress',
      artifacts: many,
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects empty step/summary (min 1)', () => {
    const r1 = CheckpointBodySchema.safeParse({
      step: '',
      summary: 'x',
      status: 'completed',
    })
    expect(r1.success).toBe(false)
    const r2 = CheckpointBodySchema.safeParse({
      step: 'x',
      summary: '',
      status: 'completed',
    })
    expect(r2.success).toBe(false)
  })
})

describe('ArtifactSchema', () => {
  it("kind='file' requires path; missing path fails", () => {
    const parsed = ArtifactSchema.safeParse({ kind: 'file' })
    expect(parsed.success).toBe(false)
  })

  it("kind='file' with path is valid", () => {
    const parsed = ArtifactSchema.safeParse({ kind: 'file', path: 'foo.txt' })
    expect(parsed.success).toBe(true)
  })

  it("kind='url' requires url", () => {
    const parsed = ArtifactSchema.safeParse({ kind: 'url' })
    expect(parsed.success).toBe(false)
  })

  it("kind='diff' with neither path nor ref fails refine", () => {
    const parsed = ArtifactSchema.safeParse({ kind: 'diff' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join(' | ')
      expect(msg).toContain('diff requires path OR ref')
    }
  })

  it("kind='diff' with ref-only is valid", () => {
    const parsed = ArtifactSchema.safeParse({ kind: 'diff', ref: 'HEAD~1' })
    expect(parsed.success).toBe(true)
  })

  it("kind='diff' with path-only is valid", () => {
    const parsed = ArtifactSchema.safeParse({ kind: 'diff', path: 'changes.patch' })
    expect(parsed.success).toBe(true)
  })

  it("kind='test_result' with neither path/url/summary fails refine", () => {
    const parsed = ArtifactSchema.safeParse({ kind: 'test_result' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join(' | ')
      expect(msg).toContain('test_result requires at least one of path/url/summary')
    }
  })

  it("kind='test_result' with summary-only is valid", () => {
    const parsed = ArtifactSchema.safeParse({
      kind: 'test_result',
      summary: '42 pass, 0 fail',
    })
    expect(parsed.success).toBe(true)
  })

  it("kind='comment' requires summary", () => {
    const missing = ArtifactSchema.safeParse({ kind: 'comment' })
    expect(missing.success).toBe(false)
    const ok = ArtifactSchema.safeParse({ kind: 'comment', summary: 'hi' })
    expect(ok.success).toBe(true)
  })

  it("kind='other' is valid with all fields optional", () => {
    const ok = ArtifactSchema.safeParse({ kind: 'other' })
    expect(ok.success).toBe(true)
  })

  it('rejects unknown kind (discriminator error)', () => {
    const parsed = ArtifactSchema.safeParse({ kind: 'mystery', foo: 'bar' })
    expect(parsed.success).toBe(false)
  })
})

// ---------- writeCheckpoint tests ----------

describe('writeCheckpoint', () => {
  it('happy path: inserts DB row AND appends one JSONL line with matching fields', () => {
    const worktreePath = worktreeRoot
    const body: CheckpointBody = {
      step: 'init',
      summary: 'started',
      status: 'completed',
      artifacts: [{ kind: 'file', path: 'hello.txt', summary: 'greeting' }],
      tokens_used: 123,
      duration_ms: 456,
    }
    const result = writeCheckpoint(testDb, 100, 1, worktreePath, body)

    expect(result.id).toBeGreaterThan(0)
    expect(result.attempt).toBe(1)
    expect(result.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(result.nowUnix).toBeGreaterThan(0)

    // DB row
    const row = testDb
      .prepare(`SELECT * FROM task_checkpoints WHERE id = ?`)
      .get(result.id) as {
      task_id: number
      attempt: number
      step: string
      summary: string
      status: string
      artifacts_json: string
      tokens_used: number | null
      duration_ms: number | null
      next_step: string | null
      blocker_reason: string | null
      created_at: number
    }
    expect(row.task_id).toBe(100)
    expect(row.attempt).toBe(1)
    expect(row.step).toBe('init')
    expect(row.status).toBe('completed')
    expect(row.tokens_used).toBe(123)
    expect(row.duration_ms).toBe(456)
    expect(row.next_step).toBeNull()
    expect(row.blocker_reason).toBeNull()

    // JSONL line
    const jsonlPath = path.join(worktreePath, '.mc', 'checkpoints.jsonl')
    expect(fs.existsSync(jsonlPath)).toBe(true)
    const raw = fs.readFileSync(jsonlPath, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.id).toBe(result.id)
    expect(parsed.task_id).toBe(100)
    expect(parsed.attempt).toBe(1)
    expect(parsed.step).toBe('init')
    expect(parsed.summary).toBe('started')
    expect(parsed.status).toBe('completed')
    expect(parsed.artifacts).toEqual([
      { kind: 'file', path: 'hello.txt', summary: 'greeting' },
    ])
    expect(parsed.next_step).toBeNull()
    expect(parsed.blocker_reason).toBeNull()
    expect(parsed.tokens_used).toBe(123)
    expect(parsed.duration_ms).toBe(456)
    expect(parsed.ts).toBe(result.ts)
  })

  it('worktreePath=null: inserts DB row; no filesystem write occurs', () => {
    const mkdir = vi.spyOn(fs, 'mkdirSync')
    const append = vi.spyOn(fs, 'appendFileSync')

    const result = writeCheckpoint(testDb, 100, 1, null, {
      step: 'init',
      summary: 'started',
      status: 'completed',
    })
    expect(result.id).toBeGreaterThan(0)

    expect(mkdir).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()

    const row = testDb
      .prepare(`SELECT id FROM task_checkpoints WHERE id = ?`)
      .get(result.id)
    expect(row).toBeTruthy()
  })

  it('two sequential writes produce two DB rows + two JSONL lines in order', () => {
    const worktreePath = worktreeRoot
    const first = writeCheckpoint(testDb, 100, 1, worktreePath, {
      step: 'one',
      summary: 's1',
      status: 'in_progress',
    })
    const second = writeCheckpoint(testDb, 100, 1, worktreePath, {
      step: 'two',
      summary: 's2',
      status: 'completed',
    })
    expect(second.id).toBeGreaterThan(first.id)

    const rowCount = (
      testDb
        .prepare(`SELECT COUNT(*) AS n FROM task_checkpoints WHERE task_id = 100`)
        .get() as { n: number }
    ).n
    expect(rowCount).toBe(2)

    const jsonlPath = path.join(worktreePath, '.mc', 'checkpoints.jsonl')
    const raw = fs.readFileSync(jsonlPath, 'utf8')
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toHaveLength(2)
    expect(lines[0].step).toBe('one')
    expect(lines[1].step).toBe('two')
    expect(lines[0].id).toBe(first.id)
    expect(lines[1].id).toBe(second.id)
  })

  it('DB INSERT failure rolls back the transaction (no JSONL append observed)', () => {
    const worktreePath = worktreeRoot
    // Force the INSERT to throw. We stub `prepare` to return a stub that
    // .run()s a throw. We only intercept the INSERT; other preparations
    // would confuse the in-memory DB. Simpler: pass a clearly-bad FK.
    // We delete the parent task so the FK CASCADE + our transaction will
    // succeed insert (task_checkpoints has FK ON DELETE CASCADE but no
    // restriction on insert), so instead we spy on `db.prepare` and make
    // the first call throw.
    const origPrepare = testDb.prepare.bind(testDb)
    let firstCall = true
    const spy = vi
      .spyOn(testDb, 'prepare')
      .mockImplementation((...args: Parameters<typeof testDb.prepare>) => {
        if (firstCall) {
          firstCall = false
          throw new Error('simulated db prepare failure')
        }
        return origPrepare(...args)
      })

    expect(() =>
      writeCheckpoint(testDb, 100, 1, worktreePath, {
        step: 'boom',
        summary: 'x',
        status: 'completed',
      }),
    ).toThrow(/simulated/)

    spy.mockRestore()

    // DB unchanged
    const rowCount = (
      testDb
        .prepare(`SELECT COUNT(*) AS n FROM task_checkpoints WHERE task_id = 100`)
        .get() as { n: number }
    ).n
    expect(rowCount).toBe(0)

    // JSONL not created (throw happened before the appendFileSync)
    const jsonlPath = path.join(worktreePath, '.mc', 'checkpoints.jsonl')
    expect(fs.existsSync(jsonlPath)).toBe(false)
  })

  it('JSONL appendFileSync failure rolls back the DB INSERT', () => {
    const worktreePath = worktreeRoot
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('ENOSPC simulated')
    })

    expect(() =>
      writeCheckpoint(testDb, 100, 1, worktreePath, {
        step: 'boom',
        summary: 'x',
        status: 'completed',
      }),
    ).toThrow(/ENOSPC simulated/)

    spy.mockRestore()

    // DB INSERT rolled back by the transaction wrapper.
    const rowCount = (
      testDb
        .prepare(`SELECT COUNT(*) AS n FROM task_checkpoints WHERE task_id = 100`)
        .get() as { n: number }
    ).n
    expect(rowCount).toBe(0)
  })

  it('artifacts with mixed kinds round-trip through artifacts_json', () => {
    const worktreePath = worktreeRoot
    const body: CheckpointBody = {
      step: 'work',
      summary: 'mixed',
      status: 'in_progress',
      artifacts: [
        { kind: 'file', path: 'a.txt' },
        { kind: 'url', url: 'http://example.test/x' },
        { kind: 'diff', ref: 'HEAD~1' },
        { kind: 'test_result', summary: 'pass' },
        { kind: 'comment', summary: 'fyi' },
        { kind: 'other' },
      ],
    }
    const result = writeCheckpoint(testDb, 100, 2, worktreePath, body)

    const row = testDb
      .prepare(`SELECT artifacts_json FROM task_checkpoints WHERE id = ?`)
      .get(result.id) as { artifacts_json: string }
    const parsedArtifacts = JSON.parse(row.artifacts_json)
    expect(parsedArtifacts).toHaveLength(6)
    expect(parsedArtifacts[0]).toEqual({ kind: 'file', path: 'a.txt' })
    expect(parsedArtifacts[2]).toEqual({ kind: 'diff', ref: 'HEAD~1' })
  })

  it('persists next_step and blocker_reason when provided', () => {
    const worktreePath = worktreeRoot
    const result = writeCheckpoint(testDb, 100, 1, worktreePath, {
      step: 'halt',
      summary: 'waiting',
      status: 'blocked',
      blocker_reason: 'missing credential',
      next_step: 'operator adds API key',
    })
    const row = testDb
      .prepare(
        `SELECT blocker_reason, next_step, status FROM task_checkpoints WHERE id = ?`,
      )
      .get(result.id) as {
      blocker_reason: string
      next_step: string
      status: string
    }
    expect(row.status).toBe('blocked')
    expect(row.blocker_reason).toBe('missing credential')
    expect(row.next_step).toBe('operator adds API key')
  })
})

// ---------- readCheckpoints tests ----------

describe('readCheckpoints', () => {
  it('returns empty array for a task with no checkpoints', () => {
    expect(readCheckpoints(testDb, 100)).toEqual([])
  })

  it('returns checkpoints ordered by (attempt ASC, id ASC)', () => {
    const w = worktreeRoot
    // Insert out-of-order: attempt 2 first, then attempt 1 items.
    const c1 = writeCheckpoint(testDb, 100, 2, w, {
      step: 'a2-first',
      summary: 's',
      status: 'completed',
    })
    const c2 = writeCheckpoint(testDb, 100, 1, w, {
      step: 'a1-first',
      summary: 's',
      status: 'completed',
    })
    const c3 = writeCheckpoint(testDb, 100, 1, w, {
      step: 'a1-second',
      summary: 's',
      status: 'in_progress',
    })
    const c4 = writeCheckpoint(testDb, 100, 2, w, {
      step: 'a2-second',
      summary: 's',
      status: 'in_progress',
    })

    const rows = readCheckpoints(testDb, 100)
    expect(rows.map((r) => r.id)).toEqual([c2.id, c3.id, c1.id, c4.id])
    expect(rows.map((r) => r.attempt)).toEqual([1, 1, 2, 2])
    expect(rows.map((r) => r.step)).toEqual([
      'a1-first',
      'a1-second',
      'a2-first',
      'a2-second',
    ])
  })

  it("filter.attempt=N returns only that attempt's rows", () => {
    const w = worktreeRoot
    writeCheckpoint(testDb, 100, 1, w, {
      step: 'a1',
      summary: 's',
      status: 'completed',
    })
    writeCheckpoint(testDb, 100, 2, w, {
      step: 'a2',
      summary: 's',
      status: 'completed',
    })
    writeCheckpoint(testDb, 100, 2, w, {
      step: 'a2-2',
      summary: 's',
      status: 'completed',
    })

    const rows = readCheckpoints(testDb, 100, { attempt: 2 })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.attempt === 2)).toBe(true)
  })

  it('returns [] when task has no checkpoints for the filtered attempt', () => {
    const w = worktreeRoot
    writeCheckpoint(testDb, 100, 1, w, {
      step: 'a1',
      summary: 's',
      status: 'completed',
    })
    const rows = readCheckpoints(testDb, 100, { attempt: 99 })
    expect(rows).toEqual([])
  })

  it('deserialises artifacts_json into typed Artifact[] per row', () => {
    const w = worktreeRoot
    writeCheckpoint(testDb, 100, 1, w, {
      step: 'with-artifacts',
      summary: 's',
      status: 'in_progress',
      artifacts: [
        { kind: 'file', path: 'a.txt' },
        { kind: 'url', url: 'http://x' },
      ],
    })
    const rows = readCheckpoints(testDb, 100)
    expect(rows).toHaveLength(1)
    expect(rows[0].artifacts).toEqual([
      { kind: 'file', path: 'a.txt' },
      { kind: 'url', url: 'http://x' },
    ])
  })

  it('returns [] for an unknown task_id', () => {
    expect(readCheckpoints(testDb, 9999)).toEqual([])
  })
})
