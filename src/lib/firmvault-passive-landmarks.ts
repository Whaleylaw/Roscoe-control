import type Database from 'better-sqlite3'
import { readFile, stat } from 'fs/promises'
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
  workspace_id: number
  subject_id: string
  condition: string
}

export async function resolveFirmVaultPassiveLandmarks(caseSlug: string): Promise<PassiveLandmarkResolution> {
  assertSafeCaseSlug(caseSlug)
  const caseDir = join(getLawFirmCasesRoot(), caseSlug)
  const [caseFrontmatter, contracts, authorizations] = await Promise.all([
    readMarkdownFrontmatter(join(caseDir, `${caseSlug}.md`)),
    readMarkdownFrontmatter(join(caseDir, 'client', 'contracts.md')),
    readMarkdownFrontmatter(join(caseDir, 'client', 'authorizations.md')),
  ])
  const [feeAgreementShadow, hipaaShadow, medicalAuthorizationShadow] = await Promise.all([
    fileExists(join(caseDir, 'documents', 'shadows', 'client', 'fee-agreement-signed.md')),
    fileExists(join(caseDir, 'documents', 'shadows', 'client', 'hipaa-authorization-signed.md')),
    fileExists(join(caseDir, 'documents', 'shadows', 'client', 'medical-authorization-signed.md')),
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
    },
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
    AND wnd.dependency_key LIKE 'condition:law_firm_case:%:law_firm.landmarks.% == true%'
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
    SELECT DISTINCT wnd.workspace_id, wi.subject_id, substr(
      wnd.dependency_key,
      length('condition:' || wi.subject_type || ':' || wi.subject_id || ':') + 1
    ) AS condition
    FROM workflow_node_dependencies wnd
    JOIN workflow_instances wi ON wi.id = wnd.workflow_instance_id
    WHERE ${where}
    ORDER BY wi.subject_id ASC, condition ASC
  `).all(...params) as PendingConditionDependency[]
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

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
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
