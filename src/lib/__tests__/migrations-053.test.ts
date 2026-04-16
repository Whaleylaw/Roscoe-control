import Database from 'better-sqlite3'
import { describe, it, expect } from 'vitest'
import { runMigrations } from '@/lib/migrations'

type ColInfo = { name: string; dflt_value: string | null; notnull: number; type: string }
type IdxInfo = { name: string }

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  runMigrations(db)
  return db
}

describe('migration 053_gsd_hierarchy_foundation', () => {
  it('creates gsd_workstreams, gsd_milestones, gsd_phases, and gsd_plans tables', () => {
    const db = freshDb()
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'gsd_workstreams',
        'gsd_milestones',
        'gsd_phases',
        'gsd_plans',
      ])
    )
    db.close()
  })

  it('creates the expected hierarchical columns and defaults', () => {
    const db = freshDb()

    const workstreamCols = db.prepare(`PRAGMA table_info(gsd_workstreams)`).all() as ColInfo[]
    expect(workstreamCols.find((c) => c.name === 'status')?.dflt_value).toBe(`'active'`)

    const milestoneCols = db.prepare(`PRAGMA table_info(gsd_milestones)`).all() as ColInfo[]
    expect(milestoneCols.find((c) => c.name === 'status')?.dflt_value).toBe(`'planned'`)
    expect(milestoneCols.find((c) => c.name === 'workstream_id')?.notnull).toBe(0)

    const phaseCols = db.prepare(`PRAGMA table_info(gsd_phases)`).all() as ColInfo[]
    expect(phaseCols.find((c) => c.name === 'lifecycle_phase')?.dflt_value).toBe(`'discuss'`)
    expect(phaseCols.find((c) => c.name === 'status')?.dflt_value).toBe(`'planned'`)
    expect(phaseCols.find((c) => c.name === 'depends_on_phase_ids')?.dflt_value).toBe(`'[]'`)
    expect(phaseCols.find((c) => c.name === 'ordering_numeric')?.type).toBe('REAL')

    const planCols = db.prepare(`PRAGMA table_info(gsd_plans)`).all() as ColInfo[]
    expect(planCols.find((c) => c.name === 'wave')?.dflt_value).toBe('1')
    expect(planCols.find((c) => c.name === 'status')?.dflt_value).toBe(`'todo'`)
    expect(planCols.find((c) => c.name === 'depends_on_plan_ids')?.dflt_value).toBe(`'[]'`)

    db.close()
  })

  it('adds nullable hierarchical linkage columns to tasks', () => {
    const db = freshDb()
    const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as ColInfo[]
    const names = cols.map((c) => c.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'gsd_workstream_id',
        'gsd_milestone_id',
        'gsd_phase_id',
        'gsd_plan_id',
      ])
    )
    expect(cols.find((c) => c.name === 'gsd_workstream_id')?.notnull).toBe(0)
    expect(cols.find((c) => c.name === 'gsd_milestone_id')?.notnull).toBe(0)
    expect(cols.find((c) => c.name === 'gsd_phase_id')?.notnull).toBe(0)
    expect(cols.find((c) => c.name === 'gsd_plan_id')?.notnull).toBe(0)
    db.close()
  })

  it('creates indexes for hierarchy tables and task linkage hot paths', () => {
    const db = freshDb()
    const idxs = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as IdxInfo[]
    const idxNames = idxs.map((i) => i.name)

    expect(idxNames).toEqual(
      expect.arrayContaining([
        'idx_gsd_workstreams_project_status',
        'idx_gsd_milestones_project_status',
        'idx_gsd_milestones_workstream',
        'idx_gsd_phases_milestone_order',
        'idx_gsd_phases_status',
        'idx_gsd_plans_phase_wave',
        'idx_gsd_plans_status',
        'idx_tasks_gsd_workstream_id',
        'idx_tasks_gsd_milestone_id',
        'idx_tasks_gsd_phase_id',
        'idx_tasks_gsd_plan_id',
      ])
    )
    db.close()
  })

  it('enforces workstream key uniqueness per project and scoped phase/plan uniqueness', () => {
    const db = freshDb()

    db.prepare(
      `INSERT INTO projects (workspace_id, name, slug, status, ticket_prefix, ticket_counter)
       VALUES (1, 'Alpha', 'alpha', 'active', 'ALP', 0)`
    ).run()
    db.prepare(
      `INSERT INTO projects (workspace_id, name, slug, status, ticket_prefix, ticket_counter)
       VALUES (1, 'Beta', 'beta', 'active', 'BET', 0)`
    ).run()

    db.prepare(
      `INSERT INTO gsd_workstreams (project_id, key, name)
       VALUES (1, 'core', 'Core')`
    ).run()
    expect(() =>
      db.prepare(
        `INSERT INTO gsd_workstreams (project_id, key, name)
         VALUES (1, 'core', 'Duplicate Core')`
      ).run()
    ).toThrow()

    expect(() =>
      db.prepare(
        `INSERT INTO gsd_workstreams (project_id, key, name)
         VALUES (2, 'core', 'Core for Beta')`
      ).run()
    ).not.toThrow()

    db.prepare(
      `INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title)
       VALUES (1, 1, 'v1.2', 'Launch')`
    ).run()
    db.prepare(
      `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, ordering_numeric)
       VALUES (1, '10', 'phase-10', 10.0)`
    ).run()
    expect(() =>
      db.prepare(
        `INSERT INTO gsd_phases (milestone_id, phase_key, phase_slug, ordering_numeric)
         VALUES (1, '10', 'phase-10-dup', 10.1)`
      ).run()
    ).toThrow()

    db.prepare(
      `INSERT INTO gsd_plans (phase_id, plan_ref, title)
       VALUES (1, '10-01', 'Foundation')`
    ).run()
    expect(() =>
      db.prepare(
        `INSERT INTO gsd_plans (phase_id, plan_ref, title)
         VALUES (1, '10-01', 'Foundation duplicate')`
      ).run()
    ).toThrow()

    db.close()
  })

  it('is additive for legacy rows: pre-053 tasks remain valid and new linkage ids default to null', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO tasks (title, description, status, priority, created_at, updated_at)
       VALUES ('Legacy task', 'phase 9 row', 'inbox', 'medium', unixepoch(), unixepoch())`
    ).run()

    const task = db.prepare(
      `SELECT gsd_workstream_id, gsd_milestone_id, gsd_phase_id, gsd_plan_id
       FROM tasks
       WHERE title = 'Legacy task'`
    ).get() as {
      gsd_workstream_id: number | null
      gsd_milestone_id: number | null
      gsd_phase_id: number | null
      gsd_plan_id: number | null
    }

    expect(task.gsd_workstream_id).toBeNull()
    expect(task.gsd_milestone_id).toBeNull()
    expect(task.gsd_phase_id).toBeNull()
    expect(task.gsd_plan_id).toBeNull()
    db.close()
  })

  it('re-running migrations keeps migration 053 idempotent', () => {
    const db = freshDb()
    expect(() => runMigrations(db)).not.toThrow()

    const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as ColInfo[]
    expect(cols.filter((c) => c.name === 'gsd_phase_id')).toHaveLength(1)

    db.close()
  })
})
