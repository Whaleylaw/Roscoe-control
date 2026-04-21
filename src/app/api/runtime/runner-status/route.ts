/**
 * GET /api/runtime/runner-status — viewer-authenticated runner status summary.
 *
 * Phase 16 Wave-0 / RUI-02. The runner-status banner in task-board-panel.tsx
 * (Wave-1) polls this endpoint every ~10s to render:
 *   - 🟢 "Runner online" when a fresh runner heartbeat exists
 *   - 🔴 "Runner offline — tasks waiting: N" with N being the count of
 *     recipe-tagged tasks queued in the caller's workspace.
 *
 * Auth: viewer tier (session cookie, API key, or proxy auth). Runner-secret
 * and runner-token principals don't need this endpoint — they read from their
 * own scoped routes (`/api/runner/inventory`, `/api/runner/heartbeat`). Keeping
 * this route viewer-scoped preserves the "secrets never flow to browser"
 * invariant while giving the UI the summary it needs.
 *
 * Stale window: 90s — matches task-dispatch.ts + /api/runner/inventory per
 * Plan 15-06 LOCKED decision (3× 30s reconcile tick). Heartbeats older than
 * the window are treated as "runner offline" from the UI's perspective even
 * though the row still exists in `runner_heartbeats`.
 *
 * Workspace scoping: `tasks_waiting` counts only the caller's workspace
 * (auth.user.workspace_id). Multi-workspace installs show per-workspace
 * banners; the heartbeat itself is global (any fresh heartbeat → online).
 *
 * Response (200):
 *   { online: boolean, last_heartbeat_at: number | null, tasks_waiting: number }
 *
 * 500 is treated by the Wave-1 banner as "status unknown" (neither banner
 * state rendered), so we fail loud but the UI stays quiet.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

const STALE_WINDOW_SECS = 90

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const db = getDatabase()
    const nowUnix = Math.floor(Date.now() / 1000)

    const heartbeatRow = db
      .prepare(
        `SELECT last_heartbeat_at
         FROM runner_heartbeats
         WHERE last_heartbeat_at >= ?
         ORDER BY last_heartbeat_at DESC
         LIMIT 1`,
      )
      .get(nowUnix - STALE_WINDOW_SECS) as { last_heartbeat_at: number } | undefined

    // Workspace-scoped waiting count. Recipe-tagged tasks in inbox/assigned are
    // the ones a runner would pick up next; legacy non-recipe tasks are dispatched
    // by a different lane and are NOT what the runner banner is about.
    const waitingRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks
         WHERE workspace_id = ?
           AND recipe_slug IS NOT NULL
           AND status IN ('inbox', 'assigned')`,
      )
      .get(auth.user.workspace_id) as { n: number } | undefined

    return NextResponse.json(
      {
        online: heartbeatRow != null,
        last_heartbeat_at: heartbeatRow?.last_heartbeat_at ?? null,
        tasks_waiting: waitingRow?.n ?? 0,
      },
      { status: 200 },
    )
  } catch (error) {
    logger.error({ err: error }, 'GET /api/runtime/runner-status error')
    return NextResponse.json(
      { error: 'Failed to read runner status' },
      { status: 500 },
    )
  }
}
