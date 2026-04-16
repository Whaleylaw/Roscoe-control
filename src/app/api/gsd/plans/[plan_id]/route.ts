import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, updateGsdPlanSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import {
  getPlanInWorkspace,
  optimisticLockMatches,
  parseStrictId,
  serializeDependencyIds,
} from '@/lib/gsd-hierarchy'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ plan_id: string }> },
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
      route: '/api/gsd/plans/[plan_id]',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { plan_id } = await params
    const planId = parseStrictId(plan_id)
    if (planId == null) {
      return NextResponse.json({ error: 'Invalid plan ID' }, { status: 400 })
    }

    const validated = await validateBody(request, updateGsdPlanSchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    const current = getPlanInWorkspace(db, planId, workspaceId)
    if (!current) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    if (!optimisticLockMatches(current.updated_at as number | null | undefined, body.expected_updated_at)) {
      return NextResponse.json(
        { error: 'Plan has changed since last read', code: 'OPTIMISTIC_LOCK_FAILED' },
        { status: 409 },
      )
    }

    if (body.depends_on_plan_ids !== undefined) {
      const filtered = body.depends_on_plan_ids.filter((id) => id !== planId)
      const rows = filtered.length === 0
        ? []
        : db.prepare(
            `SELECT id FROM gsd_plans WHERE phase_id = ? AND id IN (${filtered.map(() => '?').join(',')})`,
          ).all(current.phase_id, ...filtered) as Array<{ id: number }>
      if (rows.length !== filtered.length || filtered.length !== body.depends_on_plan_ids.length) {
        return NextResponse.json(
          { error: 'Dependencies must belong to the same phase and cannot self-reference', code: 'INVALID_DEPENDENCIES' },
          { status: 400 },
        )
      }
    }

    const updates: string[] = []
    const values: Array<string | number> = []
    if (body.plan_ref !== undefined) {
      updates.push('plan_ref = ?')
      values.push(body.plan_ref.trim())
    }
    if (body.title !== undefined) {
      updates.push('title = ?')
      values.push(body.title.trim())
    }
    if (body.wave !== undefined) {
      updates.push('wave = ?')
      values.push(body.wave)
    }
    if (body.status !== undefined) {
      updates.push('status = ?')
      values.push(body.status)
    }
    if (body.depends_on_plan_ids !== undefined) {
      updates.push('depends_on_plan_ids = ?')
      values.push(serializeDependencyIds(body.depends_on_plan_ids))
    }
    updates.push('updated_at = unixepoch()')

    db.prepare(`UPDATE gsd_plans SET ${updates.join(', ')} WHERE id = ?`).run(...values, planId)

    const plan = getPlanInWorkspace(db, planId, workspaceId)
    eventBus.broadcast('gsd.plan.updated', {
      project_id: Number(current.project_id),
      phase_id: Number(current.phase_id),
      plan_id: planId,
      actor: auth.user.username,
      workspace_id: workspaceId,
    })
    return NextResponse.json({ plan })
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      return NextResponse.json({ error: 'Plan ref already exists', code: 'DUPLICATE_PLAN_REF' }, { status: 409 })
    }
    logger.error({ err: error }, 'PATCH /api/gsd/plans/[plan_id] error')
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 })
  }
}
