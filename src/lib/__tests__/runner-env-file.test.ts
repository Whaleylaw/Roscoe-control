/**
 * Test scaffold for runner env-file generation (Plan 14-09).
 *
 * Wave 0 stubs — replaced with real test bodies in the Wave 1/2 plan that
 * implements src/lib/runner-env-file.ts. Secrets flow via --env-file, not
 * argv, so their values never surface in `ps`, `docker inspect` args, or
 * container labels.
 */

import { describe, it } from 'vitest'

describe('runner env-file generation', () => {
  it.todo(
    'CONTAINER-01: env-file contents include MC_API_URL, MC_TASK_ID, MC_API_TOKEN, MC_WORKSPACE, MC_RECIPE_PATH, MC_PREAMBLE_PATH, MC_MODEL_PRIMARY, MC_MODEL_PROVIDER, and MC_MODEL_PARAMS_JSON',
  )
  it.todo(
    'CONTAINER-01: env-file file permissions are 0600 on disk (owner read/write only)',
  )
  it.todo(
    'CONTAINER-01: env-file carries recipe-declared secrets sourced from .data/runner/secrets/<NAME>',
  )
  it.todo(
    'CONTAINER-01: env-file path is deterministic per (task_id, attempt) so cleanup is precise',
  )
  it.todo(
    'CONTAINER-01: env-file is unlinked after container exit (success or failure) — no lingering secrets on disk',
  )
})
