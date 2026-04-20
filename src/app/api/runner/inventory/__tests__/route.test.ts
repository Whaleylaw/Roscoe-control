/**
 * Tests for GET /api/runner/inventory (Plan 15-06 Task 3).
 *
 * Read-through observability endpoint over runner_heartbeats.metadata_json.
 * Auth model: runner-SECRET principal (id=-1000) ONLY.
 *   - Runner-TOKEN (id=-2000) is task-scoped and not allowlisted for this
 *     path → auth layer rejects at 401 before the id-check runs.
 *   - Session/API-key users 401 or 403 (same pattern as /api/runner/config).
 *
 * Stale window: 90s (LOCKED per 15-CONTEXT.md § Heartbeat & Stale Detection,
 * 3× 30s reconcile tick).
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import { issueRunnerToken } from '@/lib/runner-tokens'

let testDb: Database.Database

const KNOWN_RUNNER_SECRET = 'known-runner-secret-inventory-abc-1234567890'

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    logActivity: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    createNotification: vi.fn(),
  },
}))

vi.mock('@/lib/runner-secret', () => ({
  getRunnerSecret: () => KNOWN_RUNNER_SECRET,
  ensureRunnerSecret: vi.fn(() => KNOWN_RUNNER_SECRET),
  RUNNER_SECRET_FILENAME: '.data/runner.secret',
}))

vi.mock('@/lib/security-events', () => ({ logSecurityEvent: vi.fn() }))
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

const { GET } = await import('../route')

function seedWorkspace(db: Database.Database): void {
  const existing = db
    .prepare(`SELECT id FROM workspaces WHERE id = ?`)
    .get(1) as { id?: number } | undefined
  if (!existing) {
    db.prepare(
      `INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (?, ?, ?, ?)`,
    ).run(1, 'default', 'Default', 1)
  }
}

function seedTask(db: Database.Database, id: number): void {
  db.prepare(
    `INSERT INTO tasks (id, title, status, priority, workspace_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, `task ${id}`, 'in_progress', 'medium', 1)
}

function seedHeartbeat(
  db: Database.Database,
  runnerId: string,
  lastHeartbeatAt: number,
  metadataJson: string | null,
): void {
  db.prepare(
    `INSERT INTO runner_heartbeats (runner_id, last_heartbeat_at, registered_at, metadata_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(runner_id) DO UPDATE SET
       last_heartbeat_at = excluded.last_heartbeat_at,
       metadata_json = excluded.metadata_json`,
  ).run(runnerId, lastHeartbeatAt, lastHeartbeatAt, metadataJson)
}

function inventoryReq(bearer: string | null): NextRequest {
  const headers: Record<string, string> = {}
  if (bearer) headers.authorization = `Bearer ${bearer}`
  return new NextRequest('http://localhost/api/runner/inventory', {
    method: 'GET',
    headers,
  })
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  seedWorkspace(testDb)
  process.env.API_KEY = ''
  process.env.MC_PROXY_AUTH_HEADER = ''
})

afterEach(() => {
  testDb.close()
})

describe('GET /api/runner/inventory', () => {
  it('SCHED-03: runner-secret caller sees fresh heartbeat active_task_ids', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    seedHeartbeat(
      testDb,
      'runner-main',
      nowSec - 5,
      JSON.stringify({ active_task_ids: [1, 2, 3] }),
    )

    const res = await GET(inventoryReq(KNOWN_RUNNER_SECRET))
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      runner_id: string | null
      last_heartbeat_at: number | null
      active_task_ids: number[]
      stale: boolean
    }
    expect(body.runner_id).toBe('runner-main')
    expect(body.last_heartbeat_at).toBe(nowSec - 5)
    expect(body.active_task_ids).toEqual([1, 2, 3])
    expect(body.stale).toBe(false)
  })

  it('SCHED-03: no fresh heartbeat → stale=true, empty array', async () => {
    // Seed a heartbeat older than the 90s stale window.
    const nowSec = Math.floor(Date.now() / 1000)
    seedHeartbeat(
      testDb,
      'runner-old',
      nowSec - 600,
      JSON.stringify({ active_task_ids: [1, 2] }),
    )

    const res = await GET(inventoryReq(KNOWN_RUNNER_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      runner_id: null,
      last_heartbeat_at: null,
      active_task_ids: [],
      stale: true,
    })
  })

  it('SCHED-03: malformed metadata_json → active_task_ids = [], stale = false', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    seedHeartbeat(testDb, 'runner-bad-meta', nowSec - 5, '{not valid json')

    const res = await GET(inventoryReq(KNOWN_RUNNER_SECRET))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      runner_id: string
      active_task_ids: number[]
      stale: boolean
    }
    expect(body.runner_id).toBe('runner-bad-meta')
    expect(body.active_task_ids).toEqual([])
    expect(body.stale).toBe(false)
  })

  it('SCHED-03: filters out non-positive / non-number values from active_task_ids', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    // Heartbeat endpoint's schema would reject this body, but we seed the raw
    // row to prove the GET handler is also defensive on read.
    seedHeartbeat(
      testDb,
      'runner-dirty',
      nowSec - 5,
      JSON.stringify({ active_task_ids: [1, 'string', -1, 2.5, 0, 4, null] }),
    )

    const res = await GET(inventoryReq(KNOWN_RUNNER_SECRET))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { active_task_ids: number[] }
    // Only 1, 2.5 (finite-positive-number), and 4 survive the filter; 2.5 is
    // preserved because the filter is "finite positive number" — validation
    // of integer-ness lives in the write-path schema, not here.
    expect(body.active_task_ids).toEqual([1, 2.5, 4])
  })

  it('SCHED-03: runner-token principal rejected (401 — path not in allowlist)', async () => {
    // Runner-token is NOT allowlisted for /api/runner/inventory (only the
    // checkpoints/submit/etc. paths are). Auth falls through to 401.
    seedTask(testDb, 42)
    const { token } = issueRunnerToken(testDb, 42, 1, 300)

    const res = await GET(inventoryReq(token))
    expect(res.status).toBe(401)
  })

  it('SCHED-03: unauthenticated request → 401', async () => {
    const res = await GET(inventoryReq(null))
    expect(res.status).toBe(401)
  })

  it('SCHED-03: prefers the freshest heartbeat when multiple runners are live', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    seedHeartbeat(
      testDb,
      'runner-older',
      nowSec - 60,
      JSON.stringify({ active_task_ids: [10, 11] }),
    )
    seedHeartbeat(
      testDb,
      'runner-newer',
      nowSec - 5,
      JSON.stringify({ active_task_ids: [99] }),
    )

    const res = await GET(inventoryReq(KNOWN_RUNNER_SECRET))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runner_id: string; active_task_ids: number[] }
    expect(body.runner_id).toBe('runner-newer')
    expect(body.active_task_ids).toEqual([99])
  })
})
