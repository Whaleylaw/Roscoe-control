import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ensureAttemptDir,
  finalizeMeta,
  resolveLogPaths,
  updateLatestSymlink,
  type AttemptMetaExit,
  type AttemptMetaInit,
} from '../runner-log-layout'

// Phase 14 targets macOS LaunchAgent; Windows symlink semantics differ
// (Windows requires SeCreateSymbolicLinkPrivilege and distinguishes file
// vs dir symlinks in a way the Node fs shim doesn't fully abstract).
// Gate symlink-touching tests so CI on Windows doesn't false-fail.
const SKIP_SYMLINK_TESTS = process.platform === 'win32'

let tmpDir: string

beforeEach(() => {
  // Per-test tmpdir so each case starts with an empty filesystem slice.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-runner-logs-'))
})

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {}
})

describe('resolveLogPaths', () => {
  it('returns exact layout per 14-CONTEXT.md', () => {
    const paths = resolveLogPaths(tmpDir, 42, 3)
    expect(paths.taskLogRoot).toBe(path.join(tmpDir, 'runner', 'logs', 'task-42'))
    expect(paths.attemptDir).toBe(path.join(tmpDir, 'runner', 'logs', 'task-42', 'attempt-3'))
    expect(paths.stdoutLog).toBe(path.join(paths.attemptDir, 'stdout.log'))
    expect(paths.stderrLog).toBe(path.join(paths.attemptDir, 'stderr.log'))
    expect(paths.metaJson).toBe(path.join(paths.attemptDir, 'meta.json'))
    expect(paths.latestSymlink).toBe(path.join(paths.taskLogRoot, 'latest'))
  })
})

describe('ensureAttemptDir', () => {
  it('creates attempt-<n>/ and empty stdout.log + stderr.log', () => {
    const paths = resolveLogPaths(tmpDir, 42, 1)
    const meta: AttemptMetaInit = {
      started_at: '2026-04-20T14:00:00Z',
      runner_id: 'runner-local-1',
      container_id: null,
    }
    ensureAttemptDir(paths, meta)
    expect(fs.existsSync(paths.attemptDir)).toBe(true)
    expect(fs.statSync(paths.attemptDir).isDirectory()).toBe(true)
    expect(fs.existsSync(paths.stdoutLog)).toBe(true)
    expect(fs.existsSync(paths.stderrLog)).toBe(true)
    expect(fs.statSync(paths.stdoutLog).size).toBe(0)
    expect(fs.statSync(paths.stderrLog).size).toBe(0)
  })

  it('writes meta.json with started_at + runner_id + container_id fields', () => {
    const paths = resolveLogPaths(tmpDir, 77, 2)
    const meta: AttemptMetaInit = {
      started_at: '2026-04-20T15:00:00Z',
      runner_id: 'runner-local-1',
      container_id: 'c-abc123',
    }
    ensureAttemptDir(paths, meta)
    const raw = fs.readFileSync(paths.metaJson, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.started_at).toBe('2026-04-20T15:00:00Z')
    expect(parsed.runner_id).toBe('runner-local-1')
    expect(parsed.container_id).toBe('c-abc123')
  })

  it('is idempotent — calling twice does not throw; meta.json is overwritten with latest init values', () => {
    const paths = resolveLogPaths(tmpDir, 5, 1)
    const meta1: AttemptMetaInit = {
      started_at: '2026-04-20T10:00:00Z',
      runner_id: 'runner-local-1',
      container_id: null,
    }
    const meta2: AttemptMetaInit = {
      started_at: '2026-04-20T10:00:01Z',
      runner_id: 'runner-local-1',
      container_id: 'c-after-restart',
    }
    ensureAttemptDir(paths, meta1)
    // Second call after a runner restart must not throw; meta.json overwrites.
    expect(() => ensureAttemptDir(paths, meta2)).not.toThrow()
    const parsed = JSON.parse(fs.readFileSync(paths.metaJson, 'utf8'))
    expect(parsed.started_at).toBe('2026-04-20T10:00:01Z')
    expect(parsed.container_id).toBe('c-after-restart')
  })
})

describe('updateLatestSymlink', () => {
  it.skipIf(SKIP_SYMLINK_TESTS)('creates latest → attempt-<n>/ symlink with a RELATIVE target', () => {
    const paths = resolveLogPaths(tmpDir, 11, 1)
    // taskLogRoot must exist before we can create a symlink inside it.
    ensureAttemptDir(paths, {
      started_at: '2026-04-20T10:00:00Z',
      runner_id: 'runner-local-1',
      container_id: null,
    })
    updateLatestSymlink(paths, 1)
    expect(fs.lstatSync(paths.latestSymlink).isSymbolicLink()).toBe(true)
    // readlink returns the target exactly as stored — must be relative.
    expect(fs.readlinkSync(paths.latestSymlink)).toBe('attempt-1')
  })

  it.skipIf(SKIP_SYMLINK_TESTS)('replaces existing symlink — attempt=1 then attempt=2; final readlink = "attempt-2"', () => {
    const paths1 = resolveLogPaths(tmpDir, 11, 1)
    const paths2 = resolveLogPaths(tmpDir, 11, 2)
    ensureAttemptDir(paths1, {
      started_at: '2026-04-20T10:00:00Z',
      runner_id: 'runner-local-1',
      container_id: null,
    })
    updateLatestSymlink(paths1, 1)
    ensureAttemptDir(paths2, {
      started_at: '2026-04-20T11:00:00Z',
      runner_id: 'runner-local-1',
      container_id: null,
    })
    updateLatestSymlink(paths2, 2)
    expect(fs.readlinkSync(paths2.latestSymlink)).toBe('attempt-2')
  })
})

describe('finalizeMeta', () => {
  it('preserves original init fields and appends exit fields', () => {
    const paths = resolveLogPaths(tmpDir, 99, 1)
    const init: AttemptMetaInit = {
      started_at: '2026-04-20T12:00:00Z',
      runner_id: 'runner-local-1',
      container_id: 'c-xyz',
    }
    const exit: AttemptMetaExit = {
      exited_at: '2026-04-20T12:05:00Z',
      exit_code: 137,
      reason: 'oom',
    }
    ensureAttemptDir(paths, init)
    finalizeMeta(paths, exit)
    const parsed = JSON.parse(fs.readFileSync(paths.metaJson, 'utf8'))
    // Init fields preserved.
    expect(parsed.started_at).toBe('2026-04-20T12:00:00Z')
    expect(parsed.runner_id).toBe('runner-local-1')
    expect(parsed.container_id).toBe('c-xyz')
    // Exit fields appended.
    expect(parsed.exited_at).toBe('2026-04-20T12:05:00Z')
    expect(parsed.exit_code).toBe(137)
    expect(parsed.reason).toBe('oom')
  })

  it('handles missing meta.json gracefully — writes a new one containing only exit fields', () => {
    const paths = resolveLogPaths(tmpDir, 100, 1)
    // Create the attempt dir but NOT the meta.json — simulates a crash
    // between mkdir and writeFile in ensureAttemptDir.
    fs.mkdirSync(paths.attemptDir, { recursive: true })
    const exit: AttemptMetaExit = {
      exited_at: '2026-04-20T13:05:00Z',
      exit_code: 0,
      reason: 'normal',
    }
    expect(() => finalizeMeta(paths, exit)).not.toThrow()
    const parsed = JSON.parse(fs.readFileSync(paths.metaJson, 'utf8'))
    expect(parsed.exited_at).toBe('2026-04-20T13:05:00Z')
    expect(parsed.exit_code).toBe(0)
    expect(parsed.reason).toBe('normal')
    // No init fields because meta.json did not exist.
    expect(parsed.started_at).toBeUndefined()
    expect(parsed.runner_id).toBeUndefined()
  })
})
