import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { listWaypointRoutes, resolveWaypointPlanRouteScope } from '@/lib/waypoint-command'
import { startOrReuseWaypointRoute, WAYPOINT_SUBJECT_TYPES } from '@/lib/waypoint'

const Body = z.object({
  subject: z.literal('plan'),
  plan_id: z.number().int().positive(),
  definition_slug: z.string().min(1).default('waypoint-plan-execution'),
  definition_version: z.number().int().positive().default(1),
})

const Query = z.object({
  status: z.enum(['active', 'blocked', 'complete', 'cancelled', 'failed']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

function routesError(status: number, error: string, details?: unknown) {
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
  if ('error' in auth) return routesError(auth.status ?? 403, auth.error ?? 'Forbidden')

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/waypoint/routes',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseStrictId(id)
    if (projectId == null) {
      return routesError(400, 'Invalid project ID')
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return routesError(404, 'Project not found')
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
      return routesError(409, 'Waypoint lifecycle is not enabled for this project')
    }

    const parsed = Query.safeParse({
      status: request.nextUrl.searchParams.get('status') ?? undefined,
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
      offset: request.nextUrl.searchParams.get('offset') ?? undefined,
    })
    if (!parsed.success) {
      return routesError(400, 'Invalid query params', parsed.error.issues)
    }

    const routes = listWaypointRoutes(db, {
      workspaceId,
      projectId,
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    })

    return NextResponse.json({
      ok: true,
      action: 'list_routes',
      routes,
      count: routes.length,
      filters: {
        status: parsed.data.status ?? null,
      },
      pagination: {
        limit: parsed.data.limit ?? 50,
        offset: parsed.data.offset ?? 0,
      },
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return routesError(error.status, error.message)
    }
    if (error instanceof Error) {
      return routesError(400, error.message)
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/waypoint/routes error')
    return routesError(500, 'Failed to list Waypoint routes')
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return routesError(auth.status ?? 403, auth.error ?? 'Forbidden')
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
      route: '/api/projects/[id]/waypoint/routes',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseStrictId(id)
    if (projectId == null) {
      return routesError(400, 'Invalid project ID')
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return routesError(404, 'Project not found')
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
      return routesError(409, 'Waypoint lifecycle is not enabled for this project')
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return routesError(400, 'Invalid JSON body')
    }

    const parsed = Body.safeParse(body)
    if (!parsed.success) {
      return routesError(400, 'Invalid request body', parsed.error.issues)
    }

    const scope = resolveWaypointPlanRouteScope(db, {
      workspaceId,
      projectId,
      planId: parsed.data.plan_id,
    })

    const actor = auth.user.display_name || auth.user.username || 'operator'
    const route = startOrReuseWaypointRoute(db, {
      workspaceId,
      tenantId,
      actor,
      projectId,
      subjectType: WAYPOINT_SUBJECT_TYPES.plan,
      subjectId: parsed.data.plan_id,
      definitionSlug: parsed.data.definition_slug,
      definitionVersion: parsed.data.definition_version,
      vars: {
        project_id: scope.projectId,
        workstream_id: scope.workstreamId,
        milestone_id: scope.milestoneId,
        phase_id: scope.phaseId,
        plan_id: scope.planId,
        workspace_id: workspaceId,
      },
    })

    return NextResponse.json({
      ok: true,
      action: 'start_route',
      subject: 'plan',
      plan_id: parsed.data.plan_id,
      definition_slug: parsed.data.definition_slug,
      definition_version: parsed.data.definition_version,
      workflow_instance_id: route.instanceId,
      reused: route.reused,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return routesError(error.status, error.message)
    }
    if (error instanceof Error) {
      return routesError(400, error.message)
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/waypoint/routes error')
    return routesError(500, 'Failed to start Waypoint route')
  }
}
