import type Database from 'better-sqlite3'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { eventBus } from '@/lib/event-bus'

const durationPattern = /^(\d+)(s|m|h|d)$/

const dependencyTimerSchema = z.object({
  after: z.string().min(1),
  duration: z.string().regex(durationPattern),
  key: z.string().min(1).optional(),
})

const nodeDependencySemanticsSchema = z.enum([
  'blocks',
  'waits_for_all',
  'waits_for_any',
  'conditional_on_failure',
  'related',
])

const dependencyNodeSchema = z.union([
  z.string().min(1),
  z.object({
    node: z.string().min(1),
    type: nodeDependencySemanticsSchema.default('blocks'),
    group: z.string().min(1).optional(),
  }),
])

const dependsOnSchema = z.union([
  z.array(dependencyNodeSchema),
  z.object({
    nodes: z.array(dependencyNodeSchema).default([]),
    conditions: z.array(z.string().min(1)).default([]),
    timers: z.array(dependencyTimerSchema).default([]),
  }),
]).default([])

const workflowTriggerSchema = z.object({
  type: z.enum(['manual', 'condition', 'event', 'cooldown', 'cron']),
  condition: z.string().min(1).optional(),
  on: z.string().min(1).optional(),
  interval: z.string().regex(durationPattern).optional(),
  schedule: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
}).superRefine((trigger, ctx) => {
  if (trigger.type === 'condition' && !trigger.condition) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['condition'], message: 'condition triggers require condition' })
  }
  if (trigger.type === 'event' && !trigger.on) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['on'], message: 'event triggers require on' })
  }
  if (trigger.type === 'cooldown' && !trigger.interval) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['interval'], message: 'cooldown triggers require interval' })
  }
  if (trigger.type === 'cron' && !trigger.schedule) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule'], message: 'cron triggers require schedule' })
  }
})

const workflowVarValueSchema = z.union([z.string(), z.number(), z.boolean()])

const workflowVarSchema = z.union([
  workflowVarValueSchema,
  z.object({
    description: z.string().min(1).optional(),
    default: workflowVarValueSchema.optional(),
    required: z.boolean().default(false),
    enum: z.array(workflowVarValueSchema).optional(),
    pattern: z.string().min(1).optional(),
    type: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
  }),
])

const workflowNodeSchema = z.object({
  type: z.enum(['recipe', 'review', 'wait', 'code', 'gateway', 'gate']),
  name: z.string().min(1).max(200).optional(),
  description: z.string().min(1).optional(),
  description_file: z.string().min(1).optional(),
  recipe: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  depends_on: dependsOnSchema,
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
  vars: z.record(z.string(), workflowVarSchema).default({}),
  triggers: z.array(workflowTriggerSchema).min(1).default([{ type: 'manual', enabled: true, config: {} }]),
  nodes: z.record(z.string().min(1), workflowNodeSchema).refine((nodes) => Object.keys(nodes).length > 0, {
    message: 'workflow must define at least one node',
  }),
})

export type WorkflowNodeType = 'recipe' | 'review' | 'wait' | 'code' | 'gateway' | 'gate'
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>
export type WorkflowDefinitionNode = WorkflowDefinition['nodes'][string]
export type WorkflowNodeStatus = 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'complete' | 'failed' | 'skipped' | 'cancelled'
export type WorkflowInstanceStatus = 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'
export type WorkflowNodeDependencyStatus = 'pending' | 'scheduled' | 'satisfied' | 'cancelled'
export type WorkflowNodeDependencySemantics = z.infer<typeof nodeDependencySemanticsSchema>
export type NormalizedWorkflowNodeDependency = {
  node: string
  type: WorkflowNodeDependencySemantics
  group?: string
}
export type NormalizedWorkflowDependencies = {
  nodes: NormalizedWorkflowNodeDependency[]
  conditions: string[]
  timers: Array<{ after: string; duration: string; key?: string }>
}

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

export type CancelWorkflowInstanceResult = {
  workflow_instance_id: number
  cancelled_nodes: number
} | null

export type BypassWorkflowNodeInput = {
  workflowInstanceId: number
  nodeKey: string
  actor: string
  workspaceId: number
  reason?: string
  now?: number
}

export type BypassWorkflowNodeResult = {
  workflow_instance_id: number
  node_instance_id: number
  node_key: string
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

export type CancelWorkflowInstanceInput = {
  workflowInstanceId: number
  actor: string
  workspaceId: number
  reason?: string
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

export type SatisfyWorkflowConditionInput = {
  subjectType: string
  subjectId: string
  condition: string
  actor: string
  workspaceId: number
  payload?: Record<string, unknown>
  status?: 'inbox' | 'assigned'
  now?: number
}

export type SatisfyWorkflowConditionResult = {
  dependency_key: string
  satisfied_dependencies: number
  promoted_nodes: Array<{ workflow_instance_id: number; node_instance_id: number; node_key: string; status: WorkflowNodeStatus }>
  materialized: MaterializeReadyWorkflowNodesResult[]
}

export type RunWorkflowTriggersInput = {
  subjectType: string
  subjectId: string
  triggerType: 'condition' | 'event' | 'cooldown' | 'cron'
  condition?: string
  event?: string
  projectId?: number
  baseRef?: string
  assignedTo?: string | null
  status?: 'inbox' | 'assigned'
  actor: string
  workspaceId: number
  tenantId?: number
  now?: number
}

export type RunWorkflowTriggersResult = {
  matched: number
  started: Array<{ workflow_instance_id: number; definition_id: number; definition_slug: string; workflow_key: string }>
  skipped: Array<{ definition_id: number; definition_slug: string; reason: string; workflow_instance_id?: number | null }>
  materialized: MaterializeReadyWorkflowNodesResult[]
}

export type WorkflowActivity = {
  workflow_instance_id: number
  workflow_key: string
  definition_id: number
  definition_slug: string
  definition_name: string
  definition_version: number
  subject_type: string
  subject_id: string
  status: WorkflowInstanceStatus
  started_by: string
  started_at: number
  completed_at: number | null
  updated_at: number
  total_nodes: number
  ready_nodes: number
  running_nodes: number
  waiting_nodes: number
  blocked_nodes: number
  complete_nodes: number
  failed_nodes: number
  task_count: number
  nodes: Array<{
    id: number
    node_key: string
    node_type: WorkflowNodeType
    status: WorkflowNodeStatus
    recipe_slug: string | null
    task_id: number | null
    due_at: number | null
    completed_at: number | null
    blocked_by: string[]
  }>
}

function normalizeWorkflowDefinitionInput(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed
  const raw = parsed as Record<string, unknown>
  const normalized = { ...raw }
  if (!Array.isArray(normalized.triggers)) {
    const legacyTrigger = normalized.trigger
    normalized.triggers = legacyTrigger && typeof legacyTrigger === 'object'
      ? [normalizeWorkflowTriggerInput(legacyTrigger)]
      : [{ type: 'manual' }]
  } else {
    normalized.triggers = normalized.triggers.map(normalizeWorkflowTriggerInput)
  }
  delete normalized.trigger
  return normalized
}

function normalizeWorkflowTriggerInput(trigger: unknown): unknown {
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return trigger
  const raw = trigger as Record<string, unknown>
  if (raw.type === 'event' && !raw.on && typeof raw.event === 'string') {
    return { ...raw, on: raw.event }
  }
  if (raw.type === 'cooldown' && !raw.interval && typeof raw.duration === 'string') {
    return { ...raw, interval: raw.duration }
  }
  return raw
}

function workflowTriggerMatches(
  trigger: WorkflowDefinition['triggers'][number],
  input: RunWorkflowTriggersInput,
): boolean {
  if (!trigger.enabled || trigger.type !== input.triggerType) return false
  if (trigger.type === 'condition') return Boolean(input.condition) && trigger.condition === input.condition
  if (trigger.type === 'event') return Boolean(input.event) && trigger.on === input.event
  if (trigger.type === 'cooldown') return input.triggerType === 'cooldown'
  if (trigger.type === 'cron') return input.triggerType === 'cron'
  return false
}

export function parseWorkflowDefinition(raw: string): WorkflowDefinition {
  const parsed = normalizeWorkflowDefinitionInput(parseYaml(raw))
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
    if (!normalizedNodeDependenciesSatisfied(normalizeDependsOn(node.depends_on).nodes, runtimeByKey)) continue
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

export function runWorkflowTriggers(
  db: Database.Database,
  input: RunWorkflowTriggersInput,
): RunWorkflowTriggersResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const rows = db.prepare(`
    SELECT id, slug, name, version, subject_type, definition_yaml
    FROM workflow_definitions
    WHERE workspace_id = ?
      AND status = 'active'
      AND subject_type IN (?, 'generic')
    ORDER BY slug ASC, version DESC, id DESC
  `).all(input.workspaceId, input.subjectType) as Array<{
    id: number
    slug: string
    name: string
    version: number
    subject_type: string
    definition_yaml: string
  }>

  const started: RunWorkflowTriggersResult['started'] = []
  const skipped: RunWorkflowTriggersResult['skipped'] = []
  const materialized: MaterializeReadyWorkflowNodesResult[] = []
  let matched = 0

  for (const row of rows) {
    const definition = parseWorkflowDefinition(row.definition_yaml)
    if (!definition.triggers.some((trigger) => workflowTriggerMatches(trigger, input))) continue
    matched += 1
    const workflowKey = `${definition.id}:${input.subjectType}:${input.subjectId}`
    const existing = db.prepare(`
      SELECT id, status
      FROM workflow_instances
      WHERE workspace_id = ?
        AND workflow_key = ?
      LIMIT 1
    `).get(input.workspaceId, workflowKey) as { id: number; status: WorkflowInstanceStatus } | undefined
    if (existing && existing.status !== 'cancelled' && existing.status !== 'failed') {
      skipped.push({ definition_id: row.id, definition_slug: row.slug, reason: `existing_${existing.status}`, workflow_instance_id: existing.id })
      continue
    }

    const startedInstance = startWorkflowInstance(db, {
      definitionId: row.id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      workflowKey,
      actor: input.actor,
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      now,
    })
    started.push({
      workflow_instance_id: startedInstance.instance_id,
      definition_id: row.id,
      definition_slug: row.slug,
      workflow_key: workflowKey,
    })
    if (input.projectId) {
      materialized.push(materializeReadyWorkflowNodes(db, {
        workflowInstanceId: startedInstance.instance_id,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        actor: input.actor,
        baseRef: input.baseRef,
        assignedTo: input.assignedTo,
        status: input.status ?? 'inbox',
        now,
      }))
    }
  }

  return { matched, started, skipped, materialized }
}

export function listWorkflowActivity(
  db: Database.Database,
  input: {
    subjectType: string
    subjectId: string
    workspaceId: number
    limit?: number
  },
): WorkflowActivity[] {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200))
  const rows = db.prepare(`
    SELECT wi.id, wi.workflow_key, wi.definition_id, wi.subject_type, wi.subject_id,
           wi.status, wi.started_by, wi.started_at, wi.completed_at, wi.updated_at,
           wd.slug AS definition_slug, wd.name AS definition_name, wd.version AS definition_version
    FROM workflow_instances wi
    JOIN workflow_definitions wd ON wd.id = wi.definition_id
    WHERE wi.workspace_id = ?
      AND wi.subject_type = ?
      AND wi.subject_id = ?
    ORDER BY wi.updated_at DESC, wi.id DESC
    LIMIT ?
  `).all(input.workspaceId, input.subjectType, input.subjectId, limit) as Array<{
    id: number
    workflow_key: string
    definition_id: number
    subject_type: string
    subject_id: string
    status: WorkflowInstanceStatus
    started_by: string
    started_at: number
    completed_at: number | null
    updated_at: number
    definition_slug: string
    definition_name: string
    definition_version: number
  }>

  const nodeStmt = db.prepare(`
    SELECT id, node_key, node_type, status, recipe_slug, task_id, due_at, completed_at, blocked_by_json
    FROM workflow_node_instances
    WHERE workflow_instance_id = ?
    ORDER BY id ASC
  `)
  const blockerStmt = db.prepare(`
    SELECT node_instance_id, dependency_type, dependency_key, source_node_key, status, due_at
    FROM workflow_node_dependencies
    WHERE workflow_instance_id = ?
      AND status IN ('pending', 'scheduled')
      AND dependency_semantics IN ('blocks', 'waits_for_all', 'conditional_on_failure', 'waits_for_any')
    ORDER BY id ASC
  `)

  return rows.map((row) => {
    const nodes = nodeStmt.all(row.id) as Array<{
      id: number
      node_key: string
      node_type: WorkflowNodeType
      status: WorkflowNodeStatus
      recipe_slug: string | null
      task_id: number | null
      due_at: number | null
      completed_at: number | null
      blocked_by_json: string | null
    }>
    const blockers = blockerStmt.all(row.id) as Array<{
      node_instance_id: number
      dependency_type: 'node' | 'condition' | 'timer'
      dependency_key: string
      source_node_key: string | null
      status: WorkflowNodeDependencyStatus
      due_at: number | null
    }>
    const blockersByNode = new Map<number, string[]>()
    for (const blocker of blockers) {
      blockersByNode.set(blocker.node_instance_id, [
        ...(blockersByNode.get(blocker.node_instance_id) ?? []),
        workflowDependencyBlockerLabel(blocker),
      ])
    }
    const mappedNodes = nodes.map((node) => ({
      id: node.id,
      node_key: node.node_key,
      node_type: node.node_type,
      status: node.status,
      recipe_slug: node.recipe_slug,
      task_id: node.task_id,
      due_at: node.due_at,
      completed_at: node.completed_at,
      blocked_by: uniqueStrings([
        ...parseStringArray(node.blocked_by_json),
        ...(blockersByNode.get(node.id) ?? []),
      ]),
    }))
    return {
      workflow_instance_id: row.id,
      workflow_key: row.workflow_key,
      definition_id: row.definition_id,
      definition_slug: row.definition_slug,
      definition_name: row.definition_name,
      definition_version: row.definition_version,
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      status: row.status,
      started_by: row.started_by,
      started_at: row.started_at,
      completed_at: row.completed_at,
      updated_at: row.updated_at,
      total_nodes: mappedNodes.length,
      ready_nodes: mappedNodes.filter((node) => node.status === 'ready').length,
      running_nodes: mappedNodes.filter((node) => node.status === 'running').length,
      waiting_nodes: mappedNodes.filter((node) => node.status === 'waiting').length,
      blocked_nodes: mappedNodes.filter((node) => node.status === 'blocked').length,
      complete_nodes: mappedNodes.filter((node) => node.status === 'complete').length,
      failed_nodes: mappedNodes.filter((node) => node.status === 'failed').length,
      task_count: mappedNodes.filter((node) => node.task_id !== null).length,
      nodes: mappedNodes,
    }
  })
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
        JSON.stringify({
          ...node.config,
          description: node.description ?? null,
          description_file: node.description_file ?? null,
          review: node.review ?? null,
          duration: node.duration ?? null,
          until: node.until ?? null,
          exit_when: node.exit_when ?? null,
          completes: node.completes ?? [],
        }),
        now,
        now,
      )
    }

    seedWorkflowDependencies(db, {
      workflowInstanceId: instanceId,
      definition,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      workspaceId: input.workspaceId,
      now,
    })

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
  return promoteEligibleWorkflowNodesInTransaction(db, workflowInstanceId, now)
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
      satisfyNodeDependencyInTransaction(db, {
        workflowInstanceId: node.workflow_instance_id,
        nodeKey: node.node_key,
        actor,
        payload: { source_task_id: taskId, ...payload },
        now,
      })
    }
    const readyNodes = evaluateWorkflowInstanceInTransaction(db, node.workflow_instance_id, now)
    updateWorkflowInstanceCompletionInTransaction(db, node.workflow_instance_id, node.workspace_id, actor, now)
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

export function cancelWorkflowInstance(
  db: Database.Database,
  input: CancelWorkflowInstanceInput,
): CancelWorkflowInstanceResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  let result: CancelWorkflowInstanceResult = null

  db.transaction(() => {
    const instance = db.prepare(`
      SELECT id, status
      FROM workflow_instances
      WHERE id = ? AND workspace_id = ?
      LIMIT 1
    `).get(input.workflowInstanceId, input.workspaceId) as { id: number; status: WorkflowInstanceStatus } | undefined
    if (!instance) return

    const updated = db.prepare(`
      UPDATE workflow_instances
      SET status = 'cancelled', completed_at = COALESCE(completed_at, ?), updated_at = ?
      WHERE id = ? AND workspace_id = ? AND status NOT IN ('complete', 'cancelled')
    `).run(now, now, input.workflowInstanceId, input.workspaceId)

    const nodes = db.prepare(`
      UPDATE workflow_node_instances
      SET status = 'cancelled', updated_at = ?
      WHERE workflow_instance_id = ?
        AND status NOT IN ('complete', 'skipped', 'cancelled')
    `).run(now, input.workflowInstanceId)

    db.prepare(`
      UPDATE workflow_node_dependencies
      SET status = 'cancelled', updated_at = ?
      WHERE workflow_instance_id = ?
        AND status IN ('pending', 'scheduled')
    `).run(now, input.workflowInstanceId)

    if (updated.changes > 0 || nodes.changes > 0) {
      writeWorkflowEvent(db, {
        workflowInstanceId: input.workflowInstanceId,
        eventType: 'workflow.cancelled',
        actorType: 'human',
        actorId: input.actor,
        payload: { reason: input.reason ?? null },
        workspaceId: input.workspaceId,
        createdAt: now,
      })
    }

    result = {
      workflow_instance_id: input.workflowInstanceId,
      cancelled_nodes: nodes.changes,
    }
  })()

  return result
}

export function bypassWorkflowNode(
  db: Database.Database,
  input: BypassWorkflowNodeInput,
): BypassWorkflowNodeResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  let result: BypassWorkflowNodeResult = null

  db.transaction(() => {
    const node = db.prepare(`
      SELECT wni.id, wni.workflow_instance_id, wni.node_key, wni.status, wi.workspace_id
      FROM workflow_node_instances wni
      JOIN workflow_instances wi ON wi.id = wni.workflow_instance_id
      WHERE wni.workflow_instance_id = ?
        AND wni.node_key = ?
        AND wi.workspace_id = ?
      LIMIT 1
    `).get(input.workflowInstanceId, input.nodeKey, input.workspaceId) as {
      id: number
      workflow_instance_id: number
      node_key: string
      status: WorkflowNodeStatus
      workspace_id: number
    } | undefined
    if (!node) return
    if (['complete', 'skipped', 'cancelled'].includes(node.status)) {
      result = {
        workflow_instance_id: node.workflow_instance_id,
        node_instance_id: node.id,
        node_key: node.node_key,
        ready_nodes: [],
      }
      return
    }

    const reason = input.reason ?? 'Marked not applicable.'
    const updated = db.prepare(`
      UPDATE workflow_node_instances
      SET status = 'skipped',
          completed_at = COALESCE(completed_at, ?),
          output_json = ?,
          updated_at = ?
      WHERE id = ?
        AND status NOT IN ('complete', 'skipped', 'cancelled')
    `).run(now, JSON.stringify({ reason, bypassed_by: input.actor }), now, node.id)
    if (updated.changes === 0) return

    db.prepare(`
      UPDATE workflow_node_dependencies
      SET status = 'cancelled', updated_at = ?
      WHERE node_instance_id = ?
        AND status IN ('pending', 'scheduled')
    `).run(now, node.id)

    writeWorkflowEvent(db, {
      workflowInstanceId: node.workflow_instance_id,
      nodeInstanceId: node.id,
      nodeKey: node.node_key,
      eventType: 'node.skipped',
      actorType: 'human',
      actorId: input.actor,
      payload: { reason },
      workspaceId: node.workspace_id,
      createdAt: now,
    })
    satisfyNodeDependencyInTransaction(db, {
      workflowInstanceId: node.workflow_instance_id,
      nodeKey: node.node_key,
      actor: input.actor,
      payload: { reason: 'node_bypassed', bypass_reason: reason },
      now,
    })
    const readyNodes = evaluateWorkflowInstanceInTransaction(db, node.workflow_instance_id, now)
    updateWorkflowInstanceCompletionInTransaction(db, node.workflow_instance_id, node.workspace_id, input.actor, now)
    result = {
      workflow_instance_id: node.workflow_instance_id,
      node_instance_id: node.id,
      node_key: node.node_key,
      ready_nodes: readyNodes,
    }
  })()

  return result
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
      SELECT wnd.id, wnd.workflow_instance_id, wnd.node_instance_id, wnd.node_key, wnd.due_at, wnd.workspace_id
      FROM workflow_node_dependencies wnd
      JOIN workflow_instances wi ON wi.id = wnd.workflow_instance_id
      WHERE wnd.dependency_type = 'timer'
        AND wnd.status = 'scheduled'
        AND wnd.due_at IS NOT NULL
        AND wnd.due_at <= ?
        AND wi.status = 'active'
        ${input.workspaceId ? 'AND wnd.workspace_id = ?' : ''}
      ORDER BY wnd.due_at ASC, wnd.id ASC
      LIMIT ?
    `).all(...(input.workspaceId ? [now, input.workspaceId, limit] : [now, limit])) as Array<{
      id: number
      workflow_instance_id: number
      node_instance_id: number
      node_key: string
      due_at: number
      workspace_id: number
    }>

    for (const row of rows) {
      const updated = db.prepare(`
        UPDATE workflow_node_dependencies
        SET status = 'satisfied', satisfied_at = COALESCE(satisfied_at, ?), payload_json = ?, updated_at = ?
        WHERE id = ? AND status = 'scheduled' AND due_at IS NOT NULL AND due_at <= ?
      `).run(now, JSON.stringify({ reason: 'timer_due', due_at: row.due_at }), now, row.id, now)
      if (updated.changes === 0) continue

      writeWorkflowEvent(db, {
        workflowInstanceId: row.workflow_instance_id,
        nodeInstanceId: row.node_instance_id,
        nodeKey: row.node_key,
        eventType: 'dependency.satisfied',
        actorType: 'system',
        actorId: actor,
        payload: { dependency_type: 'timer', reason: 'timer_due', due_at: row.due_at },
        workspaceId: row.workspace_id,
        createdAt: now,
      })
      completed.push({
        workflow_instance_id: row.workflow_instance_id,
        node_instance_id: row.node_instance_id,
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

export function satisfyWorkflowCondition(
  db: Database.Database,
  input: SatisfyWorkflowConditionInput,
): SatisfyWorkflowConditionResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const dependencyKey = conditionDependencyKey(input.subjectType, input.subjectId, input.condition)
  const promotedNodes: SatisfyWorkflowConditionResult['promoted_nodes'] = []
  const workflowIds = new Set<number>()
  let satisfiedDependencies = 0

  db.transaction(() => {
    const rows = db.prepare(`
      SELECT id, workflow_instance_id, node_instance_id, node_key, workspace_id
      FROM workflow_node_dependencies
      WHERE workspace_id = ?
        AND dependency_type = 'condition'
        AND dependency_key = ?
        AND status IN ('pending', 'scheduled')
    `).all(input.workspaceId, dependencyKey) as Array<{
      id: number
      workflow_instance_id: number
      node_instance_id: number
      node_key: string
      workspace_id: number
    }>

    for (const row of rows) {
      const updated = db.prepare(`
        UPDATE workflow_node_dependencies
        SET status = 'satisfied', satisfied_at = COALESCE(satisfied_at, ?), payload_json = ?, updated_at = ?
        WHERE id = ? AND status IN ('pending', 'scheduled')
      `).run(now, JSON.stringify(input.payload ?? {}), now, row.id)
      if (updated.changes === 0) continue
      satisfiedDependencies += 1
      writeWorkflowEvent(db, {
        workflowInstanceId: row.workflow_instance_id,
        nodeInstanceId: row.node_instance_id,
        nodeKey: row.node_key,
        eventType: 'dependency.satisfied',
        actorType: 'system',
        actorId: input.actor,
        payload: { dependency_type: 'condition', dependency_key: dependencyKey, condition: input.condition, ...(input.payload ?? {}) },
        workspaceId: row.workspace_id,
        createdAt: now,
      })
      workflowIds.add(row.workflow_instance_id)
    }

    for (const workflowInstanceId of workflowIds) {
      const ready = promoteEligibleWorkflowNodesInTransaction(db, workflowInstanceId, now)
      for (const nodeKey of ready) {
        const node = db.prepare(`
          SELECT id, status FROM workflow_node_instances
          WHERE workflow_instance_id = ? AND node_key = ?
        `).get(workflowInstanceId, nodeKey) as { id: number; status: WorkflowNodeStatus } | undefined
        if (node) promotedNodes.push({ workflow_instance_id: workflowInstanceId, node_instance_id: node.id, node_key: nodeKey, status: node.status })
      }
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
      actor: input.actor,
      baseRef: baseRefFromWorkspaceSource(context.workspace_source),
      status: input.status ?? 'inbox',
      now,
    }))
  }

  return {
    dependency_key: dependencyKey,
    satisfied_dependencies: satisfiedDependencies,
    promoted_nodes: promotedNodes,
    materialized,
  }
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

function seedWorkflowDependencies(
  db: Database.Database,
  input: {
    workflowInstanceId: number
    definition: WorkflowDefinition
    subjectType: string
    subjectId: string
    workspaceId: number
    now: number
  },
): void {
  const nodeRows = db.prepare(`
    SELECT id, node_key
    FROM workflow_node_instances
    WHERE workflow_instance_id = ?
  `).all(input.workflowInstanceId) as Array<{ id: number; node_key: string }>
  const nodeIdByKey = new Map(nodeRows.map((row) => [row.node_key, row.id]))

  for (const [nodeKey, node] of Object.entries(input.definition.nodes)) {
    const nodeInstanceId = nodeIdByKey.get(nodeKey)
    if (!nodeInstanceId) continue
    const dependencies = normalizeDependsOn(node.depends_on)
    const timerDependencies = [...dependencies.timers]
    if (node.type === 'wait' && node.duration) {
      timerDependencies.push({ after: nodeKey, duration: node.duration, key: 'wait-duration' })
    }

    for (const dependency of dependencies.nodes) {
      insertWorkflowDependency(db, {
        workflowInstanceId: input.workflowInstanceId,
        nodeInstanceId,
        nodeKey,
        dependencyType: 'node',
        dependencyKey: nodeDependencyKey(dependency.node),
        dependencySemantics: dependency.type,
        dependencyGroup: dependency.group ?? (dependency.type === 'waits_for_any' ? `any:${nodeKey}` : null),
        sourceNodeKey: dependency.node,
        workspaceId: input.workspaceId,
        now: input.now,
      })
    }

    for (const condition of dependencies.conditions) {
      insertWorkflowDependency(db, {
        workflowInstanceId: input.workflowInstanceId,
        nodeInstanceId,
        nodeKey,
        dependencyType: 'condition',
        dependencyKey: conditionDependencyKey(input.subjectType, input.subjectId, condition),
        dependencySemantics: 'blocks',
        workspaceId: input.workspaceId,
        now: input.now,
      })
    }

    for (const timer of timerDependencies) {
      insertWorkflowDependency(db, {
        workflowInstanceId: input.workflowInstanceId,
        nodeInstanceId,
        nodeKey,
        dependencyType: 'timer',
        dependencyKey: timerDependencyKey(input.workflowInstanceId, nodeKey, timer),
        dependencySemantics: 'blocks',
        sourceNodeKey: timer.after === nodeKey ? null : timer.after,
        durationSeconds: durationToSeconds(timer.duration),
        workspaceId: input.workspaceId,
        now: input.now,
      })
    }
  }
}

function insertWorkflowDependency(
  db: Database.Database,
  input: {
    workflowInstanceId: number
    nodeInstanceId: number
    nodeKey: string
    dependencyType: 'node' | 'condition' | 'timer'
    dependencyKey: string
    dependencySemantics?: WorkflowNodeDependencySemantics
    dependencyGroup?: string | null
    sourceNodeKey?: string | null
    durationSeconds?: number | null
    workspaceId: number
    now: number
  },
): void {
  db.prepare(`
    INSERT OR IGNORE INTO workflow_node_dependencies (
      workflow_instance_id, node_instance_id, node_key, dependency_type, dependency_key,
      dependency_semantics, dependency_group, source_node_key, duration_seconds, workspace_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.workflowInstanceId,
    input.nodeInstanceId,
    input.nodeKey,
    input.dependencyType,
    input.dependencyKey,
    input.dependencySemantics ?? 'blocks',
    input.dependencyGroup ?? null,
    input.sourceNodeKey ?? null,
    input.durationSeconds ?? null,
    input.workspaceId,
    input.now,
    input.now,
  )
}

function satisfyNodeDependencyInTransaction(
  db: Database.Database,
  input: {
    workflowInstanceId: number
    nodeKey: string
    actor: string
    payload: Record<string, unknown>
    now: number
  },
): void {
  const rows = db.prepare(`
    SELECT id, node_instance_id, node_key, workspace_id
    FROM workflow_node_dependencies
    WHERE workflow_instance_id = ?
      AND dependency_type = 'node'
      AND dependency_key = ?
      AND status IN ('pending', 'scheduled')
  `).all(input.workflowInstanceId, nodeDependencyKey(input.nodeKey)) as Array<{
    id: number
    node_instance_id: number
    node_key: string
    workspace_id: number
  }>

  for (const row of rows) {
    const updated = db.prepare(`
      UPDATE workflow_node_dependencies
      SET status = 'satisfied', satisfied_at = COALESCE(satisfied_at, ?), payload_json = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'scheduled')
    `).run(input.now, JSON.stringify(input.payload), input.now, row.id)
    if (updated.changes === 0) continue
    writeWorkflowEvent(db, {
      workflowInstanceId: input.workflowInstanceId,
      nodeInstanceId: row.node_instance_id,
      nodeKey: row.node_key,
      eventType: 'dependency.satisfied',
      actorType: 'system',
      actorId: input.actor,
      payload: { dependency_type: 'node', source_node_key: input.nodeKey, ...input.payload },
      workspaceId: row.workspace_id,
      createdAt: input.now,
    })
  }

  scheduleTimerDependenciesForSourceNode(db, {
    workflowInstanceId: input.workflowInstanceId,
    sourceNodeKey: input.nodeKey,
    referenceAt: input.now,
    actor: input.actor,
    now: input.now,
  })
}

function scheduleTimerDependenciesForSourceNode(
  db: Database.Database,
  input: {
    workflowInstanceId: number
    sourceNodeKey: string
    referenceAt: number
    actor: string
    now: number
  },
): void {
  const rows = db.prepare(`
    SELECT id, node_instance_id, node_key, duration_seconds, workspace_id
    FROM workflow_node_dependencies
    WHERE workflow_instance_id = ?
      AND dependency_type = 'timer'
      AND source_node_key = ?
      AND status = 'pending'
  `).all(input.workflowInstanceId, input.sourceNodeKey) as Array<{
    id: number
    node_instance_id: number
    node_key: string
    duration_seconds: number | null
    workspace_id: number
  }>

  for (const row of rows) {
    if (!row.duration_seconds) continue
    const dueAt = input.referenceAt + row.duration_seconds
    const updated = db.prepare(`
      UPDATE workflow_node_dependencies
      SET status = 'scheduled', reference_at = COALESCE(reference_at, ?), due_at = COALESCE(due_at, ?), updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(input.referenceAt, dueAt, input.now, row.id)
    if (updated.changes === 0) continue
    writeWorkflowEvent(db, {
      workflowInstanceId: input.workflowInstanceId,
      nodeInstanceId: row.node_instance_id,
      nodeKey: row.node_key,
      eventType: 'dependency.timer_scheduled',
      actorType: 'system',
      actorId: input.actor,
      payload: { source_node_key: input.sourceNodeKey, reference_at: input.referenceAt, due_at: dueAt, duration_seconds: row.duration_seconds },
      workspaceId: row.workspace_id,
      createdAt: input.now,
    })
  }
}

function scheduleSelfTimersForDependencyReadyNodes(
  db: Database.Database,
  workflowInstanceId: number,
  now: number,
): void {
  const rows = db.prepare(`
    SELECT wnd.id, wnd.node_instance_id, wnd.node_key, wnd.duration_seconds, wnd.workspace_id
    FROM workflow_node_dependencies wnd
    JOIN workflow_node_instances wni ON wni.id = wnd.node_instance_id
    WHERE wnd.workflow_instance_id = ?
      AND wnd.dependency_type = 'timer'
      AND wnd.source_node_key IS NULL
      AND wnd.status = 'pending'
      AND wni.status IN ('pending', 'blocked')
      AND NOT EXISTS (
        SELECT 1
        FROM workflow_node_dependencies other
        WHERE other.node_instance_id = wnd.node_instance_id
          AND other.id != wnd.id
          AND other.dependency_semantics IN ('blocks', 'waits_for_all', 'conditional_on_failure')
          AND other.status != 'satisfied'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM workflow_node_dependencies any_dep
        WHERE any_dep.node_instance_id = wnd.node_instance_id
          AND any_dep.id != wnd.id
          AND any_dep.dependency_semantics = 'waits_for_any'
        GROUP BY COALESCE(any_dep.dependency_group, any_dep.dependency_key)
        HAVING SUM(CASE WHEN any_dep.status = 'satisfied' THEN 1 ELSE 0 END) = 0
      )
  `).all(workflowInstanceId) as Array<{
    id: number
    node_instance_id: number
    node_key: string
    duration_seconds: number | null
    workspace_id: number
  }>

  for (const row of rows) {
    if (!row.duration_seconds) continue
    const dueAt = now + row.duration_seconds
    const updated = db.prepare(`
      UPDATE workflow_node_dependencies
      SET status = 'scheduled', reference_at = COALESCE(reference_at, ?), due_at = COALESCE(due_at, ?), updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(now, dueAt, now, row.id)
    if (updated.changes === 0) continue
    db.prepare(`
      UPDATE workflow_node_instances
      SET status = 'waiting', due_at = COALESCE(due_at, ?), updated_at = ?
      WHERE id = ? AND status IN ('pending', 'blocked')
    `).run(dueAt, now, row.node_instance_id)
    writeWorkflowEvent(db, {
      workflowInstanceId,
      nodeInstanceId: row.node_instance_id,
      nodeKey: row.node_key,
      eventType: 'node.waiting',
      actorType: 'system',
      actorId: 'workflow-engine',
      payload: { due_at: dueAt, duration_seconds: row.duration_seconds },
      workspaceId: row.workspace_id,
      createdAt: now,
    })
  }
}

function promoteEligibleWorkflowNodesInTransaction(
  db: Database.Database,
  workflowInstanceId: number,
  now: number,
): string[] {
  const promoted: string[] = []
  let workspaceId = 1
  for (;;) {
    scheduleSelfTimersForDependencyReadyNodes(db, workflowInstanceId, now)
    const rows = db.prepare(`
      SELECT wni.id, wni.node_key, wni.node_type, wni.status, wi.workspace_id
      FROM workflow_node_instances wni
      JOIN workflow_instances wi ON wi.id = wni.workflow_instance_id
      WHERE wni.workflow_instance_id = ?
        AND wni.status IN ('pending', 'blocked', 'waiting')
        AND NOT EXISTS (
          SELECT 1
          FROM workflow_node_dependencies wnd
          WHERE wnd.node_instance_id = wni.id
            AND wnd.dependency_semantics IN ('blocks', 'waits_for_all', 'conditional_on_failure')
            AND wnd.status != 'satisfied'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM workflow_node_dependencies any_dep
          WHERE any_dep.node_instance_id = wni.id
            AND any_dep.dependency_semantics = 'waits_for_any'
          GROUP BY COALESCE(any_dep.dependency_group, any_dep.dependency_key)
          HAVING SUM(CASE WHEN any_dep.status = 'satisfied' THEN 1 ELSE 0 END) = 0
        )
      ORDER BY wni.id ASC
    `).all(workflowInstanceId) as Array<{
      id: number
      node_key: string
      node_type: WorkflowNodeType
      status: WorkflowNodeStatus
      workspace_id: number
    }>
    if (rows.length === 0) break

    let completedAutomaticNode = false
    for (const row of rows) {
      workspaceId = row.workspace_id
      const nextStatus: WorkflowNodeStatus = ['wait', 'gateway', 'gate'].includes(row.node_type) ? 'complete' : 'ready'
      const updated = db.prepare(`
        UPDATE workflow_node_instances
        SET status = ?, completed_at = CASE WHEN ? = 'complete' THEN COALESCE(completed_at, ?) ELSE completed_at END,
            blocked_by_json = '[]', updated_at = ?
        WHERE id = ? AND status IN ('pending', 'blocked', 'waiting')
      `).run(nextStatus, nextStatus, now, now, row.id)
      if (updated.changes === 0) continue
      promoted.push(row.node_key)
      writeWorkflowEvent(db, {
        workflowInstanceId,
        nodeInstanceId: row.id,
        nodeKey: row.node_key,
        eventType: nextStatus === 'complete' ? 'node.completed' : 'node.ready',
        actorType: 'system',
        actorId: 'workflow-engine',
        payload: { node_key: row.node_key, node_type: row.node_type },
        workspaceId: row.workspace_id,
        createdAt: now,
      })
      if (nextStatus === 'complete') {
        completedAutomaticNode = true
        satisfyNodeDependencyInTransaction(db, {
          workflowInstanceId,
          nodeKey: row.node_key,
          actor: 'workflow-engine',
          payload: { reason: 'wait_node_complete' },
          now,
        })
      }
    }
    if (!completedAutomaticNode) break
  }
  updateWorkflowInstanceCompletionInTransaction(db, workflowInstanceId, workspaceId, 'workflow-engine', now)
  return promoted
}

function updateWorkflowInstanceCompletionInTransaction(
  db: Database.Database,
  workflowInstanceId: number,
  workspaceId: number,
  actor: string,
  now: number,
): void {
  const incomplete = db.prepare(`
    SELECT COUNT(*) AS count
    FROM workflow_node_instances
    WHERE workflow_instance_id = ?
      AND status NOT IN ('complete', 'skipped', 'cancelled')
  `).get(workflowInstanceId) as { count: number } | undefined
  if ((incomplete?.count ?? 0) > 0) return

  const updated = db.prepare(`
    UPDATE workflow_instances
    SET status = 'complete', completed_at = COALESCE(completed_at, ?), updated_at = ?
    WHERE id = ? AND status != 'complete'
  `).run(now, now, workflowInstanceId)
  if (updated.changes === 0) return

  writeWorkflowEvent(db, {
    workflowInstanceId,
    eventType: 'workflow.completed',
    actorType: 'system',
    actorId: actor,
    payload: { workflow_instance_id: workflowInstanceId },
    workspaceId,
    createdAt: now,
  })
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
    const dependencies = normalizeDependsOn(node.depends_on)
    for (const dependency of dependencies.nodes) {
      if (!nodeKeys.has(dependency.node)) throw new Error(`Workflow node '${nodeKey}' depends on unknown node '${dependency.node}'`)
    }
    for (const timer of dependencies.timers) {
      if (!nodeKeys.has(timer.after)) throw new Error(`Workflow node '${nodeKey}' timer depends on unknown node '${timer.after}'`)
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
    for (const dependency of normalizeDependsOn(definition.nodes[nodeKey]?.depends_on).nodes) {
      if (dependency.type !== 'related') visit(dependency.node)
    }
    for (const timer of normalizeDependsOn(definition.nodes[nodeKey]?.depends_on).timers) visit(timer.after)
    visiting.delete(nodeKey)
    visited.add(nodeKey)
  }
  for (const nodeKey of Object.keys(definition.nodes)) visit(nodeKey)
}

function normalizeDependsOn(value: WorkflowDefinitionNode['depends_on'] | undefined): NormalizedWorkflowDependencies {
  if (!value) return { nodes: [], conditions: [], timers: [] }
  if (Array.isArray(value)) return { nodes: normalizeNodeDependencies(value), conditions: [], timers: [] }
  return {
    nodes: normalizeNodeDependencies(value.nodes ?? []),
    conditions: value.conditions ?? [],
    timers: value.timers ?? [],
  }
}

function normalizeNodeDependencies(
  nodes: Array<string | { node: string; type?: WorkflowNodeDependencySemantics; group?: string }>,
): NormalizedWorkflowNodeDependency[] {
  return nodes.map((dependency) => {
    if (typeof dependency === 'string') return { node: dependency, type: 'blocks' }
    return { node: dependency.node, type: dependency.type ?? 'blocks', ...(dependency.group ? { group: dependency.group } : {}) }
  })
}

function normalizedNodeDependenciesSatisfied(
  dependencies: NormalizedWorkflowNodeDependency[],
  runtimeByKey: Map<string, WorkflowRuntimeNode>,
): boolean {
  const waitsForAnyByGroup = new Map<string, NormalizedWorkflowNodeDependency[]>()
  for (const dependency of dependencies) {
    if (dependency.type === 'related') continue
    if (dependency.type === 'waits_for_any') {
      const group = dependency.group ?? 'default'
      waitsForAnyByGroup.set(group, [...(waitsForAnyByGroup.get(group) ?? []), dependency])
      continue
    }
    const status = runtimeByKey.get(dependency.node)?.status
    if (status !== 'complete' && status !== 'skipped') return false
  }

  for (const group of waitsForAnyByGroup.values()) {
    if (!group.some((dependency) => {
      const status = runtimeByKey.get(dependency.node)?.status
      return status === 'complete' || status === 'skipped'
    })) return false
  }
  return true
}

function workflowDependencyBlockerLabel(input: {
  dependency_type: 'node' | 'condition' | 'timer'
  dependency_key: string
  source_node_key: string | null
  status: WorkflowNodeDependencyStatus
  due_at: number | null
}): string {
  if (input.dependency_type === 'node') return input.source_node_key ?? input.dependency_key.replace(/^node:/, '')
  if (input.dependency_type === 'timer') {
    if (input.due_at) return `timer due ${new Date(input.due_at * 1000).toISOString()}`
    return input.source_node_key ? `timer after ${input.source_node_key}` : 'timer pending'
  }
  return input.dependency_key.replace(/^condition:[^:]+:[^:]+:/, '')
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function nodeDependencyKey(nodeKey: string): string {
  return `node:${nodeKey}`
}

function conditionDependencyKey(subjectType: string, subjectId: string, condition: string): string {
  return `condition:${subjectType}:${subjectId}:${condition}`
}

function timerDependencyKey(
  workflowInstanceId: number,
  nodeKey: string,
  timer: { after: string; duration: string; key?: string },
): string {
  return `timer:${workflowInstanceId}:${nodeKey}:${timer.key ?? timer.after}:${timer.duration}`
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
  node: { node_key: string; node_type: WorkflowNodeType; recipe_slug: string | null; config_json?: string | null },
): string {
  const config = parseObject(node.config_json)
  const taskGoal = typeof config.task_goal === 'string' ? config.task_goal.trim() : ''
  const description = typeof config.description === 'string' ? config.description.trim() : ''
  const descriptionFile = typeof config.description_file === 'string' ? config.description_file.trim() : ''
  const lines = [
    `Workflow task for ${context.definition_name}.`,
    '',
    `Workflow: ${context.definition_slug} v${context.definition_version}`,
    `Workflow key: ${context.workflow_key}`,
    `Subject: ${context.subject_type}:${context.subject_id}`,
    `Node: ${node.node_key} (${node.node_type})`,
    `Recipe: ${node.recipe_slug ?? 'not set'}`,
  ]
  if (taskGoal || description || descriptionFile) {
    lines.push('', 'Node instructions:')
    if (taskGoal) lines.push(`Goal: ${taskGoal}`)
    if (description) lines.push(description)
    if (descriptionFile) lines.push(`Additional instruction file: ${descriptionFile}`)
  }
  lines.push(
    '',
    'Worker contract:',
    '- Read /recipe/PREAMBLE.md and /recipe/SOUL.md before acting.',
    '- Work only inside the mounted /workspace.',
    '- Use task comments/checkpoints for questions, blockers, and final handoff.',
    '- Submit the task through the recipe runner API when complete.',
  )
  return lines.join('\n')
}

function parseObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
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
