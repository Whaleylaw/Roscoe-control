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
})
