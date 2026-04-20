/**
 * Test scaffold for the runner preamble generator (Plan 14-07).
 *
 * Wave 0 stubs — replaced with real test bodies in the Wave 1/2 plan that
 * implements src/lib/runner-preamble.ts. Two variants: first-attempt and
 * resume. Both are tool-agnostic (no Claude Code assumption) and forward-
 * reference POST /api/runner/checkpoint (which ships in Phase 15).
 */

import { describe, it } from 'vitest'

describe('runner preamble generator', () => {
  it.todo(
    'WORK-05: first-attempt preamble contains "/workspace/.mc/progress.md" and "append a line" guidance',
  )
  it.todo(
    'WORK-04: resume preamble contains "read .mc/task.json" and "git status" and "git log --oneline" instructions',
  )
  it.todo(
    'WORK-04/05: both variants forward-reference POST {MC_API_URL}/api/runner/checkpoint via MC_PREAMBLE_PATH',
  )
  it.todo('WORK-05: first-attempt preamble is 30-50 lines long')
  it.todo('WORK-04: resume preamble is ≈45 lines long')
  it.todo(
    'WORK-04/05: preamble output is deterministic — snapshot stable between invocations with identical inputs',
  )
})
