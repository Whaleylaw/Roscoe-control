import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'
import { runMigrations } from '../migrations'
import {
  hashRunnerToken,
  issueRunnerToken,
  verifyRunnerToken,
  revokeTokensForTask,
  RUNNER_TOKEN_ALLOWLIST,
} from '../runner-tokens'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

function seedTask(db: Database.Database, id: number): void {
  // Seed a parent task row so the FK on task_runner_tokens has a target.
  // tasks has workspace_id (added in migration 021) but no tenant_id column.
  db.prepare(
    `INSERT INTO tasks (id, title, status, priority, workspace_id) VALUES (?, ?, ?, ?, ?)`
  ).run(id, `task ${id}`, 'inbox', 'medium', 1)
}

describe('runner-tokens module', () => {
  describe('hashRunnerToken', () => {
    it('is deterministic — same input yields same sha256 hex', () => {
      const h1 = hashRunnerToken('same-input')
      const h2 = hashRunnerToken('same-input')
      expect(h1).toBe(h2)
    })

    it('produces 64-char sha256 hex output', () => {
      const h = hashRunnerToken('anything')
      expect(h.length).toBe(64)
      expect(/^[0-9a-f]{64}$/.test(h)).toBe(true)
    })

    it('different inputs produce different hashes', () => {
      expect(hashRunnerToken('a')).not.toBe(hashRunnerToken('b'))
    })
  })

  describe('issueRunnerToken', () => {
    let db: Database.Database
    beforeEach(() => {
      db = freshDb()
      seedTask(db, 1)
    })

    it('returns { token, expiresAt } with expiresAt = runnerStartedAt + timeoutSeconds + 60', () => {
      const { token, expiresAt } = issueRunnerToken(db, 1, 1, 300, 1000)
      expect(expiresAt).toBe(1000 + 300 + 60) // 1360
      expect(typeof token).toBe('string')
    })

    it('token is base64url-encoded with at least 32 bytes of entropy', () => {
      const { token } = issueRunnerToken(db, 1, 1, 300, 1000)
      // base64url of 32 bytes is 43 chars (no padding)
      expect(token.length).toBeGreaterThanOrEqual(40)
      // Decodes back to exactly 32 bytes
      expect(Buffer.from(token, 'base64url').length).toBe(32)
      // Only base64url-safe characters (no +, /, =)
      expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true)
    })

    it('stores ONLY the sha256 hash — plaintext is NEVER in the DB', () => {
      const { token } = issueRunnerToken(db, 1, 1, 300, 1000)
      const row = db
        .prepare('SELECT token_hash FROM task_runner_tokens WHERE task_id = ?')
        .get(1) as { token_hash: string } | undefined
      expect(row).toBeDefined()
      expect(row!.token_hash.length).toBe(64)
      expect(row!.token_hash).not.toBe(token)
      expect(row!.token_hash).toBe(hashRunnerToken(token))
    })

    it('two calls produce distinct tokens AND distinct hashes, both rows present', () => {
      const a = issueRunnerToken(db, 1, 1, 300, 1000)
      const b = issueRunnerToken(db, 1, 2, 300, 1000)
      expect(a.token).not.toBe(b.token)
      expect(hashRunnerToken(a.token)).not.toBe(hashRunnerToken(b.token))
      const rows = db.prepare('SELECT attempt, token_hash FROM task_runner_tokens WHERE task_id = 1 ORDER BY attempt ASC').all() as Array<{ attempt: number; token_hash: string }>
      expect(rows.length).toBe(2)
      expect(rows[0].attempt).toBe(1)
      expect(rows[1].attempt).toBe(2)
    })

    it('uses Date.now-based default when runnerStartedAtUnix is omitted', () => {
      const before = Math.floor(Date.now() / 1000)
      const { expiresAt } = issueRunnerToken(db, 1, 1, 300)
      const after = Math.floor(Date.now() / 1000)
      // expiresAt should be within (before + 360) and (after + 360)
      expect(expiresAt).toBeGreaterThanOrEqual(before + 360)
      expect(expiresAt).toBeLessThanOrEqual(after + 360)
    })
  })

  describe('verifyRunnerToken', () => {
    let db: Database.Database
    beforeEach(() => {
      db = freshDb()
      seedTask(db, 1)
    })

    it('returns full metadata for a valid token', () => {
      const { token } = issueRunnerToken(db, 1, 1, 300, 1000)
      const v = verifyRunnerToken(db, token, 1100)
      expect(v).toEqual({ task_id: 1, attempt: 1, expires_at: 1360 })
    })

    it('returns null for an unknown bearer', () => {
      issueRunnerToken(db, 1, 1, 300, 1000)
      expect(verifyRunnerToken(db, 'wrong-value', 1100)).toBeNull()
    })

    it('returns null for empty string', () => {
      issueRunnerToken(db, 1, 1, 300, 1000)
      expect(verifyRunnerToken(db, '', 1100)).toBeNull()
    })

    it('returns null 1 second past expiry', () => {
      const { token } = issueRunnerToken(db, 1, 1, 300, 1000)
      expect(verifyRunnerToken(db, token, 1361)).toBeNull()
    })

    it('returns null at exact expiry moment (strict <= rejection)', () => {
      const { token } = issueRunnerToken(db, 1, 1, 300, 1000)
      // expires_at = 1360; nowUnix = 1360 → expires_at <= now → null
      expect(verifyRunnerToken(db, token, 1360)).toBeNull()
    })

    it('returns a value just before expiry', () => {
      const { token } = issueRunnerToken(db, 1, 1, 300, 1000)
      expect(verifyRunnerToken(db, token, 1359)).not.toBeNull()
    })

    it('returns null after revocation', () => {
      const { token } = issueRunnerToken(db, 1, 1, 300, 1000)
      revokeTokensForTask(db, 1, 1100)
      expect(verifyRunnerToken(db, token, 1100)).toBeNull()
    })
  })

  describe('revokeTokensForTask', () => {
    let db: Database.Database
    beforeEach(() => {
      db = freshDb()
      seedTask(db, 1)
      seedTask(db, 2)
    })

    it('returns { revokedCount: N } for newly-revoked rows and verifyRunnerToken then returns null', () => {
      const { token } = issueRunnerToken(db, 1, 1, 300, 1000)
      const { revokedCount } = revokeTokensForTask(db, 1, 1100)
      expect(revokedCount).toBe(1)
      expect(verifyRunnerToken(db, token, 1100)).toBeNull()
    })

    it('revokes ALL non-revoked tokens for the task in one call', () => {
      issueRunnerToken(db, 1, 1, 300, 1000)
      issueRunnerToken(db, 1, 2, 300, 1000)
      issueRunnerToken(db, 1, 3, 300, 1000)
      const { revokedCount } = revokeTokensForTask(db, 1, 1100)
      expect(revokedCount).toBe(3)
    })

    it('is idempotent — second call returns { revokedCount: 0 } without error', () => {
      issueRunnerToken(db, 1, 1, 300, 1000)
      const first = revokeTokensForTask(db, 1, 1100)
      expect(first.revokedCount).toBe(1)
      const second = revokeTokensForTask(db, 1, 1200)
      expect(second.revokedCount).toBe(0)
    })

    it('only affects the target task — tokens for other tasks remain valid', () => {
      const { token: t1 } = issueRunnerToken(db, 1, 1, 300, 1000)
      const { token: t2 } = issueRunnerToken(db, 2, 1, 300, 1000)
      revokeTokensForTask(db, 1, 1100)
      expect(verifyRunnerToken(db, t1, 1100)).toBeNull()
      expect(verifyRunnerToken(db, t2, 1100)).not.toBeNull()
    })

    it('returns { revokedCount: 0 } when the task has no tokens at all', () => {
      const { revokedCount } = revokeTokensForTask(db, 1, 1100)
      expect(revokedCount).toBe(0)
    })
  })

  describe('RUNNER_TOKEN_ALLOWLIST', () => {
    it('contains exactly the seven allowlist entries (six RAUTH-06 + Phase 15 checkpoints)', () => {
      expect(RUNNER_TOKEN_ALLOWLIST.length).toBe(7)
    })

    it('each entry has method and pathPattern', () => {
      for (const rule of RUNNER_TOKEN_ALLOWLIST) {
        expect(typeof rule.method).toBe('string')
        expect(rule.pathPattern).toBeInstanceOf(RegExp)
      }
    })

    it('matches POST /api/runner/tasks/42/checkpoints', () => {
      const match = RUNNER_TOKEN_ALLOWLIST.find(
        (r) => r.method === 'POST' && r.pathPattern.test('/api/runner/tasks/42/checkpoints')
      )
      expect(match).toBeDefined()
      const m = '/api/runner/tasks/42/checkpoints'.match(match!.pathPattern)!
      expect(m[1]).toBe('42')
    })

    it('matches POST /api/runner/tasks/1/submit and /fail', () => {
      const submit = RUNNER_TOKEN_ALLOWLIST.find(
        (r) => r.method === 'POST' && r.pathPattern.test('/api/runner/tasks/1/submit')
      )
      const fail = RUNNER_TOKEN_ALLOWLIST.find(
        (r) => r.method === 'POST' && r.pathPattern.test('/api/runner/tasks/1/fail')
      )
      expect(submit).toBeDefined()
      expect(fail).toBeDefined()
    })

    it('matches GET /api/runner/tasks/:id, /status, /comments', () => {
      const getStatus = RUNNER_TOKEN_ALLOWLIST.find(
        (r) => r.method === 'GET' && r.pathPattern.test('/api/runner/tasks/5/status')
      )
      const getTask = RUNNER_TOKEN_ALLOWLIST.find(
        (r) => r.method === 'GET' && r.pathPattern.test('/api/runner/tasks/5')
      )
      const getComments = RUNNER_TOKEN_ALLOWLIST.find(
        (r) => r.method === 'GET' && r.pathPattern.test('/api/runner/tasks/5/comments')
      )
      expect(getStatus).toBeDefined()
      expect(getTask).toBeDefined()
      expect(getComments).toBeDefined()
    })

    it('does NOT match /api/runner/claim/:id (non-allowlisted)', () => {
      const any = RUNNER_TOKEN_ALLOWLIST.find((r) => r.pathPattern.test('/api/runner/claim/5'))
      expect(any).toBeUndefined()
    })

    it('does NOT match /api/runner/ready-tasks (non-allowlisted)', () => {
      const any = RUNNER_TOKEN_ALLOWLIST.find((r) => r.pathPattern.test('/api/runner/ready-tasks'))
      expect(any).toBeUndefined()
    })

    it('does NOT match non-runner paths like /api/tasks/5', () => {
      const any = RUNNER_TOKEN_ALLOWLIST.find((r) => r.pathPattern.test('/api/tasks/5'))
      expect(any).toBeUndefined()
    })

    it('does NOT match method mismatch (DELETE on /api/runner/tasks/5)', () => {
      const match = RUNNER_TOKEN_ALLOWLIST.find(
        (r) => r.method === 'DELETE' && r.pathPattern.test('/api/runner/tasks/5')
      )
      expect(match).toBeUndefined()
    })
  })
})
