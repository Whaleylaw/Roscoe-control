import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runMigrations } from '../migrations'
import { syncWorkflowDefinitions } from '../workflow-registry'

let db: Database.Database
let workflowsRoot: string

const workflowYaml = (version: number, name = 'Provider Records and Bills Request') => `
schema_version: 1
id: firmvault-request-medical-records
name: ${name}
version: ${version}
subject_type: law_firm_case
triggers:
  - type: manual
nodes:
  check_hipaa:
    type: recipe
    recipe: firmvault-medical-records-check-hipaa
  send_request:
    type: recipe
    recipe: firmvault-medical-records-send-request
    depends_on:
      - check_hipaa
`

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  workflowsRoot = mkdtempSync(join(tmpdir(), 'workflow-registry-'))
})

afterEach(() => {
  db.close()
  rmSync(workflowsRoot, { recursive: true, force: true })
})

describe('workflow-registry', () => {
  it('syncs engine workflow YAML and skips legacy catalog YAML', async () => {
    writeFileSync(join(workflowsRoot, 'firmvault-request-medical-records.yaml'), workflowYaml(1))
    writeFileSync(join(workflowsRoot, 'firmvault-workflows.yaml'), `
workflows:
  - id: old-catalog-entry
    name: Old Catalog Entry
`)

    const report = await syncWorkflowDefinitions({
      db,
      workflowsRoot,
      actor: 'test-admin',
      workspaceId: 1,
      tenantId: 1,
    })

    expect(report.scanned).toBe(2)
    expect(report.inserted).toBe(1)
    expect(report.updated).toBe(0)
    expect(report.unchanged).toBe(0)
    expect(report.errors).toEqual([])
    expect(report.skipped).toEqual([{ file: 'firmvault-workflows.yaml', reason: 'not_workflow_definition' }])

    const row = db.prepare(`
      SELECT slug, name, version, subject_type, status, created_by
      FROM workflow_definitions
      WHERE slug = 'firmvault-request-medical-records'
    `).get()
    expect(row).toMatchObject({
      slug: 'firmvault-request-medical-records',
      name: 'Provider Records and Bills Request',
      version: 1,
      subject_type: 'law_firm_case',
      status: 'active',
      created_by: 'test-admin',
    })
  })

  it('reports unchanged definitions on a second identical sync', async () => {
    writeFileSync(join(workflowsRoot, 'firmvault-request-medical-records.yaml'), workflowYaml(1))

    await syncWorkflowDefinitions({ db, workflowsRoot, actor: 'test-admin', workspaceId: 1, tenantId: 1 })
    const report = await syncWorkflowDefinitions({ db, workflowsRoot, actor: 'test-admin', workspaceId: 1, tenantId: 1 })

    expect(report.inserted).toBe(0)
    expect(report.updated).toBe(0)
    expect(report.unchanged).toBe(1)
  })

  it('updates an existing version when the disk YAML changes', async () => {
    writeFileSync(join(workflowsRoot, 'firmvault-request-medical-records.yaml'), workflowYaml(1))
    await syncWorkflowDefinitions({ db, workflowsRoot, actor: 'test-admin', workspaceId: 1, tenantId: 1 })

    writeFileSync(join(workflowsRoot, 'firmvault-request-medical-records.yaml'), workflowYaml(1, 'Updated Records Workflow'))
    const report = await syncWorkflowDefinitions({ db, workflowsRoot, actor: 'test-admin', workspaceId: 1, tenantId: 1 })

    expect(report.updated).toBe(1)
    expect(
      db.prepare(`SELECT name FROM workflow_definitions WHERE slug = 'firmvault-request-medical-records'`).get(),
    ).toMatchObject({ name: 'Updated Records Workflow' })
  })

  it('supersedes older active versions when a newer version is synced', async () => {
    writeFileSync(join(workflowsRoot, 'firmvault-request-medical-records.yaml'), workflowYaml(1))
    await syncWorkflowDefinitions({ db, workflowsRoot, actor: 'test-admin', workspaceId: 1, tenantId: 1 })

    writeFileSync(join(workflowsRoot, 'firmvault-request-medical-records.yaml'), workflowYaml(2))
    const report = await syncWorkflowDefinitions({ db, workflowsRoot, actor: 'test-admin', workspaceId: 1, tenantId: 1 })

    expect(report.inserted).toBe(1)
    expect(report.superseded).toMatchObject([
      { slug: 'firmvault-request-medical-records', version: 1 },
    ])
    const rows = db.prepare(`
      SELECT version, status
      FROM workflow_definitions
      WHERE slug = 'firmvault-request-medical-records'
      ORDER BY version ASC
    `).all()
    expect(rows).toEqual([
      { version: 1, status: 'superseded' },
      { version: 2, status: 'active' },
    ])
  })
})
