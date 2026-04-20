/**
 * Docker runtime primitives for the runner daemon (CONTAINER-01, CONTAINER-02, RUNNER-09, RUNNER-10).
 *
 * Three concerns, one module:
 *
 *   1. buildDockerRunArgs(input) -> string[]
 *      Compose the argv passed to `spawn('docker', argv, ...)`. No shell. No
 *      secrets in the argv — secrets flow via --env-file only (CONTAINER-01).
 *
 *   2. stageRecipe({ sourceDir, stageDir, preambleContents }) -> Promise<void>
 *      Deep-copy a recipe directory to the runner's recipe-stage area, then
 *      write PREAMBLE.md AFTER the copy so the runner-authored preamble
 *      overrides any recipe-authored PREAMBLE.md.
 *
 *   3. writeEnvFile({ envMap, filePath }) / cleanupEnvFile(filePath)
 *      Per-task env-file on disk with mode 0600. Secrets live here, not in argv.
 *      Cleanup ignores ENOENT so double-cleanup is safe.
 *
 * Pure logic — no spawn, no HTTP. Testable with os.tmpdir().
 */

import fs from 'node:fs'
import path from 'node:path'

export interface ReadOnlyMount {
  host_path: string
  container_path?: string // optional override; default /refs/<slugify(label)>
  label: string
}

export interface DockerRunInput {
  image: string
  taskId: number | string
  attempt: number
  recipeSlug: string
  runnerId: string
  runnerStartedAtIso: string
  containerName: string // e.g. 'mc-task-42-a3'
  worktreePath: string // host abs path — mounts /workspace:rw
  recipeStagePath: string // host abs path — mounts /recipe:ro
  readOnlyMounts: ReadOnlyMount[]
  extraSkills: string[] // host abs paths — mount basename under /skills/:ro
  envFilePath: string
  memory: string // '2g'
  cpus: number // 1.0
  networkHostGateway?: boolean // defaults true
}

export interface StageRecipeInput {
  sourceDir: string // recipes/<slug>/
  stageDir: string // .data/runner/recipe-stage/task-<id>/
  preambleContents: string
}

export interface EnvFileInput {
  envMap: Record<string, string>
  filePath: string
}

/**
 * Slugify a mount label for use as a container path segment.
 *
 * Lowercase, non-alnum replaced with '-', collapsed runs, leading/trailing
 * '-' stripped. `My Ref #01` -> `my-ref-01`.
 *
 * Exported so consumers (claim route, tests) reuse the exact same
 * transformation the runner will apply — no divergence across call sites.
 */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Build the docker run argv.
 *
 * Order matters:
 *   - 'run' --rm -d come first
 *   - --name next (so --rm flag parses cleanly in older docker builds)
 *   - labels before resource caps so they appear in `docker ps --format`
 *   - mounts after env-file (env-file read before process start)
 *   - image LAST — everything after image would be treated as container argv
 *
 * CONTAINER-01 invariant: no --env flag on the argv ever carries the
 * MC_API_TOKEN value. Secrets flow via --env-file. This is asserted in the
 * companion test suite.
 */
export function buildDockerRunArgs(input: DockerRunInput): string[] {
  const {
    image,
    taskId,
    attempt,
    recipeSlug,
    runnerId,
    runnerStartedAtIso,
    containerName,
    worktreePath,
    recipeStagePath,
    readOnlyMounts,
    extraSkills,
    envFilePath,
    memory,
    cpus,
    networkHostGateway,
  } = input

  const argv: string[] = [
    'run',
    '--rm',
    '-d',
    '--name',
    containerName,
    '--label',
    `mc.task_id=${taskId}`,
    '--label',
    `mc.recipe_slug=${recipeSlug}`,
    '--label',
    `mc.attempt=${attempt}`,
    '--label',
    `mc.runner_id=${runnerId}`,
    '--label',
    `mc.runner_started_at=${runnerStartedAtIso}`,
    '--memory',
    memory,
    '--cpus',
    String(cpus),
  ]

  if (networkHostGateway !== false) {
    argv.push('--add-host', 'host.docker.internal:host-gateway')
  }

  argv.push('--env-file', envFilePath)
  argv.push('-v', `${worktreePath}:/workspace:rw`)
  argv.push('-v', `${recipeStagePath}:/recipe:ro`)

  for (const mount of readOnlyMounts) {
    const containerPath = mount.container_path ?? `/refs/${slugify(mount.label)}`
    argv.push('-v', `${mount.host_path}:${containerPath}:ro`)
  }

  for (const skill of extraSkills) {
    argv.push('-v', `${skill}:/skills/${path.basename(skill)}:ro`)
  }

  argv.push(image)
  return argv
}

/**
 * Deep-copy a recipe source directory into the runner's recipe-stage area,
 * then write PREAMBLE.md with the runner-authored contents.
 *
 * Called at claim time. The stage path MUST resolve outside
 * MISSION_CONTROL_RECIPES_DIR or the chokidar watcher (Plan 12-03) will
 * re-index the staged copy — tested at the callsite, not here.
 *
 * fs.promises.cp (Node 20+; stable in 22+) handles recursive directory copy
 * including nested tools/ and skills/. We write PREAMBLE.md AFTER cp so even
 * if a recipe author ships their own PREAMBLE.md the runner's version
 * overwrites it (the agent reads /recipe/PREAMBLE.md — the runner owns it).
 */
export async function stageRecipe(input: StageRecipeInput): Promise<void> {
  const { sourceDir, stageDir, preambleContents } = input
  await fs.promises.mkdir(stageDir, { recursive: true })
  await fs.promises.cp(sourceDir, stageDir, { recursive: true, force: true })
  await fs.promises.writeFile(path.join(stageDir, 'PREAMBLE.md'), preambleContents)
}

/**
 * Escape a value for an env-file.
 *
 * Env-file format is newline-separated `KEY=VALUE`. Embedded newlines in a
 * value would break the format, so we defensively replace them with a space.
 * Real secrets should never contain a literal `\n` but external inputs
 * (recipe.env forwarded verbatim) make this a belt-and-suspenders guard.
 */
function sanitiseValue(raw: string): string {
  return raw.replace(/\r?\n/g, ' ')
}

/**
 * Write KEY=VALUE lines to an env-file with mode 0600. Atomic semantics
 * aren't required (the file is per-task-per-attempt and only written once
 * before container launch) so this is a plain writeFileSync.
 *
 * Pre-removes the target to guarantee 0600 on OSes where writeFileSync mode
 * only applies on CREATE.
 */
export function writeEnvFile(input: EnvFileInput): void {
  const { envMap, filePath } = input
  const lines: string[] = []
  for (const [key, value] of Object.entries(envMap)) {
    lines.push(`${key}=${sanitiseValue(value)}`)
  }
  const body = lines.join('\n') + '\n'

  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    // non-fatal
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, body, { mode: 0o600 })
}

/**
 * Unlink an env-file after the container exits. ENOENT is swallowed so a
 * runner crash mid-cleanup (or a double-call from the retry path) is safe.
 */
export function cleanupEnvFile(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    // swallow — nothing to clean up is not an error
  }
}
