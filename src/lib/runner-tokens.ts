import { createHash, randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'

/**
 * RAUTH-06 allowlist — the ONLY endpoints reachable via a runner-token bearer.
 * Pattern: `${METHOD} ${path-template}` where `:id` is the task_id placeholder.
 *
 * Originally locked by .planning/phases/11-runtime-foundation-v1-2/11-CONTEXT.md to
 * the six `/api/runner/tasks/:id/*` entries below.
 *
 * Phase 15 (CP-01) adds EXACTLY ONE entry: POST /api/tasks/:id/checkpoints. This
 * honors the v1.2 roadmap's literal checkpoint path (see
 * .planning/phases/15-checkpoints-scheduler-v1-2/15-CONTEXT.md
 * § "Checkpoint Endpoint Auth Path (added 2026-04-20 after research)"). DO NOT
 * broaden the scope further — subsequent additions must be justified by a
 * specific phase-level CONTEXT.md decision and land in the phase that owns them.
 */
export const RUNNER_TOKEN_ALLOWLIST: ReadonlyArray<{ method: string; pathPattern: RegExp }> = [
  { method: 'POST', pathPattern: /^\/api\/runner\/tasks\/(\d+)\/checkpoints\/?$/ },
  { method: 'POST', pathPattern: /^\/api\/runner\/tasks\/(\d+)\/submit\/?$/ },
  { method: 'POST', pathPattern: /^\/api\/runner\/tasks\/(\d+)\/fail\/?$/ },
  { method: 'GET',  pathPattern: /^\/api\/runner\/tasks\/(\d+)\/status\/?$/ },
  { method: 'GET',  pathPattern: /^\/api\/runner\/tasks\/(\d+)\/?$/ },
  { method: 'GET',  pathPattern: /^\/api\/runner\/tasks\/(\d+)\/comments\/?$/ },
  // Phase 15 CP-01: literal roadmap path for agent-authored checkpoints.
  { method: 'POST', pathPattern: /^\/api\/tasks\/(\d+)\/checkpoints\/?$/ },
]

export function hashRunnerToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

/**
 * Generate a new opaque bearer, persist sha256 hash + metadata, return the plaintext.
 * The plaintext is the ONLY time the caller will see it — never stored in plaintext, never recoverable.
 * Expiry per RAUTH-02 + CONTEXT.md: `runnerStartedAt + timeoutSeconds + 60`.
 */
export function issueRunnerToken(
  db: Database.Database,
  taskId: number,
  attempt: number,
  timeoutSeconds: number,
  runnerStartedAtUnix: number = Math.floor(Date.now() / 1000),
): { token: string; expiresAt: number } {
  const bytes = randomBytes(32)
  const token = bytes.toString('base64url')  // ~43 chars URL-safe
  const tokenHash = hashRunnerToken(token)
  const expiresAt = runnerStartedAtUnix + timeoutSeconds + 60
  db.prepare(`
    INSERT INTO task_runner_tokens (task_id, attempt, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(taskId, attempt, tokenHash, expiresAt)
  return { token, expiresAt }
}

export interface VerifiedRunnerToken {
  task_id: number
  attempt: number
  expires_at: number
}

/**
 * Look up a presented bearer. Returns the owning token metadata ONLY if:
 *  - the hash is in task_runner_tokens
 *  - revoked_at IS NULL
 *  - expires_at > now
 * Otherwise null. No exceptions, no error types — null is the single failure signal,
 * matching the getModel() pattern from Plan 11-01.
 *
 * IMPORTANT: A null return DOES NOT distinguish "unknown token" from "valid token but
 * wrong task_id for the current request" — because this function has no knowledge of
 * the request path. That distinction is made one layer up, in requireRunnerToken().
 * When verifyRunnerToken returns a VerifiedRunnerToken, callers can compare
 * `verified.task_id` against the path `:id` to decide 401 vs 403.
 */
export function verifyRunnerToken(
  db: Database.Database,
  rawToken: string,
  nowUnix: number = Math.floor(Date.now() / 1000),
): VerifiedRunnerToken | null {
  if (!rawToken) return null
  const tokenHash = hashRunnerToken(rawToken)
  const row = db.prepare(`
    SELECT task_id, attempt, expires_at, revoked_at
    FROM task_runner_tokens
    WHERE token_hash = ?
    LIMIT 1
  `).get(tokenHash) as { task_id: number; attempt: number; expires_at: number; revoked_at: number | null } | undefined
  if (!row) return null
  if (row.revoked_at !== null) return null
  if (row.expires_at <= nowUnix) return null
  return { task_id: row.task_id, attempt: row.attempt, expires_at: row.expires_at }
}

/**
 * Atomic revocation — sets revoked_at on every non-revoked token row matching task_id.
 * Caller MUST invoke this INSIDE the same db.transaction(() => { ... })() block as the
 * terminal-status UPDATE on tasks. See src/app/api/tasks/[id]/route.ts wiring.
 * Idempotent: if all tokens are already revoked, returns { revokedCount: 0 } without error.
 */
export function revokeTokensForTask(
  db: Database.Database,
  taskId: number,
  nowUnix: number = Math.floor(Date.now() / 1000),
): { revokedCount: number } {
  const result = db.prepare(`
    UPDATE task_runner_tokens
    SET revoked_at = ?
    WHERE task_id = ? AND revoked_at IS NULL
  `).run(nowUnix, taskId)
  return { revokedCount: result.changes }
}
