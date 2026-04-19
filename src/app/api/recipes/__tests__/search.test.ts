/**
 * Tests for GET /api/recipes/search and the FTS5 query builder.
 *
 * Plan 12-04 Task 1 (RECIPE-08). In-memory SQLite with migrations applied
 * (recipes + recipes_fts triggers). Seed rows via INSERT — the AFTER INSERT
 * trigger from migration 059 populates recipes_fts for us.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'

let testDb: Database.Database
vi.mock('@/lib/db', () => ({ getDatabase: () => testDb }))
vi.mock('@/lib/auth', () => ({
  requireRole: () => ({
    user: {
      id: 1,
      username: 'a',
      role: 'viewer',
      workspace_id: 1,
      tenant_id: 1,
    },
  }),
}))

const { GET, buildFtsQuery } = await import('../search/route')

function seedRecipe(db: Database.Database, slug: string, patch: Record<string, unknown> = {}) {
  db.prepare(
    `
    INSERT INTO recipes (slug, name, description, when_to_use, image, workspace_mode, timeout_seconds, dir_sha,
                         env_json, secrets_json, tags_json, model_json, max_concurrent, version, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    slug,
    patch.name ?? `Recipe ${slug}`,
    patch.description ?? null,
    patch.when_to_use ?? null,
    'img',
    'worktree',
    300,
    'sha',
    '{}',
    '[]',
    patch.tags_json ?? '[]',
    '{"primary":"claude-opus-4-7"}',
    1,
    1,
    patch.error_message ?? null,
  )
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
})

describe('buildFtsQuery', () => {
  it('strips FTS syntax chars and drops short tokens', () => {
    expect(buildFtsQuery('"refactor" (a) - js')).toBe('refactor* OR js*')
  })
  it('returns null when no usable tokens remain', () => {
    expect(buildFtsQuery('a " *')).toBeNull()
  })
  it('joins tokens with OR and adds prefix wildcard', () => {
    expect(buildFtsQuery('hello world')).toBe('hello* OR world*')
  })
})

describe('GET /api/recipes/search', () => {
  it('empty q returns full indexed list', async () => {
    seedRecipe(testDb, 'alpha')
    seedRecipe(testDb, 'broken', { error_message: 'bad' })
    const res = await GET(new Request('http://localhost/api/recipes/search') as any)
    const body = await res.json()
    expect(body.recipes.map((r: any) => r.slug)).toEqual(['alpha'])
  })

  it('matches by name substring (prefix match via token*)', async () => {
    seedRecipe(testDb, 'refactor-ts', { name: 'Refactor TS' })
    seedRecipe(testDb, 'bug-fix', { name: 'Bug fix' })
    const res = await GET(
      new Request('http://localhost/api/recipes/search?q=refactor') as any,
    )
    const body = await res.json()
    expect(body.recipes.map((r: any) => r.slug)).toEqual(['refactor-ts'])
  })

  it('ranks tag-match above description-match (tags weighted 2x)', async () => {
    // Two recipes: one mentions "deploy" only in description, the other only in tags.
    // With tag weight 2x, the tag-matched recipe should come FIRST.
    seedRecipe(testDb, 'describe-only', {
      description: 'this recipe is for deploy tasks',
    })
    seedRecipe(testDb, 'tag-only', {
      description: 'unrelated text',
      tags_json: '["deploy"]',
    })

    const res = await GET(new Request('http://localhost/api/recipes/search?q=deploy') as any)
    const body = await res.json()
    const slugs = body.recipes.map((r: any) => r.slug)
    expect(slugs).toContain('tag-only')
    expect(slugs).toContain('describe-only')
    // Tag match should rank higher (BM25 ASC => first)
    expect(slugs.indexOf('tag-only')).toBeLessThan(slugs.indexOf('describe-only'))
  })

  it('excludes broken recipes from search results', async () => {
    seedRecipe(testDb, 'good', { name: 'good tool' })
    seedRecipe(testDb, 'bad', { name: 'good tool too', error_message: 'broken' })
    const res = await GET(new Request('http://localhost/api/recipes/search?q=good') as any)
    const body = await res.json()
    expect(body.recipes.map((r: any) => r.slug)).toEqual(['good'])
  })

  it('limit param caps result count', async () => {
    for (let i = 0; i < 10; i++) seedRecipe(testDb, `r-${i}`, { name: `common-${i}` })
    const res = await GET(
      new Request('http://localhost/api/recipes/search?q=common&limit=3') as any,
    )
    const body = await res.json()
    expect(body.recipes.length).toBe(3)
  })

  it('short tokens (<2 chars) are dropped; if all dropped, returns empty', async () => {
    seedRecipe(testDb, 'hello')
    const res = await GET(new Request('http://localhost/api/recipes/search?q=a') as any)
    const body = await res.json()
    expect(body.recipes).toEqual([])
  })
})
