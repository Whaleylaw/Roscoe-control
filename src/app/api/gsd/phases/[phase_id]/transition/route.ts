import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, transitionGsdPhaseSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import {
  canTransitionGsdLifecycle,
  getBlockingGateTaskIdsForPhase,
  getPhaseInWorkspace,
  optimisticLockMatches,
  parseDependencyIds,
  parseStrictId,
} from '@/lib/gsd-hierarchy'

export async function POST(
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
      route: '/api/gsd/phases/[phase_id]/transition',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { phase_id } = await params
    const phaseId = parseStrictId(phase_id)
    if (phaseId == null) {
      return NextResponse.json({ error: 'Invalid phase ID' }, { status: 400 })
    }

    const validated = await validateBody(request, transitionGsdPhaseSchema)
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

    const fromPhase = current.lifecycle_phase as any
    const toPhase = body.to_lifecycle_phase
    if (!canTransitionGsdLifecycle(fromPhase, toPhase)) {
      return NextResponse.json(
        { error: 'Illegal lifecycle transition', code: 'ILLEGAL_TRANSITION', from_phase: fromPhase, to_phase: toPhase },
        { status: 409 },
      )
    }

    const blockingTaskIds = getBlockingGateTaskIdsForPhase(db, phaseId)
    if (blockingTaskIds.length > 0) {
      eventBus.broadcast('gsd.conflict.detected', {
        project_id: Number(current.project_id),
        entity: 'phase',
        phase_id: phaseId,
        code: 'GATE_BLOCKED',
        blocking_task_ids: blockingTaskIds,
        workspace_id: workspaceId,
      })
      return NextResponse.json(
        { error: 'Gate-required tasks must be approved first', code: 'GATE_BLOCKED', blocking_task_ids: blockingTaskIds },
        { status: 409 },
      )
    }

    const dependencyIds = parseDependencyIds(current.depends_on_phase_ids as string | null | undefined)
    if (toPhase !== 'discuss' && dependencyIds.length > 0) {
      const blockers = db.prepare(
        `SELECT id FROM gsd_phases WHERE milestone_id = ? AND id IN (${dependencyIds.map(() => '?').join(',')}) AND status != 'complete'`,
      ).all(current.milestone_id, ...dependencyIds) as Array<{ id: number }>
      if (blockers.length > 0) {
        eventBus.broadcast('gsd.conflict.detected', {
          project_id: Number(current.project_id),
          entity: 'phase',
          phase_id: phaseId,
          code: 'DEPENDENCY_BLOCKED',
          blocking_phase_ids: blockers.map((r) => r.id),
          workspace_id: workspaceId,
        })
        return NextResponse.json(
          { error: 'Dependency phases must be complete first', code: 'DEPENDENCY_BLOCKED', blocking_phase_ids: blockers.map((r) => r.id) },
          { status: 409 },
        )
      }
    }

    if (toPhase !== 'discuss') {
      const blockers = db.prepare(
        `SELECT id FROM gsd_phases
         WHERE milestone_id = ? AND ordering_numeric < ? AND id != ? AND status != 'complete'
         ORDER BY ordering_numeric ASC`,
      ).all(current.milestone_id, current.ordering_numeric, phaseId) as Array<{ id: number }>
      if (blockers.length > 0) {
        eventBus.broadcast('gsd.conflict.detected', {
          project_id: Number(current.project_id),
          entity: 'phase',
          phase_id: phaseId,
          code: 'PHASE_ORDER_BLOCKED',
          blocking_phase_ids: blockers.map((r) => r.id),
          workspace_id: workspaceId,
        })
        return NextResponse.json(
          { error: 'Earlier phases must be complete first', code: 'PHASE_ORDER_BLOCKED', blocking_phase_ids: blockers.map((r) => r.id) },
          { status: 409 },
        )
      }
    }

    const nextStatus =
      toPhase === 'done'
        ? 'complete'
        : current.status === 'planned' || current.status === 'deferred'
          ? 'active'
          : current.status

    db.prepare(
      `UPDATE gsd_phases
       SET lifecycle_phase = ?, status = ?, updated_at = unixepoch()
       WHERE id = ?`,
    ).run(toPhase, nextStatus, phaseId)

    const phase = getPhaseInWorkspace(db, phaseId, workspaceId)
    eventBus.broadcast('gsd.phase.transitioned', {
      project_id: Number(current.project_id),
      phase_id: phaseId,
      milestone_id: current.milestone_id,
      from_phase: fromPhase,
      to_phase: toPhase,
      actor: auth.user.username,
      workspace_id: workspaceId,
    })
    return NextResponse.json({ phase, from_phase: fromPhase, to_phase: toPhase })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/gsd/phases/[phase_id]/transition error')
    return NextResponse.json({ error: 'Failed to transition phase' }, { status: 500 })
  }
}
