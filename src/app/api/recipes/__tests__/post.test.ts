/**
 * Tests for POST /api/recipes.
 *
 * Plan 12-04 Task 2. Each test:
 *   - Uses an in-memory SQLite with runMigrations applied so indexRecipe can UPSERT
 *   - Redirects `getRecipesRoot()` to a mkdtemp scratch dir so real disk I/O is isolated
 *   - Stubs `requireRole` as admin + `mutationLimiter` as a no-op
 *
 * Covers happy path, 409 on existing, 400 for bad YAML / slug mismatch /
 * unknown model (MODEL-02 surface), and the "no partial writes" invariant:
 * after any 400/500 response the target directory must not exist.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
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
vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: () => null,
}))
vi.mock('@/lib/recipe-watcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/recipe-watcher')>()
  return { ...actual, getRecipesRoot: () => recipesRoot }
})

const { POST } = await import('../route')

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

function jsonReq(body: unknown) {
  return new Request('http://localhost/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  recipesRoot = mkdtempSync(join(tmpdir(), 'recipes-post-'))
})
afterEach(() => {
  rmSync(recipesRoot, { recursive: true, force: true })
})

describe('POST /api/recipes', () => {
  it('rejects missing slug with 400', async () => {
    const res = await POST(jsonReq({ recipe_yaml: 'slug: x' }) as any)
    expect(res.status).toBe(400)
  })

  it('writes recipe.yaml + SOUL.md to disk and indexes a DB row (201)', async () => {
    const body = {
      slug: 'postcreate',
      recipe_yaml: validYaml('postcreate'),
      soul_md: '# Be smart',
    }
    const res = await POST(jsonReq(body) as any)
    expect(res.status).toBe(201)
    const payload = await res.json()
    expect(payload.recipe.slug).toBe('postcreate')
    expect(existsSync(join(recipesRoot, 'postcreate', 'recipe.yaml'))).toBe(true)
    expect(readFileSync(join(recipesRoot, 'postcreate', 'SOUL.md'), 'utf8')).toBe('# Be smart')
    const row = testDb
      .prepare(`SELECT error_message FROM recipes WHERE slug='postcreate'`)
      .get() as { error_message: string | null }
    expect(row.error_message).toBeNull()
  })

  it('returns 409 when directory already exists', async () => {
    const body = { slug: 'dup', recipe_yaml: validYaml('dup'), soul_md: '' }
    await POST(jsonReq(body) as any)
    const res2 = await POST(jsonReq(body) as any)
    expect(res2.status).toBe(409)
  })

  it('returns 400 when yaml is invalid (pre-flight — no disk write)', async () => {
    const body = { slug: 'badyaml', recipe_yaml: ':: broken\n  [' }
    const res = await POST(jsonReq(body) as any)
    expect(res.status).toBe(400)
    expect(existsSync(join(recipesRoot, 'badyaml'))).toBe(false)
  })

  it('returns 400 when body.slug and yaml.slug disagree', async () => {
    const body = { slug: 'one', recipe_yaml: validYaml('two'), soul_md: '' }
    const res = await POST(jsonReq(body) as any)
    expect(res.status).toBe(400)
    expect(existsSync(join(recipesRoot, 'one'))).toBe(false)
  })

  it('returns 400 when model.primary is unknown (MODEL-02 surface)', async () => {
    const yaml = validYaml('badmodel').replace('claude-sonnet-4-6', 'gpt-4')
    const res = await POST(jsonReq({ slug: 'badmodel', recipe_yaml: yaml }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(JSON.stringify(body)).toMatch(/model registry/i)
    expect(existsSync(join(recipesRoot, 'badmodel'))).toBe(false)
  })
})
