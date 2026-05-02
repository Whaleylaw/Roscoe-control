import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import {
  advanceWorkflowAfterTaskApproval,
  createWorkflowDefinition,
  materializeReadyWorkflowNodes,
  startWorkflowInstance,
} from '../workflow-engine'
import {
  resolveFirmVaultPassiveLandmarks,
  satisfyPassiveFirmVaultLandmarks,
} from '../firmvault-passive-landmarks'

const previousRoot = process.env.MISSION_CONTROL_LAW_FIRM_ROOT

afterEach(() => {
  if (previousRoot === undefined) delete process.env.MISSION_CONTROL_LAW_FIRM_ROOT
  else process.env.MISSION_CONTROL_LAW_FIRM_ROOT = previousRoot
})

function writeCase(root: string, slug: string, opts: { contractSigned?: boolean; medicalAuthSigned?: boolean }) {
  const caseDir = join(root, 'cases', slug)
  mkdirSync(join(caseDir, 'client'), { recursive: true })
  writeFileSync(join(caseDir, `${slug}.md`), `---
schema_version: 3
case_slug: ${slug}
landmarks:
  contract_signed:
    satisfied: false
  medical_auth_signed:
    satisfied: false
---

# Test Case
`)
  writeFileSync(join(caseDir, 'client', 'contracts.md'), `---
schema_version: 3
ledger: client_contracts
case_slug: ${slug}
contract_signed: ${opts.contractSigned ? 'true' : 'false'}
fee_contract_shadow: documents/shadows/client/fee-agreement-signed.md
---

# Contracts
`)
  writeFileSync(join(caseDir, 'client', 'authorizations.md'), `---
schema_version: 3
ledger: client_authorizations
case_slug: ${slug}
hipaa_signed: ${opts.medicalAuthSigned ? 'true' : 'false'}
medical_authorization_signed: ${opts.medicalAuthSigned ? 'true' : 'false'}
evidence:
  - documents/shadows/client/medical-authorization-signed.md
---

# Authorizations
`)
}

function writeCanonicalShadow(root: string, slug: string, fileName: string) {
  const shadowsDir = join(root, 'cases', slug, 'documents', 'shadows', 'client')
  mkdirSync(shadowsDir, { recursive: true })
  writeFileSync(join(shadowsDir, fileName), `---
schema_version: 3
document_type: ${fileName.includes('authorization') ? 'authorization' : 'contract'}
real_file_uri: firm-storage://test/${fileName.replace(/\\.md$/, '.pdf')}
received_date: "2026-04-28"
---

# ${fileName.replace(/-/g, ' ').replace(/\\.md$/, '')}
`)
}

function writePipAcknowledgmentShadow(root: string, slug: string) {
  const receivedDir = join(root, 'cases', slug, 'documents', 'received', 'insurance')
  mkdirSync(receivedDir, { recursive: true })
  writeFileSync(join(receivedDir, 'kac-acknowledgment.md'), `---
schema_version: 3
document_type: insurance_pip_acknowledgment
case_slug: ${slug}
carrier_name: Kentucky Assigned Claims / Travelers
acknowledgment_status: acknowledged
pip_approved: true
received_date: "2026-04-29"
---

# KAC Acknowledgment
`)
}

function writeDemandSentEvidence(root: string, slug: string) {
  const caseDir = join(root, 'cases', slug)
  mkdirSync(join(caseDir, 'insurance'), { recursive: true })
  mkdirSync(join(caseDir, 'documents', 'sent', 'insurance'), { recursive: true })
  writeFileSync(join(caseDir, 'insurance', 'bi-progressive.md'), `---
schema_version: 3
ledger: insurance_claim
case_slug: ${slug}
coverage_type: BI
carrier_name: Progressive
demand_sent: true
demand_sent_date: "2026-05-01"
---

# Progressive BI Claim
`)
  writeFileSync(join(caseDir, 'documents', 'sent', 'insurance', 'bi-progressive-demand-sent.md'), `---
schema_version: 3
document_type: demand_sent_shadow
case_slug: ${slug}
carrier_name: Progressive
sent_date: "2026-05-01"
---

# BI Progressive Demand Sent
`)
}

function writeOfferEvidence(root: string, slug: string) {
  const caseDir = join(root, 'cases', slug)
  mkdirSync(join(caseDir, 'insurance'), { recursive: true })
  mkdirSync(join(caseDir, 'negotiation'), { recursive: true })
  mkdirSync(join(caseDir, 'documents', 'received', 'insurance'), { recursive: true })
  writeFileSync(join(caseDir, 'insurance', 'bi-progressive.md'), `---
schema_version: 3
ledger: insurance_claim
case_slug: ${slug}
coverage_type: BI
carrier_name: Progressive
initial_offer_received: true
initial_offer_amount: 15000
---

# Progressive BI Claim
`)
  writeFileSync(join(caseDir, 'negotiation', 'offers.md'), `---
schema_version: 3
ledger: offers
case_slug: ${slug}
---

# Offers

## 2020-02-26 - Progressive initial BI offer

- Amount: $15,000.00
- Source: documents/received/insurance/progressive-offer-letter.md
`)
  writeFileSync(join(caseDir, 'documents', 'received', 'insurance', 'progressive-offer-letter.md'), `---
schema_version: 3
document_type: insurance_offer_letter
case_slug: ${slug}
carrier_name: Progressive
offer_amount: 15000
received_date: "2020-02-26"
---

# Progressive Offer Letter
`)
}

function writeFinalDistributionEvidence(root: string, slug: string) {
  const caseDir = join(root, 'cases', slug)
  mkdirSync(join(caseDir, 'settlement'), { recursive: true })
  mkdirSync(join(caseDir, 'documents', 'received', 'settlement'), { recursive: true })
  writeFileSync(join(caseDir, 'settlement', 'distribution.md'), `---
schema_version: 3
ledger: settlement_distribution
case_slug: ${slug}
status: final_distribution_complete
final_distribution_status: complete
trust_account_status: zeroed
---

# Distribution

Final distribution status: complete
Final trust-account balance: $0.00
`)
  writeFileSync(join(caseDir, 'documents', 'received', 'settlement', 'client-distribution-receipt.md'), `---
schema_version: 3
document_type: client_distribution_receipt
case_slug: ${slug}
final_distribution_complete: true
received_date: "2026-05-02"
---

# Client Distribution Receipt
`)
}

function writeProviderRecordsAndBills(root: string, slug: string, providerSlug: string) {
  const providerDir = join(root, 'cases', slug, 'medical-providers', providerSlug)
  mkdirSync(join(providerDir, 'documents'), { recursive: true })
  writeFileSync(join(providerDir, 'records-bills.md'), `---
schema_version: 3
ledger: provider_records_bills
case_slug: ${slug}
provider_slug: ${providerSlug}
request_status: requested_sent
receipt_status: partial
records_received: false
bills_received: false
---

# Records and Bills
`)
  writeFileSync(join(providerDir, 'documents', 'records.md'), `---
schema_version: 3
document_type: medical_records
case_slug: ${slug}
provider_slug: ${providerSlug}
received_date: "2026-04-30"
---

# Records
`)
  writeFileSync(join(providerDir, 'documents', 'bills.md'), `---
schema_version: 3
document_type: medical_bills
case_slug: ${slug}
provider_slug: ${providerSlug}
received_date: "2026-04-30"
---

# Bills
`)
}

function writeProviderChronology(root: string, slug: string, providerSlug: string) {
  const providerDir = join(root, 'cases', slug, 'medical-providers', providerSlug)
  mkdirSync(providerDir, { recursive: true })
  writeFileSync(join(providerDir, 'chronology.md'), `---
schema_version: 3
case_slug: ${slug}
provider_slug: ${providerSlug}
chronology_status: updated
---

# Chronology
`)
}

function writeCaseSetupScaffold(root: string, slug: string) {
  const caseDir = join(root, 'cases', slug)
  const requiredFiles = [
    `${slug}.md`,
    'Dashboard.md',
    'AGENTS.md',
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
    'activity/index.md',
    'workflow-log/index.md',
  ]
  const requiredDirs = [
    'documents/incoming',
    'documents/shadows/client',
    'documents/shadows/accident',
    'documents/shadows/insurance',
    'documents/shadows/litigation',
    'documents/generated',
    'documents/sent',
    'documents/received',
    'documents/_extractions',
    'litigation/discovery',
    'litigation/mediation',
    'litigation/pleadings',
    'litigation/service',
    'litigation/trial-prep',
    'litigation/trial',
  ]
  for (const dir of requiredDirs) {
    mkdirSync(join(caseDir, dir), { recursive: true })
  }
  for (const file of requiredFiles) {
    const path = join(caseDir, file)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, file === `${slug}.md` ? `---
schema_version: 3
case_slug: ${slug}
landmarks:
  case_setup_complete:
    satisfied: true
---

# ${slug}
` : `# ${file}\n`)
  }
}

describe('FirmVault passive landmarks', () => {
  it('resolves signed contract and medical authorization landmarks from canonical ledgers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: true, medicalAuthSigned: true })

      await expect(resolveFirmVaultPassiveLandmarks('test-case')).resolves.toMatchObject({
        case_slug: 'test-case',
        landmarks: {
          contract_signed: { satisfied: true },
          medical_auth_signed: { satisfied: true },
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves onboarding landmarks from canonical shadow file placement when ledgers have not been updated yet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: false, medicalAuthSigned: false })
      writeCanonicalShadow(root, 'test-case', 'fee-agreement-signed.md')
      writeCanonicalShadow(root, 'test-case', 'medical-authorization-signed.md')

      await expect(resolveFirmVaultPassiveLandmarks('test-case')).resolves.toMatchObject({
        case_slug: 'test-case',
        landmarks: {
          contract_signed: {
            satisfied: true,
            evidence: expect.arrayContaining(['documents/shadows/client/fee-agreement-signed.md']),
          },
          medical_auth_signed: {
            satisfied: true,
            evidence: expect.arrayContaining(['documents/shadows/client/medical-authorization-signed.md']),
          },
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves PIP approval from the canonical insurance acknowledgment shadow', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: false, medicalAuthSigned: false })
      writePipAcknowledgmentShadow(root, 'test-case')

      await expect(resolveFirmVaultPassiveLandmarks('test-case')).resolves.toMatchObject({
        case_slug: 'test-case',
        landmarks: {
          pip_approved: {
            satisfied: true,
            evidence: expect.arrayContaining(['documents/received/insurance/kac-acknowledgment.md']),
          },
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves demand sent from canonical sent-demand evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: false, medicalAuthSigned: false })
      writeDemandSentEvidence(root, 'test-case')

      await expect(resolveFirmVaultPassiveLandmarks('test-case')).resolves.toMatchObject({
        case_slug: 'test-case',
        landmarks: {
          demand_sent: {
            satisfied: true,
            evidence: expect.arrayContaining([
              'insurance/bi-progressive.md',
              'documents/sent/insurance/bi-progressive-demand-sent.md',
            ]),
          },
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves initial offer from canonical negotiation and insurance evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: false, medicalAuthSigned: false })
      writeOfferEvidence(root, 'test-case')

      await expect(resolveFirmVaultPassiveLandmarks('test-case')).resolves.toMatchObject({
        case_slug: 'test-case',
        landmarks: {
          initial_offer_received: {
            satisfied: true,
            evidence: expect.arrayContaining([
              'insurance/bi-progressive.md',
              'negotiation/offers.md',
              'documents/received/insurance/progressive-offer-letter.md',
            ]),
          },
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves final distribution complete from canonical settlement evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: false, medicalAuthSigned: false })
      writeFinalDistributionEvidence(root, 'test-case')

      await expect(resolveFirmVaultPassiveLandmarks('test-case')).resolves.toMatchObject({
        case_slug: 'test-case',
        landmarks: {
          final_distribution_complete: {
            satisfied: true,
            evidence: expect.arrayContaining([
              'settlement/distribution.md',
              'documents/received/settlement/client-distribution-receipt.md',
            ]),
          },
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves provider records and bills receipt from canonical provider document placement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: false, medicalAuthSigned: false })
      writeProviderRecordsAndBills(root, 'test-case', 'river-city-orthopedics')

      await expect(resolveFirmVaultPassiveLandmarks('test-case')).resolves.toMatchObject({
        case_slug: 'test-case',
        providers: {
          'river-city-orthopedics': {
            records_received: true,
            bills_received: true,
            records_or_bills_received: true,
            records_and_bills_received: true,
            evidence: expect.arrayContaining([
              'medical-providers/river-city-orthopedics/documents/records.md',
              'medical-providers/river-city-orthopedics/documents/bills.md',
            ]),
          },
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves case-level demand prerequisites from provider records, bills, and chronology placement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: false, medicalAuthSigned: false })
      writeProviderRecordsAndBills(root, 'test-case', 'river-city-orthopedics')
      writeProviderChronology(root, 'test-case', 'river-city-orthopedics')

      await expect(resolveFirmVaultPassiveLandmarks('test-case')).resolves.toMatchObject({
        case_slug: 'test-case',
        landmarks: {
          all_records_received: {
            satisfied: true,
            evidence: expect.arrayContaining([
              'medical-providers/river-city-orthopedics/documents/records.md',
            ]),
          },
          all_bills_received: {
            satisfied: true,
            evidence: expect.arrayContaining([
              'medical-providers/river-city-orthopedics/documents/bills.md',
            ]),
          },
          medical_chronology_updated: {
            satisfied: true,
            evidence: expect.arrayContaining([
              'medical-providers/river-city-orthopedics/chronology.md',
            ]),
          },
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('satisfies waiting workflow conditions from canonical ledgers without document intake knowing the workflow', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    const db = new Database(':memory:')
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: true, medicalAuthSigned: true })
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general'`).get() as { id: number }
      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: passive-doc-wait
name: Passive Doc Wait
subject_type: law_firm_case
nodes:
  send_packet:
    type: recipe
    recipe: hello-world
  wait_for_signed_docs:
    type: wait
    duration: 7d
    depends_on:
      - send_packet
    exit_when:
      condition: law_firm.landmarks.contract_signed == true
  confirm:
    type: recipe
    recipe: hello-world
    depends_on:
      nodes:
        - wait_for_signed_docs
      conditions:
        - law_firm.landmarks.medical_auth_signed == true
`, 'tester', 1, 1)
      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'test-case',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 1000,
      })
      const firstMaterialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project.id,
        workspaceId: 1,
        actor: 'tester',
        now: 1001,
      })
      advanceWorkflowAfterTaskApproval(db, {
        taskId: firstMaterialized.created[0].task_id,
        actor: 'reviewer',
        now: 1010,
      })

      const result = await satisfyPassiveFirmVaultLandmarks(db, {
        workspaceId: 1,
        actor: 'passive-landmark-resolver',
        status: 'inbox',
        now: 1020,
      })

      expect(result.satisfied).toEqual([
        { case_slug: 'test-case', landmark: 'contract_signed', condition: 'law_firm.landmarks.contract_signed == true', satisfied_dependencies: 1 },
        { case_slug: 'test-case', landmark: 'medical_auth_signed', condition: 'law_firm.landmarks.medical_auth_signed == true', satisfied_dependencies: 1 },
      ])
      expect(db.prepare(`
        SELECT status FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'confirm'
      `).get(instance.instance_id)).toMatchObject({ status: 'running' })
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('satisfies provider-scoped records/bills arrival without document intake knowing the workflow', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    const db = new Database(':memory:')
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: true, medicalAuthSigned: true })
      writeProviderRecordsAndBills(root, 'test-case', 'river-city-orthopedics')
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general'`).get() as { id: number }
      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: passive-provider-doc-wait
name: Passive Provider Doc Wait
subject_type: law_firm_case
nodes:
  send_records_request:
    type: recipe
    recipe: hello-world
  wait_15_days_for_records:
    type: wait
    duration: 15d
    depends_on:
      nodes:
        - send_records_request
    exit_when:
      condition: law_firm.provider.records_and_bills_received == true
  first_follow_up_records_request:
    type: recipe
    recipe: hello-world
    depends_on:
      nodes:
        - wait_15_days_for_records
    config:
      skip_when_condition: law_firm.provider.records_and_bills_received == true
  receive_and_process_records_bills:
    type: recipe
    recipe: hello-world
    depends_on:
      conditions:
        - law_firm.provider.records_or_bills_received == true
`, 'tester', 1, 1)
      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'test-case',
        vars: {
          provider_slug: 'river-city-orthopedics',
          provider_name: 'River City Orthopedics',
        },
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 1000,
      })
      const firstMaterialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project.id,
        workspaceId: 1,
        actor: 'tester',
        now: 1001,
      })
      advanceWorkflowAfterTaskApproval(db, {
        taskId: firstMaterialized.created[0].task_id,
        actor: 'reviewer',
        now: 1010,
      })

      const result = await satisfyPassiveFirmVaultLandmarks(db, {
        workspaceId: 1,
        actor: 'passive-landmark-resolver',
        status: 'inbox',
        now: 1020,
      })

      expect(result.satisfied).toEqual([
        {
          case_slug: 'test-case',
          landmark: 'provider.records_and_bills_received',
          condition: 'law_firm.provider.records_and_bills_received == true',
          satisfied_dependencies: 1,
        },
        {
          case_slug: 'test-case',
          landmark: 'provider.records_or_bills_received',
          condition: 'law_firm.provider.records_or_bills_received == true',
          satisfied_dependencies: 1,
        },
      ])
      expect(db.prepare(`
        SELECT status FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'wait_15_days_for_records'
      `).get(instance.instance_id)).toMatchObject({ status: 'complete' })
      expect(db.prepare(`
        SELECT status FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'first_follow_up_records_request'
      `).get(instance.instance_id)).toMatchObject({ status: 'skipped' })
      expect(db.prepare(`
        SELECT status FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'receive_and_process_records_bills'
      `).get(instance.instance_id)).toMatchObject({ status: 'running' })
      const followUpTasks = db.prepare(`
        SELECT COUNT(*) AS count FROM tasks
        WHERE metadata LIKE '%first_follow_up_records_request%'
      `).get() as { count: number }
      expect(followUpTasks.count).toBe(0)
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('satisfies compound wait exit conditions when every referenced landmark is canonical', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    const db = new Database(':memory:')
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: true, medicalAuthSigned: true })
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general'`).get() as { id: number }
      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: passive-compound-doc-wait
name: Passive Compound Doc Wait
subject_type: law_firm_case
nodes:
  send_packet:
    type: recipe
    recipe: hello-world
  wait_for_signed_docs:
    type: wait
    duration: 7d
    depends_on:
      - send_packet
    exit_when:
      condition: law_firm.landmarks.contract_signed == true && law_firm.landmarks.medical_auth_signed == true
  confirm:
    type: recipe
    recipe: hello-world
    depends_on:
      - wait_for_signed_docs
`, 'tester', 1, 1)
      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'test-case',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 1000,
      })
      const firstMaterialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project.id,
        workspaceId: 1,
        actor: 'tester',
        now: 1001,
      })
      advanceWorkflowAfterTaskApproval(db, {
        taskId: firstMaterialized.created[0].task_id,
        actor: 'reviewer',
        now: 1010,
      })

      const result = await satisfyPassiveFirmVaultLandmarks(db, {
        workspaceId: 1,
        actor: 'passive-landmark-resolver',
        status: 'inbox',
        now: 1020,
      })

      expect(result.satisfied).toEqual([
        {
          case_slug: 'test-case',
          landmark: 'contract_signed,medical_auth_signed',
          condition: 'law_firm.landmarks.contract_signed == true && law_firm.landmarks.medical_auth_signed == true',
          satisfied_dependencies: 1,
        },
      ])
      expect(db.prepare(`
        SELECT status FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'confirm'
      `).get(instance.instance_id)).toMatchObject({ status: 'running' })
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('unblocks PIP acknowledgment processing when the canonical acknowledgment arrives before the timer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    const db = new Database(':memory:')
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCase(root, 'test-case', { contractSigned: false, medicalAuthSigned: false })
      writePipAcknowledgmentShadow(root, 'test-case')
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general'`).get() as { id: number }
      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: passive-pip-acknowledgment
name: Passive PIP Acknowledgment
subject_type: law_firm_case
nodes:
  human_send_pip_packet:
    type: review
    review:
      mode: human
  wait_for_pip_acknowledgment:
    type: wait
    duration: 10d
    depends_on:
      - human_send_pip_packet
    exit_when:
      condition: law_firm.landmarks.pip_approved == true
  process_pip_acknowledgment:
    type: recipe
    recipe: firmvault-pip-confirm-approval
    depends_on:
      - wait_for_pip_acknowledgment
`, 'tester', 1, 1)
      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'test-case',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 1000,
      })
      const firstMaterialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project.id,
        workspaceId: 1,
        actor: 'tester',
        now: 1001,
      })
      advanceWorkflowAfterTaskApproval(db, {
        taskId: firstMaterialized.created[0].task_id,
        actor: 'reviewer',
        now: 1010,
      })

      const result = await satisfyPassiveFirmVaultLandmarks(db, {
        workspaceId: 1,
        actor: 'passive-landmark-resolver',
        status: 'inbox',
        now: 1020,
      })

      expect(result.satisfied).toEqual([
        {
          case_slug: 'test-case',
          landmark: 'pip_approved',
          condition: 'law_firm.landmarks.pip_approved == true',
          satisfied_dependencies: 1,
        },
      ])
      expect(db.prepare(`
        SELECT status FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'process_pip_acknowledgment'
      `).get(instance.instance_id)).toMatchObject({ status: 'running' })
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('satisfies later workflow dependencies from an already-created canonical case setup scaffold', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-passive-'))
    const db = new Database(':memory:')
    try {
      process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
      writeCaseSetupScaffold(root, 'test-case')
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general'`).get() as { id: number }
      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: passive-case-setup-complete
name: Passive Case Setup Complete
subject_type: law_firm_case
nodes:
  next_step:
    type: recipe
    recipe: hello-world
    depends_on:
      conditions:
        - law_firm.landmarks.case_setup_complete == true
        - law_firm.landmarks.client_info_received == true
`, 'tester', 1, 1)
      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'test-case',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 1000,
      })

      const result = await satisfyPassiveFirmVaultLandmarks(db, {
        workspaceId: 1,
        actor: 'passive-landmark-resolver',
        status: 'inbox',
        now: 1010,
      })

      expect(result.satisfied).toEqual([
        {
          case_slug: 'test-case',
          landmark: 'case_setup_complete',
          condition: 'law_firm.landmarks.case_setup_complete == true',
          satisfied_dependencies: 1,
        },
        {
          case_slug: 'test-case',
          landmark: 'client_info_received',
          condition: 'law_firm.landmarks.client_info_received == true',
          satisfied_dependencies: 1,
        },
      ])
      const materialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project.id,
        workspaceId: 1,
        actor: 'tester',
        now: 1011,
      })
      expect(materialized.created).toEqual([
        expect.objectContaining({ node_key: 'next_step' }),
      ])
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
