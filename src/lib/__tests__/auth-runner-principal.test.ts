import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Runner-secret mock — each test sets `currentRunnerSecret` and the mock
// returns whatever's set. Null simulates a missing secret file.
let currentRunnerSecret: string | null = null
vi.mock('@/lib/runner-secret', () => ({
  getRunnerSecret: () => currentRunnerSecret,
  ensureRunnerSecret: vi.fn(() => currentRunnerSecret ?? ''),
  RUNNER_SECRET_FILENAME: '.data/runner.secret',
}))

// Capture logSecurityEvent calls so we can assert payload shape + secret-safety.
const logSpy = vi.fn()
vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: (...args: unknown[]) => logSpy(...args),
}))

// DB mock — auth.ts calls getDatabase() from multiple call sites:
//   - getDefaultWorkspaceContext() → SELECT id, tenant_id FROM workspaces ...
//   - agent-API-key lookup          → SELECT ... FROM agent_api_keys WHERE key_hash = ?
//   - session validation            → SELECT ... FROM user_sessions ...
// Discriminate by SQL so the agent_api_keys branch doesn't accidentally match
// our runner-secret-shaped bearer and produce a synthetic agent user.
vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      get: () => {
        if (/FROM\s+workspaces/i.test(sql)) return { id: 1, tenant_id: 1 }
        // Everything else (agent_api_keys, user_sessions, users, settings)
        // returns undefined — "no match". This lets the runner branch be the
        // sole path that produces a non-null user in these tests.
        return undefined
      },
      all: () => [],
      run: () => ({ lastInsertRowid: 1, changes: 1 }),
    }),
  }),
}))

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn((p: string) => `hashed:${p}`),
  verifyPassword: vi.fn(() => false),
  verifyPasswordWithRehashCheck: vi.fn(() => ({ valid: false, needsRehash: false })),
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

// Import AFTER mocks are set up so the module picks them up.
import { getUserFromRequest } from '@/lib/auth'

function makeRequest(pathname: string, headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: new Headers(headers),
  })
}

describe('getUserFromRequest — runner principal', () => {
  const originalEnv = process.env
  const knownSecret = 'known-secret-value-for-test-cases-exactly'

  beforeEach(() => {
    // Clear env — we don't want API_KEY or proxy auth headers affecting results.
    process.env = { ...originalEnv, API_KEY: '', MC_PROXY_AUTH_HEADER: '' }
    currentRunnerSecret = knownSecret
    logSpy.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('when runner.secret is present', () => {
    it('authenticates runner on POST /api/runner/tasks/1/checkpoints with Authorization: Bearer', () => {
      const user = getUserFromRequest(
        makeRequest(
          '/api/runner/tasks/1/checkpoints',
          { authorization: `Bearer ${knownSecret}` },
          'POST',
        ),
      )

      expect(user).not.toBeNull()
      expect(user!.username).toBe('runner')
      expect(user!.role).toBe('operator')
      expect(user!.id).toBe(-1000)
      expect(user!.display_name).toBe('Runner Daemon')
    })

    it('authenticates runner on GET /api/runner/ready-tasks with X-API-Key (same extractor)', () => {
      const user = getUserFromRequest(
        makeRequest('/api/runner/ready-tasks', { 'x-api-key': knownSecret }),
      )

      expect(user).not.toBeNull()
      expect(user!.username).toBe('runner')
      expect(user!.role).toBe('operator')
    })

    it('REJECTS the same secret on POST /api/tasks (path-scope enforced)', () => {
      const user = getUserFromRequest(
        makeRequest(
          '/api/tasks',
          { authorization: `Bearer ${knownSecret}` },
          'POST',
        ),
      )

      expect(user).toBeNull()
    })

    it('REJECTS the same secret on POST /api/users (path-scope enforced)', () => {
      const user = getUserFromRequest(
        makeRequest(
          '/api/users',
          { authorization: `Bearer ${knownSecret}` },
          'POST',
        ),
      )

      expect(user).toBeNull()
    })

    it('REJECTS the same secret on /api/runnerclown/ (prefix must end with a slash)', () => {
      // Guards against a typo or subtle path confusion — /api/runner/ must be
      // the exact boundary, not a loose "startsWith(/api/runner)".
      const user = getUserFromRequest(
        makeRequest(
          '/api/runnerclown/tasks',
          { authorization: `Bearer ${knownSecret}` },
          'POST',
        ),
      )

      expect(user).toBeNull()
    })

    it('returns null for wrong bearer on /api/runner/*', () => {
      const user = getUserFromRequest(
        makeRequest(
          '/api/runner/claim/1',
          { authorization: 'Bearer wrong-value-entirely' },
          'POST',
        ),
      )

      expect(user).toBeNull()
    })

    it('returns null when no auth headers are present on /api/runner/*', () => {
      const user = getUserFromRequest(
        makeRequest('/api/runner/claim/1', {}, 'POST'),
      )

      expect(user).toBeNull()
    })

    it('emits exactly one runner_auth security event on success, with safe payload', () => {
      getUserFromRequest(
        makeRequest(
          '/api/runner/tasks/42/checkpoints',
          { authorization: `Bearer ${knownSecret}` },
          'POST',
        ),
      )

      expect(logSpy).toHaveBeenCalledTimes(1)
      const event = logSpy.mock.calls[0][0]
      expect(event.event_type).toBe('runner_auth')
      expect(event.severity).toBe('info')
      expect(event.source).toBe('auth')

      const detail = event.detail as string
      // Payload shape: principal/path/method only — no secret, no fingerprint.
      const parsed = JSON.parse(detail)
      expect(parsed.principal).toBe('runner')
      expect(parsed.path).toBe('/api/runner/tasks/42/checkpoints')
      expect(parsed.method).toBe('POST')

      // Secret-safety: neither the raw secret nor a prefix should appear anywhere
      // in the event (detail, ip, agent_name, etc.).
      const serialized = JSON.stringify(event)
      expect(serialized).not.toContain(knownSecret)
      expect(serialized).not.toContain(knownSecret.slice(0, 8))
    })

    it('does NOT emit runner_auth for failed auth (wrong bearer on /api/runner/*)', () => {
      getUserFromRequest(
        makeRequest(
          '/api/runner/claim/1',
          { authorization: 'Bearer wrong' },
          'POST',
        ),
      )

      // Should not log runner_auth at all on failure — that's a successful-auth-only event.
      for (const call of logSpy.mock.calls) {
        expect(call[0].event_type).not.toBe('runner_auth')
      }
    })
  })

  describe('when runner.secret is missing (file absent)', () => {
    beforeEach(() => {
      currentRunnerSecret = null
    })

    it('authenticates /api/runner/* with the configured API_KEY as runner principal', () => {
      process.env = { ...originalEnv, API_KEY: knownSecret, MC_PROXY_AUTH_HEADER: '' }

      const user = getUserFromRequest(
        makeRequest('/api/runner/ready-tasks', { authorization: `Bearer ${knownSecret}` }),
      )

      expect(user).not.toBeNull()
      expect(user!.username).toBe('runner')
      expect(user!.role).toBe('operator')
      expect(user!.id).toBe(-1000)
    })

    it('returns null on /api/runner/* even with a bearer header', () => {
      const user = getUserFromRequest(
        makeRequest(
          '/api/runner/ready-tasks',
          { authorization: 'Bearer anything-at-all' },
        ),
      )

      expect(user).toBeNull()
    })

    it('does not emit runner_auth when no secret is configured', () => {
      getUserFromRequest(
        makeRequest(
          '/api/runner/ready-tasks',
          { authorization: 'Bearer anything-at-all' },
        ),
      )

      for (const call of logSpy.mock.calls) {
        expect(call[0].event_type).not.toBe('runner_auth')
      }
    })
  })
})
