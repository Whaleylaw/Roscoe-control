/**
 * GET /api/recipes/:slug — fetch a single recipe by slug.
 *
 * Plan 12-04 (Phase 12 — Recipe System). Uses `getIndexedRecipeBySlug` from
 * Plan 12-02 which already discriminates between fully-indexed and error rows.
 * This handler re-serialises the row through `mapRow` (from the sibling list
 * route) so the GET-by-slug shape is identical to what a list entry looks like.
 *
 * Response codes:
 *   200 — recipe found (full shape or { slug, error_message } for broken recipes)
 *   404 — slug not in recipes table
 *   401/403 — viewer+ required
 *   500 — unexpected DB/parse failure
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getIndexedRecipeBySlug } from '@/lib/recipe-indexer'
import { logger } from '@/lib/logger'
import { mapRow } from '../route'

/**
 * GET /api/recipes/:slug — fetch a single recipe, returning either:
 *   - 200 with the full recipe when error_message IS NULL
 *   - 200 with { slug, error_message, created_at, updated_at } when broken
 *     (CONTEXT.md: error surface is visible through the API so UIs can render the failure)
 *   - 404 when the slug does not exist
 */
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { slug } = await context.params
    const row = getIndexedRecipeBySlug(slug)
    if (!row) {
      return NextResponse.json({ error: `Recipe '${slug}' not found` }, { status: 404 })
    }
    // `getIndexedRecipeBySlug` already deserialises env/secrets/tags/model from
    // JSON columns; mapRow expects the raw *_json shape so we re-serialise the
    // fields before handing off. This keeps a single projection path between
    // list, search, and fetch-by-slug so any future shape change lands in one
    // place (mapRow).
    const raw: Record<string, unknown> = { ...(row as unknown as Record<string, unknown>) }
    if ('env' in raw) raw.env_json = JSON.stringify(raw.env)
    if ('secrets' in raw) raw.secrets_json = JSON.stringify(raw.secrets)
    if ('tags' in raw) raw.tags_json = JSON.stringify(raw.tags)
    if ('model' in raw) raw.model_json = JSON.stringify(raw.model)
    return NextResponse.json({ recipe: mapRow(raw) })
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'GET /api/recipes/:slug failed')
    return NextResponse.json({ error: 'Failed to fetch recipe' }, { status: 500 })
  }
}
