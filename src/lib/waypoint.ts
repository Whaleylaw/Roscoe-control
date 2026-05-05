import type Database from 'better-sqlite3'
import {
  buildWaypointRouteKey as buildWaypointRouteKeyFromCore,
  isWaypointSubjectType as isWaypointSubjectTypeFromCore,
  normalizeWaypointScope as normalizeWaypointScopeFromCore,
  type NormalizeWaypointScopeInput,
  type WaypointScope,
} from '@waypoint/core'
import { startWorkflowInstance } from './workflow-engine'

export const WAYPOINT_SUBJECT_TYPES = {
  project: 'waypoint_project',
  workstream: 'waypoint_workstream',
  milestone: 'waypoint_milestone',
  phase: 'waypoint_phase',
  plan: 'waypoint_plan',
} as const

export const WAYPOINT_COMPAT_SUBJECT_TYPES = {
  project: 'gsd_project',
  workstream: 'gsd_workstream',
  milestone: 'gsd_milestone',
  phase: 'gsd_phase',
  plan: 'gsd_plan',
} as const

export type WaypointSubjectType =
  | (typeof WAYPOINT_SUBJECT_TYPES)[keyof typeof WAYPOINT_SUBJECT_TYPES]
  | (typeof WAYPOINT_COMPAT_SUBJECT_TYPES)[keyof typeof WAYPOINT_COMPAT_SUBJECT_TYPES]

export interface BuildWaypointRouteKeyInput {
  subjectType: WaypointSubjectType
  subjectId: string | number
  definitionSlug: string
  definitionVersion: string | number
}

export type { NormalizeWaypointScopeInput, WaypointScope } from '@waypoint/core'

export interface GetWaypointStatusInput {
  projectId: number
  workspaceId: number
}

export interface StartOrReuseWaypointRouteInput {
  workspaceId: number
  tenantId?: number
  actor: string
  projectId: number
  subjectType: WaypointSubjectType
  subjectId: string | number
  definitionSlug: string
  definitionVersion: number
  vars?: Record<string, unknown>
  now?: number
}

export interface StartOrReuseWaypointRouteResult {
  instanceId: number
  reused: boolean
}

export interface WaypointStatusReadModel {
  project: { id: number; name: string; waypoint_enabled: boolean }
  lifecycle: {
    workstreams: Array<Record<string, unknown>>
    milestones: Array<Record<string, unknown>>
    active_phase: Record<string, unknown> | null
    active_plan: Record<string, unknown> | null
    blocked_gates: Array<Record<string, unknown>>
  }
  routes: Array<{
    workflow_instance_id: number
    definition_slug: string
    subject_type: string
    subject_id: string
    status: string
    nodes: Array<Record<string, unknown>>
  }>
  tasks: {
    active: Array<Record<string, unknown>>
    waiting_on_gate: Array<Record<string, unknown>>
    failed: Array<Record<string, unknown>>
  }
  next_actions: string[]
}

export function isWaypointSubjectType(value: string): value is WaypointSubjectType {
  return isWaypointSubjectTypeFromCore(value)
}

export function buildWaypointRouteKey(input: BuildWaypointRouteKeyInput): string {
  return buildWaypointRouteKeyFromCore(input)
}

export function normalizeWaypointScope(input: NormalizeWaypointScopeInput): WaypointScope {
  return normalizeWaypointScopeFromCore(input)
}

export function startOrReuseWaypointRoute(
  db: Database.Database,
  input: StartOrReuseWaypointRouteInput,
): StartOrReuseWaypointRouteResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const project = db.prepare(`
    SELECT id, COALESCE(gsd_enabled, 0) AS gsd_enabled
    FROM projects
    WHERE id = ? AND workspace_id = ? AND status = 'active'
    LIMIT 1
  `).get(input.projectId, input.workspaceId) as { id: number; gsd_enabled: number } | undefined

  if (!project) {
    throw new Error(`Project ${input.projectId} not found in workspace ${input.workspaceId}`)
  }
  if (!project.gsd_enabled) {
    throw new Error(`Waypoint lifecycle is not enabled for project ${input.projectId}`)
  }

  const definition = db.prepare(`
    SELECT id, version
    FROM workflow_definitions
    WHERE workspace_id = ? AND slug = ? AND version = ? AND status = 'active'
    ORDER BY id DESC
    LIMIT 1
  `).get(input.workspaceId, input.definitionSlug, input.definitionVersion) as { id: number; version: number } | undefined
  if (!definition) {
    throw new Error(`Workflow definition not found: ${input.definitionSlug} v${input.definitionVersion}`)
  }

  const workflowKey = buildWaypointRouteKey({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    definitionSlug: input.definitionSlug,
    definitionVersion: definition.version,
  })

  const existing = db.prepare(`
    SELECT id
    FROM workflow_instances
    WHERE workspace_id = ?
      AND workflow_key = ?
      AND status IN ('active', 'blocked')
    ORDER BY id DESC
    LIMIT 1
  `).get(input.workspaceId, workflowKey) as { id: number } | undefined

  if (existing) {
    return { instanceId: existing.id, reused: true }
  }

  const created = startWorkflowInstance(db, {
    definitionId: definition.id,
    subjectType: input.subjectType,
    subjectId: String(input.subjectId),
    workflowKey,
    actor: input.actor,
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
    vars: input.vars,
    now,
  })

  return { instanceId: created.instance_id, reused: false }
}

export function getWaypointStatus(db: Database.Database, input: GetWaypointStatusInput): WaypointStatusReadModel {
  const project = db.prepare(`
    SELECT id, name, COALESCE(gsd_enabled, 0) AS gsd_enabled
    FROM projects
    WHERE id = ? AND workspace_id = ? AND status = 'active'
    LIMIT 1
  `).get(input.projectId, input.workspaceId) as { id: number; name: string; gsd_enabled: number } | undefined

  if (!project) throw new Error(`Project ${input.projectId} not found in workspace ${input.workspaceId}`)

  const workstreams = db.prepare(`
    SELECT id, project_id, key, name, status, created_at, updated_at
    FROM gsd_workstreams
    WHERE project_id = ?
    ORDER BY id ASC
  `).all(input.projectId) as Array<Record<string, unknown>>

  const milestones = db.prepare(`
    SELECT id, project_id, workstream_id, version_label, title, status, started_at, completed_at, created_at, updated_at
    FROM gsd_milestones
    WHERE project_id = ?
    ORDER BY id ASC
  `).all(input.projectId) as Array<Record<string, unknown>>

  const activePhase = db.prepare(`
    SELECT gp.*
    FROM gsd_phases gp
    JOIN gsd_milestones gm ON gm.id = gp.milestone_id
    WHERE gm.project_id = ? AND gp.status = 'active'
    ORDER BY gp.ordering_numeric ASC, gp.id ASC
    LIMIT 1
  `).get(input.projectId) as Record<string, unknown> | undefined

  const activePlan = db.prepare(`
    SELECT gpl.*
    FROM gsd_plans gpl
    JOIN gsd_phases gp ON gp.id = gpl.phase_id
    JOIN gsd_milestones gm ON gm.id = gp.milestone_id
    WHERE gm.project_id = ? AND gpl.status IN ('in_progress', 'review')
    ORDER BY gpl.wave ASC, gpl.id ASC
    LIMIT 1
  `).get(input.projectId) as Record<string, unknown> | undefined

  const routeRows = db.prepare(`
    SELECT wi.id AS workflow_instance_id, wd.slug AS definition_slug, wi.subject_type, wi.subject_id, wi.status
    FROM workflow_instances wi
    JOIN workflow_definitions wd ON wd.id = wi.definition_id
    WHERE wi.workspace_id = ?
      AND wi.subject_type IN ('waypoint_project', 'waypoint_workstream', 'waypoint_milestone', 'waypoint_phase', 'waypoint_plan', 'gsd_project', 'gsd_workstream', 'gsd_milestone', 'gsd_phase', 'gsd_plan')
      AND (
        wi.subject_type IN ('waypoint_project', 'gsd_project') AND wi.subject_id = ?
        OR json_extract(wi.vars_json, '$.project_id') = ?
      )
    ORDER BY wi.id ASC
  `).all(input.workspaceId, String(input.projectId), input.projectId) as Array<{
    workflow_instance_id: number
    definition_slug: string
    subject_type: string
    subject_id: string
    status: string
  }>

  const nodesByInstance = new Map<number, Array<Record<string, unknown>>>()
  if (routeRows.length > 0) {
    const placeholders = routeRows.map(() => '?').join(',')
    const nodes = db.prepare(`
      SELECT workflow_instance_id, id, node_key, node_type, status, task_id, recipe_slug, started_at, completed_at
      FROM workflow_node_instances
      WHERE workflow_instance_id IN (${placeholders})
      ORDER BY id ASC
    `).all(...routeRows.map((row) => row.workflow_instance_id)) as Array<Record<string, unknown> & { workflow_instance_id: number }>
    for (const node of nodes) {
      const list = nodesByInstance.get(node.workflow_instance_id) ?? []
      list.push(node)
      nodesByInstance.set(node.workflow_instance_id, list)
    }
  }

  const routes = routeRows.map((route) => ({
    ...route,
    nodes: nodesByInstance.get(route.workflow_instance_id) ?? [],
  }))

  const activeTasks = db.prepare(`
    SELECT id, title, status, project_id, gsd_workstream_id, gsd_milestone_id, gsd_phase_id, gsd_plan_id, gate_required, gate_status
    FROM tasks
    WHERE workspace_id = ? AND project_id = ?
      AND status NOT IN ('done', 'cancelled', 'archived')
      AND COALESCE(gate_status, '') NOT IN ('pending')
    ORDER BY id ASC
  `).all(input.workspaceId, input.projectId) as Array<Record<string, unknown>>

  const waitingOnGate = db.prepare(`
    SELECT id, title, status, project_id, gsd_workstream_id, gsd_milestone_id, gsd_phase_id, gsd_plan_id, gate_required, gate_status
    FROM tasks
    WHERE workspace_id = ? AND project_id = ?
      AND gate_status = 'pending'
    ORDER BY id ASC
  `).all(input.workspaceId, input.projectId) as Array<Record<string, unknown>>

  const failedTasks = db.prepare(`
    SELECT id, title, status, project_id, gsd_workstream_id, gsd_milestone_id, gsd_phase_id, gsd_plan_id, gate_required, gate_status
    FROM tasks
    WHERE workspace_id = ? AND project_id = ?
      AND status = 'failed'
    ORDER BY id ASC
  `).all(input.workspaceId, input.projectId) as Array<Record<string, unknown>>

  const nextActions: string[] = []
  if (!project.gsd_enabled) nextActions.push('Enable Waypoint lifecycle for this project.')
  if (waitingOnGate.length > 0) nextActions.push('Review pending Waypoint gates.')
  if (activeTasks.length > 0) nextActions.push('Continue active Waypoint tasks or wait for their completion.')
  if (routes.length === 0 && project.gsd_enabled) nextActions.push('Start a Waypoint route for the next lifecycle objective.')

  return {
    project: { id: project.id, name: project.name, waypoint_enabled: Boolean(project.gsd_enabled) },
    lifecycle: {
      workstreams,
      milestones,
      active_phase: activePhase ?? null,
      active_plan: activePlan ?? null,
      blocked_gates: waitingOnGate,
    },
    routes,
    tasks: {
      active: activeTasks,
      waiting_on_gate: waitingOnGate,
      failed: failedTasks,
    },
    next_actions: nextActions,
  }
}
