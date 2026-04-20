/**
 * Test scaffold for GET /api/runner/ready-tasks (Plan 14-04).
 *
 * Wave 0 stubs — replaced with real test bodies in the Wave 1/2 plan that
 * implements the route. See 14-03-PLAN.md for the requirement→test mapping.
 */

import { describe, it } from 'vitest'

describe('GET /api/runner/ready-tasks', () => {
  it.todo(
    'RUNNER-04: returns tasks where status=assigned AND recipe_slug IS NOT NULL AND container_id IS NULL',
  )
  it.todo('RUNNER-04: excludes tasks that already have a container_id (already claimed)')
  it.todo(
    'RUNNER-04: includes task.model_override in payload when set so runner can forward via MC_MODEL_PRIMARY',
  )
  it.todo('RUNNER-04: rejects requests whose bearer is not the runner-secret with 401')
})
