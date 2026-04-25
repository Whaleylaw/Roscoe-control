import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runMigrations } from '@/lib/migrations'

let testDb: Database.Database
let workflowsRoot: string
let originalWorkflowsEnv: string | undefined

vi.mock('@/lib/db', () => ({ getDatabase: () => testDb }))
vi.mock('@/lib/auth', () => ({
  requireRole: () => ({
    user: {
      id: 1,
      username: 'admin',
      display_name: 'Admin User',
      role: 'admin',
      workspace_id: 1,
      tenant_id: 1,
    },
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))
vi.mock('@/lib/workspaces', () => ({
  ForbiddenError: class ForbiddenError extends Error {
    status = 403
  },
  ensureTenantWorkspaceAccess: vi.fn(),
}))

const { POST } = await import('../sync/route')

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  workflowsRoot = mkdtempSync(join(tmpdir(), 'workflow-definitions-sync-'))
  originalWorkflowsEnv = process.env.MISSION_CONTROL_WORKFLOWS_DIR
  process.env.MISSION_CONTROL_WORKFLOWS_DIR = workflowsRoot
})

afterEach(() => {
  if (originalWorkflowsEnv === undefined) delete process.env.MISSION_CONTROL_WORKFLOWS_DIR
  else process.env.MISSION_CONTROL_WORKFLOWS_DIR = originalWorkflowsEnv
  testDb.close()
  rmSync(workflowsRoot, { recursive: true, force: true })
})

describe('POST /api/workflow-definitions/sync', () => {
  it('syncs workflow definition files from disk', async () => {
    writeFileSync(join(workflowsRoot, 'simple-workflow.yaml'), `
schema_version: 1
id: simple-workflow
name: Simple Workflow
version: 1
subject_type: project
nodes:
  run:
    type: recipe
    recipe: hello-world
`)

    const res = await POST(
      new Request('http://localhost/api/workflow-definitions/sync', { method: 'POST' }) as any,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ scanned: 1, inserted: 1, updated: 0, unchanged: 0, errors: [] })
    expect(
      testDb.prepare(`SELECT slug, version, status FROM workflow_definitions WHERE slug = 'simple-workflow'`).get(),
    ).toEqual({ slug: 'simple-workflow', version: 1, status: 'active' })
  })
})
