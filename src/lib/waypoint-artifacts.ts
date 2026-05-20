import { stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import type Database from 'better-sqlite3'

import { getWaypointProjectBinding } from './waypoint-project-binding'

export interface CheckWaypointTaskArtifactsInput {
  readonly taskId: number
  readonly workspaceId: number
}

export interface WaypointArtifactCheckResult {
  readonly taskId: number
  readonly projectRoot: string
  readonly requiredArtifacts: readonly string[]
  readonly missingArtifacts: readonly string[]
  readonly ok: boolean
}

export interface ResolveWaypointTaskArtifactBlockerInput {
  readonly taskId: number
  readonly workspaceId: number
  readonly actor: string
  readonly resolutionInput?: Record<string, unknown>
  readonly now?: number
}

export type ResolveWaypointTaskArtifactBlockerResult =
  | { readonly status: 'resolved'; readonly taskId: number; readonly missingArtifacts: readonly string[] }
  | { readonly status: 'blocked'; readonly taskId: number; readonly missingArtifacts: readonly string[] }

interface TaskArtifactRow {
  readonly id: number
  readonly project_id: number | null
  readonly workspace_id: number
  readonly metadata: string | null
}

interface WorkflowContext {
  readonly workflowInstanceId: number | null
  readonly nodeInstanceId: number | null
  readonly nodeKey: string | null
  readonly vars: Record<string, unknown>
}

type JsonMap = Record<string, unknown>

export async function checkWaypointTaskArtifacts(
  db: Database.Database,
  input: CheckWaypointTaskArtifactsInput,
): Promise<WaypointArtifactCheckResult> {
  const task = readTask(db, input.taskId, input.workspaceId)
  const metadata = parseObject(task.metadata)
  const waypoint = objectRecord(metadata.waypoint)
  const workflow = workflowContext(metadata.workflow)
  const projectRoot = resolveTrustedProjectRoot(db, task, workflow)
  const requiredArtifacts = requiredArtifactPaths(waypoint)
  const missingArtifacts: string[] = []

  for (const artifactPath of requiredArtifacts) {
    const artifactAbsolutePath = resolveSafeArtifactPath(projectRoot, artifactPath)
    try {
      await stat(artifactAbsolutePath)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        missingArtifacts.push(artifactPath)
        continue
      }
      throw error
    }
  }

  return {
    taskId: task.id,
    projectRoot,
    requiredArtifacts,
    missingArtifacts,
    ok: missingArtifacts.length === 0,
  }
}

export async function resolveWaypointTaskArtifactBlocker(
  db: Database.Database,
  input: ResolveWaypointTaskArtifactBlockerInput,
): Promise<ResolveWaypointTaskArtifactBlockerResult> {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const task = readTask(db, input.taskId, input.workspaceId)
  const metadata = parseObject(task.metadata)
  const waypoint = objectRecord(metadata.waypoint)
  const workflow = workflowContext(metadata.workflow)
  const check = await checkWaypointTaskArtifacts(db, input)
  const resolutionInput = input.resolutionInput ?? { mode: 'recheck' }

  if (!check.ok) {
    const updatedMetadata = withWaypointBlocker(metadata, waypoint, {
      status: 'blocked',
      missing_artifacts: check.missingArtifacts,
      resolution_input: resolutionInput,
      checked_at: now,
    })
    db.transaction(() => {
      db.prepare(`UPDATE tasks SET status = 'blocked', metadata = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
        .run(JSON.stringify(updatedMetadata), now, task.id, task.workspace_id)
      if (workflow.nodeInstanceId) {
        db.prepare(`UPDATE workflow_node_instances SET status = 'blocked', output_json = ?, updated_at = ? WHERE id = ?`)
          .run(JSON.stringify({ status: 'blocked', missing_artifacts: check.missingArtifacts }), now, workflow.nodeInstanceId)
      }
      if (workflow.workflowInstanceId) {
        db.prepare(`UPDATE workflow_instances SET status = 'blocked', updated_at = ? WHERE id = ? AND workspace_id = ?`)
          .run(now, workflow.workflowInstanceId, task.workspace_id)
      }
      insertArtifactEvent(db, { task, workflow, actor: input.actor, eventType: 'waypoint.artifacts.blocked', payload: {
        status: 'blocked',
        missing_artifacts: check.missingArtifacts,
        resolution_input: resolutionInput,
      }, now })
    })()
    return { status: 'blocked', taskId: task.id, missingArtifacts: check.missingArtifacts }
  }

  const updatedMetadata = withWaypointBlocker(metadata, waypoint, {
    status: 'resolved',
    missing_artifacts: [],
    resolution_input: resolutionInput,
    checked_at: now,
  })
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET status = 'inbox', metadata = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
      .run(JSON.stringify(updatedMetadata), now, task.id, task.workspace_id)
    if (workflow.nodeInstanceId) {
      db.prepare(`UPDATE workflow_node_instances SET status = 'running', output_json = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify({ status: 'resolved', missing_artifacts: [] }), now, workflow.nodeInstanceId)
    }
    if (workflow.workflowInstanceId) {
      db.prepare(`UPDATE workflow_instances SET status = 'active', updated_at = ? WHERE id = ? AND workspace_id = ?`)
        .run(now, workflow.workflowInstanceId, task.workspace_id)
    }
    insertArtifactEvent(db, { task, workflow, actor: input.actor, eventType: 'waypoint.artifacts.resolved', payload: {
      status: 'resolved',
      missing_artifacts: [],
      resolution_input: resolutionInput,
    }, now })
  })()

  return { status: 'resolved', taskId: task.id, missingArtifacts: [] }
}

function readTask(db: Database.Database, taskId: number, workspaceId: number): TaskArtifactRow {
  const task = db.prepare(`
    SELECT id, project_id, workspace_id, metadata
    FROM tasks
    WHERE id = ? AND workspace_id = ?
    LIMIT 1
  `).get(taskId, workspaceId) as TaskArtifactRow | undefined
  if (!task) throw new Error(`Task ${taskId} not found in workspace ${workspaceId}`)
  return task
}

function insertArtifactEvent(
  db: Database.Database,
  input: {
    task: TaskArtifactRow
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

function withWaypointBlocker(metadata: JsonMap, waypoint: JsonMap, blocker: JsonMap): JsonMap {
  return {
    ...metadata,
    waypoint: {
      ...waypoint,
      blocker,
      artifact_check: {
        status: blocker.status,
        missing_artifacts: blocker.missing_artifacts,
        checked_at: blocker.checked_at,
      },
    },
  }
}

function requiredArtifactPaths(waypoint: JsonMap): string[] {
  const artifacts = Array.isArray(waypoint.required_artifacts) ? waypoint.required_artifacts : []
  return artifacts
    .map((artifact) => objectRecord(artifact).path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
}

function resolveSafeArtifactPath(projectRoot: string, artifactPath: string): string {
  if (artifactPath.startsWith('/') || artifactPath.includes('\0')) {
    throw new Error(`unsafe artifact path: ${artifactPath}`)
  }
  const absolutePath = resolve(projectRoot, artifactPath)
  const root = resolve(projectRoot)
  const rel = relative(root, absolutePath)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('..')) {
    throw new Error(`artifact path escapes trusted root: ${artifactPath}`)
  }
  return absolutePath
}

function resolveTrustedProjectRoot(db: Database.Database, task: TaskArtifactRow, workflow: WorkflowContext): string {
  const workflowCaseRoot = stringValue(workflow.vars.case_root)
  if (workflowCaseRoot) return resolve(workflowCaseRoot)
  if (!task.project_id) throw new Error(`Task ${task.id} is missing project_id for artifact checks`)
  const project = db.prepare(`SELECT id, workspace_id, metadata FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1`)
    .get(task.project_id, task.workspace_id) as { id: number; workspace_id: number; metadata: string | null } | undefined
  if (!project) throw new Error(`Project ${task.project_id} not found in workspace ${task.workspace_id}`)
  const binding = getWaypointProjectBinding(project)
  if (!binding) throw new Error(`Project ${task.project_id} does not have a Waypoint binding`)
  return resolve(binding.caseRoot)
}

function workflowContext(rawWorkflow: unknown): WorkflowContext {
  const workflow = objectRecord(rawWorkflow)
  return {
    workflowInstanceId: numberValue(workflow.workflow_instance_id),
    nodeInstanceId: numberValue(workflow.node_instance_id),
    nodeKey: stringValue(workflow.node_key),
    vars: objectRecord(workflow.vars),
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

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === 'object' && 'code' in error
}
