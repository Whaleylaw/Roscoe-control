import { stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import type Database from 'better-sqlite3'
import { runReferralPackageBuilder } from '@waypoint/folder-host'

import { getWaypointProjectBinding } from './waypoint-project-binding'
import { assessReferralChronologyRuntime } from './waypoint-referral-chronology'

export type WaypointLocalPackageRunStatus = 'ok' | 'blocked' | 'skipped' | 'failed'

export interface RunWaypointLocalPackageTaskInput {
  readonly taskId: number
  readonly workspaceId: number
  readonly actor: string
  readonly now?: number
}

export type RunWaypointLocalPackageTaskResult =
  | {
      readonly status: 'ok'
      readonly taskId: number
      readonly artifacts: readonly string[]
      readonly summary: string
    }
  | {
      readonly status: 'blocked'
      readonly taskId: number
      readonly artifacts: readonly string[]
      readonly missingArtifacts: readonly string[]
      readonly summary: string
    }
  | {
      readonly status: 'skipped'
      readonly taskId: number
      readonly reason: 'not_local_package' | 'unsupported_package_function'
    }
  | {
      readonly status: 'failed'
      readonly taskId: number
      readonly error: string
    }

interface TaskRuntimeRow {
  readonly id: number
  readonly project_id: number | null
  readonly workspace_id: number
  readonly recipe_slug: string | null
  readonly metadata: string | null
}

interface WorkflowContext {
  readonly workflowInstanceId: number | null
  readonly nodeInstanceId: number | null
  readonly nodeKey: string | null
  readonly routeId: string
  readonly vars: Record<string, unknown>
}

type JsonMap = Record<string, unknown>

export async function runWaypointLocalPackageTask(
  db: Database.Database,
  input: RunWaypointLocalPackageTaskInput,
): Promise<RunWaypointLocalPackageTaskResult> {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const task = db.prepare(`
    SELECT id, project_id, workspace_id, recipe_slug, metadata
    FROM tasks
    WHERE id = ? AND workspace_id = ?
    LIMIT 1
  `).get(input.taskId, input.workspaceId) as TaskRuntimeRow | undefined
  if (!task) throw new Error(`Task ${input.taskId} not found in workspace ${input.workspaceId}`)

  const metadata = parseObject(task.metadata)
  const waypoint = objectRecord(metadata.waypoint)
  const execution = objectRecord(waypoint.execution)
  if (execution.kind !== 'local_package') {
    return { status: 'skipped', taskId: task.id, reason: 'not_local_package' }
  }
  if (execution.package_function !== 'runReferralPackageBuilder') {
    return { status: 'skipped', taskId: task.id, reason: 'unsupported_package_function' }
  }

  const workflow = workflowContext(metadata.workflow, waypoint, task.id)
  const projectRoot = resolveTrustedProjectRoot(db, task, workflow)
  const recipeSlug = task.recipe_slug ?? stringValue(objectRecord(waypoint.recipe).slug) ?? ''
  if (!recipeSlug) throw new Error(`Task ${task.id} is missing a recipe_slug for local package execution`)

  if (recipeSlug === 'firmvault-medical-chronology-update') {
    const chronology = await assessReferralChronologyRuntime(db, {
      taskId: task.id,
      workspaceId: input.workspaceId,
      actor: input.actor,
      now,
    })
    if (chronology.status === 'blocked') {
      return {
        status: 'blocked',
        taskId: task.id,
        artifacts: [],
        missingArtifacts: chronology.missingArtifacts,
        summary: chronology.reason,
      }
    }
    return {
      status: 'ok',
      taskId: task.id,
      artifacts: chronology.artifacts,
      summary: chronology.reason,
    }
  }

  try {
    const packageResult = await runReferralPackageBuilder({
      schema_version: 1,
      recipe_slug: recipeSlug,
      prompt: '',
      task_id: String(task.id),
      project_root: projectRoot,
      route_id: workflow.routeId,
    })
    const missingArtifacts = await missingRequiredArtifacts(projectRoot, requiredArtifactPaths(waypoint))
    if (missingArtifacts.length > 0) {
      const result: RunWaypointLocalPackageTaskResult = {
        status: 'blocked',
        taskId: task.id,
        artifacts: packageResult.artifacts,
        missingArtifacts,
        summary: packageResult.summary,
      }
      persistRuntimeResult(db, { task, metadata, waypoint, workflow, result, packageResult, actor: input.actor, now })
      return result
    }

    const result: RunWaypointLocalPackageTaskResult = {
      status: 'ok',
      taskId: task.id,
      artifacts: packageResult.artifacts,
      summary: packageResult.summary,
    }
    persistRuntimeResult(db, { task, metadata, waypoint, workflow, result, packageResult, actor: input.actor, now })
    return result
  } catch (error) {
    const result: RunWaypointLocalPackageTaskResult = {
      status: 'failed',
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    }
    persistRuntimeFailure(db, { task, metadata, waypoint, workflow, result, actor: input.actor, now })
    return result
  }
}

function persistRuntimeResult(
  db: Database.Database,
  input: {
    task: TaskRuntimeRow
    metadata: JsonMap
    waypoint: JsonMap
    workflow: WorkflowContext
    result: Extract<RunWaypointLocalPackageTaskResult, { status: 'ok' | 'blocked' }>
    packageResult: Awaited<ReturnType<typeof runReferralPackageBuilder>>
    actor: string
    now: number
  },
): void {
  const eventType = input.result.status === 'blocked' ? 'waypoint.local_package.blocked' : 'waypoint.local_package.completed'
  const blocker = input.result.status === 'blocked'
    ? { status: 'blocked', missing_artifacts: input.result.missingArtifacts, resolution_input: null }
    : { status: null, missing_artifacts: [], resolution_input: null }
  const updatedMetadata = {
    ...input.metadata,
    waypoint: {
      ...input.waypoint,
      local_runtime: {
        status: input.result.status,
        adapter: input.packageResult.adapter,
        summary: input.packageResult.summary,
        artifacts: input.packageResult.artifacts,
        unresolved: input.packageResult.unresolved,
        ran_at: input.now,
      },
      blocker,
    },
  }

  db.transaction(() => {
    db.prepare(`UPDATE tasks SET status = ?, metadata = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
      .run(input.result.status === 'blocked' ? 'blocked' : 'done', JSON.stringify(updatedMetadata), input.now, input.task.id, input.task.workspace_id)

    if (input.workflow.nodeInstanceId) {
      db.prepare(`UPDATE workflow_node_instances SET status = ?, output_json = ?, updated_at = ? WHERE id = ?`)
        .run(input.result.status === 'blocked' ? 'blocked' : 'complete', JSON.stringify(input.result), input.now, input.workflow.nodeInstanceId)
    }
    if (input.workflow.workflowInstanceId && input.result.status === 'blocked') {
      db.prepare(`UPDATE workflow_instances SET status = 'blocked', updated_at = ? WHERE id = ? AND workspace_id = ?`)
        .run(input.now, input.workflow.workflowInstanceId, input.task.workspace_id)
    }

    insertRuntimeEvent(db, {
      workflow: input.workflow,
      task: input.task,
      eventType,
      actor: input.actor,
      payload: {
        status: input.result.status,
        package_function: 'runReferralPackageBuilder',
        recipe_slug: input.task.recipe_slug,
        artifacts: input.result.artifacts,
        missing_artifacts: input.result.status === 'blocked' ? input.result.missingArtifacts : [],
        summary: input.result.summary,
      },
      now: input.now,
    })
  })()
}

function persistRuntimeFailure(
  db: Database.Database,
  input: {
    task: TaskRuntimeRow
    metadata: JsonMap
    waypoint: JsonMap
    workflow: WorkflowContext
    result: Extract<RunWaypointLocalPackageTaskResult, { status: 'failed' }>
    actor: string
    now: number
  },
): void {
  const updatedMetadata = {
    ...input.metadata,
    waypoint: {
      ...input.waypoint,
      local_runtime: { status: 'failed', error: input.result.error, ran_at: input.now },
    },
  }
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET status = 'failed', metadata = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
      .run(JSON.stringify(updatedMetadata), input.now, input.task.id, input.task.workspace_id)
    insertRuntimeEvent(db, {
      workflow: input.workflow,
      task: input.task,
      eventType: 'waypoint.local_package.failed',
      actor: input.actor,
      payload: { status: 'failed', error: input.result.error, recipe_slug: input.task.recipe_slug },
      now: input.now,
    })
  })()
}

function insertRuntimeEvent(
  db: Database.Database,
  input: {
    workflow: WorkflowContext
    task: TaskRuntimeRow
    eventType: string
    actor: string
    payload: JsonMap
    now: number
  },
): void {
  if (!input.workflow.workflowInstanceId) return
  db.prepare(`
    INSERT INTO workflow_events (workflow_instance_id, node_instance_id, task_id, node_key, event_type, actor_type, actor_id, payload_json, workspace_id, created_at)
    VALUES (?, ?, ?, ?, ?, 'agent', ?, ?, ?, ?)
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

async function missingRequiredArtifacts(projectRoot: string, paths: readonly string[]): Promise<string[]> {
  const missing: string[] = []
  for (const artifactPath of paths) {
    assertRelativeSafeArtifactPath(artifactPath)
    const absolutePath = resolve(projectRoot, artifactPath)
    assertWithinRoot(projectRoot, absolutePath, artifactPath)
    try {
      await stat(absolutePath)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        missing.push(artifactPath)
        continue
      }
      throw error
    }
  }
  return missing
}

function requiredArtifactPaths(waypoint: JsonMap): string[] {
  const artifacts = Array.isArray(waypoint.required_artifacts) ? waypoint.required_artifacts : []
  return artifacts
    .map((artifact) => objectRecord(artifact).path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
}

function resolveTrustedProjectRoot(db: Database.Database, task: TaskRuntimeRow, workflow: WorkflowContext): string {
  const workflowCaseRoot = stringValue(workflow.vars.case_root)
  if (workflowCaseRoot) return resolve(workflowCaseRoot)
  if (!task.project_id) throw new Error(`Task ${task.id} is missing project_id for local package execution`)
  const project = db.prepare(`SELECT id, workspace_id, metadata FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1`)
    .get(task.project_id, task.workspace_id) as { id: number; workspace_id: number; metadata: string | null } | undefined
  if (!project) throw new Error(`Project ${task.project_id} not found in workspace ${task.workspace_id}`)
  const binding = getWaypointProjectBinding(project)
  if (!binding) throw new Error(`Project ${task.project_id} does not have a Waypoint binding`)
  return resolve(binding.caseRoot)
}

function workflowContext(rawWorkflow: unknown, waypoint: JsonMap, taskId: number): WorkflowContext {
  const workflow = objectRecord(rawWorkflow)
  const workflowInstanceId = numberValue(workflow.workflow_instance_id)
  const nodeInstanceId = numberValue(workflow.node_instance_id)
  const nodeKey = stringValue(workflow.node_key)
  const routeId = stringValue(waypoint.route_id) ?? (workflowInstanceId ? String(workflowInstanceId) : `task:${taskId}`)
  return {
    workflowInstanceId,
    nodeInstanceId,
    nodeKey,
    routeId,
    vars: objectRecord(workflow.vars),
  }
}

function assertRelativeSafeArtifactPath(path: string): void {
  if (path.startsWith('/') || path.includes('\0')) throw new Error(`Unsafe artifact path: ${path}`)
}

function assertWithinRoot(root: string, absolutePath: string, label: string): void {
  const normalizedRoot = resolve(root)
  const rel = relative(normalizedRoot, absolutePath)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('..')) {
    throw new Error(`Artifact path escapes trusted root: ${label}`)
  }
}

function parseObject(raw: string | null): JsonMap {
  if (!raw) return {}
  const parsed: unknown = JSON.parse(raw)
  return objectRecord(parsed)
}

function objectRecord(value: unknown): JsonMap {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? value as JsonMap : {}
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
