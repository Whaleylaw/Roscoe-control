/**
 * POST /api/runner/tasks/:task_id/submit — runner-token scoped terminal-flip.
 *
 * Plan 14-11. The agent container inside the docker run posts here with its
 * per-task runner-token bearer when it finishes its work. Body specifies the
 * requested terminal status — Phase 14 only supports 'done' (the container
 * failed-path goes through runner-exit, which the daemon drives, not the
 * agent). Handler wraps the status flip and the atomic revokeTokensForTask
 * in a single db.transaction so a crash rolls both back (matches the
 * PUT /api/tasks/:id precedent from Plan 11-04).
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
import { logger } from '@/lib/logger'

const Body = z.object({
  status: z.literal('done'),
  resolution: z.string().max(10_000).optional(),
})

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled'])

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
      .prepare('SELECT id, status FROM tasks WHERE id = ?')
      .get(taskId) as { id: number; status: string } | undefined

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (TERMINAL_STATUSES.has(task.status)) {
      return NextResponse.json({ error: 'task already terminal' }, { status: 409 })
    }

    const nowUnix = Math.floor(Date.now() / 1000)

    // Atomic: flip status to done + clear container_id + revoke live runner-tokens.
    // Guarded on status NOT IN terminal set so a race against PUT /api/tasks/:id
    // doesn't double-transition. revokeTokensForTask is idempotent, so a re-run
    // after partial success would be safe even if the transaction boundary were
    // removed — but we keep the transaction for crash-consistency.
    db.transaction(() => {
      db.prepare(`
        UPDATE tasks
        SET status = 'done',
            container_id = NULL,
            completed_at = ?,
            updated_at = ?
        WHERE id = ? AND status NOT IN ('done','failed','cancelled')
      `).run(nowUnix, nowUnix, taskId)

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

      revokeTokensForTask(db, taskId, nowUnix)
    })()

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    logger.error({ err: error, taskId }, 'POST /api/runner/tasks/:task_id/submit error')
    return NextResponse.json({ error: 'Failed to submit task' }, { status: 500 })
  }
}
