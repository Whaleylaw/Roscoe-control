import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { executeWaypointCommand, parseWaypointCommand } from '@/lib/waypoint-command'

const Body = z.object({
  command: z.string().trim().min(1),
})

function commandError(
  status: number,
  error: string,
  details?: unknown,
) {
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
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return commandError(auth.status ?? 403, auth.error ?? 'Forbidden')

  let rawCommand: string | null = null

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
      return commandError(400, 'Invalid project ID')
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return commandError(404, 'Project not found')
    }

    const body = await request.json().catch(() => ({}))
    const parsed = Body.safeParse(body)
    if (parsed.success) {
      rawCommand = parsed.data.command
    }
    if (!parsed.success) {
      return commandError(400, 'Invalid request body', parsed.error.issues)
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
      return commandError(409, 'Waypoint lifecycle is not enabled for this project')
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
      return commandError(error.status, error.message)
    }
    if (error instanceof Error) {
      const parsedCommand = rawCommand
        ? (() => {
            try {
              return parseWaypointCommand(rawCommand)
            } catch {
              return null
            }
          })()
        : null

      return commandError(
        400,
        error.message,
        parsedCommand ? { command: parsedCommand } : undefined,
      )
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/waypoint/command error')
    return commandError(500, 'Failed to execute Waypoint command')
  }
}
