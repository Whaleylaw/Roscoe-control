import Database from 'better-sqlite3'
import { describe, it, expect } from 'vitest'
import { runMigrations } from '@/lib/migrations'

// Wave 1 fills these in. Covers: GSD-02, GSD-06.
// Migration 052_gsd_native_integration adds:
//   projects: gsd_enabled, gsd_track, gsd_phase, gsd_gate_mode,
//             gsd_project_id, gsd_updated_at
//   tasks:    gsd_phase, gate_required, gate_status, gate_approved_by,
//             gate_approved_at, depends_on_task_ids
// Indexes: idx_projects_gsd_phase, idx_tasks_gsd_phase,
//          idx_tasks_gate_status, idx_tasks_project_gsd_phase

type ColInfo = { name: string; dflt_value: string | null; notnull: number; type: string }
type IdxInfo = { name: string }

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  runMigrations(db)
  return db
}

describe('migration 052_gsd_native_integration (GSD-02, GSD-06)', () => {
  it('adds gsd_enabled/gsd_track/gsd_phase/gsd_gate_mode/gsd_project_id/gsd_updated_at columns to projects (GSD-02)', () => {
    const db = freshDb()
    const cols = db.prepare(`PRAGMA table_info(projects)`).all() as ColInfo[]
    const names = cols.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'gsd_enabled',
        'gsd_track',
        'gsd_phase',
        'gsd_gate_mode',
        'gsd_project_id',
        'gsd_updated_at',
      ])
    )
    expect(cols.find((c) => c.name === 'gsd_phase')?.dflt_value).toBe(`'discuss'`)
    expect(cols.find((c) => c.name === 'gsd_gate_mode')?.dflt_value).toBe(`'manual_approval'`)
    expect(cols.find((c) => c.name === 'gsd_enabled')?.dflt_value).toBe('0')
    expect(cols.find((c) => c.name === 'gsd_track')?.notnull).toBe(0)
    expect(cols.find((c) => c.name === 'gsd_project_id')?.notnull).toBe(0)
    expect(cols.find((c) => c.name === 'gsd_updated_at')?.notnull).toBe(0)
    db.close()
  })

  it('adds gsd_phase/gate_required/gate_status/gate_approved_by/gate_approved_at/depends_on_task_ids columns to tasks (GSD-04, GSD-05)', () => {
    const db = freshDb()
    const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as ColInfo[]
    const names = cols.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'gsd_phase',
        'gate_required',
        'gate_status',
        'gate_approved_by',
        'gate_approved_at',
        'depends_on_task_ids',
      ])
    )
    expect(cols.find((c) => c.name === 'gate_required')?.dflt_value).toBe('0')
    expect(cols.find((c) => c.name === 'gate_status')?.dflt_value).toBe(`'not_required'`)
    expect(cols.find((c) => c.name === 'gsd_phase')?.notnull).toBe(0)
    expect(cols.find((c) => c.name === 'gate_approved_by')?.notnull).toBe(0)
    expect(cols.find((c) => c.name === 'gate_approved_at')?.notnull).toBe(0)
    expect(cols.find((c) => c.name === 'depends_on_task_ids')?.notnull).toBe(0)
    db.close()
  })

  it('creates idx_projects_gsd_phase, idx_tasks_gsd_phase, idx_tasks_gate_status, idx_tasks_project_gsd_phase indexes', () => {
    const db = freshDb()
    const idxs = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as IdxInfo[]
    const idxNames = idxs.map((i) => i.name)
    expect(idxNames).toContain('idx_projects_gsd_phase')
    expect(idxNames).toContain('idx_tasks_gsd_phase')
    expect(idxNames).toContain('idx_tasks_gate_status')
    expect(idxNames).toContain('idx_tasks_project_gsd_phase')
    db.close()
  })

  it('is additive — pre-052 DB rows retain existing columns; gsd_phase defaults to "discuss" (GSD-06)', () => {
    const db = freshDb()
    // Insert a project row using only required pre-052 columns.
    db.prepare(
      `INSERT INTO projects (workspace_id, name, slug, status, ticket_prefix, ticket_counter)
       VALUES (1, 'Test Project', 'test-project', 'active', 'TST', 0)`
    ).run()
    const proj = db
      .prepare(`SELECT gsd_enabled, gsd_track, gsd_phase, gsd_gate_mode FROM projects WHERE slug = 'test-project'`)
      .get() as { gsd_enabled: number; gsd_track: string | null; gsd_phase: string; gsd_gate_mode: string }
    expect(proj.gsd_enabled).toBe(0)
    expect(proj.gsd_track).toBeNull()
    expect(proj.gsd_phase).toBe('discuss')
    expect(proj.gsd_gate_mode).toBe('manual_approval')
    db.close()
  })

  it('gate_status defaults to "not_required"; gsd_enabled and gate_required default to 0 on existing task rows', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO tasks (title, description, status, priority, created_at, updated_at)
       VALUES ('T', 'd', 'inbox', 'medium', unixepoch(), unixepoch())`
    ).run()
    const task = db
      .prepare(`SELECT gsd_phase, gate_required, gate_status FROM tasks LIMIT 1`)
      .get() as { gsd_phase: string | null; gate_required: number; gate_status: string }
    expect(task.gsd_phase).toBeNull()
    expect(task.gate_required).toBe(0)
    expect(task.gate_status).toBe('not_required')
    db.close()
  })

  it('re-running migration is a no-op (PRAGMA guard skips existing columns)', () => {
    const db = freshDb()
    expect(() => runMigrations(db)).not.toThrow()
    // Verify column count didn't double
    const cols = db.prepare(`PRAGMA table_info(projects)`).all() as ColInfo[]
    const gsdEnabledCount = cols.filter((c) => c.name === 'gsd_enabled').length
    expect(gsdEnabledCount).toBe(1)
    db.close()
  })
})
