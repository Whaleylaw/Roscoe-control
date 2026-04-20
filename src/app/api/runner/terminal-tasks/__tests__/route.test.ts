/**
 * Tests for GET /api/runner/terminal-tasks (Plan 14-04).
 *
 * Wave-0 stubs replaced with real bodies. In-memory sqlite + mocked auth/db
 * mirror the heartbeat / ready-tasks / pending-containers test files.
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

import { GET } from '@/app/api/runner/terminal-tasks/route'

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

function makeGet(since?: string): NextRequest {
  const url = since
    ? `http://localhost/api/runner/terminal-tasks?since=${encodeURIComponent(since)}`
    : `http://localhost/api/runner/terminal-tasks`
  return new NextRequest(url, { method: 'GET' })
}

function seed(title: string, status: string, updatedAtSec: number): number {
  // Set updated_at explicitly so the test pins the filter condition.
  const { lastInsertRowid } = testDb
    .prepare(
      `INSERT INTO tasks (title, status, updated_at) VALUES (?, ?, ?)`,
    )
    .run(title, status, updatedAtSec)
  return Number(lastInsertRowid)
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  requireRoleMock.mockReset()
})

describe('GET /api/runner/terminal-tasks', () => {
  it('WORK-07: returns tasks terminal since ?since=<iso8601>', async () => {
    asRunner()

    // Cutoff — tasks updated at >= cutoff in terminal status get returned.
    const cutoffIso = '2026-04-20T18:00:00Z'
    const cutoffSec = Math.floor(Date.parse(cutoffIso) / 1000)

    const doneAfterId = seed('done-after', 'done', cutoffSec + 60)
    const failedAfterId = seed('failed-after', 'failed', cutoffSec + 120)
    // Excluded: terminal but BEFORE the cutoff.
    seed('done-before', 'done', cutoffSec - 600)
    // Excluded: not-terminal, even though after the cutoff.
    seed('in-progress-after', 'in_progress', cutoffSec + 30)

    const res = await GET(makeGet(cutoffIso))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.tasks).toHaveLength(2)
    // ORDER BY updated_at ASC → done-after (cutoff+60) before failed-after (cutoff+120).
    expect(body.tasks.map((t: { task_id: number }) => t.task_id)).toEqual([
      doneAfterId,
      failedAfterId,
    ])
    expect(body.tasks[0]).toEqual({
      task_id: doneAfterId,
      status: 'done',
      terminal_at: cutoffSec + 60,
    })
    expect(body.tasks[1]).toEqual({
      task_id: failedAfterId,
      status: 'failed',
      terminal_at: cutoffSec + 120,
    })
  })

  it('WORK-07: omits non-terminal tasks even if updated recently', async () => {
    asRunner()

    const cutoffIso = '2026-04-20T18:00:00Z'
    const cutoffSec = Math.floor(Date.parse(cutoffIso) / 1000)

    // All non-terminal — must NOT appear regardless of recency.
    seed('assigned', 'assigned', cutoffSec + 60)
    seed('in-progress', 'in_progress', cutoffSec + 90)
    seed('review', 'review', cutoffSec + 120)
    seed('inbox', 'inbox', cutoffSec + 150)

    // One terminal-after to confirm the filter is correct (not "always empty").
    const cancelledId = seed('cancelled', 'cancelled', cutoffSec + 180)

    const res = await GET(makeGet(cutoffIso))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0]).toEqual({
      task_id: cancelledId,
      status: 'cancelled',
      terminal_at: cutoffSec + 180,
    })
  })

  it('WORK-07: rejects non-runner-secret bearer with 403 (id-guard)', async () => {
    asOperatorSessionUser()

    const res = await GET(makeGet('2026-04-20T00:00:00Z'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/runner-secret/i)
  })

  it('WORK-07: returns 400 when ?since= is missing or not ISO 8601', async () => {
    // Missing.
    asRunner()
    const resMissing = await GET(makeGet())
    expect(resMissing.status).toBe(400)
    const bodyMissing = await resMissing.json()
    expect(bodyMissing.error).toMatch(/since/i)

    // Malformed (garbage string).
    asRunner()
    const resBad = await GET(makeGet('not-a-date'))
    expect(resBad.status).toBe(400)
    const bodyBad = await resBad.json()
    expect(bodyBad.error).toMatch(/iso 8601/i)
  })
})
