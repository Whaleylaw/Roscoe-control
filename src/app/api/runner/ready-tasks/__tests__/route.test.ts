/**
 * Tests for GET /api/runner/ready-tasks (Plan 14-04).
 *
 * Each it() corresponds to a Wave-0 stub from 14-03. In-memory sqlite mirrors
 * the heartbeat test file's pattern; seeds tasks directly to exercise the
 * WHERE clause that gates claimable work.
 */

import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'

let testDb: Database.Database

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {},
  Task: {},
  logAuditEvent: vi.fn(),
}))

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET } from '@/app/api/runner/ready-tasks/route'

function asRunner() {
  requireRoleMock.mockReturnValueOnce({
    user: {
      id: -1000,
      username: 'runner',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
    },
  })
}

function asOperatorSessionUser() {
  requireRoleMock.mockReturnValueOnce({
    user: {
      id: 7,
      username: 'tester',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
    },
  })
}

function makeGet(): NextRequest {
  return new NextRequest('http://localhost/api/runner/ready-tasks', { method: 'GET' })
}

type SeedTask = {
  title: string
  status: string
  recipe_slug: string | null
  container_id?: string | null
  model_override?: string | null
  workspace_source?: string | null
  read_only_mounts?: string | null
  extra_skills?: string | null
  runner_max_attempts?: number | null
}

function seedTask(t: SeedTask): number {
  const { lastInsertRowid } = testDb
    .prepare(
      `INSERT INTO tasks (title, status, recipe_slug, container_id, model_override,
                          workspace_source, read_only_mounts, extra_skills, runner_max_attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.title,
      t.status,
      t.recipe_slug,
      t.container_id ?? null,
      t.model_override ?? null,
      t.workspace_source ?? null,
      t.read_only_mounts ?? null,
      t.extra_skills ?? null,
      t.runner_max_attempts ?? null,
    )
  return Number(lastInsertRowid)
}

function seedRecipeWithReview(slug: string): void {
  testDb
    .prepare(
      `INSERT INTO recipes (
         slug, name, image, workspace_mode, timeout_seconds, max_concurrent,
         env_json, secrets_json, tags_json, model_json, version, dir_sha,
         soul_md, review_md, workspace_id, tenant_id
       ) VALUES (?, ?, 'mc-recipe-agent:latest', 'worktree', 300, 1,
         '{}', '[]', '[]', '{"primary":"openai/gpt-5.4-mini"}', 1, ?,
         'soul', 'review', 1, 1)`,
    )
    .run(slug, slug, `sha-${slug}`)
}

function seedOpenReviewPr(taskId: number): void {
  testDb
    .prepare(
      `INSERT INTO task_review_prs (
         task_id, workspace_id, provider, remote_name, remote_url, repo_owner,
         repo_name, base_ref, head_ref, branch_name, pr_number, pr_url, state
       ) VALUES (?, 1, 'forgejo', 'forgejo', 'ssh://git@localhost:2222/aaron/FirmVault.git',
         'aaron', 'FirmVault', 'main', 'mc/task-open', 'mc/task-open', ?, ?, 'open')`,
    )
    .run(taskId, 1000 + taskId, `http://localhost:3001/aaron/FirmVault/pulls/${1000 + taskId}`)
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  requireRoleMock.mockReset()
})

describe('GET /api/runner/ready-tasks', () => {
  it('RUNNER-04: returns tasks where status=assigned AND recipe_slug IS NOT NULL AND container_id IS NULL', async () => {
    asRunner()

    const claimableId = seedTask({
      title: 'claimable', status: 'assigned', recipe_slug: 'wt-recipe',
    })
    // Excluded: no recipe_slug.
    seedTask({ title: 'no-recipe', status: 'assigned', recipe_slug: null })
    // Excluded: status != 'assigned'.
    seedTask({ title: 'in-progress', status: 'in_progress', recipe_slug: 'wt-recipe' })
    // Excluded: already claimed (container_id set).
    seedTask({
      title: 'already-claimed',
      status: 'assigned',
      recipe_slug: 'wt-recipe',
      container_id: 'mc-task-99-a1',
    })

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].id).toBe(claimableId)
    expect(body.tasks[0].recipe_slug).toBe('wt-recipe')
  })

  it('RUNNER-04: excludes tasks that already have a container_id (already claimed)', async () => {
    asRunner()

    // Two tasks with identical shape except container_id.
    const unclaimedId = seedTask({
      title: 'unclaimed', status: 'assigned', recipe_slug: 'wt-recipe',
    })
    seedTask({
      title: 'claimed',
      status: 'assigned',
      recipe_slug: 'wt-recipe',
      container_id: 'mc-task-123-a1',
    })

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()

    const ids = body.tasks.map((t: { id: number }) => t.id)
    expect(ids).toEqual([unclaimedId])
  })

  it('RUNNER-04: includes task.model_override when set so runner can forward via MC_MODEL_PRIMARY', async () => {
    asRunner()

    seedTask({
      title: 'with-override',
      status: 'assigned',
      recipe_slug: 'wt-recipe',
      model_override: 'haiku-4-5',
      workspace_source: JSON.stringify({ project_id: 1, base_ref: 'main' }),
      read_only_mounts: JSON.stringify([
        { host_path: '/tmp/a', container_path: '/ro/a', label: 'a' },
      ]),
      extra_skills: JSON.stringify(['skill-one']),
      runner_max_attempts: 5,
    })

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.tasks).toHaveLength(1)
    const t = body.tasks[0]
    expect(t.model_override).toBe('haiku-4-5')
    // JSON columns are parsed in the response shape.
    expect(t.workspace_source).toEqual({ project_id: 1, base_ref: 'main' })
    expect(t.read_only_mounts).toEqual([
      { host_path: '/tmp/a', container_path: '/ro/a', label: 'a' },
    ])
    expect(t.extra_skills).toEqual(['skill-one'])
    expect(t.runner_max_attempts).toBe(5)
    // runner_attempts defaults to 0 per migration 056's NOT NULL DEFAULT 0.
    expect(t.runner_attempts).toBe(0)
  })

  it('excludes quality_review recipe tasks that already have an open review PR gate', async () => {
    asRunner()
    seedRecipeWithReview('reviewable')
    const waitingOnPrId = seedTask({
      title: 'waiting-on-pr',
      status: 'quality_review',
      recipe_slug: 'reviewable',
    })
    seedOpenReviewPr(waitingOnPrId)
    const stillNeedsReviewId = seedTask({
      title: 'needs-review',
      status: 'quality_review',
      recipe_slug: 'reviewable',
    })

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.tasks.map((t: { id: number }) => t.id)).toEqual([stillNeedsReviewId])
  })

  it('RUNNER-04: rejects non-runner-secret bearer with 403 (id-guard)', async () => {
    asOperatorSessionUser()

    seedTask({ title: 'claimable', status: 'assigned', recipe_slug: 'wt-recipe' })

    const res = await GET(makeGet())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/runner-secret/i)
  })
})
