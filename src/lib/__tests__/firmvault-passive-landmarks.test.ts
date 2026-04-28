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
