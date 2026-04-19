/**
 * Tests for GET /api/recipes and GET /api/recipes/:slug.
 *
 * Plan 12-04 Task 1. In-memory SQLite via runMigrations to materialise the
 * recipes table + recipes_fts virtual table, then seed rows directly and
 * assert on the mapped response shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'

let testDb: Database.Database
vi.mock('@/lib/db', () => ({ getDatabase: () => testDb }))
vi.mock('@/lib/auth', () => ({
  requireRole: (_req: Request, _role: string) => ({
    user: {
      id: 1,
      username: 'a',
      role: 'admin',
      workspace_id: 1,
      tenant_id: 1,
    },
  }),
}))

// Import AFTER the mocks so the route module resolves `@/lib/db` and
// `@/lib/auth` through the vi.mock overrides above.
const { GET } = await import('../route')
const { GET: getBySlug } = await import('../[slug]/route')

function seed(rows: Array<Record<string, unknown>>) {
  for (const r of rows) {
    testDb
      .prepare(
        `
      INSERT INTO recipes (slug, name, image, workspace_mode, timeout_seconds, dir_sha,
                           env_json, secrets_json, tags_json, model_json, max_concurrent, version,
                           error_message, soul_md)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        r.slug,
        r.name ?? r.slug,
        r.image ?? 'img',
        r.workspace_mode ?? 'worktree',
        r.timeout_seconds ?? 300,
        r.dir_sha ?? 'sha',
        r.env_json ?? '{}',
        r.secrets_json ?? '[]',
        r.tags_json ?? '[]',
        r.model_json ?? '{"primary":"claude-opus-4-7"}',
        r.max_concurrent ?? 1,
        r.version ?? 1,
        r.error_message ?? null,
        r.soul_md ?? null,
      )
  }
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
})

describe('GET /api/recipes', () => {
  it('returns empty list when no recipes', async () => {
    const res = await GET(new Request('http://localhost/api/recipes') as any)
    const body = await res.json()
    expect(body).toEqual({ recipes: [] })
  })

  it('lists only indexed recipes (error rows excluded by default)', async () => {
    seed([
      { slug: 'ok', tags_json: '["demo"]' },
      { slug: 'broken', error_message: 'YAML parse error' },
    ])
    const res = await GET(new Request('http://localhost/api/recipes') as any)
    const body = await res.json()
    expect(body.recipes).toHaveLength(1)
    expect(body.recipes[0].slug).toBe('ok')
    expect(body.recipes[0].tags).toEqual(['demo'])
  })

  it('returns error rows with ?include_broken=1 when admin', async () => {
    seed([
      { slug: 'ok' },
      { slug: 'broken', error_message: 'nope' },
    ])
    const res = await GET(new Request('http://localhost/api/recipes?include_broken=1') as any)
    const body = await res.json()
    expect(body.recipes).toHaveLength(2)
    const broken = body.recipes.find((r: any) => r.slug === 'broken')
    expect(broken.error_message).toBe('nope')
    expect(broken.name).toBeUndefined()
  })
})

describe('GET /api/recipes/:slug', () => {
  it('returns 404 when slug missing', async () => {
    const res = await getBySlug(
      new Request('http://localhost/api/recipes/nope') as any,
      { params: Promise.resolve({ slug: 'nope' }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns indexed recipe with parsed fields', async () => {
    seed([{ slug: 'x', tags_json: '["t1","t2"]', soul_md: '# hello' }])
    const res = await getBySlug(
      new Request('http://localhost/api/recipes/x') as any,
      { params: Promise.resolve({ slug: 'x' }) },
    )
    const body = await res.json()
    expect(body.recipe.slug).toBe('x')
    expect(body.recipe.tags).toEqual(['t1', 't2'])
    expect(body.recipe.soul_md).toBe('# hello')
  })

  it('returns error row shape when recipe is broken', async () => {
    seed([{ slug: 'b', error_message: 'unknown model: gpt-4' }])
    const res = await getBySlug(
      new Request('http://localhost/api/recipes/b') as any,
      { params: Promise.resolve({ slug: 'b' }) },
    )
    const body = await res.json()
    expect(body.recipe.slug).toBe('b')
    expect(body.recipe.error_message).toBe('unknown model: gpt-4')
    expect(body.recipe.name).toBeUndefined()
  })
})
