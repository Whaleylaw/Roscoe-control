import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  return db
}

describe('migrations 058_recipes_error_message + 059_recipes_fts5', () => {
  let db: Database.Database
  beforeEach(() => {
    db = makeDb()
    runMigrations(db)
  })

  it('adds error_message column to recipes', () => {
    const cols = db.prepare('PRAGMA table_info(recipes)').all() as Array<{ name: string; type: string }>
    const col = cols.find((c) => c.name === 'error_message')
    expect(col).toBeDefined()
    expect(col!.type).toBe('TEXT')
  })

  it('creates partial index idx_recipes_error_null', () => {
    const idx = db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_recipes_error_null'`)
      .get() as { name: string; sql: string } | undefined
    expect(idx).toBeDefined()
    expect(idx!.sql).toMatch(/WHERE error_message IS NULL/)
  })

  it('creates recipes_fts virtual table using fts5', () => {
    const row = db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name='recipes_fts'`)
      .get() as { name: string; sql: string } | undefined
    expect(row).toBeDefined()
    expect(row!.sql).toMatch(/USING fts5/i)
  })

  it('keeps recipes_fts in sync via triggers (INSERT + DELETE + UPDATE)', () => {
    db.prepare(
      `INSERT INTO recipes (slug, name, description, when_to_use, image, workspace_mode, timeout_seconds, dir_sha, tags_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('r1', 'Recipe One', 'desc one', 'use when one', 'img1', 'worktree', 300, 'sha1', '["alpha","beta"]')

    const ftsAfterInsert = db
      .prepare(`SELECT name FROM recipes_fts WHERE recipes_fts MATCH 'one'`)
      .all() as Array<{ name: string }>
    expect(ftsAfterInsert.length).toBeGreaterThanOrEqual(1)

    db.prepare(`UPDATE recipes SET description='desc updated' WHERE slug='r1'`).run()
    const ftsAfterUpdate = db
      .prepare(`SELECT description FROM recipes_fts WHERE recipes_fts MATCH 'updated'`)
      .all() as Array<{ description: string }>
    expect(ftsAfterUpdate.length).toBe(1)

    db.prepare(`DELETE FROM recipes WHERE slug='r1'`).run()
    const ftsAfterDelete = db
      .prepare(`SELECT name FROM recipes_fts WHERE recipes_fts MATCH 'one'`)
      .all() as Array<{ name: string }>
    expect(ftsAfterDelete.length).toBe(0)
  })

  it('is idempotent: running migrations twice does not error', () => {
    expect(() => runMigrations(db)).not.toThrow()
  })
})
