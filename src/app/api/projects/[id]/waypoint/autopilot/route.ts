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

const Body = z.object({
  max_iterations: z.number().int().positive().max(100).optional(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
      route: '/api/projects/[id]/waypoint/autopilot',
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
        { error: 'Waypoint lifecycle is not enabled for this project' },
        { status: 409 },
      )
    }

    const { searchParams } = new URL(request.url)
    const limitRaw = searchParams.get('limit')
    const offsetRaw = searchParams.get('offset')
    const limit = limitRaw ? Number(limitRaw) : undefined
    const offset = offsetRaw ? Number(offsetRaw) : undefined

    if ((limitRaw && (!Number.isFinite(limit) || limit == null || limit <= 0)) ||
        (offsetRaw && (!Number.isFinite(offset) || offset == null || offset < 0))) {
      return NextResponse.json({ error: 'Invalid pagination parameters' }, { status: 400 })
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
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/waypoint/autopilot error')
    return NextResponse.json({ error: 'Failed to fetch Waypoint Autopilot status' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
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
      route: '/api/projects/[id]/waypoint/autopilot',
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
        { error: 'Waypoint lifecycle is not enabled for this project' },
        { status: 409 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = Body.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
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
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/waypoint/autopilot error')
    return NextResponse.json({ error: 'Failed to run Waypoint Autopilot' }, { status: 500 })
  }
}
