import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { getWaypointStatus } from '@/lib/waypoint'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor =
      (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/waypoint/status',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseStrictId(id)
    if (projectId == null) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    const lifecycleState = db.prepare(`
      SELECT COALESCE(gsd_enabled, 0) AS gsd_enabled
      FROM projects
      WHERE id = ? AND workspace_id = ?
      LIMIT 1
    `).get(projectId, workspaceId) as { gsd_enabled: number } | undefined
    if (!lifecycleState?.gsd_enabled) {
      return NextResponse.json(
        { error: 'Waypoint lifecycle is not enabled for this project' },
        { status: 409 },
      )
    }

    const status = getWaypointStatus(db, { projectId, workspaceId })
    const activeRoutes = status.routes.filter((route) => route.status === 'active').length
    const blockedRoutes = status.routes.filter((route) => route.status === 'blocked').length
    const completeRoutes = status.routes.filter((route) => route.status === 'complete').length
    const cancelledRoutes = status.routes.filter((route) => route.status === 'cancelled').length
    const failedRoutes = status.routes.filter((route) => route.status === 'failed').length

    return NextResponse.json({
      ok: true,
      action: 'status',
      status,
      summary: {
        total_routes: status.routes.length,
        active_routes: activeRoutes,
        blocked_routes: blockedRoutes,
        complete_routes: completeRoutes,
        cancelled_routes: cancelledRoutes,
        failed_routes: failedRoutes,
        pending_gates: status.lifecycle.blocked_gates.length,
        waiting_on_gate_tasks: status.tasks.waiting_on_gate.length,
      },
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, action: 'status', error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/waypoint/status error')
    return NextResponse.json({ ok: false, action: 'status', error: 'Failed to build Waypoint status' }, { status: 500 })
  }
}
