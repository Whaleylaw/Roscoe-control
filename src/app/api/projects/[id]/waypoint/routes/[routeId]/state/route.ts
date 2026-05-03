import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { setWaypointRoutePausedState } from '@/lib/waypoint-command'

const Body = z.object({
  action: z.enum(['pause', 'resume']),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; routeId: string }> },
) {
  const action = 'route_state'
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ ok: false, action, error: auth.error }, { status: auth.status })
  }
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/waypoint/routes/[routeId]/state',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id, routeId } = await params
    const projectId = parseStrictId(id)
    const parsedRouteId = parseStrictId(routeId)
    if (projectId == null || parsedRouteId == null) {
      return NextResponse.json({ ok: false, action, error: 'Invalid project or route ID' }, { status: 400 })
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return NextResponse.json({ ok: false, action, error: 'Project not found' }, { status: 404 })
    }

    const lifecycleState = db
      .prepare(
        `
      SELECT COALESCE(gsd_enabled, 0) AS gsd_enabled
      FROM projects
      WHERE id = ? AND workspace_id = ?
      LIMIT 1
    `,
      )
      .get(projectId, workspaceId) as { gsd_enabled: number } | undefined

    if (!lifecycleState?.gsd_enabled) {
      return NextResponse.json(
        { ok: false, action, error: 'Waypoint lifecycle is not enabled for this project' },
        { status: 409 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = Body.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, action, error: 'Invalid request body', details: parsed.error.issues },
        { status: 400 },
      )
    }

    const actor = auth.user.display_name || auth.user.username || 'operator'
    const route = setWaypointRoutePausedState(db, {
      workspaceId,
      projectId,
      routeId: parsedRouteId,
      actor,
      action: parsed.data.action,
    })

    return NextResponse.json({
      ok: true,
      action: parsed.data.action === 'pause' ? 'pause_route' : 'resume_route',
      route,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, action, error: error.message }, { status: error.status })
    }
    if (error instanceof Error) {
      return NextResponse.json({ ok: false, action, error: error.message }, { status: 400 })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/waypoint/routes/[routeId]/state error')
    return NextResponse.json({ ok: false, action, error: 'Failed to update Waypoint route state' }, { status: 500 })
  }
}
