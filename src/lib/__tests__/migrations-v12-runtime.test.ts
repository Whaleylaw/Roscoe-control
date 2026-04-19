import Database from 'better-sqlite3'
import { describe, it, expect } from 'vitest'
import { runMigrations } from '../migrations'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  return db
}

describe('v1.2 runtime-substrate migrations', () => {
  it('creates recipes table on a fresh DB', () => {
    const db = freshDb()
    runMigrations(db)
    const info = db.prepare(`PRAGMA table_info(recipes)`).all() as Array<{ name: string; type: string; notnull: number }>
    const cols = new Set(info.map((c) => c.name))
    expect(cols).toContain('slug')
    expect(cols).toContain('image')
    expect(cols).toContain('workspace_mode')
    expect(cols).toContain('timeout_seconds')
    expect(cols).toContain('max_concurrent')
    expect(cols).toContain('dir_sha')
    expect(cols).toContain('model_json')
    // slug is NOT NULL UNIQUE
    const slug = info.find((c) => c.name === 'slug')!
    expect(slug.notnull).toBe(1)
    // idx_recipes_slug exists
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'recipes'`).all() as Array<{ name: string }>
    expect(idx.some((i) => i.name === 'idx_recipes_slug')).toBe(true)
  })

  it('creates task_runner_tokens with FK to tasks and partial index', () => {
    const db = freshDb()
    runMigrations(db)
    const info = db.prepare(`PRAGMA table_info(task_runner_tokens)`).all() as Array<{ name: string; notnull: number }>
    const cols = new Set(info.map((c) => c.name))
    expect(cols).toContain('task_id')
    expect(cols).toContain('attempt')
    expect(cols).toContain('token_hash')
    expect(cols).toContain('expires_at')
    expect(cols).toContain('revoked_at')
    // token_hash UNIQUE + partial index present
    const idxList = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_runner_tokens'`).all() as Array<{ name: string; sql: string | null }>
    expect(idxList.some((i) => i.name === 'idx_task_runner_tokens_task_attempt')).toBe(true)
    expect(idxList.some((i) => (i.sql || '').includes('WHERE revoked_at IS NULL'))).toBe(true)
    // FK on task_id present with CASCADE
    const fks = db.prepare(`PRAGMA foreign_key_list(task_runner_tokens)`).all() as Array<{ table: string; from: string; on_delete: string }>
    const taskFk = fks.find((f) => f.from === 'task_id')
    expect(taskFk).toBeDefined()
    expect(taskFk!.table).toBe('tasks')
    expect(taskFk!.on_delete).toBe('CASCADE')
  })

  it('creates task_checkpoints with expected columns and indexes', () => {
    const db = freshDb()
    runMigrations(db)
    const cols = new Set(
      (db.prepare(`PRAGMA table_info(task_checkpoints)`).all() as Array<{ name: string }>).map((c) => c.name)
    )
    for (const c of ['task_id', 'attempt', 'step', 'summary', 'status', 'artifacts_json', 'next_step', 'blocker_reason', 'tokens_used', 'duration_ms']) {
      expect(cols).toContain(c)
    }
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_checkpoints'`).all() as Array<{ name: string }>
    expect(idx.some((i) => i.name === 'idx_task_checkpoints_task_attempt_created')).toBe(true)
  })

  it('adds all twelve runtime columns to tasks (nullable additivity)', () => {
    const db = freshDb()
    runMigrations(db)
    const cols = new Set(
      (db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string; notnull: number }>).map((c) => c.name)
    )
    for (const c of [
      'recipe_slug', 'workspace_source', 'read_only_mounts', 'extra_skills',
      'model_override', 'container_id', 'runner_started_at', 'runner_exit_code',
      'worktree_path', 'runner_attempts', 'runner_max_attempts', 'runner_last_failure_reason',
    ]) {
      expect(cols).toContain(c)
    }
  })

  it('leaves pre-existing task rows with NULL runtime fields (no backfill)', () => {
    const db = freshDb()
    runMigrations(db)
    // seed a task with the minimal legacy columns that predate v1.2
    // Note: tasks table has workspace_id (added in migration 021) but no tenant_id column
    db.prepare(`INSERT INTO tasks (title, status, priority, workspace_id) VALUES (?, ?, ?, ?)`).run('legacy', 'inbox', 'medium', 1)
    const row = db.prepare(`SELECT recipe_slug, model_override, container_id, runner_started_at, worktree_path, runner_attempts FROM tasks WHERE title = 'legacy'`).get() as Record<string, unknown>
    expect(row.recipe_slug).toBeNull()
    expect(row.model_override).toBeNull()
    expect(row.container_id).toBeNull()
    expect(row.runner_started_at).toBeNull()
    expect(row.worktree_path).toBeNull()
    expect(row.runner_attempts).toBe(0)  // the only column with a non-null default
  })

  it('is idempotent — running runMigrations twice does not throw or duplicate rows', () => {
    const db = freshDb()
    runMigrations(db)
    const firstCount = (db.prepare(`SELECT COUNT(*) as n FROM schema_migrations`).get() as { n: number }).n
    runMigrations(db)  // second pass
    const secondCount = (db.prepare(`SELECT COUNT(*) as n FROM schema_migrations`).get() as { n: number }).n
    expect(secondCount).toBe(firstCount)
    // And the new v1.2 IDs are recorded exactly once
    for (const id of ['054_recipes', '055_task_runner_tokens', '056_task_checkpoints', '057_tasks_runtime_columns']) {
      const count = (db.prepare(`SELECT COUNT(*) as n FROM schema_migrations WHERE id = ?`).get(id) as { n: number }).n
      expect(count).toBe(1)
    }
  })

  it('forward-compat — re-running after dropping new tables restores them (simulates upgrade path)', () => {
    const db = freshDb()
    // Simulate a DB that ran through all prior migrations but nothing newer: run full migration set,
    // then DELETE the four new IDs from schema_migrations and drop the new tables, re-run.
    runMigrations(db)
    db.exec(`DROP TABLE IF EXISTS recipes`)
    db.exec(`DROP TABLE IF EXISTS task_runner_tokens`)
    db.exec(`DROP TABLE IF EXISTS task_checkpoints`)
    db.prepare(`DELETE FROM schema_migrations WHERE id IN ('054_recipes','055_task_runner_tokens','056_task_checkpoints','057_tasks_runtime_columns')`).run()
    // Columns already exist on tasks — leave them; the hasTaskCol idiom must handle the no-op path.
    // That is exactly the guarantee we are asserting: re-running 057 must not raise "duplicate column name".
    runMigrations(db)
    // Tables are back
    const tables = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((r) => r.name))
    expect(tables).toContain('recipes')
    expect(tables).toContain('task_runner_tokens')
    expect(tables).toContain('task_checkpoints')
    // And the task runtime columns are still intact (not duplicated, still present)
    const cols = new Set(
      (db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>).map((c) => c.name)
    )
    expect(cols).toContain('recipe_slug')
    expect(cols).toContain('runner_attempts')
  })
})
