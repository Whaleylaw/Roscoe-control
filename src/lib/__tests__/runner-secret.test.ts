import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Per-test tmp dir. Resolved lazily by the mock below so each test gets
// a clean filesystem slice — no shared state between cases.
let tmpDir: string

vi.mock('../config', () => ({
  get config() {
    return { dataDir: tmpDir }
  },
  ensureDirExists: (p: string) => {
    if (p && !fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
  },
}))

// Capture logger.info calls so we can assert the secret value is never
// included in any log line (no prefix, no hash, no fingerprint).
const infoSpy = vi.fn()
vi.mock('../logger', () => ({
  logger: {
    info: (...args: unknown[]) => infoSpy(...args),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Import under test AFTER mocks.
let ensureRunnerSecret: typeof import('../runner-secret').ensureRunnerSecret
let getRunnerSecret: typeof import('../runner-secret').getRunnerSecret
let RUNNER_SECRET_FILENAME: string

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-secret-test-'))
  infoSpy.mockClear()
  // Fresh import per test because the module reads config lazily through
  // the mocked getter — no cached module state to reset here.
  vi.resetModules()
  const mod = await import('../runner-secret')
  ensureRunnerSecret = mod.ensureRunnerSecret
  getRunnerSecret = mod.getRunnerSecret
  RUNNER_SECRET_FILENAME = mod.RUNNER_SECRET_FILENAME
})

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {}
})

describe('ensureRunnerSecret', () => {
  it('creates runner.secret when missing with 0600 perms', () => {
    const secretPath = path.join(tmpDir, 'runner.secret')
    expect(fs.existsSync(secretPath)).toBe(false)

    const secret = ensureRunnerSecret()

    expect(secret).toBeTruthy()
    expect(fs.existsSync(secretPath)).toBe(true)

    const stat = fs.statSync(secretPath)
    // Low 9 bits are POSIX perms — check that they are exactly 0600.
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('is idempotent — second call returns the same secret and leaves the file alone', () => {
    const first = ensureRunnerSecret()
    const secretPath = path.join(tmpDir, 'runner.secret')
    const firstContent = fs.readFileSync(secretPath, 'utf8')

    const second = ensureRunnerSecret()
    const secondContent = fs.readFileSync(secretPath, 'utf8')

    expect(second).toBe(first)
    expect(secondContent).toBe(firstContent)
  })

  it('generates a secret with >= 32 bytes of entropy (base64url decoded)', () => {
    const secret = ensureRunnerSecret()
    const decoded = Buffer.from(secret, 'base64url')
    expect(decoded.length).toBeGreaterThanOrEqual(32)
  })

  it('regenerates with 0600 perms even when a stale broader-perm file already exists', () => {
    // Simulate an operator creating the file with insecure perms.
    const secretPath = path.join(tmpDir, 'runner.secret')
    fs.writeFileSync(secretPath, 'too-short', { mode: 0o644 })
    expect(fs.statSync(secretPath).mode & 0o777).toBe(0o644)

    const secret = ensureRunnerSecret()

    expect(secret).toBeTruthy()
    // New file must be 0600 — the rmSync+writeFileSync sequence narrows perms.
    expect(fs.statSync(secretPath).mode & 0o777).toBe(0o600)
    expect(fs.readFileSync(secretPath, 'utf8')).toBe(secret)
  })

  it('never logs the secret value (no prefix, no fingerprint, nothing)', () => {
    const secret = ensureRunnerSecret()
    expect(secret).toBeTruthy()
    expect(infoSpy).toHaveBeenCalled()

    // For every info() call, assert the secret does not appear anywhere
    // in the arguments — stringify to catch nested shapes.
    for (const call of infoSpy.mock.calls) {
      for (const arg of call) {
        const asString = typeof arg === 'string' ? arg : JSON.stringify(arg)
        expect(asString).not.toContain(secret)
        // Also guard against accidental prefix/fingerprint leakage.
        expect(asString).not.toContain(secret.slice(0, 8))
      }
    }
  })
})

describe('getRunnerSecret', () => {
  it('returns null when the file is missing', () => {
    expect(getRunnerSecret()).toBeNull()
  })

  it('returns the persisted value when the file is present and valid', () => {
    const generated = ensureRunnerSecret()
    expect(getRunnerSecret()).toBe(generated)
  })

  it('returns null when the file content is under 32 bytes of entropy', () => {
    // Write a deliberately short value — simulates an operator truncating
    // or zeroing the file. Must be rejected rather than treated as valid.
    const secretPath = path.join(tmpDir, 'runner.secret')
    fs.writeFileSync(secretPath, 'short', { mode: 0o600 })
    expect(getRunnerSecret()).toBeNull()
  })

  it('returns null for an empty file', () => {
    const secretPath = path.join(tmpDir, 'runner.secret')
    fs.writeFileSync(secretPath, '', { mode: 0o600 })
    expect(getRunnerSecret()).toBeNull()
  })

  it('returns null for a whitespace-only file', () => {
    const secretPath = path.join(tmpDir, 'runner.secret')
    fs.writeFileSync(secretPath, '   \n\t  ', { mode: 0o600 })
    expect(getRunnerSecret()).toBeNull()
  })
})

describe('RUNNER_SECRET_FILENAME export', () => {
  it('is the documented relative path', () => {
    // Exported for docs / error messages — the real path is always
    // resolved via config.dataDir inside the module.
    expect(RUNNER_SECRET_FILENAME).toBe('.data/runner.secret')
  })
})
