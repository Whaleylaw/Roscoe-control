import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, createGsdWorkstreamSchema } from '@/lib/validation'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { eventBus } from '@/lib/event-bus'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor =
      (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/gsd/workstreams',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseStrictId(id)
    if (projectId == null) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    }
    if (!getScopedProject(db, projectId, workspaceId)) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const workstreams = db
      .prepare(
        `SELECT * FROM gsd_workstreams WHERE project_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(projectId)

    return NextResponse.json({ workstreams })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/gsd/workstreams error')
    return NextResponse.json({ error: 'Failed to fetch workstreams' }, { status: 500 })
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

  let projectId = 0
  let normalizedKey = ''
  let normalizedName = ''
  let normalizedStatus = 'active'

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor =
      (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/gsd/workstreams',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const parsedProjectId = parseStrictId(id)
    if (parsedProjectId == null) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    }
    projectId = parsedProjectId
    if (!getScopedProject(db, projectId, workspaceId)) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const validated = await validateBody(request, createGsdWorkstreamSchema)
    if ('error' in validated) return validated.error
    const body = validated.data
    normalizedKey = body.key.trim()
    normalizedName = body.name.trim()
    normalizedStatus = body.status

    const existing = db
      .prepare(`SELECT * FROM gsd_workstreams WHERE project_id = ? AND key = ?`)
      .get(projectId, normalizedKey) as Record<string, unknown> | undefined
    if (existing) {
      const isReplay =
        String(existing.name ?? '') === normalizedName &&
        String(existing.status ?? '') === normalizedStatus

      if (isReplay) {
        return NextResponse.json({ workstream: existing, idempotent_replay: true })
      }

      return NextResponse.json({ error: 'Workstream key already exists', code: 'DUPLICATE_KEY' }, { status: 409 })
    }

    const result = db
      .prepare(
        `INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`,
      )
      .run(projectId, normalizedKey, normalizedName, normalizedStatus)

    const workstream = db
      .prepare(`SELECT * FROM gsd_workstreams WHERE id = ?`)
      .get(Number(result.lastInsertRowid))

    eventBus.broadcast('gsd.workstream.created', {
      project_id: projectId,
      workstream_id: Number(result.lastInsertRowid),
      actor: auth.user.username,
      workspace_id: workspaceId,
    })

    return NextResponse.json({ workstream }, { status: 201 })
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      const db = getDatabase()
      const existing = db
        .prepare(`SELECT * FROM gsd_workstreams WHERE project_id = ? AND key = ?`)
        .get(projectId, normalizedKey) as Record<string, unknown> | undefined
      if (
        existing &&
        String(existing.name ?? '') === normalizedName &&
        String(existing.status ?? '') === normalizedStatus
      ) {
        return NextResponse.json({ workstream: existing, idempotent_replay: true })
      }
      return NextResponse.json({ error: 'Workstream key already exists', code: 'DUPLICATE_KEY' }, { status: 409 })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/gsd/workstreams error')
    return NextResponse.json({ error: 'Failed to create workstream' }, { status: 500 })
  }
}
