import type Database from 'better-sqlite3'
import { advanceDueWorkflowTimers, materializeReadyWorkflowNodes } from './workflow-engine'
import { getWaypointStatus } from './waypoint'

export type WaypointAutopilotStopReason = 'pending_gate' | 'blocked' | 'no_progress' | 'max_iterations'

export interface RunWaypointAutopilotInput {
  projectId: number
  workspaceId: number
  actor: string
  maxIterations?: number
  now?: number
  deps?: Partial<WaypointAutopilotDeps>
}

export interface RunWaypointAutopilotResult {
  iterations: number
  changed: boolean
  stopReason: WaypointAutopilotStopReason
  nextActions: string[]
  timerCompletions: number
  materializedTasks: number
  routesTouched: number
  startedAt: number
  completedAt: number
}

interface WaypointAutopilotRoute {
  workflow_instance_id: number
  status?: string
}

interface WaypointAutopilotStatus {
  next_actions: string[]
  tasks: { waiting_on_gate: Array<Record<string, unknown>> }
  routes: WaypointAutopilotRoute[]
}

interface WaypointAutopilotDeps {
  getStatus: (db: Database.Database, input: { projectId: number; workspaceId: number }) => WaypointAutopilotStatus
  advanceTimers: (db: Database.Database, input: { workspaceId: number; actor: string; now?: number }) => { completed: unknown[] }
  materializeRoute: (
    db: Database.Database,
    input: { workflowInstanceId: number; projectId: number; workspaceId: number; actor: string; now?: number },
  ) => { created: unknown[] }
}

const defaultDeps: WaypointAutopilotDeps = {
  getStatus: (db, input) => getWaypointStatus(db, input),
  advanceTimers: (db, input) => advanceDueWorkflowTimers(db, input),
  materializeRoute: (db, input) => materializeReadyWorkflowNodes(db, input),
}

function hasProgress(timerCompleted: unknown[], createdCounts: number[]): boolean {
  if (timerCompleted.length > 0) return true
  return createdCounts.some((count) => count > 0)
}

export function runWaypointAutopilot(
  db: Database.Database,
  input: RunWaypointAutopilotInput,
): RunWaypointAutopilotResult {
  const maxIterations = Math.max(1, Math.min(input.maxIterations ?? 1, 100))
  const deps: WaypointAutopilotDeps = { ...defaultDeps, ...(input.deps ?? {}) }

  const startedAt = Math.floor(Date.now() / 1000)
  let iterations = 0
  let changed = false
  let stopReason: WaypointAutopilotStopReason = 'max_iterations'
  let nextActions: string[] = []
  let timerCompletions = 0
  let materializedTasks = 0
  let routesTouched = 0

  for (let index = 0; index < maxIterations; index += 1) {
    iterations += 1

    const status = deps.getStatus(db, {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
    })
    nextActions = status.next_actions

    if (status.routes.some((route) => ['blocked', 'failed', 'cancelled'].includes(route.status ?? ''))) {
      stopReason = 'blocked'
      break
    }

    const timerResult = deps.advanceTimers(db, {
      workspaceId: input.workspaceId,
      actor: input.actor,
      now: input.now,
    })
    timerCompletions += timerResult.completed.length

    const createdCounts: number[] = []
    routesTouched += status.routes.length
    for (const route of status.routes) {
      const materialized = deps.materializeRoute(db, {
        workflowInstanceId: route.workflow_instance_id,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        actor: input.actor,
        now: input.now,
      })
      createdCounts.push(materialized.created.length)
      materializedTasks += materialized.created.length
    }

    const progressed = hasProgress(timerResult.completed, createdCounts)
    changed = changed || progressed

    if ((status.tasks.waiting_on_gate ?? []).length > 0) {
      stopReason = 'pending_gate'
      break
    }

    if (!progressed) {
      stopReason = 'no_progress'
      break
    }

    if (iterations === maxIterations) {
      stopReason = 'max_iterations'
      break
    }
  }

  const completedAt = Math.floor(Date.now() / 1000)
  const result: RunWaypointAutopilotResult = {
    iterations,
    changed,
    stopReason,
    nextActions,
    timerCompletions,
    materializedTasks,
    routesTouched,
    startedAt,
    completedAt,
  }

  try {
    const statusAfter = deps.getStatus(db, {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
    })
    const anchorRouteId = statusAfter.routes[0]?.workflow_instance_id

    if (anchorRouteId) {
      db.prepare(`
        INSERT INTO workflow_events (workflow_instance_id, node_instance_id, task_id, node_key, event_type, actor_type, actor_id, payload_json, workspace_id, created_at)
        VALUES (?, NULL, NULL, NULL, 'waypoint.autopilot.run', 'human', ?, ?, ?, ?)
      `).run(
        anchorRouteId,
        input.actor,
        JSON.stringify({ project_id: input.projectId, workspace_id: input.workspaceId, ...result }),
        input.workspaceId,
        completedAt,
      )
    }
  } catch {
    // best-effort telemetry only
  }

  return result
}
