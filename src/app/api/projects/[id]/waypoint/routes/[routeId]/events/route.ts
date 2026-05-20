import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { listWaypointRouteEvents } from '@/lib/waypoint-command'
import { normalizeWaypointValidationDetails } from '@/lib/waypoint-api'

const Query = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

function routeEventsError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      action: 'error',
      error,
      ...(details !== undefined ? { details } : {}),
    },
    { status },
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; routeId: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return routeEventsError(auth.status ?? 403, auth.error ?? 'Forbidden')

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
      return routeEventsError(400, 'Invalid project or route ID')
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return routeEventsError(404, 'Project not found')
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
      return routeEventsError(409, 'Waypoint lifecycle is not enabled for this project')
    }

    const parsed = Query.safeParse({
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
      offset: request.nextUrl.searchParams.get('offset') ?? undefined,
    })
    if (!parsed.success) {
      return routeEventsError(400, 'Invalid query params', normalizeWaypointValidationDetails(parsed.error.issues))
    }

    const limit = parsed.data.limit ?? 50
    const offset = parsed.data.offset ?? 0

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
      return routeEventsError(error.status, error.message)
    }
    if (error instanceof Error) {
      return routeEventsError(400, error.message)
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/waypoint/routes/[routeId]/events error')
    return routeEventsError(500, 'Failed to fetch Waypoint route events')
  }
}
