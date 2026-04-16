import type Database from 'better-sqlite3'
import { resolveTaskImplementationTarget, type TaskLike } from './task-routing'

type PlanStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'failed'

type PlanConflictTaskRow = {
  plan_id: number
  phase_id: number
  wave: number
  status: PlanStatus
  metadata: string | null
}

export interface ResourceHint {
  repo?: string
  path: string
}

export interface WaveConflict {
  phase_id: number
  wave: number
  plan_ids: [number, number]
  paths: string[]
}

function normalizeRepo(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const value = raw.trim().toLowerCase()
  return value.length > 0 ? value : undefined
}

function normalizePath(raw: string | undefined): string | null {
  if (!raw) return null
  let value = raw.trim().replace(/\\/g, '/')
  if (!value) return null
  value = value.replace(/^\.\//, '')
  value = value.replace(/\/+/g, '/')
  if (value.length > 1) value = value.replace(/\/$/, '')
  return value || null
}

function collectPathCandidates(metadata: Record<string, unknown>): string[] {
  const out: string[] = []

  const singleCandidates = [
    metadata.code_location,
    metadata.codeLocation,
    metadata.path,
    metadata.file,
    metadata.file_path,
    metadata.filePath,
  ]

  for (const candidate of singleCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      out.push(candidate)
    }
  }

  const arrayCandidates = [
    metadata.paths,
    metadata.files,
    metadata.affected_paths,
    metadata.affectedPaths,
    metadata.touched_files,
    metadata.touchedFiles,
  ]

  for (const candidate of arrayCandidates) {
    if (!Array.isArray(candidate)) continue
    for (const item of candidate) {
      if (typeof item === 'string' && item.trim().length > 0) {
        out.push(item)
      }
    }
  }

  return out
}

function parseMetadataObject(raw: TaskLike['metadata']): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return {}
    }
    return {}
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

export function extractTaskResourceHints(task: TaskLike): ResourceHint[] {
  const metadata = parseMetadataObject(task.metadata)
  const target = resolveTaskImplementationTarget(task)
  const repo = normalizeRepo(target.implementation_repo)
  const pathCandidates = new Set<string>()

  if (target.code_location) {
    const normalized = normalizePath(target.code_location)
    if (normalized) pathCandidates.add(normalized)
  }

  for (const candidate of collectPathCandidates(metadata)) {
    const normalized = normalizePath(candidate)
    if (normalized) pathCandidates.add(normalized)
  }

  return Array.from(pathCandidates).map((path) => ({ ...(repo ? { repo } : {}), path }))
}

function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export function findOverlappingHints(aHints: ResourceHint[], bHints: ResourceHint[]): string[] {
  const overlaps = new Set<string>()
  for (const a of aHints) {
    for (const b of bHints) {
      if (a.repo && b.repo && a.repo !== b.repo) continue
      if (pathsOverlap(a.path, b.path)) {
        overlaps.add(a.path.length <= b.path.length ? a.path : b.path)
      }
    }
  }
  return Array.from(overlaps).sort()
}

type PlanResourceBucket = {
  phase_id: number
  wave: number
  status: PlanStatus
  hints: ResourceHint[]
}

function buildPlanBuckets(rows: PlanConflictTaskRow[]): Map<number, PlanResourceBucket> {
  const buckets = new Map<number, PlanResourceBucket>()
  for (const row of rows) {
    const existing = buckets.get(row.plan_id) ?? {
      phase_id: row.phase_id,
      wave: row.wave,
      status: row.status,
      hints: [],
    }
    existing.hints.push(...extractTaskResourceHints({ metadata: row.metadata }))
    buckets.set(row.plan_id, existing)
  }
  return buckets
}

export function detectWaveConflictsFromRows(
  rows: PlanConflictTaskRow[],
  options?: { activeOnly?: boolean },
): WaveConflict[] {
  const activeOnly = options?.activeOnly !== false
  const buckets = buildPlanBuckets(rows)
  const planIds = Array.from(buckets.keys()).sort((a, b) => a - b)
  const conflicts: WaveConflict[] = []

  for (let i = 0; i < planIds.length; i += 1) {
    for (let j = i + 1; j < planIds.length; j += 1) {
      const aId = planIds[i]
      const bId = planIds[j]
      const a = buckets.get(aId)!
      const b = buckets.get(bId)!

      if (a.phase_id !== b.phase_id || a.wave !== b.wave) continue
      if (activeOnly) {
        const activeStatuses: PlanStatus[] = ['in_progress', 'review']
        if (!activeStatuses.includes(a.status) || !activeStatuses.includes(b.status)) continue
      }
      if (a.hints.length === 0 || b.hints.length === 0) continue

      const overlaps = findOverlappingHints(a.hints, b.hints)
      if (overlaps.length === 0) continue

      conflicts.push({
        phase_id: a.phase_id,
        wave: a.wave,
        plan_ids: [aId, bId],
        paths: overlaps,
      })
    }
  }

  return conflicts
}

export function getWaveConflictsForProject(
  db: Database.Database,
  projectId: number,
): WaveConflict[] {
  const rows = db.prepare(
    `SELECT pl.id as plan_id, pl.phase_id, pl.wave, pl.status, t.metadata
     FROM gsd_plans pl
     JOIN gsd_phases ph ON ph.id = pl.phase_id
     JOIN gsd_milestones m ON m.id = ph.milestone_id
     LEFT JOIN tasks t ON t.gsd_plan_id = pl.id
     WHERE m.project_id = ?
       AND pl.status IN ('in_progress', 'review')`,
  ).all(projectId) as PlanConflictTaskRow[]

  return detectWaveConflictsFromRows(rows, { activeOnly: true })
}

export function getBlockingWaveConflictsForPlan(
  db: Database.Database,
  planId: number,
  phaseId: number,
  wave: number,
): WaveConflict[] {
  const rows = db.prepare(
    `SELECT pl.id as plan_id,
            pl.phase_id,
            pl.wave,
            CASE WHEN pl.id = ? THEN 'in_progress' ELSE pl.status END as status,
            t.metadata
     FROM gsd_plans pl
     LEFT JOIN tasks t ON t.gsd_plan_id = pl.id
     WHERE pl.phase_id = ?
       AND pl.wave = ?
       AND (pl.id = ? OR pl.status IN ('in_progress', 'review'))`,
  ).all(planId, phaseId, wave, planId) as PlanConflictTaskRow[]

  return detectWaveConflictsFromRows(rows, { activeOnly: true }).filter((conflict) =>
    conflict.plan_ids.includes(planId),
  )
}
