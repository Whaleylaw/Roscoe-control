import type Database from 'better-sqlite3'

import { createWorkflowDefinition, materializeReadyWorkflowNodes } from './workflow-engine'
import { startOrReuseWaypointRoute } from './waypoint'
import { loadMissionControlWaypointCatalog, REFERRAL_PACKAGE_QUEST_SLUG } from './waypoint-catalog'
import { getWaypointProjectBinding } from './waypoint-project-binding'

export interface StartReferralPackageQuestRouteInput {
  readonly projectId: number
  readonly workspaceId: number
  readonly tenantId?: number
  readonly actor: string
  readonly now?: number
}

export interface StartReferralPackageQuestRouteResult {
  readonly workflowInstanceId: number
  readonly reused: boolean
  readonly materializedTaskIds: readonly number[]
}

const REFERRAL_WORKFLOW_SLUG = 'waypoint-referral-package'
const REFERRAL_WORKFLOW_VERSION = 1

const CHRONOLOGY_STAGED_ARTIFACTS = [
  '03-medical/medical-chronology-output/reports/date-of-service-ledger.json',
  '03-medical/medical-chronology-output/reports/visit-content.json',
  '03-medical/medical-chronology-output/reports/rendered-template-check.json',
] as const

export async function startReferralPackageQuestRoute(
  db: Database.Database,
  input: StartReferralPackageQuestRouteInput,
): Promise<StartReferralPackageQuestRouteResult> {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const project = db.prepare(`
    SELECT id, workspace_id, metadata
    FROM projects
    WHERE id = ? AND workspace_id = ? AND status = 'active'
    LIMIT 1
  `).get(input.projectId, input.workspaceId) as { id: number; workspace_id: number; metadata: string | null } | undefined
  if (!project) throw new Error(`Project ${input.projectId} not found in workspace ${input.workspaceId}`)

  const binding = getWaypointProjectBinding(project)
  if (!binding) throw new Error(`Project ${input.projectId} does not have a Waypoint binding`)
  if (binding.questSlug !== REFERRAL_PACKAGE_QUEST_SLUG) {
    throw new Error(`Project ${input.projectId} is bound to ${binding.questSlug}, not ${REFERRAL_PACKAGE_QUEST_SLUG}`)
  }

  const catalog = await loadMissionControlWaypointCatalog()
  const definitionId = ensureReferralWorkflowDefinition(db, input.workspaceId, input.tenantId ?? 1, input.actor, now)

  const route = startOrReuseWaypointRoute(db, {
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
    actor: input.actor,
    projectId: input.projectId,
    subjectType: 'waypoint_project',
    subjectId: input.projectId,
    definitionSlug: REFERRAL_WORKFLOW_SLUG,
    definitionVersion: REFERRAL_WORKFLOW_VERSION,
    vars: {
      project_id: input.projectId,
      quest_slug: REFERRAL_PACKAGE_QUEST_SLUG,
      case_root_key: binding.caseRootKey,
      case_root: binding.caseRoot,
      source_root: binding.sourceRoot,
      source_readonly: binding.sourceReadonly,
      package_pin: binding.packagePin,
      core_version: binding.coreVersion,
      folder_host_version: binding.folderHostVersion,
      catalog_definition_id: definitionId,
    },
    now,
  })

  const materialized = materializeReadyWorkflowNodes(db, {
    workflowInstanceId: route.instanceId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    actor: input.actor,
    status: 'inbox',
    now,
  })

  annotateReferralPackageTasks(db, {
    workflowInstanceId: route.instanceId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    routeId: route.instanceId,
    recipeSlugs: catalog.referralPackage.recipes.map((recipe) => recipe.slug),
    now,
  })

  return {
    workflowInstanceId: route.instanceId,
    reused: route.reused,
    materializedTaskIds: materialized.created.map((created) => created.task_id),
  }
}

function ensureReferralWorkflowDefinition(
  db: Database.Database,
  workspaceId: number,
  tenantId: number,
  actor: string,
  now: number,
): number {
  const existing = db.prepare(`
    SELECT id
    FROM workflow_definitions
    WHERE workspace_id = ? AND slug = ? AND version = ? AND status = 'active'
    ORDER BY id DESC
    LIMIT 1
  `).get(workspaceId, REFERRAL_WORKFLOW_SLUG, REFERRAL_WORKFLOW_VERSION) as { id: number } | undefined
  if (existing) return existing.id

  return createWorkflowDefinition(db, referralWorkflowDefinitionYaml(), actor, workspaceId, tenantId)
}

function referralWorkflowDefinitionYaml(): string {
  const recipeNodes = [
    'referral-package-document-reviewer',
    'referral-package-packet-segmenter',
    'referral-package-filename-placement-reviewer',
    'firmvault-medical-chronology-update',
    'firmvault-medical-chronology-adversarial-qc',
    'referral-package-start-here-builder',
    'referral-package-package-qc',
  ].map((slug) => {
    const nodeKey = nodeKeyForRecipeSlug(slug)
    return `  ${nodeKey}:\n    type: recipe\n    recipe: ${slug}\n    config:\n      waypoint:\n        quest_slug: ${REFERRAL_PACKAGE_QUEST_SLUG}\n        plan_ref: ${nodeKey}\n`
  }).join('')

  return `schema_version: 1\nid: ${REFERRAL_WORKFLOW_SLUG}\nname: Waypoint Referral Package\nversion: ${REFERRAL_WORKFLOW_VERSION}\nsubject_type: waypoint_project\nvars:\n  project_id:\n    type: number\n    required: true\n  quest_slug:\n    type: string\n    required: true\nnodes:\n${recipeNodes}  attorney_handoff_gate:\n    type: review\n    review:\n      mode: human\n    config:\n      review:\n        mode: human\n      waypoint:\n        quest_slug: ${REFERRAL_PACKAGE_QUEST_SLUG}\n        execution_kind: gate\n`
}

function annotateReferralPackageTasks(
  db: Database.Database,
  input: {
    workflowInstanceId: number
    projectId: number
    workspaceId: number
    routeId: number
    recipeSlugs: readonly string[]
    now: number
  },
): void {
  const rows = db.prepare(`
    SELECT id, recipe_slug, metadata
    FROM tasks
    WHERE project_id = ? AND workspace_id = ?
    ORDER BY id ASC
  `).all(input.projectId, input.workspaceId) as Array<{ id: number; recipe_slug: string | null; metadata: string | null }>

  for (const row of rows) {
    const metadata = parseMetadata(row.metadata)
    const workflow = isRecord(metadata.workflow) ? metadata.workflow : null
    if (workflow?.workflow_instance_id !== input.workflowInstanceId) continue

    const recipeSlug = row.recipe_slug
    const isGate = !recipeSlug && workflow.node_type === 'review'
    const waypoint = isRecord(metadata.waypoint) ? metadata.waypoint : {}
    const enrichedWaypoint = {
      ...waypoint,
      quest_slug: REFERRAL_PACKAGE_QUEST_SLUG,
      route_id: String(input.routeId),
      plan_ref: typeof workflow.node_key === 'string' ? workflow.node_key : undefined,
      ...(recipeSlug ? { recipe: { slug: recipeSlug } } : {}),
      execution: isGate
        ? { kind: 'gate' }
        : { kind: executionKindForRecipe(recipeSlug), package_function: packageFunctionForRecipe(recipeSlug) },
      required_artifacts: requiredArtifactsForRecipe(recipeSlug),
      blocker: { status: null, missing_artifacts: [], resolution_input: null },
      ...(isGate ? { gate: { kind: 'human', status: 'pending' } } : {}),
    }

    db.prepare(`UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
      .run(JSON.stringify({ ...metadata, waypoint: enrichedWaypoint }), input.now, row.id, input.workspaceId)
  }
}

function nodeKeyForRecipeSlug(slug: string): string {
  return slug.replace(/-/g, '_')
}

function executionKindForRecipe(recipeSlug: string | null): 'local_package' | 'agent' {
  return recipeSlug === 'firmvault-medical-chronology-update' ? 'local_package' : 'agent'
}

function packageFunctionForRecipe(recipeSlug: string | null): string | undefined {
  return recipeSlug === 'firmvault-medical-chronology-update' ? 'runReferralPackageBuilder' : undefined
}

function requiredArtifactsForRecipe(recipeSlug: string | null): Array<{ path: string; required_when: 'before_complete' }> {
  if (recipeSlug !== 'firmvault-medical-chronology-update') return []
  return CHRONOLOGY_STAGED_ARTIFACTS.map((path) => ({ path, required_when: 'before_complete' }))
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  const parsed: unknown = JSON.parse(raw)
  return isRecord(parsed) ? parsed : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
