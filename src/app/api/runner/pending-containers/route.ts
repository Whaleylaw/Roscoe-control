import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * GET /api/runner/pending-containers — tasks with an active container record.
 *
 * Auth: runner-secret principal only (user.id === -1000). 403 otherwise.
 *
 * Used by the runner daemon's post-crash reconciliation (Phase 14 CONTEXT.md
 * boot sequence step 3): the daemon lists `docker ps -a --filter label=mc.task_id`
 * and cross-references with this endpoint to decide adopt-vs-kill for each
 * orphan container.
 *
 * Query shape:
 *   - container_id IS NOT NULL (there IS a container attribution on the task)
 *   - status IN ('assigned', 'in_progress') — terminal tasks (done/failed/cancelled)
 *     are handled by /api/runner/terminal-tasks for GC, not reconciled here.
 *
 * Response: { tasks: [...] } — stable id-ascending order.
 */

type PendingContainerRow = {
  id: number
  recipe_slug: string | null
  container_id: string
  status: string
  runner_started_at: number | null
  runner_attempts: number
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (auth.user.id !== -1000) {
    return NextResponse.json(
      { error: 'runner-secret principal required' },
      { status: 403 },
    )
  }

  try {
    const db = getDatabase()
    const rows = db
      .prepare(
        `SELECT id, recipe_slug, container_id, status, runner_started_at, runner_attempts
         FROM tasks
         WHERE container_id IS NOT NULL
           AND status IN ('assigned', 'in_progress')
         ORDER BY id ASC`,
      )
      .all() as PendingContainerRow[]

    return NextResponse.json({ tasks: rows })
  } catch (err) {
    logger.error({ err }, 'GET /api/runner/pending-containers — DB error')
    return NextResponse.json(
      { error: 'Failed to load pending containers' },
      { status: 500 },
    )
  }
}
