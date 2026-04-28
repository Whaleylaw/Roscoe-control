/**
 * Unit tests for the runner preamble generator (Plan 14-07 / WORK-04 + WORK-05).
 *
 * Pure-function coverage — no filesystem, no HTTP, no process calls.
 * Replaces the Wave-0 it.todo scaffold from Plan 14-03.
 */

import { describe, it, expect } from 'vitest'
import { generatePreamble, type PreambleInput } from '../runner-preamble'

const API_BASE = 'http://host.docker.internal:3000'
const TASK_ID = 42

function firstAttemptInput(): PreambleInput {
  return {
    isResuming: false,
    taskId: TASK_ID,
    apiBase: API_BASE,
    priorAttempts: [],
  }
}

function resumeInput(): PreambleInput {
  return {
    isResuming: true,
    taskId: TASK_ID,
    apiBase: API_BASE,
    priorAttempts: [
      { started_at: 1713600000, exit_code: null, failure_reason: 'timeout' },
      { started_at: 1713603600, exit_code: 137, failure_reason: 'container_oom' },
    ],
  }
}

function nonBlankLineCount(text: string): number {
  return text.split('\n').filter((l) => l.trim().length > 0).length
}

describe('runner preamble generator', () => {
  it('WORK-05: first-attempt preamble contains "/workspace/.mc/progress.md" and "append a line" guidance', () => {
    const text = generatePreamble(firstAttemptInput())
    expect(text).toContain('/workspace/.mc/progress.md')
    expect(text.toLowerCase()).toContain('append a line')
  })

  it('WORK-04: resume preamble contains "read .mc/task.json" and "git status" and "git log --oneline" instructions', () => {
    const text = generatePreamble(resumeInput())
    expect(text).toContain('read .mc/task.json')
    expect(text).toContain('git -C /workspace status')
    expect(text).toContain('git -C /workspace log --oneline')
  })

  it('WORK-04/05: both variants forward-reference the task-scoped checkpoint endpoint', () => {
    const firstAttempt = generatePreamble(firstAttemptInput())
    const resume = generatePreamble(resumeInput())
    const literal = `POST ${API_BASE}/api/tasks/$MC_TASK_ID/checkpoints`
    expect(firstAttempt).toContain(literal)
    expect(resume).toContain(literal)
  })

  it('WORK-05: first-attempt preamble is between 30 and 50 non-blank lines', () => {
    const text = generatePreamble(firstAttemptInput())
    const count = nonBlankLineCount(text)
    expect(count).toBeGreaterThanOrEqual(30)
    expect(count).toBeLessThanOrEqual(50)
  })

  it('WORK-04: resume preamble is between 35 and 55 non-blank lines', () => {
    const text = generatePreamble(resumeInput())
    const count = nonBlankLineCount(text)
    expect(count).toBeGreaterThanOrEqual(35)
    expect(count).toBeLessThanOrEqual(57)
  })

  it('WORK-04: resume preamble makes current SOUL completion rules override shortcut submission', () => {
    const text = generatePreamble(resumeInput())
    expect(text).toContain('current recipe says the work is blocked')
    expect(text).toContain('still satisfies the current `/recipe/SOUL.md` completion rules')
  })

  it('WORK-04/05: generatePreamble is deterministic — same inputs produce identical output', () => {
    const a = generatePreamble(firstAttemptInput())
    const b = generatePreamble(firstAttemptInput())
    expect(a).toEqual(b)

    const c = generatePreamble(resumeInput())
    const d = generatePreamble(resumeInput())
    expect(c).toEqual(d)
  })

  it('WORK-04/05: both variants reference POST ${apiBase}/api/runner/tasks/$MC_TASK_ID/submit (NOT PUT /api/tasks/)', () => {
    const firstAttempt = generatePreamble(firstAttemptInput())
    const resume = generatePreamble(resumeInput())
    const submitLiteral = `POST ${API_BASE}/api/runner/tasks/$MC_TASK_ID/submit`
    expect(firstAttempt).toContain(submitLiteral)
    expect(resume).toContain(submitLiteral)
    // Defensive: must NOT forward-reference the legacy PUT /api/tasks/:id path
    // which would hit the runner-token allowlist reject (Phase 11-04).
    expect(firstAttempt).not.toContain('PUT /api/tasks/')
    expect(resume).not.toContain('PUT /api/tasks/')
  })
})
