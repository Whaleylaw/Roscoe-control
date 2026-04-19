/**
 * POST /api/recipes/resync — admin-only force rescan of recipes/ into the DB.
 *
 * Plan 12-04 Task 3. Thin wrapper over `resyncRecipes()` from Plan 12-03.
 * The handler is synchronous (awaits completion before responding) per
 * CONTEXT.md "not for hot paths" — operators invoke this when the watcher
 * has fallen behind or after bulk recipe edits outside the watcher's lifetime
 * (e.g. git checkout, git pull, editor external write).
 *
 * Response body is the ResyncReport verbatim:
 *   { scanned, inserted, updated, deleted, errors: [{ slug, reason }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { resyncRecipes } from '@/lib/recipe-watcher'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

/**
 * POST /api/recipes/resync — force a full rescan of recipes/.
 *
 * Admin only. Synchronous: waits for the scan to finish before responding
 * (per CONTEXT.md — "not for hot paths"). Returns a ResyncReport.
 *
 * This is the admin recovery tool for "watcher fell behind" situations.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rl = mutationLimiter(request)
  if (rl) return rl

  try {
    const report = await resyncRecipes()
    return NextResponse.json({
      scanned: report.scanned,
      inserted: report.inserted,
      updated: report.updated,
      deleted: report.deleted,
      errors: report.errors,
    })
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'POST /api/recipes/resync failed')
    return NextResponse.json({ error: 'Resync failed' }, { status: 500 })
  }
}
