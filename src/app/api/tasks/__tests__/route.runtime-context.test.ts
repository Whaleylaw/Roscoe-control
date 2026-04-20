/**
 * Route-layer integration tests for POST /api/tasks runtime-context validation
 * (Phase 13 Plan 13-02, TCTX-01..06).
 *
 * Pattern: same as src/app/api/recipes/__tests__/post.test.ts —
 *   - in-memory better-sqlite3 Database with runMigrations applied
 *   - getDatabase() / auth / rate-limit / event-bus / outbound-syncs / mentions
 *     mocked via vi.mock (hoisted above the route import)
 *   - mkdtemp-backed tmpRoot with a nested subpath + optional symlink-escape
 *   - beforeEach seeds three recipe rows (worktree, readonly, broken) and
 *     the runtime.mount_allowlist setting scoped to tmpRoot
 *
 * Covers every happy + sad path in the Plan 13-02 contract:
 *   - Legacy body compat (no runtime fields)
 *   - TCTX-01 recipe existence (RECIPE_NOT_FOUND / RECIPE_BROKEN)
 *   - TCTX-02 workspace_source gating (REQUIRED_BY_RECIPE)
 *   - TCTX-04 allowlist (OUT_OF_ALLOWLIST, ALLOWLIST_EMPTY, aggregated)
 *   - TCTX-06 caps (CAP_EXCEEDED)
 *   - TCTX-05 model_override (UNKNOWN_MODEL via aggregated shape)
 *   - Zod-layer duplicate-label + base_ref whitespace via aggregated shape
 *   - TCTX-03 round-trip on POST response (mapTaskRow extension)
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMigrations } from '@/lib/migrations'

let testDb: Database.Database

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    logActivity: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    createNotification: vi.fn(),
  },
  Task: {},
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: () => ({
    user: {
      id: 7,
      username: 'tester',
      display_name: 'Tester',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
    },
  }),
}))

vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/github-sync-engine', () => ({
  pushTaskToGitHub: vi.fn(),
  syncTaskOutbound: vi.fn(),
}))
vi.mock('@/lib/gnap-sync', () => ({ pushTaskToGnap: vi.fn() }))
vi.mock('@/lib/mentions', () => ({
  resolveMentionRecipients: () => ({ recipients: [], unresolved: [] }),
}))
vi.mock('@/lib/config', () => ({
  config: { gnap: { enabled: false, autoSync: false, repoPath: '/tmp/noop' } },
}))

import { POST, GET } from '@/app/api/tasks/route'

let tmpRoot: string
let symlinkCreated = false

beforeEach(async () => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)

  // The `workspaces` row id=1 is seeded by migration 021; no need to re-insert.
  // The `projects` row with slug='general', ticket_prefix='TASK', status='active'
  // in workspace_id=1 is seeded by migration 024 — resolveProjectId uses that.

  // Seed three recipe rows: worktree-mode, readonly-mode, broken.
  // Column set mirrors migration 054 + 058 (error_message added in 058).
  // recipes.created_at / updated_at default via unixepoch() so no placeholders for them.
  const cols = `(slug, name, description, when_to_use, image, workspace_mode, timeout_seconds, max_concurrent,
                 env_json, secrets_json, tags_json, model_json, version, dir_sha, soul_md, error_message,
                 workspace_id, tenant_id)`
  const values = `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  const stmt = testDb.prepare(`INSERT INTO recipes ${cols} VALUES ${values}`)

  stmt.run(
    'wt-recipe',
    'Worktree Recipe',
    'desc',
    'when',
    'ubuntu',
    'worktree',
    600,
    1,
    '{}',
    '[]',
    '[]',
    JSON.stringify({ primary: 'claude-opus-4-7' }),
    1,
    'sha-wt',
    null,
    null,
    1,
    1,
  )
  stmt.run(
    'ro-recipe',
    'Readonly Recipe',
    'desc',
    'when',
    'ubuntu',
    'readonly',
    600,
    1,
    '{}',
    '[]',
    '[]',
    JSON.stringify({ primary: 'claude-opus-4-7' }),
    1,
    'sha-ro',
    null,
    null,
    1,
    1,
  )
  stmt.run(
    'broken-recipe',
    'broken-recipe',
    null,
    null,
    'unknown',
    'worktree',
    0,
    1,
    '{}',
    '[]',
    '[]',
    '{}',
    1,
    'sha-broken',
    null,
    'YAML parse error',
    1,
    1,
  )

  // Build a real tmp dir + subpath + attempted symlink escape.
  tmpRoot = await mkdtemp(join(tmpdir(), 'mc13-'))
  await mkdir(join(tmpRoot, 'refs'), { recursive: true })
  await writeFile(join(tmpRoot, 'refs', 'dummy.txt'), 'hello')
  symlinkCreated = false
  try {
    await symlink('/etc', join(tmpRoot, 'escape'))
    symlinkCreated = true
  } catch {
    // Some platforms deny symlink creation — test 12 skips if so.
  }

  // Seed allowlist setting -> [tmpRoot].
  testDb
    .prepare(
      `INSERT INTO settings (key, value, category, updated_at) VALUES (?, ?, 'runtime', unixepoch())`,
    )
    .run('runtime.mount_allowlist', JSON.stringify([tmpRoot]))
})

afterEach(async () => {
  testDb.close()
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
})

function jsonReq(body: unknown): NextRequest {
  return new NextRequest('http://x/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Test helper — body shapes vary across 20 cases so `any` keeps call sites
// readable; re-typing per test would add noise without catching real bugs.
async function readBody(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function seedSetting(key: string, value: string): void {
  testDb
    .prepare(
      `INSERT OR REPLACE INTO settings (key, value, category, updated_at) VALUES (?, ?, 'runtime', unixepoch())`,
    )
    .run(key, value)
}

describe('POST /api/tasks — runtime-context validation (Phase 13, TCTX-01..06)', () => {
  // 1. Legacy body (no runtime fields)
  it('legacy body without any runtime fields returns 201 with null/[] defaults', async () => {
    const res = await POST(jsonReq({ title: 't1' }))
    expect(res.status).toBe(201)
    const body = await readBody(res)
    expect(body.task.recipe_slug).toBeNull()
    expect(body.task.workspace_source).toBeNull()
    expect(body.task.read_only_mounts).toEqual([])
    expect(body.task.extra_skills).toEqual([])
    expect(body.task.model_override).toBeNull()
  })

  // 2. Unknown recipe_slug -> RECIPE_NOT_FOUND
  it('unknown recipe_slug returns 400 with RECIPE_NOT_FOUND', async () => {
    const res = await POST(jsonReq({ title: 't', recipe_slug: 'no-such' }))
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors[0].code).toBe('RECIPE_NOT_FOUND')
    expect(body.errors[0].field).toBe('recipe_slug')
  })

  // 3. Broken recipe -> RECIPE_BROKEN
  it('broken recipe returns 400 with RECIPE_BROKEN and echoes parse error', async () => {
    const res = await POST(jsonReq({ title: 't', recipe_slug: 'broken-recipe' }))
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors[0].code).toBe('RECIPE_BROKEN')
    expect(body.errors[0].message).toContain('YAML parse error')
  })

  // 4. Worktree recipe WITHOUT workspace_source -> REQUIRED_BY_RECIPE
  it('worktree recipe without workspace_source returns 400 with REQUIRED_BY_RECIPE', async () => {
    const res = await POST(jsonReq({ title: 't', recipe_slug: 'wt-recipe' }))
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors[0].code).toBe('REQUIRED_BY_RECIPE')
    expect(body.errors[0].field).toBe('workspace_source')
  })

  // 5. Worktree recipe WITH workspace_source -> 201
  it('worktree recipe with workspace_source returns 201 and round-trips', async () => {
    const res = await POST(
      jsonReq({
        title: 't',
        recipe_slug: 'wt-recipe',
        workspace_source: { project_id: 1, base_ref: 'main' },
      }),
    )
    expect(res.status).toBe(201)
    const body = await readBody(res)
    expect(body.task.recipe_slug).toBe('wt-recipe')
    expect(body.task.workspace_source).toEqual({ project_id: 1, base_ref: 'main' })
  })

  // 6. Readonly recipe WITHOUT workspace_source -> 201
  it('readonly recipe without workspace_source returns 201', async () => {
    const res = await POST(jsonReq({ title: 't', recipe_slug: 'ro-recipe' }))
    expect(res.status).toBe(201)
  })

  // 7. read_only_mounts host_path inside allowlist -> 201
  it('read_only_mounts inside allowlist returns 201', async () => {
    const res = await POST(
      jsonReq({
        title: 't',
        read_only_mounts: [
          { host_path: join(tmpRoot, 'refs'), container_path: '/refs/d', label: 'd' },
        ],
      }),
    )
    expect(res.status).toBe(201)
    const body = await readBody(res)
    expect(body.task.read_only_mounts).toHaveLength(1)
  })

  // 8. read_only_mounts outside allowlist -> OUT_OF_ALLOWLIST + echoed path
  it('read_only_mounts outside allowlist returns OUT_OF_ALLOWLIST echoing host_path', async () => {
    const res = await POST(
      jsonReq({
        title: 't',
        read_only_mounts: [
          { host_path: '/tmp/definitely-outside', container_path: '/refs/x', label: 'x' },
        ],
      }),
    )
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors[0].code).toBe('OUT_OF_ALLOWLIST')
    expect(body.errors[0].field).toBe('read_only_mounts.0.host_path')
    expect(body.errors[0].message).toContain('/tmp/definitely-outside')
  })

  // 9. extra_skills outside allowlist -> OUT_OF_ALLOWLIST
  it('extra_skills outside allowlist returns OUT_OF_ALLOWLIST on extra_skills.0', async () => {
    const res = await POST(
      jsonReq({ title: 't', extra_skills: ['/var/elsewhere/skill'] }),
    )
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors[0].field).toBe('extra_skills.0')
    expect(body.errors[0].code).toBe('OUT_OF_ALLOWLIST')
  })

  // 10. Aggregated: two violations in one body
  it('aggregates TWO violations in a single 400 response', async () => {
    const res = await POST(
      jsonReq({
        title: 't',
        read_only_mounts: [
          { host_path: '/outside-a', container_path: '/r/a', label: 'a' },
        ],
        extra_skills: ['/outside-b/skill'],
      }),
    )
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors).toHaveLength(2)
    for (const issue of body.errors) {
      expect(issue.code).toBe('OUT_OF_ALLOWLIST')
    }
  })

  // 11. Empty allowlist -> ALLOWLIST_EMPTY
  it('empty allowlist rejects any read_only_mounts with ALLOWLIST_EMPTY', async () => {
    seedSetting('runtime.mount_allowlist', '[]')
    const res = await POST(
      jsonReq({
        title: 't',
        read_only_mounts: [
          { host_path: join(tmpRoot, 'refs'), container_path: '/r/d', label: 'd' },
        ],
      }),
    )
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors[0].code).toBe('ALLOWLIST_EMPTY')
    expect(body.errors[0].hint).toContain('runtime.mount_allowlist')
  })

  // 12. Symlink escape -> OUT_OF_ALLOWLIST
  it('symlink escape resolves via realpath and returns OUT_OF_ALLOWLIST', async () => {
    if (!symlinkCreated) {
      // OS denied symlink creation (sandbox/CI without permission) — skip.
      return
    }
    const res = await POST(
      jsonReq({
        title: 't',
        read_only_mounts: [
          { host_path: join(tmpRoot, 'escape'), container_path: '/r/e', label: 'e' },
        ],
      }),
    )
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors[0].code).toBe('OUT_OF_ALLOWLIST')
  })

  // 13. Existence NOT enforced — non-existent subpath under allowlist -> 201
  it('non-existent path whose ancestor resolves inside allowlist returns 201', async () => {
    const res = await POST(
      jsonReq({
        title: 't',
        read_only_mounts: [
          {
            host_path: join(tmpRoot, 'not-yet', 'file.txt'),
            container_path: '/r/ne',
            label: 'ne',
          },
        ],
      }),
    )
    expect(res.status).toBe(201)
  })

  // 14. read_only_mounts cap exceeded
  it('read_only_mounts over cap returns CAP_EXCEEDED', async () => {
    seedSetting('runtime.read_only_mounts_cap', '2')
    const mounts = [
      { host_path: join(tmpRoot, 'refs'), container_path: '/r/a', label: 'a' },
      { host_path: join(tmpRoot, 'refs'), container_path: '/r/b', label: 'b' },
      { host_path: join(tmpRoot, 'refs'), container_path: '/r/c', label: 'c' },
    ]
    const res = await POST(jsonReq({ title: 't', read_only_mounts: mounts }))
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors[0].code).toBe('CAP_EXCEEDED')
    expect(body.errors[0].field).toBe('read_only_mounts')
  })

  // 15. extra_skills cap exceeded
  it('extra_skills over cap returns CAP_EXCEEDED', async () => {
    seedSetting('runtime.extra_skills_cap', '1')
    const res = await POST(
      jsonReq({
        title: 't',
        extra_skills: [join(tmpRoot, 'skill-a'), join(tmpRoot, 'skill-b')],
      }),
    )
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors[0].code).toBe('CAP_EXCEEDED')
    expect(body.errors[0].field).toBe('extra_skills')
  })

  // 16. Unknown model_override -> UNKNOWN_MODEL
  it('unknown model_override surfaces UNKNOWN_MODEL in aggregated payload', async () => {
    const res = await POST(jsonReq({ title: 't', model_override: 'gpt-4' }))
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.errors[0].code).toBe('UNKNOWN_MODEL')
    expect(body.errors[0].field).toBe('model_override')
    expect(body.errors[0].message).toContain('model registry')
  })

  // 17. Known model_override -> 201, round-trips
  it('known model_override returns 201 and round-trips on response', async () => {
    const res = await POST(
      jsonReq({ title: 't', model_override: 'claude-opus-4-7' }),
    )
    expect(res.status).toBe(201)
    const body = await readBody(res)
    expect(body.task.model_override).toBe('claude-opus-4-7')
  })

  // 18. Duplicate labels in read_only_mounts
  it('duplicate labels in read_only_mounts surface as aggregated 400', async () => {
    const res = await POST(
      jsonReq({
        title: 't',
        read_only_mounts: [
          { host_path: join(tmpRoot, 'refs'), container_path: '/r/1', label: 'same' },
          { host_path: join(tmpRoot, 'refs'), container_path: '/r/2', label: 'same' },
        ],
      }),
    )
    expect(res.status).toBe(400)
    const body = await readBody(res)
    const match = body.errors.find((e: { field: string; message: string }) =>
      e.field.startsWith('read_only_mounts') && /duplicate labels/i.test(e.message),
    )
    expect(match).toBeTruthy()
  })

  // 19. base_ref with whitespace
  it('workspace_source.base_ref with whitespace surfaces as aggregated 400', async () => {
    const res = await POST(
      jsonReq({
        title: 't',
        workspace_source: { project_id: 1, base_ref: 'main branch' },
      }),
    )
    expect(res.status).toBe(400)
    const body = await readBody(res)
    const match = body.errors.find((e: { field: string; message: string }) =>
      e.field.startsWith('workspace_source.base_ref') &&
      /whitespace/i.test(e.message),
    )
    expect(match).toBeTruthy()
  })

  // 20. Round-trip (TCTX-03) — POST response + list GET both reflect every runtime field
  it('round-trips every runtime field through POST response and GET /api/tasks list', async () => {
    const body = {
      title: 'round-trip',
      recipe_slug: 'wt-recipe',
      workspace_source: { project_id: 1, base_ref: 'main' },
      read_only_mounts: [
        {
          host_path: join(tmpRoot, 'refs'),
          container_path: '/refs/d',
          label: 'd',
        },
      ],
      extra_skills: [join(tmpRoot, 'refs')],
      model_override: 'claude-opus-4-7',
    }
    const res = await POST(jsonReq(body))
    expect(res.status).toBe(201)
    const created = await readBody(res)
    const taskId = created.task.id
    expect(typeof taskId).toBe('number')

    // Assertions on POST response (goes through this file's mapTaskRow).
    expect(created.task.recipe_slug).toBe('wt-recipe')
    expect(created.task.workspace_source).toEqual({ project_id: 1, base_ref: 'main' })
    expect(created.task.read_only_mounts).toHaveLength(1)
    expect(created.task.read_only_mounts[0]).toMatchObject({
      host_path: join(tmpRoot, 'refs'),
      container_path: '/refs/d',
      label: 'd',
    })
    expect(created.task.extra_skills).toEqual([join(tmpRoot, 'refs')])
    expect(created.task.model_override).toBe('claude-opus-4-7')

    // Re-read via GET /api/tasks (also uses this file's mapTaskRow) to prove the
    // shape survives DB round-trip end-to-end, not just the in-memory return.
    const listReq = new NextRequest('http://x/api/tasks')
    const listRes = await GET(listReq)
    expect(listRes.status).toBe(200)
    const listed = await readBody(listRes)
    const found = listed.tasks.find(
      (t: { id: number }) => t.id === taskId,
    ) as {
      recipe_slug: string
      workspace_source: { project_id: number; base_ref: string }
      read_only_mounts: Array<{ host_path: string; container_path: string; label: string }>
      extra_skills: string[]
      model_override: string
    }
    expect(found).toBeTruthy()
    expect(found.recipe_slug).toBe('wt-recipe')
    expect(found.workspace_source).toEqual({ project_id: 1, base_ref: 'main' })
    expect(found.read_only_mounts).toHaveLength(1)
    expect(found.read_only_mounts[0].label).toBe('d')
    expect(found.extra_skills).toEqual([join(tmpRoot, 'refs')])
    expect(found.model_override).toBe('claude-opus-4-7')
  })
})
