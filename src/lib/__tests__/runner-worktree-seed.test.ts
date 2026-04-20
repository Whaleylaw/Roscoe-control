/**
 * Test scaffold for worktree .mc/ seeding (Plan 14-08a/08b).
 *
 * Wave 0 stubs — replaced with real test bodies in the Wave 1/2 plan that
 * implements src/lib/runner-worktree-seed.ts. Pure filesystem unit tests
 * against a tmp dir; no git, no Docker, no network.
 */

import { describe, it } from 'vitest'

describe('runner worktree .mc/ seeding', () => {
  it.todo(
    'WORK-01: first-attempt seed creates .mc/task.json, .mc/progress.md, .mc/checkpoints.jsonl, and .mc/.gitignore',
  )
  it.todo(
    'WORK-02: task.json contains task_id, recipe_slug, attempt, is_resuming, and prior_attempts array',
  )
  it.todo('WORK-02: .mc/.gitignore contents equal "*\\n" (entire .mc/ excluded from agent git)')
  it.todo(
    'WORK-01: resume attempt preserves existing progress.md and checkpoints.jsonl (does not overwrite)',
  )
  it.todo(
    'WORK-02: resume attempt rewrites task.json with updated attempt counter and new prior_attempts entry',
  )
  it.todo('WORK-01: mkdir for .mc/ is idempotent — safe to call on an already-seeded worktree')
  it.todo(
    'WORK-02: task.json file permissions are 0600 (defensive — no tokens, but minimise footprint)',
  )
})
