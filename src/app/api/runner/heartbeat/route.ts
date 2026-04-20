import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

/**
 * POST /api/runner/heartbeat — runner daemon heartbeat persistence.
 *
 * Auth: runner-secret principal only (user.id === -1000). Session cookies,
 * API keys, and runner-token principals all land here with a 403; the path
 * is daemon-facing and never browser-facing.
 *
 * Rate limit: mutationLimiter (default 60/min per IP). At the daemon's 10s
 * heartbeat rhythm (6/min) this leaves comfortable headroom for bursts during
 * reconnect. If multi-runner deployments push this past the ceiling, Phase 16
 * can introduce a runner-specific limiter — NOT addressed here.
 *
 * Body: { runner_id: string (1..64), ts: number (unix ms), metadata?: object }
 *
 * DB: UPSERT on runner_heartbeats. `last_heartbeat_at` is unixepoch SECONDS
 * (converted from the client-supplied ms `ts` via Math.floor(ts / 1000)).
 * `registered_at` is set on first insert and intentionally preserved across
 * heartbeats — the SET clause omits it, matching migration 060's locked
 * semantic.
 *
 * Phase 15-06 (SCHED-03): `metadata.active_task_ids` is now explicitly typed
 * as `number[]` (optional). `passthrough()` preserves any other metadata
 * keys the daemon may send in the future. requeueStaleTasks (Plan 15-02)
 * reads this field from runner_heartbeats.metadata_json to decide which
 * in_progress recipe-tasks to flip back to `assigned` when the owning runner
 * has NOT reported them as active.
 *
 * Response: 204 No Content on success, 400 on invalid body, 401/403 via auth.
 */

const HeartbeatMetadataSchema = z
  .object({
    active_task_ids: z.array(z.number().int().positive()).optional(),
  })
  .passthrough()

const HeartbeatBodySchema = z.object({
  runner_id: z.string().min(1).max(64),
  ts: z.number().int().nonnegative(),
  metadata: HeartbeatMetadataSchema.optional(),
})

export async function POST(request: NextRequest) {
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

  const limited = mutationLimiter(request)
  if (limited) return limited

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = HeartbeatBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid heartbeat body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { runner_id, ts, metadata } = parsed.data
  // Client sends ms-since-epoch. Column stores unixepoch seconds.
  const last_heartbeat_at = Math.floor(ts / 1000)
  const metadata_json = metadata ? JSON.stringify(metadata) : null

  try {
    const db = getDatabase()
    // ON CONFLICT DO UPDATE intentionally omits registered_at from the SET
    // clause so the first-registration timestamp is preserved across
    // heartbeats — migration 060 locks this semantic.
    db.prepare(
      `INSERT INTO runner_heartbeats (runner_id, last_heartbeat_at, registered_at, metadata_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(runner_id) DO UPDATE SET
         last_heartbeat_at = excluded.last_heartbeat_at,
         metadata_json = excluded.metadata_json`,
    ).run(runner_id, last_heartbeat_at, last_heartbeat_at, metadata_json)
  } catch (err) {
    logger.error({ err, runner_id }, 'POST /api/runner/heartbeat — DB error')
    return NextResponse.json({ error: 'Failed to persist heartbeat' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}
