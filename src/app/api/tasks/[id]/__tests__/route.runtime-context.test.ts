/**
 * PATCH /api/tasks/:id runtime-context validation (Plan 13-03).
 *
 * Covers every must_have truth in the plan:
 *   - Pre-dispatch recipe_slug mutability gate (RECIPE_LOCKED)
 *   - Identity PATCH bypasses the gate regardless of status
 *   - Recipe existence (RECIPE_NOT_FOUND) + broken-recipe (RECIPE_BROKEN)
 *   - Atomic workspace_source gap rejection (REQUIRED_BY_RECIPE, DB unchanged)
 *   - Preserve-and-revalidate: existing fields re-checked on recipe change
 *   - Allowlist (OUT_OF_ALLOWLIST) + caps (CAP_EXCEEDED)
 *   - Manual safeParse aggregated-shape errors (UNKNOWN_MODEL)
 *   - RAUTH-05 atomic revocation on terminal transition
 *   - GET round-trip (mapTaskRow JSON.parse for workspace_source /
 *     read_only_mounts / extra_skills)
 *   - Two-violation aggregation
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
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
vi.mock('@/lib/gnap-sync', () => ({
  pushTaskToGnap: vi.fn(),
  removeTaskFromGnap: vi.fn(),
}))
vi.mock('@/lib/mentions', () => ({
  resolveMentionRecipients: () => ({ recipients: [], unresolved: [] }),
}))
vi.mock('@/lib/config', () => ({
  config: { gnap: { enabled: false, autoSync: false, repoPath: '/tmp/noop' } },
}))

const { PUT, GET } = await import('../route')
const { eventBus } = await import('@/lib/event-bus')

let tmpRoot: string

beforeEach(async () => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  vi.mocked(eventBus.broadcast).mockClear()

  // Migration 001 seeds no workspace; migration 021 seeds workspace id=1 slug='default'.
  // Migration 024 seeds a default project with slug='general' ticket_prefix='TASK' for every workspace.
  // Seed three recipe rows (worktree, readonly, broken) directly via SQL.
  const recipeCols = `(slug, name, description, when_to_use, image, workspace_mode, timeout_seconds, max_concurrent,
                       env_json, secrets_json, tags_json, model_json, version, dir_sha, soul_md, error_message,
                       workspace_id, tenant_id, created_at, updated_at)`
  const recipeVals = `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch())`
  testDb.prepare(`INSERT INTO recipes ${recipeCols} VALUES ${recipeVals}`).run(
    'wt-recipe', 'Worktree Recipe', 'd', 'w', 'ubuntu', 'worktree', 600, 1,
    '{}', '[]', '[]', '{"primary":"claude-opus-4-7"}', 1, 'sha-wt', null, null, 1, 1,
  )
  testDb.prepare(`INSERT INTO recipes ${recipeCols} VALUES ${recipeVals}`).run(
    'ro-recipe', 'Readonly Recipe', 'd', 'w', 'ubuntu', 'readonly', 600, 1,
    '{}', '[]', '[]', '{"primary":"claude-opus-4-7"}', 1, 'sha-ro', null, null, 1, 1,
  )
  testDb.prepare(`INSERT INTO recipes ${recipeCols} VALUES ${recipeVals}`).run(
    'broken-recipe', '', '', '', '', 'worktree', 0, 1,
    '{}', '[]', '[]', '{}', 1, 'sha-broken', null, 'YAML parse error', 1, 1,
  )

  tmpRoot = await mkdtemp(join(tmpdir(), 'mc13-patch-'))
  await mkdir(join(tmpRoot, 'refs'), { recursive: true })
  await writeFile(join(tmpRoot, 'refs', 'dummy.txt'), 'hello')
  await mkdir(join(tmpRoot, 'other-ref'), { recursive: true })

  testDb.prepare(
    `INSERT OR REPLACE INTO settings (key, value, category, updated_at) VALUES (?, ?, 'runtime', unixepoch())`,
  ).run('runtime.mount_allowlist', JSON.stringify([tmpRoot]))
})

afterEach(async () => {
  testDb.close()
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
})

interface SeedTaskOpts {
  status?: string
  recipe_slug?: string | null
  workspace_source?: { project_id: number; base_ref: string } | null
  read_only_mounts?: Array<{ host_path: string; container_path: string; label: string }> | null
  extra_skills?: string[] | null
  model_override?: string | null
  gate_required?: 0 | 1
  gate_status?: string
  title?: string
}

function seedTask(opts: SeedTaskOpts = {}): number {
  // Use the default 'general' project (id=1, ticket_prefix='TASK') auto-seeded by migration 024.
  // Bump its ticket_counter first so multiple seeds don't collide on project_ticket_no uniqueness
  // (no uniqueness constraint in current schema, but we keep it monotonic for realism).
  testDb.prepare(`UPDATE projects SET ticket_counter = ticket_counter + 1 WHERE id = 1`).run()
  const ticketNo = (testDb.prepare(`SELECT ticket_counter FROM projects WHERE id = 1`).get() as { ticket_counter: number }).ticket_counter
  const result = testDb.prepare(`
    INSERT INTO tasks (
      title, status, priority, project_id, project_ticket_no, workspace_id,
      recipe_slug, workspace_source, read_only_mounts, extra_skills, model_override,
      gate_required, gate_status, created_at, updated_at
    ) VALUES (?, ?, 'medium', 1, ?, 1, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `).run(
    opts.title ?? 'seed',
    opts.status ?? 'inbox',
    ticketNo,
    opts.recipe_slug ?? null,
    opts.workspace_source ? JSON.stringify(opts.workspace_source) : null,
    opts.read_only_mounts ? JSON.stringify(opts.read_only_mounts) : null,
    opts.extra_skills ? JSON.stringify(opts.extra_skills) : null,
    opts.model_override ?? null,
    opts.gate_required ?? 0,
    opts.gate_status ?? 'not_required',
  )
  return Number(result.lastInsertRowid)
}

function patchReq(id: number, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getReq(id: number): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${id}`, { method: 'GET' })
}

async function putTask(id: number, body: unknown) {
  return PUT(patchReq(id, body), { params: Promise.resolve({ id: String(id) }) })
}

async function getTask(id: number) {
  return GET(getReq(id), { params: Promise.resolve({ id: String(id) }) })
}

describe('PUT /api/tasks/:id runtime-context (Plan 13-03)', () => {
  // -------------------------------------------------------------------------
  // Status gate (pre-dispatch-only)
  // -------------------------------------------------------------------------

  it('1. PATCH recipe_slug when status=inbox → 200', async () => {
    const id = seedTask({ status: 'inbox' })
    const res = await putTask(id, { recipe_slug: 'ro-recipe' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.recipe_slug).toBe('ro-recipe')
  })

  it('2. PATCH recipe_slug when status=backlog → 200', async () => {
    const id = seedTask({ status: 'backlog' })
    const res = await putTask(id, { recipe_slug: 'ro-recipe' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.recipe_slug).toBe('ro-recipe')
  })

  it('3. PATCH recipe_slug when status=assigned → RECIPE_LOCKED', async () => {
    const id = seedTask({ status: 'assigned' })
    const res = await putTask(id, { recipe_slug: 'ro-recipe' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors[0].code).toBe('RECIPE_LOCKED')
    expect(body.errors[0].message).toContain('assigned')
  })

  it('4. PATCH recipe_slug when status=in_progress → RECIPE_LOCKED', async () => {
    const id = seedTask({ status: 'in_progress' })
    const res = await putTask(id, { recipe_slug: 'ro-recipe' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors[0].code).toBe('RECIPE_LOCKED')
    expect(body.errors[0].message).toContain('in_progress')
  })

  it('5. PATCH recipe_slug when status=done → RECIPE_LOCKED', async () => {
    const id = seedTask({ status: 'done' })
    const res = await putTask(id, { recipe_slug: 'ro-recipe' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors[0].code).toBe('RECIPE_LOCKED')
  })

  it('6. identity PATCH when status=in_progress → 200 (same slug bypasses gate)', async () => {
    const id = seedTask({ status: 'in_progress', recipe_slug: 'ro-recipe' })
    const res = await putTask(id, { recipe_slug: 'ro-recipe' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.recipe_slug).toBe('ro-recipe')
  })

  it('7. PATCH omitting recipe_slug on a dispatched task → 200, recipe_slug unchanged', async () => {
    const id = seedTask({ status: 'in_progress', recipe_slug: 'ro-recipe' })
    const res = await putTask(id, { title: 'new title' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.recipe_slug).toBe('ro-recipe')
    expect(body.task.title).toBe('new title')
  })

  it('7b. PATCH recipe task inbox→assigned emits task.runner_requested', async () => {
    const id = seedTask({ status: 'inbox', recipe_slug: 'ro-recipe' })

    const res = await putTask(id, { status: 'assigned' })
    expect(res.status).toBe(200)

    expect(eventBus.broadcast).toHaveBeenCalledWith(
      'task.runner_requested',
      {
        task_id: id,
        recipe_slug: 'ro-recipe',
        workspace_id: 1,
      },
    )
  })

  // -------------------------------------------------------------------------
  // Recipe existence + workspace_source gap
  // -------------------------------------------------------------------------

  it('8. PATCH setting recipe_slug to missing recipe → RECIPE_NOT_FOUND', async () => {
    const id = seedTask({ status: 'inbox' })
    const res = await putTask(id, { recipe_slug: 'no-such-recipe' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors[0].code).toBe('RECIPE_NOT_FOUND')
    expect(body.errors[0].field).toBe('recipe_slug')
  })

  it('9. PATCH setting recipe_slug to broken recipe → RECIPE_BROKEN', async () => {
    const id = seedTask({ status: 'inbox' })
    const res = await putTask(id, { recipe_slug: 'broken-recipe' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors[0].code).toBe('RECIPE_BROKEN')
  })

  it('10. PATCH to worktree recipe without workspace_source → REQUIRED_BY_RECIPE + no DB mutation (ATOMICITY)', async () => {
    // Seed with a NON-NULL starting recipe_slug so "column unchanged post-400"
    // is observable only if the UPDATE was truly skipped.
    const id = seedTask({ status: 'inbox', recipe_slug: 'ro-recipe' })
    const beforeSlug = testDb.prepare('SELECT recipe_slug FROM tasks WHERE id = ?').get(id) as { recipe_slug: string }
    expect(beforeSlug.recipe_slug).toBe('ro-recipe')

    const res = await putTask(id, { recipe_slug: 'wt-recipe' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors[0].code).toBe('REQUIRED_BY_RECIPE')
    expect(body.errors[0].field).toBe('workspace_source')

    // Atomicity assertion: the DB row is unchanged. recipe_slug MUST still be 'ro-recipe',
    // NOT 'wt-recipe' (would indicate the UPDATE ran anyway) and NOT null (would pass
    // trivially if we'd seeded with null).
    const afterSlug = testDb.prepare('SELECT recipe_slug FROM tasks WHERE id = ?').get(id) as { recipe_slug: string }
    expect(afterSlug.recipe_slug).toBe('ro-recipe')
  })

  it('11. PATCH to worktree recipe with workspace_source in SAME body → 200', async () => {
    const id = seedTask({ status: 'inbox' })
    const res = await putTask(id, {
      recipe_slug: 'wt-recipe',
      workspace_source: { project_id: 1, base_ref: 'main' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.recipe_slug).toBe('wt-recipe')
    expect(body.task.workspace_source).toEqual({ project_id: 1, base_ref: 'main' })
  })

  it('12. PATCH recipe_slug on a task that ALREADY has workspace_source → 200, workspace_source preserved', async () => {
    const id = seedTask({
      status: 'inbox',
      workspace_source: { project_id: 1, base_ref: 'feature-x' },
    })
    const res = await putTask(id, { recipe_slug: 'wt-recipe' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.recipe_slug).toBe('wt-recipe')
    expect(body.task.workspace_source).toEqual({ project_id: 1, base_ref: 'feature-x' })
  })

  // -------------------------------------------------------------------------
  // Preserve-and-revalidate
  // -------------------------------------------------------------------------

  it('13. PATCH recipe_slug only, existing read_only_mounts still valid → 200, mounts preserved', async () => {
    const id = seedTask({
      status: 'inbox',
      read_only_mounts: [
        { host_path: join(tmpRoot, 'refs'), container_path: '/r/d', label: 'd' },
      ],
    })
    const res = await putTask(id, { recipe_slug: 'ro-recipe' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.recipe_slug).toBe('ro-recipe')
    expect(body.task.read_only_mounts).toHaveLength(1)
    expect(body.task.read_only_mounts[0].label).toBe('d')
  })

  it('14. PATCH recipe_slug only after allowlist tightened → OUT_OF_ALLOWLIST (preserve-and-revalidate)', async () => {
    const id = seedTask({
      status: 'inbox',
      read_only_mounts: [
        { host_path: join(tmpRoot, 'refs'), container_path: '/r/d', label: 'd' },
      ],
    })
    // Tighten the allowlist to something disjoint from tmpRoot.
    testDb.prepare(
      `UPDATE settings SET value = ? WHERE key = 'runtime.mount_allowlist'`,
    ).run(JSON.stringify(['/completely/unrelated']))

    const res = await putTask(id, { recipe_slug: 'ro-recipe' })
    expect(res.status).toBe(400)
    const body = await res.json()
    const issue = body.errors[0]
    expect(issue.field).toBe('read_only_mounts.0.host_path')
    expect(issue.code).toBe('OUT_OF_ALLOWLIST')

    // DB row unchanged — recipe_slug must still be null (seeded as null).
    const after = testDb.prepare('SELECT recipe_slug FROM tasks WHERE id = ?').get(id) as { recipe_slug: string | null }
    expect(after.recipe_slug).toBeNull()
  })

  it('15. PATCH extra_skills explicitly to an invalid new list → OUT_OF_ALLOWLIST', async () => {
    const id = seedTask({ status: 'inbox' })
    const res = await putTask(id, { extra_skills: ['/outside/skill'] })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors[0].field).toBe('extra_skills.0')
    expect(body.errors[0].code).toBe('OUT_OF_ALLOWLIST')
  })

  it('16. PATCH explicitly clears read_only_mounts → 200, cleared', async () => {
    const id = seedTask({
      status: 'inbox',
      read_only_mounts: [
        { host_path: join(tmpRoot, 'refs'), container_path: '/r/d', label: 'd' },
      ],
    })
    const res = await putTask(id, { read_only_mounts: [] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.read_only_mounts).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Caps on PATCH
  // -------------------------------------------------------------------------

  it('17. PATCH with > cap read_only_mounts → CAP_EXCEEDED', async () => {
    testDb.prepare(
      `INSERT OR REPLACE INTO settings (key, value, category, updated_at) VALUES (?, ?, 'runtime', unixepoch())`,
    ).run('runtime.read_only_mounts_cap', '1')
    const id = seedTask({ status: 'inbox' })
    const res = await putTask(id, {
      read_only_mounts: [
        { host_path: join(tmpRoot, 'refs'), container_path: '/r/a', label: 'a' },
        { host_path: join(tmpRoot, 'other-ref'), container_path: '/r/b', label: 'b' },
      ],
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    // CAP_EXCEEDED should be one of the issues (could be bundled with other checks
    // since the cap check runs BEFORE allowlist, both arrays see 2 entries).
    const capIssue = body.errors.find((e: { code: string }) => e.code === 'CAP_EXCEEDED')
    expect(capIssue).toBeDefined()
    expect(capIssue.field).toBe('read_only_mounts')
  })

  // -------------------------------------------------------------------------
  // Model override on PATCH (aggregated shape)
  // -------------------------------------------------------------------------

  it('18. PATCH with unknown model_override → UNKNOWN_MODEL in aggregated payload', async () => {
    const id = seedTask({ status: 'inbox' })
    const res = await putTask(id, { model_override: 'gpt-4' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors[0].code).toBe('UNKNOWN_MODEL')
    expect(body.errors[0].field).toBe('model_override')
  })

  // -------------------------------------------------------------------------
  // RAUTH-05 preservation
  // -------------------------------------------------------------------------

  it('19. PATCH status=done while recipe_slug is set → 200, runner tokens revoked atomically', async () => {
    const id = seedTask({ status: 'review', recipe_slug: 'ro-recipe' })
    testDb.prepare(`INSERT INTO task_runner_tokens (task_id, attempt, token_hash, expires_at, revoked_at, created_at)
                    VALUES (?, 1, 'fakehash-test19', unixepoch()+3600, NULL, unixepoch())`).run(id)
    // Seed Aegis approval so the done-transition isn't blocked by the Aegis gate.
    testDb.prepare(`INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id, created_at)
                    VALUES (?, 'aegis', 'approved', 'ok', 1, unixepoch())`).run(id)

    const res = await putTask(id, { status: 'done' })
    expect(res.status).toBe(200)

    const row = testDb.prepare(
      'SELECT revoked_at FROM task_runner_tokens WHERE task_id = ? AND attempt = 1',
    ).get(id) as { revoked_at: number | null }
    expect(row.revoked_at).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // Aggregated errors
  // -------------------------------------------------------------------------

  it('20. two PATCH violations aggregated — 400 with TWO issues', async () => {
    const id = seedTask({ status: 'inbox' })
    const res = await putTask(id, {
      recipe_slug: 'wt-recipe',
      read_only_mounts: [
        { host_path: '/outside/path', container_path: '/r/a', label: 'a' },
      ],
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    // One REQUIRED_BY_RECIPE (wt-recipe + no workspace_source) + one OUT_OF_ALLOWLIST
    expect(body.errors.length).toBeGreaterThanOrEqual(2)
    const codes = body.errors.map((e: { code: string }) => e.code)
    expect(codes).toContain('REQUIRED_BY_RECIPE')
    expect(codes).toContain('OUT_OF_ALLOWLIST')
  })

  // -------------------------------------------------------------------------
  // Round-trip
  // -------------------------------------------------------------------------

  it('21. PATCH round-trip via GET /api/tasks/:id', async () => {
    const id = seedTask({ status: 'inbox' })

    let res = await putTask(id, {
      recipe_slug: 'wt-recipe',
      workspace_source: { project_id: 1, base_ref: 'main' },
    })
    expect(res.status).toBe(200)
    let getRes = await getTask(id)
    let body = await getRes.json()
    expect(body.task.recipe_slug).toBe('wt-recipe')
    expect(body.task.workspace_source).toEqual({ project_id: 1, base_ref: 'main' })
    expect(body.task.read_only_mounts).toEqual([])
    expect(body.task.extra_skills).toEqual([])

    res = await putTask(id, {
      read_only_mounts: [
        { host_path: join(tmpRoot, 'refs'), container_path: '/r/d', label: 'd' },
      ],
    })
    expect(res.status).toBe(200)
    getRes = await getTask(id)
    body = await getRes.json()
    expect(body.task.recipe_slug).toBe('wt-recipe')
    expect(body.task.workspace_source).toEqual({ project_id: 1, base_ref: 'main' })
    expect(body.task.read_only_mounts).toHaveLength(1)
    expect(body.task.read_only_mounts[0].label).toBe('d')

    res = await putTask(id, { extra_skills: [join(tmpRoot, 'refs')] })
    expect(res.status).toBe(200)
    getRes = await getTask(id)
    body = await getRes.json()
    expect(Array.isArray(body.task.extra_skills)).toBe(true)
    expect(body.task.extra_skills).toHaveLength(1)
    // workspace_source / recipe_slug / read_only_mounts still stable across the three PATCHes
    expect(body.task.recipe_slug).toBe('wt-recipe')
    expect(body.task.workspace_source).toEqual({ project_id: 1, base_ref: 'main' })
    expect(body.task.read_only_mounts).toHaveLength(1)
  })
})
