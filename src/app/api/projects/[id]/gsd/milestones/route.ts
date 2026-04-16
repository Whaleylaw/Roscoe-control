import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, createGsdMilestoneSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import {
  getScopedProject,
  getScopedWorkstream,
  parseStrictId,
} from '@/lib/gsd-hierarchy'

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
      route: '/api/projects/[id]/gsd/milestones',
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

    const milestones = db
      .prepare(
        `SELECT * FROM gsd_milestones WHERE project_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(projectId)

    return NextResponse.json({ milestones })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/gsd/milestones error')
    return NextResponse.json({ error: 'Failed to fetch milestones' }, { status: 500 })
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
  let normalizedWorkstreamId: number | null = null
  let normalizedVersionLabel = ''
  let normalizedTitle = ''
  let normalizedStatus = 'planned'
  let normalizedStartedAt: number | null = null
  let normalizedCompletedAt: number | null = null

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor =
      (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/gsd/milestones',
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

    const validated = await validateBody(request, createGsdMilestoneSchema)
    if ('error' in validated) return validated.error
    const body = validated.data
    normalizedWorkstreamId = body.workstream_id ?? null
    normalizedVersionLabel = body.version_label.trim()
    normalizedTitle = body.title.trim()
    normalizedStatus = body.status
    normalizedStartedAt = body.started_at ?? null
    normalizedCompletedAt = body.completed_at ?? null

    if (normalizedWorkstreamId != null && !getScopedWorkstream(db, projectId, normalizedWorkstreamId)) {
      return NextResponse.json({ error: 'Workstream not found', code: 'WORKSTREAM_NOT_FOUND' }, { status: 404 })
    }

    const existing = db
      .prepare(
        `SELECT *
         FROM gsd_milestones
         WHERE project_id = ?
           AND IFNULL(workstream_id, 0) = IFNULL(?, 0)
           AND version_label = ?
           AND title = ?`,
      )
      .get(projectId, normalizedWorkstreamId, normalizedVersionLabel, normalizedTitle) as Record<string, unknown> | undefined

    if (existing) {
      const isReplay =
        String(existing.status ?? '') === normalizedStatus &&
        (existing.started_at ?? null) === (normalizedStartedAt ?? null) &&
        (existing.completed_at ?? null) === (normalizedCompletedAt ?? null)

      if (isReplay) {
        return NextResponse.json({ milestone: existing, idempotent_replay: true })
      }

      return NextResponse.json(
        { error: 'Milestone already exists', code: 'DUPLICATE_MILESTONE' },
        { status: 409 },
      )
    }

    const result = db
      .prepare(
        `INSERT INTO gsd_milestones (
           project_id, workstream_id, version_label, title, status, started_at, completed_at, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch()
         WHERE NOT EXISTS (
           SELECT 1
           FROM gsd_milestones
           WHERE project_id = ?
             AND IFNULL(workstream_id, 0) = IFNULL(?, 0)
             AND version_label = ?
             AND title = ?
         )`,
      )
      .run(
        projectId,
        normalizedWorkstreamId,
        normalizedVersionLabel,
        normalizedTitle,
        normalizedStatus,
        normalizedStartedAt,
        normalizedCompletedAt,
        projectId,
        normalizedWorkstreamId,
        normalizedVersionLabel,
        normalizedTitle,
      )

    if (result.changes === 0) {
      const replayMilestone = db
        .prepare(
          `SELECT *
           FROM gsd_milestones
           WHERE project_id = ?
             AND IFNULL(workstream_id, 0) = IFNULL(?, 0)
             AND version_label = ?
             AND title = ?`,
        )
        .get(projectId, normalizedWorkstreamId, normalizedVersionLabel, normalizedTitle) as Record<string, unknown> | undefined

      if (
        replayMilestone &&
        String(replayMilestone.status ?? '') === normalizedStatus &&
        (replayMilestone.started_at ?? null) === (normalizedStartedAt ?? null) &&
        (replayMilestone.completed_at ?? null) === (normalizedCompletedAt ?? null)
      ) {
        return NextResponse.json({ milestone: replayMilestone, idempotent_replay: true })
      }

      return NextResponse.json(
        { error: 'Milestone already exists', code: 'DUPLICATE_MILESTONE' },
        { status: 409 },
      )
    }

    const milestone = db
      .prepare(`SELECT * FROM gsd_milestones WHERE id = ?`)
      .get(Number(result.lastInsertRowid))

    eventBus.broadcast('gsd.milestone.created', {
      project_id: projectId,
      milestone_id: Number(result.lastInsertRowid),
      workstream_id: normalizedWorkstreamId,
      actor: auth.user.username,
      workspace_id: workspaceId,
    })

    return NextResponse.json({ milestone }, { status: 201 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (String((error as Error | undefined)?.message || '').includes('UNIQUE constraint failed')) {
      const db = getDatabase()
      const existing = db
        .prepare(
          `SELECT *
           FROM gsd_milestones
           WHERE project_id = ?
             AND IFNULL(workstream_id, 0) = IFNULL(?, 0)
             AND version_label = ?
             AND title = ?`,
        )
        .get(projectId, normalizedWorkstreamId, normalizedVersionLabel, normalizedTitle) as Record<string, unknown> | undefined

      if (
        existing &&
        String(existing.status ?? '') === normalizedStatus &&
        (existing.started_at ?? null) === (normalizedStartedAt ?? null) &&
        (existing.completed_at ?? null) === (normalizedCompletedAt ?? null)
      ) {
        return NextResponse.json({ milestone: existing, idempotent_replay: true })
      }

      return NextResponse.json(
        { error: 'Milestone already exists', code: 'DUPLICATE_MILESTONE' },
        { status: 409 },
      )
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/gsd/milestones error')
    return NextResponse.json({ error: 'Failed to create milestone' }, { status: 500 })
  }
}
