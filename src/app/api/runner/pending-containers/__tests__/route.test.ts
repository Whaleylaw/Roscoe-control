/**
 * Tests for GET /api/runner/pending-containers (Plan 14-04).
 *
 * Wave-0 stubs replaced with real bodies. In-memory sqlite + mocked auth/db
 * mirror the heartbeat + ready-tasks test files.
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

import { GET } from '@/app/api/runner/pending-containers/route'

function asRunner() {
  requireRoleMock.mockReturnValueOnce({
    user: { id: -1000, username: 'runner', role: 'operator', workspace_id: 1, tenant_id: 1 },
  })
}

function asOperatorSessionUser() {
  requireRoleMock.mockReturnValueOnce({
    user: { id: 7, username: 'tester', role: 'operator', workspace_id: 1, tenant_id: 1 },
  })
}

function makeGet(): NextRequest {
  return new NextRequest('http://localhost/api/runner/pending-containers', { method: 'GET' })
}

function seed(
  title: string,
  status: string,
  container_id: string | null,
  recipe_slug: string | null = 'wt',
  runner_started_at: number | null = null,
): number {
  const { lastInsertRowid } = testDb
    .prepare(
      `INSERT INTO tasks (title, status, recipe_slug, container_id, runner_started_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(title, status, recipe_slug, container_id, runner_started_at)
  return Number(lastInsertRowid)
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  requireRoleMock.mockReset()
})

describe('GET /api/runner/pending-containers', () => {
  it('RUNNER-13: returns tasks with container_id IS NOT NULL AND status IN (assigned, in_progress)', async () => {
    asRunner()

    const assignedId = seed('assigned-with-container', 'assigned', 'mc-task-1-a1', 'wt', 1000)
    const inProgressId = seed('in-progress-with-container', 'in_progress', 'mc-task-2-a1', 'wt', 1100)
    // Excluded: no container_id.
    seed('assigned-no-container', 'assigned', null)
    // Excluded: terminal status.
    seed('done-with-container', 'done', 'mc-task-3-a1')
    seed('failed-with-container', 'failed', 'mc-task-4-a1')

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()

    const ids = body.tasks.map((t: { id: number }) => t.id).sort((a: number, b: number) => a - b)
    expect(ids).toEqual([assignedId, inProgressId].sort((a, b) => a - b))

    const first = body.tasks.find((t: { id: number }) => t.id === assignedId)
    expect(first).toMatchObject({
      container_id: 'mc-task-1-a1',
      status: 'assigned',
      recipe_slug: 'wt',
      runner_started_at: 1000,
      runner_attempts: 0,
    })
  })

  it('RUNNER-13: excludes tasks in terminal status (done, failed, cancelled) even with container_id', async () => {
    asRunner()

    // All three terminal states with containers still attributed — none should come back.
    seed('done', 'done', 'mc-task-9-a1')
    seed('failed', 'failed', 'mc-task-10-a1')
    seed('cancelled', 'cancelled', 'mc-task-11-a1')

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tasks).toEqual([])
  })

  it('RUNNER-13: rejects non-runner-secret bearer with 403 (id-guard)', async () => {
    asOperatorSessionUser()

    seed('assigned-with-container', 'assigned', 'mc-task-1-a1')

    const res = await GET(makeGet())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/runner-secret/i)
  })
})
