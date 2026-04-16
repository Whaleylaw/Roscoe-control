import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, updateGsdPhaseSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import {
  getPhaseInWorkspace,
  optimisticLockMatches,
  parseStrictId,
  serializeDependencyIds,
} from '@/lib/gsd-hierarchy'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ phase_id: string }> },
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
      route: '/api/gsd/phases/[phase_id]',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { phase_id } = await params
    const phaseId = parseStrictId(phase_id)
    if (phaseId == null) {
      return NextResponse.json({ error: 'Invalid phase ID' }, { status: 400 })
    }

    const validated = await validateBody(request, updateGsdPhaseSchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    const current = getPhaseInWorkspace(db, phaseId, workspaceId)
    if (!current) {
      return NextResponse.json({ error: 'Phase not found' }, { status: 404 })
    }
    if (!optimisticLockMatches(current.updated_at as number | null | undefined, body.expected_updated_at)) {
      return NextResponse.json(
        { error: 'Phase has changed since last read', code: 'OPTIMISTIC_LOCK_FAILED' },
        { status: 409 },
      )
    }

    if (body.depends_on_phase_ids !== undefined) {
      const filtered = body.depends_on_phase_ids.filter((id) => id !== phaseId)
      const rows = filtered.length === 0
        ? []
        : db.prepare(
            `SELECT id FROM gsd_phases WHERE milestone_id = ? AND id IN (${filtered.map(() => '?').join(',')})`,
          ).all(current.milestone_id, ...filtered) as Array<{ id: number }>
      if (rows.length !== filtered.length || filtered.length !== body.depends_on_phase_ids.length) {
        return NextResponse.json(
          { error: 'Dependencies must belong to the same milestone and cannot self-reference', code: 'INVALID_DEPENDENCIES' },
          { status: 400 },
        )
      }
    }

    const updates: string[] = []
    const values: Array<string | number> = []
    if (body.phase_key !== undefined) {
      updates.push('phase_key = ?')
      values.push(body.phase_key.trim())
    }
    if (body.phase_slug !== undefined) {
      updates.push('phase_slug = ?')
      values.push(body.phase_slug.trim())
    }
    if (body.lifecycle_phase !== undefined) {
      updates.push('lifecycle_phase = ?')
      values.push(body.lifecycle_phase)
    }
    if (body.ordering_numeric !== undefined) {
      updates.push('ordering_numeric = ?')
      values.push(body.ordering_numeric)
    }
    if (body.status !== undefined) {
      updates.push('status = ?')
      values.push(body.status)
    }
    if (body.depends_on_phase_ids !== undefined) {
      updates.push('depends_on_phase_ids = ?')
      values.push(serializeDependencyIds(body.depends_on_phase_ids))
    }
    updates.push('updated_at = unixepoch()')

    db.prepare(`UPDATE gsd_phases SET ${updates.join(', ')} WHERE id = ?`).run(...values, phaseId)

    const phase = getPhaseInWorkspace(db, phaseId, workspaceId)
    eventBus.broadcast('gsd.phase.updated', {
      project_id: Number(current.project_id),
      milestone_id: Number(current.milestone_id),
      phase_id: phaseId,
      actor: auth.user.username,
      workspace_id: workspaceId,
    })
    return NextResponse.json({ phase })
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      return NextResponse.json({ error: 'Phase key already exists', code: 'DUPLICATE_PHASE_KEY' }, { status: 409 })
    }
    logger.error({ err: error }, 'PATCH /api/gsd/phases/[phase_id] error')
    return NextResponse.json({ error: 'Failed to update phase' }, { status: 500 })
  }
}
