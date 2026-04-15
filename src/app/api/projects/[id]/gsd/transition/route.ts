import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { validateBody, transitionSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'

// D-24..D-27 — linear ordering only; NEXT_PHASE.done === null means terminal.
const NEXT_PHASE: Record<string, string | null> = {
  discuss: 'plan',
  plan: 'execute',
  execute: 'verify',
  verify: 'done',
  done: null,
}

type Phase = 'discuss' | 'plan' | 'execute' | 'verify' | 'done'

/**
 * POST /api/projects/[id]/gsd/transition
 *
 * Advances a project through the GSD lifecycle with per-phase preconditions.
 *
 * Rules (D-24..D-29):
 *   - discuss → plan     : ≥1 discuss task done
 *   - plan    → execute  : ≥1 plan task done AND gate_status='approved'
 *   - execute → verify   : 0 open execute tasks OR waive_remaining=true+reason
 *   - verify  → done     : ≥1 verify task done
 *   - anything else      : 409 ILLEGAL_TRANSITION
 *
 * On success: UPDATE projects sets gsd_phase, gsd_updated_at AND updated_at
 * (Pitfall 4 — dual-timestamp so existing "last activity" sorts pick up the
 * transition), logs activity, and broadcasts 'project.gsd.transition' (GSD-28).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
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
      route: '/api/projects/[id]/gsd/transition',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = Number.parseInt(id, 10)
    if (!Number.isFinite(projectId) || String(projectId) !== id.trim()) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    }

    const validated = await validateBody(request, transitionSchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    const project = db
      .prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`)
      .get(projectId, workspaceId) as any
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found', code: 'PROJECT_NOT_FOUND' },
        { status: 404 },
      )
    }

    const fromPhase = project.gsd_phase as Phase
    const toPhase = body.to_phase as Phase

    // D-28: illegal jump — only the next phase in the linear chain is allowed.
    if (fromPhase === toPhase || NEXT_PHASE[fromPhase] !== toPhase) {
      return NextResponse.json(
        {
          error: `Can't advance from ${fromPhase} to ${toPhase}. Lifecycle must progress discuss → plan → execute → verify → done.`,
          code: 'ILLEGAL_TRANSITION',
          from_phase: fromPhase,
          to_phase: toPhase,
        },
        { status: 409 },
      )
    }

    // D-24: discuss → plan — require at least one discuss task with status=done
    if (fromPhase === 'discuss' && toPhase === 'plan') {
      const row = db
        .prepare(
          `
          SELECT COUNT(*) AS n FROM tasks
          WHERE project_id = ? AND workspace_id = ?
            AND gsd_phase = 'discuss' AND status = 'done'
        `,
        )
        .get(projectId, workspaceId) as { n: number }
      if (row.n < 1) {
        return NextResponse.json(
          {
            error: 'At least one Discuss task must be done before advancing to Plan.',
            code: 'DISCUSS_REQUIRES_ONE_DONE',
            from_phase: fromPhase,
            to_phase: toPhase,
          },
          { status: 409 },
        )
      }
    }

    // D-25: plan → execute — require at least one done AND approved plan task
    if (fromPhase === 'plan' && toPhase === 'execute') {
      const row = db
        .prepare(
          `
          SELECT COUNT(*) AS n FROM tasks
          WHERE project_id = ? AND workspace_id = ?
            AND gsd_phase = 'plan' AND status = 'done' AND gate_status = 'approved'
        `,
        )
        .get(projectId, workspaceId) as { n: number }
      if (row.n < 1) {
        return NextResponse.json(
          {
            error:
              'At least one Plan task must be done AND gate-approved before advancing to Execute.',
            code: 'PLAN_REQUIRES_APPROVED_PACKAGE',
            from_phase: fromPhase,
            to_phase: toPhase,
          },
          { status: 409 },
        )
      }
    }

    // D-26: execute → verify — all execute tasks must be done OR waive_remaining=true
    if (fromPhase === 'execute' && toPhase === 'verify') {
      const row = db
        .prepare(
          `
          SELECT COUNT(*) AS n FROM tasks
          WHERE project_id = ? AND workspace_id = ?
            AND gsd_phase = 'execute' AND status != 'done'
        `,
        )
        .get(projectId, workspaceId) as { n: number }
      if (row.n > 0 && !body.waive_remaining) {
        return NextResponse.json(
          {
            error: `${row.n} Execute task${row.n === 1 ? '' : 's'} still open — set waive_remaining:true with a reason to continue.`,
            code: 'EXECUTE_TASKS_INCOMPLETE',
            from_phase: fromPhase,
            to_phase: toPhase,
            open_count: row.n,
          },
          { status: 409 },
        )
      }
      // If waive_remaining=true, Zod .refine() already guaranteed body.reason
      // is present and non-empty (path: ['reason']).
    }

    // D-27: verify → done — require at least one done verify task
    if (fromPhase === 'verify' && toPhase === 'done') {
      const row = db
        .prepare(
          `
          SELECT COUNT(*) AS n FROM tasks
          WHERE project_id = ? AND workspace_id = ?
            AND gsd_phase = 'verify' AND status = 'done'
        `,
        )
        .get(projectId, workspaceId) as { n: number }
      if (row.n < 1) {
        return NextResponse.json(
          {
            error: 'At least one Verify task must be done before closing the project.',
            code: 'VERIFY_REQUIRES_ONE_DONE',
            from_phase: fromPhase,
            to_phase: toPhase,
          },
          { status: 409 },
        )
      }
    }

    // Commit transition — always update updated_at alongside gsd_updated_at (Pitfall 4)
    db.prepare(
      `
      UPDATE projects
      SET gsd_phase = ?, gsd_updated_at = unixepoch(), updated_at = unixepoch()
      WHERE id = ? AND workspace_id = ?
    `,
    ).run(toPhase, projectId, workspaceId)

    db_helpers.logActivity(
      'project_gsd_transition',
      'project',
      projectId,
      auth.user.username,
      `${fromPhase} → ${toPhase}${body.waive_remaining ? ' (waived)' : ''}`,
      {
        from_phase: fromPhase,
        to_phase: toPhase,
        waived: !!body.waive_remaining,
        reason: body.reason || null,
      },
      workspaceId,
    )

    eventBus.broadcast('project.gsd.transition', {
      project_id: projectId,
      from_phase: fromPhase,
      to_phase: toPhase,
      actor: auth.user.username,
      reason: body.reason || null,
      waived: !!body.waive_remaining,
      workspace_id: workspaceId,
    })

    const updated = db
      .prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`)
      .get(projectId, workspaceId)

    return NextResponse.json({
      project: updated,
      from_phase: fromPhase,
      to_phase: toPhase,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as any).status ?? 403 },
      )
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/gsd/transition error')
    return NextResponse.json({ error: 'Transition failed' }, { status: 500 })
  }
}
