import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config, ensureDirExists } from './config'
import { logger } from './logger'

/**
 * Runner principal secret — auto-generated on first boot, persisted at
 * `<dataDir>/runner.secret` with 0600 perms. Used as a long-lived bearer
 * token for the runner daemon (Phase 14+). Strictly scoped to /api/runner/*
 * at the auth layer — this module only owns generation and read.
 *
 * Matches the UX of AUTH_SECRET / API_KEY (see `src/lib/auto-credentials.ts`)
 * but writes a single-value file rather than a key=value store.
 */

// Documentation-only constant — callers should not hardcode the path.
// The real location is resolved at runtime via `getRunnerSecretPath()` which
// honors `config.dataDir` (so tests and alternate data dirs work correctly).
export const RUNNER_SECRET_FILENAME = '.data/runner.secret'

function getRunnerSecretPath(): string {
  return path.join(config.dataDir, 'runner.secret')
}

// Minimum decoded entropy we require. randomBytes(32).toString('base64url')
// yields 43 chars that decode to exactly 32 bytes. An operator who empties
// or truncates the file (e.g. `> .data/runner.secret`) should be treated as
// "no secret" rather than "weak secret".
const MIN_SECRET_BYTES = 32

/**
 * Read the runner secret from disk.
 *
 * Returns `null` when:
 *   - the file is missing
 *   - the file is empty or whitespace-only
 *   - the decoded value has fewer than 32 bytes of entropy
 *
 * Does NOT auto-generate — that is `ensureRunnerSecret()`'s job. Separating
 * read from provision keeps test isolation clean and prevents a read-only
 * call path from surprising the filesystem.
 */
export function getRunnerSecret(): string | null {
  let raw: string
  try {
    // Resolve path inside the try — `config.dataDir` can be undefined in
    // certain test mocks; treat that as "no secret available" rather than
    // crash the entire auth path.
    const secretPath = getRunnerSecretPath()
    raw = fs.readFileSync(secretPath, 'utf8').trim()
  } catch {
    return null
  }
  if (!raw) return null
  // Validate decoded length — guards against truncated / tampered files.
  const decodedLen = Buffer.from(raw, 'base64url').length
  if (decodedLen < MIN_SECRET_BYTES) return null
  return raw
}

/**
 * Ensure a runner secret exists on disk. Idempotent.
 *
 * If a valid secret is already present, returns it unchanged and does not
 * touch the file. Otherwise generates 32 random bytes, base64url-encodes
 * them (URL-safe for `Authorization: Bearer <value>`), and writes to
 * `<dataDir>/runner.secret` with mode 0600.
 *
 * Writes NEVER log the secret value, a prefix, or a fingerprint.
 */
export function ensureRunnerSecret(): string {
  // Match auto-credentials.ts — avoid filesystem writes during `next build`.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    const existing = getRunnerSecret()
    if (existing) return existing
    // During build there's nothing useful to return; callers shouldn't rely
    // on this branch in production paths (runner auth runs at request time).
    return ''
  }

  const existing = getRunnerSecret()
  if (existing) return existing

  // If the data dir isn't configured (certain test mocks stub config with
  // only dbPath), skip filesystem provisioning. Callers still get an empty
  // string, matching the build-phase escape hatch above.
  if (!config.dataDir) return ''

  ensureDirExists(config.dataDir)

  const secret = randomBytes(MIN_SECRET_BYTES).toString('base64url')
  const secretPath = getRunnerSecretPath()

  // `fs.writeFileSync(path, data, { mode: 0o600 })` only applies the mode
  // on file CREATION. If a file already exists with broader perms (e.g. an
  // operator ran `touch .data/runner.secret && chmod 644` then restart),
  // writeFileSync would keep those loose perms. Explicit rmSync first
  // guarantees a fresh create with 0600.
  try {
    fs.rmSync(secretPath, { force: true })
  } catch {
    // Non-fatal — writeFileSync will either succeed or surface the real error.
  }

  fs.writeFileSync(secretPath, secret, { mode: 0o600 })

  logger.info('Auto-generated runner secret (persisted to .data/runner.secret — mode 0600)')

  return secret
}
