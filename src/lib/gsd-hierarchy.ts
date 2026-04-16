import type Database from 'better-sqlite3'
import type { GsdLifecyclePhase, GsdPlanStatus } from './db'

export const NEXT_GSD_LIFECYCLE_PHASE: Record<GsdLifecyclePhase, GsdLifecyclePhase | null> = {
  discuss: 'plan',
  plan: 'execute',
  execute: 'verify',
  verify: 'done',
  done: null,
}

export function canTransitionGsdLifecycle(
  fromPhase: GsdLifecyclePhase,
  toPhase: GsdLifecyclePhase,
): boolean {
  return fromPhase !== toPhase && NEXT_GSD_LIFECYCLE_PHASE[fromPhase] === toPhase
}

export const NEXT_GSD_PLAN_STATUSES: Record<GsdPlanStatus, readonly GsdPlanStatus[]> = {
  todo: ['in_progress'],
  in_progress: ['review', 'done', 'failed'],
  review: ['in_progress', 'done', 'failed'],
  done: [],
  failed: ['todo', 'in_progress'],
}

export function canTransitionGsdPlanStatus(
  fromStatus: GsdPlanStatus,
  toStatus: GsdPlanStatus,
): boolean {
  return fromStatus !== toStatus && NEXT_GSD_PLAN_STATUSES[fromStatus].includes(toStatus)
}

export function serializeDependencyIds(ids: number[] | null | undefined): string {
  if (!ids || ids.length === 0) return '[]'
  const uniqueSorted = Array.from(new Set(ids)).sort((a, b) => a - b)
  return JSON.stringify(uniqueSorted)
}

export function parseDependencyIds(raw: string | null | undefined): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is number => Number.isInteger(v) && v > 0)
  } catch {
    return []
  }
}

export function optimisticLockMatches(
  actualUpdatedAt: number | null | undefined,
  expectedUpdatedAt: number | null | undefined,
): boolean {
  if (expectedUpdatedAt == null) return true
  return Number(actualUpdatedAt ?? 0) === Number(expectedUpdatedAt)
}

export function makeHierarchyIdempotencyKey(
  parts: Array<string | number | null | undefined>,
): string {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(':')
    .toLowerCase()
}

export function parseStrictId(raw: string): number | null {
  const id = Number.parseInt(raw, 10)
  if (!Number.isFinite(id) || String(id) !== raw.trim()) return null
  return id
}

export function getScopedProject(
  db: Database.Database,
  projectId: number,
  workspaceId: number,
): { id: number; workspace_id: number } | undefined {
  return db
    .prepare(`SELECT id, workspace_id FROM projects WHERE id = ? AND workspace_id = ?`)
    .get(projectId, workspaceId) as { id: number; workspace_id: number } | undefined
}

export function getScopedWorkstream(
  db: Database.Database,
  projectId: number,
  workstreamId: number,
): Record<string, unknown> | undefined {
  return db
    .prepare(`SELECT * FROM gsd_workstreams WHERE id = ? AND project_id = ?`)
    .get(workstreamId, projectId) as Record<string, unknown> | undefined
}

export function getScopedMilestone(
  db: Database.Database,
  projectId: number,
  milestoneId: number,
): Record<string, unknown> | undefined {
  return db
    .prepare(`SELECT * FROM gsd_milestones WHERE id = ? AND project_id = ?`)
    .get(milestoneId, projectId) as Record<string, unknown> | undefined
}

export function getMilestoneInWorkspace(
  db: Database.Database,
  milestoneId: number,
  workspaceId: number,
): Record<string, unknown> | undefined {
  return db
    .prepare(
      `SELECT m.*
       FROM gsd_milestones m
       JOIN projects p ON p.id = m.project_id
       WHERE m.id = ? AND p.workspace_id = ?`,
    )
    .get(milestoneId, workspaceId) as Record<string, unknown> | undefined
}

export function getPhaseInWorkspace(
  db: Database.Database,
  phaseId: number,
  workspaceId: number,
): Record<string, unknown> | undefined {
  return db
    .prepare(
      `SELECT ph.*, m.project_id
       FROM gsd_phases ph
       JOIN gsd_milestones m ON m.id = ph.milestone_id
       JOIN projects p ON p.id = m.project_id
       WHERE ph.id = ? AND p.workspace_id = ?`,
    )
    .get(phaseId, workspaceId) as Record<string, unknown> | undefined
}

export function getPlanInWorkspace(
  db: Database.Database,
  planId: number,
  workspaceId: number,
): Record<string, unknown> | undefined {
  return db
    .prepare(
      `SELECT pl.*, ph.milestone_id, m.project_id
       FROM gsd_plans pl
       JOIN gsd_phases ph ON ph.id = pl.phase_id
       JOIN gsd_milestones m ON m.id = ph.milestone_id
       JOIN projects p ON p.id = m.project_id
       WHERE pl.id = ? AND p.workspace_id = ?`,
    )
    .get(planId, workspaceId) as Record<string, unknown> | undefined
}

export function getBlockingGateTaskIdsForPhase(
  db: Database.Database,
  phaseId: number,
): number[] {
  const rows = db
    .prepare(
      `SELECT id
       FROM tasks
       WHERE gsd_phase_id = ?
         AND gate_required = 1
         AND gate_status != 'approved'
       ORDER BY id ASC`,
    )
    .all(phaseId) as Array<{ id: number }>

  return rows.map((row) => row.id)
}

export function getBlockingGateTaskIdsForPlan(
  db: Database.Database,
  planId: number,
): number[] {
  const rows = db
    .prepare(
      `SELECT id
       FROM tasks
       WHERE gsd_plan_id = ?
         AND gate_required = 1
         AND gate_status != 'approved'
       ORDER BY id ASC`,
    )
    .all(planId) as Array<{ id: number }>

  return rows.map((row) => row.id)
}
