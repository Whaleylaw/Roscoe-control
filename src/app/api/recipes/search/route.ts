/**
 * GET /api/recipes/search — FTS5 BM25 recipe search.
 *
 * Plan 12-04 (Phase 12 — Recipe System). RECIPE-08 tag-weighting ships here:
 * BM25 column weights are (1.0, 1.0, 1.0, 2.0) so tag matches rank twice as
 * high as name/description/when_to_use matches.
 *
 * Search behaviour:
 *   - Empty q falls through to a plain list of all indexed recipes
 *   - Tokens < 2 chars are dropped (FTS5 noise otherwise)
 *   - Each surviving token is wrapped as `token*` (prefix match) and OR'd
 *   - Special chars ("', *, (, ), :, ^, -) are stripped so we never hand
 *     malformed queries to the FTS5 parser
 *   - Broken recipes (error_message IS NOT NULL) are excluded from results
 *   - Default limit 50, capped at 200
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { mapRow } from '../route'

/**
 * GET /api/recipes/search?q=...&limit=N
 *
 * FTS5-powered search over name + description + when_to_use + tags.
 * Ranking: BM25 with column weights (1.0, 1.0, 1.0, 2.0) — tags count 2x (RECIPE-08).
 *
 * Behaviour:
 *   - Empty/missing q → fall back to listing all indexed recipes (matches GET /api/recipes)
 *   - Tokens shorter than 2 characters are dropped
 *   - Broken recipes (error_message IS NOT NULL) are excluded by default
 *   - Results ordered by BM25 ASC (lower rank = better match in FTS5)
 *   - Limit defaults to 50, max 200
 *
 * Each token is OR'd together with FTS5 prefix match (token*) so partial words still hit.
 * Special characters in the query are stripped to avoid FTS5 syntax errors.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(request.url)
  const rawQ = (url.searchParams.get('q') ?? '').trim()
  const limitParam = url.searchParams.get('limit')
  const limit = Math.min(200, Math.max(1, Number.parseInt(limitParam || '50', 10) || 50))

  try {
    const db = getDatabase()

    // No query — return full list (consistent with /api/recipes behaviour)
    if (!rawQ) {
      const rows = db
        .prepare(`SELECT * FROM recipes WHERE error_message IS NULL ORDER BY slug LIMIT ?`)
        .all(limit)
      return NextResponse.json({ recipes: (rows as Array<Record<string, unknown>>).map(mapRow) })
    }

    const ftsQuery = buildFtsQuery(rawQ)
    if (!ftsQuery) {
      // All tokens dropped — return empty
      return NextResponse.json({ recipes: [] })
    }

    // JOIN recipes_fts to recipes, exclude error rows, order by BM25 with column weights.
    // bm25(table, w1, w2, w3, w4) matches the 4 FTS columns: name, description, when_to_use, tags.
    // Higher weight => more prominent boost. FTS5's BM25 returns lower numbers for better
    // matches, so ORDER BY bm25(...) ASC puts best first.
    const rows = db
      .prepare(
        `
      SELECT r.*, bm25(recipes_fts, 1.0, 1.0, 1.0, 2.0) AS rank
      FROM recipes_fts
      JOIN recipes r ON r.id = recipes_fts.rowid
      WHERE recipes_fts MATCH ?
        AND r.error_message IS NULL
      ORDER BY rank ASC
      LIMIT ?
    `,
      )
      .all(ftsQuery, limit) as Array<Record<string, unknown>>

    return NextResponse.json({ recipes: rows.map(mapRow) })
  } catch (err) {
    logger.error({ err: (err as Error).message, q: rawQ }, 'GET /api/recipes/search failed')
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}

/**
 * Build an FTS5 MATCH query from a freeform user string.
 *
 * Steps:
 *   1. Replace FTS5 syntax characters (", ', *, (, ), :, ^, -) with spaces
 *   2. Split on whitespace
 *   3. Drop tokens < 2 chars
 *   4. Wrap each remaining token with prefix wildcard: token*
 *   5. Join with OR
 *
 * Returns null if no usable tokens remain.
 */
export function buildFtsQuery(raw: string): string | null {
  const cleaned = raw.replace(/["'*():\^\-]/g, ' ')
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
  if (tokens.length === 0) return null
  return tokens.map((t) => `${t}*`).join(' OR ')
}
