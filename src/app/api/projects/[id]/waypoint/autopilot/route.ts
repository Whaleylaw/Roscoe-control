import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { runWaypointAutopilot } from '@/lib/waypoint-autopilot'
import { listWaypointAutopilotRuns } from '@/lib/waypoint-command'
import { normalizeWaypointRateLimitError, normalizeWaypointValidationDetails } from '@/lib/waypoint-api'

const Body = z.object({
  max_iterations: z.number().int().positive().max(100).optional(),
})

function autopilotError(status: number, error: string, details?: unknown) {
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
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return autopilotError(auth.status ?? 403, auth.error ?? 'Forbidden')

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/waypoint/autopilot',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseStrictId(id)
    if (projectId == null) {
      return autopilotError(400, 'Invalid project ID')
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return autopilotError(404, 'Project not found')
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
      return autopilotError(409, 'Waypoint lifecycle is not enabled for this project')
    }

    const { searchParams } = new URL(request.url)
    const limitRaw = searchParams.get('limit')
    const offsetRaw = searchParams.get('offset')
    const limit = limitRaw ? Number(limitRaw) : undefined
    const offset = offsetRaw ? Number(offsetRaw) : undefined

    if ((limitRaw && (!Number.isFinite(limit) || limit == null || limit <= 0)) ||
        (offsetRaw && (!Number.isFinite(offset) || offset == null || offset < 0))) {
      return autopilotError(400, 'Invalid pagination parameters')
    }

    const runs = listWaypointAutopilotRuns(db, {
      workspaceId,
      projectId,
      limit,
      offset,
    })

    return NextResponse.json({
      ok: true,
      action: 'autopilot_status',
      runs,
      count: runs.length,
      pagination: {
        limit: Math.min(Math.max(limit ?? 20, 1), 200),
        offset: Math.max(offset ?? 0, 0),
      },
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return autopilotError(error.status, error.message)
    }
    if (error instanceof Error) {
      return autopilotError(400, error.message)
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/waypoint/autopilot error')
    return autopilotError(500, 'Failed to fetch Waypoint Autopilot status')
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return autopilotError(auth.status ?? 403, auth.error ?? 'Forbidden')
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
      route: '/api/projects/[id]/waypoint/autopilot',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseStrictId(id)
    if (projectId == null) {
      return autopilotError(400, 'Invalid project ID')
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return autopilotError(404, 'Project not found')
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
      return autopilotError(409, 'Waypoint lifecycle is not enabled for this project')
    }

    const body = await request.json().catch(() => null)
    if (body == null) {
      return autopilotError(400, 'Invalid JSON body')
    }
    const parsed = Body.safeParse(body)
    if (!parsed.success) {
      return autopilotError(400, 'Invalid request body', normalizeWaypointValidationDetails(parsed.error.issues))
    }

    const actor = auth.user.display_name || auth.user.username || 'operator'
    const result = runWaypointAutopilot(db, {
      projectId,
      workspaceId,
      actor,
      maxIterations: parsed.data.max_iterations,
    })

    return NextResponse.json({
      ok: true,
      action: 'autopilot',
      result,
      message: `Waypoint Autopilot stopped: ${result.stopReason}`,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return autopilotError(error.status, error.message)
    }
    if (error instanceof Error) {
      return autopilotError(400, error.message)
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/waypoint/autopilot error')
    return autopilotError(500, 'Failed to run Waypoint Autopilot')
  }
}
