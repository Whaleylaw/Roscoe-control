import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { listWaypointRouteEvents } from '@/lib/waypoint-command'

function parseNonNegativeInt(value: string | null, fallback: number): number {
  if (!value) return fallback
  if (!/^\d+$/.test(value)) return fallback
  return Number(value)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; routeId: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/waypoint/routes/[routeId]/events',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id, routeId } = await params
    const projectId = parseStrictId(id)
    const parsedRouteId = parseStrictId(routeId)
    if (projectId == null || parsedRouteId == null) {
      return NextResponse.json({ error: 'Invalid project or route ID' }, { status: 400 })
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
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
      return NextResponse.json({ error: 'Waypoint lifecycle is not enabled for this project' }, { status: 409 })
    }

    const limit = Math.min(Math.max(parseNonNegativeInt(request.nextUrl.searchParams.get('limit'), 50), 1), 500)
    const offset = Math.max(parseNonNegativeInt(request.nextUrl.searchParams.get('offset'), 0), 0)

    const events = listWaypointRouteEvents(db, {
      workspaceId,
      projectId,
      routeId: parsedRouteId,
      limit,
      offset,
    })

    return NextResponse.json({
      ok: true,
      action: 'list_route_events',
      route_id: parsedRouteId,
      events,
      count: events.length,
      pagination: { limit, offset },
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/waypoint/routes/[routeId]/events error')
    return NextResponse.json({ error: 'Failed to fetch Waypoint route events' }, { status: 500 })
  }
}
