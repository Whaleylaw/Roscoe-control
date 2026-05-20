import type Database from 'better-sqlite3'

import { completeWorkflowNodeForTask } from './workflow-engine'

export interface WaypointHumanGateInput {
  readonly taskId: number
  readonly workspaceId: number
  readonly actor: string
  readonly note?: string
  readonly now?: number
}

export type WaypointHumanGateCompletionResult =
  | {
      readonly status: 'blocked'
      readonly reason: 'human_approval_required'
      readonly taskId: number
      readonly workflowInstanceId: number | null
    }
  | {
      readonly status: 'approved'
      readonly taskId: number
      readonly workflowInstanceId: number
    }

interface GateTaskRow {
  readonly id: number
  readonly workspace_id: number
  readonly status: string
  readonly metadata: string | null
}

interface WorkflowContext {
  readonly workflowInstanceId: number | null
  readonly nodeInstanceId: number | null
  readonly nodeKey: string | null
}

type JsonMap = Record<string, unknown>

export function attemptWaypointHumanGateCompletion(
  db: Database.Database,
  input: WaypointHumanGateInput,
): WaypointHumanGateCompletionResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const task = readGateTask(db, input.taskId, input.workspaceId)
  const metadata = parseObject(task.metadata)
  const workflow = workflowContext(metadata.workflow)
  const waypoint = objectRecord(metadata.waypoint)
  const gate = objectRecord(waypoint.gate)

  const updatedMetadata = {
    ...metadata,
    waypoint: {
      ...waypoint,
      gate: {
        ...gate,
        kind: gate.kind ?? 'human',
        status: 'pending',
        required: true,
        last_attempted_at: now,
      },
      blocker: {
        status: 'blocked',
        reason: 'human_approval_required',
        resolution_input: { mode: 'approve_handoff_gate' },
        checked_at: now,
      },
    },
  }

  db.transaction(() => {
    db.prepare(`UPDATE tasks SET status = 'review', metadata = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
      .run(JSON.stringify(updatedMetadata), now, task.id, task.workspace_id)
    insertGateEvent(db, {
      task,
      workflow,
      actor: input.actor,
      eventType: 'waypoint.handoff_gate.blocked',
      payload: { status: 'blocked', reason: 'human_approval_required', note: input.note ?? null },
      now,
    })
  })()

  return { status: 'blocked', reason: 'human_approval_required', taskId: task.id, workflowInstanceId: workflow.workflowInstanceId }
}

export function approveWaypointHumanGate(
  db: Database.Database,
  input: WaypointHumanGateInput,
): WaypointHumanGateCompletionResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const task = readGateTask(db, input.taskId, input.workspaceId)
  const metadata = parseObject(task.metadata)
  const workflow = workflowContext(metadata.workflow)
  if (!workflow.workflowInstanceId) throw new Error(`Task ${task.id} is not attached to a workflow instance`)

  const waypoint = objectRecord(metadata.waypoint)
  const gate = objectRecord(waypoint.gate)
  const updatedMetadata = {
    ...metadata,
    waypoint: {
      ...waypoint,
      gate: {
        ...gate,
        kind: gate.kind ?? 'human',
        status: 'approved',
        approved_by: input.actor,
        approved_at: now,
        note: input.note ?? null,
      },
      blocker: {
        status: 'resolved',
        missing_artifacts: [],
        resolution_input: { mode: 'human_gate_approval', note: input.note ?? null },
        checked_at: now,
      },
    },
  }

  db.transaction(() => {
    db.prepare(`UPDATE tasks SET status = 'done', metadata = ?, updated_at = ?, completed_at = COALESCE(completed_at, ?) WHERE id = ? AND workspace_id = ?`)
      .run(JSON.stringify(updatedMetadata), now, now, task.id, task.workspace_id)
    insertGateEvent(db, {
      task,
      workflow,
      actor: input.actor,
      eventType: 'waypoint.handoff_gate.approved',
      payload: { status: 'approved', note: input.note ?? null },
      now,
    })
  })()

  completeWorkflowNodeForTask(db, task.id, input.actor, { status: 'approved', human_gate: true, note: input.note ?? null }, now)
  return { status: 'approved', taskId: task.id, workflowInstanceId: workflow.workflowInstanceId }
}

function readGateTask(db: Database.Database, taskId: number, workspaceId: number): GateTaskRow {
  const task = db.prepare(`SELECT id, workspace_id, status, metadata FROM tasks WHERE id = ? AND workspace_id = ? LIMIT 1`)
    .get(taskId, workspaceId) as GateTaskRow | undefined
  if (!task) throw new Error(`Task ${taskId} not found in workspace ${workspaceId}`)
  const waypoint = objectRecord(parseObject(task.metadata).waypoint)
  const execution = objectRecord(waypoint.execution)
  const gate = objectRecord(waypoint.gate)
  if (execution.kind !== 'gate' || gate.kind !== 'human') {
    throw new Error(`Task ${taskId} is not a Waypoint human gate`)
  }
  return task
}

function insertGateEvent(
  db: Database.Database,
  input: {
    task: GateTaskRow
    workflow: WorkflowContext
    actor: string
    eventType: string
    payload: JsonMap
    now: number
  },
): void {
  if (!input.workflow.workflowInstanceId) return
  db.prepare(`
    INSERT INTO workflow_events (workflow_instance_id, node_instance_id, task_id, node_key, event_type, actor_type, actor_id, payload_json, workspace_id, created_at)
    VALUES (?, ?, ?, ?, ?, 'human', ?, ?, ?, ?)
  `).run(
    input.workflow.workflowInstanceId,
    input.workflow.nodeInstanceId,
    input.task.id,
    input.workflow.nodeKey,
    input.eventType,
    input.actor,
    JSON.stringify(input.payload),
    input.task.workspace_id,
    input.now,
  )
}

function workflowContext(rawWorkflow: unknown): WorkflowContext {
  const workflow = objectRecord(rawWorkflow)
  return {
    workflowInstanceId: typeof workflow.workflow_instance_id === 'number' ? workflow.workflow_instance_id : null,
    nodeInstanceId: typeof workflow.node_instance_id === 'number' ? workflow.node_instance_id : null,
    nodeKey: typeof workflow.node_key === 'string' ? workflow.node_key : null,
  }
}

function parseObject(raw: string | null): JsonMap {
  if (!raw) return {}
  const parsed: unknown = JSON.parse(raw)
  return objectRecord(parsed)
}

function objectRecord(value: unknown): JsonMap {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonMap : {}
}
