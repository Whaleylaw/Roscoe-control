/**
 * Unit tests for worktree .mc/ seeding (Plan 14-07 / WORK-01 + WORK-02).
 *
 * Pure filesystem primitives against os.tmpdir() — no git worktree, no docker.
 * Replaces the Wave-0 it.todo scaffold from Plan 14-03.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  seedMcDir,
  readMcTaskJson,
  writeMcTaskJson,
  buildPriorAttemptsEntry,
  type McTaskJson,
} from '../runner-worktree'

function firstAttemptTask(): McTaskJson {
  return {
    task_id: '42',
    recipe_slug: 'hello-world',
    attempt: 1,
    is_resuming: false,
    prior_attempts: [],
  }
}

function resumeTask(): McTaskJson {
  return {
    task_id: '42',
    recipe_slug: 'hello-world',
    attempt: 3,
    is_resuming: true,
    prior_attempts: [
      { started_at: '2026-04-20T14:03:00.000Z', exit_code: 137, failure_reason: 'container_oom' },
      { started_at: '2026-04-20T14:11:00.000Z', exit_code: null, failure_reason: 'timeout' },
    ],
  }
}

describe('runner worktree .mc/ seeding', () => {
  let worktree: string

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-runner-worktree-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(worktree, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  it('WORK-01: first-attempt seed creates .mc/task.json, .mc/progress.md, .mc/checkpoints.jsonl, and .mc/.gitignore', () => {
    seedMcDir(worktree, { task: firstAttemptTask() })
    const mcDir = path.join(worktree, '.mc')
    expect(fs.existsSync(path.join(mcDir, 'task.json'))).toBe(true)
    expect(fs.existsSync(path.join(mcDir, 'progress.md'))).toBe(true)
    expect(fs.existsSync(path.join(mcDir, 'checkpoints.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(mcDir, '.gitignore'))).toBe(true)
  })

  it('WORK-02: task.json contains all required keys per shape', () => {
    seedMcDir(worktree, { task: firstAttemptTask() })
    const parsed = readMcTaskJson(worktree)
    expect(parsed).not.toBeNull()
    expect(parsed).toEqual({
      task_id: '42',
      recipe_slug: 'hello-world',
      attempt: 1,
      is_resuming: false,
      prior_attempts: [],
    })
  })

  it('WORK-02: .mc/.gitignore contents equal "*\\n" (entire .mc/ excluded from agent git history)', () => {
    seedMcDir(worktree, { task: firstAttemptTask() })
    const gitignore = fs.readFileSync(path.join(worktree, '.mc', '.gitignore'), 'utf8')
    expect(gitignore).toBe('*\n')
  })

  it('WORK-01: resume attempt preserves existing progress.md and checkpoints.jsonl', () => {
    // First attempt — seeds empty files
    seedMcDir(worktree, { task: firstAttemptTask() })
    // Operator (or agent) writes content
    fs.writeFileSync(
      path.join(worktree, '.mc', 'progress.md'),
      '# Progress — Task 42\n\n2026-04-20T14:00:00Z | did a thing\n',
    )
    fs.writeFileSync(
      path.join(worktree, '.mc', 'checkpoints.jsonl'),
      '{"step":"did-a-thing","status":"completed"}\n',
    )

    // Resume seed — should NOT overwrite
    seedMcDir(worktree, { task: resumeTask() })

    const progress = fs.readFileSync(path.join(worktree, '.mc', 'progress.md'), 'utf8')
    const checkpoints = fs.readFileSync(path.join(worktree, '.mc', 'checkpoints.jsonl'), 'utf8')
    expect(progress).toContain('did a thing')
    expect(checkpoints).toContain('did-a-thing')
  })

  it('WORK-02: resume attempt rewrites task.json with new attempt number + prior_attempts', () => {
    seedMcDir(worktree, { task: firstAttemptTask() })
    const beforeResume = readMcTaskJson(worktree)
    expect(beforeResume?.attempt).toBe(1)
    expect(beforeResume?.is_resuming).toBe(false)

    seedMcDir(worktree, { task: resumeTask() })
    const afterResume = readMcTaskJson(worktree)
    expect(afterResume?.attempt).toBe(3)
    expect(afterResume?.is_resuming).toBe(true)
    expect(afterResume?.prior_attempts).toHaveLength(2)
    expect(afterResume?.prior_attempts[0]).toEqual({
      started_at: '2026-04-20T14:03:00.000Z',
      exit_code: 137,
      failure_reason: 'container_oom',
    })
  })

  it('WORK-01: mkdir for .mc/ is idempotent — safe to call on an already-seeded worktree', () => {
    seedMcDir(worktree, { task: firstAttemptTask() })
    expect(() => seedMcDir(worktree, { task: firstAttemptTask() })).not.toThrow()
  })

  it('WORK-02: task.json file permissions are 0600 (defensive — no tokens, but minimise footprint)', () => {
    if (process.platform === 'win32') {
      // Windows ACLs do not expose POSIX mode bits — skip.
      return
    }
    seedMcDir(worktree, { task: firstAttemptTask() })
    const stat = fs.statSync(path.join(worktree, '.mc', 'task.json'))
    // Mask off the file-type bits, keep only the permission bits.
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('read/write round-trip preserves the full McTaskJson shape including prior_attempts ISO strings', () => {
    writeMcTaskJson(worktree, resumeTask())
    const roundTrip = readMcTaskJson(worktree)
    expect(roundTrip).toEqual(resumeTask())
  })

  it('buildPriorAttemptsEntry converts unix seconds to ISO and carries exit_code + failure_reason', () => {
    const entry = buildPriorAttemptsEntry(1713600180, 137, 'container_oom')
    expect(entry.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(entry.exit_code).toBe(137)
    expect(entry.failure_reason).toBe('container_oom')

    const nullEntry = buildPriorAttemptsEntry(1713600000, null, null)
    expect(nullEntry.exit_code).toBeNull()
    expect(nullEntry.failure_reason).toBeNull()
  })

  it('readMcTaskJson returns null when the file is missing or malformed', () => {
    expect(readMcTaskJson(worktree)).toBeNull()
    // Write an unparseable file
    fs.mkdirSync(path.join(worktree, '.mc'), { recursive: true })
    fs.writeFileSync(path.join(worktree, '.mc', 'task.json'), '{{{not json')
    expect(readMcTaskJson(worktree)).toBeNull()
  })
})
