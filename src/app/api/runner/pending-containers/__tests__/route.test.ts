/**
 * Test scaffold for GET /api/runner/pending-containers (Plan 14-04).
 *
 * Wave 0 stubs — replaced with real test bodies in the Wave 1/2 plan that
 * implements the route. Used by the runner's startup reconciliation step.
 */

import { describe, it } from 'vitest'

describe('GET /api/runner/pending-containers', () => {
  it.todo(
    'RUNNER-13: returns tasks with container_id IS NOT NULL AND status IN (assigned, in_progress)',
  )
  it.todo('RUNNER-13: excludes tasks in terminal status (done, failed, cancelled)')
  it.todo('RUNNER-13: rejects requests whose bearer is not the runner-secret with 401')
})
