/**
 * GET /api/runner/inventory — read-through observability over runner heartbeat metadata.
 *
 * Plan 15-06 Task 3. Exposes the freshest runner's `active_task_ids` as a
 * thin wrapper around `runner_heartbeats.metadata_json`. Plan 15-02's
 * `requeueStaleTasks` already reads the same column directly; this endpoint
 * is for operators, Phase 16 UI, and integration tests (Plan 15-07) that
 * need an HTTP surface rather than a DB query.
 *
 * Auth: runner-SECRET principal ONLY (user.id === -1000).
 *   - Runner-TOKEN principals (id = -2000) are task-scoped and must not reach
 *     this endpoint; the 403 branch catches any that slip past the allowlist.
 *   - Session cookies / API keys fail the same id-guard.
 *
 * Stale window: 90s — matches `task-dispatch.ts` reconcileRunnerHeartbeat
 * (LOCKED per 15-CONTEXT.md § Heartbeat & Stale Detection: 3× 30s tick).
 * Heartbeats older than the window are considered stale and excluded.
 *
 * Response (200):
 *   { runner_id: string|null, last_heartbeat_at: number|null,
 *     active_task_ids: number[], stale: boolean }
 *
 * When no fresh heartbeat exists: runner_id=null, active_task_ids=[], stale=true.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

const STALE_WINDOW_SECS = 90

export async function GET(request: NextRequest): Promise<NextResponse> {
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
    const nowUnix = Math.floor(Date.now() / 1000)

    const row = db
      .prepare(
        `SELECT runner_id, last_heartbeat_at, metadata_json
         FROM runner_heartbeats
         WHERE last_heartbeat_at >= ?
         ORDER BY last_heartbeat_at DESC
         LIMIT 1`,
      )
      .get(nowUnix - STALE_WINDOW_SECS) as
      | { runner_id: string; last_heartbeat_at: number; metadata_json: string | null }
      | undefined

    if (!row) {
      return NextResponse.json(
        {
          runner_id: null,
          last_heartbeat_at: null,
          active_task_ids: [],
          stale: true,
        },
        { status: 200 },
      )
    }

    let activeTaskIds: number[] = []
    try {
      const parsed = JSON.parse(row.metadata_json ?? '{}') as {
        active_task_ids?: unknown
      }
      if (Array.isArray(parsed?.active_task_ids)) {
        activeTaskIds = parsed.active_task_ids.filter(
          (n: unknown): n is number =>
            typeof n === 'number' && Number.isFinite(n) && n > 0,
        )
      }
    } catch {
      // Non-fatal JSON parse error: surface an empty array rather than a 500.
      // Heartbeat writes are schema-validated, so reaching this branch would
      // indicate corruption — still better to report a live-but-empty runner
      // than to 500 and hide the stale-detection signal.
    }

    return NextResponse.json(
      {
        runner_id: row.runner_id,
        last_heartbeat_at: row.last_heartbeat_at,
        active_task_ids: activeTaskIds,
        stale: false,
      },
      { status: 200 },
    )
  } catch (error) {
    logger.error({ err: error }, 'GET /api/runner/inventory error')
    return NextResponse.json(
      { error: 'Failed to read runner inventory' },
      { status: 500 },
    )
  }
}
