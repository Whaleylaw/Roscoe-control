/**
 * Unit tests for `resolveResumeMarker` (Plan 15-05 Task 3).
 *
 * Helper queries the most-recent task_checkpoints row for a task and returns
 * the LOCKED resume marker payload only when:
 *   - Latest checkpoint exists, AND
 *   - Latest checkpoint is status='blocked', AND
 *   - blocker_reason is non-null.
 *
 * Anything else returns null. The "latest" rule (ORDER BY id DESC LIMIT 1) is
 * deliberate — if the agent posted progress checkpoints AFTER a blocker and
 * BEFORE the daemon re-claimed (e.g., owner flipped status during a brief
 * window), the marker is stale and would mislead the agent.
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import { resolveResumeMarker, type ResumeMarker } from '@/lib/runner-claim'

let db: Database.Database

function seedWorkspace(): void {
  const existing = db.prepare(`SELECT id FROM workspaces WHERE id = 1`).get() as
    | { id?: number }
    | undefined
  if (!existing) {
    db.prepare(
      `INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (?, ?, ?, ?)`,
    ).run(1, 'ws-1', 'Workspace 1', 1)
  }
}

function seedTask(taskId: number): void {
  db.prepare(
    `INSERT INTO tasks (id, title, status, priority, workspace_id, runner_attempts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(taskId, `task ${taskId}`, 'in_progress', 'medium', 1, 1)
}

function seedCheckpoint(opts: {
  taskId: number
  attempt: number
  status: 'completed' | 'in_progress' | 'blocked'
  blocker_reason?: string | null
  step?: string
  created_at: number
}): number {
  const result = db
    .prepare(
      `INSERT INTO task_checkpoints
         (task_id, attempt, step, summary, status, artifacts_json,
          blocker_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.taskId,
      opts.attempt,
      opts.step ?? `step-${opts.created_at}`,
      'summary',
      opts.status,
      '[]',
      opts.blocker_reason ?? null,
      opts.created_at,
    )
  return Number(result.lastInsertRowid)
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  seedWorkspace()
})

afterEach(() => {
  db.close()
})

describe('resolveResumeMarker', () => {
  it('task has no checkpoints → returns null', () => {
    seedTask(42)
    expect(resolveResumeMarker(db, 42)).toBeNull()
  })

  it('latest checkpoint is completed (no blocker history) → returns null', () => {
    seedTask(42)
    seedCheckpoint({
      taskId: 42,
      attempt: 1,
      status: 'completed',
      created_at: 1700_000_000,
    })
    expect(resolveResumeMarker(db, 42)).toBeNull()
  })

  it('single blocked checkpoint → returns marker with blocker_reason + ISO timestamp', () => {
    seedTask(42)
    seedCheckpoint({
      taskId: 42,
      attempt: 1,
      status: 'blocked',
      blocker_reason: 'API key rotation pending',
      created_at: 1700_000_000,
    })
    const marker = resolveResumeMarker(db, 42) as ResumeMarker | null
    expect(marker).not.toBeNull()
    expect(marker!.blocker_reason).toBe('API key rotation pending')
    // 1700_000_000 unix-seconds → 2023-11-14T22:13:20.000Z (regardless of TZ).
    expect(marker!.at_iso).toBe(new Date(1700_000_000 * 1000).toISOString())
  })

  it('checkpoints in order: completed → blocked → completed (latest is non-blocker) → returns null', () => {
    seedTask(42)
    seedCheckpoint({
      taskId: 42,
      attempt: 1,
      status: 'completed',
      created_at: 1700_000_000,
    })
    seedCheckpoint({
      taskId: 42,
      attempt: 1,
      status: 'blocked',
      blocker_reason: 'old blocker',
      created_at: 1700_000_100,
    })
    // Owner unblocked + agent posted a follow-up before the daemon re-claimed.
    seedCheckpoint({
      taskId: 42,
      attempt: 1,
      status: 'completed',
      created_at: 1700_000_200,
    })
    // Latest checkpoint is `completed` — the blocker marker is stale.
    expect(resolveResumeMarker(db, 42)).toBeNull()
  })

  it('checkpoints in order: completed → blocked (latest) → returns most-recent blocker marker', () => {
    seedTask(42)
    seedCheckpoint({
      taskId: 42,
      attempt: 1,
      status: 'completed',
      created_at: 1700_000_000,
    })
    seedCheckpoint({
      taskId: 42,
      attempt: 1,
      status: 'blocked',
      blocker_reason: 'fresh blocker reason',
      created_at: 1700_000_100,
    })
    const marker = resolveResumeMarker(db, 42) as ResumeMarker | null
    expect(marker).not.toBeNull()
    expect(marker!.blocker_reason).toBe('fresh blocker reason')
    expect(marker!.at_iso).toBe(new Date(1700_000_100 * 1000).toISOString())
  })

  it('latest checkpoint is blocked but blocker_reason IS NULL → returns null (defensive guard)', () => {
    seedTask(42)
    // The CP-01 Zod refine prevents this combination at the API layer, but
    // raw DB writes (e.g., a future migration / test fixture) could create
    // it. resolveResumeMarker must not surface an empty marker that would
    // render as `RESUMED AFTER BLOCKER: null` in progress.md.
    seedCheckpoint({
      taskId: 42,
      attempt: 1,
      status: 'blocked',
      blocker_reason: null,
      created_at: 1700_000_000,
    })
    expect(resolveResumeMarker(db, 42)).toBeNull()
  })

  it('multi-attempt history: latest blocker (across all attempts) wins regardless of attempt number', () => {
    seedTask(42)
    // Attempt 1: blocker → owner resolves → attempt 2 starts.
    seedCheckpoint({
      taskId: 42,
      attempt: 1,
      status: 'blocked',
      blocker_reason: 'attempt-1 blocker',
      created_at: 1700_000_000,
    })
    // Attempt 2 starts with completed progress, then hits another blocker.
    seedCheckpoint({
      taskId: 42,
      attempt: 2,
      status: 'in_progress',
      created_at: 1700_000_100,
    })
    seedCheckpoint({
      taskId: 42,
      attempt: 2,
      status: 'blocked',
      blocker_reason: 'attempt-2 blocker',
      created_at: 1700_000_200,
    })
    // Attempt 3 should resume with attempt-2's marker (the latest one).
    const marker = resolveResumeMarker(db, 42) as ResumeMarker | null
    expect(marker).not.toBeNull()
    expect(marker!.blocker_reason).toBe('attempt-2 blocker')
  })
})
