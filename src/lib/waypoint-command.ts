import type Database from 'better-sqlite3'
import { runWaypointAutopilot } from './waypoint-autopilot'
import { getWaypointStatus, startOrReuseWaypointRoute, WAYPOINT_SUBJECT_TYPES } from './waypoint'
import { listTaskDiscussion, postTaskDiscussionMessage, startTaskDiscussion } from './waypoint-task-discussion'

export type WaypointCommandName =
  | 'status'
  | 'start'
  | 'auto'
  | 'discuss'
  | 'doctor'
  | 'forensics'
  | 'routes'
  | 'pause'
  | 'resume'
  | 'help'

export type WaypointParsedCommand =
  | { name: 'status' }
  | {
      name: 'start'
      target: 'plan'
      planId: number
      definitionSlug: string
      definitionVersion: number
    }
  | { name: 'auto'; maxIterations?: number }
  | { name: 'discuss'; taskId: number; message?: string }
  | { name: 'doctor'; definitionSlug: string; definitionVersion: number }
  | { name: 'forensics'; definitionSlug: string; definitionVersion: number }
  | { name: 'routes'; status?: 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed' }
  | { name: 'pause'; routeId: number }
  | { name: 'resume'; routeId: number }
  | { name: 'help' }

export interface ExecuteWaypointCommandInput {
  db: Database.Database
  workspaceId: number
  tenantId?: number
  projectId: number
  actor: string
  rawCommand: string
}

function asPositiveInt(value: string | undefined): number | null {
  if (!value) return null
  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function tokenize(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

function stripPrefix(tokens: string[]): string[] {
  if (tokens.length === 0) return tokens
  const first = tokens[0].toLowerCase()
  if (first === '/waypoint' || first === 'waypoint' || first === '/wp' || first === 'wp') {
    return tokens.slice(1)
  }
  return tokens
}

export function parseWaypointCommand(rawCommand: string): WaypointParsedCommand {
  const tokens = stripPrefix(tokenize(rawCommand))
  if (tokens.length === 0) return { name: 'help' }

  const head = tokens[0].toLowerCase()
  if (head === 'status') return { name: 'status' }
  if (head === 'help') return { name: 'help' }

  if (head === 'auto') {
    const idx = tokens.findIndex((t) => t === '--max-iterations')
    if (idx >= 0) {
      const parsed = asPositiveInt(tokens[idx + 1])
      if (parsed == null) throw new Error('Invalid --max-iterations value')
      return { name: 'auto', maxIterations: parsed }
    }
    return { name: 'auto' }
  }

  if (head === 'discuss') {
    const taskFlagIdx = tokens.findIndex((t) => t === '--task-id')
    const taskId = asPositiveInt(tokens[taskFlagIdx + 1])
    if (taskFlagIdx < 0 || taskId == null) throw new Error('Missing or invalid --task-id')

    const messageFlagIdx = tokens.findIndex((t) => t === '--message')
    if (messageFlagIdx >= 0) {
      const message = tokens.slice(messageFlagIdx + 1).join(' ').trim()
      if (!message) throw new Error('Invalid --message value')
      return { name: 'discuss', taskId, message }
    }

    return { name: 'discuss', taskId }
  }

  if (head === 'routes') {
    const statusFlagIdx = tokens.findIndex((t) => t === '--status')
    if (statusFlagIdx >= 0) {
      const status = (tokens[statusFlagIdx + 1] || '').toLowerCase()
      if (!['active', 'blocked', 'complete', 'cancelled', 'failed'].includes(status)) {
        throw new Error('Invalid --status value')
      }
      return { name: 'routes', status: status as 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed' }
    }
    return { name: 'routes' }
  }

  if (head === 'pause') {
    const routeFlagIdx = tokens.findIndex((t) => t === '--route-id')
    const routeId = asPositiveInt(tokens[routeFlagIdx + 1])
    if (routeFlagIdx < 0 || routeId == null) throw new Error('Missing or invalid --route-id')
    return { name: 'pause', routeId }
  }

  if (head === 'resume') {
    const routeFlagIdx = tokens.findIndex((t) => t === '--route-id')
    const routeId = asPositiveInt(tokens[routeFlagIdx + 1])
    if (routeFlagIdx < 0 || routeId == null) throw new Error('Missing or invalid --route-id')
    return { name: 'resume', routeId }
  }

  if (head === 'doctor') {
    const defFlagIdx = tokens.findIndex((t) => t === '--definition')
    const definitionSlug = defFlagIdx >= 0 ? tokens[defFlagIdx + 1] : 'waypoint-doctor'
    if (!definitionSlug) throw new Error('Invalid --definition value')

    const versionFlagIdx = tokens.findIndex((t) => t === '--version')
    const definitionVersion = versionFlagIdx >= 0 ? asPositiveInt(tokens[versionFlagIdx + 1]) : 1
    if (definitionVersion == null) throw new Error('Invalid --version value')

    return { name: 'doctor', definitionSlug, definitionVersion }
  }

  if (head === 'forensics') {
    const defFlagIdx = tokens.findIndex((t) => t === '--definition')
    const definitionSlug = defFlagIdx >= 0 ? tokens[defFlagIdx + 1] : 'waypoint-forensics'
    if (!definitionSlug) throw new Error('Invalid --definition value')

    const versionFlagIdx = tokens.findIndex((t) => t === '--version')
    const definitionVersion = versionFlagIdx >= 0 ? asPositiveInt(tokens[versionFlagIdx + 1]) : 1
    if (definitionVersion == null) throw new Error('Invalid --version value')

    return { name: 'forensics', definitionSlug, definitionVersion }
  }

  if (head === 'start') {
    const target = (tokens[1] || '').toLowerCase()
    if (target !== 'plan') throw new Error('Only `start plan` is currently supported')

    const planFlagIdx = tokens.findIndex((t) => t === '--plan-id')
    const planId = asPositiveInt(tokens[planFlagIdx + 1])
    if (planFlagIdx < 0 || planId == null) throw new Error('Missing or invalid --plan-id')

    const defFlagIdx = tokens.findIndex((t) => t === '--definition')
    const definitionSlug = defFlagIdx >= 0 ? tokens[defFlagIdx + 1] : 'waypoint-plan-execution'
    if (!definitionSlug) throw new Error('Invalid --definition value')

    const versionFlagIdx = tokens.findIndex((t) => t === '--version')
    const definitionVersion = versionFlagIdx >= 0 ? asPositiveInt(tokens[versionFlagIdx + 1]) : 1
    if (definitionVersion == null) throw new Error('Invalid --version value')

    return {
      name: 'start',
      target: 'plan',
      planId,
      definitionSlug,
      definitionVersion,
    }
  }

  throw new Error(`Unknown Waypoint command: ${head}`)
}

export interface ResolveWaypointPlanRouteScopeInput {
  workspaceId: number
  projectId: number
  planId: number
}

export interface ResolvedWaypointPlanRouteScope {
  projectId: number
  workstreamId: number | null
  milestoneId: number
  phaseId: number
  planId: number
  objective: string
}

export interface WaypointRouteSummary {
  id: number
  workflow_key: string
  subject_type: string
  subject_id: string
  status: 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'
  definition_slug: string
  definition_name: string
  definition_version: number
  started_at: number
  completed_at: number | null
  updated_at: number
}

function listWaypointRoutes(
  db: Database.Database,
  input: { workspaceId: number; projectId: number; status?: 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed' },
): WaypointRouteSummary[] {
  const where: string[] = ['wi.workspace_id = ?', "json_extract(wi.vars_json, '$.project_id') = ?"]
  const params: Array<number | string> = [input.workspaceId, input.projectId]
  if (input.status) {
    where.push('wi.status = ?')
    params.push(input.status)
  }

  const rows = db
    .prepare(
      `
    SELECT
      wi.id,
      wi.workflow_key,
      wi.subject_type,
      wi.subject_id,
      wi.status,
      wd.slug AS definition_slug,
      wd.name AS definition_name,
      wd.version AS definition_version,
      wi.started_at,
      wi.completed_at,
      wi.updated_at
    FROM workflow_instances wi
    JOIN workflow_definitions wd ON wd.id = wi.definition_id
    WHERE ${where.join(' AND ')}
      AND wi.subject_type IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ORDER BY wi.updated_at DESC, wi.id DESC
    LIMIT 200
  `,
    )
    .all(
      ...params,
      WAYPOINT_SUBJECT_TYPES.project,
      WAYPOINT_SUBJECT_TYPES.workstream,
      WAYPOINT_SUBJECT_TYPES.milestone,
      WAYPOINT_SUBJECT_TYPES.phase,
      WAYPOINT_SUBJECT_TYPES.plan,
      'gsd_project',
      'gsd_workstream',
      'gsd_milestone',
      'gsd_phase',
      'gsd_plan',
    ) as WaypointRouteSummary[]

  return rows
}

function setWaypointRoutePausedState(
  db: Database.Database,
  input: {
    workspaceId: number
    projectId: number
    routeId: number
    actor: string
    action: 'pause' | 'resume'
  },
) {
  const row = db
    .prepare(
      `
    SELECT wi.id, wi.status, wi.subject_type
    FROM workflow_instances wi
    WHERE wi.id = ?
      AND wi.workspace_id = ?
      AND json_extract(wi.vars_json, '$.project_id') = ?
    LIMIT 1
  `,
    )
    .get(input.routeId, input.workspaceId, input.projectId) as
    | { id: number; status: 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'; subject_type: string }
    | undefined

  if (!row) throw new Error(`Route ${input.routeId} not found for project ${input.projectId}`)

  const now = Math.floor(Date.now() / 1000)
  if (input.action === 'pause') {
    if (row.status === 'complete' || row.status === 'cancelled' || row.status === 'failed') {
      throw new Error(`Route ${input.routeId} is terminal (${row.status}) and cannot be paused`)
    }
    if (row.status !== 'blocked') {
      db.prepare(`UPDATE workflow_instances SET status = 'blocked', updated_at = ? WHERE id = ?`).run(now, input.routeId)
      db.prepare(`
        INSERT INTO workflow_events (workflow_instance_id, node_instance_id, task_id, node_key, event_type, actor_type, actor_id, payload_json, workspace_id, created_at)
        VALUES (?, NULL, NULL, NULL, 'workflow.paused', 'human', ?, ?, ?, ?)
      `).run(input.routeId, input.actor, JSON.stringify({ reason: 'waypoint.pause' }), input.workspaceId, now)
    }
  } else {
    if (row.status === 'complete' || row.status === 'cancelled' || row.status === 'failed') {
      throw new Error(`Route ${input.routeId} is terminal (${row.status}) and cannot be resumed`)
    }
    if (row.status !== 'active') {
      db.prepare(`UPDATE workflow_instances SET status = 'active', updated_at = ? WHERE id = ?`).run(now, input.routeId)
      db.prepare(`
        INSERT INTO workflow_events (workflow_instance_id, node_instance_id, task_id, node_key, event_type, actor_type, actor_id, payload_json, workspace_id, created_at)
        VALUES (?, NULL, NULL, NULL, 'workflow.resumed', 'human', ?, ?, ?, ?)
      `).run(input.routeId, input.actor, JSON.stringify({ reason: 'waypoint.resume' }), input.workspaceId, now)
    }
  }

  return db
    .prepare(
      `SELECT id, workflow_key, status, updated_at, completed_at FROM workflow_instances WHERE id = ? LIMIT 1`,
    )
    .get(input.routeId) as {
    id: number
    workflow_key: string
    status: 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'
    updated_at: number
    completed_at: number | null
  }
}

export function resolveWaypointPlanRouteScope(
  db: Database.Database,
  input: ResolveWaypointPlanRouteScopeInput,
): ResolvedWaypointPlanRouteScope {
  const row = db
    .prepare(
      `
    SELECT
      gpl.id AS plan_id,
      gpl.title AS plan_title,
      gp.id AS phase_id,
      gm.id AS milestone_id,
      gm.workstream_id,
      gm.project_id
    FROM gsd_plans gpl
    JOIN gsd_phases gp ON gp.id = gpl.phase_id
    JOIN gsd_milestones gm ON gm.id = gp.milestone_id
    JOIN projects p ON p.id = gm.project_id
    WHERE gpl.id = ? AND gm.project_id = ? AND p.workspace_id = ? AND p.status = 'active'
    LIMIT 1
  `,
    )
    .get(input.planId, input.projectId, input.workspaceId) as
    | {
        plan_id: number
        plan_title: string
        phase_id: number
        milestone_id: number
        workstream_id: number | null
        project_id: number
      }
    | undefined

  if (!row) throw new Error(`Plan ${input.planId} not found for project ${input.projectId}`)

  return {
    projectId: row.project_id,
    workstreamId: row.workstream_id,
    milestoneId: row.milestone_id,
    phaseId: row.phase_id,
    planId: row.plan_id,
    objective: row.plan_title,
  }
}

export function executeWaypointCommand(input: ExecuteWaypointCommandInput) {
  const parsed = parseWaypointCommand(input.rawCommand)

  if (parsed.name === 'help') {
    return {
      ok: true,
      command: parsed,
      message:
        'Commands: /waypoint status | /waypoint start plan --plan-id <id> [--definition waypoint-plan-execution] [--version 1] | /waypoint auto [--max-iterations N] | /waypoint discuss --task-id <id> [--message <text>] | /waypoint routes [--status active|blocked|complete|cancelled|failed] | /waypoint pause --route-id <id> | /waypoint resume --route-id <id> | /waypoint doctor [--definition waypoint-doctor] [--version 1] | /waypoint forensics [--definition waypoint-forensics] [--version 1] | /waypoint help',
    }
  }

  if (parsed.name === 'status') {
    return {
      ok: true,
      command: parsed,
      status: getWaypointStatus(input.db, {
        projectId: input.projectId,
        workspaceId: input.workspaceId,
      }),
    }
  }

  if (parsed.name === 'auto') {
    return {
      ok: true,
      command: parsed,
      autopilot: runWaypointAutopilot(input.db, {
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        actor: input.actor,
        maxIterations: parsed.maxIterations,
      }),
    }
  }

  if (parsed.name === 'discuss') {
    const started = startTaskDiscussion(input.db, {
      taskId: parsed.taskId,
      workspaceId: input.workspaceId,
      actor: input.actor,
    })

    const posted = parsed.message
      ? postTaskDiscussionMessage(input.db, {
          taskId: parsed.taskId,
          workspaceId: input.workspaceId,
          from: input.actor,
          content: parsed.message,
        })
      : null

    const listed = listTaskDiscussion(input.db, {
      taskId: parsed.taskId,
      workspaceId: input.workspaceId,
      limit: 100,
    })

    return {
      ok: true,
      command: parsed,
      discussion: {
        task_id: started.task.id,
        conversation_id: started.discussion.conversation_id,
        agent: started.discussion.agent,
        status: started.discussion.status,
        posted_message_id: posted?.message?.id ?? null,
        message_count: listed.messages.length,
        messages: listed.messages,
      },
    }
  }

  if (parsed.name === 'start') {
    const scope = resolveWaypointPlanRouteScope(input.db, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      planId: parsed.planId,
    })
    const route = startOrReuseWaypointRoute(input.db, {
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      actor: input.actor,
      projectId: input.projectId,
      subjectType: WAYPOINT_SUBJECT_TYPES.plan,
      subjectId: parsed.planId,
      definitionSlug: parsed.definitionSlug,
      definitionVersion: parsed.definitionVersion,
      vars: {
        project_id: scope.projectId,
        workstream_id: scope.workstreamId,
        milestone_id: scope.milestoneId,
        phase_id: scope.phaseId,
        plan_id: scope.planId,
        workspace_id: input.workspaceId,
        objective: scope.objective,
      },
    })

    return {
      ok: true,
      command: parsed,
      route,
    }
  }

  if (parsed.name === 'routes') {
    const routes = listWaypointRoutes(input.db, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      status: parsed.status,
    })
    return {
      ok: true,
      command: parsed,
      routes,
      count: routes.length,
    }
  }

  if (parsed.name === 'pause' || parsed.name === 'resume') {
    const route = setWaypointRoutePausedState(input.db, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      routeId: parsed.routeId,
      actor: input.actor,
      action: parsed.name,
    })
    return {
      ok: true,
      command: parsed,
      route,
    }
  }

  if (parsed.name === 'doctor' || parsed.name === 'forensics') {
    const route = startOrReuseWaypointRoute(input.db, {
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      actor: input.actor,
      projectId: input.projectId,
      subjectType: WAYPOINT_SUBJECT_TYPES.project,
      subjectId: input.projectId,
      definitionSlug: parsed.definitionSlug,
      definitionVersion: parsed.definitionVersion,
      vars: {
        project_id: input.projectId,
        workspace_id: input.workspaceId,
        objective: parsed.name === 'doctor' ? 'Waypoint project diagnostics' : 'Waypoint project forensics',
      },
    })

    return {
      ok: true,
      command: parsed,
      route,
    }
  }

  throw new Error(`Unhandled Waypoint command: ${(parsed as { name: string }).name}`)
}
