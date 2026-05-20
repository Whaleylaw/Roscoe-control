import { readdir, readFile, stat, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { basename, join } from 'path'
import type { Database } from 'better-sqlite3'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const DEFAULT_FIRMVAULT_ROOT = '/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault'

export type LawFirmCaseSummary = {
  slug: string
  name: string
  case_type: string | null
  current_phase: string | null
  date_of_incident: string | null
  jurisdiction: string | null
  legacy_id: string | null
  updated_at: number
  activity_count: number
  document_count: number
  claim_count: number
  lien_count: number
  landmark_count: number
  satisfied_landmark_count: number
}

export type LawFirmLandmark = {
  key: string
  label: string
  satisfied: boolean
  satisfied_at: string | null
  satisfied_by: string | null
  evidence: string | null
}

export type LawFirmCaseDetail = {
  summary: LawFirmCaseSummary
  dashboard: {
    claims: Array<Record<string, string>>
    medical_providers: LawFirmMedicalProvider[]
    recent_activity: Array<{ file: string; date: string | null; category: string | null; title: string; excerpt: string }>
  }
  state: {
    current_phase: string | null
    phases: Array<{ key: string; label: string }>
    landmarks: LawFirmLandmark[]
  }
  files: Array<{ name: string; kind: 'markdown' | 'directory' | 'other' }>
}

export type LawFirmMedicalProvider = {
  slug: string
  name: string
  role: string | null
  treatment_status: string | null
  records_requested: boolean | null
  records_received: boolean | null
  bills_requested: boolean | null
  bills_received: boolean | null
  records_requested_date: string | null
  records_received_date: string | null
  bills_requested_date: string | null
  bills_received_date: string | null
}

type RoscoeMedicalRow = {
  provider: string
  status: string | null
  bills_requested_date: string | null
  bills_received_date: string | null
  records_requested_date: string | null
  records_received_date: string | null
}

export type LawFirmCaseProject = {
  id: number
  workspace_id: number
  name: string
  slug: string
  description: string | null
  ticket_prefix: string
  ticket_counter: number
  status: 'active' | 'archived'
  gsd_project_id: string | null
  created_at: number
  updated_at: number
}

export function getLawFirmRoot(): string {
  return process.env.MISSION_CONTROL_LAW_FIRM_ROOT || DEFAULT_FIRMVAULT_ROOT
}

export function getLawFirmCasesRoot(): string {
  return join(getLawFirmRoot(), 'cases')
}

export async function listLawFirmCases(): Promise<LawFirmCaseSummary[]> {
  const casesRoot = getLawFirmCasesRoot()
  const entries = await readdir(casesRoot, { withFileTypes: true })
  const cases = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
      .map((entry) => readLawFirmCaseSummary(casesRoot, entry.name)),
  )

  cases.sort((a, b) => a.name.localeCompare(b.name))
  return cases
}

export async function readLawFirmCaseDetail(slug: string): Promise<LawFirmCaseDetail> {
  assertSafeCaseSlug(slug)
  const casesRoot = getLawFirmCasesRoot()
  const caseDir = join(casesRoot, slug)
  const [summary, state, files] = await Promise.all([
    readLawFirmCaseSummary(casesRoot, slug),
    readState(caseDir),
    readCaseFiles(caseDir),
  ])
  const [claims, medicalProviders, recentActivity] = await Promise.all([
    readClaims(caseDir),
    readMedicalProviders(caseDir),
    readRecentActivity(caseDir),
  ])

  return {
    summary,
    dashboard: {
      claims,
      medical_providers: medicalProviders,
      recent_activity: recentActivity,
    },
    state: {
      current_phase: stringValue(state?.current_phase),
      phases: phaseEntries(state?.phase_history),
      landmarks: landmarkEntries(state?.landmarks),
    },
    files,
  }
}

export async function updateLawFirmCaseState(
  slug: string,
  patch: { current_phase?: string; landmarks?: Record<string, boolean> },
): Promise<LawFirmCaseDetail> {
  assertSafeCaseSlug(slug)
  const caseDir = join(getLawFirmCasesRoot(), slug)
  const statePath = join(caseDir, 'state.yaml')
  const raw = await readFile(statePath, 'utf8')
  const parsed = parseYaml(raw)
  const state = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}

  if (patch.current_phase && typeof state.phase_history === 'object' && state.phase_history) {
    const phases = state.phase_history as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(phases, patch.current_phase)) {
      state.current_phase = patch.current_phase
    }
  }

  if (patch.landmarks && typeof state.landmarks === 'object' && state.landmarks) {
    const landmarks = state.landmarks as Record<string, Record<string, unknown>>
    const now = new Date().toISOString()
    for (const [key, satisfied] of Object.entries(patch.landmarks)) {
      const landmark = landmarks[key]
      if (!landmark || typeof landmark !== 'object') continue
      const wasSatisfied = Boolean(landmark.satisfied)
      landmark.satisfied = Boolean(satisfied)
      if (satisfied && !wasSatisfied) {
        landmark.satisfied_at = now
        landmark.satisfied_by = 'mission-control'
      } else if (!satisfied) {
        landmark.satisfied_at = null
        landmark.satisfied_by = null
      }
    }
  }

  await writeFile(statePath, stringifyYaml(state), 'utf8')
  return readLawFirmCaseDetail(slug)
}

export async function bypassLawFirmCaseLandmark(
  slug: string,
  landmarkKey: string,
  reason: string,
  actor: string,
  taskId: number,
): Promise<LawFirmCaseDetail> {
  assertSafeCaseSlug(slug)
  if (!/^[a-zA-Z0-9_:-]+$/.test(landmarkKey)) throw new Error('Invalid landmark key')

  const caseDir = join(getLawFirmCasesRoot(), slug)
  const now = new Date().toISOString()
  const normalizedReason = reason.trim() || 'Marked not applicable in Mission Control.'
  const evidence = `Bypassed as not applicable by ${actor}: ${normalizedReason}`

  await Promise.all([
    upsertStateLandmarkBypass(caseDir, landmarkKey, now, actor, evidence, taskId),
    upsertCaseFrontmatterBypass(caseDir, slug, landmarkKey, now, actor, normalizedReason, taskId),
  ])

  return readLawFirmCaseDetail(slug)
}

async function upsertStateLandmarkBypass(
  caseDir: string,
  landmarkKey: string,
  now: string,
  actor: string,
  evidence: string,
  taskId: number,
): Promise<void> {
  const statePath = join(caseDir, 'state.yaml')
  const raw = await readFile(statePath, 'utf8')
  const parsed = parseYaml(raw)
  const state = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}

  const landmarks = objectRecord(state.landmarks)
  const existing = objectRecord(landmarks[landmarkKey])
  landmarks[landmarkKey] = {
    ...existing,
    satisfied: true,
    satisfied_at: stringValue(existing.satisfied_at) || now,
    satisfied_by: stringValue(existing.satisfied_by) || actor || 'mission-control',
    evidence,
    bypassed: true,
    bypass_reason: evidence,
    bypass_task_id: taskId,
  }
  state.landmarks = landmarks
  await writeFile(statePath, stringifyYaml(state), 'utf8')
}

async function upsertCaseFrontmatterBypass(
  caseDir: string,
  slug: string,
  landmarkKey: string,
  now: string,
  actor: string,
  reason: string,
  taskId: number,
): Promise<void> {
  const casePath = join(caseDir, `${slug}.md`)
  const raw = await readFile(casePath, 'utf8')
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) throw new Error('Case file is missing YAML frontmatter')

  const parsed = parseYaml(match[1])
  const frontmatter = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
  const bypasses = objectRecord(frontmatter.workflow_bypasses)
  bypasses[landmarkKey] = {
    status: 'not_applicable',
    reason,
    task_id: taskId,
    created_at: now,
    created_by: actor || 'mission-control',
  }
  frontmatter.workflow_bypasses = bypasses

  const next = `---\n${stringifyYaml(frontmatter)}---\n\n${raw.slice(match[0].length).replace(/^\n+/, '')}`
  await writeFile(casePath, next, 'utf8')
}

export async function ensureLawFirmCaseProject(
  db: Database,
  workspaceId: number,
  slug: string,
): Promise<LawFirmCaseProject> {
  const detail = await readLawFirmCaseDetail(slug)
  const projectSlug = lawFirmCaseProjectSlug(slug)
  const gsdProjectId = lawFirmCaseGsdProjectId(slug)
  const existing = db.prepare(`
    SELECT id, workspace_id, name, slug, description, ticket_prefix, ticket_counter, status,
           gsd_project_id, created_at, updated_at
    FROM projects
    WHERE workspace_id = ? AND (slug = ? OR gsd_project_id = ?)
    LIMIT 1
  `).get(workspaceId, projectSlug, gsdProjectId) as LawFirmCaseProject | undefined

  if (existing) return existing

  const ticketPrefix = uniqueLawFirmTicketPrefix(db, workspaceId, slug)
  const description = [
    `Hidden Law Firm case project for FirmVault case ${detail.summary.slug}.`,
    detail.summary.case_type ? `Type: ${detail.summary.case_type}` : null,
    detail.summary.date_of_incident ? `Incident: ${detail.summary.date_of_incident}` : null,
  ].filter(Boolean).join('\n')

  const result = db.prepare(`
    INSERT INTO projects (
      workspace_id, name, slug, description, ticket_prefix, ticket_counter,
      status, gsd_project_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 0, 'active', ?, unixepoch(), unixepoch())
  `).run(workspaceId, detail.summary.name, projectSlug, description, ticketPrefix, gsdProjectId)

  return db.prepare(`
    SELECT id, workspace_id, name, slug, description, ticket_prefix, ticket_counter, status,
           gsd_project_id, created_at, updated_at
    FROM projects
    WHERE id = ?
  `).get(Number(result.lastInsertRowid)) as LawFirmCaseProject
}

export function isLawFirmCaseProjectId(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('law-firm-case:')
}

export function lawFirmCaseProjectSlug(caseSlug: string): string {
  const hash = createHash('sha256').update(caseSlug).digest('hex').slice(0, 8)
  const suffix = caseSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 46)
  return `law-firm-${hash}${suffix ? `-${suffix}` : ''}`.slice(0, 64)
}

function lawFirmCaseGsdProjectId(caseSlug: string): string {
  return `law-firm-case:${caseSlug}`
}

function uniqueLawFirmTicketPrefix(db: Database, workspaceId: number, caseSlug: string): string {
  const base = `LF${createHash('sha256').update(caseSlug).digest('hex').slice(0, 8).toUpperCase()}`
  const exists = db.prepare(`
    SELECT id FROM projects
    WHERE workspace_id = ? AND ticket_prefix = ?
    LIMIT 1
  `)
  if (!exists.get(workspaceId, base)) return base

  for (let i = 1; i <= 99; i += 1) {
    const candidate = `${base.slice(0, 10)}${String(i).padStart(2, '0')}`
    if (!exists.get(workspaceId, candidate)) return candidate
  }
  throw new Error('Unable to allocate law firm ticket prefix')
}

async function readLawFirmCaseSummary(casesRoot: string, slug: string): Promise<LawFirmCaseSummary> {
  const caseDir = join(casesRoot, slug)
  const [dashboard, state, dirStat] = await Promise.all([
    readDashboardFrontmatter(caseDir),
    readState(caseDir),
    stat(caseDir),
  ])
  const landmarks = state?.landmarks && typeof state.landmarks === 'object'
    ? Object.values(state.landmarks as Record<string, unknown>)
    : []
  const satisfiedLandmarks = landmarks.filter((value) => {
    return Boolean(value && typeof value === 'object' && (value as { satisfied?: unknown }).satisfied)
  })

  return {
    slug,
    name: stringValue(dashboard.client_name) || titleFromSlug(slug),
    case_type: stringValue(dashboard.case_type),
    current_phase: stringValue(dashboard.current_phase) || normalizePhase(stringValue(state?.current_phase)),
    date_of_incident: stringValue(dashboard.date_of_incident),
    jurisdiction: stringValue(dashboard.jurisdiction),
    legacy_id: stringValue(dashboard.legacy_id),
    updated_at: dirStat.mtimeMs,
    activity_count: await countFiles(join(caseDir, 'Activity Log')),
    document_count: await countFiles(join(caseDir, 'documents')),
    claim_count: await countMarkdownItems(caseDir, 'claims.md'),
    lien_count: await countMarkdownItems(caseDir, 'liens.md'),
    landmark_count: landmarks.length,
    satisfied_landmark_count: satisfiedLandmarks.length,
  }
}

async function readDashboardFrontmatter(caseDir: string): Promise<Record<string, unknown>> {
  const raw = await readOptionalFile(join(caseDir, 'Dashboard.md'))
  if (!raw) return {}
  const match = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const parsed = parseYaml(match[1])
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}

async function readState(caseDir: string): Promise<Record<string, unknown> | null> {
  const raw = await readOptionalFile(join(caseDir, 'state.yaml'))
  if (!raw) return null
  const parsed = parseYaml(raw)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
}

async function readCaseFiles(caseDir: string): Promise<LawFirmCaseDetail['files']> {
  const entries = await readdir(caseDir, { withFileTypes: true })
  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? 'directory' as const : entry.name.endsWith('.md') ? 'markdown' as const : 'other' as const,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function readClaims(caseDir: string): Promise<Array<Record<string, string>>> {
  const raw = await readOptionalFile(join(caseDir, 'claims.md'))
  if (!raw) return []
  const frontmatter = parseMarkdownFrontmatter(raw)
  const claims = Array.isArray(frontmatter.claims) ? frontmatter.claims : []
  return claims
    .filter((claim): claim is Record<string, unknown> => Boolean(claim && typeof claim === 'object' && !Array.isArray(claim)))
    .map((claim) => Object.fromEntries(
      Object.entries(claim).map(([key, value]) => [key, stringValue(value) || '']),
    ))
}

async function readMedicalProviders(caseDir: string): Promise<LawFirmMedicalProvider[]> {
  const contactsDir = join(caseDir, 'contacts')
  try {
    const medicalRows = await readRoscoeMedicalRows(caseDir)
    const entries = await readdir(contactsDir, { withFileTypes: true })
    const providers = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'))
      .map(async (entry): Promise<LawFirmMedicalProvider | null> => {
        const raw = await readFile(join(contactsDir, entry.name), 'utf8')
        const frontmatter = parseMarkdownFrontmatter(raw)
        const role = stringValue(frontmatter.role)
        const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map((tag) => String(tag)) : []
        const isProvider = role === 'treating_provider' || tags.some((tag) => tag.includes('medical-provider'))
        if (!isProvider) return null
        const slug = entry.name.replace(/\.md$/, '')
        const name = markdownTitle(raw) || titleFromSlug(slug)
        const medicalRow = medicalRows.get(providerMatchKey(name)) ?? medicalRows.get(providerMatchKey(slug))
        return {
          slug,
          name,
          role,
          treatment_status: medicalRow?.status ?? stringValue(frontmatter.treatment_status),
          records_requested: medicalRow ? Boolean(medicalRow.records_requested_date) : booleanOrNull(frontmatter.records_requested),
          records_received: medicalRow ? Boolean(medicalRow.records_received_date) : booleanOrNull(frontmatter.records_received),
          bills_requested: medicalRow ? Boolean(medicalRow.bills_requested_date) : booleanOrNull(frontmatter.bills_requested),
          bills_received: medicalRow ? Boolean(medicalRow.bills_received_date) : booleanOrNull(frontmatter.bills_received),
          records_requested_date: medicalRow?.records_requested_date ?? stringValue(frontmatter.records_requested_date),
          records_received_date: medicalRow?.records_received_date ?? stringValue(frontmatter.records_received_date),
          bills_requested_date: medicalRow?.bills_requested_date ?? stringValue(frontmatter.bills_requested_date),
          bills_received_date: medicalRow?.bills_received_date ?? stringValue(frontmatter.bills_received_date),
        }
      }))
    return providers
      .filter((provider): provider is LawFirmMedicalProvider => provider !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

async function readRoscoeMedicalRows(caseDir: string): Promise<Map<string, RoscoeMedicalRow>> {
  const raw = await readOptionalFile(join(caseDir, `${basename(caseDir)}.md`))
  const rows = new Map<string, RoscoeMedicalRow>()
  if (!raw) return rows
  const match = raw.match(/<!-- roscoe-medical-start -->([\s\S]*?)<!-- roscoe-medical-end -->/)
  if (!match) return rows
  const lines = match[1].split('\n').map((line) => line.trim()).filter((line) => line.startsWith('|'))
  for (const line of lines) {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 9 || cells[0] === 'Provider' || /^-+$/.test(cells[0])) continue
    const row: RoscoeMedicalRow = {
      provider: cells[0],
      status: stringValue(cells[1]),
      bills_requested_date: stringValue(cells[5]),
      bills_received_date: stringValue(cells[6]),
      records_requested_date: stringValue(cells[7]),
      records_received_date: stringValue(cells[8]),
    }
    rows.set(providerMatchKey(row.provider), row)
  }
  return rows
}

async function readRecentActivity(caseDir: string): Promise<LawFirmCaseDetail['dashboard']['recent_activity']> {
  const activityDir = join(caseDir, 'Activity Log')
  try {
    const entries = await readdir(activityDir, { withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 20)
    return Promise.all(files.map(async (entry) => {
      const raw = await readFile(join(activityDir, entry.name), 'utf8')
      const frontmatter = parseMarkdownFrontmatter(raw)
      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
      const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || entry.name.replace(/\.md$/, '')
      const excerpt = body
        .replace(/^#\s+.+$/m, '')
        .replace(/\[[^\]]+\]\([^)]+\)/g, '')
        .replace(/[*_`>#-]/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 220)
      return {
        file: entry.name,
        date: stringValue(frontmatter.date),
        category: stringValue(frontmatter.category),
        title,
        excerpt,
      }
    }))
  } catch {
    return []
  }
}

function parseMarkdownFrontmatter(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const parsed = parseYaml(match[1])
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function countFiles(path: string): Promise<number> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.')).length
  } catch {
    return 0
  }
}

async function countMarkdownItems(caseDir: string, fileName: string): Promise<number> {
  const raw = await readOptionalFile(join(caseDir, fileName))
  if (!raw) return 0
  const matches = raw.match(/^#{2,3}\s+/gm)
  return matches?.length ?? 1
}

function phaseEntries(value: unknown): Array<{ key: string; label: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value as Record<string, unknown>).map((key) => ({
    key,
    label: normalizePhase(key) || key,
  }))
}

function landmarkEntries(value: unknown): LawFirmLandmark[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, Record<string, unknown>>).map(([key, landmark]) => ({
    key,
    label: titleFromSlug(key.replace(/_/g, '-')),
    satisfied: Boolean(landmark?.satisfied),
    satisfied_at: stringValue(landmark?.satisfied_at),
    satisfied_by: stringValue(landmark?.satisfied_by),
    evidence: stringValue(landmark?.evidence),
  }))
}

function assertSafeCaseSlug(slug: string) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug) || slug.includes('..') || slug.startsWith('.')) {
    throw new Error('Invalid case slug')
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const str = String(value).trim()
  return str || null
}

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', 'yes', '1'].includes(normalized)) return true
    if (['false', 'no', '0'].includes(normalized)) return false
  }
  return null
}

function markdownTitle(raw: string): string | null {
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, '').match(/^#\s+(.+)$/m)?.[1]?.trim() || null
}

function providerMatchKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizePhase(value: string | null): string | null {
  if (!value) return null
  return value.replace(/^phase_\d+_/, '').replace(/_/g, ' ')
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
