import { readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import type Database from 'better-sqlite3'

import { getWaypointProjectBinding } from './waypoint-project-binding'

export const REFERRAL_CHRONOLOGY_DOS_LEDGER_ARTIFACT = '03-medical/medical-chronology-output/reports/date-of-service-ledger.json'
export const REFERRAL_CHRONOLOGY_VISIT_CONTENT_ARTIFACT = '03-medical/medical-chronology-output/reports/visit-content.json'
export const REFERRAL_CHRONOLOGY_RENDER_CHECK_ARTIFACT = '03-medical/medical-chronology-output/reports/rendered-template-check.json'

export const REFERRAL_CHRONOLOGY_STAGED_ARTIFACTS = [
  REFERRAL_CHRONOLOGY_DOS_LEDGER_ARTIFACT,
  REFERRAL_CHRONOLOGY_VISIT_CONTENT_ARTIFACT,
] as const

export const REFERRAL_CHRONOLOGY_FINAL_ARTIFACTS = [
  '03-medical/medical-chronology-output/medical-chronology.html',
  '03-medical/medical-chronology-output/medical-chronology-timeline.pdf',
] as const

export interface AssessReferralChronologyRuntimeInput {
  readonly taskId: number
  readonly workspaceId: number
  readonly actor: string
  readonly now?: number
}

export type ReferralChronologyRuntimeStage = 'staged_data' | 'deterministic_render' | 'complete'

export type AssessReferralChronologyRuntimeResult =
  | {
      readonly status: 'blocked'
      readonly taskId: number
      readonly stage: Exclude<ReferralChronologyRuntimeStage, 'complete'>
      readonly missingArtifacts: readonly string[]
      readonly invalidArtifacts: readonly string[]
      readonly reason: string
    }
  | {
      readonly status: 'ready'
      readonly taskId: number
      readonly stage: 'complete'
      readonly artifacts: readonly string[]
      readonly reason: string
    }

interface ChronologyTaskRow {
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
  readonly vars: Record<string, unknown>
}

type JsonMap = Record<string, unknown>

export async function assessReferralChronologyRuntime(
  db: Database.Database,
  input: AssessReferralChronologyRuntimeInput,
): Promise<AssessReferralChronologyRuntimeResult> {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const task = readChronologyTask(db, input.taskId, input.workspaceId)
  if (task.recipe_slug !== 'firmvault-medical-chronology-update') {
    throw new Error(`Task ${task.id} is not the referral-package chronology task`)
  }
  const metadata = parseObject(task.metadata)
  const workflow = workflowContext(metadata.workflow)
  const projectRoot = resolveTrustedProjectRoot(db, task, workflow)

  const staged = await inspectArtifacts(projectRoot, REFERRAL_CHRONOLOGY_STAGED_ARTIFACTS, {
    [REFERRAL_CHRONOLOGY_DOS_LEDGER_ARTIFACT]: validateDosLedger,
    [REFERRAL_CHRONOLOGY_VISIT_CONTENT_ARTIFACT]: validateVisitContent,
  })
  if (staged.missing.length > 0 || staged.invalid.length > 0) {
    const result: AssessReferralChronologyRuntimeResult = {
      status: 'blocked',
      taskId: task.id,
      stage: 'staged_data',
      missingArtifacts: staged.missing,
      invalidArtifacts: staged.invalid,
      reason: `Chronology source truth is staged JSON; ${REFERRAL_CHRONOLOGY_DOS_LEDGER_ARTIFACT} and ${REFERRAL_CHRONOLOGY_VISIT_CONTENT_ARTIFACT} must exist and parse before HTML/PDF can count.`,
    }
    persistChronologyAssessment(db, { task, metadata, workflow, result, actor: input.actor, now })
    return result
  }

  const renderAndFinal = await inspectArtifacts(projectRoot, [
    REFERRAL_CHRONOLOGY_RENDER_CHECK_ARTIFACT,
    ...REFERRAL_CHRONOLOGY_FINAL_ARTIFACTS,
  ], {
    [REFERRAL_CHRONOLOGY_RENDER_CHECK_ARTIFACT]: validateRenderCheck,
  })
  if (renderAndFinal.missing.length > 0 || renderAndFinal.invalid.length > 0) {
    const result: AssessReferralChronologyRuntimeResult = {
      status: 'blocked',
      taskId: task.id,
      stage: 'deterministic_render',
      missingArtifacts: renderAndFinal.missing,
      invalidArtifacts: renderAndFinal.invalid,
      reason: 'Staged chronology JSON is present; deterministic renderer evidence and final HTML/PDF artifacts are required before completion.',
    }
    persistChronologyAssessment(db, { task, metadata, workflow, result, actor: input.actor, now })
    return result
  }

  const result: AssessReferralChronologyRuntimeResult = {
    status: 'ready',
    taskId: task.id,
    stage: 'complete',
    artifacts: [
      ...REFERRAL_CHRONOLOGY_STAGED_ARTIFACTS,
      REFERRAL_CHRONOLOGY_RENDER_CHECK_ARTIFACT,
      ...REFERRAL_CHRONOLOGY_FINAL_ARTIFACTS,
    ],
    reason: 'Staged chronology JSON, deterministic render check, and final chronology artifacts are present.',
  }
  persistChronologyAssessment(db, { task, metadata, workflow, result, actor: input.actor, now })
  return result
}

async function inspectArtifacts(
  projectRoot: string,
  artifactPaths: readonly string[],
  validators: Record<string, (absolutePath: string) => Promise<boolean>>,
): Promise<{ missing: string[]; invalid: string[] }> {
  const missing: string[] = []
  const invalid: string[] = []
  for (const artifactPath of artifactPaths) {
    const absolutePath = resolveSafeArtifactPath(projectRoot, artifactPath)
    try {
      await stat(absolutePath)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        missing.push(artifactPath)
        continue
      }
      throw error
    }
    const validator = validators[artifactPath]
    if (validator && !(await validator(absolutePath))) invalid.push(artifactPath)
  }
  return { missing, invalid }
}

async function validateDosLedger(absolutePath: string): Promise<boolean> {
  const value = await readJsonMap(absolutePath)
  return Number(value.schema_version) === 1 && Array.isArray(value.entries)
}

async function validateVisitContent(absolutePath: string): Promise<boolean> {
  const value = await readJsonMap(absolutePath)
  return Number(value.schema_version) === 1 && Array.isArray(value.visits)
}

async function validateRenderCheck(absolutePath: string): Promise<boolean> {
  const value = await readJsonMap(absolutePath)
  return Number(value.schema_version) === 1 && (value.passed === true || value.status === 'passed')
}

async function readJsonMap(absolutePath: string): Promise<JsonMap> {
  try {
    const parsed: unknown = JSON.parse(await readFile(absolutePath, 'utf8'))
    return objectRecord(parsed)
  } catch {
    return {}
  }
}

function persistChronologyAssessment(
  db: Database.Database,
  input: {
    task: ChronologyTaskRow
    metadata: JsonMap
    workflow: WorkflowContext
    result: AssessReferralChronologyRuntimeResult
    actor: string
    now: number
  },
): void {
  const waypoint = objectRecord(input.metadata.waypoint)
  const chronologyRuntime = input.result.status === 'blocked'
    ? {
        status: 'blocked',
        stage: input.result.stage,
        source_truth: 'staged_json',
        html_source_truth: false,
        missing_artifacts: input.result.missingArtifacts,
        invalid_artifacts: input.result.invalidArtifacts,
        reason: input.result.reason,
        checked_at: input.now,
      }
    : {
        status: 'ready',
        stage: 'complete',
        source_truth: 'staged_json',
        html_source_truth: false,
        artifacts: input.result.artifacts,
        reason: input.result.reason,
        checked_at: input.now,
      }
  const updatedMetadata = {
    ...input.metadata,
    waypoint: {
      ...waypoint,
      chronology_runtime: chronologyRuntime,
      blocker: input.result.status === 'blocked'
        ? {
            status: 'blocked',
            missing_artifacts: input.result.missingArtifacts,
            invalid_artifacts: input.result.invalidArtifacts,
            resolution_input: { mode: 'produce_staged_chronology_artifacts' },
          }
        : { status: 'resolved', missing_artifacts: [], invalid_artifacts: [], resolution_input: { mode: 'chronology_runtime_assessment' } },
    },
  }
  const taskStatus = input.result.status === 'blocked' ? 'blocked' : 'done'
  const nodeStatus = input.result.status === 'blocked' ? 'blocked' : 'complete'
  const eventType = input.result.status === 'blocked' ? 'waypoint.chronology.blocked' : 'waypoint.chronology.ready'

  db.transaction(() => {
    db.prepare(`UPDATE tasks SET status = ?, metadata = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
      .run(taskStatus, JSON.stringify(updatedMetadata), input.now, input.task.id, input.task.workspace_id)
    if (input.workflow.nodeInstanceId) {
      db.prepare(`UPDATE workflow_node_instances SET status = ?, output_json = ?, updated_at = ? WHERE id = ?`)
        .run(nodeStatus, JSON.stringify(input.result), input.now, input.workflow.nodeInstanceId)
    }
    if (input.workflow.workflowInstanceId && input.result.status === 'blocked') {
      db.prepare(`UPDATE workflow_instances SET status = 'blocked', updated_at = ? WHERE id = ? AND workspace_id = ?`)
        .run(input.now, input.workflow.workflowInstanceId, input.task.workspace_id)
    }
    insertChronologyEvent(db, { task: input.task, workflow: input.workflow, actor: input.actor, eventType, payload: chronologyRuntime, now: input.now })
  })()
}

function insertChronologyEvent(
  db: Database.Database,
  input: {
    task: ChronologyTaskRow
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

function readChronologyTask(db: Database.Database, taskId: number, workspaceId: number): ChronologyTaskRow {
  const task = db.prepare(`
    SELECT id, project_id, workspace_id, recipe_slug, metadata
    FROM tasks
    WHERE id = ? AND workspace_id = ?
    LIMIT 1
  `).get(taskId, workspaceId) as ChronologyTaskRow | undefined
  if (!task) throw new Error(`Task ${taskId} not found in workspace ${workspaceId}`)
  return task
}

function resolveTrustedProjectRoot(db: Database.Database, task: ChronologyTaskRow, workflow: WorkflowContext): string {
  const workflowCaseRoot = stringValue(workflow.vars.case_root)
  if (workflowCaseRoot) return resolve(workflowCaseRoot)
  if (!task.project_id) throw new Error(`Task ${task.id} is missing project_id for chronology runtime`)
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

function resolveSafeArtifactPath(projectRoot: string, artifactPath: string): string {
  if (artifactPath.startsWith('/') || artifactPath.includes('\0')) {
    throw new Error(`unsafe chronology artifact path: ${artifactPath}`)
  }
  const absolutePath = resolve(projectRoot, artifactPath)
  const root = resolve(projectRoot)
  const rel = relative(root, absolutePath)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('..')) {
    throw new Error(`chronology artifact path escapes trusted root: ${artifactPath}`)
  }
  return absolutePath
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
