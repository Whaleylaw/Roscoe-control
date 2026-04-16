import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getScopedProject, parseStrictId } from '@/lib/gsd-hierarchy'
import { getWaveConflictsForProject } from '@/lib/gsd-conflicts'

type WorkstreamRow = Record<string, unknown>
type MilestoneRow = Record<string, unknown>
type PhaseRow = Record<string, unknown>
type PlanRow = Record<string, unknown>

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
      route: '/api/projects/[id]/gsd/lifecycle-graph',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseStrictId(id)
    if (projectId == null) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    }

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const workstreams = db
      .prepare(`SELECT * FROM gsd_workstreams WHERE project_id = ? ORDER BY created_at ASC, id ASC`)
      .all(projectId) as WorkstreamRow[]
    const milestones = db
      .prepare(`SELECT * FROM gsd_milestones WHERE project_id = ? ORDER BY created_at ASC, id ASC`)
      .all(projectId) as MilestoneRow[]

    const milestoneIds = milestones.map((m) => Number(m.id))
    const phases = milestoneIds.length === 0
      ? []
      : db.prepare(
          `SELECT * FROM gsd_phases WHERE milestone_id IN (${milestoneIds.map(() => '?').join(',')})
           ORDER BY ordering_numeric ASC, id ASC`,
        ).all(...milestoneIds) as PhaseRow[]

    const phaseIds = phases.map((p) => Number(p.id))
    const plans = phaseIds.length === 0
      ? []
      : db.prepare(
          `SELECT * FROM gsd_plans WHERE phase_id IN (${phaseIds.map(() => '?').join(',')})
           ORDER BY wave ASC, created_at ASC, id ASC`,
        ).all(...phaseIds) as PlanRow[]

    const blockedGateRow = db.prepare(
      `SELECT COUNT(*) as n
       FROM tasks
       WHERE project_id = ?
         AND gate_required = 1
         AND gate_status != 'approved'`,
    ).get(projectId) as { n: number }

    const phaseNodesByMilestone = new Map<number, Array<PhaseRow & { plans: PlanRow[] }>>()
    for (const phase of phases) {
      phaseNodesByMilestone.set(Number(phase.milestone_id), [
        ...(phaseNodesByMilestone.get(Number(phase.milestone_id)) ?? []),
        {
          ...phase,
          plans: plans.filter((plan) => Number(plan.phase_id) === Number(phase.id)),
        },
      ])
    }

    const milestoneNodes: Array<MilestoneRow & { phases: Array<PhaseRow & { plans: PlanRow[] }> }> = milestones.map((milestone) => ({
      ...milestone,
      phases: phaseNodesByMilestone.get(Number(milestone.id)) ?? [],
    }))

    const milestonesByWorkstream = new Map<number, typeof milestoneNodes>()
    const unscopedMilestones: typeof milestoneNodes = []
    for (const milestone of milestoneNodes) {
      const workstreamId = milestone.workstream_id == null ? null : Number(milestone.workstream_id)
      if (workstreamId == null) {
        unscopedMilestones.push(milestone)
        continue
      }
      milestonesByWorkstream.set(workstreamId, [
        ...(milestonesByWorkstream.get(workstreamId) ?? []),
        milestone,
      ])
    }

    const graphWorkstreams = workstreams.map((workstream) => ({
      ...workstream,
      milestones: milestonesByWorkstream.get(Number(workstream.id)) ?? [],
    }))

    const legacyProject = db.prepare(
      `SELECT id, name, slug, gsd_enabled, gsd_track, gsd_phase, gsd_gate_mode, gsd_project_id, gsd_updated_at
       FROM projects WHERE id = ? AND workspace_id = ?`,
    ).get(projectId, workspaceId) as Record<string, unknown>

    const legacyTaskCounts = db.prepare(
      `SELECT COALESCE(gsd_phase, 'unassigned') AS phase, COUNT(*) AS count
       FROM tasks
       WHERE project_id = ?
       GROUP BY COALESCE(gsd_phase, 'unassigned')
       ORDER BY phase ASC`,
    ).all(projectId) as Array<{ phase: string; count: number }>

    const waveConflicts = getWaveConflictsForProject(db, projectId)

    const rollups = {
      active_workstreams: workstreams.filter((w) => w.status === 'active').length,
      active_milestones: milestones.filter((m) => m.status === 'active').length,
      active_phases: phases.filter((p) => p.status === 'active').length,
      in_progress_plans: plans.filter((p) => p.status === 'in_progress').length,
      blocked_gates: blockedGateRow.n,
      wave_conflicts: waveConflicts.length,
    }
    const legacyEnabled =
      legacyTaskCounts.some((row) => row.phase !== 'unassigned' && Number(row.count) > 0)

    return NextResponse.json({
      project: legacyProject,
      rollups,
      workstreams: graphWorkstreams,
      unscopedMilestones,
      legacy: {
        enabled: legacyEnabled,
        current_phase: legacyProject.gsd_phase ?? 'discuss',
        track: legacyProject.gsd_track ?? null,
        gate_mode: legacyProject.gsd_gate_mode ?? null,
        task_counts: legacyTaskCounts,
        fallback_active: legacyEnabled && workstreams.length === 0 && milestones.length === 0,
      },
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/gsd/lifecycle-graph error')
    return NextResponse.json({ error: 'Failed to build lifecycle graph' }, { status: 500 })
  }
}
