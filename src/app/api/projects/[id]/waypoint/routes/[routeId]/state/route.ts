import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { setWaypointRoutePausedState } from '@/lib/waypoint-command'
import { normalizeWaypointRateLimitError } from '@/lib/waypoint-api'

const Body = z.object({
  action: z.enum(['pause', 'resume']),
})

function routeStateError(status: number, error: string, details?: unknown) {
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; routeId: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return routeStateError(auth.status ?? 403, auth.error ?? 'Forbidden')
  }
  const rateCheck = normalizeWaypointRateLimitError(mutationLimiter(request))
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
      return routeStateError(400, 'Invalid project or route ID')
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return routeStateError(404, 'Project not found')
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
      return routeStateError(409, 'Waypoint lifecycle is not enabled for this project')
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return routeStateError(400, 'Invalid JSON body')
    }
    const parsed = Body.safeParse(body)
    if (!parsed.success) {
      return routeStateError(400, 'Invalid request body', parsed.error.issues)
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
      return routeStateError(error.status, error.message)
    }
    if (error instanceof Error) {
      return routeStateError(400, error.message)
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/waypoint/routes/[routeId]/state error')
    return routeStateError(500, 'Failed to update Waypoint route state')
  }
}
