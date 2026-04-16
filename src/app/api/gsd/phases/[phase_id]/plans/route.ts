import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, createGsdPlanSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import {
  getPhaseInWorkspace,
  parseStrictId,
  serializeDependencyIds,
} from '@/lib/gsd-hierarchy'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ phase_id: string }> },
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
      route: '/api/gsd/phases/[phase_id]/plans',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { phase_id } = await params
    const phaseId = parseStrictId(phase_id)
    if (phaseId == null) {
      return NextResponse.json({ error: 'Invalid phase ID' }, { status: 400 })
    }

    const phase = getPhaseInWorkspace(db, phaseId, workspaceId)
    if (!phase) {
      return NextResponse.json({ error: 'Phase not found' }, { status: 404 })
    }

    const plans = db
      .prepare(`SELECT * FROM gsd_plans WHERE phase_id = ? ORDER BY wave ASC, created_at ASC, id ASC`)
      .all(phaseId)

    return NextResponse.json({ plans })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/gsd/phases/[phase_id]/plans error')
    return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ phase_id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let phaseId = 0
  let normalizedPlanRef = ''
  let normalizedTitle = ''
  let normalizedWave = 1
  let normalizedStatus = 'todo'
  let normalizedDependencies = '[]'

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor =
      (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/gsd/phases/[phase_id]/plans',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { phase_id } = await params
    const parsedPhaseId = parseStrictId(phase_id)
    if (parsedPhaseId == null) {
      return NextResponse.json({ error: 'Invalid phase ID' }, { status: 400 })
    }
    phaseId = parsedPhaseId

    const phase = getPhaseInWorkspace(db, phaseId, workspaceId)
    if (!phase) {
      return NextResponse.json({ error: 'Phase not found' }, { status: 404 })
    }

    const validated = await validateBody(request, createGsdPlanSchema)
    if ('error' in validated) return validated.error
    const body = validated.data
    normalizedPlanRef = body.plan_ref.trim()
    normalizedTitle = body.title.trim()
    normalizedWave = body.wave
    normalizedStatus = body.status
    normalizedDependencies = serializeDependencyIds(body.depends_on_plan_ids)

    if (body.depends_on_plan_ids.length > 0) {
      const rows = db
        .prepare(
          `SELECT id FROM gsd_plans WHERE phase_id = ? AND id IN (${body.depends_on_plan_ids.map(() => '?').join(',')})`,
        )
        .all(phaseId, ...body.depends_on_plan_ids) as Array<{ id: number }>
      if (rows.length !== body.depends_on_plan_ids.length) {
        return NextResponse.json(
          { error: 'One or more dependency plans were not found in this phase', code: 'INVALID_DEPENDENCIES' },
          { status: 400 },
        )
      }
    }

    const existing = db
      .prepare(`SELECT * FROM gsd_plans WHERE phase_id = ? AND plan_ref = ?`)
      .get(phaseId, normalizedPlanRef) as Record<string, unknown> | undefined
    if (existing) {
      const isReplay =
        String(existing.title ?? '') === normalizedTitle &&
        Number(existing.wave ?? 0) === normalizedWave &&
        String(existing.status ?? '') === normalizedStatus &&
        String(existing.depends_on_plan_ids ?? '[]') === normalizedDependencies

      if (isReplay) {
        return NextResponse.json({ plan: existing, idempotent_replay: true })
      }

      return NextResponse.json({ error: 'Plan ref already exists', code: 'DUPLICATE_PLAN_REF' }, { status: 409 })
    }

    const result = db
      .prepare(
        `INSERT INTO gsd_plans (
           phase_id, plan_ref, title, wave, status, depends_on_plan_ids, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
      )
      .run(
        phaseId,
        normalizedPlanRef,
        normalizedTitle,
        normalizedWave,
        normalizedStatus,
        normalizedDependencies,
      )

    const plan = db.prepare(`SELECT * FROM gsd_plans WHERE id = ?`).get(Number(result.lastInsertRowid))
    eventBus.broadcast('gsd.plan.created', {
      project_id: Number(phase.project_id),
      phase_id: phaseId,
      plan_id: Number(result.lastInsertRowid),
      actor: auth.user.username,
      workspace_id: workspaceId,
    })
    return NextResponse.json({ plan }, { status: 201 })
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      const db = getDatabase()
      const existing = db
        .prepare(`SELECT * FROM gsd_plans WHERE phase_id = ? AND plan_ref = ?`)
        .get(phaseId, normalizedPlanRef) as Record<string, unknown> | undefined
      if (
        existing &&
        String(existing.title ?? '') === normalizedTitle &&
        Number(existing.wave ?? 0) === normalizedWave &&
        String(existing.status ?? '') === normalizedStatus &&
        String(existing.depends_on_plan_ids ?? '[]') === normalizedDependencies
      ) {
        return NextResponse.json({ plan: existing, idempotent_replay: true })
      }
      return NextResponse.json({ error: 'Plan ref already exists', code: 'DUPLICATE_PLAN_REF' }, { status: 409 })
    }
    logger.error({ err: error }, 'POST /api/gsd/phases/[phase_id]/plans error')
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 })
  }
}
