/**
 * Runner log-layout helper (Phase 14 Plan 08a).
 *
 * Pure-filesystem helpers implementing the locked log directory layout from
 * 14-CONTEXT.md "On-Disk Layout & Retention":
 *
 *   .data/runner/logs/task-<id>/
 *     ├── attempt-<n>/
 *     │   ├── stdout.log
 *     │   ├── stderr.log
 *     │   └── meta.json   { started_at, runner_id, container_id,
 *     │                     exited_at?, exit_code?, reason? }
 *     └── latest → attempt-<n>/   (symlink, RELATIVE target)
 *
 * Side-effect surface is scoped to the `dataDir` passed by the caller so
 * tests can point at a per-test tmpdir for isolation. The runner daemon
 * (`scripts/mc-runner.mjs`) inlines these helpers at build time; this file
 * is the canonical contract + test surface.
 *
 * meta.json lifecycle:
 *   ensureAttemptDir → writes {started_at, runner_id, container_id}
 *   finalizeMeta     → merges {exited_at, exit_code, reason} on container exit
 *
 * The `latest` symlink uses a RELATIVE target (just `attempt-<n>`) so the
 * entire logs directory stays portable if it is moved.
 */

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface LogPaths {
  /** Absolute path to `.data/runner/logs/task-<id>/attempt-<n>/`. */
  attemptDir: string
  /** Absolute path to the attempt's stdout.log. */
  stdoutLog: string
  /** Absolute path to the attempt's stderr.log. */
  stderrLog: string
  /** Absolute path to the attempt's meta.json. */
  metaJson: string
  /** Absolute path to the `latest` symlink that points to the current attempt dir. */
  latestSymlink: string
  /** Absolute path to `.data/runner/logs/task-<id>/`. */
  taskLogRoot: string
}

export interface AttemptMetaInit {
  /** ISO 8601 timestamp when the attempt started. */
  started_at: string
  /** Runner daemon identity (from the label schema). */
  runner_id: string
  /** Container ID if available at attempt start; null until Plan 14-11 container-started posts. */
  container_id: string | null
}

export interface AttemptMetaExit {
  /** ISO 8601 timestamp when the container exited. */
  exited_at: string
  /** Container exit code (null when the container was killed by signal without an exit code). */
  exit_code: number | null
  /** Human-readable reason: 'normal', 'timeout', 'crash', 'killed-by-runner', etc. */
  reason: string
}

/**
 * Resolve all log paths for a given task + attempt. Pure function — performs
 * no filesystem I/O; safe to call in hot paths.
 */
export function resolveLogPaths(
  dataDir: string,
  taskId: number | string,
  attempt: number,
): LogPaths {
  const taskLogRoot = join(dataDir, 'runner', 'logs', `task-${taskId}`)
  const attemptDir = join(taskLogRoot, `attempt-${attempt}`)
  return {
    attemptDir,
    stdoutLog: join(attemptDir, 'stdout.log'),
    stderrLog: join(attemptDir, 'stderr.log'),
    metaJson: join(attemptDir, 'meta.json'),
    latestSymlink: join(taskLogRoot, 'latest'),
    taskLogRoot,
  }
}

/**
 * Create the attempt directory and seed it with empty stdout.log / stderr.log
 * and a meta.json carrying the attempt-init fields. Pre-creating the log
 * files gives `docker logs -f` stable destination fds.
 *
 * Idempotent: calling twice on the same attempt overwrites meta.json with
 * the latest init values and leaves any existing log content in place
 * (opened in append mode).
 */
export function ensureAttemptDir(paths: LogPaths, meta: AttemptMetaInit): void {
  mkdirSync(paths.attemptDir, { recursive: true, mode: 0o700 })
  // 'a' mode creates the file if absent and leaves existing contents intact.
  // Ensures the fds exist before `docker logs -f` opens them for append.
  closeSync(openSync(paths.stdoutLog, 'a', 0o600))
  closeSync(openSync(paths.stderrLog, 'a', 0o600))
  writeFileSync(paths.metaJson, JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 })
}

/**
 * Replace `latest` so it points to `attempt-<n>`. Target is RELATIVE so the
 * symlink stays valid if the entire logs dir is moved.
 *
 * rmSync with force:true swallows ENOENT, so the first call (no prior
 * symlink) is not a special case.
 */
export function updateLatestSymlink(paths: LogPaths, attempt: number): void {
  rmSync(paths.latestSymlink, { force: true })
  symlinkSync(`attempt-${attempt}`, paths.latestSymlink, 'dir')
}

/**
 * Merge the exit fields into meta.json on container exit. Preserves any
 * init fields already present (started_at, runner_id, container_id).
 *
 * Defensive: if meta.json is missing or malformed, write a fresh file
 * containing only the exit fields rather than throwing — finalization must
 * not fail just because the init step crashed between mkdir and writeFile.
 */
export function finalizeMeta(paths: LogPaths, exitFields: AttemptMetaExit): void {
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(readFileSync(paths.metaJson, 'utf8')) as Record<string, unknown>
  } catch {
    // missing or malformed — start fresh
  }
  const merged = { ...existing, ...exitFields }
  writeFileSync(paths.metaJson, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 })
}
