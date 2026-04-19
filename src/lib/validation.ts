import { NextResponse } from 'next/server'
import { ZodSchema, ZodError } from 'zod'
import { z } from 'zod'
import { isKnownModel, MODEL_IDS } from './model-registry'
import {
  WorkspaceSourceSchema,
  readOnlyMountsArraySchema,
  extraSkillsArraySchema,
} from './task-runtime-validation'

export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<{ data: T } | { error: NextResponse }> {
  try {
    const body = await request.json()
    const data = schema.parse(body)
    return { data }
  } catch (err) {
    if (err instanceof ZodError) {
      const messages = err.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
      return {
        error: NextResponse.json(
          { error: 'Validation failed', details: messages },
          { status: 400 }
        ),
      }
    }
    return {
      error: NextResponse.json({ error: 'Invalid request body' }, { status: 400 }),
    }
  }
}

const taskMetadataSchema = z.object({
  implementation_repo: z.string().min(1, 'implementation_repo cannot be empty').max(200).optional(),
  code_location: z.string().min(1, 'code_location cannot be empty').max(500).optional(),
}).catchall(z.unknown())

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().max(5000).optional(),
  status: z.enum(['backlog', 'inbox', 'assigned', 'awaiting_owner', 'in_progress', 'review', 'quality_review', 'done', 'failed']).default('inbox'),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  project_id: z.number().int().positive().optional(),
  assigned_to: z.string().max(100).optional(),
  created_by: z.string().max(100).optional(),
  due_date: z.number().int().min(0).max(4102444800).optional(), // max ~2100-01-01
  estimated_hours: z.number().min(0).max(10000).optional(),
  actual_hours: z.number().min(0).max(10000).optional(),
  outcome: z.enum(['success', 'failed', 'partial', 'abandoned']).optional(),
  error_message: z.string().max(5000).optional(),
  resolution: z.string().max(5000).optional(),
  feedback_rating: z.number().int().min(1).max(5).optional(),
  feedback_notes: z.string().max(5000).optional(),
  retry_count: z.number().int().min(0).optional(),
  completed_at: z.number().int().min(0).max(4102444800).optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).default([] as string[]),
  model_override: z
    .string()
    .min(1)
    .max(200)
    .refine(isKnownModel, {
      error: (issue) =>
        `model_override '${String(issue.input)}' is not in the model registry. Known models: ${MODEL_IDS.join(', ')}`,
    })
    .optional(),

  // Phase 13 — Task Runtime Context (TCTX-01..04, TCTX-06). Field SHAPE
  // enforced here (Zod). Business RULES (recipe existence, workspace_source
  // gap, allowlist membership, caps) live in POST /api/tasks (Plan 13-02) and
  // PATCH /api/tasks/[id] (Plan 13-03) and surface via
  // buildAggregatedValidationResponse.
  recipe_slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'recipe_slug must be kebab-case')
    .optional(),
  workspace_source: WorkspaceSourceSchema.optional(),
  read_only_mounts: readOnlyMountsArraySchema.optional(),
  extra_skills: extraSkillsArraySchema.optional(),

  metadata: taskMetadataSchema.default({} as Record<string, unknown>),
})

export const updateTaskSchema = createTaskSchema.partial()

export const createAgentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  openclaw_id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'openclaw_id must be kebab-case').max(100).optional(),
  role: z.string().min(1, 'Role is required').max(100).optional(),
  session_key: z.string().max(200).optional(),
  soul_content: z.string().max(50000).optional(),
  status: z.enum(['online', 'offline', 'busy', 'idle', 'error']).default('offline'),
  config: z.record(z.string(), z.unknown()).default({} as Record<string, unknown>),
  template: z.string().max(100).optional(),
  gateway_config: z.record(z.string(), z.unknown()).optional(),
  write_to_gateway: z.boolean().optional(),
  provision_openclaw_workspace: z.boolean().optional(),
  openclaw_workspace_path: z.string().min(1).max(500).optional(),
  runtime_type: z.enum(['hermes', 'openclaw', 'claude', 'codex', 'custom']).optional(),
})

export const bulkUpdateTaskStatusSchema = z.object({
  tasks: z.array(z.object({
    id: z.number().int().positive(),
    status: z.enum(['backlog', 'inbox', 'assigned', 'awaiting_owner', 'in_progress', 'review', 'quality_review', 'done', 'failed']),
  })).min(1, 'At least one task is required').max(100),
})

export const createWebhookSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  url: z.string().url('Invalid URL'),
  events: z.array(z.string().min(1).max(200)).max(50).optional(),
  generate_secret: z.boolean().optional(),
})

export const createAlertSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(1000).optional(),
  entity_type: z.enum(['agent', 'task', 'session', 'activity']),
  condition_field: z.string().min(1).max(100),
  condition_operator: z.enum(['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'count_above', 'count_below', 'age_minutes_above']),
  condition_value: z.string().min(1).max(500),
  action_type: z.string().max(100).optional(),
  action_config: z.record(z.string(), z.unknown()).optional(),
  cooldown_minutes: z.number().min(1).max(10080).optional(),
})

export const notificationActionSchema = z.object({
  action: z.literal('mark-delivered'),
  agent: z.string().min(1, 'Agent name is required'),
})

export const integrationActionSchema = z.object({
  action: z.enum(['test', 'pull', 'pull-all']),
  integrationId: z.string().optional(),
  category: z.string().optional(),
})

export const createPipelineSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(5000).optional(),
  steps: z.array(z.object({
    template_id: z.number().int().positive(),
    on_failure: z.enum(['stop', 'continue']).default('stop'),
  })).min(2, 'Pipeline needs at least 2 steps').max(50),
})

export const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  task_prompt: z.string().min(1, 'Task prompt is required').max(10000),
  description: z.string().max(5000).optional(),
  model: z.string().max(100).default('sonnet'),
  timeout_seconds: z.number().int().min(10).max(3600).default(300),
  agent_role: z.string().max(100).optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).default([]),
})

export const createCommentSchema = z.object({
  task_id: z.number().optional(),
  content: z.string().min(1, 'Comment content is required'),
  author: z.string().optional(),
  parent_id: z.number().optional(),
})

export const createMessageSchema = z.object({
  to: z.string().min(1, 'Recipient is required'),
  message: z.string().min(1, 'Message is required'),
  from: z.string().optional().default('system'),
})

export const updateSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
})

export const gatewayConfigUpdateSchema = z.object({
  updates: z.record(z.string(), z.unknown()),
  hash: z.string().optional(),
})

export const qualityReviewSchema = z.object({
  taskId: z.number(),
  reviewer: z.string().default('aegis'),
  status: z.enum(['approved', 'rejected']),
  notes: z.string().min(1, 'Notes are required for quality reviews'),
})

export const spawnAgentSchema = z.object({
  task: z.string().min(1, 'Task is required'),
  model: z.string().min(1, 'Model is required').optional(),
  label: z.string().min(1, 'Label is required'),
  timeoutSeconds: z.number().min(10).max(3600).default(300),
})

export const createUserSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  display_name: z.string().optional(),
  role: z.enum(['admin', 'operator', 'viewer']).default('operator'),
  provider: z.enum(['local', 'google']).default('local'),
  email: z.string().optional(),
})

export const accessRequestActionSchema = z.object({
  request_id: z.number(),
  action: z.enum(['approve', 'reject']),
  role: z.enum(['admin', 'operator', 'viewer']).default('viewer'),
  note: z.string().optional(),
})

export const connectSchema = z.object({
  tool_name: z.string().min(1, 'Tool name is required').max(100),
  tool_version: z.string().max(50).optional(),
  agent_name: z.string().min(1, 'Agent name is required').max(100),
  agent_role: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const githubSyncSchema = z.object({
  action: z.enum(['sync', 'comment', 'close', 'status', 'init-labels', 'sync-project']),
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Repo must be owner/repo format').optional(),
  labels: z.string().optional(),
  state: z.enum(['open', 'closed', 'all']).optional(),
  assignAgent: z.string().optional(),
  issueNumber: z.number().optional(),
  body: z.string().optional(),
  comment: z.string().optional(),
  project_id: z.number().optional(),
})

// Phase 09 — GSD Native Integration (GSD-03, GSD-14, D-17, D-24..29)
export const GSD_PHASES = ['discuss', 'plan', 'execute', 'verify', 'done'] as const
export const GSD_TRACKS = ['ops', 'product', 'marketing', 'legal', 'firmvault', 'custom'] as const
export const GSD_GATE_MODES = ['manual_approval', 'auto_internal'] as const
export const GSD_GATE_STATUSES = ['not_required', 'pending', 'approved', 'rejected'] as const

export const gsdPhaseSchema = z.enum(GSD_PHASES)
export const gsdTrackSchema = z.enum(GSD_TRACKS)
export const gsdGateModeSchema = z.enum(GSD_GATE_MODES)
export const gsdGateStatusSchema = z.enum(GSD_GATE_STATUSES)

// POST /api/projects/:id/gsd/transition body (D-24..29)
export const transitionSchema = z.object({
  to_phase: gsdPhaseSchema,
  reason: z.string().max(1000).optional(),
  waive_remaining: z.boolean().optional(),
}).refine(
  (v) => !v.waive_remaining || (v.reason != null && v.reason.trim().length > 0),
  { message: 'reason is required when waive_remaining is true', path: ['reason'] }
)

// POST /api/projects/:id/gsd/bootstrap body (empty body allowed)
export const bootstrapSchema = z.object({}).passthrough()

// PATCH /api/tasks/:id/gate body (D-09, GSD-11)
export const taskGatePatchSchema = z.object({
  gate_status: z.enum(['approved', 'rejected']),
  note: z.string().max(1000).optional(),
})

// Template-file JSON shape (D-17)
export const gsdTemplatePhaseEntrySchema = z.object({
  ticket_ref: z.string().regex(/^[A-Z]+-\d+$/, 'ticket_ref must match PREFIX-NN'),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  gate_required: z.union([z.literal(0), z.literal(1)]).default(0),
  depends_on: z.array(z.string()).optional(),
})
export const gsdTemplateSchema = z.object({
  name: z.string().min(1),
  phases: z.object({
    discuss: z.array(gsdTemplatePhaseEntrySchema),
    plan: z.array(gsdTemplatePhaseEntrySchema),
    execute: z.array(gsdTemplatePhaseEntrySchema),
    verify: z.array(gsdTemplatePhaseEntrySchema),
  }),
})

// Phase 10 — hierarchical GSD model
export const GSD_WORKSTREAM_STATUSES = ['active', 'paused', 'complete'] as const
export const GSD_MILESTONE_STATUSES = ['planned', 'active', 'complete', 'archived'] as const
export const GSD_PHASE_STATUSES = ['planned', 'active', 'complete', 'deferred'] as const
export const GSD_PLAN_STATUSES = ['todo', 'in_progress', 'review', 'done', 'failed'] as const

export const gsdWorkstreamStatusSchema = z.enum(GSD_WORKSTREAM_STATUSES)
export const gsdMilestoneStatusSchema = z.enum(GSD_MILESTONE_STATUSES)
export const gsdPhaseStatusSchema = z.enum(GSD_PHASE_STATUSES)
export const gsdPlanStatusSchema = z.enum(GSD_PLAN_STATUSES)

export const gsdDependencyIdsSchema = z.array(z.number().int().positive()).max(200).default([])
export const gsdOptimisticLockSchema = z.object({
  expected_updated_at: z.number().int().nonnegative().optional(),
})

export const createGsdWorkstreamSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  status: gsdWorkstreamStatusSchema.default('active'),
})

export const updateGsdWorkstreamSchema = z.object({
  key: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(200).optional(),
  status: gsdWorkstreamStatusSchema.optional(),
  expected_updated_at: z.number().int().nonnegative().optional(),
}).refine(
  (v) => Object.keys(v).some((k) => k !== 'expected_updated_at'),
  { message: 'at least one field is required' }
)

export const createGsdMilestoneSchema = z.object({
  workstream_id: z.number().int().positive().nullable().optional(),
  version_label: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  status: gsdMilestoneStatusSchema.default('planned'),
  started_at: z.number().int().nonnegative().optional(),
  completed_at: z.number().int().nonnegative().optional(),
})

export const updateGsdMilestoneSchema = z.object({
  workstream_id: z.number().int().positive().nullable().optional(),
  version_label: z.string().min(1).max(50).optional(),
  title: z.string().min(1).max(200).optional(),
  status: gsdMilestoneStatusSchema.optional(),
  started_at: z.number().int().nonnegative().optional(),
  completed_at: z.number().int().nonnegative().optional(),
  expected_updated_at: z.number().int().nonnegative().optional(),
}).refine(
  (v) => Object.keys(v).some((k) => k !== 'expected_updated_at'),
  { message: 'at least one field is required' }
)

export const createGsdPhaseSchema = z.object({
  phase_key: z.string().min(1).max(20),
  phase_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'phase_slug must be kebab-case').max(100),
  lifecycle_phase: gsdPhaseSchema.default('discuss'),
  ordering_numeric: z.number().finite(),
  status: gsdPhaseStatusSchema.default('planned'),
  depends_on_phase_ids: gsdDependencyIdsSchema,
})

export const updateGsdPhaseSchema = z.object({
  phase_key: z.string().min(1).max(20).optional(),
  phase_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'phase_slug must be kebab-case').max(100).optional(),
  lifecycle_phase: gsdPhaseSchema.optional(),
  ordering_numeric: z.number().finite().optional(),
  status: gsdPhaseStatusSchema.optional(),
  depends_on_phase_ids: z.array(z.number().int().positive()).max(200).optional(),
  expected_updated_at: z.number().int().nonnegative().optional(),
}).refine(
  (v) => Object.keys(v).some((k) => k !== 'expected_updated_at'),
  { message: 'at least one field is required' }
)

export const transitionGsdPhaseSchema = gsdOptimisticLockSchema.extend({
  to_lifecycle_phase: gsdPhaseSchema,
})

export const createGsdPlanSchema = z.object({
  plan_ref: z.string().min(1).max(30),
  title: z.string().min(1).max(200),
  wave: z.number().int().min(1).max(999).default(1),
  status: gsdPlanStatusSchema.default('todo'),
  depends_on_plan_ids: gsdDependencyIdsSchema,
})

export const updateGsdPlanSchema = z.object({
  plan_ref: z.string().min(1).max(30).optional(),
  title: z.string().min(1).max(200).optional(),
  wave: z.number().int().min(1).max(999).optional(),
  status: gsdPlanStatusSchema.optional(),
  depends_on_plan_ids: z.array(z.number().int().positive()).max(200).optional(),
  expected_updated_at: z.number().int().nonnegative().optional(),
}).refine(
  (v) => Object.keys(v).some((k) => k !== 'expected_updated_at'),
  { message: 'at least one field is required' }
)

export const transitionGsdPlanSchema = gsdOptimisticLockSchema.extend({
  to_status: gsdPlanStatusSchema,
})
