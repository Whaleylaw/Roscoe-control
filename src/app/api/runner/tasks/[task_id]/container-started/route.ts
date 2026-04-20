/**
 * POST /api/runner/tasks/:task_id/container-started — runner-secret scoped.
 *
 * Plan 14-11. The runner daemon calls this right after `docker run` returns
 * a real container_id, to replace the `pending:<task>:<attempt>` placeholder
 * that the claim route (Plan 14-05) wrote. Plan 14-08b's reconciliation step
 * needs to match against real docker container_ids; the placeholder-swap has
 * to happen before the first reconciliation tick or the runner will adopt /
 * kill the wrong rows.
 *
 * Scope: runner-secret (id=-1000) only. The claim route already owns the
 * transition into `in_progress` with a placeholder; this route only swaps
 * the container_id field. Kept atomic to handle the race where a PUT on
 * /api/tasks/:id moves the task to a terminal status between the daemon's
 * `docker run` and this call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const Body = z.object({
  // Docker container ids are 64-char hex; short form is 12. Constrain [12,128]
  // to leave room for runtime format drift without accepting obviously-bad ids.
  container_id: z.string().min(12).max(128).regex(/^[a-f0-9]+$/i),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ task_id: string }> },
): Promise<NextResponse> {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  // Runner-secret only — id === -1000. The per-task runner-token (-2000) is
  // deliberately rejected: the daemon owns container lifecycle events, the
  // agent container never calls this.
  if (auth.user.id !== -1000) {
    return NextResponse.json({ error: 'runner-secret principal required' }, { status: 403 })
  }

  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.task_id, 10)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
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
      .prepare('SELECT id, status, container_id FROM tasks WHERE id = ?')
      .get(taskId) as { id: number; status: string; container_id: string | null } | undefined

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const current = task.container_id

    // Idempotent retry: same id already persisted → 204.
    if (current === body.container_id) {
      return new NextResponse(null, { status: 204 })
    }

    // Already has a real (non-placeholder) container_id that differs → 409.
    if (current !== null && !current.startsWith('pending:')) {
      return NextResponse.json(
        { error: 'task already has a real container_id' },
        { status: 409 },
      )
    }

    const nowUnix = Math.floor(Date.now() / 1000)

    // Guarded swap: only while status is in_progress AND container_id is
    // either NULL or a pending placeholder. Anything else (terminal status,
    // someone else stole the row, task reset to assigned) → 409.
    const res = db.prepare(`
      UPDATE tasks
      SET container_id = ?, updated_at = ?
      WHERE id = ?
        AND status = 'in_progress'
        AND (container_id LIKE 'pending:%' OR container_id IS NULL)
    `).run(body.container_id, nowUnix, taskId)

    if (res.changes === 0) {
      return NextResponse.json(
        { error: 'task not in claimable state' },
        { status: 409 },
      )
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    logger.error({ err: error, taskId }, 'POST /api/runner/tasks/:task_id/container-started error')
    return NextResponse.json({ error: 'Failed to record container start' }, { status: 500 })
  }
}
