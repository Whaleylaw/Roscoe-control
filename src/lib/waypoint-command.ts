import type Database from 'better-sqlite3'
import { runWaypointAutopilot } from './waypoint-autopilot'
import { getWaypointStatus, startOrReuseWaypointRoute, WAYPOINT_SUBJECT_TYPES } from './waypoint'
import { listTaskDiscussion, postTaskDiscussionMessage, startTaskDiscussion } from './waypoint-task-discussion'

export type WaypointCommandName = 'status' | 'start' | 'auto' | 'discuss' | 'help'

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
        'Commands: /waypoint status | /waypoint start plan --plan-id <id> [--definition waypoint-plan-execution] [--version 1] | /waypoint auto [--max-iterations N] | /waypoint discuss --task-id <id> [--message <text>] | /waypoint help',
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
