/**
 * Test scaffold for POST /api/runner/claim/:task_id (Plan 14-05).
 *
 * Wave 0 stubs — replaced with real test bodies in the Wave 1/2 plan that
 * implements the claim route. See 14-03-PLAN.md for the requirement→test
 * mapping and the source stubs in 14-RESEARCH.md Test Map.
 */

import { describe, it } from 'vitest'

describe('POST /api/runner/claim/:task_id', () => {
  it.todo(
    'RUNNER-06: atomic claim transitions status assigned→in_progress and writes container_id + runner_started_at + runner_attempts+=1 in one transaction',
  )
  it.todo('RUNNER-06: returns 409 when a second claim attempts on an already-claimed task')
  it.todo('RUNNER-06: returns 409 when task.status is not assigned at claim time')
  it.todo(
    'RUNNER-07: re-validates read_only_mounts against the allowlist at claim time and rejects with OUT_OF_ALLOWLIST on escape',
  )
  it.todo(
    'RUNNER-07: re-validates extra_skills against the skill allowlist at claim time and rejects with SKILL_NOT_ALLOWED',
  )
  it.todo('RUNNER-08: returns 409 when the global MAX_CONCURRENT_CONTAINERS cap is reached')
  it.todo(
    'RUNNER-08: returns 409 when the per-recipe max_concurrent cap is reached for recipe.slug',
  )
  it.todo(
    'MODEL-04: dispatch payload env.MC_MODEL_PRIMARY resolves to task.model_override when set, else recipe.model.primary',
  )
  it.todo(
    'RUNNER-06: issued runner-token expires at runner_started_at + recipe.timeout_seconds + 60s',
  )
  it.todo(
    'RUNNER-06: dispatch payload includes recipe body (env/secrets/soul_md/limits) + task.is_resuming + task.prior_attempts',
  )
})
