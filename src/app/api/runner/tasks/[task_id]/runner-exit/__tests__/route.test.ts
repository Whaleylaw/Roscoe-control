/**
 * Test scaffold for POST /api/runner/tasks/:task_id/runner-exit (Plan 14-06).
 *
 * Wave 0 stubs — replaced with real test bodies in the Wave 1/2 plan that
 * implements the route. Receives exit metadata from the runner and drives
 * the retry-vs-terminal decision based on runner_max_attempts.
 */

import { describe, it } from 'vitest'

describe('POST /api/runner/tasks/:task_id/runner-exit', () => {
  it.todo(
    'RUNNER-11: does NOT re-increment runner_attempts (claim owns the increment); inserts task_runner_attempts row with exit_code + reason',
  )
  it.todo(
    'RUNNER-11: when runner_attempts < resolved cap, status transitions in_progress→assigned and container_id is cleared to allow reclaim',
  )
  it.todo(
    'RUNNER-11: when runner_attempts >= resolved cap, status transitions to failed and runner_last_failure_reason is populated',
  )
  it.todo(
    'WORK-06: cap resolution precedence is task.runner_max_attempts ?? recipe.max_attempts ?? 3',
  )
  it.todo(
    'RUNNER-11: clears container_id on non-terminal exit so the next claim can reassign a new container_id',
  )
  it.todo('RUNNER-11: rejects requests whose bearer is not the runner-secret with 401')
})
