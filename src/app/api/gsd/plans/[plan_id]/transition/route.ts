import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, transitionGsdPlanSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import {
  canTransitionGsdPlanStatus,
  getBlockingGateTaskIdsForPlan,
  getPlanInWorkspace,
  optimisticLockMatches,
  parseDependencyIds,
  parseStrictId,
} from '@/lib/gsd-hierarchy'
import { getBlockingWaveConflictsForPlan } from '@/lib/gsd-conflicts'

export async function POST(
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
      route: '/api/gsd/plans/[plan_id]/transition',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { plan_id } = await params
    const planId = parseStrictId(plan_id)
    if (planId == null) {
      return NextResponse.json({ error: 'Invalid plan ID' }, { status: 400 })
    }

    const validated = await validateBody(request, transitionGsdPlanSchema)
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

    const fromStatus = current.status as any
    const toStatus = body.to_status
    if (!canTransitionGsdPlanStatus(fromStatus, toStatus)) {
      return NextResponse.json(
        { error: 'Illegal plan transition', code: 'ILLEGAL_TRANSITION', from_status: fromStatus, to_status: toStatus },
        { status: 409 },
      )
    }

    const blockingTaskIds = getBlockingGateTaskIdsForPlan(db, planId)
    if (blockingTaskIds.length > 0) {
      eventBus.broadcast('gsd.conflict.detected', {
        project_id: Number(current.project_id),
        entity: 'plan',
        plan_id: planId,
        code: 'GATE_BLOCKED',
        blocking_task_ids: blockingTaskIds,
        workspace_id: workspaceId,
      })
      return NextResponse.json(
        { error: 'Gate-required tasks must be approved first', code: 'GATE_BLOCKED', blocking_task_ids: blockingTaskIds },
        { status: 409 },
      )
    }

    if (toStatus === 'in_progress') {
      const dependencyIds = parseDependencyIds(current.depends_on_plan_ids as string | null | undefined)
      if (dependencyIds.length > 0) {
        const blockers = db.prepare(
          `SELECT id FROM gsd_plans WHERE phase_id = ? AND id IN (${dependencyIds.map(() => '?').join(',')}) AND status != 'done'`,
        ).all(current.phase_id, ...dependencyIds) as Array<{ id: number }>
        if (blockers.length > 0) {
          eventBus.broadcast('gsd.conflict.detected', {
            project_id: Number(current.project_id),
            entity: 'plan',
            plan_id: planId,
            code: 'PLAN_DEPENDENCY_BLOCKED',
            blocking_plan_ids: blockers.map((r) => r.id),
            workspace_id: workspaceId,
          })
          return NextResponse.json(
            { error: 'Dependent plans must be done first', code: 'PLAN_DEPENDENCY_BLOCKED', blocking_plan_ids: blockers.map((r) => r.id) },
            { status: 409 },
          )
        }
      }

      const waveConflicts = getBlockingWaveConflictsForPlan(
        db,
        planId,
        Number(current.phase_id),
        Number(current.wave),
      )
      if (waveConflicts.length > 0) {
        const blockingPlanIds = Array.from(
          new Set(
            waveConflicts
              .flatMap((conflict) => conflict.plan_ids)
              .filter((id) => id !== planId),
          ),
        ).sort((a, b) => a - b)
        const conflictingPaths = Array.from(
          new Set(waveConflicts.flatMap((conflict) => conflict.paths)),
        ).sort()

        eventBus.broadcast('gsd.conflict.detected', {
          project_id: Number(current.project_id),
          entity: 'plan',
          plan_id: planId,
          code: 'WAVE_CONFLICT_BLOCKED',
          blocking_plan_ids: blockingPlanIds,
          conflicting_paths: conflictingPaths,
          workspace_id: workspaceId,
        })
        return NextResponse.json(
          {
            error: 'Same-wave plan conflict detected on shared resources',
            code: 'WAVE_CONFLICT_BLOCKED',
            blocking_plan_ids: blockingPlanIds,
            conflicting_paths: conflictingPaths,
          },
          { status: 409 },
        )
      }
    }

    type QueueActivation = {
      activated: number
      already_active: number
      skipped_by_state: number
      reassigned: number
      by_status: { inbox: number; assigned: number }
      task_ids: number[]
    }

    let queueActivation: QueueActivation | null = null

    if (toStatus === 'in_progress') {
      const projectId = Number(current.project_id)

      // Phase 19 QUEUE-02 — one SQLite transaction wraps plan status flip + all task activations.
      const runActivation = db.transaction((): QueueActivation => {
        // 1. Flip plan status inside the transaction so real errors roll it back.
        db.prepare(
          `UPDATE gsd_plans SET status = ?, updated_at = unixepoch() WHERE id = ?`,
        ).run(toStatus, planId)

        // 2. Fetch ALL tasks linked to the plan (not just activatable ones) so we can bucket them.
        const linkedTasks = db.prepare(
          `SELECT id, status, assigned_to, recipe_slug
           FROM tasks
           WHERE workspace_id = ?
             AND project_id = ?
             AND gsd_plan_id = ?
           ORDER BY created_at ASC, id ASC`,
        ).all(workspaceId, projectId, planId) as Array<{
          id: number
          status: string
          assigned_to: string | null
          recipe_slug: string | null
        }>

        const counters: QueueActivation = {
          activated: 0,
          already_active: 0,
          skipped_by_state: 0,
          reassigned: 0,
          by_status: { inbox: 0, assigned: 0 },
          task_ids: [],
        }

        // Dead-assignee predicate: agent row with status = 'error' OR no matching agent row.
        // Schema note: agents.status enum is (offline | idle | busy | error) — no `disabled` value,
        // so CONTEXT.md's `disabled` predicate is mapped to `error` for Phase 19. Transient states
        // (offline, idle, busy) may legitimately come back and are NOT treated as dead.
        const lookupAgent = db.prepare(
          `SELECT status FROM agents WHERE name = ? LIMIT 1`,
        )
        const updateActivate = db.prepare(
          `UPDATE tasks
           SET status = ?, assigned_to = ?, updated_at = unixepoch()
           WHERE id = ?
             AND status IN ('backlog', 'todo')`,
        )

        for (const row of linkedTasks) {
          const currentStatus = row.status
          if (currentStatus === 'backlog' || currentStatus === 'todo') {
            let targetStatus: 'inbox' | 'assigned'
            let nextAssignedTo: string | null = row.assigned_to
            let reassigned = false

            const hasAssignee = row.assigned_to != null && row.assigned_to !== ''
            const hasRecipe = row.recipe_slug != null && row.recipe_slug !== ''

            if (hasAssignee || hasRecipe) {
              targetStatus = 'assigned'
            } else {
              targetStatus = 'inbox'
            }

            // Dead-assignee recovery: only when there IS a named assignee AND no recipe override.
            // Recipe-tagged tasks route to `assigned` with a null assigned_to via the runner-token path
            // and are NOT subject to the agent-alive check (runner claims by recipe slug, not agent name).
            if (hasAssignee && !hasRecipe) {
              const agent = lookupAgent.get(row.assigned_to) as { status?: string } | undefined
              const agentDead = !agent || agent.status === 'error'
              if (agentDead) {
                targetStatus = 'inbox'
                nextAssignedTo = null
                reassigned = true
              }
            }

            // Recipe-alone branch: preserve the null sentinel (do NOT synthesize an assignee).
            if (!hasAssignee && hasRecipe) {
              nextAssignedTo = null
            }

            const result = updateActivate.run(targetStatus, nextAssignedTo, row.id)
            if (result.changes > 0) {
              counters.activated += 1
              counters.task_ids.push(row.id)
              counters.by_status[targetStatus] += 1
              if (reassigned) counters.reassigned += 1
            }
          } else if (currentStatus === 'inbox' || currentStatus === 'assigned') {
            counters.already_active += 1
          } else {
            counters.skipped_by_state += 1
          }
        }

        return counters
      })

      queueActivation = runActivation()
    } else {
      // Non-in_progress transitions: flip plan status outside any activation transaction.
      db.prepare(`UPDATE gsd_plans SET status = ?, updated_at = unixepoch() WHERE id = ?`).run(toStatus, planId)
    }

    const plan = getPlanInWorkspace(db, planId, workspaceId)

    // Emit activation event AFTER the transaction commits, with the same payload shape as the response.
    if (toStatus === 'in_progress' && queueActivation) {
      eventBus.broadcast('gsd.plan.tasks_activated', {
        project_id: Number(current.project_id),
        plan_id: planId,
        phase_id: current.phase_id,
        queue_activation: queueActivation,
        actor: auth.user.username,
        workspace_id: workspaceId,
      })
    }

    eventBus.broadcast('gsd.plan.transitioned', {
      project_id: Number(current.project_id),
      plan_id: planId,
      phase_id: current.phase_id,
      from_status: fromStatus,
      to_status: toStatus,
      actor: auth.user.username,
      workspace_id: workspaceId,
    })
    return NextResponse.json({
      plan,
      from_status: fromStatus,
      to_status: toStatus,
      queue_activation: queueActivation,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/gsd/plans/[plan_id]/transition error')
    return NextResponse.json({ error: 'Failed to transition plan' }, { status: 500 })
  }
}
