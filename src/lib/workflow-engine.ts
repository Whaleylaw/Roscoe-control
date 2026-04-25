import type Database from 'better-sqlite3'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { eventBus } from '@/lib/event-bus'

const durationPattern = /^(\d+)(s|m|h|d)$/

const workflowNodeSchema = z.object({
  type: z.enum(['recipe', 'review', 'wait', 'code', 'gateway']),
  name: z.string().min(1).max(200).optional(),
  recipe: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  depends_on: z.array(z.string().min(1)).default([]),
  blockers: z.array(z.string().min(1)).default([]),
  duration: z.string().regex(durationPattern).optional(),
  until: z.object({ condition: z.string().min(1) }).optional(),
  exit_when: z.object({ condition: z.string().min(1) }).optional(),
  completes: z.array(z.string().min(1)).default([]),
  review: z.object({
    mode: z.enum(['agent', 'human']),
    recipe: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    max_rounds: z.number().int().min(1).max(20).default(1),
    fallback: z.enum(['human', 'blocked', 'failed']).default('human'),
  }).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
}).superRefine((node, ctx) => {
  if ((node.type === 'recipe' || node.type === 'review') && !node.recipe && node.review?.mode !== 'human') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recipe'],
      message: `${node.type} nodes require recipe unless they are human-only review gates`,
    })
  }
})

const workflowDefinitionSchema = z.object({
  schema_version: z.literal(1).default(1),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(200),
  version: z.number().int().min(1).default(1),
  subject_type: z.string().min(1).max(100).default('generic'),
  trigger: z.object({
    type: z.string().min(1).max(100).default('manual'),
    condition: z.string().min(1).optional(),
  }).default({ type: 'manual' }),
  nodes: z.record(z.string().min(1), workflowNodeSchema).refine((nodes) => Object.keys(nodes).length > 0, {
    message: 'workflow must define at least one node',
  }),
})

export type WorkflowNodeType = 'recipe' | 'review' | 'wait' | 'code' | 'gateway'
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>
export type WorkflowDefinitionNode = WorkflowDefinition['nodes'][string]
export type WorkflowNodeStatus = 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'complete' | 'failed' | 'skipped' | 'cancelled'
export type WorkflowInstanceStatus = 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'

export type WorkflowRuntimeNode = {
  node_key: string
  node_type: WorkflowNodeType
  status: WorkflowNodeStatus
  due_at: number | null
  completed_at: number | null
  blocked_by: string[]
}

export type StartWorkflowInput = {
  definitionId: number
  subjectType: string
  subjectId: string
  workflowKey?: string
  actor: string
  workspaceId: number
  tenantId?: number
  now?: number
}

export type StartWorkflowResult = {
  instance_id: number
  ready_nodes: string[]
}

export type MaterializeReadyWorkflowNodesInput = {
  workflowInstanceId: number
  projectId: number
  workspaceId: number
  actor: string
  baseRef?: string
  assignedTo?: string | null
  status?: 'inbox' | 'assigned'
  now?: number
}

export type MaterializeReadyWorkflowNodesResult = {
  workflow_instance_id: number
  created: Array<{ task_id: number; node_key: string; title: string }>
  skipped: Array<{ node_key: string; reason: string; task_id?: number | null }>
}

export type CompleteWorkflowNodeResult = {
  workflow_instance_id: number
  ready_nodes: string[]
} | null

export type AdvanceWorkflowAfterTaskApprovalInput = {
  taskId: number
  actor: string
  payload?: Record<string, unknown>
  assignedTo?: string | null
  status?: 'inbox' | 'assigned'
  now?: number
}

export type AdvanceWorkflowAfterTaskApprovalResult = {
  completed: CompleteWorkflowNodeResult
  materialized: MaterializeReadyWorkflowNodesResult | null
}

export type AdvanceDueWorkflowTimersInput = {
  actor?: string
  workspaceId?: number
  limit?: number
  status?: 'inbox' | 'assigned'
  now?: number
}

export type AdvanceDueWorkflowTimersResult = {
  completed: Array<{ workflow_instance_id: number; node_instance_id: number; node_key: string }>
  materialized: MaterializeReadyWorkflowNodesResult[]
}

export function parseWorkflowDefinition(raw: string): WorkflowDefinition {
  const parsed = parseYaml(raw)
  const result = workflowDefinitionSchema.safeParse(parsed)
  if (!result.success) {
    const message = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `${path}: ${issue.message}`
    }).join('; ')
    throw new Error(`Invalid workflow definition: ${message}`)
  }
  assertWorkflowGraph(result.data)
  return result.data
}

export function durationToSeconds(value: string): number {
  const match = value.match(durationPattern)
  if (!match) throw new Error(`Invalid duration '${value}'. Use Ns, Nm, Nh, or Nd.`)
  const count = Number(match[1])
  const unit = match[2]
  if (unit === 's') return count
  if (unit === 'm') return count * 60
  if (unit === 'h') return count * 60 * 60
  return count * 24 * 60 * 60
}

export function readyNodeKeys(
  definition: WorkflowDefinition,
  runtimeNodes: WorkflowRuntimeNode[],
  now = Math.floor(Date.now() / 1000),
): string[] {
  const runtimeByKey = new Map(runtimeNodes.map((node) => [node.node_key, node]))
  const ready: string[] = []
  for (const [nodeKey, node] of Object.entries(definition.nodes)) {
    const runtime = runtimeByKey.get(nodeKey)
    if (!runtime || !['pending', 'blocked', 'waiting'].includes(runtime.status)) continue
    const dependencies = node.depends_on ?? []
    const incomplete = dependencies.filter((dependency) => runtimeByKey.get(dependency)?.status !== 'complete')
    if (incomplete.length > 0) continue
    if (node.type === 'wait' && runtime.status === 'waiting') continue
    ready.push(nodeKey)
  }
  return ready
}

export function createWorkflowDefinition(
  db: Database.Database,
  rawYaml: string,
  actor: string,
  workspaceId: number,
  tenantId = 1,
): number {
  const definition = parseWorkflowDefinition(rawYaml)
  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(`
    INSERT INTO workflow_definitions (
      slug, name, version, subject_type, definition_yaml, status, created_by,
      workspace_id, tenant_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `).run(definition.id, definition.name, definition.version, definition.subject_type, rawYaml, actor, workspaceId, tenantId, now, now)
  return Number(result.lastInsertRowid)
}

export function startWorkflowInstance(
  db: Database.Database,
  input: StartWorkflowInput,
): StartWorkflowResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const definitionRow = db.prepare(`
    SELECT id, slug, name, version, subject_type, definition_yaml
    FROM workflow_definitions
    WHERE id = ? AND workspace_id = ?
  `).get(input.definitionId, input.workspaceId) as {
    id: number
    slug: string
    name: string
    version: number
    subject_type: string
    definition_yaml: string
  } | undefined
  if (!definitionRow) throw new Error(`Workflow definition ${input.definitionId} not found`)

  const definition = parseWorkflowDefinition(definitionRow.definition_yaml)
  const workflowKey = input.workflowKey ?? `${definition.id}:${input.subjectType}:${input.subjectId}:${now}`
  let instanceId = 0
  let ready: string[] = []

  db.transaction(() => {
    const instance = db.prepare(`
      INSERT INTO workflow_instances (
        definition_id, workflow_key, subject_type, subject_id, status, started_by,
        workspace_id, tenant_id, started_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).run(input.definitionId, workflowKey, input.subjectType, input.subjectId, input.actor, input.workspaceId, input.tenantId ?? 1, now, now)
    instanceId = Number(instance.lastInsertRowid)

    for (const [nodeKey, node] of Object.entries(definition.nodes)) {
      db.prepare(`
        INSERT INTO workflow_node_instances (
          workflow_instance_id, node_key, node_type, status, recipe_slug,
          depends_on_json, blocked_by_json, config_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, ?, '[]', ?, ?, ?)
      `).run(
        instanceId,
        nodeKey,
        node.type,
        node.recipe ?? null,
        JSON.stringify(node.depends_on ?? []),
        JSON.stringify({ ...node.config, review: node.review ?? null, duration: node.duration ?? null, until: node.until ?? null, exit_when: node.exit_when ?? null, completes: node.completes ?? [] }),
        now,
        now,
      )
    }

    writeWorkflowEvent(db, {
      workflowInstanceId: instanceId,
      eventType: 'workflow.started',
      actorType: 'human',
      actorId: input.actor,
      payload: { definition_id: input.definitionId, workflow_key: workflowKey, subject_type: input.subjectType, subject_id: input.subjectId },
      workspaceId: input.workspaceId,
      createdAt: now,
    })
    ready = evaluateWorkflowInstanceInTransaction(db, instanceId, now)
  })()

  return { instance_id: instanceId, ready_nodes: ready }
}

export function evaluateWorkflowInstance(
  db: Database.Database,
  workflowInstanceId: number,
  now = Math.floor(Date.now() / 1000),
): string[] {
  return db.transaction(() => evaluateWorkflowInstanceInTransaction(db, workflowInstanceId, now))()
}

function evaluateWorkflowInstanceInTransaction(
  db: Database.Database,
  workflowInstanceId: number,
  now: number,
): string[] {
  const loaded = loadWorkflowForEvaluation(db, workflowInstanceId)
  const readyKeys = readyNodeKeys(loaded.definition, loaded.nodes, now)
  for (const nodeKey of readyKeys) {
    const definitionNode = loaded.definition.nodes[nodeKey]
    const dueAt = definitionNode.type === 'wait' && definitionNode.duration ? now + durationToSeconds(definitionNode.duration) : null
    const nextStatus: WorkflowNodeStatus = definitionNode.type === 'wait' && dueAt != null ? 'waiting' : 'ready'
    db.prepare(`
      UPDATE workflow_node_instances
      SET status = ?, due_at = COALESCE(due_at, ?), blocked_by_json = '[]', updated_at = ?
      WHERE workflow_instance_id = ? AND node_key = ? AND status IN ('pending', 'blocked', 'waiting')
    `).run(nextStatus, dueAt, now, workflowInstanceId, nodeKey)
    writeWorkflowEvent(db, {
      workflowInstanceId,
      eventType: nextStatus === 'waiting' ? 'node.waiting' : 'node.ready',
      actorType: 'system',
      actorId: 'workflow-engine',
      nodeKey,
      payload: { node_key: nodeKey, node_type: definitionNode.type, due_at: dueAt },
      workspaceId: loaded.workspaceId,
      createdAt: now,
    })
  }
  return readyKeys
}

export function completeWorkflowNodeForTask(
  db: Database.Database,
  taskId: number,
  actor: string,
  payload: Record<string, unknown> = {},
  now = Math.floor(Date.now() / 1000),
): CompleteWorkflowNodeResult {
  let result: CompleteWorkflowNodeResult = null
  db.transaction(() => {
    const node = db.prepare(`
      SELECT wni.id, wni.workflow_instance_id, wni.node_key, wni.status, wi.workspace_id
      FROM workflow_node_instances wni
      JOIN workflow_instances wi ON wi.id = wni.workflow_instance_id
      WHERE wni.task_id = ?
      LIMIT 1
    `).get(taskId) as {
      id: number
      workflow_instance_id: number
      node_key: string
      status: WorkflowNodeStatus
      workspace_id: number
    } | undefined
    if (!node) return
    const updated = db.prepare(`
      UPDATE workflow_node_instances
      SET status = 'complete', completed_at = COALESCE(completed_at, ?), output_json = ?, updated_at = ?
      WHERE id = ? AND status != 'complete'
    `).run(now, JSON.stringify(payload), now, node.id)
    if (updated.changes > 0) {
      writeWorkflowEvent(db, {
        workflowInstanceId: node.workflow_instance_id,
        nodeInstanceId: node.id,
        taskId,
        nodeKey: node.node_key,
        eventType: 'node.completed',
        actorType: 'agent',
        actorId: actor,
        payload,
        workspaceId: node.workspace_id,
        createdAt: now,
      })
    }
    const readyNodes = evaluateWorkflowInstanceInTransaction(db, node.workflow_instance_id, now)
    result = { workflow_instance_id: node.workflow_instance_id, ready_nodes: readyNodes }
  })()
  return result
}

export function advanceWorkflowAfterTaskApproval(
  db: Database.Database,
  input: AdvanceWorkflowAfterTaskApprovalInput,
): AdvanceWorkflowAfterTaskApprovalResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const task = db.prepare(`
    SELECT id, project_id, workspace_id, workspace_source
    FROM tasks
    WHERE id = ?
  `).get(input.taskId) as {
    id: number
    project_id: number | null
    workspace_id: number
    workspace_source: string | null
  } | undefined
  if (!task) throw new Error(`Task ${input.taskId} not found`)

  const completed = completeWorkflowNodeForTask(db, input.taskId, input.actor, input.payload ?? {}, now)
  if (!completed) return { completed, materialized: null }
  if (!task.project_id) return { completed, materialized: null }

  const materialized = materializeReadyWorkflowNodes(db, {
    workflowInstanceId: completed.workflow_instance_id,
    projectId: task.project_id,
    workspaceId: task.workspace_id,
    actor: input.actor,
    baseRef: baseRefFromWorkspaceSource(task.workspace_source),
    assignedTo: input.assignedTo,
    status: input.status ?? 'inbox',
    now,
  })

  return { completed, materialized }
}

export function advanceDueWorkflowTimers(
  db: Database.Database,
  input: AdvanceDueWorkflowTimersInput = {},
): AdvanceDueWorkflowTimersResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const actor = input.actor ?? 'workflow-timer'
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500))
  const completed: AdvanceDueWorkflowTimersResult['completed'] = []
  const workflowIds = new Set<number>()

  db.transaction(() => {
    const rows = db.prepare(`
      SELECT wni.id, wni.workflow_instance_id, wni.node_key, wni.due_at, wi.workspace_id
      FROM workflow_node_instances wni
      JOIN workflow_instances wi ON wi.id = wni.workflow_instance_id
      WHERE wni.node_type = 'wait'
        AND wni.status = 'waiting'
        AND wni.due_at IS NOT NULL
        AND wni.due_at <= ?
        AND wi.status = 'active'
        ${input.workspaceId ? 'AND wi.workspace_id = ?' : ''}
      ORDER BY wni.due_at ASC, wni.id ASC
      LIMIT ?
    `).all(...(input.workspaceId ? [now, input.workspaceId, limit] : [now, limit])) as Array<{
      id: number
      workflow_instance_id: number
      node_key: string
      due_at: number
      workspace_id: number
    }>

    for (const row of rows) {
      const updated = db.prepare(`
        UPDATE workflow_node_instances
        SET status = 'complete', completed_at = COALESCE(completed_at, ?), output_json = ?, updated_at = ?
        WHERE id = ? AND status = 'waiting' AND due_at IS NOT NULL AND due_at <= ?
      `).run(now, JSON.stringify({ reason: 'timer_due', due_at: row.due_at }), now, row.id, now)
      if (updated.changes === 0) continue

      writeWorkflowEvent(db, {
        workflowInstanceId: row.workflow_instance_id,
        nodeInstanceId: row.id,
        nodeKey: row.node_key,
        eventType: 'node.completed',
        actorType: 'system',
        actorId: actor,
        payload: { reason: 'timer_due', due_at: row.due_at },
        workspaceId: row.workspace_id,
        createdAt: now,
      })
      completed.push({
        workflow_instance_id: row.workflow_instance_id,
        node_instance_id: row.id,
        node_key: row.node_key,
      })
      workflowIds.add(row.workflow_instance_id)
      evaluateWorkflowInstanceInTransaction(db, row.workflow_instance_id, now)
    }
  })()

  const materialized: MaterializeReadyWorkflowNodesResult[] = []
  for (const workflowInstanceId of workflowIds) {
    const context = materializationContextForWorkflow(db, workflowInstanceId)
    if (!context) continue
    materialized.push(materializeReadyWorkflowNodes(db, {
      workflowInstanceId,
      projectId: context.project_id,
      workspaceId: context.workspace_id,
      actor,
      baseRef: baseRefFromWorkspaceSource(context.workspace_source),
      status: input.status ?? 'inbox',
      now,
    }))
  }

  return { completed, materialized }
}

export function materializeReadyWorkflowNodes(
  db: Database.Database,
  input: MaterializeReadyWorkflowNodesInput,
): MaterializeReadyWorkflowNodesResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const finalStatus = input.assignedTo ? 'assigned' : input.status ?? 'inbox'
  const created: MaterializeReadyWorkflowNodesResult['created'] = []
  const skipped: MaterializeReadyWorkflowNodesResult['skipped'] = []
  const broadcastRows: Record<string, unknown>[] = []
  const runnerRequests: Array<{ task_id: number; recipe_slug: string; workspace_id: number }> = []

  db.transaction(() => {
    const context = db.prepare(`
      SELECT wi.id, wi.workflow_key, wi.subject_type, wi.subject_id, wi.workspace_id,
             wd.slug AS definition_slug, wd.name AS definition_name, wd.version AS definition_version
      FROM workflow_instances wi
      JOIN workflow_definitions wd ON wd.id = wi.definition_id
      WHERE wi.id = ? AND wi.workspace_id = ?
    `).get(input.workflowInstanceId, input.workspaceId) as {
      id: number
      workflow_key: string
      subject_type: string
      subject_id: string
      workspace_id: number
      definition_slug: string
      definition_name: string
      definition_version: number
    } | undefined
    if (!context) throw new Error(`Workflow instance ${input.workflowInstanceId} not found`)

    const project = db.prepare(`
      SELECT id FROM projects
      WHERE id = ? AND workspace_id = ? AND status = 'active'
      LIMIT 1
    `).get(input.projectId, input.workspaceId) as { id: number } | undefined
    if (!project) throw new Error(`Project ${input.projectId} not found in workspace ${input.workspaceId}`)

    const nodes = db.prepare(`
      SELECT id, node_key, node_type, status, recipe_slug, task_id, config_json
      FROM workflow_node_instances
      WHERE workflow_instance_id = ?
        AND status = 'ready'
        AND node_type = 'recipe'
      ORDER BY id ASC
    `).all(input.workflowInstanceId) as Array<{
      id: number
      node_key: string
      node_type: WorkflowNodeType
      status: WorkflowNodeStatus
      recipe_slug: string | null
      task_id: number | null
      config_json: string | null
    }>

    for (const node of nodes) {
      if (node.task_id) {
        skipped.push({ node_key: node.node_key, reason: 'already_linked', task_id: node.task_id })
        continue
      }
      if (!node.recipe_slug) {
        skipped.push({ node_key: node.node_key, reason: 'missing_recipe' })
        continue
      }

      db.prepare(`
        UPDATE projects
        SET ticket_counter = ticket_counter + 1, updated_at = unixepoch()
        WHERE id = ? AND workspace_id = ?
      `).run(input.projectId, input.workspaceId)
      const ticket = db.prepare(`
        SELECT ticket_counter FROM projects
        WHERE id = ? AND workspace_id = ?
      `).get(input.projectId, input.workspaceId) as { ticket_counter: number } | undefined
      if (!ticket?.ticket_counter) throw new Error('Failed to allocate project ticket number')

      const title = `[Workflow] ${context.definition_name}: ${titleFromNodeKey(node.node_key)}`
      const metadata = {
        workflow: {
          workflow_instance_id: context.id,
          workflow_key: context.workflow_key,
          definition_slug: context.definition_slug,
          definition_version: context.definition_version,
          subject_type: context.subject_type,
          subject_id: context.subject_id,
          node_instance_id: node.id,
          node_key: node.node_key,
          node_type: node.node_type,
          recipe_slug: node.recipe_slug,
        },
      }

      const task = db.prepare(`
        INSERT INTO tasks (
          title, description, status, priority, project_id, project_ticket_no, assigned_to, created_by,
          created_at, updated_at, due_date, tags, metadata, workspace_id,
          recipe_slug, workspace_source, read_only_mounts, extra_skills, model_override
        ) VALUES (?, ?, ?, 'medium', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, NULL)
      `).run(
        title,
        workflowTaskDescription(context, node),
        finalStatus,
        input.projectId,
        ticket.ticket_counter,
        input.assignedTo ?? null,
        input.actor,
        now,
        now,
        JSON.stringify(['workflow', `workflow:${context.definition_slug}`, `node:${node.node_key}`]),
        JSON.stringify(metadata),
        input.workspaceId,
        node.recipe_slug,
        JSON.stringify({ project_id: input.projectId, base_ref: input.baseRef || 'main' }),
        JSON.stringify([]),
      )
      const taskId = Number(task.lastInsertRowid)

      db.prepare(`
        UPDATE workflow_node_instances
        SET task_id = ?, status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
        WHERE id = ? AND task_id IS NULL AND status = 'ready'
      `).run(taskId, now, now, node.id)

      writeWorkflowEvent(db, {
        workflowInstanceId: context.id,
        nodeInstanceId: node.id,
        taskId,
        nodeKey: node.node_key,
        eventType: 'task.created',
        actorType: 'system',
        actorId: input.actor,
        payload: { task_id: taskId, recipe_slug: node.recipe_slug, status: finalStatus },
        workspaceId: input.workspaceId,
        createdAt: now,
      })

      created.push({ task_id: taskId, node_key: node.node_key, title })
      const row = db.prepare(`
        SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
        WHERE t.id = ? AND t.workspace_id = ?
      `).get(taskId, input.workspaceId) as Record<string, unknown>
      broadcastRows.push(row)
      if (finalStatus === 'assigned') {
        runnerRequests.push({ task_id: taskId, recipe_slug: node.recipe_slug, workspace_id: input.workspaceId })
      }
    }
  })()

  for (const row of broadcastRows) eventBus.broadcast('task.created', row)
  for (const request of runnerRequests) eventBus.broadcast('task.runner_requested', request)

  return {
    workflow_instance_id: input.workflowInstanceId,
    created,
    skipped,
  }
}

export function linkWorkflowNodeToTask(
  db: Database.Database,
  input: {
    workflowInstanceId: number
    nodeKey: string
    taskId: number
    actor: string
    workspaceId: number
    now?: number
  },
): void {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  db.transaction(() => {
    const result = db.prepare(`
      UPDATE workflow_node_instances
      SET task_id = ?, status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
      WHERE workflow_instance_id = ? AND node_key = ? AND status IN ('ready', 'pending', 'blocked')
    `).run(input.taskId, now, now, input.workflowInstanceId, input.nodeKey)
    if (result.changes === 0) return
    const node = db.prepare(`
      SELECT id FROM workflow_node_instances
      WHERE workflow_instance_id = ? AND node_key = ?
    `).get(input.workflowInstanceId, input.nodeKey) as { id: number } | undefined
    writeWorkflowEvent(db, {
      workflowInstanceId: input.workflowInstanceId,
      nodeInstanceId: node?.id ?? null,
      taskId: input.taskId,
      nodeKey: input.nodeKey,
      eventType: 'task.linked',
      actorType: 'system',
      actorId: input.actor,
      payload: { task_id: input.taskId },
      workspaceId: input.workspaceId,
      createdAt: now,
    })
  })()
}

function loadWorkflowForEvaluation(db: Database.Database, workflowInstanceId: number): {
  definition: WorkflowDefinition
  nodes: WorkflowRuntimeNode[]
  workspaceId: number
} {
  const instance = db.prepare(`
    SELECT wi.id, wi.workspace_id, wd.definition_yaml
    FROM workflow_instances wi
    JOIN workflow_definitions wd ON wd.id = wi.definition_id
    WHERE wi.id = ?
  `).get(workflowInstanceId) as { id: number; workspace_id: number; definition_yaml: string } | undefined
  if (!instance) throw new Error(`Workflow instance ${workflowInstanceId} not found`)
  const rows = db.prepare(`
    SELECT node_key, node_type, status, due_at, completed_at, blocked_by_json
    FROM workflow_node_instances
    WHERE workflow_instance_id = ?
  `).all(workflowInstanceId) as Array<{
    node_key: string
    node_type: WorkflowNodeType
    status: WorkflowNodeStatus
    due_at: number | null
    completed_at: number | null
    blocked_by_json: string | null
  }>
  return {
    definition: parseWorkflowDefinition(instance.definition_yaml),
    workspaceId: instance.workspace_id,
    nodes: rows.map((row) => ({
      node_key: row.node_key,
      node_type: row.node_type,
      status: row.status,
      due_at: row.due_at,
      completed_at: row.completed_at,
      blocked_by: parseStringArray(row.blocked_by_json),
    })),
  }
}

function writeWorkflowEvent(
  db: Database.Database,
  input: {
    workflowInstanceId: number
    nodeInstanceId?: number | null
    taskId?: number | null
    nodeKey?: string | null
    eventType: string
    actorType: 'system' | 'human' | 'agent' | 'runner'
    actorId: string
    payload: Record<string, unknown>
    workspaceId: number
    createdAt: number
  },
): void {
  db.prepare(`
    INSERT INTO workflow_events (
      workflow_instance_id, node_instance_id, task_id, node_key, event_type,
      actor_type, actor_id, payload_json, workspace_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.workflowInstanceId,
    input.nodeInstanceId ?? null,
    input.taskId ?? null,
    input.nodeKey ?? null,
    input.eventType,
    input.actorType,
    input.actorId,
    JSON.stringify(input.payload),
    input.workspaceId,
    input.createdAt,
  )
}

function assertWorkflowGraph(definition: WorkflowDefinition): void {
  const nodeKeys = new Set(Object.keys(definition.nodes))
  for (const [nodeKey, node] of Object.entries(definition.nodes)) {
    for (const dependency of node.depends_on ?? []) {
      if (!nodeKeys.has(dependency)) throw new Error(`Workflow node '${nodeKey}' depends on unknown node '${dependency}'`)
    }
  }
  assertAcyclic(definition)
}

function assertAcyclic(definition: WorkflowDefinition): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeKey: string) => {
    if (visited.has(nodeKey)) return
    if (visiting.has(nodeKey)) throw new Error(`Workflow dependency cycle includes '${nodeKey}'`)
    visiting.add(nodeKey)
    for (const dependency of definition.nodes[nodeKey]?.depends_on ?? []) visit(dependency)
    visiting.delete(nodeKey)
    visited.add(nodeKey)
  }
  for (const nodeKey of Object.keys(definition.nodes)) visit(nodeKey)
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function titleFromNodeKey(nodeKey: string): string {
  return nodeKey.replace(/[_-]+/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase())
}

function workflowTaskDescription(
  context: {
    workflow_key: string
    subject_type: string
    subject_id: string
    definition_slug: string
    definition_name: string
    definition_version: number
  },
  node: { node_key: string; node_type: WorkflowNodeType; recipe_slug: string | null },
): string {
  return [
    `Workflow task for ${context.definition_name}.`,
    '',
    `Workflow: ${context.definition_slug} v${context.definition_version}`,
    `Workflow key: ${context.workflow_key}`,
    `Subject: ${context.subject_type}:${context.subject_id}`,
    `Node: ${node.node_key} (${node.node_type})`,
    `Recipe: ${node.recipe_slug ?? 'not set'}`,
    '',
    'Worker contract:',
    '- Read /recipe/PREAMBLE.md and /recipe/SOUL.md before acting.',
    '- Work only inside the mounted /workspace.',
    '- Use task comments/checkpoints for questions, blockers, and final handoff.',
    '- Submit the task through the recipe runner API when complete.',
  ].join('\n')
}

function materializationContextForWorkflow(db: Database.Database, workflowInstanceId: number): {
  project_id: number
  workspace_id: number
  workspace_source: string | null
} | null {
  const row = db.prepare(`
    SELECT t.project_id, t.workspace_id, t.workspace_source
    FROM workflow_node_instances wni
    JOIN tasks t ON t.id = wni.task_id
    WHERE wni.workflow_instance_id = ?
      AND t.project_id IS NOT NULL
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 1
  `).get(workflowInstanceId) as {
    project_id: number | null
    workspace_id: number
    workspace_source: string | null
  } | undefined
  if (!row?.project_id) return null
  return {
    project_id: row.project_id,
    workspace_id: row.workspace_id,
    workspace_source: row.workspace_source,
  }
}

function baseRefFromWorkspaceSource(raw: string | null): string | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return undefined
    const baseRef = (parsed as { base_ref?: unknown }).base_ref
    if (typeof baseRef !== 'string') return undefined
    const trimmed = baseRef.trim()
    return trimmed.length > 0 ? trimmed : undefined
  } catch {
    return undefined
  }
}
