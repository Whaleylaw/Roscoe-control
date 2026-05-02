import type Database from 'better-sqlite3'
import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { parse as parseYaml } from 'yaml'
import { getLawFirmCasesRoot } from '@/lib/law-firm'
import { satisfyWorkflowCondition } from '@/lib/workflow-engine'

export type PassiveLandmarkResolution = {
  case_slug: string
  landmarks: Record<string, {
    satisfied: boolean
    evidence: string[]
  }>
  providers: Record<string, {
    records_received: boolean
    bills_received: boolean
    records_or_bills_received: boolean
    records_and_bills_received: boolean
    medical_chronology_updated: boolean
    evidence: string[]
  }>
}

export type SatisfyPassiveFirmVaultLandmarksInput = {
  workspaceId?: number
  caseSlug?: string
  actor?: string
  status?: 'inbox' | 'assigned'
  now?: number
}

export type SatisfyPassiveFirmVaultLandmarksResult = {
  checked_cases: number
  satisfied: Array<{
    case_slug: string
    landmark: string
    condition: string
    satisfied_dependencies: number
  }>
}

type PendingConditionDependency = {
  workflow_instance_id: number
  workspace_id: number
  subject_id: string
  condition: string
  vars: Record<string, unknown>
}

export async function resolveFirmVaultPassiveLandmarks(caseSlug: string): Promise<PassiveLandmarkResolution> {
  assertSafeCaseSlug(caseSlug)
  const caseDir = join(getLawFirmCasesRoot(), caseSlug)
  const [caseFrontmatter, contracts, authorizations] = await Promise.all([
    readMarkdownFrontmatter(join(caseDir, `${caseSlug}.md`)),
    readMarkdownFrontmatter(join(caseDir, 'client', 'contracts.md')),
    readMarkdownFrontmatter(join(caseDir, 'client', 'authorizations.md')),
  ])
  const pipLedgers = await readInsuranceLedgerFrontmatter(caseDir, /^pip-/)
  const claimLedgers = await readInsuranceLedgerFrontmatter(caseDir, /^(bi|um|uim)-/)
  const [feeAgreementShadow, hipaaShadow, medicalAuthorizationShadow] = await Promise.all([
    fileExists(join(caseDir, 'documents', 'shadows', 'client', 'fee-agreement-signed.md')),
    fileExists(join(caseDir, 'documents', 'shadows', 'client', 'hipaa-authorization-signed.md')),
    fileExists(join(caseDir, 'documents', 'shadows', 'client', 'medical-authorization-signed.md')),
  ])
  const [kacAcknowledgmentShadow, pipAcknowledgmentShadow, stateFarmAcknowledgmentShadow] = await Promise.all([
    fileExists(join(caseDir, 'documents', 'received', 'insurance', 'kac-acknowledgment.md')),
    fileExists(join(caseDir, 'documents', 'received', 'insurance', 'pip-acknowledgment.md')),
    fileExists(join(caseDir, 'documents', 'received', 'insurance', 'state-farm-pip-acknowledgment.md')),
  ])
  const caseSetupEvidence = await caseSetupEvidenceList(caseDir, caseSlug)

  const caseLandmarks = objectRecord(caseFrontmatter.landmarks)
  const caseSetupComplete = landmarkSatisfied(caseLandmarks.case_setup_complete)
    || caseSetupEvidence.length > 0
  const clientInfoReceived = landmarkSatisfied(caseLandmarks.client_info_received)
    || caseSetupComplete
  const contractSigned = booleanValue(contracts.contract_signed)
    || feeAgreementShadow
    || landmarkSatisfied(caseLandmarks.contract_signed)
  const medicalAuthSigned = booleanValue(authorizations.medical_authorization_signed)
    || booleanValue(authorizations.hipaa_signed)
    || hipaaShadow
    || medicalAuthorizationShadow
    || landmarkSatisfied(caseLandmarks.medical_auth_signed)
  const pipApprovedEvidence = pipLedgers
    .filter((ledger) => pipLedgerSupportsApproval(ledger.frontmatter))
    .map((ledger) => ledger.path)
  const pipApproved = pipApprovedEvidence.length > 0
    || kacAcknowledgmentShadow
    || pipAcknowledgmentShadow
    || stateFarmAcknowledgmentShadow
    || landmarkSatisfied(caseLandmarks.pip_approved)
  const demandSentEvidence = await demandSentEvidenceList(caseDir, claimLedgers)
  const demandSent = demandSentEvidence.length > 0
    || landmarkSatisfied(caseLandmarks.demand_sent)
  const initialOfferEvidence = await initialOfferEvidenceList(caseDir, claimLedgers)
  const initialOfferReceived = initialOfferEvidence.length > 0
    || landmarkSatisfied(caseLandmarks.initial_offer_received)
  const finalDistributionEvidence = await finalDistributionEvidenceList(caseDir)
  const finalDistributionComplete = finalDistributionEvidence.length > 0
    || landmarkSatisfied(caseLandmarks.final_distribution_complete)

  const providerFacts = await resolveProviderFacts(caseDir)
  const providerEntries = Object.entries(providerFacts)
  const allRecordsReceived = providerEntries.length > 0
    && providerEntries.every(([, provider]) => provider.records_received)
  const allBillsReceived = providerEntries.length > 0
    && providerEntries.every(([, provider]) => provider.bills_received)
  const medicalChronologyUpdated = providerEntries.length > 0
    && providerEntries.every(([, provider]) => provider.medical_chronology_updated)
  const allProviderEvidence = providerEntries.flatMap(([, provider]) => provider.evidence)

  return {
    case_slug: caseSlug,
    landmarks: {
      case_setup_complete: {
        satisfied: caseSetupComplete,
        evidence: caseSetupComplete
          ? evidenceList(caseFrontmatter, `${caseSlug}.md`, caseSetupEvidence)
          : [],
      },
      client_info_received: {
        satisfied: clientInfoReceived,
        evidence: clientInfoReceived
          ? evidenceList(caseFrontmatter, `${caseSlug}.md`, ['client/intake.md'])
          : [],
      },
      contract_signed: {
        satisfied: contractSigned,
        evidence: contractSigned
          ? evidenceList(contracts, 'client/contracts.md', [
            feeAgreementShadow ? 'documents/shadows/client/fee-agreement-signed.md' : null,
          ])
          : [],
      },
      medical_auth_signed: {
        satisfied: medicalAuthSigned,
        evidence: medicalAuthSigned
          ? evidenceList(authorizations, 'client/authorizations.md', [
            hipaaShadow ? 'documents/shadows/client/hipaa-authorization-signed.md' : null,
            medicalAuthorizationShadow ? 'documents/shadows/client/medical-authorization-signed.md' : null,
          ])
          : [],
      },
      pip_approved: {
        satisfied: pipApproved,
        evidence: pipApproved
          ? evidenceList(caseFrontmatter, `${caseSlug}.md`, [
            ...pipApprovedEvidence,
            kacAcknowledgmentShadow ? 'documents/received/insurance/kac-acknowledgment.md' : null,
            pipAcknowledgmentShadow ? 'documents/received/insurance/pip-acknowledgment.md' : null,
            stateFarmAcknowledgmentShadow ? 'documents/received/insurance/state-farm-pip-acknowledgment.md' : null,
          ])
          : [],
      },
      all_records_received: {
        satisfied: allRecordsReceived,
        evidence: allRecordsReceived ? [...new Set(allProviderEvidence)] : [],
      },
      all_bills_received: {
        satisfied: allBillsReceived,
        evidence: allBillsReceived ? [...new Set(allProviderEvidence)] : [],
      },
      medical_chronology_updated: {
        satisfied: medicalChronologyUpdated,
        evidence: medicalChronologyUpdated ? [...new Set(allProviderEvidence)] : [],
      },
      demand_sent: {
        satisfied: demandSent,
        evidence: demandSent
          ? evidenceList(caseFrontmatter, `${caseSlug}.md`, demandSentEvidence)
          : [],
      },
      initial_offer_received: {
        satisfied: initialOfferReceived,
        evidence: initialOfferReceived
          ? evidenceList(caseFrontmatter, `${caseSlug}.md`, initialOfferEvidence)
          : [],
      },
      final_distribution_complete: {
        satisfied: finalDistributionComplete,
        evidence: finalDistributionComplete
          ? evidenceList(caseFrontmatter, `${caseSlug}.md`, finalDistributionEvidence)
          : [],
      },
    },
    providers: providerFacts,
  }
}

export async function satisfyPassiveFirmVaultLandmarks(
  db: Database.Database,
  input: SatisfyPassiveFirmVaultLandmarksInput = {},
): Promise<SatisfyPassiveFirmVaultLandmarksResult> {
  const actor = input.actor ?? 'passive-landmark-resolver'
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const dependencies = listPendingFirmVaultConditionDependencies(db, input)
  const caseSlugs = [...new Set(dependencies.map((dependency) => dependency.subject_id))]
  const satisfied: SatisfyPassiveFirmVaultLandmarksResult['satisfied'] = []
  const resolutionByCase = new Map<string, PassiveLandmarkResolution>()

  for (const dependency of dependencies) {
    let resolution = resolutionByCase.get(dependency.subject_id)
    if (!resolution) {
      resolution = await resolveFirmVaultPassiveLandmarks(dependency.subject_id)
      resolutionByCase.set(dependency.subject_id, resolution)
    }
    const providerFact = providerFactRequiredByCondition(dependency.condition)
    if (providerFact) {
      const providerSlug = stringValue(dependency.vars.provider_slug)
      if (!providerSlug) continue
      const provider = resolution.providers[providerSlug]
      if (!provider?.[providerFact]) continue

      const result = satisfyWorkflowCondition(db, {
        subjectType: 'law_firm_case',
        subjectId: dependency.subject_id,
        condition: dependency.condition,
        workflowInstanceId: dependency.workflow_instance_id,
        actor,
        workspaceId: dependency.workspace_id,
        status: input.status ?? 'inbox',
        now,
        payload: {
          source: 'firmvault_passive_provider_fact',
          provider_slug: providerSlug,
          fact: providerFact,
          evidence: provider.evidence,
        },
      })
      if (result.satisfied_dependencies === 0) continue
      satisfied.push({
        case_slug: dependency.subject_id,
        landmark: `provider.${providerFact}`,
        condition: dependency.condition,
        satisfied_dependencies: result.satisfied_dependencies,
      })
      continue
    }

    const landmarks = landmarksRequiredByCondition(dependency.condition)
    if (landmarks.length === 0) continue
    if (!landmarks.every((landmark) => resolution.landmarks[landmark]?.satisfied)) continue

    const result = satisfyWorkflowCondition(db, {
      subjectType: 'law_firm_case',
      subjectId: dependency.subject_id,
      condition: dependency.condition,
      actor,
      workspaceId: dependency.workspace_id,
      status: input.status ?? 'inbox',
      now,
      payload: {
        source: 'firmvault_passive_landmark',
        landmarks,
        evidence: landmarks.flatMap((landmark) => resolution.landmarks[landmark]?.evidence ?? []),
      },
    })
    if (result.satisfied_dependencies === 0) continue
    satisfied.push({
      case_slug: dependency.subject_id,
      landmark: landmarks.join(','),
      condition: dependency.condition,
      satisfied_dependencies: result.satisfied_dependencies,
    })
  }

  return { checked_cases: caseSlugs.length, satisfied }
}

function listPendingFirmVaultConditionDependencies(
  db: Database.Database,
  input: SatisfyPassiveFirmVaultLandmarksInput,
): PendingConditionDependency[] {
  const params: Array<string | number> = []
  let where = `
    wi.subject_type = 'law_firm_case'
    AND wi.status = 'active'
    AND wnd.dependency_type = 'condition'
    AND wnd.status IN ('pending', 'scheduled')
    AND (
      wnd.dependency_key LIKE 'condition:law_firm_case:%:law_firm.landmarks.% == true%'
      OR wnd.dependency_key LIKE 'condition:law_firm_case:%:law_firm.provider.% == true%'
    )
  `
  if (input.workspaceId !== undefined) {
    where += ' AND wnd.workspace_id = ?'
    params.push(input.workspaceId)
  }
  if (input.caseSlug) {
    assertSafeCaseSlug(input.caseSlug)
    where += ' AND wi.subject_id = ?'
    params.push(input.caseSlug)
  }

  return db.prepare(`
    SELECT DISTINCT wnd.workflow_instance_id, wnd.workspace_id, wi.subject_id, wi.vars_json, substr(
      wnd.dependency_key,
      length('condition:' || wi.subject_type || ':' || wi.subject_id || ':') + 1
    ) AS condition
    FROM workflow_node_dependencies wnd
    JOIN workflow_instances wi ON wi.id = wnd.workflow_instance_id
    WHERE ${where}
    ORDER BY wi.subject_id ASC, condition ASC
  `).all(...params).map((row: any) => ({
    workflow_instance_id: Number(row.workflow_instance_id),
    workspace_id: Number(row.workspace_id),
    subject_id: String(row.subject_id),
    condition: String(row.condition),
    vars: parseObjectJson(row.vars_json),
  })) as PendingConditionDependency[]
}

function landmarksRequiredByCondition(condition: string): string[] {
  const parts = condition.split(/\s+&&\s+/).map((part) => part.trim()).filter(Boolean)
  const landmarks: string[] = []
  for (const part of parts) {
    const match = part.match(/^law_firm\.landmarks\.([a-zA-Z0-9_.:-]+)\s*==\s*true$/)
    if (!match) return []
    landmarks.push(match[1])
  }
  return landmarks
}

type ProviderPassiveFact = 'records_or_bills_received' | 'records_and_bills_received'

function providerFactRequiredByCondition(condition: string): ProviderPassiveFact | null {
  const match = condition.match(/^law_firm\.provider\.(records_or_bills_received|records_and_bills_received)\s*==\s*true$/)
  return match ? match[1] as ProviderPassiveFact : null
}

async function resolveProviderFacts(caseDir: string): Promise<PassiveLandmarkResolution['providers']> {
  const providersDir = join(caseDir, 'medical-providers')
  let entries: string[]
  try {
    entries = await readdir(providersDir)
  } catch {
    return {}
  }

  const providers: PassiveLandmarkResolution['providers'] = {}
  for (const entry of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry)) continue
    const providerDir = join(providersDir, entry)
    if (!(await dirExists(providerDir))) continue

    const ledger = await readMarkdownFrontmatter(join(providerDir, 'records-bills.md'))
    const recordsPath = `medical-providers/${entry}/documents/records.md`
    const billsPath = `medical-providers/${entry}/documents/bills.md`
    const chronologyPath = `medical-providers/${entry}/chronology.md`
    const [recordsFile, billsFile, chronologyFile] = await Promise.all([
      fileExists(join(caseDir, recordsPath)),
      fileExists(join(caseDir, billsPath)),
      fileExists(join(caseDir, chronologyPath)),
    ])
    const receiptStatus = stringValue(ledger.receipt_status)?.toLowerCase()
    const completeReceipt = receiptStatus
      ? ['received', 'complete', 'processed', 'records_and_bills_received'].includes(receiptStatus)
      : false
    const recordsReceived = recordsFile
      || completeReceipt
      || booleanValue(ledger.records_received)
      || Boolean(stringValue(ledger.records_received_date))
    const billsReceived = billsFile
      || completeReceipt
      || booleanValue(ledger.bills_received)
      || Boolean(stringValue(ledger.bills_received_date))

    providers[entry] = {
      records_received: recordsReceived,
      bills_received: billsReceived,
      records_or_bills_received: recordsReceived || billsReceived,
      records_and_bills_received: recordsReceived && billsReceived,
      medical_chronology_updated: chronologyFile,
      evidence: evidenceList(ledger, `medical-providers/${entry}/records-bills.md`, [
        recordsFile ? recordsPath : null,
        billsFile ? billsPath : null,
        chronologyFile ? chronologyPath : null,
      ]),
    }
  }
  return providers
}

async function readMarkdownFrontmatter(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, 'utf8')
    const match = raw.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return {}
    const parsed = parseYaml(match[1])
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

async function readInsuranceLedgerFrontmatter(
  caseDir: string,
  pattern: RegExp,
): Promise<Array<{ path: string; frontmatter: Record<string, unknown> }>> {
  const insuranceDir = join(caseDir, 'insurance')
  let entries: string[]
  try {
    entries = await readdir(insuranceDir)
  } catch {
    return []
  }

  const ledgers: Array<{ path: string; frontmatter: Record<string, unknown> }> = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    if (!pattern.test(entry.replace(/\.md$/, ''))) continue
    const relativePath = `insurance/${entry}`
    ledgers.push({
      path: relativePath,
      frontmatter: await readMarkdownFrontmatter(join(caseDir, relativePath)),
    })
  }
  return ledgers
}

function pipLedgerSupportsApproval(frontmatter: Record<string, unknown>): boolean {
  const positiveStatuses = new Set(['approved', 'active', 'acknowledged', 'opened', 'assigned', 'accepted'])
  const statusValues = [
    frontmatter.claim_status,
    frontmatter.approval_status,
    frontmatter.pip_status,
    frontmatter.application_status,
    frontmatter.assignment_status,
  ]
  return statusValues.some((value) => typeof value === 'string' && positiveStatuses.has(value.trim().toLowerCase()))
    || booleanValue(frontmatter.pip_approved)
    || booleanValue(frontmatter.approved)
    || booleanValue(frontmatter.acknowledged)
}

async function demandSentEvidenceList(
  caseDir: string,
  claimLedgers: Array<{ path: string; frontmatter: Record<string, unknown> }>,
): Promise<string[]> {
  const evidence: string[] = []
  for (const ledger of claimLedgers) {
    if (
      booleanValue(ledger.frontmatter.demand_sent)
      || Boolean(stringValue(ledger.frontmatter.demand_sent_date))
      || ['sent', 'mailed', 'delivered'].includes(stringValue(ledger.frontmatter.demand_status)?.toLowerCase() ?? '')
    ) {
      evidence.push(ledger.path)
    }
  }
  evidence.push(...await matchingFiles(join(caseDir, 'documents', 'sent', 'insurance'), /demand-sent\.md$/i, 'documents/sent/insurance'))
  return [...new Set(evidence)]
}

async function initialOfferEvidenceList(
  caseDir: string,
  claimLedgers: Array<{ path: string; frontmatter: Record<string, unknown> }>,
): Promise<string[]> {
  const evidence: string[] = []
  for (const ledger of claimLedgers) {
    if (
      booleanValue(ledger.frontmatter.initial_offer_received)
      || Boolean(stringValue(ledger.frontmatter.initial_offer_amount))
      || Boolean(stringValue(ledger.frontmatter.current_offer_amount))
      || Boolean(stringValue(ledger.frontmatter.last_offer_amount))
      || (Array.isArray(ledger.frontmatter.offers) && ledger.frontmatter.offers.length > 0)
    ) {
      evidence.push(ledger.path)
    }
  }

  const offers = await readMarkdown(join(caseDir, 'negotiation', 'offers.md'))
  if (offers && /\$\s*\d[\d,]*(?:\.\d{2})?/.test(offers) && !/No offers logged\./i.test(offers)) {
    evidence.push('negotiation/offers.md')
  }

  evidence.push(...await matchingFiles(join(caseDir, 'documents', 'received', 'insurance'), /offer.*\.md$/i, 'documents/received/insurance'))
  evidence.push(...await matchingFiles(join(caseDir, 'documents', 'shadows', 'insurance'), /offer.*\.md$/i, 'documents/shadows/insurance'))
  return [...new Set(evidence)]
}

async function finalDistributionEvidenceList(caseDir: string): Promise<string[]> {
  const evidence: string[] = []
  const canonicalPaths = [
    'settlement/distribution.md',
    'settlement/settlement.md',
  ]

  for (const relativePath of canonicalPaths) {
    const doc = await readMarkdownWithFrontmatter(join(caseDir, relativePath))
    if (!doc) continue
    if (frontmatterSupportsFinalDistributionComplete(doc.frontmatter) || bodySupportsFinalDistributionComplete(doc.body)) {
      evidence.push(relativePath)
    }
  }

  evidence.push(...await matchingFinalDistributionFiles(join(caseDir, 'documents', 'sent', 'settlement'), 'documents/sent/settlement'))
  evidence.push(...await matchingFinalDistributionFiles(join(caseDir, 'documents', 'received', 'settlement'), 'documents/received/settlement'))
  return [...new Set(evidence)]
}

function frontmatterSupportsFinalDistributionComplete(frontmatter: Record<string, unknown>): boolean {
  const positiveStatuses = new Set(['complete', 'completed', 'final_distribution_complete', 'trust_zeroed', 'zeroed'])
  const statusValues = [
    frontmatter.status,
    frontmatter.final_distribution_status,
    frontmatter.distribution_status,
    frontmatter.trust_account_status,
  ]
  return statusValues.some((value) => typeof value === 'string' && positiveStatuses.has(value.trim().toLowerCase()))
    || booleanValue(frontmatter.final_distribution_complete)
    || booleanValue(frontmatter.trust_account_zeroed)
}

function bodySupportsFinalDistributionComplete(body: string): boolean {
  return /final distribution status:\s*(?:complete|completed)/i.test(body)
    || /trust account (?:is )?zeroed/i.test(body)
    || /final trust-account balance:\s*\$?0(?:\.00)?\b/i.test(body)
}

async function matchingFinalDistributionFiles(dir: string, relativeDir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const matches: string[] = []
  for (const entry of entries) {
    if (!/(distribution|settlement|trust).+\.md$/i.test(entry)) continue
    const doc = await readMarkdownWithFrontmatter(join(dir, entry))
    if (doc && (frontmatterSupportsFinalDistributionComplete(doc.frontmatter) || bodySupportsFinalDistributionComplete(doc.body))) {
      matches.push(`${relativeDir}/${entry}`)
    }
  }
  return matches
}

async function matchingFiles(dir: string, pattern: RegExp, relativeDir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const matches: string[] = []
  for (const entry of entries) {
    if (!pattern.test(entry)) continue
    if (await fileExists(join(dir, entry))) matches.push(`${relativeDir}/${entry}`)
  }
  return matches
}

async function readMarkdown(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function readMarkdownWithFrontmatter(path: string): Promise<{ frontmatter: Record<string, unknown>; body: string } | null> {
  const raw = await readMarkdown(path)
  if (raw === null) return null
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: raw }
  const parsed = parseYaml(match[1])
  return {
    frontmatter: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {},
    body: match[2] ?? '',
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseObjectJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    return objectRecord(JSON.parse(value))
  } catch {
    return {}
  }
}

function stringValue(value: unknown): string | null {
  if (value == null) return null
  const str = String(value).trim()
  return str || null
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true'
}

function landmarkSatisfied(value: unknown): boolean {
  return booleanValue(objectRecord(value).satisfied)
}

function evidenceList(frontmatter: Record<string, unknown>, canonicalPath: string, extra: Array<string | null> = []): string[] {
  const evidence = Array.isArray(frontmatter.evidence)
    ? frontmatter.evidence.map((item) => String(item)).filter(Boolean)
    : []
  return [...new Set([canonicalPath, ...extra.filter((item): item is string => Boolean(item)), ...evidence])]
}

function assertSafeCaseSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid law firm case slug')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

async function caseSetupEvidenceList(caseDir: string, caseSlug: string): Promise<string[]> {
  const requiredFiles = [
    `${caseSlug}.md`,
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

  const missingFiles = await Promise.all(requiredFiles.map(async (path) => [path, await fileExists(join(caseDir, path))] as const))
  if (missingFiles.some(([, exists]) => !exists)) return []

  const missingDirs = await Promise.all(requiredDirs.map(async (path) => [path, await dirExists(join(caseDir, path))] as const))
  if (missingDirs.some(([, exists]) => !exists)) return []

  return [...requiredFiles, ...requiredDirs]
}
