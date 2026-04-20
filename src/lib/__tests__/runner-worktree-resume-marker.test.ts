/**
 * Unit tests for Phase 15 CP-04 resume_marker extension of seedMcDir
 * (src/lib/runner-worktree.ts).
 *
 * Covers all 8 state combinations of (is_resuming × resume_marker × pre-existing
 * progress.md × defensive fallback) to prove:
 *
 *   - First-attempt (is_resuming=false) IGNORES resume_marker — Phase 14 header
 *     is written with no marker line.
 *   - Resume (is_resuming=true) with resume_marker APPENDS the LOCKED format line
 *     to existing progress.md.
 *   - Resume without resume_marker PRESERVES existing progress.md untouched
 *     (Phase 14 behavior — no regression).
 *   - Defensive fallback (operator wiped worktree, is_resuming=true) recreates
 *     the empty header and THEN appends the marker if provided.
 *   - checkpoints.jsonl is never touched by the marker append.
 *   - .gitignore is always rewritten to literal "*\n".
 *
 * The LOCKED marker format (per 15-CONTEXT.md § "Blocker & Resume Flow"):
 *
 *   <at_iso> | <<< RESUMED AFTER BLOCKER: <blocker_reason> >>>
 *
 * is asserted byte-for-byte — any format drift in the implementation will fail.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { seedMcDir, type McTaskJson, type SeedMcDirInput } from '../runner-worktree'

function mcTaskJson(overrides: Partial<McTaskJson> = {}): McTaskJson {
  return {
    task_id: '42',
    recipe_slug: 'hello-world',
    attempt: 1,
    is_resuming: false,
    prior_attempts: [],
    ...overrides,
  }
}

describe('runner worktree .mc/ resume_marker (Phase 15 CP-04)', () => {
  let worktree: string

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-runner-worktree-resume-marker-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(worktree, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  it('1. first attempt IGNORES resume_marker — progress.md is plain header', () => {
    const input: SeedMcDirInput = {
      task: mcTaskJson({ is_resuming: false }),
      resume_marker: { blocker_reason: 'waiting for review', at_iso: '2026-04-21T00:00:00Z' },
    }
    seedMcDir(worktree, input)

    const progress = fs.readFileSync(path.join(worktree, '.mc', 'progress.md'), 'utf8')
    expect(progress).toBe('# Progress — Task 42\n\n')
    expect(progress).not.toContain('RESUMED AFTER BLOCKER')

    const checkpoints = fs.readFileSync(path.join(worktree, '.mc', 'checkpoints.jsonl'), 'utf8')
    expect(checkpoints).toBe('')
  })

  it('2. first attempt with no resume_marker — Phase 14 behavior unchanged', () => {
    seedMcDir(worktree, { task: mcTaskJson({ is_resuming: false }) })

    const progress = fs.readFileSync(path.join(worktree, '.mc', 'progress.md'), 'utf8')
    expect(progress).toBe('# Progress — Task 42\n\n')

    const checkpoints = fs.readFileSync(path.join(worktree, '.mc', 'checkpoints.jsonl'), 'utf8')
    expect(checkpoints).toBe('')
  })

  it('3. resume with resume_marker APPENDS to existing progress.md (byte-for-byte format)', () => {
    // Pre-seed the worktree as if an earlier attempt had written content
    fs.mkdirSync(path.join(worktree, '.mc'), { recursive: true })
    fs.writeFileSync(
      path.join(worktree, '.mc', 'progress.md'),
      '# Progress — Task 42\n\nSome prior note\n',
    )
    fs.writeFileSync(path.join(worktree, '.mc', 'checkpoints.jsonl'), '')

    seedMcDir(worktree, {
      task: mcTaskJson({ is_resuming: true, attempt: 2 }),
      resume_marker: {
        blocker_reason: 'API key rotation pending',
        at_iso: '2026-04-21T12:00:00Z',
      },
    })

    const progress = fs.readFileSync(path.join(worktree, '.mc', 'progress.md'), 'utf8')
    // Exact expected bytes — LOCKED marker format appended to preserved prior content
    expect(progress).toBe(
      '# Progress — Task 42\n\nSome prior note\n' +
        '2026-04-21T12:00:00Z | <<< RESUMED AFTER BLOCKER: API key rotation pending >>>\n',
    )
  })

  it('4. resume WITHOUT resume_marker preserves existing progress.md UNTOUCHED', () => {
    fs.mkdirSync(path.join(worktree, '.mc'), { recursive: true })
    fs.writeFileSync(
      path.join(worktree, '.mc', 'progress.md'),
      '# Progress — Task 42\n\nSome prior note\n',
    )
    fs.writeFileSync(path.join(worktree, '.mc', 'checkpoints.jsonl'), '')

    seedMcDir(worktree, {
      task: mcTaskJson({ is_resuming: true, attempt: 2 }),
      resume_marker: null,
    })

    const progress = fs.readFileSync(path.join(worktree, '.mc', 'progress.md'), 'utf8')
    expect(progress).toBe('# Progress — Task 42\n\nSome prior note\n')
    expect(progress).not.toContain('RESUMED AFTER BLOCKER')
  })

  it('5. defensive fallback — is_resuming=true, no progress.md, WITH resume_marker', () => {
    // No pre-existing progress.md (operator wiped the worktree). Defensive branch
    // must create the header first, THEN the marker append stacks on top.
    seedMcDir(worktree, {
      task: mcTaskJson({ is_resuming: true, attempt: 2 }),
      resume_marker: {
        blocker_reason: 'API key rotation pending',
        at_iso: '2026-04-21T12:00:00Z',
      },
    })

    const progress = fs.readFileSync(path.join(worktree, '.mc', 'progress.md'), 'utf8')
    expect(progress).toBe(
      '# Progress — Task 42\n\n' +
        '2026-04-21T12:00:00Z | <<< RESUMED AFTER BLOCKER: API key rotation pending >>>\n',
    )
  })

  it('6. defensive fallback — is_resuming=true, no progress.md, NO resume_marker (Phase 14 behavior)', () => {
    seedMcDir(worktree, {
      task: mcTaskJson({ is_resuming: true, attempt: 2 }),
      resume_marker: undefined,
    })

    const progress = fs.readFileSync(path.join(worktree, '.mc', 'progress.md'), 'utf8')
    expect(progress).toBe('# Progress — Task 42\n\n')
    expect(progress).not.toContain('RESUMED AFTER BLOCKER')
  })

  it('7. checkpoints.jsonl is preserved on resume — marker does NOT touch it', () => {
    fs.mkdirSync(path.join(worktree, '.mc'), { recursive: true })
    fs.writeFileSync(
      path.join(worktree, '.mc', 'progress.md'),
      '# Progress — Task 42\n\n',
    )
    fs.writeFileSync(
      path.join(worktree, '.mc', 'checkpoints.jsonl'),
      '{"id":1,"step":"init"}\n',
    )

    seedMcDir(worktree, {
      task: mcTaskJson({ is_resuming: true, attempt: 2 }),
      resume_marker: {
        blocker_reason: 'blocked on human review',
        at_iso: '2026-04-21T13:00:00Z',
      },
    })

    const checkpoints = fs.readFileSync(path.join(worktree, '.mc', 'checkpoints.jsonl'), 'utf8')
    expect(checkpoints).toBe('{"id":1,"step":"init"}\n')
  })

  it('8. .gitignore always rewritten to literal "*\\n" regardless of marker state', () => {
    // Pre-seed .gitignore with junk to prove it always gets overwritten
    fs.mkdirSync(path.join(worktree, '.mc'), { recursive: true })
    fs.writeFileSync(path.join(worktree, '.mc', '.gitignore'), 'garbage\n')

    // First attempt
    seedMcDir(worktree, { task: mcTaskJson({ is_resuming: false }) })
    expect(fs.readFileSync(path.join(worktree, '.mc', '.gitignore'), 'utf8')).toBe('*\n')

    // Corrupt again, then resume-seed with marker
    fs.writeFileSync(path.join(worktree, '.mc', '.gitignore'), 'garbage\n')
    seedMcDir(worktree, {
      task: mcTaskJson({ is_resuming: true, attempt: 2 }),
      resume_marker: {
        blocker_reason: 'x',
        at_iso: '2026-04-21T14:00:00Z',
      },
    })
    expect(fs.readFileSync(path.join(worktree, '.mc', '.gitignore'), 'utf8')).toBe('*\n')
  })
})
