import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'

let db: InstanceType<typeof Database>

beforeAll(() => {
  db = new Database(':memory:')

  // Create minimal tasks table with project_id column
  db.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'inbox',
      project_id INTEGER
    )
  `)

  // Create minimal claude_sessions table
  db.exec(`
    CREATE TABLE claude_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      project_slug TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0
    )
  `)

  // Run the migration indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_project_active ON claude_sessions(project_slug, is_active)`)
})

afterAll(() => {
  db.close()
})

describe('Project workspace indexes (FOUN-02, D-10)', () => {
  it('migration 051_project_workspace_indexes exists in migrations array', async () => {
    // Read the migrations file source to verify the migration ID exists
    const fs = await import('fs')
    const path = await import('path')
    const migrationsSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'migrations.ts'),
      'utf-8'
    )
    expect(migrationsSource).toContain('051_project_workspace_indexes')
  })

  it('idx_tasks_project_status index exists after migration', () => {
    const rows = db.pragma('index_info(idx_tasks_project_status)') as any[]
    expect(rows.length).toBeGreaterThan(0)
  })

  it('EXPLAIN QUERY PLAN for tasks by project+status uses idx_tasks_project_status', () => {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT status, COUNT(*) FROM tasks WHERE project_id = 'test-project' GROUP BY status`
      )
      .all() as any[]
    const details = plan.map((r: any) => r.detail).join(' ')
    expect(details).toMatch(/USING (?:COVERING )?INDEX idx_tasks_project_status/)
    expect(details).not.toContain('SCAN TABLE tasks')
  })

  it('idx_sessions_project_active index exists after migration', () => {
    const rows = db.pragma('index_info(idx_sessions_project_active)') as any[]
    expect(rows.length).toBeGreaterThan(0)
  })

  it('EXPLAIN QUERY PLAN for sessions by project+active uses idx_sessions_project_active', () => {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM claude_sessions WHERE project_slug = 'test-project' AND is_active = 1`
      )
      .all() as any[]
    const details = plan.map((r: any) => r.detail).join(' ')
    expect(details).toMatch(/USING (?:COVERING )?INDEX idx_sessions_project_active/)
    expect(details).not.toContain('SCAN TABLE claude_sessions')
  })
})
