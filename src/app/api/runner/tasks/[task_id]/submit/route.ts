/**
 * POST /api/runner/tasks/:task_id/submit — runner-token scoped status-flip.
 *
 * Plan 14-11 + Phase 17 D-01 scope expansion. The agent container inside the
 * docker run posts here with its per-task runner-token bearer when it finishes
 * its work. Body specifies the agent's declaration of intent — currently only
 * 'done' is supported. The route translates the agent's 'done' declaration into
 * a status flip of `in_progress → review`; runAegisReviews() scheduler task
 * drives the final hop to done/failed/revision per existing
 * src/lib/task-dispatch.ts:414 pipeline.
 *
 * Handler wraps the status flip and the atomic revokeTokensForTask in a single
 * db.transaction so a crash rolls both back (matches the PUT /api/tasks/:id
 * precedent from Plan 11-04). After the transaction commits, the route
 * broadcasts `task.status_changed` with previous_status='in_progress' and
 * status='review' so SSE subscribers (UI, runner daemon, integration tests)
 * see the transition.
 *
 * Scope: RUNNER_TOKEN_ALLOWLIST entry already exists (Phase 11-04 lock, see
 * src/lib/runner-tokens.ts line 12). This plan does NOT add it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { revokeTokensForTask } from '@/lib/runner-tokens'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

const Body = z.object({
  status: z.literal('done'),
  resolution: z.string().max(10_000).optional(),
  comment: z.string().max(10_000).optional(),
})

// Re-submits after the review-flip (and already-terminal states) return 409
// idempotently. 'review' is included so a runner retry after the first submit
// committed doesn't double-broadcast or re-revoke.
const ALREADY_SETTLED = new Set(['review', 'done', 'failed', 'cancelled'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ task_id: string }> },
): Promise<NextResponse> {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  // Runner-token principal only — id === -2000. Reject runner-secret (-1000),
  // session cookies, API keys, agent keys, etc.
  if (auth.user.id !== -2000) {
    return NextResponse.json({ error: 'runner-token principal required' }, { status: 403 })
  }

  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.task_id, 10)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }

  // Defense-in-depth: the auth layer (src/lib/auth.ts getUserFromRequest) only
  // issues a runner-token principal when the path task_id matches the token's
  // embedded task_id. But we verify again here — a breakage upstream should
  // never silently permit a cross-task write.
  if (auth.user.runner_token_task_id !== taskId) {
    return NextResponse.json({ error: 'cross-task access forbidden' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: z.infer<typeof Body>
  try {
    const json = await request.json()
    const parsed = Body.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', issues: parsed.error.issues }, { status: 400 })
    }
    body = parsed.data
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const task = db
      .prepare('SELECT id, title, status, workspace_id FROM tasks WHERE id = ?')
      .get(taskId) as { id: number; title: string; status: string; workspace_id: number } | undefined

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (ALREADY_SETTLED.has(task.status)) {
      return NextResponse.json({ error: 'task already terminal' }, { status: 409 })
    }

    const nowUnix = Math.floor(Date.now() / 1000)
    const reviewComment = (body.comment ?? body.resolution ?? '').trim()
    let changed = 0

    // Atomic: flip status to review + clear container_id + revoke live
    // runner-tokens. Guarded on status NOT IN ('review','done','failed',
    // 'cancelled') so a race against PUT /api/tasks/:id or a re-submit from a
    // stale runner-token doesn't double-transition. revokeTokensForTask is
    // idempotent, so a re-run after partial success would be safe even if the
    // transaction boundary were removed — but we keep the transaction for
    // crash-consistency.
    //
    // completed_at is intentionally NOT set here: 'review' is not a terminal
    // status. The Aegis-driven final 'done' hop in runAegisReviews()
    // (src/lib/task-dispatch.ts:414) is the canonical terminal transition and
    // owns the completed_at timestamp if/when a dedicated column is added.
    db.transaction(() => {
      const update = db.prepare(`
        UPDATE tasks
        SET status = 'review',
            container_id = NULL,
            updated_at = ?
        WHERE id = ? AND status NOT IN ('review','done','failed','cancelled')
      `).run(nowUnix, taskId)
      changed = update.changes

      // Resolution is advisory in Phase 14: write to task_runner_attempts
      // best-effort for the most-recent attempt that has no resolution yet.
      // Column may not exist on the attempts row yet (migration 061 does not
      // include resolution_notes — see 14-01 SUMMARY) so we guard with a
      // schema probe. If the column is absent, skip silently; resolution is
      // not load-bearing for Phase 14.
      if (body.resolution && body.resolution.length > 0) {
        try {
          const hasResolutionCol = (
            db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('task_runner_attempts') WHERE name = 'resolution_notes'`).get() as { n: number }
          ).n > 0
          if (hasResolutionCol) {
            db.prepare(`
              UPDATE task_runner_attempts
              SET resolution_notes = ?
              WHERE task_id = ? AND resolution_notes IS NULL
              ORDER BY attempt DESC
              LIMIT 1
            `).run(body.resolution, taskId)
          }
        } catch {
          // Non-fatal: resolution is advisory.
        }
      }

      if (changed > 0 && reviewComment.length > 0) {
        db.prepare(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, 'recipe-runner', ?, ?, ?)
        `).run(taskId, reviewComment, nowUnix, task.workspace_id)
      }

      revokeTokensForTask(db, taskId, nowUnix)
    })()

    // Broadcast AFTER the transaction commits so SSE subscribers never see a
    // transition that later got rolled back. The runner normally submits from
    // in_progress; using the actual observed pre-transaction status keeps the
    // event honest if a valid runner-token races with another non-terminal
    // transition.
    eventBus.broadcast('task.status_changed', {
      task_id: taskId,
      status: 'review',
      previous_status: task.status,
      workspace_id: task.workspace_id,
      at: nowUnix,
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    logger.error({ err: error, taskId }, 'POST /api/runner/tasks/:task_id/submit error')
    return NextResponse.json({ error: 'Failed to submit task' }, { status: 500 })
  }
}
