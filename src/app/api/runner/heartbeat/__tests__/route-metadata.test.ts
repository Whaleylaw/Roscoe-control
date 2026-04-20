/**
 * Tests for Phase 15-06 Task 2: runner heartbeat metadata.active_task_ids.
 *
 * Schema change:
 *   - HeartbeatMetadataSchema is now an explicit .object({ active_task_ids }).passthrough()
 *   - active_task_ids MUST be an array of positive integers when present
 *   - Additional keys are preserved (passthrough) so the daemon can evolve
 *
 * Data flow:
 *   - Daemon (scripts/mc-runner.mjs) sends metadata.active_task_ids on every heartbeat
 *   - MC persists the full metadata object into runner_heartbeats.metadata_json
 *   - Plan 15-02 requeueStaleTasks reads that column, JSON.parses it, and
 *     checks Set membership against in_progress tasks assigned to the runner
 *
 * Same mock pattern as route.test.ts (in-memory better-sqlite3 + vi.mock).
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

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Imports AFTER mocks so the route binds to the mocks.
import { POST } from '@/app/api/runner/heartbeat/route'

function asRunner() {
  requireRoleMock.mockReturnValueOnce({
    user: {
      id: -1000,
      username: 'runner',
      display_name: 'Runner Daemon',
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
      display_name: 'Tester',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
    },
  })
}

function makePost(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/runner/heartbeat', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    body: JSON.stringify(body),
  })
}

function readMetadataJson(runnerId: string): string | null {
  const row = testDb
    .prepare(`SELECT metadata_json FROM runner_heartbeats WHERE runner_id = ?`)
    .get(runnerId) as { metadata_json: string | null } | undefined
  return row?.metadata_json ?? null
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  requireRoleMock.mockReset()
})

describe('POST /api/runner/heartbeat — metadata.active_task_ids (Plan 15-06 Task 2)', () => {
  it('SCHED-03: accepts active_task_ids as positive integer array and persists to metadata_json', async () => {
    asRunner()
    const res = await POST(
      makePost({
        runner_id: 'runner-with-tasks',
        ts: 1_700_000_000_000,
        metadata: { active_task_ids: [1, 2, 3] },
      }),
    )
    expect(res.status).toBe(204)

    const metadataJson = readMetadataJson('runner-with-tasks')
    expect(metadataJson).toBe('{"active_task_ids":[1,2,3]}')

    // Round-trip parse as requeueStaleTasks would.
    const parsed = JSON.parse(metadataJson!) as { active_task_ids: number[] }
    expect(parsed.active_task_ids).toEqual([1, 2, 3])
  })

  it('SCHED-03: accepts empty metadata object (runner alive, no active tasks)', async () => {
    asRunner()
    const res = await POST(
      makePost({
        runner_id: 'runner-idle',
        ts: 1_700_000_000_000,
        metadata: {},
      }),
    )
    expect(res.status).toBe(204)

    const metadataJson = readMetadataJson('runner-idle')
    expect(metadataJson).toBe('{}')
  })

  it('SCHED-03: accepts heartbeat without metadata field (regression against existing shape)', async () => {
    asRunner()
    const res = await POST(
      makePost({
        runner_id: 'runner-no-metadata',
        ts: 1_700_000_000_000,
      }),
    )
    expect(res.status).toBe(204)

    // metadata_json should be null when no metadata was sent (per existing
    // route: `metadata ? JSON.stringify(metadata) : null`).
    const metadataJson = readMetadataJson('runner-no-metadata')
    expect(metadataJson).toBeNull()
  })

  it('SCHED-03: rejects active_task_ids containing non-number values with 400', async () => {
    asRunner()
    const res = await POST(
      makePost({
        runner_id: 'runner-bad-types',
        ts: 1_700_000_000_000,
        metadata: { active_task_ids: ['not-a-number'] },
      }),
    )
    expect(res.status).toBe(400)

    const body = (await res.json()) as { error: string; issues?: unknown }
    expect(body.error).toMatch(/invalid heartbeat/i)

    const row = testDb
      .prepare(`SELECT COUNT(*) AS n FROM runner_heartbeats WHERE runner_id = ?`)
      .get('runner-bad-types') as { n: number }
    expect(row.n).toBe(0)
  })

  it('SCHED-03: rejects active_task_ids containing non-positive integers with 400', async () => {
    asRunner()
    const res = await POST(
      makePost({
        runner_id: 'runner-negative',
        ts: 1_700_000_000_000,
        metadata: { active_task_ids: [-1] },
      }),
    )
    expect(res.status).toBe(400)

    const row = testDb
      .prepare(`SELECT COUNT(*) AS n FROM runner_heartbeats WHERE runner_id = ?`)
      .get('runner-negative') as { n: number }
    expect(row.n).toBe(0)
  })

  it('SCHED-03: passthrough preserves additional metadata keys alongside active_task_ids', async () => {
    asRunner()
    const res = await POST(
      makePost({
        runner_id: 'runner-passthrough',
        ts: 1_700_000_000_000,
        metadata: { active_task_ids: [1], custom_field: 'foo' },
      }),
    )
    expect(res.status).toBe(204)

    const metadataJson = readMetadataJson('runner-passthrough')
    expect(metadataJson).not.toBeNull()

    const parsed = JSON.parse(metadataJson!) as {
      active_task_ids: number[]
      custom_field: string
    }
    expect(parsed.active_task_ids).toEqual([1])
    expect(parsed.custom_field).toBe('foo')
  })

  it('SCHED-03: non-runner-secret principal rejected with 403 (metadata change does not loosen auth)', async () => {
    asOperatorSessionUser()
    const res = await POST(
      makePost({
        runner_id: 'runner-unauthorized',
        ts: 1_700_000_000_000,
        metadata: { active_task_ids: [1] },
      }),
    )
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/runner-secret/i)

    const row = testDb
      .prepare(`SELECT COUNT(*) AS n FROM runner_heartbeats WHERE runner_id = ?`)
      .get('runner-unauthorized') as { n: number }
    expect(row.n).toBe(0)
  })

  it('SCHED-03: active_task_ids rejects floating-point values (positive int constraint)', async () => {
    asRunner()
    const res = await POST(
      makePost({
        runner_id: 'runner-float',
        ts: 1_700_000_000_000,
        metadata: { active_task_ids: [1.5] },
      }),
    )
    expect(res.status).toBe(400)
  })
})
