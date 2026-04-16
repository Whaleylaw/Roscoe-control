import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, createGsdPhaseSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import {
  getMilestoneInWorkspace,
  parseStrictId,
  serializeDependencyIds,
} from '@/lib/gsd-hierarchy'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ milestone_id: string }> },
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
      route: '/api/gsd/milestones/[milestone_id]/phases',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { milestone_id } = await params
    const milestoneId = parseStrictId(milestone_id)
    if (milestoneId == null) {
      return NextResponse.json({ error: 'Invalid milestone ID' }, { status: 400 })
    }

    const milestone = getMilestoneInWorkspace(db, milestoneId, workspaceId)
    if (!milestone) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }

    const phases = db
      .prepare(`SELECT * FROM gsd_phases WHERE milestone_id = ? ORDER BY ordering_numeric ASC, id ASC`)
      .all(milestoneId)

    return NextResponse.json({ phases })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/gsd/milestones/[milestone_id]/phases error')
    return NextResponse.json({ error: 'Failed to fetch phases' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ milestone_id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let milestoneId = 0
  let normalizedPhaseKey = ''
  let normalizedPhaseSlug = ''
  let normalizedLifecyclePhase = 'discuss'
  let normalizedOrdering = 0
  let normalizedStatus = 'planned'
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
      route: '/api/gsd/milestones/[milestone_id]/phases',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { milestone_id } = await params
    const parsedMilestoneId = parseStrictId(milestone_id)
    if (parsedMilestoneId == null) {
      return NextResponse.json({ error: 'Invalid milestone ID' }, { status: 400 })
    }
    milestoneId = parsedMilestoneId

    const milestone = getMilestoneInWorkspace(db, milestoneId, workspaceId)
    if (!milestone) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }

    const validated = await validateBody(request, createGsdPhaseSchema)
    if ('error' in validated) return validated.error
    const body = validated.data
    normalizedPhaseKey = body.phase_key.trim()
    normalizedPhaseSlug = body.phase_slug.trim()
    normalizedLifecyclePhase = body.lifecycle_phase
    normalizedOrdering = body.ordering_numeric
    normalizedStatus = body.status
    normalizedDependencies = serializeDependencyIds(body.depends_on_phase_ids)

    if (body.depends_on_phase_ids.length > 0) {
      const rows = db
        .prepare(
          `SELECT id FROM gsd_phases WHERE milestone_id = ? AND id IN (${body.depends_on_phase_ids.map(() => '?').join(',')})`,
        )
        .all(milestoneId, ...body.depends_on_phase_ids) as Array<{ id: number }>
      if (rows.length !== body.depends_on_phase_ids.length) {
        return NextResponse.json(
          { error: 'One or more dependency phases were not found in this milestone', code: 'INVALID_DEPENDENCIES' },
          { status: 400 },
        )
      }
    }

    const existing = db
      .prepare(`SELECT * FROM gsd_phases WHERE milestone_id = ? AND phase_key = ?`)
      .get(milestoneId, normalizedPhaseKey) as Record<string, unknown> | undefined
    if (existing) {
      const isReplay =
        String(existing.phase_slug ?? '') === normalizedPhaseSlug &&
        String(existing.lifecycle_phase ?? '') === normalizedLifecyclePhase &&
        Number(existing.ordering_numeric ?? 0) === normalizedOrdering &&
        String(existing.status ?? '') === normalizedStatus &&
        String(existing.depends_on_phase_ids ?? '[]') === normalizedDependencies

      if (isReplay) {
        return NextResponse.json({ phase: existing, idempotent_replay: true })
      }

      return NextResponse.json({ error: 'Phase key already exists', code: 'DUPLICATE_PHASE_KEY' }, { status: 409 })
    }

    const result = db
      .prepare(
        `INSERT INTO gsd_phases (
           milestone_id, phase_key, phase_slug, lifecycle_phase, ordering_numeric, status, depends_on_phase_ids, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
      )
      .run(
        milestoneId,
        normalizedPhaseKey,
        normalizedPhaseSlug,
        normalizedLifecyclePhase,
        normalizedOrdering,
        normalizedStatus,
        normalizedDependencies,
      )

    const phase = db.prepare(`SELECT * FROM gsd_phases WHERE id = ?`).get(Number(result.lastInsertRowid))
    eventBus.broadcast('gsd.phase.created', {
      project_id: Number(milestone.project_id),
      milestone_id: milestoneId,
      phase_id: Number(result.lastInsertRowid),
      actor: auth.user.username,
      workspace_id: workspaceId,
    })
    return NextResponse.json({ phase }, { status: 201 })
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      const db = getDatabase()
      const existing = db
        .prepare(`SELECT * FROM gsd_phases WHERE milestone_id = ? AND phase_key = ?`)
        .get(milestoneId, normalizedPhaseKey) as Record<string, unknown> | undefined
      if (
        existing &&
        String(existing.phase_slug ?? '') === normalizedPhaseSlug &&
        String(existing.lifecycle_phase ?? '') === normalizedLifecyclePhase &&
        Number(existing.ordering_numeric ?? 0) === normalizedOrdering &&
        String(existing.status ?? '') === normalizedStatus &&
        String(existing.depends_on_phase_ids ?? '[]') === normalizedDependencies
      ) {
        return NextResponse.json({ phase: existing, idempotent_replay: true })
      }
      return NextResponse.json({ error: 'Phase key already exists', code: 'DUPLICATE_PHASE_KEY' }, { status: 409 })
    }
    logger.error({ err: error }, 'POST /api/gsd/milestones/[milestone_id]/phases error')
    return NextResponse.json({ error: 'Failed to create phase' }, { status: 500 })
  }
}
