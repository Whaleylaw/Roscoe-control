/**
 * Test scaffold for GET /api/runner/terminal-tasks (Plan 14-04).
 *
 * Wave 0 stubs — replaced with real test bodies in the Wave 1/2 plan that
 * implements the route. Used by the runner's GC tick to drive worktree /
 * log cleanup on done/cancelled/failed.
 */

import { describe, it } from 'vitest'

describe('GET /api/runner/terminal-tasks', () => {
  it.todo(
    'WORK-07: returns tasks whose status ∈ {done, cancelled, failed} and terminal_at > ?since=<iso8601>',
  )
  it.todo('WORK-07: omits non-terminal tasks (status ∈ {assigned, in_progress}) from response')
  it.todo('WORK-07: rejects requests whose bearer is not the runner-secret with 401')
})
