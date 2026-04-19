/**
 * GET /api/recipes — recipe listing endpoint.
 *
 * Plan 12-04 (Phase 12 — Recipe System). Task 1 implements GET (list); Task 2
 * appends POST (create). Exports `mapRow` so sibling routes ([slug], search)
 * reuse the DB-row → DTO projection.
 *
 * See .planning/phases/12-recipe-system-v1-2/12-04-PLAN.md.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * GET /api/recipes — list all fully-indexed recipes (error_message IS NULL).
 *
 * Query params:
 *   include_broken=1   — include error rows as { slug, error_message } (admin only, debug aid)
 *
 * Response: { recipes: Array<FullRecipeDto | ErrorRecipeDto> }
 *
 * Role: viewer+ for the default (indexed-only) listing. include_broken=1 requires admin.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(request.url)
  const includeBroken = url.searchParams.get('include_broken') === '1'
  if (includeBroken && auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'include_broken requires admin role' }, { status: 403 })
  }

  try {
    const db = getDatabase()
    const rows = includeBroken
      ? db.prepare(`SELECT * FROM recipes ORDER BY slug`).all()
      : db.prepare(`SELECT * FROM recipes WHERE error_message IS NULL ORDER BY slug`).all()

    const recipes = (rows as Array<Record<string, unknown>>).map(mapRow)
    return NextResponse.json({ recipes })
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'GET /api/recipes failed')
    return NextResponse.json({ error: 'Failed to list recipes' }, { status: 500 })
  }
}

/**
 * Transform a raw DB row into the API DTO. Error rows produce a small
 * { slug, error_message, created_at, updated_at } shape so the API surface
 * signals "exists but broken" distinctly from 404. Fully-indexed rows project
 * every column into the public shape and deserialise the JSON-encoded fields.
 */
export function mapRow(row: Record<string, unknown>): Record<string, unknown> {
  if (row.error_message) {
    return {
      slug: row.slug,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    when_to_use: row.when_to_use ?? null,
    image: row.image,
    workspace_mode: row.workspace_mode,
    timeout_seconds: row.timeout_seconds,
    max_concurrent: row.max_concurrent,
    env: safeJson(row.env_json, {}),
    secrets: safeJson(row.secrets_json, []),
    tags: safeJson(row.tags_json, []),
    model: safeJson(row.model_json, {}),
    version: row.version,
    dir_sha: row.dir_sha,
    soul_md: row.soul_md ?? null,
    workspace_id: row.workspace_id,
    tenant_id: row.tenant_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function safeJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
