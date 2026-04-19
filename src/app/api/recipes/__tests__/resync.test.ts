/**
 * Tests for POST /api/recipes/resync.
 *
 * Plan 12-04 Task 3. Each test uses an in-memory SQLite + a mkdtemp
 * recipesRoot, populates disk and/or DB to exercise scanRecipesDir through
 * the public resyncRecipes entry, and asserts the ResyncReport shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runMigrations } from '@/lib/migrations'

let testDb: Database.Database
let recipesRoot: string

vi.mock('@/lib/db', () => ({ getDatabase: () => testDb }))
vi.mock('@/lib/auth', () => ({
  requireRole: () => ({
    user: {
      id: 1,
      username: 'a',
      role: 'admin',
      workspace_id: 1,
      tenant_id: 1,
    },
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))

// NOTE: we deliberately DO NOT vi.mock('@/lib/recipe-watcher') here — the
// module-internal calls from resyncRecipes → scanRecipesDir → getRecipesRoot
// are all closure-bound, so a mock of getRecipesRoot would not intercept
// them. Instead we set MISSION_CONTROL_RECIPES_DIR directly in beforeEach so
// the real getRecipesRoot resolves to our scratch directory.

const { POST } = await import('../resync/route')

const validYaml = (slug: string) =>
  `
slug: ${slug}
name: Recipe ${slug}
image: mc-agent
workspace_mode: worktree
timeout_seconds: 300
model:
  primary: claude-sonnet-4-6
`.trim()

let originalRecipesEnv: string | undefined

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  recipesRoot = mkdtempSync(join(tmpdir(), 'recipes-resync-'))
  originalRecipesEnv = process.env.MISSION_CONTROL_RECIPES_DIR
  process.env.MISSION_CONTROL_RECIPES_DIR = recipesRoot
})
afterEach(() => {
  if (originalRecipesEnv === undefined) delete process.env.MISSION_CONTROL_RECIPES_DIR
  else process.env.MISSION_CONTROL_RECIPES_DIR = originalRecipesEnv
  rmSync(recipesRoot, { recursive: true, force: true })
})

describe('POST /api/recipes/resync', () => {
  it('returns a ResyncReport with all zeros when recipes/ is empty', async () => {
    const res = await POST(
      new Request('http://localhost/api/recipes/resync', { method: 'POST' }) as any,
    )
    const body = await res.json()
    expect(body).toEqual({ scanned: 0, inserted: 0, updated: 0, deleted: 0, errors: [] })
  })

  it('scans and indexes recipes, reports counts', async () => {
    mkdirSync(join(recipesRoot, 'p'))
    writeFileSync(join(recipesRoot, 'p', 'recipe.yaml'), validYaml('p'))
    mkdirSync(join(recipesRoot, 'q'))
    // Unterminated flow sequence — forces a true YAML parse error (the plan's
    // original `:: broken yaml :[` is actually valid YAML per the `yaml` lib
    // and surfaces as a Zod validation failure; see 12-02-SUMMARY deviation).
    writeFileSync(join(recipesRoot, 'q', 'recipe.yaml'), 'tags: [unterminated')

    const res = await POST(
      new Request('http://localhost/api/recipes/resync', { method: 'POST' }) as any,
    )
    const body = await res.json()
    expect(body.scanned).toBe(2)
    expect(body.updated).toBe(1) // 'p' indexed
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0].slug).toBe('q')
    expect(body.errors[0].reason).toMatch(/YAML parse error/i)
  })

  it('deletes orphaned rows', async () => {
    // Pre-seed a row with no disk presence.
    testDb
      .prepare(
        `
      INSERT INTO recipes (slug, name, image, workspace_mode, timeout_seconds, dir_sha,
                           env_json, secrets_json, tags_json, model_json, max_concurrent, version)
      VALUES ('orphan', 'Orphan', 'img', 'worktree', 300, 'sha', '{}', '[]', '[]', '{}', 1, 1)
    `,
      )
      .run()

    const res = await POST(
      new Request('http://localhost/api/recipes/resync', { method: 'POST' }) as any,
    )
    const body = await res.json()
    expect(body.deleted).toBe(1)
    expect(
      testDb.prepare(`SELECT COUNT(*) AS n FROM recipes WHERE slug='orphan'`).get(),
    ).toMatchObject({ n: 0 })
  })
})
