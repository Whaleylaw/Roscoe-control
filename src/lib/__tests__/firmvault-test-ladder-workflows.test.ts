import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { runMigrations } from '../migrations'
import {
  createWorkflowDefinition,
  materializeReadyWorkflowNodes,
  parseWorkflowDefinition,
  satisfyWorkflowCondition,
  startWorkflowInstance,
} from '../workflow-engine'

const FIRMVAULT_ROOT = '/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault'
const MISSION_CONTROL_ROOT = '/Users/aaronwhaley/Github/mission-control'
const BLANK_CASE_TEMPLATE = join(
  FIRMVAULT_ROOT,
  'skills.tools.workflows',
  'case_template',
  'blank-personal-injury-case',
)
const WORKFLOWS_ROOT = join(MISSION_CONTROL_ROOT, 'workflows')

const REQUIRED_CASE_STARTER_PATHS = [
  'AGENTS.md',
  'Dashboard.md',
  'client/intake.md',
  'client/contracts.md',
  'client/authorizations.md',
  'client/contactability.md',
  'client/check-ins.md',
  'accident/accident.md',
  'accident/police-report.md',
  'accident/liability.md',
  'contacts/README.md',
  'insurance/README.md',
  'medical-providers/README.md',
  'liens/README.md',
  'demand/readiness.md',
  'negotiation/offers.md',
  'settlement/settlement.md',
  'settlement/distribution.md',
  'litigation/litigation.md',
  'litigation/pleadings/.gitkeep',
  'litigation/service/.gitkeep',
  'litigation/discovery/propounded/.gitkeep',
  'litigation/discovery/received/.gitkeep',
  'litigation/discovery/deficiencies/.gitkeep',
  'litigation/mediation/.gitkeep',
  'litigation/trial-prep/exhibits/.gitkeep',
  'litigation/trial-prep/experts/.gitkeep',
  'litigation/trial-prep/motions/.gitkeep',
  'litigation/trial-prep/witnesses/.gitkeep',
  'litigation/trial/.gitkeep',
  'documents/incoming/.gitkeep',
  'documents/shadows/.gitkeep',
  'documents/shadows/client/.gitkeep',
  'documents/shadows/accident/.gitkeep',
  'documents/shadows/insurance/.gitkeep',
  'documents/shadows/litigation/.gitkeep',
  'documents/generated/.gitkeep',
  'documents/generated/insurance/.gitkeep',
  'documents/generated/settlement/.gitkeep',
  'documents/sent/.gitkeep',
  'documents/sent/insurance/.gitkeep',
  'documents/sent/settlement/.gitkeep',
  'documents/received/.gitkeep',
  'documents/received/settlement/.gitkeep',
  'documents/_extractions/.gitkeep',
  'activity/index.md',
  'workflow-log/index.md',
]

let db: Database.Database
let projectId: number

function createProject(): number {
  const result = db.prepare(`
    INSERT INTO projects (
      name, description, status, ticket_prefix, ticket_counter,
      workspace_id, slug, created_at, updated_at
    ) VALUES ('FirmVault Test Ladder', '', 'active', 'FVTEST', 0, 1, 'firmvault-test-ladder', 1000, 1000)
  `).run()
  return Number(result.lastInsertRowid)
}

function taskRows() {
  return db.prepare(`
    SELECT id, title, status, recipe_slug, metadata
    FROM tasks
    ORDER BY id ASC
  `).all() as Array<{
    id: number
    title: string
    status: string
    recipe_slug: string | null
    metadata: string | null
  }>
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  projectId = createProject()
})

describe('FirmVault test ladder workflows', () => {
  it('defines executable case setup and document collection workflows with case setup as the root dependency', () => {
    const caseSetup = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-case-setup.yaml'), 'utf8'))
    const documentCollection = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-document-collection.yaml'), 'utf8'))

    expect(caseSetup.id).toBe('firmvault-case-setup')
    expect(caseSetup.nodes.create_case_workspace.completes).toContain('law_firm.landmarks.case_setup_complete')
    expect(documentCollection.id).toBe('firmvault-document-collection')
    expect(documentCollection.nodes.load_document_checklist.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.case_setup_complete == true'],
      timers: [],
    })
    expect(documentCollection.nodes.request_missing_documents.recipe).toBe(
      'firmvault-document-collection-request-missing-documents',
    )
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-document-collection-request-missing-documents', 'SOUL.md')),
    ).toBe(true)
    expect(documentCollection.nodes.send_signature_packets.recipe).toBe(
      'firmvault-document-collection-send-signature-packets',
    )
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-document-collection-send-signature-packets', 'SOUL.md')),
    ).toBe(true)
  })

  it('defines executable accident report workflow after full intake completion', () => {
    const accidentReport = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-accident-report.yaml'), 'utf8'))

    expect(accidentReport.id).toBe('firmvault-accident-report')
    expect(accidentReport.nodes.identify_report_status.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.full_intake_complete == true'],
      timers: [],
    })
    expect(accidentReport.nodes.identify_report_status.recipe).toBe('firmvault-accident-report-analyze')
    expect(accidentReport.nodes.request_accident_report.recipe).toBe('firmvault-accident-report-analyze')
    expect(accidentReport.nodes.request_accident_report.config.task_goal).toContain('blocked checkpoint')
    expect(accidentReport.nodes.request_accident_report.config.task_goal).toContain('not-applicable resolution')
    expect(accidentReport.nodes.wait_for_accident_report.exit_when).toMatchObject({
      condition: 'law_firm.landmarks.accident_report_received == true',
    })
    expect(accidentReport.nodes.analyze_accident_report.completes).toContain(
      'law_firm.landmarks.accident_report_obtained',
    )
    expect(accidentReport.nodes.confirm_accident_report.review).toMatchObject({ mode: 'human' })
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-accident-report-analyze', 'SOUL.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-accident-report-analyze', 'REVIEW.md')),
    ).toBe(true)
    const soul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-accident-report-analyze', 'SOUL.md'),
      'utf8',
    )
    expect(soul).toContain('the case root is `/workspace/example-client.md`')
    expect(soul).toContain('do not submit `done`')
    expect(soul).toContain('canonical case evidence supports not-applicable/no-report resolution')
  })

  it('defines executable medical provider setup workflow after full intake completion', () => {
    const providerSetup = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-medical-provider-setup.yaml'), 'utf8'))

    expect(providerSetup.id).toBe('firmvault-medical-provider-setup')
    expect(providerSetup.nodes.create_provider_ledgers.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.full_intake_complete == true'],
      timers: [],
    })
    expect(providerSetup.nodes.create_provider_ledgers.recipe).toBe('firmvault-medical-provider-setup-case')
    expect(providerSetup.nodes.create_provider_ledgers.completes).toEqual([
      'law_firm.landmarks.providers_setup',
      'law_firm.landmarks.provider_treatment_dates_recorded',
      'law_firm.landmarks.injury_summary_recorded',
    ])
    expect(providerSetup.nodes.create_provider_ledgers.config.task_goal).toContain('canonical provider folders')
    expect(providerSetup.nodes.create_provider_ledgers.config.task_goal).toContain('Do not request records or bills')
    expect(providerSetup.nodes.confirm_medical_provider_setup.review).toMatchObject({ mode: 'human' })
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-medical-provider-setup-case', 'SOUL.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-medical-provider-setup-case', 'REVIEW.md')),
    ).toBe(true)
  })

  it('defines executable client check-in cadence workflow without agent-sent client contact', () => {
    const clientCheckIn = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-client-check-in-cadence.yaml'), 'utf8'))

    expect(clientCheckIn.id).toBe('firmvault-client-check-in-cadence')
    expect(clientCheckIn.nodes.start_check_in_cadence.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.full_intake_complete == true'],
      timers: [],
    })
    expect(clientCheckIn.nodes.start_check_in_cadence.recipe).toBe('firmvault-client-check-in-start-cadence')
    expect(clientCheckIn.nodes.start_check_in_cadence.completes).toContain('law_firm.landmarks.client_check_in_active')
    expect(clientCheckIn.nodes.prepare_check_in_handoff.recipe).toBe('firmvault-client-check-in-prepare-handoff')
    expect(clientCheckIn.nodes.prepare_check_in_handoff.config.task_goal).toContain('Do not send the message')
    expect(clientCheckIn.nodes.human_client_contact.review).toMatchObject({ mode: 'human' })
    expect(clientCheckIn.nodes.wait_for_next_check_in.duration).toBe('14d')
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-client-check-in-start-cadence', 'SOUL.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-client-check-in-prepare-handoff', 'REVIEW.md')),
    ).toBe(true)
  })

  it('defines executable medical provider status workflow for treatment monitoring', () => {
    const providerStatus = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-medical-provider-status.yaml'), 'utf8'))

    expect(providerStatus.id).toBe('firmvault-medical-provider-status')
    expect(providerStatus.nodes.review_provider_statuses.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.providers_setup == true'],
      timers: [],
    })
    expect(providerStatus.nodes.review_provider_statuses.recipe).toBe('firmvault-medical-provider-review-status')
    expect(providerStatus.nodes.review_provider_statuses.completes).toEqual([
      'law_firm.landmarks.provider_list_reviewed',
      'law_firm.landmarks.provider_status_updated',
      'law_firm.landmarks.provider_followups_flagged',
    ])
    expect(providerStatus.nodes.review_provider_statuses.config.task_goal).toContain('medical-providers/<provider-slug>/treatment.md')
    expect(providerStatus.nodes.review_provider_statuses.config.task_goal).toContain('Do not request records or bills')
    expect(providerStatus.nodes.human_treatment_status_review.review).toMatchObject({ mode: 'human' })
    expect(providerStatus.nodes.human_treatment_status_review.config.task_goal).toContain('still treating')
    expect(providerStatus.nodes.wait_for_treatment_status_refresh.duration).toBe('30d')
    expect(providerStatus.nodes.wait_for_treatment_status_refresh.exit_when).toMatchObject({
      condition: 'law_firm.landmarks.treatment_complete == true',
    })

    for (const recipeSlug of [
      'firmvault-medical-provider-review-status',
    ]) {
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'SOUL.md'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'REVIEW.md'))).toBe(true)
    }
  })

  it('defines executable BI claim setup workflow after accident report facts identify an at-fault carrier', () => {
    const biClaimSetup = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-bi-claim-setup.yaml'), 'utf8'))

    expect(biClaimSetup.id).toBe('firmvault-bi-claim-setup')
    expect(biClaimSetup.nodes.identify_bi_carrier.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.accident_report_obtained == true'],
      timers: [],
    })
    expect(biClaimSetup.nodes.identify_bi_carrier.recipe).toBe('firmvault-insurance-bi-identify-carrier')
    expect(biClaimSetup.nodes.identify_bi_carrier.completes).toContain('law_firm.landmarks.at_fault_insurance_identified')
    expect(biClaimSetup.nodes.prepare_bi_lor_handoff.recipe).toBe('firmvault-insurance-bi-prepare-lor')
    expect(biClaimSetup.nodes.prepare_bi_lor_handoff.config.task_goal).toContain('Do not send')
    expect(biClaimSetup.nodes.prepare_bi_lor_handoff.config.task_goal).toContain('ready-to-send')
    expect(biClaimSetup.nodes.prepare_bi_lor_handoff.config.task_goal).toContain(
      'documents/generated/insurance/bi-<carrier-slug>-lor.md',
    )
    expect(biClaimSetup.nodes.human_send_bi_lor.review).toMatchObject({ mode: 'human' })
    expect(biClaimSetup.nodes.human_send_bi_lor.config.task_goal).toContain('Review the generated BI letter')
    expect(biClaimSetup.nodes.human_send_bi_lor.config.task_goal).toContain(
      'documents/generated/insurance/bi-<carrier-slug>-lor.md',
    )
    expect(biClaimSetup.nodes.human_send_bi_lor.config.task_goal).toContain('send date, method, recipient')
    expect(biClaimSetup.nodes.wait_for_bi_acknowledgment.duration).toBe('5d')
    expect(biClaimSetup.nodes.wait_for_bi_acknowledgment.exit_when).toMatchObject({
      condition: 'law_firm.landmarks.bi_claim_acknowledged == true',
    })
    expect(biClaimSetup.nodes.process_bi_acknowledgment.recipe).toBe(
      'firmvault-insurance-bi-process-acknowledgment',
    )
    expect(biClaimSetup.nodes.process_bi_acknowledgment.depends_on).toEqual({
      nodes: ['wait_for_bi_acknowledgment'],
      conditions: [],
      timers: [],
    })
    expect(biClaimSetup.nodes.process_bi_acknowledgment.config.task_goal).toContain(
      'If acknowledgment arrived',
    )
    expect(biClaimSetup.nodes.process_bi_acknowledgment.config.task_goal).toContain(
      'If no acknowledgment arrived',
    )
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-insurance-bi-identify-carrier', 'SOUL.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-insurance-bi-prepare-lor', 'REVIEW.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-insurance-bi-process-acknowledgment', 'SOUL.md')),
    ).toBe(true)
    const biLorSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-insurance-bi-prepare-lor', 'SOUL.md'),
      'utf8',
    )
    expect(biLorSoul).toContain('ready-to-send')
    expect(biLorSoul).toContain('complete letter body')
    const biLorReview = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-insurance-bi-prepare-lor', 'REVIEW.md'),
      'utf8',
    )
    expect(biLorReview).toContain('link or path to the generated letter')
  })

  it('defines executable PIP claim setup workflow with KAC-aware carrier determination and human-send gates', () => {
    const pipClaimSetup = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-pip-claim-setup.yaml'), 'utf8'))

    expect(pipClaimSetup.id).toBe('firmvault-pip-claim-setup')
    expect(pipClaimSetup.nodes.determine_pip_path.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.accident_report_obtained == true'],
      timers: [],
    })
    expect(pipClaimSetup.nodes.determine_pip_path.recipe).toBe('firmvault-insurance-pip-open-claim')
    expect(pipClaimSetup.nodes.determine_pip_path.completes).toContain('law_firm.landmarks.pip_carrier_identified')
    expect(pipClaimSetup.nodes.determine_pip_path.config.task_goal).toContain('Kentucky PIP waterfall')
    expect(pipClaimSetup.nodes.determine_pip_path.config.task_goal).toContain('Kentucky Assigned Claims')

    expect(pipClaimSetup.nodes.prepare_pip_packet.recipe).toBe('firmvault-pip-file-application')
    expect(pipClaimSetup.nodes.prepare_pip_packet.depends_on).toEqual({
      nodes: ['determine_pip_path'],
      conditions: [],
      timers: [],
    })
    expect(pipClaimSetup.nodes.prepare_pip_packet.config.task_goal).toContain('KACP application')
    expect(pipClaimSetup.nodes.prepare_pip_packet.config.task_goal).toContain('ready-to-send')
    expect(pipClaimSetup.nodes.prepare_pip_packet.config.task_goal).toContain('Do not send')
    expect(pipClaimSetup.nodes.human_send_pip_packet.review).toMatchObject({ mode: 'human' })
    expect(pipClaimSetup.nodes.human_send_pip_packet.config.task_goal).toContain('Review the generated PIP packet artifacts')
    expect(pipClaimSetup.nodes.human_send_pip_packet.config.task_goal).toContain('canonical generated artifact paths')
    expect(pipClaimSetup.nodes.human_send_pip_packet.config.task_goal).toContain('send date')
    expect(pipClaimSetup.nodes.wait_for_pip_acknowledgment.duration).toBe('10d')
    expect(pipClaimSetup.nodes.wait_for_pip_acknowledgment.exit_when).toMatchObject({
      condition: 'law_firm.landmarks.pip_approved == true',
    })
    expect(pipClaimSetup.nodes.process_pip_acknowledgment.recipe).toBe('firmvault-pip-confirm-approval')
    expect(pipClaimSetup.nodes.process_pip_acknowledgment.config.task_goal).toContain(
      'If no acknowledgment arrived',
    )
    expect(pipClaimSetup.nodes.wait_before_pip_status_followup.duration).toBe('30d')
    expect(pipClaimSetup.nodes.track_pip_status.recipe).toBe('firmvault-pip-track-exhaustion')

    for (const recipeSlug of [
      'firmvault-insurance-pip-open-claim',
      'firmvault-pip-file-application',
      'firmvault-pip-confirm-approval',
      'firmvault-pip-track-exhaustion',
    ]) {
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'SOUL.md'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'REVIEW.md'))).toBe(true)
    }

    const openClaimSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-insurance-pip-open-claim', 'SOUL.md'),
      'utf8',
    )
    expect(openClaimSoul).toContain('Kentucky PIP waterfall')
    expect(openClaimSoul).toContain('Kentucky Assigned Claims')
    expect(openClaimSoul).toContain('insurance/pip-<carrier-slug>.md')

    const fileApplicationRecipe = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-pip-file-application', 'recipe.yaml'),
      'utf8',
    )
    expect(fileApplicationRecipe).not.toContain('run_shell')
    const fileApplicationSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-pip-file-application', 'SOUL.md'),
      'utf8',
    )
    expect(fileApplicationSoul).toContain('Use `accident/accident.md` as the controlling source for date-of-loss')
  })

  it('defines the complete deterministic starter tree for every new personal-injury case', () => {
    expect(existsSync(join(BLANK_CASE_TEMPLATE, '_case-slug.md'))).toBe(true)

    for (const relativePath of REQUIRED_CASE_STARTER_PATHS) {
      expect(
        existsSync(join(BLANK_CASE_TEMPLATE, relativePath)),
        `blank case template is missing ${relativePath}`,
      ).toBe(true)
    }
  })

  it('keeps created test-ladder cases aligned with the starter tree contract', () => {
    for (const slug of [
      'test-ladder-001-case-created',
      'test-ladder-002-document-collection-active',
      'test-ladder-003-phase0-complete',
    ]) {
      const caseDir = join(FIRMVAULT_ROOT, 'cases', slug)
      expect(existsSync(join(caseDir, `${slug}.md`))).toBe(true)

      for (const relativePath of REQUIRED_CASE_STARTER_PATHS) {
        expect(
          existsSync(join(caseDir, relativePath)),
          `${slug} is missing ${relativePath}`,
        ).toBe(true)
      }
    }
  })

  it('has real synthetic FirmVault case folders available to Mission Control', () => {
    for (const slug of [
      'test-ladder-000-new-intake-upload',
      'test-ladder-001-case-created',
      'test-ladder-002-document-collection-active',
      'test-ladder-003-phase0-complete',
    ]) {
      expect(existsSync(join(FIRMVAULT_ROOT, 'cases', slug, `${slug}.md`))).toBe(true)
    }
  })

  it('manually starts case_setup for the new-intake test case and materializes its first recipe task', () => {
    const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: firmvault-case-setup
name: FirmVault Case Setup
version: 1
subject_type: law_firm_case
triggers:
  - type: manual
nodes:
  review_intake:
    type: recipe
    recipe: firmvault-document-collection-review-intake
  create_case_shell:
    type: recipe
    recipe: firmvault-case-setup-create-shell
    depends_on:
      - review_intake
`, 'workflow-test', 1, 1)

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-000-new-intake-upload',
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 1000,
    })

    expect(instance.ready_nodes).toEqual(['review_intake'])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 1001,
      status: 'inbox',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'review_intake' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-document-collection-review-intake',
    })
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-case-setup',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-000-new-intake-upload',
        node_key: 'review_intake',
        recipe_slug: 'firmvault-document-collection-review-intake',
      },
      law_firm: {
        case_slug: 'test-ladder-000-new-intake-upload',
      },
    })
  })

  it('manually starts document_collection for the case-created test case and materializes only that case', () => {
    const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: firmvault-document-collection
name: FirmVault Document Collection
version: 1
subject_type: law_firm_case
triggers:
  - type: manual
nodes:
  load_document_checklist:
    type: recipe
    recipe: firmvault-document-collection-review-intake
    depends_on:
      conditions:
        - law_firm.landmarks.case_setup_complete == true
  request_missing_documents:
    type: recipe
    recipe: firmvault-document-collection-review-intake
    depends_on:
      - load_document_checklist
`, 'workflow-test', 1, 1)

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-001-case-created',
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 2000,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-001-case-created',
      condition: 'law_firm.landmarks.case_setup_complete == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 2000,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'load_document_checklist', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 2001,
      status: 'inbox',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'load_document_checklist' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-document-collection-review-intake',
    })
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-document-collection',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-001-case-created',
        node_key: 'load_document_checklist',
        recipe_slug: 'firmvault-document-collection-review-intake',
      },
      law_firm: {
        case_slug: 'test-ladder-001-case-created',
      },
    })
    expect(tasks[0].metadata).not.toContain('abby-sitgraves')
  })

  it('manually starts accident_report after full intake and materializes only its first task', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-accident-report.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-006-template-tool',
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 3000,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-006-template-tool',
      condition: 'law_firm.landmarks.full_intake_complete == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 3001,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'identify_report_status', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 3002,
      status: 'inbox',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'identify_report_status' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-accident-report-analyze',
    })
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-accident-report',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-006-template-tool',
        node_key: 'identify_report_status',
        recipe_slug: 'firmvault-accident-report-analyze',
      },
      law_firm: {
        case_slug: 'test-ladder-006-template-tool',
      },
    })
    expect(tasks[0].metadata).not.toContain('abby-sitgraves')
  })

  it('manually starts medical_provider_setup after full intake and materializes only its setup task', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-medical-provider-setup.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 4000,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.full_intake_complete == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 4001,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'create_provider_ledgers', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 4002,
      status: 'inbox',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'create_provider_ledgers' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-medical-provider-setup-case',
    })
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-medical-provider-setup',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-007-accident-report-found',
        node_key: 'create_provider_ledgers',
        recipe_slug: 'firmvault-medical-provider-setup-case',
      },
      law_firm: {
        case_slug: 'test-ladder-007-accident-report-found',
      },
    })
    expect(tasks[0].metadata).not.toContain('abby-sitgraves')
  })

  it('manually starts client_check_in_cadence after full intake and materializes its cadence task', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-client-check-in-cadence.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 5000,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.full_intake_complete == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 5001,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'start_check_in_cadence', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 5002,
      status: 'inbox',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'start_check_in_cadence' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-client-check-in-start-cadence',
    })
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-client-check-in-cadence',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-007-accident-report-found',
        node_key: 'start_check_in_cadence',
        recipe_slug: 'firmvault-client-check-in-start-cadence',
      },
      law_firm: {
        case_slug: 'test-ladder-007-accident-report-found',
      },
    })
  })

  it('manually starts medical_provider_status after provider setup and materializes only its status-review task', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-medical-provider-status.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 5500,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.providers_setup == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 5501,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'review_provider_statuses', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 5502,
      status: 'inbox',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'review_provider_statuses' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-medical-provider-review-status',
    })
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-medical-provider-status',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-007-accident-report-found',
        node_key: 'review_provider_statuses',
        recipe_slug: 'firmvault-medical-provider-review-status',
      },
      law_firm: {
        case_slug: 'test-ladder-007-accident-report-found',
      },
    })
  })

  it('defines executable early lien identification workflow for treatment monitoring', () => {
    const workflow = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-early-lien-identification.yaml'), 'utf8'))

    expect(workflow.id).toBe('firmvault-early-lien-identification')
    expect(workflow.subject_type).toBe('law_firm_case')
    expect(workflow.nodes.identify_potential_liens).toMatchObject({
      type: 'recipe',
      recipe: 'firmvault-lien-identify-potential',
      completes: [
        'law_firm.landmarks.health_coverage_categorized',
        'law_firm.landmarks.lien_clues_reviewed',
        'law_firm.landmarks.liens_identified',
      ],
    })
    expect(workflow.nodes.identify_potential_liens.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.providers_setup == true'],
      timers: [],
    })
    expect(workflow.nodes.human_lien_inventory_review).toMatchObject({
      type: 'review',
      completes: ['law_firm.landmarks.lien_inventory_reviewed'],
    })
  })

  it('manually starts early_lien_identification after provider setup and materializes only its identification task', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-early-lien-identification.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 5600,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.providers_setup == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 5601,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'identify_potential_liens', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 5602,
      status: 'inbox',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'identify_potential_liens' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-lien-identify-potential',
    })
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-early-lien-identification',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-007-accident-report-found',
        node_key: 'identify_potential_liens',
        recipe_slug: 'firmvault-lien-identify-potential',
      },
      law_firm: {
        case_slug: 'test-ladder-007-accident-report-found',
      },
    })
  })

  it('manually starts request_medical_records for a treatment-complete provider and materializes authorization verification first', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-request-medical-records.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-008-treatment-complete',
      vars: {
        provider_slug: 'river-city-orthopedics',
        provider_name: 'River City Orthopedics',
        request_records: true,
        request_bills: true,
        source_trigger: 'provider_treatment_complete',
      },
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 5800,
    })

    expect(instance.ready_nodes).toEqual(['verify_medical_authorization'])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 5801,
      status: 'inbox',
      baseRef: 'codex/test-ladder-008-treatment-complete-base',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'verify_medical_authorization' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-medical-records-verify-authorization',
    })
    expect(tasks[0].title).toContain('Verify Medical Authorization')
    expect(tasks[0].metadata ? JSON.parse(tasks[0].metadata) : {}).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-request-medical-records',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-008-treatment-complete',
        node_key: 'verify_medical_authorization',
        recipe_slug: 'firmvault-medical-records-verify-authorization',
        vars: {
          provider_slug: 'river-city-orthopedics',
          provider_name: 'River City Orthopedics',
          request_records: true,
          request_bills: true,
          source_trigger: 'provider_treatment_complete',
        },
      },
      law_firm: {
        case_slug: 'test-ladder-008-treatment-complete',
        provider_slug: 'river-city-orthopedics',
        provider_name: 'River City Orthopedics',
      },
    })
  })

  it('manually starts bi_claim_setup after accident report analysis and materializes only its carrier-identification task', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-bi-claim-setup.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 6000,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.accident_report_obtained == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 6001,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'identify_bi_carrier', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 6002,
      status: 'inbox',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'identify_bi_carrier' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-insurance-bi-identify-carrier',
    })
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-bi-claim-setup',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-007-accident-report-found',
        node_key: 'identify_bi_carrier',
        recipe_slug: 'firmvault-insurance-bi-identify-carrier',
      },
      law_firm: {
        case_slug: 'test-ladder-007-accident-report-found',
      },
    })
  })

  it('starts demand readiness only after records, bills, and chronology conditions are satisfied', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-demand-readiness.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      vars: {
        case_slug: 'test-ladder-007-accident-report-found',
        source_trigger: 'records_bills_complete',
      },
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 6200,
    })

    expect(instance.ready_nodes).toEqual([])

    satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.all_records_received == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 6201,
    })
    satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.all_bills_received == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 6202,
    })
    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.medical_chronology_updated == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 6203,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'gather_demand_materials', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 6204,
      status: 'inbox',
      baseRef: 'codex/test-ladder-008-treatment-complete-base',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'gather_demand_materials' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-demand-gather-materials',
    })
    expect(tasks[0].title).toContain('Gather Demand Materials')
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-demand-readiness',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-007-accident-report-found',
        node_key: 'gather_demand_materials',
        recipe_slug: 'firmvault-demand-gather-materials',
        vars: {
          case_slug: 'test-ladder-007-accident-report-found',
          source_trigger: 'records_bills_complete',
        },
      },
      law_firm: {
        case_slug: 'test-ladder-007-accident-report-found',
      },
    })
  })

  it('defines executable draft demand workflow with internal-only final lien process check', () => {
    const draftDemand = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-draft-demand.yaml'), 'utf8'))

    expect(draftDemand.id).toBe('firmvault-draft-demand')
    expect(draftDemand.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'condition',
        condition: 'law_firm.landmarks.demand_readiness_reviewed == true',
      }),
      expect.objectContaining({ type: 'manual' }),
    ]))
    expect(draftDemand.nodes.check_final_lien_process.recipe).toBe('firmvault-demand-check-final-lien-process')
    expect(draftDemand.nodes.check_final_lien_process.config.task_goal).toContain('internal readiness check only')
    expect(draftDemand.nodes.check_final_lien_process.config.task_goal).toContain('final-lien workflow')
    expect(draftDemand.nodes.draft_demand_letter.depends_on).toEqual({
      nodes: ['check_final_lien_process'],
      conditions: [],
      timers: [],
    })
    expect(draftDemand.nodes.draft_demand_letter.recipe).toBe('firmvault-demand-draft-letter')
    expect(draftDemand.nodes.draft_demand_letter.config.task_goal).toContain('Do not include or mention lien information')
    expect(draftDemand.nodes.draft_demand_letter.config.task_goal).toContain('must remain open for attorney review')
    expect(draftDemand.nodes.draft_demand_letter.config.task_goal).toContain("attorney's merge")
    expect(draftDemand.nodes.draft_demand_letter.config.attorney_pr_gate).toBe(true)
    expect(draftDemand.nodes.draft_demand_letter.config.merge_requires_attorney_review).toBe(true)
    expect(draftDemand.nodes.draft_demand_letter.completes).toContain('law_firm.landmarks.demand_drafted')
    expect(draftDemand.nodes.draft_demand_letter.completes).toContain(
      'law_firm.landmarks.attorney_reviewed_demand',
    )
    expect(draftDemand.nodes.attorney_review_demand).toBeUndefined()
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-demand-check-final-lien-process', 'SOUL.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-demand-check-final-lien-process', 'REVIEW.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-demand-draft-letter', 'SOUL.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-demand-draft-letter', 'REVIEW.md')),
    ).toBe(true)

    const draftSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-demand-draft-letter', 'SOUL.md'),
      'utf8',
    )
    expect(draftSoul).toContain('Do not include lien information in the demand letter')
    expect(draftSoul).toContain('The PR must remain open for attorney review')
    const lienSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-demand-check-final-lien-process', 'SOUL.md'),
      'utf8',
    )
    expect(lienSoul).toContain('final-lien workflow should be started now')
    expect(lienSoul).toContain('must not be inserted into')
  })

  it('defines executable send demand workflow with same-task human send confirmation', () => {
    const sendDemand = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-send-demand.yaml'), 'utf8'))

    expect(sendDemand.id).toBe('firmvault-send-demand')
    expect(sendDemand.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'condition',
        condition: 'law_firm.landmarks.attorney_reviewed_demand == true',
      }),
      expect.objectContaining({ type: 'manual' }),
    ]))
    expect(sendDemand.nodes.identify_demand_recipients.recipe).toBe('firmvault-demand-identify-recipients')
    expect(sendDemand.nodes.identify_demand_recipients.completes).toContain(
      'law_firm.landmarks.demand_recipients_identified',
    )
    expect(sendDemand.nodes.send_demand_package.depends_on).toEqual({
      nodes: ['identify_demand_recipients'],
      conditions: [],
      timers: [],
    })
    expect(sendDemand.nodes.send_demand_package.recipe).toBe('firmvault-demand-send-package')
    expect(sendDemand.nodes.send_demand_package.config.task_goal).toContain('same Mission Control task thread')
    expect(sendDemand.nodes.send_demand_package.config.task_goal).toContain('Do not send mail, email, fax, portal messages')
    expect(sendDemand.nodes.send_demand_package.completes).toContain('law_firm.landmarks.demand_sent')
    expect(sendDemand.nodes.wait_for_response.type).toBe('wait')
    expect(sendDemand.nodes.wait_for_response.depends_on).toEqual({
      nodes: ['send_demand_package'],
      conditions: [],
      timers: [],
    })
    expect(sendDemand.nodes.wait_for_response.exit_when).toMatchObject({
      condition: 'law_firm.landmarks.initial_offer_received == true',
    })
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-demand-identify-recipients', 'SOUL.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-demand-identify-recipients', 'REVIEW.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-demand-send-package', 'SOUL.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-demand-send-package', 'REVIEW.md')),
    ).toBe(true)
  })

  it('defines executable track offers workflow after demand is sent', () => {
    const trackOffers = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-track-offers.yaml'), 'utf8'))

    expect(trackOffers.id).toBe('firmvault-track-offers')
    expect(trackOffers.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'condition',
        condition: 'law_firm.landmarks.demand_sent == true',
      }),
      expect.objectContaining({ type: 'manual' }),
    ]))
    expect(trackOffers.nodes.wait_for_offer_response.type).toBe('wait')
    expect(trackOffers.nodes.wait_for_offer_response.duration).toBe('30d')
    expect(trackOffers.nodes.wait_for_offer_response.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.demand_sent == true'],
      timers: [],
    })
    expect(trackOffers.nodes.wait_for_offer_response.exit_when).toMatchObject({
      condition: 'law_firm.landmarks.initial_offer_received == true',
    })
    expect(trackOffers.nodes.log_incoming_offer.recipe).toBe('firmvault-negotiation-track-offer')
    expect(trackOffers.nodes.log_incoming_offer.depends_on).toEqual({
      nodes: ['wait_for_offer_response'],
      conditions: [],
      timers: [],
    })
    expect(trackOffers.nodes.log_incoming_offer.completes).toEqual([
      'law_firm.landmarks.initial_offer_received',
      'law_firm.landmarks.offer_documented',
    ])
    expect(trackOffers.nodes.log_incoming_offer.config.task_goal).toContain('same-task Mission Control comments')
    expect(trackOffers.nodes.log_incoming_offer.config.task_goal).toContain('Do not evaluate the offer')
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-negotiation-track-offer', 'SOUL.md')),
    ).toBe(true)
    expect(
      existsSync(join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-negotiation-track-offer', 'REVIEW.md')),
    ).toBe(true)
    const soul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-negotiation-track-offer', 'SOUL.md'),
      'utf8',
    )
    expect(soul).toContain('This recipe only documents')
    expect(soul).toContain('Do not recommend accept, counter, reject, or impasse')
  })

  it('defines executable offer evaluation workflow with attorney PR and client decision gates', () => {
    const offerEvaluation = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-offer-evaluation.yaml'), 'utf8'))

    expect(offerEvaluation.id).toBe('firmvault-offer-evaluation')
    expect(offerEvaluation.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'condition',
        condition: 'law_firm.landmarks.offer_documented == true',
      }),
      expect.objectContaining({ type: 'manual' }),
    ]))
    expect(offerEvaluation.nodes.prepare_offer_evaluation.recipe).toBe('firmvault-negotiation-offer-evaluation')
    expect(offerEvaluation.nodes.prepare_offer_evaluation.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.offer_documented == true'],
      timers: [],
    })
    expect(offerEvaluation.nodes.prepare_offer_evaluation.completes).toEqual([
      'law_firm.landmarks.offer_evaluated',
      'law_firm.landmarks.net_to_client_prepared',
    ])
    expect(offerEvaluation.nodes.prepare_offer_evaluation.config.task_goal).toContain('attorney-facing offer evaluation')
    expect(offerEvaluation.nodes.prepare_offer_evaluation.config.task_goal).toContain('do not make a final legal recommendation')
    expect(offerEvaluation.nodes.prepare_offer_evaluation.config.attorney_pr_gate).toBe(true)
    expect(offerEvaluation.nodes.prepare_offer_evaluation.config.merge_requires_attorney_review).toBe(true)
    expect(offerEvaluation.nodes.client_offer_decision.review).toMatchObject({ mode: 'human' })
    expect(offerEvaluation.nodes.client_offer_decision.depends_on).toEqual({
      nodes: ['prepare_offer_evaluation'],
      conditions: [],
      timers: [],
    })
    expect(offerEvaluation.nodes.client_offer_decision.completes).toContain(
      'law_firm.landmarks.client_advised_of_offer',
    )
    expect(offerEvaluation.nodes.document_client_decision.recipe).toBe(
      'firmvault-negotiation-document-client-decision',
    )
    expect(offerEvaluation.nodes.document_client_decision.depends_on).toEqual({
      nodes: ['client_offer_decision'],
      conditions: [],
      timers: [],
    })
    expect(offerEvaluation.nodes.document_client_decision.config.task_goal).toContain('same-task Mission Control comments')
    expect(offerEvaluation.nodes.document_client_decision.config.task_goal).toContain('Negotiate Claim workflow')

    for (const recipeSlug of [
      'firmvault-negotiation-offer-evaluation',
      'firmvault-negotiation-document-client-decision',
    ]) {
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'SOUL.md'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'REVIEW.md'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'recipe.yaml'))).toBe(true)
    }

    const evaluationSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-negotiation-offer-evaluation', 'SOUL.md'),
      'utf8',
    )
    expect(evaluationSoul).toContain('does not make the final legal decision')
    expect(evaluationSoul).toContain('Do not research comparable verdicts on the public internet')
    const decisionSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-negotiation-document-client-decision', 'SOUL.md'),
      'utf8',
    )
    expect(decisionSoul).toContain('The human review comment is the controlling source')
    expect(decisionSoul).toContain('do not mark settlement reached')
  })

  it('manually starts offer_evaluation after an offer is documented and materializes only its analysis task', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-offer-evaluation.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      vars: {
        case_slug: 'test-ladder-007-accident-report-found',
        source_trigger: 'offer_documented',
      },
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 6500,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.offer_documented == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 6501,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'prepare_offer_evaluation', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 6502,
      status: 'inbox',
      baseRef: 'codex/test-ladder-008-treatment-complete-base',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'prepare_offer_evaluation' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-negotiation-offer-evaluation',
    })
    expect(tasks[0].title).toContain('Prepare Offer Evaluation')
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-offer-evaluation',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-007-accident-report-found',
        node_key: 'prepare_offer_evaluation',
        recipe_slug: 'firmvault-negotiation-offer-evaluation',
        vars: {
          case_slug: 'test-ladder-007-accident-report-found',
          source_trigger: 'offer_documented',
        },
      },
      law_firm: {
        case_slug: 'test-ladder-007-accident-report-found',
      },
    })
  })

  it('defines executable negotiate claim workflow for the settlement acceptance handoff', () => {
    const negotiateClaim = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-negotiate-claim.yaml'), 'utf8'))

    expect(negotiateClaim.id).toBe('firmvault-negotiate-claim')
    expect(negotiateClaim.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'condition',
        condition: 'law_firm.landmarks.offer_decision_documented == true',
      }),
      expect.objectContaining({ type: 'manual' }),
    ]))
    expect(negotiateClaim.nodes.prepare_negotiation_response.recipe).toBe(
      'firmvault-negotiation-prepare-response',
    )
    expect(negotiateClaim.nodes.prepare_negotiation_response.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.offer_decision_documented == true'],
      timers: [],
    })
    expect(negotiateClaim.nodes.prepare_negotiation_response.completes).toContain(
      'law_firm.landmarks.negotiation_response_prepared',
    )
    expect(negotiateClaim.nodes.prepare_negotiation_response.config.task_goal).toContain(
      'Do not send any external communication',
    )
    expect(negotiateClaim.nodes.prepare_negotiation_response.config.task_goal).toContain(
      'do not mark settlement reached',
    )
    expect(negotiateClaim.nodes.human_send_negotiation_response.review).toMatchObject({ mode: 'human' })
    expect(negotiateClaim.nodes.human_send_negotiation_response.config.task_goal).toContain(
      'comment with send date',
    )
    expect(negotiateClaim.nodes.document_negotiation_response.recipe).toBe(
      'firmvault-negotiation-document-response',
    )
    expect(negotiateClaim.nodes.document_negotiation_response.depends_on).toEqual({
      nodes: ['human_send_negotiation_response'],
      conditions: [],
      timers: [],
    })
    expect(negotiateClaim.nodes.document_negotiation_response.completes).toEqual([
      'law_firm.landmarks.negotiation_result_documented',
      'law_firm.landmarks.settlement_reached',
    ])
    expect(negotiateClaim.nodes.document_negotiation_response.config.task_goal).toContain(
      'external acceptance was actually sent',
    )
    expect(negotiateClaim.nodes.document_negotiation_response.config.task_goal).toContain(
      'If the human comment records a counter or rejection',
    )

    for (const recipeSlug of [
      'firmvault-negotiation-prepare-response',
      'firmvault-negotiation-document-response',
    ]) {
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'recipe.yaml'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'SOUL.md'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'REVIEW.md'))).toBe(true)
    }

    const prepareSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-negotiation-prepare-response', 'SOUL.md'),
      'utf8',
    )
    expect(prepareSoul).toContain('does not contact the carrier')
    expect(prepareSoul).toContain('do not say the settlement is reached until a human later confirms')
    const documentSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-negotiation-document-response', 'SOUL.md'),
      'utf8',
    )
    expect(documentSoul).toContain('same-task human-send comment is the controlling source')
    expect(documentSoul).toContain('mark settlement reached only because external acceptance was human-confirmed')
  })

  it('manually starts negotiate_claim after offer decision documentation and materializes only its response-preparation task', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-negotiate-claim.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      vars: {
        case_slug: 'test-ladder-007-accident-report-found',
        source_trigger: 'offer_decision_documented',
      },
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 6600,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.offer_decision_documented == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 6601,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'prepare_negotiation_response', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 6602,
      status: 'inbox',
      baseRef: 'codex/test-ladder-008-treatment-complete-base',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'prepare_negotiation_response' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-negotiation-prepare-response',
    })
    expect(tasks[0].title).toContain('Prepare Negotiation Response')
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-negotiate-claim',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-007-accident-report-found',
        node_key: 'prepare_negotiation_response',
        recipe_slug: 'firmvault-negotiation-prepare-response',
        vars: {
          case_slug: 'test-ladder-007-accident-report-found',
          source_trigger: 'offer_decision_documented',
        },
      },
      law_firm: {
        case_slug: 'test-ladder-007-accident-report-found',
      },
    })
  })

  it('defines executable settlement processing workflow after settlement reached', () => {
    const settlementProcessing = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-settlement-processing.yaml'), 'utf8'))

    expect(settlementProcessing.id).toBe('firmvault-settlement-processing')
    expect(settlementProcessing.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'condition',
        condition: 'law_firm.landmarks.settlement_reached == true',
      }),
      expect.objectContaining({ type: 'manual' }),
    ]))
    expect(settlementProcessing.nodes.prepare_settlement_statement.recipe).toBe(
      'firmvault-settlement-prepare-statement',
    )
    expect(settlementProcessing.nodes.prepare_settlement_statement.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.settlement_reached == true'],
      timers: [],
    })
    expect(settlementProcessing.nodes.prepare_settlement_statement.completes).toContain(
      'law_firm.landmarks.settlement_statement_prepared',
    )
    expect(settlementProcessing.nodes.prepare_settlement_statement.config.task_goal).toContain(
      'instead of inventing numbers',
    )
    expect(settlementProcessing.nodes.prepare_authorization_to_settle.recipe).toBe(
      'firmvault-settlement-prepare-authorization',
    )
    expect(settlementProcessing.nodes.prepare_authorization_to_settle.depends_on).toEqual({
      nodes: ['prepare_settlement_statement'],
      conditions: [],
      timers: [],
    })
    expect(settlementProcessing.nodes.get_client_signature.review).toMatchObject({ mode: 'human' })
    expect(settlementProcessing.nodes.execute_release.review).toMatchObject({ mode: 'human' })
    expect(settlementProcessing.nodes.wait_for_funds.duration).toBe('14d')
    expect(settlementProcessing.nodes.wait_for_funds.exit_when).toMatchObject({
      condition: 'law_firm.landmarks.funds_received == true',
    })
    expect(settlementProcessing.nodes.receive_settlement_funds.recipe).toBe(
      'firmvault-settlement-document-funds',
    )
    expect(settlementProcessing.nodes.receive_settlement_funds.config.task_goal).toContain(
      'Do not pay liens',
    )

    for (const recipeSlug of [
      'firmvault-settlement-prepare-statement',
      'firmvault-settlement-prepare-authorization',
      'firmvault-settlement-document-funds',
    ]) {
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'recipe.yaml'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'SOUL.md'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'REVIEW.md'))).toBe(true)
    }

    const statementSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-settlement-prepare-statement', 'SOUL.md'),
      'utf8',
    )
    expect(statementSoul).toContain('It does not contact the client')
    expect(statementSoul).toContain('Do not invent fee rates')
    const fundsSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-settlement-document-funds', 'SOUL.md'),
      'utf8',
    )
    expect(fundsSoul).toContain('Same-task human comments are the controlling source')
    expect(fundsSoul).toContain('Do not mark liens paid')
  })

  it('manually starts settlement_processing after settlement reached and materializes only the statement task', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-settlement-processing.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      vars: {
        case_slug: 'test-ladder-007-accident-report-found',
        source_trigger: 'settlement_reached',
      },
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 6700,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.settlement_reached == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 6701,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'prepare_settlement_statement', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 6702,
      status: 'inbox',
      baseRef: 'codex/test-ladder-008-treatment-complete-base',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'prepare_settlement_statement' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-settlement-prepare-statement',
    })
    expect(tasks[0].title).toContain('Prepare Settlement Statement')
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-settlement-processing',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-007-accident-report-found',
        node_key: 'prepare_settlement_statement',
        recipe_slug: 'firmvault-settlement-prepare-statement',
        vars: {
          case_slug: 'test-ladder-007-accident-report-found',
          source_trigger: 'settlement_reached',
        },
      },
      law_firm: {
        case_slug: 'test-ladder-007-accident-report-found',
      },
    })
  })

  it('defines executable settlement lien negotiation workflow with no-lien bypass support', () => {
    const lienNegotiation = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-settlement-lien-negotiation.yaml'), 'utf8'))

    expect(lienNegotiation.id).toBe('firmvault-settlement-lien-negotiation')
    expect(lienNegotiation.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'condition',
        condition: 'law_firm.landmarks.settlement_reached == true',
      }),
      expect.objectContaining({ type: 'manual' }),
    ]))
    expect(lienNegotiation.nodes.audit_settlement_liens.recipe).toBe('firmvault-settlement-lien-audit')
    expect(lienNegotiation.nodes.audit_settlement_liens.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.settlement_reached == true'],
      timers: [],
    })
    expect(lienNegotiation.nodes.audit_settlement_liens.completes).toEqual([
      'law_firm.landmarks.settlement_liens_audited',
      'law_firm.landmarks.liens_prioritized',
      'law_firm.landmarks.lien_available_funds_calculated',
    ])
    expect(lienNegotiation.nodes.audit_settlement_liens.config.task_goal).toContain(
      'no settlement-lien negotiation is currently applicable',
    )
    expect(lienNegotiation.nodes.human_lien_strategy_review.review).toMatchObject({ mode: 'human' })
    expect(lienNegotiation.nodes.document_lien_negotiation_result.recipe).toBe(
      'firmvault-settlement-lien-document-result',
    )
    expect(lienNegotiation.nodes.document_lien_negotiation_result.config.task_goal).toContain(
      'If no outstanding liens were accepted as applicable',
    )
    expect(lienNegotiation.nodes.document_lien_negotiation_result.config.task_goal).toContain(
      'Do not pay liens',
    )

    for (const recipeSlug of [
      'firmvault-settlement-lien-audit',
      'firmvault-settlement-lien-document-result',
    ]) {
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'recipe.yaml'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'SOUL.md'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'REVIEW.md'))).toBe(true)
    }

    const auditSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-settlement-lien-audit', 'SOUL.md'),
      'utf8',
    )
    expect(auditSoul).toContain('Do not create speculative liens from medical treatment alone')
    expect(auditSoul).toContain('settlement lien negotiation is not currently applicable')
    const resultSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-settlement-lien-document-result', 'SOUL.md'),
      'utf8',
    )
    expect(resultSoul).toContain('Same-task comments are the controlling source')
    expect(resultSoul).toContain('do not mark final distribution complete')
  })

  it('manually starts settlement_lien_negotiation after settlement reached and materializes only the audit task', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-settlement-lien-negotiation.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      vars: {
        case_slug: 'test-ladder-007-accident-report-found',
        source_trigger: 'settlement_reached',
      },
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 6800,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.settlement_reached == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 6801,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'audit_settlement_liens', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 6802,
      status: 'inbox',
      baseRef: 'codex/test-ladder-008-treatment-complete-base',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'audit_settlement_liens' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-settlement-lien-audit',
    })
    expect(tasks[0].title).toContain('Audit Settlement Liens')
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-settlement-lien-negotiation',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-007-accident-report-found',
        node_key: 'audit_settlement_liens',
        recipe_slug: 'firmvault-settlement-lien-audit',
        vars: {
          case_slug: 'test-ladder-007-accident-report-found',
          source_trigger: 'settlement_reached',
        },
      },
      law_firm: {
        case_slug: 'test-ladder-007-accident-report-found',
      },
    })
  })

  it('defines executable final distribution workflow after funds and liens are resolved', () => {
    const finalDistribution = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-final-distribution.yaml'), 'utf8'))

    expect(finalDistribution.id).toBe('firmvault-final-distribution')
    expect(finalDistribution.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'condition',
        condition: 'law_firm.landmarks.liens_negotiated == true',
      }),
      expect.objectContaining({
        type: 'condition',
        condition: 'law_firm.landmarks.funds_received == true',
      }),
      expect.objectContaining({ type: 'manual' }),
    ]))
    expect(finalDistribution.nodes.prepare_final_distribution_statement.recipe).toBe(
      'firmvault-final-distribution-prepare-statement',
    )
    expect(finalDistribution.nodes.prepare_final_distribution_statement.depends_on).toEqual({
      nodes: [],
      conditions: [
        'law_firm.landmarks.funds_received == true',
        'law_firm.landmarks.liens_negotiated == true',
      ],
      timers: [],
    })
    expect(finalDistribution.nodes.prepare_final_distribution_statement.config.task_goal).toContain(
      'require same-task human/test comments',
    )
    expect(finalDistribution.nodes.human_issue_client_distribution.review).toMatchObject({ mode: 'human' })
    expect(finalDistribution.nodes.human_confirm_client_receipt.review).toMatchObject({ mode: 'human' })
    expect(finalDistribution.nodes.zero_trust_account.recipe).toBe('firmvault-final-distribution-zero-trust')
    expect(finalDistribution.nodes.zero_trust_account.completes).toEqual([
      'law_firm.landmarks.trust_account_zeroed',
      'law_firm.landmarks.final_distribution_complete',
    ])
    expect(finalDistribution.nodes.zero_trust_account.config.task_goal).toContain(
      'Require human/test facts',
    )

    for (const recipeSlug of [
      'firmvault-final-distribution-prepare-statement',
      'firmvault-final-distribution-zero-trust',
    ]) {
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'recipe.yaml'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'SOUL.md'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'REVIEW.md'))).toBe(true)
    }

    const prepareSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-final-distribution-prepare-statement', 'SOUL.md'),
      'utf8',
    )
    expect(prepareSoul).toContain('It does not issue checks')
    expect(prepareSoul).toContain('mark final distribution complete')
    const zeroSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-final-distribution-zero-trust', 'SOUL.md'),
      'utf8',
    )
    expect(zeroSoul).toContain('Same-task comments are the controlling source')
    expect(zeroSoul).toContain('final balance is zero')
  })

  it('manually starts final_distribution only after funds received and liens negotiated are both satisfied', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-final-distribution.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      vars: {
        case_slug: 'test-ladder-007-accident-report-found',
        source_trigger: 'no_lien_clearance',
      },
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 6900,
    })

    expect(instance.ready_nodes).toEqual([])

    satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.funds_received == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 6901,
    })

    expect(materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 6902,
      status: 'inbox',
      baseRef: 'codex/test-ladder-008-treatment-complete-base',
    }).created).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.liens_negotiated == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 6903,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'prepare_final_distribution_statement', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 6904,
      status: 'inbox',
      baseRef: 'codex/test-ladder-008-treatment-complete-base',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'prepare_final_distribution_statement' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-final-distribution-prepare-statement',
    })
    expect(tasks[0].title).toContain('Prepare Final Distribution Statement')
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-final-distribution',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-007-accident-report-found',
        node_key: 'prepare_final_distribution_statement',
        recipe_slug: 'firmvault-final-distribution-prepare-statement',
        vars: {
          case_slug: 'test-ladder-007-accident-report-found',
          source_trigger: 'no_lien_clearance',
        },
      },
      law_firm: {
        case_slug: 'test-ladder-007-accident-report-found',
      },
    })
  })

  it('defines executable close case workflow after final distribution complete', () => {
    const closeCase = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-close-case.yaml'), 'utf8'))

    expect(closeCase.id).toBe('firmvault-close-case')
    expect(closeCase.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'condition',
        condition: 'law_firm.landmarks.final_distribution_complete == true',
      }),
      expect.objectContaining({ type: 'manual' }),
    ]))
    expect(closeCase.nodes.verify_closure_readiness.recipe).toBe('firmvault-close-case-verify-readiness')
    expect(closeCase.nodes.verify_closure_readiness.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.final_distribution_complete == true'],
      timers: [],
    })
    expect(closeCase.nodes.prepare_closing_letter.recipe).toBe('firmvault-close-case-prepare-letter')
    expect(closeCase.nodes.human_send_closing_letter.review).toMatchObject({ mode: 'human' })
    expect(closeCase.nodes.human_archive_file.review).toMatchObject({ mode: 'human' })
    expect(closeCase.nodes.document_case_closed.recipe).toBe('firmvault-close-case-document-closure')
    expect(closeCase.nodes.document_case_closed.completes).toEqual([
      'law_firm.landmarks.case_closed',
    ])

    for (const recipeSlug of [
      'firmvault-close-case-verify-readiness',
      'firmvault-close-case-prepare-letter',
      'firmvault-close-case-document-closure',
    ]) {
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'recipe.yaml'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'SOUL.md'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'REVIEW.md'))).toBe(true)
    }

    const closureSoul = readFileSync(
      join(MISSION_CONTROL_ROOT, 'recipes', 'firmvault-close-case-document-closure', 'SOUL.md'),
      'utf8',
    )
    expect(closureSoul).toContain('same-task Mission Control comments')
    expect(closureSoul).toContain('archive location/reference')
  })

  it('defines executable lien resolution workflow for open-lien final amount and payment path', () => {
    const lienResolution = parseWorkflowDefinition(readFileSync(join(WORKFLOWS_ROOT, 'firmvault-lien-resolution.yaml'), 'utf8'))

    expect(lienResolution.id).toBe('firmvault-lien-resolution')
    expect(lienResolution.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'condition',
        condition: 'law_firm.landmarks.liens_identified == true',
      }),
      expect.objectContaining({ type: 'manual' }),
    ]))
    expect(lienResolution.nodes.review_lien_inventory.recipe).toBe('firmvault-lien-resolution-review-inventory')
    expect(lienResolution.nodes.review_lien_inventory.depends_on).toEqual({
      nodes: [],
      conditions: ['law_firm.landmarks.liens_identified == true'],
      timers: [],
    })
    expect(lienResolution.nodes.prepare_final_lien_request.recipe).toBe(
      'firmvault-lien-resolution-prepare-final-request',
    )
    expect(lienResolution.nodes.human_send_final_lien_request.review).toMatchObject({ mode: 'human' })
    expect(lienResolution.nodes.wait_for_final_lien_amount.duration).toBe('30d')
    expect(lienResolution.nodes.wait_for_final_lien_amount.exit_when).toMatchObject({
      condition: 'law_firm.landmarks.final_amounts_received == true',
    })
    expect(lienResolution.nodes.document_final_lien_amount.recipe).toBe(
      'firmvault-lien-resolution-document-final-amount',
    )
    expect(lienResolution.nodes.human_lien_payment_review.review).toMatchObject({ mode: 'human' })
    expect(lienResolution.nodes.document_lien_payment.recipe).toBe('firmvault-lien-resolution-document-payment')
    expect(lienResolution.nodes.document_lien_payment.completes).toEqual([
      'law_firm.landmarks.liens_negotiated',
      'law_firm.landmarks.liens_paid',
    ])

    for (const recipeSlug of [
      'firmvault-lien-resolution-review-inventory',
      'firmvault-lien-resolution-prepare-final-request',
      'firmvault-lien-resolution-document-final-amount',
      'firmvault-lien-resolution-document-payment',
    ]) {
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'recipe.yaml'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'SOUL.md'))).toBe(true)
      expect(existsSync(join(MISSION_CONTROL_ROOT, 'recipes', recipeSlug, 'REVIEW.md'))).toBe(true)
    }
  })

  it('manually starts lien_resolution after liens identified and materializes only the inventory review task', () => {
    const definitionId = createWorkflowDefinition(
      db,
      readFileSync(join(WORKFLOWS_ROOT, 'firmvault-lien-resolution.yaml'), 'utf8'),
      'workflow-test',
      1,
      1,
    )

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      vars: {
        case_slug: 'test-ladder-007-accident-report-found',
        source_trigger: 'lien_identified',
      },
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 7000,
    })

    expect(instance.ready_nodes).toEqual([])

    const satisfied = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-007-accident-report-found',
      condition: 'law_firm.landmarks.liens_identified == true',
      actor: 'workflow-test',
      workspaceId: 1,
      now: 7001,
    })

    expect(satisfied.promoted_nodes).toMatchObject([
      { node_key: 'review_lien_inventory', status: 'ready' },
    ])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 7002,
      status: 'inbox',
      baseRef: 'codex/test-ladder-008-treatment-complete-base',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'review_lien_inventory' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-lien-resolution-review-inventory',
    })
    expect(tasks[0].title).toContain('Review Lien Inventory')
  })
})
