/**
 * Unit tests for docker-run argv composition (Plan 14-07 / RUNNER-10, CONTAINER-01, CONTAINER-02, CONTAINER-03).
 *
 * Pure argv-string composition — no child_process spawn, no Docker daemon
 * dependency. Replaces the Wave-0 it.todo scaffold from Plan 14-03.
 */

import { describe, it, expect } from 'vitest'
import { buildDockerRunArgs, slugify, type DockerRunInput } from '../runner-docker'

function baseInput(overrides: Partial<DockerRunInput> = {}): DockerRunInput {
  return {
    image: 'mc-hello-world-agent:latest',
    taskId: 42,
    attempt: 3,
    recipeSlug: 'hello-world',
    runnerId: 'runner-local',
    runnerStartedAtIso: '2026-04-20T14:03:00.000Z',
    containerName: 'mc-task-42-a3',
    worktreePath: '/Users/op/.data/runner/worktrees/task-42',
    recipeStagePath: '/Users/op/.data/runner/recipe-stage/task-42',
    readOnlyMounts: [],
    extraSkills: [],
    envFilePath: '/tmp/mc-task-42-a3.env',
    memory: '2g',
    cpus: 1.0,
    networkHostGateway: true,
    ...overrides,
  }
}

describe('runner docker-run argv composition', () => {
  it("RUNNER-10: argv starts with ['run', '-d'] and does not auto-remove before docker wait", () => {
    const argv = buildDockerRunArgs(baseInput())
    expect(argv.slice(0, 2)).toEqual(['run', '-d'])
    expect(argv).not.toContain('--rm')
  })

  it('CONTAINER-02: mount flags map worktree->/workspace:rw, recipe-stage->/recipe:ro, read_only_mount->/refs/<slug>:ro, extra_skill->/skills/<basename>:ro', () => {
    const argv = buildDockerRunArgs(
      baseInput({
        readOnlyMounts: [{ host_path: '/docs/specs', label: 'Specs Folder' }],
        extraSkills: ['/home/user/skills/lint.md', '/home/user/skills/qa.md'],
      }),
    )
    expect(argv).toContain('-v')
    expect(argv).toContain(
      '/Users/op/.data/runner/worktrees/task-42:/workspace:rw',
    )
    expect(argv).toContain(
      '/Users/op/.data/runner/recipe-stage/task-42:/recipe:ro',
    )
    expect(argv).toContain('/docs/specs:/refs/specs-folder:ro')
    expect(argv).toContain('/home/user/skills/lint.md:/skills/lint.md:ro')
    expect(argv).toContain('/home/user/skills/qa.md:/skills/qa.md:ro')
  })

  it('CONTAINER-02: can mount a constrained workspace subpath as /workspace', () => {
    const argv = buildDockerRunArgs(
      baseInput({
        worktreePath: '/Users/op/.data/runner/worktrees/task-42',
        workspaceMountPath: '/Users/op/.data/runner/worktrees/task-42/cases/abby-sitgraves',
      }),
    )
    expect(argv).toContain(
      '/Users/op/.data/runner/worktrees/task-42/cases/abby-sitgraves:/workspace:rw',
    )
    expect(argv).not.toContain(
      '/Users/op/.data/runner/worktrees/task-42:/workspace:rw',
    )
  })

  it('RUNNER-10: labels include mc.task_id, mc.recipe_slug, mc.attempt, mc.runner_id, mc.runner_started_at', () => {
    const argv = buildDockerRunArgs(baseInput())
    expect(argv).toContain('mc.task_id=42')
    expect(argv).toContain('mc.recipe_slug=hello-world')
    expect(argv).toContain('mc.attempt=3')
    expect(argv).toContain('mc.runner_id=runner-local')
    expect(argv).toContain('mc.runner_started_at=2026-04-20T14:03:00.000Z')
  })

  it('RUNNER-10: --name equals "mc-task-<task_id>-a<attempt>" when caller passes it', () => {
    const argv = buildDockerRunArgs(baseInput({ containerName: 'mc-task-42-a3' }))
    const nameIdx = argv.indexOf('--name')
    expect(nameIdx).toBeGreaterThanOrEqual(0)
    expect(argv[nameIdx + 1]).toBe('mc-task-42-a3')
  })

  it('CONTAINER-03: --add-host host.docker.internal:host-gateway present when networkHostGateway !== false', () => {
    const withDefault = buildDockerRunArgs(baseInput({ networkHostGateway: undefined }))
    expect(withDefault).toContain('--add-host')
    expect(withDefault).toContain('host.docker.internal:host-gateway')

    const explicitTrue = buildDockerRunArgs(baseInput({ networkHostGateway: true }))
    expect(explicitTrue).toContain('host.docker.internal:host-gateway')

    const disabled = buildDockerRunArgs(baseInput({ networkHostGateway: false }))
    expect(disabled).not.toContain('host.docker.internal:host-gateway')
  })

  it('RUNNER-10: --memory uses resolved memory string; --cpus uses resolved cpus number stringified', () => {
    const argv = buildDockerRunArgs(baseInput({ memory: '4g', cpus: 2.5 }))
    const memIdx = argv.indexOf('--memory')
    const cpuIdx = argv.indexOf('--cpus')
    expect(argv[memIdx + 1]).toBe('4g')
    expect(argv[cpuIdx + 1]).toBe('2.5')
  })

  it('CONTAINER-01: no argv element contains "MC_API_TOKEN=" — secrets pass via --env-file only', () => {
    const argv = buildDockerRunArgs(baseInput())
    for (const entry of argv) {
      expect(entry).not.toContain('MC_API_TOKEN=')
    }
    // sanity: --env-file flag IS present
    expect(argv).toContain('--env-file')
  })

  it('slugify produces "my-ref-01" for label "My Ref #01" (and handles collapses/trim)', () => {
    expect(slugify('My Ref #01')).toBe('my-ref-01')
    expect(slugify('  leading-and-trailing  ')).toBe('leading-and-trailing')
    expect(slugify('unicode émoji 🎉 ref')).toBe('unicode-moji-ref')
    expect(slugify('A/B_C D')).toBe('a-b-c-d')
  })

  it('image is the last positional argv element (guards against flag ordering bugs)', () => {
    const argv = buildDockerRunArgs(baseInput({ image: 'mc-hello-world-agent:latest' }))
    expect(argv[argv.length - 1]).toBe('mc-hello-world-agent:latest')
  })
})
