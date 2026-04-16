import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { gsdOptimisticLockSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import {
  getScopedProject,
  getScopedWorkstream,
  optimisticLockMatches,
  parseStrictId,
} from '@/lib/gsd-hierarchy'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ws_id: string }> },
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
      route: '/api/projects/[id]/gsd/workstreams/[ws_id]/complete',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id, ws_id } = await params
    const projectId = parseStrictId(id)
    const workstreamId = parseStrictId(ws_id)
    if (projectId == null || workstreamId == null) {
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

    const current = getScopedWorkstream(db, projectId, workstreamId)
    if (!current) {
      return NextResponse.json({ error: 'Workstream not found' }, { status: 404 })
    }
    if (!optimisticLockMatches(current.updated_at as number | null | undefined, parsed.data.expected_updated_at)) {
      return NextResponse.json(
        { error: 'Workstream has changed since last read', code: 'OPTIMISTIC_LOCK_FAILED' },
        { status: 409 },
      )
    }

    db.prepare(
      `UPDATE gsd_workstreams SET status = 'complete', updated_at = unixepoch() WHERE id = ? AND project_id = ?`,
    ).run(workstreamId, projectId)

    const workstream = getScopedWorkstream(db, projectId, workstreamId)
    eventBus.broadcast('gsd.workstream.completed', {
      project_id: projectId,
      workstream_id: workstreamId,
      actor: auth.user.username,
      workspace_id: workspaceId,
    })
    return NextResponse.json({ workstream })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/gsd/workstreams/[ws_id]/complete error')
    return NextResponse.json({ error: 'Failed to complete workstream' }, { status: 500 })
  }
}
