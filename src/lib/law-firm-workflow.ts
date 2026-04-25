import { readdir, readFile, writeFile } from 'fs/promises'
import { spawnSync } from 'node:child_process'
import { basename, join } from 'path'
import type { Database } from 'better-sqlite3'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import {
  ensureLawFirmCaseProject,
  getLawFirmCasesRoot,
  getLawFirmRoot,
  type LawFirmCaseProject,
} from '@/lib/law-firm'

const WORKFLOW_RECIPE_SLUG = 'firmvault-workflow-task'

const WORKFLOW_STEP_RECIPES: Record<string, { recipe_slug: string; body: string; follow_up_days?: number }> = {
  'insurance_pip_claim:file_application': {
    recipe_slug: 'firmvault-pip-file-application',
    body: [
      '## Task: Prepare and track the Kentucky PIP application',
      '',
      'First check whether the PIP application is already filed. Read the case file and claim files under `cases/{{case_slug}}/claims/`.',
      '',
      'If the application is already documented as filed, update only missing normalized shadow fields and log the confirmation.',
      '',
      'If not filed, prepare the KACP application work product from the masked vault data, identify any missing required fields, and move the task to review or awaiting_owner for signature/submission. Do not submit through an external portal or email from the agent.',
      '',
      'Expected vault effects when complete:',
      '- PIP claim shadow records that application was filed, with date if known.',
      '- Activity Log entry describing the source of confirmation or handoff.',
      '- If required information is missing, an awaiting_owner handoff naming the exact missing field/document.',
    ].join('\n'),
  },
  'insurance_pip_claim:confirm_approval': {
    recipe_slug: 'firmvault-pip-confirm-approval',
    follow_up_days: 5,
    body: [
      '## Task: Confirm PIP approval',
      '',
      'First check whether PIP approval is already documented. Read the case file, PIP claim files under `cases/{{case_slug}}/claims/`, document shadows, and Activity Log entries.',
      '',
      'If a PIP claim already has an approved/active status with adequate source support, normalize the claim shadow and log the confirmation. Do not duplicate work.',
      '',
      'If approval is not documented, determine the precise missing item: approval letter, carrier acknowledgment, claim number, adjuster confirmation, or human call/email follow-up. Move the task to awaiting_owner with that handoff instead of guessing.',
      '',
      'Expected vault effects when complete:',
      '- PIP claim status reflects approved/active only when supported by vault evidence.',
      '- Approval date, claim number, adjuster/contact fields are recorded when available.',
      '- Activity Log entry cites the evidence or states the missing confirmation.',
    ].join('\n'),
  },
  'insurance_pip_claim:track_exhaustion': {
    recipe_slug: 'firmvault-pip-track-exhaustion',
    follow_up_days: 30,
    body: [
      '## Task: Track PIP exhaustion',
      '',
      'First check whether PIP exhaustion is already documented. Read the PIP claim file, medical billing shadows, lien/payment notes, and Activity Log.',
      '',
      'If benefits are exhausted, normalize the PIP claim status and record the exhaustion date/source. If the vault or owner confirms benefits are not exhausted, close the task as a documented negative result without setting the exhaustion landmark. If exhaustion status is unknown, record the current known balance/status or block for missing carrier ledger/EOB information.',
      '',
      'Expected vault effects when complete:',
      '- PIP claim status is exhausted only when supported.',
      '- Exhaustion date/source is recorded when known.',
      '- Activity Log entry, task resolution, or owner approval explains the balance/exhaustion status, non-exhaustion bypass, or handoff.',
    ].join('\n'),
  },
  'insurance_pip_claim:resolve_reimbursement': {
    recipe_slug: 'firmvault-pip-resolve-reimbursement',
    follow_up_days: 30,
    body: [
      '## Task: Resolve PIP reimbursement',
      '',
      'First check whether any PIP reimbursement/lien issue is already resolved. Read the PIP claim, lien records, settlement/distribution notes, and Activity Log.',
      '',
      'If reimbursement is resolved, normalize the claim/lien shadow and log the resolution. If not resolved, identify whether the missing action is a final amount, negotiation, attorney decision, payment confirmation, or carrier response.',
      '',
      'Expected vault effects when complete:',
      '- PIP reimbursement status is no longer pending when supported.',
      '- Related lien/payment fields are updated only from masked vault evidence.',
      '- Activity Log entry records the resolution or exact awaiting_owner handoff.',
    ].join('\n'),
  },
  'lien_negotiation:open_lien': {
    recipe_slug: WORKFLOW_RECIPE_SLUG,
    body: [
      '## Task: Open lien file and send letter of representation',
      '',
      'First check whether each identified outstanding lien is already opened and whether a lien letter of representation has already been sent. Read `cases/{{case_slug}}/{{case_slug}}.md`, `cases/{{case_slug}}/liens.md`, files under `cases/{{case_slug}}/liens/`, and recent Activity Log entries.',
      '',
      'If a lien holder is identified but the lien has not been opened, prepare the lien-opening contact record/work product and draft the lien letter of representation. Do not send external correspondence from the agent; move to review or awaiting_owner if human transmission is required.',
      '',
      'If a lien was already opened or the letter was already sent outside the workflow, normalize the lien shadow fields and log the confirmation instead of duplicating work.',
      '',
      'Expected vault effects when complete:',
      '- Each applicable outstanding lien records the lien holder/contact, opened date if known, and letter-of-representation sent date/source if known.',
      '- Activity Log entry explains the source of confirmation or exact handoff.',
      '- If no lien exists, use Bypass: Not Applicable on this workflow step rather than inventing a lien.',
    ].join('\n'),
  },
}

const PHASE_ALIASES: Record<string, string> = {
  onboarding: 'phase_0_onboarding',
  intake: 'phase_0_onboarding',
  file_setup: 'phase_1_file_setup',
  treatment: 'phase_2_treatment',
  demand: 'phase_3_demand',
  demand_in_progress: 'phase_3_demand',
  negotiation: 'phase_4_negotiation',
  settlement: 'phase_5_settlement',
  lien: 'lien_track',
  litigation: 'litigation_track',
  closed: 'phase_8_closed',
  phase_6_lien: 'lien_track',
  phase_7_litigation: 'litigation_track',
}

const LANDMARK_ALIASES: Record<string, string[]> = {
  attorney_reviewed_demand: ['attorney_approved_demand'],
  bi_claim_opened: ['insurance_claims_setup'],
  providers_identified: ['providers_setup'],
  records_received_sufficient: ['all_records_received'],
  liens_identified: ['outstanding_liens_identified'],
}

type WorkflowPlan = {
  id: string
  enabled: boolean
  source: string | null
  phase_id: string
  name: string
  goal: string
  steps: Array<{
    id: string
    type: 'recipe' | 'wait' | 'human_review' | 'code'
    landmark_id: string
    recipe_slug?: string
    depends_on?: string[]
    skip_when?: string[]
    wait_days?: number | null
    function?: string | null
  }>
}

export type LawFirmWorkflowStatus = {
  workflow_id: string
  name: string
  goal: string
  phase_id: string
  source: string | null
  enabled: boolean
  status: 'active' | 'complete' | 'not_started' | 'blocked'
  completed_steps: number
  total_steps: number
  active_steps: number
  blocked_by: string[]
  steps: Array<{
    id: string
    type: 'recipe' | 'wait' | 'human_review' | 'code'
    landmark_id: string
    recipe_slug: string | null
    status: 'ready' | 'complete' | 'blocked' | 'waiting' | 'skipped'
    depends_on: string[]
    blocked_by: string[]
    wait_days: number | null
    skip_when: string[]
  }>
}

type RawPhase = {
  name?: string
  description?: string
  landmarks?: RawLandmark[]
  variants?: Record<string, { description?: string; landmarks?: RawLandmark[] }>
}

type RawLandmark = {
  id: string
  name?: string
  mandatory?: boolean
  condition?: string | boolean
  produced_by?: Array<{ workflow?: string; step?: string }>
}

type TaskTemplate = {
  template_id: string
  landmark: string
  phase?: string
  skill?: string
  priority?: string
  review?: boolean
  auto?: boolean
  depends_on?: string[]
  body?: string
}

type CaseFrontmatter = {
  slug: string
  path: string
  frontmatter: Record<string, unknown>
  body: string
}

export type LawFirmWorkflowReadyItem = {
  workflow_key: string
  case_slug: string
  case_name: string
  phase_id: string
  phase_name: string
  phase_kind: 'core_phase' | 'parallel_track'
  landmark_id: string
  landmark_name: string
  mandatory: boolean
  condition: string
  produced_by: Array<{ workflow?: string; step?: string }>
  task_template: string | null
  recipe_slug: string
  skill: string | null
  priority: 'critical' | 'high' | 'medium' | 'low'
  review_required: boolean
  status: 'inbox' | 'backlog'
  blocked_by: string[]
  not_before: number | null
  follow_up_days: number | null
  description: string
  tags: string[]
  metadata: Record<string, unknown>
}

export type LawFirmWorkflowMaterializeResult = {
  case_slug: string
  project: LawFirmCaseProject
  ready_items: LawFirmWorkflowReadyItem[]
  created: Array<{ task_id: number; workflow_key: string; title: string }>
  skipped: Array<{ workflow_key: string; reason: string; task_id?: number }>
}

export async function previewLawFirmWorkflowTasks(slug: string): Promise<LawFirmWorkflowReadyItem[]> {
  const firmVaultRoot = getLawFirmRoot()
  const caseData = await readCaseFrontmatter(slug)
  const [phases, templates, workflowPlans] = await Promise.all([
    readWorkflowPhases(firmVaultRoot, caseData),
    readTaskTemplates(firmVaultRoot),
    readWorkflowPlans(),
  ])
  return buildWorkflowItems(caseData, phases, templates, workflowPlans)
}

export async function previewLawFirmWorkflowStatuses(slug: string): Promise<LawFirmWorkflowStatus[]> {
  const caseData = await readCaseFrontmatter(slug)
  const workflowPlans = await readWorkflowPlans({ includeDisabled: true })
  return buildWorkflowStatuses(caseData, workflowPlans)
}

export async function updateLawFirmWorkflowOverride(
  slug: string,
  workflowId: string,
  action: 'activate' | 'close',
  actor: string,
): Promise<LawFirmWorkflowStatus[]> {
  assertSafeCaseSlug(slug)
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(workflowId)) throw new Error('Invalid workflow id')
  const statePath = join(getLawFirmCasesRoot(), slug, 'state.yaml')
  const raw = await readFile(statePath, 'utf8')
  const parsed = parseYaml(raw)
  const state = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  const overrides = objectValue(state.workflow_overrides)
  overrides[workflowId] = {
    status: action === 'activate' ? 'active' : 'closed',
    updated_at: new Date().toISOString(),
    updated_by: actor || 'mission-control',
  }
  state.workflow_overrides = overrides
  await writeFile(statePath, stringifyYaml(state), 'utf8')
  return previewLawFirmWorkflowStatuses(slug)
}

export async function materializeLawFirmWorkflowTasks(
  db: Database,
  workspaceId: number,
  slug: string,
  actor: string,
  options: { assigned_to?: string; limit?: number } = {},
): Promise<LawFirmWorkflowMaterializeResult> {
  const project = await ensureLawFirmCaseProject(db, workspaceId, slug)
  ensureProjectRepoMapEntry(db, project.id, getLawFirmRoot())
  const preview = await previewLawFirmWorkflowTasks(slug)
  const readyItems = typeof options.limit === 'number' ? preview.slice(0, options.limit) : preview
  const existing = findExistingWorkflowTasks(db, workspaceId, project.id)
  const created: LawFirmWorkflowMaterializeResult['created'] = []
  const skipped: LawFirmWorkflowMaterializeResult['skipped'] = []

  for (const item of readyItems) {
    const existingTask = existing.get(item.workflow_key)
    if (existingTask) {
      skipped.push({ workflow_key: item.workflow_key, reason: 'already_exists', task_id: existingTask.id })
      continue
    }

    const taskId = createWorkflowTask(db, workspaceId, project.id, actor, item, options.assigned_to)
    created.push({ task_id: taskId, workflow_key: item.workflow_key, title: taskTitle(item) })
  }

  return {
    case_slug: slug,
    project,
    ready_items: readyItems,
    created,
    skipped,
  }
}

async function readWorkflowPhases(
  firmVaultRoot: string,
  caseData: CaseFrontmatter,
): Promise<Array<{ id: string; kind: 'core_phase' | 'parallel_track'; phase: RawPhase }>> {
  const raw = await readFile(join(firmVaultRoot, 'skills.tools.workflows', 'workflows', 'PHASE_DAG.yaml'), 'utf8')
  const parsed = parseYaml(raw) as {
    core_phases?: Record<string, RawPhase>
    parallel_tracks?: Record<string, RawPhase>
  }
  const activeIds = activeWorkflowIds(caseData)
  const phases: Array<{ id: string; kind: 'core_phase' | 'parallel_track'; phase: RawPhase }> = []

  for (const [id, phase] of Object.entries(parsed.core_phases ?? {})) {
    if (activeIds.has(id)) phases.push({ id, kind: 'core_phase', phase })
  }
  for (const [id, phase] of Object.entries(parsed.parallel_tracks ?? {})) {
    if (activeIds.has(id)) phases.push({ id, kind: 'parallel_track', phase })
  }

  return phases
}

async function readWorkflowPlans(options: { includeDisabled?: boolean } = {}): Promise<WorkflowPlan[]> {
  try {
    const raw = await readFile(join(process.cwd(), 'workflows', 'firmvault-workflows.yaml'), 'utf8')
    const parsed = parseYaml(raw) as { workflows?: Record<string, unknown> }
    const plans: WorkflowPlan[] = []
    for (const [id, value] of Object.entries(parsed.workflows ?? {})) {
      const workflow = objectValue(value)
      const enabled = workflow.enabled !== false
      if (!enabled && !options.includeDisabled) continue
      const phaseId = stringValue(workflow.phase_id)
      if (!phaseId) continue
      const steps = Array.isArray(workflow.steps)
        ? workflow.steps.flatMap((stepValue): WorkflowPlan['steps'] => {
            const step = objectValue(stepValue)
            const type = workflowStepType(step.type)
            const landmarkId = stringValue(step.landmark_id) || stringValue(step.id)
            if (!landmarkId && type !== 'wait') return []
            const stepId = stringValue(step.id) || landmarkId || 'wait'
            return [{
              id: stepId,
              type,
              landmark_id: landmarkId || stepId,
              recipe_slug: stringValue(step.recipe_slug) || undefined,
              depends_on: workflowDependsOnList(step.depends_on),
              skip_when: Array.isArray(step.skip_when) ? step.skip_when.map((item) => String(item)) : [],
              wait_days: waitDaysFromStep(step),
              function: stringValue(step.function),
            }]
          })
        : []
      plans.push({
        id,
        enabled,
        source: stringValue(workflow.source),
        phase_id: phaseId,
        name: stringValue(workflow.name) || titleFromId(id),
        goal: stringValue(workflow.goal) || '',
        steps,
      })
    }
    return plans
  } catch {
    return []
  }
}

function workflowStepType(value: unknown): WorkflowPlan['steps'][number]['type'] {
  if (value === 'wait') return 'wait'
  if (value === 'human_review') return 'human_review'
  if (value === 'code') return 'code'
  return 'recipe'
}

function workflowDependsOnList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  const dependency = objectValue(value)
  return [
    ...arrayOfStrings(dependency.nodes),
    ...arrayOfStrings(dependency.conditions),
  ]
}

function buildWorkflowStatuses(caseData: CaseFrontmatter, workflowPlans: WorkflowPlan[]): LawFirmWorkflowStatus[] {
  return workflowPlans.map((plan) => {
    const override = workflowOverrideStatus(caseData.frontmatter, plan.id)
    const steps = plan.steps.map((step) => {
      const skipped = step.skip_when?.some((landmarkId) => isLandmarkSatisfied(caseData.frontmatter, { id: landmarkId })) ?? false
      const complete = skipped || isLandmarkSatisfied(caseData.frontmatter, { id: step.landmark_id })
      const blockedBy = (step.depends_on ?? []).filter((dependency) => !isWorkflowDependencySatisfied([plan], plan.phase_id, dependency, caseData.frontmatter))
      const status: LawFirmWorkflowStatus['steps'][number]['status'] = skipped
        ? 'skipped'
        : complete
          ? 'complete'
          : step.type === 'wait'
            ? 'waiting'
            : blockedBy.length > 0
              ? 'blocked'
              : 'ready'
      return {
        id: step.id,
        type: step.type,
        landmark_id: step.landmark_id,
        recipe_slug: step.recipe_slug ?? null,
        status,
        depends_on: step.depends_on ?? [],
        blocked_by: blockedBy,
        wait_days: step.wait_days ?? null,
        skip_when: step.skip_when ?? [],
      }
    })
    const totalSteps = steps.length
    const completedSteps = steps.filter((step) => step.status === 'complete' || step.status === 'skipped').length
    const activeSteps = steps.filter((step) => step.status === 'ready' || step.status === 'waiting').length
    const blockedBy = [...new Set(steps.flatMap((step) => step.blocked_by))]
    const hasStarted = completedSteps > 0 || activeSteps > 0
    const derivedStatus: LawFirmWorkflowStatus['status'] = totalSteps > 0 && completedSteps === totalSteps
      ? 'complete'
      : activeSteps > 0 || (hasStarted && blockedBy.length > 0)
        ? 'active'
        : blockedBy.length > 0
          ? 'blocked'
          : 'not_started'
    const status: LawFirmWorkflowStatus['status'] = override === 'closed'
      ? 'complete'
      : override === 'active' && derivedStatus !== 'complete'
        ? 'active'
        : derivedStatus
    return {
      workflow_id: plan.id,
      name: plan.name,
      goal: plan.goal,
      phase_id: plan.phase_id,
      source: plan.source,
      enabled: plan.enabled,
      status,
      completed_steps: override === 'closed' ? totalSteps : completedSteps,
      total_steps: totalSteps,
      active_steps: override === 'closed' ? 0 : activeSteps,
      blocked_by: override === 'closed' ? [] : blockedBy,
      steps: override === 'closed' ? steps.map((step) => ({ ...step, status: 'complete' as const, blocked_by: [] })) : steps,
    }
  }).sort((a, b) => workflowStatusOrder(a.status) - workflowStatusOrder(b.status) || a.name.localeCompare(b.name))
}

function workflowStatusOrder(status: LawFirmWorkflowStatus['status']): number {
  if (status === 'active') return 0
  if (status === 'blocked') return 1
  if (status === 'not_started') return 2
  return 3
}

function waitDaysFromStep(step: Record<string, unknown>): number | null {
  const wait = objectValue(step.wait)
  const raw = wait.days ?? step.wait_days
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.floor(raw)
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null
}

function activeWorkflowIds(caseData: CaseFrontmatter): Set<string> {
  const status = stringValue(caseData.frontmatter.status) || stringValue(caseData.frontmatter.current_phase)
  const current = normalizePhaseId(status) || 'phase_0_onboarding'
  const ids = new Set<string>([current])

  if (current !== 'phase_0_onboarding' && current !== 'phase_8_closed') {
    ids.add('lien_track')
    ids.add('client_contact')
  }
  if (hasClaimType(caseData.body, 'PIP')) ids.add('pip_track')
  if (current === 'litigation_track') ids.add('litigation_track')
  return ids
}

async function readTaskTemplates(firmVaultRoot: string): Promise<Map<string, TaskTemplate>> {
  const templatesDir = join(firmVaultRoot, 'skills.tools.workflows', 'runtime', 'task_templates')
  const entries = await readdir(templatesDir, { withFileTypes: true })
  const templates = new Map<string, TaskTemplate>()

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue
    const raw = await readFile(join(templatesDir, entry.name), 'utf8')
    const parsed = parseMarkdownFrontmatter(raw)
    const templateId = stringValue(parsed.template_id) || basename(entry.name, '.yaml')
    const landmark = stringValue(parsed.landmark)
    if (!landmark) continue
    templates.set(landmark, {
      template_id: templateId,
      landmark,
      phase: stringValue(parsed.phase) || undefined,
      skill: stringValue(parsed.skill) || undefined,
      priority: stringValue(parsed.priority) || undefined,
      review: booleanValue(parsed.review),
      auto: booleanValue(parsed.auto),
      depends_on: Array.isArray(parsed.depends_on) ? parsed.depends_on.map((value) => String(value)) : [],
      body: stringValue(parsed.body) || undefined,
    })
  }

  return templates
}

function buildWorkflowItems(
  caseData: CaseFrontmatter,
  phases: Array<{ id: string; kind: 'core_phase' | 'parallel_track'; phase: RawPhase }>,
  templates: Map<string, TaskTemplate>,
  workflowPlans: WorkflowPlan[],
): LawFirmWorkflowReadyItem[] {
  const items: LawFirmWorkflowReadyItem[] = []

  for (const active of phases) {
    const landmarks = landmarksForPhase(active.id, active.phase, caseData)
    for (const landmark of landmarks) {
      if (isLandmarkSatisfied(caseData.frontmatter, landmark)) continue
      const template = templates.get(landmark.id) ?? null
      const producedBy = landmark.produced_by ?? []
      const workflowStep = workflowStepFor(workflowPlans, active.id, landmark.id)
      const workflowPlan = workflowPlanForStep(workflowPlans, active.id, landmark.id)
      if (workflowPlan && workflowOverrideStatus(caseData.frontmatter, workflowPlan.id) === 'closed') continue
      if (workflowStep && workflowStep.type !== 'recipe' && workflowStep.type !== 'human_review') continue
      const recipe = recipeForWorkflowStep(producedBy, template, workflowStep)
      const blockedBy = blockedDependencyLandmarks(active.id, landmark, template, templates, workflowPlans, caseData.frontmatter)
      if (blockedBy.length > 0) continue
      const priority = templatePriority(template?.priority, landmark, active.id)
      const workflowKey = `${caseData.slug}:${active.id}:${landmark.id}:${template?.template_id ?? 'manual'}`
      const phaseName = active.phase.name || titleFromId(active.id)
      const item: LawFirmWorkflowReadyItem = {
        workflow_key: workflowKey,
        case_slug: caseData.slug,
        case_name: stringValue(caseData.frontmatter.client_name) || titleFromId(caseData.slug),
        phase_id: active.id,
        phase_name: phaseName,
        phase_kind: active.kind,
        landmark_id: landmark.id,
        landmark_name: landmark.name || titleFromId(landmark.id),
        mandatory: Boolean(landmark.mandatory),
        condition: typeof landmark.condition === 'string' ? landmark.condition : String(landmark.condition ?? ''),
        produced_by: producedBy,
        task_template: template?.template_id ?? null,
        recipe_slug: recipe.recipe_slug,
        skill: template?.skill ?? producedBy[0]?.workflow ?? null,
        priority,
        review_required: Boolean(template?.review),
        status: blockedBy.length > 0 ? 'backlog' : 'inbox',
        blocked_by: blockedBy,
        not_before: null,
        follow_up_days: recipe.follow_up_days ?? null,
        description: '',
        tags: [],
        metadata: {},
      }
      item.tags = taskTags(item)
      item.metadata = taskMetadata(item, template, caseData, workflowPlans, workflowStep)
      item.description = taskDescription(item, template, caseData, recipe.body)
      items.push(item)
    }
  }

  return items.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return priorityOrder[a.priority] - priorityOrder[b.priority] || Number(b.mandatory) - Number(a.mandatory)
  })
}

function recipeForWorkflowStep(
  producedBy: Array<{ workflow?: string; step?: string }>,
  template: TaskTemplate | null,
  workflowStep?: WorkflowPlan['steps'][number],
): { recipe_slug: string; body: string | null; follow_up_days?: number } {
  if (workflowStep?.recipe_slug) return { recipe_slug: workflowStep.recipe_slug, body: template?.body ?? null }
  for (const producer of producedBy) {
    const mapped = WORKFLOW_STEP_RECIPES[`${stringValue(producer.workflow)}:${stringValue(producer.step)}`]
    if (mapped) return mapped
  }
  return { recipe_slug: WORKFLOW_RECIPE_SLUG, body: template?.body ?? null }
}

function landmarksForPhase(phaseId: string, phase: RawPhase, caseData: CaseFrontmatter): RawLandmark[] {
  if (phaseId !== 'phase_5_settlement' || !phase.variants) return phase.landmarks ?? []
  const caseType = stringValue(caseData.frontmatter.case_type)?.toLowerCase() || ''
  const variant = caseType.includes('minor')
    ? 'minor_settlement'
    : caseType.includes('wc') || caseType.includes('worker')
      ? 'wc_settlement'
      : 'standard'
  return phase.variants[variant]?.landmarks ?? phase.variants.standard?.landmarks ?? []
}

function blockedDependencyLandmarks(
  phaseId: string,
  landmark: RawLandmark,
  template: TaskTemplate | null,
  templates: Map<string, TaskTemplate>,
  workflowPlans: WorkflowPlan[],
  frontmatter: Record<string, unknown>,
): string[] {
  const blocked: string[] = []
  const dependencies = [
    ...workflowDependenciesFor(workflowPlans, phaseId, landmark.id),
  ]
  for (const dependencyLandmarkId of dependencies) {
    if (!isWorkflowDependencySatisfied(workflowPlans, phaseId, dependencyLandmarkId, frontmatter)) blocked.push(dependencyLandmarkId)
  }
  if (!template) return blocked
  for (const dependency of template.depends_on ?? []) {
    const normalized = dependency.replace(/\{case_slug\}-/g, '')
    const dependencyTemplate = [...templates.values()].find((candidate) => normalized.includes(candidate.template_id))
    if (!dependencyTemplate) continue
    const dependencyLandmark: RawLandmark = { id: dependencyTemplate.landmark }
    if (!isLandmarkSatisfied({ ...frontmatter }, dependencyLandmark)) blocked.push(dependencyTemplate.landmark)
  }
  return [...new Set(blocked)]
}

function workflowDependenciesFor(workflowPlans: WorkflowPlan[], phaseId: string, landmarkId: string): string[] {
  const step = workflowStepFor(workflowPlans, phaseId, landmarkId)
  return step?.depends_on ?? []
}

function workflowStepFor(
  workflowPlans: WorkflowPlan[],
  phaseId: string,
  landmarkId: string,
): WorkflowPlan['steps'][number] | undefined {
  for (const plan of workflowPlans.filter((candidate) => candidate.phase_id === phaseId)) {
    const step = plan.steps.find((candidate) => candidate.landmark_id === landmarkId)
    if (step) return step
  }
  return undefined
}

function workflowPlanForStep(
  workflowPlans: WorkflowPlan[],
  phaseId: string,
  landmarkId: string,
): WorkflowPlan | undefined {
  return workflowPlans
    .filter((candidate) => candidate.phase_id === phaseId)
    .find((plan) => plan.steps.some((candidate) => candidate.landmark_id === landmarkId))
}

function workflowStepById(
  workflowPlans: WorkflowPlan[],
  phaseId: string,
  stepId: string,
): WorkflowPlan['steps'][number] | undefined {
  for (const plan of workflowPlans.filter((candidate) => candidate.phase_id === phaseId)) {
    const step = plan.steps.find((candidate) => candidate.id === stepId || candidate.landmark_id === stepId)
    if (step) return step
  }
  return undefined
}

function isWorkflowDependencySatisfied(
  workflowPlans: WorkflowPlan[],
  phaseId: string,
  dependencyId: string,
  frontmatter: Record<string, unknown>,
): boolean {
  const landmarkCondition = dependencyId.match(/^law_firm\.landmarks\.([a-zA-Z0-9_:-]+)\s*(==|!=)\s*true$/)
  if (landmarkCondition) {
    const satisfied = isLandmarkSatisfied(frontmatter, { id: landmarkCondition[1] })
    return landmarkCondition[2] === '==' ? satisfied : !satisfied
  }
  const step = workflowStepById(workflowPlans, phaseId, dependencyId)
  if (!step) return isLandmarkSatisfied(frontmatter, { id: dependencyId })
  if (step.skip_when?.some((landmarkId) => isLandmarkSatisfied(frontmatter, { id: landmarkId }))) return true
  if (step.type === 'wait') return false
  return isLandmarkSatisfied(frontmatter, { id: step.landmark_id })
}

function isLandmarkSatisfied(frontmatter: Record<string, unknown>, landmark: RawLandmark): boolean {
  if (isLandmarkBypassed(frontmatter, landmark.id)) return true
  const landmarks = objectValue(frontmatter.landmarks)
  if (Object.prototype.hasOwnProperty.call(landmarks, landmark.id)) return Boolean(landmarks[landmark.id])
  for (const alias of LANDMARK_ALIASES[landmark.id] ?? []) {
    if (isLandmarkBypassed(frontmatter, alias)) return true
    if (Object.prototype.hasOwnProperty.call(landmarks, alias)) return Boolean(landmarks[alias])
  }
  return evaluateSimpleCondition(landmark.condition, frontmatter)
}

function isLandmarkBypassed(frontmatter: Record<string, unknown>, landmarkId: string): boolean {
  const bypasses = objectValue(frontmatter.workflow_bypasses)
  const bypass = objectValue(bypasses[landmarkId])
  return stringValue(bypass.status) === 'not_applicable'
}

function workflowOverrideStatus(frontmatter: Record<string, unknown>, workflowId: string): string | null {
  const overrides = objectValue(frontmatter.workflow_overrides)
  const override = objectValue(overrides[workflowId])
  const status = stringValue(override.status)
  return status === 'active' || status === 'closed' ? status : null
}

function evaluateSimpleCondition(condition: string | boolean | undefined, frontmatter: Record<string, unknown>): boolean {
  if (condition === true) return true
  if (condition === false || !condition) return false
  const trimmed = condition.trim()
  if (trimmed === 'true') return true
  const notNull = trimmed.match(/^case\.frontmatter\.([a-zA-Z0-9_]+) is not null$/)
  if (notNull) return frontmatter[notNull[1]] != null && frontmatter[notNull[1]] !== ''
  const equalsBool = trimmed.match(/^case\.frontmatter\.([a-zA-Z0-9_]+) == (true|false)$/)
  if (equalsBool) return Boolean(frontmatter[equalsBool[1]]) === (equalsBool[2] === 'true')
  const equalsString = trimmed.match(/^case\.frontmatter\.([a-zA-Z0-9_]+) == "([^"]+)"$/)
  if (equalsString) return stringValue(frontmatter[equalsString[1]]) === equalsString[2]
  const flag = trimmed.match(/^case\.flag\("([^"]+)"\)$/)
  if (flag) return Boolean(frontmatter[flag[1]])
  return false
}

async function readCaseFrontmatter(slug: string): Promise<CaseFrontmatter> {
  assertSafeCaseSlug(slug)
  const path = join(getLawFirmCasesRoot(), slug, `${slug}.md`)
  const [raw, state] = await Promise.all([
    readFile(path, 'utf8'),
    readCaseState(slug),
  ])
  const frontmatter = parseMarkdownFrontmatter(raw)
  frontmatter.landmarks = {
    ...landmarkFlagsFromState(state),
    ...objectValue(frontmatter.landmarks),
  }
  frontmatter.workflow_overrides = {
    ...objectValue(state.workflow_overrides),
    ...objectValue(frontmatter.workflow_overrides),
  }
  return {
    slug,
    path,
    frontmatter,
    body: raw.replace(/^---\n[\s\S]*?\n---\n?/, ''),
  }
}

async function readCaseState(slug: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(join(getLawFirmCasesRoot(), slug, 'state.yaml'), 'utf8')
    const parsed = parseYaml(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function landmarkFlagsFromState(state: Record<string, unknown>): Record<string, boolean> {
  const landmarks = objectValue(state.landmarks)
  return Object.fromEntries(
    Object.entries(landmarks).flatMap(([key, value]) => {
      const landmark = objectValue(value)
      if (!Object.prototype.hasOwnProperty.call(landmark, 'satisfied')) return []
      return [[key, Boolean(landmark.satisfied)]]
    }),
  )
}

function createWorkflowTask(
  db: Database,
  workspaceId: number,
  projectId: number,
  actor: string,
  item: LawFirmWorkflowReadyItem,
  assignedTo?: string,
): number {
  const now = Math.floor(Date.now() / 1000)
  const finalStatus = assignedTo ? 'assigned' : item.status
  const taskId = db.transaction(() => {
    db.prepare(`
      UPDATE projects
      SET ticket_counter = ticket_counter + 1, updated_at = unixepoch()
      WHERE id = ? AND workspace_id = ?
    `).run(projectId, workspaceId)
    const ticket = db.prepare(`
      SELECT ticket_counter FROM projects
      WHERE id = ? AND workspace_id = ?
    `).get(projectId, workspaceId) as { ticket_counter: number } | undefined
    if (!ticket?.ticket_counter) throw new Error('Failed to allocate project ticket number')

    const result = db.prepare(`
      INSERT INTO tasks (
        title, description, status, priority, project_id, project_ticket_no, assigned_to, created_by,
        created_at, updated_at, due_date, tags, metadata, workspace_id,
        recipe_slug, workspace_source, read_only_mounts, extra_skills, model_override
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskTitle(item),
      item.description,
      finalStatus,
      item.priority,
      projectId,
      ticket.ticket_counter,
      assignedTo ?? null,
      actor,
      now,
      now,
      item.not_before ?? null,
      JSON.stringify(item.tags),
      JSON.stringify(item.metadata),
      workspaceId,
      item.recipe_slug,
      JSON.stringify({ project_id: projectId, base_ref: getLawFirmBaseRef() }),
      null,
      JSON.stringify([]),
      null,
    )
    return Number(result.lastInsertRowid)
  })()

  db_helpers.logActivity('task_created', 'task', taskId, actor, `Created FirmVault workflow task: ${taskTitle(item)}`, {
    workflow_key: item.workflow_key,
    case_slug: item.case_slug,
    landmark: item.landmark_id,
  }, workspaceId)

  const row = db.prepare(`
    SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.id = ? AND t.workspace_id = ?
  `).get(taskId, workspaceId) as Record<string, unknown>
  eventBus.broadcast('task.created', row)
  if (finalStatus === 'assigned') {
    eventBus.broadcast('task.runner_requested', {
      task_id: taskId,
      recipe_slug: item.recipe_slug,
      workspace_id: workspaceId,
    })
  }
  return taskId
}

function findExistingWorkflowTasks(db: Database, workspaceId: number, projectId: number): Map<string, { id: number }> {
  const rows = db.prepare(`
    SELECT id, metadata
    FROM tasks
    WHERE workspace_id = ?
      AND project_id = ?
      AND status != 'failed'
      AND metadata IS NOT NULL
  `).all(workspaceId, projectId) as Array<{ id: number; metadata: string | null }>
  const existing = new Map<string, { id: number }>()
  for (const row of rows) {
    const metadata = parseJsonObject(row.metadata)
    const lawFirm = objectValue(metadata.law_firm)
    const key = stringValue(lawFirm.workflow_key)
    if (key) existing.set(key, { id: row.id })
  }
  return existing
}

function taskTitle(item: LawFirmWorkflowReadyItem): string {
  return `[FirmVault] ${item.case_name}: ${item.landmark_name}`
}

function taskDescription(
  item: LawFirmWorkflowReadyItem,
  template: TaskTemplate | null,
  caseData: CaseFrontmatter,
  recipeBody: string | null,
): string {
  const bodySource = template?.body ?? recipeBody
  const bodyExcerpt = bodySource
    ? bodySource.replace(/\{\{case_slug\}\}/g, item.case_slug).slice(0, 2200)
    : 'No specific FirmVault task template exists for this landmark. Use the phase DAG and produced_by workflow to determine the safest next action.'
  const blocked = item.blocked_by.length > 0
    ? `\nBlocked by unsatisfied landmark(s): ${item.blocked_by.join(', ')}. Keep this in backlog until those prerequisites are done.\n`
    : ''
  return [
    `FirmVault v2 workflow task for ${item.case_name}.`,
    '',
    `Case: ${item.case_slug}`,
    `Case file: cases/${item.case_slug}/${item.case_slug}.md`,
    `FirmVault writable worktree: /workspace`,
    `Current status: ${stringValue(caseData.frontmatter.status) || 'unknown'}`,
    `Phase/track: ${item.phase_name} (${item.phase_id})`,
    `Landmark: ${item.landmark_name} (${item.landmark_id})`,
    `Condition: ${item.condition || 'not specified'}`,
    `Recipe: ${item.recipe_slug}`,
    item.not_before ? `Not before: ${new Date(item.not_before * 1000).toISOString()}` : null,
    item.follow_up_days ? `Follow-up cadence: ${item.follow_up_days} day(s)` : null,
    `Skill: ${item.skill || 'not specified'}`,
    `Review required: ${item.review_required ? 'yes' : 'no'}`,
    blocked,
    'Worker contract:',
    '- Read /recipe/PREAMBLE.md and this task metadata before acting.',
    '- Work only inside the task worktree at /workspace; do not merge or push.',
    '- Treat FirmVault markdown as PHI-masked shadow data; do not request or write raw PHI.',
    '- Use DATA_CONTRACT.md and PHASE_DAG.yaml as the source of truth.',
    '- Do not edit generated Roscoe marker blocks.',
    '- If the work requires a human signature, attorney judgment, external portal action, or real-file handling, move the task to awaiting_owner or review and explain the handoff.',
    '',
    'FirmVault template body:',
    bodyExcerpt,
  ].filter((line): line is string => typeof line === 'string').join('\n').slice(0, 5000)
}

function taskMetadata(
  item: LawFirmWorkflowReadyItem,
  template: TaskTemplate | null,
  caseData: CaseFrontmatter,
  workflowPlans: WorkflowPlan[],
  workflowStep?: WorkflowPlan['steps'][number],
): Record<string, unknown> {
  const workflowPlan = workflowPlans.find((plan) => plan.phase_id === item.phase_id && plan.steps.some((step) => step.landmark_id === item.landmark_id))
  return {
    runner_auto_route: false,
    implementation_repo: getLawFirmRoot(),
    code_location: `cases/${item.case_slug}/${item.case_slug}.md`,
    law_firm: {
      source: 'firmvault-v2',
      manual_start_required: true,
      case_slug: item.case_slug,
      case_file: `cases/${item.case_slug}/${item.case_slug}.md`,
      case_status: stringValue(caseData.frontmatter.status),
      phase: item.phase_id,
      phase_name: item.phase_name,
      phase_kind: item.phase_kind,
      workflow_plan: workflowPlan?.id ?? null,
      workflow_goal: workflowPlan?.goal ?? null,
      workflow_node: workflowStep?.id ?? null,
      workflow_node_type: workflowStep?.type ?? 'recipe',
      landmark: item.landmark_id,
      landmark_name: item.landmark_name,
      mandatory: item.mandatory,
      task_template: template?.template_id ?? null,
      recipe_slug: item.recipe_slug,
      skill: item.skill,
      review_required: item.review_required,
      workflow_key: item.workflow_key,
      blocked_by: item.blocked_by,
      not_before: item.not_before,
      follow_up_days: item.follow_up_days,
    },
  }
}

function ensureProjectRepoMapEntry(db: Database, projectId: number, repoPath: string): void {
  const key = 'runtime.project_repo_map'
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  let map: Record<string, string> = {}
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        map = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      }
    } catch {
      map = {}
    }
  }
  if (map[String(projectId)] === repoPath) return

  map[String(projectId)] = repoPath
  db.prepare(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES (?, ?, ?, 'runtime', 'law-firm-workflow', unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      description = excluded.description,
      category = excluded.category,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(
    key,
    JSON.stringify(map),
    'Maps Mission Control project ids to local git repositories for recipe runner worktrees.',
  )
}

function getLawFirmBaseRef(): string {
  const configured = process.env.MISSION_CONTROL_LAW_FIRM_BASE_REF?.trim()
  if (configured) return configured
  const branch = currentGitBranch(getLawFirmRoot())
  return branch || 'main'
}

function currentGitBranch(repoPath: string): string | null {
  const result = spawnSync('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  const branch = result.stdout.trim()
  return branch && branch !== 'HEAD' ? branch : null
}

function taskTags(item: LawFirmWorkflowReadyItem): string[] {
  return [
    'law-firm',
    'firmvault',
    `case:${item.case_slug}`,
    `phase:${item.phase_id}`,
    `landmark:${item.landmark_id}`,
    item.skill ? `skill:${item.skill}` : null,
  ].filter((value): value is string => Boolean(value))
}

function templatePriority(
  priority: string | undefined,
  landmark: RawLandmark,
  phaseId: string,
): LawFirmWorkflowReadyItem['priority'] {
  if (priority === 'critical') return 'critical'
  if (priority === 'high') return 'high'
  if (priority === 'low') return 'low'
  if (phaseId === 'phase_5_settlement' || landmark.mandatory) return 'high'
  return 'medium'
}

function normalizePhaseId(value: string | null): string | null {
  if (!value) return null
  return PHASE_ALIASES[value] || value
}

function parseMarkdownFrontmatter(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const parsed = parseYaml(match[1])
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function assertSafeCaseSlug(slug: string) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug) || slug.includes('..') || slug.startsWith('.')) {
    throw new Error('Invalid case slug')
  }
}

function hasClaimType(body: string, type: string): boolean {
  return new RegExp(`\\|\\s*${type}\\s*[—-]`, 'i').test(body) || new RegExp(`type:\\s*${type}`, 'i').test(body)
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return Boolean(value)
}

function stringValue(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const str = String(value).trim()
  return str || null
}

function titleFromId(value: string): string {
  return value
    .replace(/^phase_\d+_/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}
