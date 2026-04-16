import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, updateGsdWorkstreamSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import {
  getScopedProject,
  getScopedWorkstream,
  optimisticLockMatches,
  parseStrictId,
} from '@/lib/gsd-hierarchy'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ws_id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor =
      (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/gsd/workstreams/[ws_id]',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id, ws_id } = await params
    const projectId = parseStrictId(id)
    const workstreamId = parseStrictId(ws_id)
    if (projectId == null || workstreamId == null) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }
    if (!getScopedProject(db, projectId, workspaceId)) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const validated = await validateBody(request, updateGsdWorkstreamSchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    const current = getScopedWorkstream(db, projectId, workstreamId)
    if (!current) {
      return NextResponse.json({ error: 'Workstream not found' }, { status: 404 })
    }
    if (!optimisticLockMatches(current.updated_at as number | null | undefined, body.expected_updated_at)) {
      return NextResponse.json(
        { error: 'Workstream has changed since last read', code: 'OPTIMISTIC_LOCK_FAILED' },
        { status: 409 },
      )
    }

    const updates: string[] = []
    const values: Array<string> = []
    if (body.key !== undefined) {
      updates.push('key = ?')
      values.push(body.key.trim())
    }
    if (body.name !== undefined) {
      updates.push('name = ?')
      values.push(body.name.trim())
    }
    if (body.status !== undefined) {
      updates.push('status = ?')
      values.push(body.status)
    }

    updates.push('updated_at = unixepoch()')

    db.prepare(
      `UPDATE gsd_workstreams SET ${updates.join(', ')} WHERE id = ? AND project_id = ?`,
    ).run(...values, workstreamId, projectId)

    const workstream = getScopedWorkstream(db, projectId, workstreamId)
    eventBus.broadcast('gsd.workstream.updated', {
      project_id: projectId,
      workstream_id: workstreamId,
      actor: auth.user.username,
      workspace_id: workspaceId,
    })
    return NextResponse.json({ workstream })
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      return NextResponse.json({ error: 'Workstream key already exists', code: 'DUPLICATE_KEY' }, { status: 409 })
    }
    logger.error({ err: error }, 'PATCH /api/projects/[id]/gsd/workstreams/[ws_id] error')
    return NextResponse.json({ error: 'Failed to update workstream' }, { status: 500 })
  }
}
