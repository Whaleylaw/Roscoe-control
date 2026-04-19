import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runMigrations } from '../migrations'

// Mock the DB singleton BEFORE importing recipe-watcher or recipe-indexer so
// both modules see the in-memory instance. vitest hoists vi.mock() above
// the import statements; this comment exists to prevent someone from moving
// the mock below the imports in a "tidy up" pass.
let testDb: Database.Database
vi.mock('../db', () => ({
  getDatabase: () => testDb,
}))

import {
  scanRecipesDir,
  resyncRecipes,
  startRecipeWatcher,
  stopRecipeWatcher,
  getRecipesRoot,
} from '../recipe-watcher'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

const validYaml = (slug: string) => `
slug: ${slug}
name: Recipe ${slug}
image: mc-agent
workspace_mode: worktree
timeout_seconds: 300
model:
  primary: claude-sonnet-4-6
`.trim()

describe('scanRecipesDir + resyncRecipes', () => {
  let recipesRoot: string

  beforeEach(() => {
    testDb = makeDb()
    recipesRoot = mkdtempSync(join(tmpdir(), 'recipes-root-'))
  })
  afterEach(() => {
    rmSync(recipesRoot, { recursive: true, force: true })
  })

  it('reports zero counts when recipes/ does not exist (dev-env safe)', async () => {
    const report = await scanRecipesDir({ recipesRoot: join(recipesRoot, 'does-not-exist') })
    expect(report).toEqual({ scanned: 0, inserted: 0, updated: 0, deleted: 0, errors: [] })
  })

  it('indexes all subdirectories on the eager scan', async () => {
    mkdirSync(join(recipesRoot, 'alpha'))
    writeFileSync(join(recipesRoot, 'alpha', 'recipe.yaml'), validYaml('alpha'))
    mkdirSync(join(recipesRoot, 'beta'))
    writeFileSync(join(recipesRoot, 'beta', 'recipe.yaml'), validYaml('beta'))

    const report = await scanRecipesDir({ recipesRoot })
    expect(report.scanned).toBe(2)
    expect(report.updated).toBe(2)
    expect(report.errors).toEqual([])

    const rows = testDb.prepare('SELECT slug FROM recipes WHERE error_message IS NULL ORDER BY slug').all() as Array<{ slug: string }>
    expect(rows.map((r) => r.slug)).toEqual(['alpha', 'beta'])
  })

  it('deletes orphaned DB rows (directory disappeared between runs)', async () => {
    mkdirSync(join(recipesRoot, 'gamma'))
    writeFileSync(join(recipesRoot, 'gamma', 'recipe.yaml'), validYaml('gamma'))
    await scanRecipesDir({ recipesRoot })
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM recipes').get()).toMatchObject({ n: 1 })

    rmSync(join(recipesRoot, 'gamma'), { recursive: true })
    const second = await scanRecipesDir({ recipesRoot })
    expect(second.deleted).toBe(1)
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM recipes').get()).toMatchObject({ n: 0 })
  })

  it('captures errors but continues scanning (broken recipe does not stop the loop)', async () => {
    mkdirSync(join(recipesRoot, 'broken'))
    // Unterminated flow-sequence — a real YAML syntax error (not just an
    // empty/invalid object that would surface as a Zod error)
    writeFileSync(join(recipesRoot, 'broken', 'recipe.yaml'), 'tags: [unterminated\nslug: broken')
    mkdirSync(join(recipesRoot, 'valid'))
    writeFileSync(join(recipesRoot, 'valid', 'recipe.yaml'), validYaml('valid'))

    const report = await scanRecipesDir({ recipesRoot })
    expect(report.scanned).toBe(2)
    expect(report.errors.length).toBe(1)
    expect(report.errors[0]).toMatchObject({ slug: 'broken' })
    expect(report.errors[0].reason).toMatch(/YAML parse error|Invalid input|expected/i)

    // valid one still indexed
    const validRow = testDb.prepare(`SELECT slug, error_message FROM recipes WHERE slug='valid'`).get() as { slug: string; error_message: string | null }
    expect(validRow.error_message).toBeNull()
  })

  it('resyncRecipes is a direct wrapper over scanRecipesDir', async () => {
    mkdirSync(join(recipesRoot, 'rx'))
    writeFileSync(join(recipesRoot, 'rx', 'recipe.yaml'), validYaml('rx'))
    const report = await resyncRecipes({ recipesRoot })
    expect(report.scanned).toBe(1)
    expect(report.updated).toBe(1)
  })

  it('removes the DB row when a directory exists but recipe.yaml is absent', async () => {
    mkdirSync(join(recipesRoot, 'stub'))
    writeFileSync(join(recipesRoot, 'stub', 'recipe.yaml'), validYaml('stub'))
    await scanRecipesDir({ recipesRoot })
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM recipes WHERE slug=?').get('stub')).toMatchObject({ n: 1 })

    unlinkSync(join(recipesRoot, 'stub', 'recipe.yaml'))
    const second = await scanRecipesDir({ recipesRoot })
    // directory still scanned, but skipped_missing → row removed
    expect(second.deleted).toBeGreaterThanOrEqual(1)
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM recipes WHERE slug=?').get('stub')).toMatchObject({ n: 0 })
  })

  it('ignores hidden directories (starting with dot)', async () => {
    mkdirSync(join(recipesRoot, '.hidden'))
    writeFileSync(join(recipesRoot, '.hidden', 'recipe.yaml'), validYaml('hidden'))
    const report = await scanRecipesDir({ recipesRoot })
    expect(report.scanned).toBe(0)
  })
})

describe('getRecipesRoot', () => {
  const originalEnv = process.env.MISSION_CONTROL_RECIPES_DIR
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MISSION_CONTROL_RECIPES_DIR
    else process.env.MISSION_CONTROL_RECIPES_DIR = originalEnv
  })

  it('honors MISSION_CONTROL_RECIPES_DIR when set', () => {
    process.env.MISSION_CONTROL_RECIPES_DIR = '/tmp/custom-recipes'
    expect(getRecipesRoot()).toBe('/tmp/custom-recipes')
  })

  it('defaults to <cwd>/recipes otherwise', () => {
    delete process.env.MISSION_CONTROL_RECIPES_DIR
    expect(getRecipesRoot()).toBe(join(process.cwd(), 'recipes'))
  })
})

describe('startRecipeWatcher debounce', () => {
  let recipesRoot: string

  beforeEach(() => {
    testDb = makeDb()
    recipesRoot = mkdtempSync(join(tmpdir(), 'recipes-watcher-'))
    mkdirSync(join(recipesRoot, 'delta'))
    writeFileSync(join(recipesRoot, 'delta', 'recipe.yaml'), validYaml('delta'))
  })
  afterEach(async () => {
    await stopRecipeWatcher()
    rmSync(recipesRoot, { recursive: true, force: true })
  })

  it('starts, eager-scans, and then reacts to a change event after debounce window', async () => {
    await startRecipeWatcher({ recipesRoot })
    // Boot scan should have inserted the delta row
    const initial = testDb.prepare(`SELECT dir_sha FROM recipes WHERE slug='delta'`).get() as { dir_sha: string }
    expect(initial.dir_sha).not.toBe('')

    // Modify the recipe — change timeout_seconds from 300 to 600
    writeFileSync(join(recipesRoot, 'delta', 'recipe.yaml'), validYaml('delta').replace('300', '600'))
    // Wait longer than awaitWriteFinish + debounce (200 + 250 + buffer)
    await new Promise((r) => setTimeout(r, 1200))
    const after = testDb.prepare(`SELECT timeout_seconds FROM recipes WHERE slug='delta'`).get() as { timeout_seconds: number }
    expect(after.timeout_seconds).toBe(600)
  })

  it('ignores temp/swap files (.swp, ~, .tmp, .DS_Store) — no extra reindex', async () => {
    await startRecipeWatcher({ recipesRoot })
    const before = testDb.prepare(`SELECT updated_at FROM recipes WHERE slug='delta'`).get() as { updated_at: number }

    writeFileSync(join(recipesRoot, 'delta', '.recipe.yaml.swp'), 'editor temp')
    writeFileSync(join(recipesRoot, 'delta', 'recipe.yaml~'), 'editor backup')
    writeFileSync(join(recipesRoot, 'delta', 'scratch.tmp'), 'ephemeral')
    writeFileSync(join(recipesRoot, 'delta', '.DS_Store'), 'mac-os noise')

    await new Promise((r) => setTimeout(r, 1200))
    const after = testDb.prepare(`SELECT updated_at FROM recipes WHERE slug='delta'`).get() as { updated_at: number }
    expect(after.updated_at).toBe(before.updated_at)
  })
})
