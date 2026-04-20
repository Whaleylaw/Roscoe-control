/**
 * Test scaffold for docker run argv composition (Plan 14-09).
 *
 * Wave 0 stubs — replaced with real test bodies in the Wave 1/2 plan that
 * implements src/lib/runner-docker-args.ts. Pure argv-string composition;
 * no child_process spawn, no Docker daemon dependency.
 */

import { describe, it } from 'vitest'

describe('runner docker-run argv composition', () => {
  it.todo("RUNNER-10: argv starts with ['run', '--rm', '-d']")
  it.todo(
    'CONTAINER-02: mount flags map worktree→/workspace:rw, recipe-stage→/recipe:ro, each read_only_mount→/refs/<label>/:ro, each extra_skill→/skills/<basename>:ro',
  )
  it.todo(
    'RUNNER-10: labels include mc.task_id, mc.recipe_slug, mc.attempt, mc.runner_id, mc.runner_started_at',
  )
  it.todo('RUNNER-10: --name equals "mc-task-<task_id>-a<attempt>" (e.g., mc-task-42-a3)')
  it.todo('CONTAINER-03: --add-host host.docker.internal:host-gateway is always present')
  it.todo(
    'RUNNER-10: --memory uses resolved precedence (recipe.memory_limit ?? runner-default 2g; task.resource_override is reserved, not applied)',
  )
  it.todo(
    'RUNNER-10: --cpus uses same precedence (recipe.cpu_limit ?? runner-default 1.0; task.resource_override reserved)',
  )
  it.todo(
    'CONTAINER-01: no --env flag on argv contains the MC_API_TOKEN value — secrets pass via --env-file only',
  )
})
