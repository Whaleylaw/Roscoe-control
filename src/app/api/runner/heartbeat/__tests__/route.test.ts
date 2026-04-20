/**
 * Tests for POST /api/runner/heartbeat (Plan 14-04).
 *
 * Each it() corresponds to a Wave-0 stub from 14-03 (see Test Map in
 * 14-RESEARCH.md). In-memory better-sqlite3 + vi.mock pattern matches
 * src/app/api/tasks/__tests__/route.runtime-context.test.ts.
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

// requireRole is set per-test via requireRoleMock.mockReturnValueOnce.
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

// Imports AFTER mocks so the route picks them up.
import { POST } from '@/app/api/runner/heartbeat/route'
import { mutationLimiter } from '@/lib/rate-limit'

function asRunner() {
  // Matches the runner-secret branch in src/lib/auth.ts — id=-1000.
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
  // Real user via session cookie / API key — NOT the runner principal.
  // Route should 403 at the id-guard.
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

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  runMigrations(testDb)
  requireRoleMock.mockReset()
  vi.mocked(mutationLimiter).mockReset()
  vi.mocked(mutationLimiter).mockReturnValue(null)
})

describe('POST /api/runner/heartbeat', () => {
  it('RUNNER-05: accepts runner_id + ts, upserts runner_heartbeats row with last_heartbeat_at', async () => {
    asRunner()

    const tsMs = 1_700_000_000_000
    const res = await POST(
      makePost({ runner_id: 'runner-1', ts: tsMs, metadata: { host: 'mac' } }),
    )

    expect(res.status).toBe(204)

    const row = testDb
      .prepare(
        `SELECT runner_id, last_heartbeat_at, registered_at, metadata_json
         FROM runner_heartbeats WHERE runner_id = ?`,
      )
      .get('runner-1') as
      | { runner_id: string; last_heartbeat_at: number; registered_at: number; metadata_json: string | null }
      | undefined

    expect(row).toBeDefined()
    // ms → seconds conversion.
    expect(row!.last_heartbeat_at).toBe(Math.floor(tsMs / 1000))
    // First insert: registered_at matches last_heartbeat_at.
    expect(row!.registered_at).toBe(Math.floor(tsMs / 1000))
    expect(row!.metadata_json).toBe('{"host":"mac"}')

    // UPSERT: second call with later ts updates last_heartbeat_at but preserves registered_at.
    asRunner()
    const tsMs2 = tsMs + 30_000
    const res2 = await POST(
      makePost({ runner_id: 'runner-1', ts: tsMs2 }),
    )
    expect(res2.status).toBe(204)

    const row2 = testDb
      .prepare(
        `SELECT last_heartbeat_at, registered_at, metadata_json
         FROM runner_heartbeats WHERE runner_id = ?`,
      )
      .get('runner-1') as
      | { last_heartbeat_at: number; registered_at: number; metadata_json: string | null }

    expect(row2.last_heartbeat_at).toBe(Math.floor(tsMs2 / 1000))
    // registered_at NOT overwritten.
    expect(row2.registered_at).toBe(Math.floor(tsMs / 1000))
    // Omitted metadata → null persisted.
    expect(row2.metadata_json).toBeNull()
  })

  it('RUNNER-05: rejects requests missing Authorization: Bearer header with 401', async () => {
    // requireRole returns a 401 error object when no bearer is present (matches
    // the real auth.ts behaviour on /api/runner/* with no Authorization header).
    requireRoleMock.mockReturnValueOnce({ error: 'Authentication required', status: 401 })

    const res = await POST(
      makePost({ runner_id: 'runner-1', ts: Date.now() }),
    )

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/auth/i)

    // No row persisted.
    const count = testDb
      .prepare('SELECT COUNT(*) AS n FROM runner_heartbeats')
      .get() as { n: number }
    expect(count.n).toBe(0)
  })

  it('RUNNER-05: rejects bearer that is not the runner-secret with 403 (id-guard)', async () => {
    // Session-cookie / API-key user gets past requireRole('operator') but fails
    // the user.id === -1000 guard in the route.
    asOperatorSessionUser()

    const res = await POST(
      makePost({ runner_id: 'runner-1', ts: Date.now() }),
    )

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/runner-secret/i)

    const count = testDb
      .prepare('SELECT COUNT(*) AS n FROM runner_heartbeats')
      .get() as { n: number }
    expect(count.n).toBe(0)
  })

  it('RUNNER-05: mutationLimiter is invoked before DB work (rate-limit hookup)', async () => {
    // The limiter is an IP-bucket function that is hard to exercise deterministically
    // across a jsdom test — the contract we pin here is that it's invoked AFTER auth
    // and BEFORE the DB write. Asserting via the mock (a) proves it's wired in the
    // right order, (b) proves the route short-circuits when the limiter returns a
    // NextResponse (429), both of which are the behaviours runner-daemon operators
    // need to trust.

    // (a) When limiter returns null, request proceeds.
    asRunner()
    const okRes = await POST(
      makePost({ runner_id: 'runner-limit-ok', ts: 1_700_000_000_000 }),
    )
    expect(okRes.status).toBe(204)
    expect(mutationLimiter).toHaveBeenCalledTimes(1)

    // (b) When limiter returns a 429 response, route short-circuits and does NOT write.
    const rateLimited = new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    })
    vi.mocked(mutationLimiter).mockReturnValueOnce(rateLimited as unknown as Response & {
      // satisfy NextResponse union without pulling in next/server here
    })
    asRunner()
    const blockedRes = await POST(
      makePost({ runner_id: 'runner-limit-blocked', ts: 1_700_000_000_000 }),
    )
    expect(blockedRes.status).toBe(429)

    // Only the first (ok) call wrote a row.
    const rows = testDb
      .prepare('SELECT runner_id FROM runner_heartbeats ORDER BY runner_id')
      .all() as Array<{ runner_id: string }>
    expect(rows).toEqual([{ runner_id: 'runner-limit-ok' }])
  })
})
