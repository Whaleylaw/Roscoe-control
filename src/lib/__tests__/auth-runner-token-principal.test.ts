import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Runner-secret mock — unused in these tests but must not throw when auth.ts imports it.
vi.mock('@/lib/runner-secret', () => ({
  getRunnerSecret: () => null,
  ensureRunnerSecret: vi.fn(() => ''),
  RUNNER_SECRET_FILENAME: '.data/runner.secret',
}))

// Capture logSecurityEvent calls so real side effects don't hit the (unmocked) DB.
const logSpy = vi.fn()
vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: (...args: unknown[]) => logSpy(...args),
}))

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn((p: string) => `hashed:${p}`),
  verifyPassword: vi.fn(() => false),
  verifyPasswordWithRehashCheck: vi.fn(() => ({ valid: false, needsRehash: false })),
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

// Real in-memory DB — shared across test setup + auth.ts lookups.
// We swap its contents per-test via beforeEach. The mock for @/lib/db returns it.
let testDb: Database.Database

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    createNotification: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    logActivity: vi.fn(),
  },
}))

// Import AFTER mocks are set up so the module picks them up.
import { runMigrations } from '@/lib/migrations'
import { issueRunnerToken, revokeTokensForTask } from '@/lib/runner-tokens'
import { getUserFromRequest, requireRunnerToken } from '@/lib/auth'

function makeRequest(
  pathname: string,
  headers: Record<string, string> = {},
  method = 'POST',
): Request {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: new Headers(headers),
  })
}

function seedTask(db: Database.Database, id: number): void {
  db.prepare(`INSERT INTO tasks (id, title, status, priority, workspace_id) VALUES (?, ?, ?, ?, ?)`)
    .run(id, `task ${id}`, 'inbox', 'medium', 1)
}

function seedWorkspace(db: Database.Database): void {
  // getDefaultWorkspaceContext() reads from workspaces; ensure a row exists so it
  // returns { id: 1, tenant_id: 1 } deterministically instead of defaulting.
  const existing = db.prepare(`SELECT id FROM workspaces WHERE id = ?`).get(1) as { id?: number } | undefined
  if (!existing) {
    db.prepare(`INSERT OR IGNORE INTO workspaces (id, slug, name, tenant_id) VALUES (?, ?, ?, ?)`).run(
      1, 'default', 'Default', 1,
    )
  }
}

describe('runner-token auth', () => {
  const originalEnv = process.env

  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.pragma('foreign_keys = ON')
    runMigrations(testDb)
    seedWorkspace(testDb)
    seedTask(testDb, 5)
    process.env = { ...originalEnv, API_KEY: '', MC_PROXY_AUTH_HEADER: '' }
    logSpy.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
    testDb.close()
  })

  // -------------------------------------------------------------------------
  // Part A — getUserFromRequest branch tests
  // -------------------------------------------------------------------------
  describe('getUserFromRequest — runner-token branch', () => {
    it('POST /api/runner/tasks/5/checkpoints with valid token → runner-token principal', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/5/checkpoints', { authorization: `Bearer ${token}` }, 'POST'),
      )
      expect(user).not.toBeNull()
      expect(user!.username).toBe('runner-token')
      expect(user!.role).toBe('operator')
      expect(user!.id).toBe(-2000)
      expect(user!.display_name).toBe('Runner Token')
      expect(user!.runner_token_task_id).toBe(5)
    })

    it('POST /api/runner/tasks/5/submit with same token → runner-token principal', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/5/submit', { authorization: `Bearer ${token}` }, 'POST'),
      )
      expect(user).not.toBeNull()
      expect(user!.username).toBe('runner-token')
      expect(user!.runner_token_task_id).toBe(5)
    })

    it('POST /api/runner/tasks/5/fail with same token → runner-token principal', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/5/fail', { authorization: `Bearer ${token}` }, 'POST'),
      )
      expect(user).not.toBeNull()
      expect(user!.username).toBe('runner-token')
    })

    it('GET /api/runner/tasks/5 → runner-token principal', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/5', { authorization: `Bearer ${token}` }, 'GET'),
      )
      expect(user).not.toBeNull()
      expect(user!.username).toBe('runner-token')
    })

    it('GET /api/runner/tasks/5/status → runner-token principal', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/5/status', { authorization: `Bearer ${token}` }, 'GET'),
      )
      expect(user).not.toBeNull()
      expect(user!.username).toBe('runner-token')
    })

    it('GET /api/runner/tasks/5/comments → runner-token principal', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/5/comments', { authorization: `Bearer ${token}` }, 'GET'),
      )
      expect(user).not.toBeNull()
      expect(user!.username).toBe('runner-token')
    })

    it('cross-task: token for task 5 on /api/runner/tasks/99/checkpoints → null (NOT 403 here; that is requireRunnerToken’s job)', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      seedTask(testDb, 99)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/99/checkpoints', { authorization: `Bearer ${token}` }, 'POST'),
      )
      expect(user).toBeNull()
    })

    it('POST /api/runner/claim/5 (not on allowlist) → null', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/runner/claim/5', { authorization: `Bearer ${token}` }, 'POST'),
      )
      expect(user).toBeNull()
    })

    it('POST /api/runner/ready-tasks (not on allowlist) → null', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/runner/ready-tasks', { authorization: `Bearer ${token}` }, 'POST'),
      )
      expect(user).toBeNull()
    })

    it('DELETE /api/runner/tasks/5 (method not on allowlist) → null', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/5', { authorization: `Bearer ${token}` }, 'DELETE'),
      )
      expect(user).toBeNull()
    })

    it('POST /api/tas/5 (outside /api/runner/*) → null', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/tasks/5', { authorization: `Bearer ${token}` }, 'POST'),
      )
      expect(user).toBeNull()
    })

    it('bogus bearer → null', () => {
      issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/5/checkpoints', { authorization: 'Bearer bogus-value' }, 'POST'),
      )
      expect(user).toBeNull()
    })

    it('no auth header → null', () => {
      issueRunnerToken(testDb, 5, 1, 300)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/5/checkpoints', {}, 'POST'),
      )
      expect(user).toBeNull()
    })

    it('expired token → null (expiry enforced at arrival)', () => {
      // runnerStartedAtUnix = now - 3600; timeoutSeconds = 60 → expires_at = now - 3540
      const nowSec = Math.floor(Date.now() / 1000)
      const { token } = issueRunnerToken(testDb, 5, 1, 60, nowSec - 3600)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/5/checkpoints', { authorization: `Bearer ${token}` }, 'POST'),
      )
      expect(user).toBeNull()
    })

    it('revoked token → null', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      revokeTokensForTask(testDb, 5)
      const user = getUserFromRequest(
        makeRequest('/api/runner/tasks/5/checkpoints', { authorization: `Bearer ${token}` }, 'POST'),
      )
      expect(user).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Part B — requireRunnerToken wrapper tests (401 vs 403)
  // -------------------------------------------------------------------------
  describe('requireRunnerToken — 401 vs 403 discrimination', () => {
    it('happy path: valid token for task 5, taskId=5 → { user } with runner_token_task_id=5', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const result = requireRunnerToken(
        makeRequest('/api/runner/tasks/5/checkpoints', { authorization: `Bearer ${token}` }, 'POST'),
        5,
      )
      expect('error' in result).toBe(false)
      if (!('error' in result)) {
        expect(result.user.username).toBe('runner-token')
        expect(result.user.runner_token_task_id).toBe(5)
        expect(result.user.role).toBe('operator')
      }
    })

    it('cross-task 403 (path): token for task 5 on /api/runner/tasks/99/checkpoints, taskId=99 → 403 not 401', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      seedTask(testDb, 99)
      const result = requireRunnerToken(
        makeRequest('/api/runner/tasks/99/checkpoints', { authorization: `Bearer ${token}` }, 'POST'),
        99,
      )
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.status).toBe(403)
        expect(result.status).not.toBe(401)
      }
    })

    it('cross-task 403 (caller param): token for task 5 on /api/runner/tasks/5/checkpoints, but caller passes taskId=999 → 403', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const result = requireRunnerToken(
        makeRequest('/api/runner/tasks/5/checkpoints', { authorization: `Bearer ${token}` }, 'POST'),
        999,
      )
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.status).toBe(403)
      }
    })

    it('no bearer → 401', () => {
      const result = requireRunnerToken(
        makeRequest('/api/runner/tasks/5/checkpoints', {}, 'POST'),
        5,
      )
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.status).toBe(401)
      }
    })

    it('invalid bearer → 401', () => {
      const result = requireRunnerToken(
        makeRequest('/api/runner/tasks/5/checkpoints', { authorization: 'Bearer bogus-value' }, 'POST'),
        5,
      )
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.status).toBe(401)
      }
    })

    it('expired bearer → 401', () => {
      const nowSec = Math.floor(Date.now() / 1000)
      const { token } = issueRunnerToken(testDb, 5, 1, 60, nowSec - 3600)
      const result = requireRunnerToken(
        makeRequest('/api/runner/tasks/5/checkpoints', { authorization: `Bearer ${token}` }, 'POST'),
        5,
      )
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.status).toBe(401)
      }
    })

    it('revoked bearer → 401', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      revokeTokensForTask(testDb, 5)
      const result = requireRunnerToken(
        makeRequest('/api/runner/tasks/5/checkpoints', { authorization: `Bearer ${token}` }, 'POST'),
        5,
      )
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.status).toBe(401)
      }
    })

    it('non-allowlisted path → 401 (claim/5 with taskId=5)', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const result = requireRunnerToken(
        makeRequest('/api/runner/claim/5', { authorization: `Bearer ${token}` }, 'POST'),
        5,
      )
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.status).toBe(401)
      }
    })

    it('wrong method on allowlist pattern → 401 (DELETE /api/runner/tasks/5)', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const result = requireRunnerToken(
        makeRequest('/api/runner/tasks/5', { authorization: `Bearer ${token}` }, 'DELETE'),
        5,
      )
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.status).toBe(401)
      }
    })

    it('discriminated return: happy-path has `user` and no `error`', () => {
      const { token } = issueRunnerToken(testDb, 5, 1, 300)
      const result = requireRunnerToken(
        makeRequest('/api/runner/tasks/5/checkpoints', { authorization: `Bearer ${token}` }, 'POST'),
        5,
      )
      expect('user' in result).toBe(true)
      expect('error' in result).toBe(false)
    })

    it('discriminated return: failure path has `error` and no `user`', () => {
      const result = requireRunnerToken(
        makeRequest('/api/runner/tasks/5/checkpoints', {}, 'POST'),
        5,
      )
      expect('error' in result).toBe(true)
      expect('user' in result).toBe(false)
    })
  })
})
