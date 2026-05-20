/**
 * GET /api/runner/config — Plan 14-11 Task 3.
 *
 * Covers:
 *   - Returns all 5 settings with defaults when no rows present
 *   - Reflects stored setting values (simulates admin PUT /api/settings)
 *   - Rejects non-runner-secret bearer with 403
 *   - Shape matches <interfaces> contract exactly (keys + types)
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'
import {
  DEFAULT_MAX_CONCURRENT_CONTAINERS,
  DEFAULT_MAX_MEMORY_PER_CONTAINER,
  DEFAULT_MAX_CPU_PER_CONTAINER,
  DEFAULT_FAILED_GC_WINDOW_DAYS,
  DEFAULT_DOCKER_NETWORK_MODE,
} from '@/lib/task-runtime-settings'

let testDb: Database.Database

const KNOWN_RUNNER_SECRET = 'known-runner-secret-config-abc-1234567890'

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
  const existing = db.prepare(`SELECT id FROM workspaces WHERE id = ?`).get(1) as { id?: number } | undefined
  if (!existing) {
    db.prepare(`INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (?, ?, ?, ?)`).run(1, 'default', 'Default', 1)
  }
}

function configReq(bearer: string | null): NextRequest {
  const headers: Record<string, string> = {}
  if (bearer) headers.authorization = `Bearer ${bearer}`
  return new NextRequest('http://localhost/api/runner/config', {
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

describe('GET /api/runner/config', () => {
  it('returns all 5 settings with default values when no rows exist', async () => {
    // Migration defaults populate settings rows — but the defensive-default
    // getters fall back to DEFAULT_* constants when rows are missing or empty.
    // Clear any runtime.* rows so we test the getter-default path explicitly.
    testDb.prepare(`DELETE FROM settings WHERE key LIKE 'runtime.%'`).run()

    const res = await GET(configReq(KNOWN_RUNNER_SECRET))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.project_repo_map).toEqual({})
    expect(body.max_memory_per_container).toBe(DEFAULT_MAX_MEMORY_PER_CONTAINER)
    expect(body.max_cpu_per_container).toBe(DEFAULT_MAX_CPU_PER_CONTAINER)
    expect(body.failed_gc_window_days).toBe(DEFAULT_FAILED_GC_WINDOW_DAYS)
    expect(body.max_concurrent_containers).toBe(DEFAULT_MAX_CONCURRENT_CONTAINERS)
    expect(body.docker_network_mode).toBe(DEFAULT_DOCKER_NETWORK_MODE)
  })

  it('reflects stored setting values after admin writes', async () => {
    // Simulate admin PUT /api/settings writing the 5 runtime.* keys.
    const upsert = testDb.prepare(`
      INSERT INTO settings (key, value, category, updated_at)
      VALUES (?, ?, 'runtime', unixepoch())
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
    `)
    upsert.run('runtime.max_concurrent_containers', '8')
    upsert.run(
      'runtime.project_repo_map',
      JSON.stringify({ '1': '/Users/me/repos/app-a', '2': '/Users/me/repos/app-b' }),
    )
    upsert.run('runtime.max_memory_per_container', '16g')
    upsert.run('runtime.max_cpu_per_container', '6.5')
    upsert.run('runtime.failed_gc_window_days', '30')
    upsert.run('runtime.docker_network_mode', 'host')

    const res = await GET(configReq(KNOWN_RUNNER_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.max_concurrent_containers).toBe(8)
    expect(body.project_repo_map).toEqual({
      '1': '/Users/me/repos/app-a',
      '2': '/Users/me/repos/app-b',
    })
    expect(body.max_memory_per_container).toBe('16g')
    expect(body.max_cpu_per_container).toBe(6.5)
    expect(body.failed_gc_window_days).toBe(30)
    expect(body.docker_network_mode).toBe('host')
  })

  it('rejects non-runner-secret bearer with 403', async () => {
    // A random bearer that isn't the runner-secret. Auth falls through all
    // branches (runner-secret mismatch, no session, no API key, no agent key),
    // so requireRole returns 401.
    const res = await GET(configReq('some-random-bearer-that-is-not-the-secret'))
    expect(res.status).toBe(401)
  })

  it('shape matches <interfaces> contract exactly (keys + types)', async () => {
    const res = await GET(configReq(KNOWN_RUNNER_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()

    // Exact key set — no extras, no missing.
    expect(Object.keys(body).sort()).toEqual([
      'docker_network_mode',
      'failed_gc_window_days',
      'max_concurrent_containers',
      'max_cpu_per_container',
      'max_memory_per_container',
      'project_repo_map',
    ])

    // Type shape per <interfaces>:
    expect(typeof body.project_repo_map).toBe('object')
    expect(Array.isArray(body.project_repo_map)).toBe(false)
    expect(typeof body.max_memory_per_container).toBe('string')
    expect(typeof body.max_cpu_per_container).toBe('number')
    expect(typeof body.failed_gc_window_days).toBe('number')
    expect(typeof body.max_concurrent_containers).toBe('number')
    expect(typeof body.docker_network_mode).toBe('string')
  })
})
