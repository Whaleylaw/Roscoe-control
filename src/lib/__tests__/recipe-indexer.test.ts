/**
 * Plan 17-02 GAP AUDIT (RTEST-01 sharp-edge checklist):
 *   - malformed YAML → error_message row    → PRE-EXISTING (line 82-94, tags: [unterminated)
 *   - Zod schema failure → error_message    → PRE-EXISTING (line 96-109)
 *   - unknown model.primary rejection       → PRE-EXISTING (line 111-128, MODEL-02)
 *   - slug mismatch → error_message         → PRE-EXISTING (line 130-139)
 *   - status=indexed_error                  → n/a — shipped API uses status='error' (plan 17-02 text
 *                                             referenced 'indexed_error'; the actual result type is 'error')
 *
 * No new tests added by 17-02: all six gap candidates for recipe-indexer
 * are already exercised. See .planning/phases/17-integration-testing-reference-pipeline/17-02-SUMMARY.md.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runMigrations } from '../migrations'
import {
  indexRecipe,
  removeRecipe,
  getIndexedRecipeBySlug,
} from '../recipe-indexer'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

const validYaml = `
slug: hello
name: Hello
image: mc-hello-agent
workspace_mode: worktree
timeout_seconds: 300
tags:
  - demo
model:
  primary: claude-sonnet-4-6
`.trim()

describe('recipe-indexer', () => {
  let db: Database.Database
  let dir: string
  let recipeDir: string

  beforeEach(() => {
    db = makeDb()
    dir = mkdtempSync(join(tmpdir(), 'recipe-idx-'))
    recipeDir = join(dir, 'hello')
    mkdirSync(recipeDir)
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    db.close()
  })

  it('indexes a valid recipe (status=indexed)', async () => {
    writeFileSync(join(recipeDir, 'recipe.yaml'), validYaml)
    writeFileSync(join(recipeDir, 'SOUL.md'), '# Be helpful')

    const result = await indexRecipe(recipeDir, { dbOverride: db })
    expect(result.status).toBe('indexed')

    const read = getIndexedRecipeBySlug('hello', { dbOverride: db })
    expect(read).not.toBeNull()
    // Narrow to RecipeRow (error_message is null)
    if (!read || read.error_message !== null) {
      throw new Error('expected indexed row')
    }
    expect(read.name).toBe('Hello')
    expect(read.tags).toEqual(['demo'])
    expect(read.soul_md).toBe('# Be helpful')
    expect(read.error_message).toBeNull()
    expect(read.model.primary).toBe('claude-sonnet-4-6')
  })

  it('second call with unchanged files returns status=unchanged (dir_sha dedup)', async () => {
    writeFileSync(join(recipeDir, 'recipe.yaml'), validYaml)
    await indexRecipe(recipeDir, { dbOverride: db })
    const second = await indexRecipe(recipeDir, { dbOverride: db })
    expect(second.status).toBe('unchanged')
  })

  it('force=true re-indexes even when dir_sha matches', async () => {
    writeFileSync(join(recipeDir, 'recipe.yaml'), validYaml)
    await indexRecipe(recipeDir, { dbOverride: db })
    const forced = await indexRecipe(recipeDir, { dbOverride: db, force: true })
    expect(forced.status).toBe('indexed')
  })

  it('writes an error row when recipe.yaml has YAML syntax errors (hard-fail class)', async () => {
    // Unterminated flow-sequence trips the YAML parser before Zod runs.
    writeFileSync(join(recipeDir, 'recipe.yaml'), 'slug: hello\ntags: [unterminated\nname: Hello')
    const result = await indexRecipe(recipeDir, { dbOverride: db })
    expect(result.status).toBe('error')

    const read = getIndexedRecipeBySlug('hello', { dbOverride: db })
    expect(read).not.toBeNull()
    if (!read || !('error_message' in read) || read.error_message === null) {
      throw new Error('expected error row with error_message set')
    }
    expect(read.error_message).toMatch(/YAML parse error/i)
  })

  it('writes an error row when recipe.yaml fails Zod schema validation (missing required fields)', async () => {
    // Parseable YAML but missing every required field.
    writeFileSync(join(recipeDir, 'recipe.yaml'), 'foo: bar\nbaz: qux\n')
    const result = await indexRecipe(recipeDir, { dbOverride: db })
    expect(result.status).toBe('error')

    const read = getIndexedRecipeBySlug('hello', { dbOverride: db })
    expect(read).not.toBeNull()
    if (!read || !('error_message' in read) || read.error_message === null) {
      throw new Error('expected error row with error_message set')
    }
    // Zod surfaces the missing-field paths with `; ` joiner from parseRecipeYaml.
    expect(read.error_message).toMatch(/slug:|name:|image:/)
  })

  it('writes an error row when model.primary is unknown (MODEL-02)', async () => {
    writeFileSync(
      join(recipeDir, 'recipe.yaml'),
      validYaml.replace('claude-sonnet-4-6', 'gpt-4'),
    )
    const result = await indexRecipe(recipeDir, { dbOverride: db })
    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('unreachable')
    expect(result.error).toMatch(/model registry/i)
    expect(result.error).toMatch(/gpt-4/)

    const read = getIndexedRecipeBySlug('hello', { dbOverride: db })
    expect(read).not.toBeNull()
    if (!read || read.error_message === null) {
      throw new Error('expected error row')
    }
    expect(read.error_message).toMatch(/model registry/i)
  })

  it('writes an error row when recipe.yaml slug mismatches directory name', async () => {
    writeFileSync(
      join(recipeDir, 'recipe.yaml'),
      validYaml.replace('slug: hello', 'slug: something-else'),
    )
    const result = await indexRecipe(recipeDir, { dbOverride: db })
    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('unreachable')
    expect(result.error).toMatch(/slug mismatch/i)
  })

  it('returns skipped_missing when recipe.yaml is absent', async () => {
    const result = await indexRecipe(recipeDir, { dbOverride: db })
    expect(result.status).toBe('skipped_missing')
    // No row should have been written
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM recipes WHERE slug = 'hello'`)
      .get() as { n: number }
    expect(row.n).toBe(0)
  })

  it('removeRecipe deletes the row and cascade-clears FTS', async () => {
    writeFileSync(join(recipeDir, 'recipe.yaml'), validYaml)
    await indexRecipe(recipeDir, { dbOverride: db })

    // Row exists, FTS indexed the tokens
    const beforeFts = db
      .prepare(`SELECT COUNT(*) AS n FROM recipes_fts WHERE recipes_fts MATCH 'hello'`)
      .get() as { n: number }
    expect(beforeFts.n).toBeGreaterThan(0)

    const { removed } = removeRecipe('hello', { dbOverride: db })
    expect(removed).toBe(true)

    const gone = getIndexedRecipeBySlug('hello', { dbOverride: db })
    expect(gone).toBeNull()

    const afterFts = db
      .prepare(`SELECT COUNT(*) AS n FROM recipes_fts WHERE recipes_fts MATCH 'hello'`)
      .get() as { n: number }
    expect(afterFts.n).toBe(0)
  })

  it('transitioning from error row to valid flips error_message back to NULL', async () => {
    // Unterminated flow-sequence → real YAML parse error.
    writeFileSync(join(recipeDir, 'recipe.yaml'), 'slug: hello\ntags: [unterminated\n')
    await indexRecipe(recipeDir, { dbOverride: db })
    const broken = getIndexedRecipeBySlug('hello', { dbOverride: db })
    expect(broken).not.toBeNull()
    if (!broken || broken.error_message === null) {
      throw new Error('expected broken row with error_message set')
    }
    expect(broken.error_message).toBeTruthy()

    writeFileSync(join(recipeDir, 'recipe.yaml'), validYaml)
    const fixed = await indexRecipe(recipeDir, { dbOverride: db })
    expect(fixed.status).toBe('indexed')

    const healthy = getIndexedRecipeBySlug('hello', { dbOverride: db })
    expect(healthy).not.toBeNull()
    if (!healthy || healthy.error_message !== null) {
      throw new Error('expected indexed row after fix')
    }
    expect(healthy.error_message).toBeNull()
    if (!('name' in healthy)) throw new Error('expected full RecipeRow')
    expect(healthy.name).toBe('Hello')
  })

  it('removeRecipe returns { removed: false } when no row exists', () => {
    const { removed } = removeRecipe('nonexistent', { dbOverride: db })
    expect(removed).toBe(false)
  })
})
