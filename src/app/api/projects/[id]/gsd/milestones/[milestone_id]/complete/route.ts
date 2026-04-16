import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { gsdOptimisticLockSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import {
  getScopedMilestone,
  getScopedProject,
  optimisticLockMatches,
  parseStrictId,
} from '@/lib/gsd-hierarchy'

export async function POST(
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
      route: '/api/projects/[id]/gsd/milestones/[milestone_id]/complete',
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

    const rawBody = await request.json().catch(() => ({}))
    const parsed = gsdOptimisticLockSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) },
        { status: 400 },
      )
    }

    const current = getScopedMilestone(db, projectId, milestoneId)
    if (!current) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }
    if (!optimisticLockMatches(current.updated_at as number | null | undefined, parsed.data.expected_updated_at)) {
      return NextResponse.json(
        { error: 'Milestone has changed since last read', code: 'OPTIMISTIC_LOCK_FAILED' },
        { status: 409 },
      )
    }

    db.prepare(
      `UPDATE gsd_milestones
       SET status = 'complete',
           completed_at = COALESCE(completed_at, unixepoch()),
           updated_at = unixepoch()
       WHERE id = ? AND project_id = ?`,
    ).run(milestoneId, projectId)

    const milestone = getScopedMilestone(db, projectId, milestoneId)
    eventBus.broadcast('gsd.milestone.completed', {
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
    logger.error({ err: error }, 'POST /api/projects/[id]/gsd/milestones/[milestone_id]/complete error')
    return NextResponse.json({ error: 'Failed to complete milestone' }, { status: 500 })
  }
}
