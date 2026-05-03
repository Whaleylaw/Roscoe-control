import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { executeWaypointCommand, parseWaypointCommand } from '@/lib/waypoint-command'

const Body = z.object({
  command: z.string().min(1),
})

export async function POST(
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
      route: '/api/projects/[id]/waypoint/command',
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

    const body = await request.json().catch(() => ({}))
    const parsed = Body.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
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

    const actor = auth.user.display_name || auth.user.username || 'operator'
    const result = executeWaypointCommand({
      db,
      workspaceId,
      tenantId,
      projectId,
      actor,
      rawCommand: parsed.data.command,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, action: 'error', error: error.message }, { status: error.status })
    }
    if (error instanceof Error) {
      const body = await request.json().catch(() => null)
      const rawCommand = typeof body?.command === 'string' ? body.command : null
      const parsedCommand = rawCommand
        ? (() => {
            try {
              return parseWaypointCommand(rawCommand)
            } catch {
              return null
            }
          })()
        : null

      return NextResponse.json(
        {
          ok: false,
          action: 'error',
          command: parsedCommand,
          error: error.message,
        },
        { status: 400 },
      )
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/waypoint/command error')
    return NextResponse.json({ ok: false, action: 'error', error: 'Failed to execute Waypoint command' }, { status: 500 })
  }
}
