import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * GET /api/runner/terminal-tasks?since=<iso8601> — tasks transitioned to
 * terminal status since the caller's last-scan timestamp.
 *
 * Auth: runner-secret principal only (user.id === -1000). 403 otherwise.
 *
 * Used by the runner's 10-minute GC tick (Phase 14 CONTEXT.md, GC driver):
 * the runner tracks its own last-scan timestamp and polls this endpoint for
 * newly-terminal tasks so it can destroy / retain worktrees + logs per the
 * retention policy.
 *
 * `since` is REQUIRED and MUST parse as an ISO-8601 string (Date.parse).
 * We reject 400 on missing / malformed input defensively — the runner's
 * timestamp is locally tracked, so a malformed value likely indicates a
 * client bug that silently dropping would mask.
 *
 * Query shape:
 *   - status IN ('done', 'failed', 'cancelled')
 *   - updated_at >= <unix-seconds(since)>
 *   ORDER BY updated_at ASC LIMIT 200
 *
 * Response shape (aligns with CONTEXT.md — "{task_id, status, terminal_at}"):
 *   { tasks: Array<{ task_id: number; status: string; terminal_at: number }> }
 *
 * `terminal_at` is `tasks.updated_at` (unix seconds) — Phase 14 treats the
 * last status update as the terminal-transition marker. A dedicated column
 * is out of scope; no runner requirement distinguishes between "updated
 * while terminal" and "transitioned to terminal", and the query only ever
 * sees rows already in a terminal state.
 */

type TerminalRow = {
  id: number
  status: string
  updated_at: number
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

  const url = new URL(request.url)
  const since = url.searchParams.get('since')
  if (!since) {
    return NextResponse.json(
      { error: 'Query param `since` (ISO 8601) is required' },
      { status: 400 },
    )
  }
  const sinceMs = Date.parse(since)
  if (!Number.isFinite(sinceMs)) {
    return NextResponse.json(
      { error: '`since` must be a valid ISO 8601 timestamp' },
      { status: 400 },
    )
  }
  const sinceSec = Math.floor(sinceMs / 1000)

  try {
    const db = getDatabase()
    const rows = db
      .prepare(
        `SELECT id, status, updated_at
         FROM tasks
         WHERE status IN ('done', 'failed', 'cancelled')
           AND updated_at >= ?
         ORDER BY updated_at ASC
         LIMIT 200`,
      )
      .all(sinceSec) as TerminalRow[]

    return NextResponse.json({
      tasks: rows.map((r) => ({
        task_id: r.id,
        status: r.status,
        terminal_at: r.updated_at,
      })),
    })
  } catch (err) {
    logger.error({ err }, 'GET /api/runner/terminal-tasks — DB error')
    return NextResponse.json(
      { error: 'Failed to load terminal tasks' },
      { status: 500 },
    )
  }
}
