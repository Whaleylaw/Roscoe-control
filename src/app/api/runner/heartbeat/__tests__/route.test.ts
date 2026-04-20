/**
 * Test scaffold for POST /api/runner/heartbeat (Plan 14-04).
 *
 * Wave 0 stubs — replaced with real test bodies in the Wave 1/2 plan that
 * implements the route. See 14-03-PLAN.md for the requirement→test mapping
 * and the source of these stubs (Phase 14 Research doc, Test Map table).
 */

import { describe, it } from 'vitest'

describe('POST /api/runner/heartbeat', () => {
  it.todo(
    'RUNNER-05: accepts runner_id + ts, upserts runner_heartbeats row with last_heartbeat_at',
  )
  it.todo('RUNNER-05: rejects requests missing Authorization: Bearer header with 401')
  it.todo('RUNNER-05: rejects bearer that is not the runner-secret with 401')
  it.todo('RUNNER-05: mutationLimiter rate-limits repeated heartbeats from the same IP')
})
