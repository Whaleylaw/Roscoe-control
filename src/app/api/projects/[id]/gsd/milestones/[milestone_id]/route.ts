import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, updateGsdMilestoneSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import {
  getScopedMilestone,
  getScopedProject,
  getScopedWorkstream,
  optimisticLockMatches,
  parseStrictId,
} from '@/lib/gsd-hierarchy'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; milestone_id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

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
      route: '/api/projects/[id]/gsd/milestones/[milestone_id]',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id, milestone_id } = await params
    const projectId = parseStrictId(id)
    const milestoneId = parseStrictId(milestone_id)
    if (projectId == null || milestoneId == null) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }
    if (!getScopedProject(db, projectId, workspaceId)) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const validated = await validateBody(request, updateGsdMilestoneSchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    const current = getScopedMilestone(db, projectId, milestoneId)
    if (!current) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }
    if (!optimisticLockMatches(current.updated_at as number | null | undefined, body.expected_updated_at)) {
      return NextResponse.json(
        { error: 'Milestone has changed since last read', code: 'OPTIMISTIC_LOCK_FAILED' },
        { status: 409 },
      )
    }

    if (body.workstream_id != null && !getScopedWorkstream(db, projectId, body.workstream_id)) {
      return NextResponse.json({ error: 'Workstream not found', code: 'WORKSTREAM_NOT_FOUND' }, { status: 404 })
    }

    const updates: string[] = []
    const values: Array<string | number | null> = []
    if (body.workstream_id !== undefined) {
      updates.push('workstream_id = ?')
      values.push(body.workstream_id ?? null)
    }
    if (body.version_label !== undefined) {
      updates.push('version_label = ?')
      values.push(body.version_label.trim())
    }
    if (body.title !== undefined) {
      updates.push('title = ?')
      values.push(body.title.trim())
    }
    if (body.status !== undefined) {
      updates.push('status = ?')
      values.push(body.status)
    }
    if (body.started_at !== undefined) {
      updates.push('started_at = ?')
      values.push(body.started_at ?? null)
    }
    if (body.completed_at !== undefined) {
      updates.push('completed_at = ?')
      values.push(body.completed_at ?? null)
    }

    updates.push('updated_at = unixepoch()')

    db.prepare(
      `UPDATE gsd_milestones SET ${updates.join(', ')} WHERE id = ? AND project_id = ?`,
    ).run(...values, milestoneId, projectId)

    const milestone = getScopedMilestone(db, projectId, milestoneId)
    eventBus.broadcast('gsd.milestone.updated', {
      project_id: projectId,
      milestone_id: milestoneId,
      actor: auth.user.username,
      workspace_id: workspaceId,
    })
    return NextResponse.json({ milestone })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'PATCH /api/projects/[id]/gsd/milestones/[milestone_id] error')
    return NextResponse.json({ error: 'Failed to update milestone' }, { status: 500 })
  }
}
