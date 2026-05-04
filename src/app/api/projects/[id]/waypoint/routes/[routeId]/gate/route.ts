import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { setWaypointGateDecision } from '@/lib/waypoint-command'

const Body = z.object({
  node_key: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().min(1).max(1000).optional(),
})

function routeGateError(status: number, error: string, details?: unknown) {
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
    return routeGateError(auth.status ?? 403, auth.error ?? 'Forbidden')
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
      route: '/api/projects/[id]/waypoint/routes/[routeId]/gate',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id, routeId } = await params
    const projectId = parseStrictId(id)
    const parsedRouteId = parseStrictId(routeId)
    if (projectId == null || parsedRouteId == null) {
      return routeGateError(400, 'Invalid project or route ID')
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return routeGateError(404, 'Project not found')
    }

    const lifecycleState = db
      .prepare(
        `SELECT COALESCE(gsd_enabled, 0) AS gsd_enabled FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1`,
      )
      .get(projectId, workspaceId) as { gsd_enabled: number } | undefined

    if (!lifecycleState?.gsd_enabled) {
      return routeGateError(409, 'Waypoint lifecycle is not enabled for this project')
    }

    const body = await request.json().catch(() => ({}))
    const parsed = Body.safeParse(body)
    if (!parsed.success) {
      return routeGateError(400, 'Invalid request body', parsed.error.issues)
    }

    const actor = auth.user.display_name || auth.user.username || 'operator'
    const result = setWaypointGateDecision(db, {
      workspaceId,
      projectId,
      routeId: parsedRouteId,
      nodeKey: parsed.data.node_key,
      decision: parsed.data.decision,
      note: parsed.data.note,
      actor,
    })

    return NextResponse.json({
      ok: true,
      action: parsed.data.decision === 'approve' ? 'approve_gate' : 'reject_gate',
      route: result.route,
      node: result.node,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return routeGateError(error.status, error.message)
    }
    if (error instanceof Error) {
      return routeGateError(400, error.message)
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/waypoint/routes/[routeId]/gate error')
    return routeGateError(500, 'Failed to apply Waypoint gate decision')
  }
}
