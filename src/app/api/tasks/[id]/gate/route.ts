import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, taskGatePatchSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'

/**
 * PATCH /api/tasks/:id/gate
 *
 * Approves or rejects a task gate. Operator/admin only (D-09). Records
 * gate_approved_by + gate_approved_at atomically with the status flip
 * (GSD-05). Broadcasts BOTH 'task.gate.changed' and 'task.updated'
 * (Pitfall 6) so existing task-board SSE listeners refresh without
 * client-side changes (GSD-28, D-34).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator') // D-09, GSD-12
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor =
      (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/tasks/[id]/gate',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const taskId = Number.parseInt(id, 10)
    if (!Number.isFinite(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const validated = await validateBody(request, taskGatePatchSchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    const task = db
      .prepare(`SELECT * FROM tasks WHERE id = ? AND workspace_id = ?`)
      .get(taskId, workspaceId) as { gate_required?: number } | undefined

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found', code: 'TASK_NOT_FOUND' },
        { status: 404 }
      )
    }
    if (!task.gate_required) {
      return NextResponse.json(
        { error: 'This task has no gate to approve', code: 'NO_GATE' },
        { status: 400 }
      )
    }

    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      `UPDATE tasks
       SET gate_status = ?, gate_approved_by = ?, gate_approved_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    ).run(body.gate_status, auth.user.username, now, now, taskId, workspaceId)

    db_helpers.logActivity(
      'task_gate_changed',
      'task',
      taskId,
      auth.user.username,
      `Gate ${body.gate_status}${body.note ? `: ${body.note}` : ''}`,
      { gate_status: body.gate_status, note: body.note || null },
      workspaceId
    )

    const updated = db
      .prepare(`SELECT * FROM tasks WHERE id = ? AND workspace_id = ?`)
      .get(taskId, workspaceId) as Record<string, unknown> | undefined

    // Pitfall 6: broadcast BOTH events — the semantic one (GSD-28, D-34)
    // and 'task.updated' so existing task-board SSE listeners refresh
    // without any client code changes.
    eventBus.broadcast('task.gate.changed', {
      task_id: taskId,
      gate_status: body.gate_status,
      actor: auth.user.username,
      note: body.note || null,
      workspace_id: workspaceId,
    })
    eventBus.broadcast('task.updated', { ...(updated ?? {}), workspace_id: workspaceId })

    return NextResponse.json({ task: updated })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'PATCH /api/tasks/[id]/gate error')
    return NextResponse.json({ error: 'Gate update failed' }, { status: 500 })
  }
}
