import { NextRequest, NextResponse } from 'next/server'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { listWaypointRoutes, resolveWaypointPlanRouteScope } from '@/lib/waypoint-command'
import { startOrReuseWaypointRoute, WAYPOINT_SUBJECT_TYPES } from '@/lib/waypoint'
import { normalizeWaypointRateLimitError, normalizeWaypointValidationDetails } from '@/lib/waypoint-api'
import { startReferralPackageQuestRoute } from '@/lib/waypoint-quest-runtime'
import { getWaypointProjectBinding } from '@/lib/waypoint-project-binding'
import { checkWaypointTaskArtifacts } from '@/lib/waypoint-artifacts'

const PlanBody = z.object({
  subject: z.literal('plan'),
  plan_id: z.number().int().positive(),
  definition_slug: z.string().min(1).default('waypoint-plan-execution'),
  definition_version: z.number().int().positive().default(1),
})

const QuestBody = z.object({
  subject: z.literal('quest'),
  quest_slug: z.literal('referral-package'),
})

const Body = z.discriminatedUnion('subject', [PlanBody, QuestBody])

const Query = z.object({
  status: z.enum(['active', 'blocked', 'complete', 'cancelled', 'failed']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

function routesError(status: number, error: string, details?: unknown) {
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

interface RouteTaskSummary {
  readonly total: number
  readonly by_status: Record<string, number>
}

interface FirstArtifactBlocker {
  readonly task_id: number
  readonly recipe_slug: string | null
  readonly missing_artifacts: readonly string[]
}

function summarizeRouteTasks(db: Database.Database, workflowInstanceId: number, workspaceId: number): RouteTaskSummary {
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM tasks
    WHERE workspace_id = ?
      AND json_extract(metadata, '$.workflow.workflow_instance_id') = ?
    GROUP BY status
  `).all(workspaceId, workflowInstanceId) as Array<{ status: string; count: number }>

  const byStatus: Record<string, number> = {}
  let total = 0
  for (const row of rows) {
    byStatus[row.status] = row.count
    total += row.count
  }
  return { total, by_status: byStatus }
}

async function collectFirstArtifactBlockers(
  db: Database.Database,
  taskIds: readonly number[],
  workspaceId: number,
): Promise<FirstArtifactBlocker[]> {
  const blockers: FirstArtifactBlocker[] = []
  for (const taskId of taskIds) {
    const row = db.prepare(`SELECT id, recipe_slug, metadata FROM tasks WHERE id = ? AND workspace_id = ? LIMIT 1`)
      .get(taskId, workspaceId) as { id: number; recipe_slug: string | null; metadata: string | null } | undefined
    if (!row) continue
    const waypoint = objectRecord(parseJsonObject(row.metadata).waypoint)
    const requiredArtifacts = Array.isArray(waypoint.required_artifacts) ? waypoint.required_artifacts : []
    if (requiredArtifacts.length === 0) continue
    const check = await checkWaypointTaskArtifacts(db, { taskId: row.id, workspaceId })
    if (check.missingArtifacts.length > 0) {
      blockers.push({ task_id: row.id, recipe_slug: row.recipe_slug, missing_artifacts: check.missingArtifacts })
    }
  }
  return blockers
}

function nextActionsForBlockers(blockers: readonly FirstArtifactBlocker[]): string[] {
  if (blockers.length === 0) return ['Route started; continue with the next materialized task.']
  return blockers.flatMap((blocker) => blocker.missing_artifacts.map((artifact) => `Produce or attach required artifact ${artifact} for task ${blocker.task_id}.`))
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  const parsed: unknown = JSON.parse(raw)
  return objectRecord(parsed)
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return routesError(auth.status ?? 403, auth.error ?? 'Forbidden')

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/waypoint/routes',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseStrictId(id)
    if (projectId == null) {
      return routesError(400, 'Invalid project ID')
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return routesError(404, 'Project not found')
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
      return routesError(409, 'Waypoint lifecycle is not enabled for this project')
    }

    const parsed = Query.safeParse({
      status: request.nextUrl.searchParams.get('status') ?? undefined,
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
      offset: request.nextUrl.searchParams.get('offset') ?? undefined,
    })
    if (!parsed.success) {
      return routesError(400, 'Invalid query params', normalizeWaypointValidationDetails(parsed.error.issues))
    }

    const routes = listWaypointRoutes(db, {
      workspaceId,
      projectId,
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    })

    return NextResponse.json({
      ok: true,
      action: 'list_routes',
      routes,
      count: routes.length,
      filters: {
        status: parsed.data.status ?? null,
      },
      pagination: {
        limit: parsed.data.limit ?? 50,
        offset: parsed.data.offset ?? 0,
      },
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return routesError(error.status, error.message)
    }
    if (error instanceof Error) {
      return routesError(400, error.message)
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/waypoint/routes error')
    return routesError(500, 'Failed to list Waypoint routes')
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return routesError(auth.status ?? 403, auth.error ?? 'Forbidden')
  const rateCheck = normalizeWaypointRateLimitError(mutationLimiter(request))
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/waypoint/routes',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseStrictId(id)
    if (projectId == null) {
      return routesError(400, 'Invalid project ID')
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return routesError(404, 'Project not found')
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
      return routesError(409, 'Waypoint lifecycle is not enabled for this project')
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return routesError(400, 'Invalid JSON body')
    }

    const parsed = Body.safeParse(body)
    if (!parsed.success) {
      return routesError(400, 'Invalid request body', normalizeWaypointValidationDetails(parsed.error.issues))
    }

    const actor = auth.user.display_name || auth.user.username || 'operator'

    if (parsed.data.subject === 'quest') {
      const projectWithMetadata = db.prepare(`SELECT id, workspace_id, metadata FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1`)
        .get(projectId, workspaceId) as { id: number; workspace_id: number; metadata: string | null } | undefined
      if (!projectWithMetadata) return routesError(404, 'Project not found')
      const binding = getWaypointProjectBinding(projectWithMetadata)
      if (!binding) return routesError(409, 'Project does not have a Waypoint package binding')
      if (binding.questSlug !== parsed.data.quest_slug) {
        return routesError(409, `Project is bound to ${binding.questSlug}, not ${parsed.data.quest_slug}`)
      }

      const route = await startReferralPackageQuestRoute(db, {
        projectId,
        workspaceId,
        tenantId,
        actor,
      })
      const taskSummary = summarizeRouteTasks(db, route.workflowInstanceId, workspaceId)
      const firstBlockers = await collectFirstArtifactBlockers(db, route.materializedTaskIds, workspaceId)

      return NextResponse.json({
        ok: true,
        action: 'start_route',
        subject: 'quest',
        quest_slug: parsed.data.quest_slug,
        workflow_instance_id: route.workflowInstanceId,
        reused: route.reused,
        task_summary: taskSummary,
        materialized_task_ids: route.materializedTaskIds,
        package_pin: {
          package_source: binding.packageSource,
          package_pin: binding.packagePin,
          core_version: binding.coreVersion,
          folder_host_version: binding.folderHostVersion,
        },
        first_blockers: firstBlockers,
        next_actions: nextActionsForBlockers(firstBlockers),
      })
    }

    const scope = resolveWaypointPlanRouteScope(db, {
      workspaceId,
      projectId,
      planId: parsed.data.plan_id,
    })

    const route = startOrReuseWaypointRoute(db, {
      workspaceId,
      tenantId,
      actor,
      projectId,
      subjectType: WAYPOINT_SUBJECT_TYPES.plan,
      subjectId: parsed.data.plan_id,
      definitionSlug: parsed.data.definition_slug,
      definitionVersion: parsed.data.definition_version,
      vars: {
        project_id: scope.projectId,
        workstream_id: scope.workstreamId,
        milestone_id: scope.milestoneId,
        phase_id: scope.phaseId,
        plan_id: scope.planId,
        workspace_id: workspaceId,
      },
    })

    return NextResponse.json({
      ok: true,
      action: 'start_route',
      subject: 'plan',
      plan_id: parsed.data.plan_id,
      definition_slug: parsed.data.definition_slug,
      definition_version: parsed.data.definition_version,
      workflow_instance_id: route.instanceId,
      reused: route.reused,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return routesError(error.status, error.message)
    }
    if (error instanceof Error) {
      return routesError(400, error.message)
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/waypoint/routes error')
    return routesError(500, 'Failed to start Waypoint route')
  }
}
