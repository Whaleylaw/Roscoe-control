import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  return db
}

describe('migrations 060_runner_heartbeats + 061_task_runner_attempts', () => {
  let db: Database.Database
  beforeEach(() => {
    db = makeDb()
    runMigrations(db)
  })

  it('creates runner_heartbeats with the expected columns and index', () => {
    const cols = db
      .prepare('PRAGMA table_info(runner_heartbeats)')
      .all() as Array<{ name: string; type: string; pk: number; notnull: number }>

    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual(['last_heartbeat_at', 'metadata_json', 'registered_at', 'runner_id'])

    const runnerId = cols.find((c) => c.name === 'runner_id')!
    expect(runnerId.type).toBe('TEXT')
    expect(runnerId.pk).toBe(1)

    const lastHb = cols.find((c) => c.name === 'last_heartbeat_at')!
    expect(lastHb.type).toBe('INTEGER')
    expect(lastHb.notnull).toBe(1)

    const registeredAt = cols.find((c) => c.name === 'registered_at')!
    expect(registeredAt.type).toBe('INTEGER')
    expect(registeredAt.notnull).toBe(1)

    const meta = cols.find((c) => c.name === 'metadata_json')!
    expect(meta.type).toBe('TEXT')
    expect(meta.notnull).toBe(0)

    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_runner_heartbeats_last'`)
      .get() as { name: string } | undefined
    expect(idx).toBeDefined()
  })

  it('creates task_runner_attempts with expected columns, UNIQUE constraint, and FK', () => {
    const cols = db
      .prepare('PRAGMA table_info(task_runner_attempts)')
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>

    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual([
      'attempt',
      'created_at',
      'exit_code',
      'exited_at',
      'failure_reason',
      'id',
      'started_at',
      'stderr_tail',
      'task_id',
    ])

    const id = cols.find((c) => c.name === 'id')!
    expect(id.pk).toBe(1)

    const taskId = cols.find((c) => c.name === 'task_id')!
    expect(taskId.type).toBe('INTEGER')
    expect(taskId.notnull).toBe(1)

    const attempt = cols.find((c) => c.name === 'attempt')!
    expect(attempt.type).toBe('INTEGER')
    expect(attempt.notnull).toBe(1)

    const startedAt = cols.find((c) => c.name === 'started_at')!
    expect(startedAt.notnull).toBe(1)

    // Exit fields are nullable — runner fills them at runner-exit.
    expect(cols.find((c) => c.name === 'exited_at')!.notnull).toBe(0)
    expect(cols.find((c) => c.name === 'exit_code')!.notnull).toBe(0)
    expect(cols.find((c) => c.name === 'failure_reason')!.notnull).toBe(0)
    expect(cols.find((c) => c.name === 'stderr_tail')!.notnull).toBe(0)

    // Supporting index for chronological attempt lookups per task.
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_task_runner_attempts_task'`)
      .get() as { name: string } | undefined
    expect(idx).toBeDefined()

    // FK CASCADE declared on task_id.
    const fkList = db
      .prepare('PRAGMA foreign_key_list(task_runner_attempts)')
      .all() as Array<{ table: string; from: string; to: string; on_delete: string }>
    const taskFk = fkList.find((f) => f.from === 'task_id')
    expect(taskFk).toBeDefined()
    expect(taskFk!.table).toBe('tasks')
    expect(taskFk!.to).toBe('id')
    expect(taskFk!.on_delete).toBe('CASCADE')
  })

  it('is idempotent: runMigrations twice does not throw and does not re-apply 060/061', () => {
    expect(() => runMigrations(db)).not.toThrow()

    const rows = db
      .prepare(
        `SELECT id, COUNT(*) AS n FROM schema_migrations WHERE id IN ('060_runner_heartbeats','061_task_runner_attempts') GROUP BY id`,
      )
      .all() as Array<{ id: string; n: number }>
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row.n).toBe(1)
    }
  })

  it('runner_heartbeats supports UPSERT by runner_id', () => {
    const upsert = db.prepare(
      `INSERT INTO runner_heartbeats (runner_id, last_heartbeat_at, registered_at)
       VALUES (?, ?, ?)
       ON CONFLICT(runner_id) DO UPDATE SET last_heartbeat_at = excluded.last_heartbeat_at`,
    )

    upsert.run('runner-1', 1000, 500)
    const first = db
      .prepare('SELECT last_heartbeat_at, registered_at FROM runner_heartbeats WHERE runner_id = ?')
      .get('runner-1') as { last_heartbeat_at: number; registered_at: number }
    expect(first.last_heartbeat_at).toBe(1000)
    expect(first.registered_at).toBe(500)

    // Second call with a later heartbeat — registered_at is NOT overwritten (not in the SET clause).
    upsert.run('runner-1', 2000, 9999)
    const second = db
      .prepare('SELECT last_heartbeat_at, registered_at FROM runner_heartbeats WHERE runner_id = ?')
      .get('runner-1') as { last_heartbeat_at: number; registered_at: number }
    expect(second.last_heartbeat_at).toBe(2000)
    expect(second.registered_at).toBe(500)

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM runner_heartbeats')
      .get() as { n: number }
    expect(count.n).toBe(1)
  })

  it('task_runner_attempts UNIQUE(task_id, attempt) rejects duplicate pairs', () => {
    const taskInsert = db.prepare('INSERT INTO tasks (title) VALUES (?)')
    const { lastInsertRowid } = taskInsert.run('t1')
    const taskId = Number(lastInsertRowid)

    const attemptInsert = db.prepare(
      `INSERT INTO task_runner_attempts (task_id, attempt, started_at) VALUES (?, ?, ?)`,
    )

    attemptInsert.run(taskId, 1, 1000)
    expect(() => attemptInsert.run(taskId, 1, 1100)).toThrowError(/UNIQUE/i)

    // Different attempt number is fine.
    expect(() => attemptInsert.run(taskId, 2, 1200)).not.toThrow()
  })

  it('task_runner_attempts FK CASCADE removes attempt rows when the parent task is deleted', () => {
    const { lastInsertRowid } = db.prepare('INSERT INTO tasks (title) VALUES (?)').run('t2')
    const taskId = Number(lastInsertRowid)

    db.prepare('INSERT INTO task_runner_attempts (task_id, attempt, started_at) VALUES (?, ?, ?)').run(
      taskId,
      1,
      1000,
    )
    db.prepare('INSERT INTO task_runner_attempts (task_id, attempt, started_at) VALUES (?, ?, ?)').run(
      taskId,
      2,
      2000,
    )

    const before = db
      .prepare('SELECT COUNT(*) AS n FROM task_runner_attempts WHERE task_id = ?')
      .get(taskId) as { n: number }
    expect(before.n).toBe(2)

    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)

    const after = db
      .prepare('SELECT COUNT(*) AS n FROM task_runner_attempts WHERE task_id = ?')
      .get(taskId) as { n: number }
    expect(after.n).toBe(0)
  })
})
