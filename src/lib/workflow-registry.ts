import type Database from 'better-sqlite3'
import { readdir, readFile, stat } from 'fs/promises'
import { join, resolve } from 'path'
import { parse as parseYaml } from 'yaml'
import { parseWorkflowDefinition, type WorkflowDefinition } from './workflow-engine'
import { logger } from './logger'

export type WorkflowSyncReport = {
  scanned: number
  inserted: number
  updated: number
  unchanged: number
  skipped: Array<{ file: string; reason: string }>
  superseded: Array<{ slug: string; version: number; id: number }>
  errors: Array<{ file: string; reason: string }>
  definitions: Array<{ id: number; slug: string; version: number; status: string; file: string }>
}

type ExistingWorkflowDefinitionRow = {
  id: number
  slug: string
  name: string
  version: number
  subject_type: string
  definition_yaml: string
  status: string
}

export function getWorkflowsRoot(): string {
  const env = process.env.MISSION_CONTROL_WORKFLOWS_DIR
  if (env && env.trim()) return resolve(env)
  return resolve(process.cwd(), 'workflows')
}

export async function syncWorkflowDefinitions(opts: {
  db: Database.Database
  workflowsRoot?: string
  actor: string
  workspaceId: number
  tenantId?: number
}): Promise<WorkflowSyncReport> {
  const workflowsRoot = opts.workflowsRoot ?? getWorkflowsRoot()
  const report: WorkflowSyncReport = {
    scanned: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
    superseded: [],
    errors: [],
    definitions: [],
  }

  let rootExists = true
  try {
    const rootStat = await stat(workflowsRoot)
    if (!rootStat.isDirectory()) rootExists = false
  } catch {
    rootExists = false
  }
  if (!rootExists) return report

  const entries = (await readdir(workflowsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))

  const syncedBySlug = new Map<string, Set<number>>()

  for (const entry of entries) {
    report.scanned += 1
    const absPath = join(workflowsRoot, entry.name)
    let raw = ''
    try {
      raw = await readFile(absPath, 'utf8')
      if (!looksLikeWorkflowDefinition(raw)) {
        report.skipped.push({ file: entry.name, reason: 'not_workflow_definition' })
        continue
      }

      const definition = parseWorkflowDefinition(raw)
      const result = upsertWorkflowDefinition(opts.db, {
        definition,
        rawYaml: raw,
        actor: opts.actor,
        workspaceId: opts.workspaceId,
        tenantId: opts.tenantId ?? 1,
      })
      if (result.action === 'inserted') report.inserted += 1
      else if (result.action === 'updated') report.updated += 1
      else report.unchanged += 1
      report.definitions.push({
        id: result.id,
        slug: definition.id,
        version: definition.version,
        status: 'active',
        file: entry.name,
      })
      const versions = syncedBySlug.get(definition.id) ?? new Set<number>()
      versions.add(definition.version)
      syncedBySlug.set(definition.id, versions)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.warn({ file: absPath, reason }, 'workflow definition sync failed')
      report.errors.push({ file: entry.name, reason })
    }
  }

  for (const [slug, diskVersions] of syncedBySlug) {
    const maxDiskVersion = Math.max(...diskVersions)
    const rows = opts.db.prepare(`
      SELECT id, version
      FROM workflow_definitions
      WHERE workspace_id = ?
        AND slug = ?
        AND version < ?
        AND status = 'active'
      ORDER BY version DESC, id DESC
    `).all(opts.workspaceId, slug, maxDiskVersion) as Array<{ id: number; version: number }>
    for (const row of rows) {
      const updated = opts.db.prepare(`
        UPDATE workflow_definitions
        SET status = 'superseded', updated_at = unixepoch()
        WHERE id = ? AND workspace_id = ? AND status = 'active'
      `).run(row.id, opts.workspaceId)
      if (updated.changes > 0) report.superseded.push({ slug, version: row.version, id: row.id })
    }
  }

  return report
}

function looksLikeWorkflowDefinition(raw: string): boolean {
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch {
    return true
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const record = parsed as Record<string, unknown>
  return typeof record.id === 'string' && !!record.nodes && typeof record.nodes === 'object' && !Array.isArray(record.nodes)
}

function upsertWorkflowDefinition(
  db: Database.Database,
  input: {
    definition: WorkflowDefinition
    rawYaml: string
    actor: string
    workspaceId: number
    tenantId: number
  },
): { action: 'inserted' | 'updated' | 'unchanged'; id: number } {
  const existing = db.prepare(`
    SELECT id, slug, name, version, subject_type, definition_yaml, status
    FROM workflow_definitions
    WHERE workspace_id = ?
      AND slug = ?
      AND version = ?
    LIMIT 1
  `).get(input.workspaceId, input.definition.id, input.definition.version) as ExistingWorkflowDefinitionRow | undefined

  if (!existing) {
    const inserted = db.prepare(`
      INSERT INTO workflow_definitions (
        slug, name, version, subject_type, definition_yaml, status, created_by,
        workspace_id, tenant_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, unixepoch(), unixepoch())
    `).run(
      input.definition.id,
      input.definition.name,
      input.definition.version,
      input.definition.subject_type,
      input.rawYaml,
      input.actor,
      input.workspaceId,
      input.tenantId,
    )
    return { action: 'inserted', id: Number(inserted.lastInsertRowid) }
  }

  const changed = existing.name !== input.definition.name
    || existing.subject_type !== input.definition.subject_type
    || existing.definition_yaml !== input.rawYaml
    || existing.status !== 'active'

  if (!changed) return { action: 'unchanged', id: existing.id }

  db.prepare(`
    UPDATE workflow_definitions
    SET name = ?, subject_type = ?, definition_yaml = ?, status = 'active',
        tenant_id = ?, updated_at = unixepoch()
    WHERE id = ? AND workspace_id = ?
  `).run(
    input.definition.name,
    input.definition.subject_type,
    input.rawYaml,
    input.tenantId,
    existing.id,
    input.workspaceId,
  )
  return { action: 'updated', id: existing.id }
}
