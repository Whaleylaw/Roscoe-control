/**
 * Worktree `.mc/` helpers (WORK-01, WORK-02).
 *
 * Pure filesystem primitives the runner uses to seed and maintain the `.mc/`
 * directory inside a per-task git worktree. No child_process, no HTTP — just
 * fs.mkdirSync / fs.writeFileSync / fs.readFileSync against a provided
 * worktree path. Unit-testable against os.tmpdir().
 *
 * Seed shape (locked by WORK-02):
 *
 *   .mc/task.json         — JSON of type McTaskJson (attempt counter + prior_attempts)
 *   .mc/progress.md       — agent's append-only work log
 *   .mc/checkpoints.jsonl — one JSON object per line, one per checkpoint
 *   .mc/.gitignore        — literal "*\n" so the agent's git history never carries runner state
 *
 * Resume semantics:
 *   - task.json is ALWAYS rewritten (new attempt counter + prior_attempts[])
 *   - progress.md / checkpoints.jsonl are PRESERVED if they already exist
 *   - .gitignore is re-written every time (idempotent single-line file)
 */

import fs from 'node:fs'
import path from 'node:path'

export interface PriorAttemptIso {
  started_at: string // ISO 8601 (WORK-02 shape — NOT the unix-seconds from runner-preamble)
  exit_code: number | null
  failure_reason: string | null
}

export interface McTaskJson {
  task_id: string
  recipe_slug: string
  attempt: number
  is_resuming: boolean
  prior_attempts: PriorAttemptIso[]
}

function mcDir(worktreePath: string): string {
  return path.join(worktreePath, '.mc')
}

function taskJsonPath(worktreePath: string): string {
  return path.join(mcDir(worktreePath), 'task.json')
}

function progressPath(worktreePath: string): string {
  return path.join(mcDir(worktreePath), 'progress.md')
}

function checkpointsPath(worktreePath: string): string {
  return path.join(mcDir(worktreePath), 'checkpoints.jsonl')
}

function gitignorePath(worktreePath: string): string {
  return path.join(mcDir(worktreePath), '.gitignore')
}

/**
 * Write `.mc/task.json` with 0600 perms. Idempotent — overwrites any prior
 * content (the file shape is single-JSON-value, not appended).
 */
export function writeMcTaskJson(worktreePath: string, task: McTaskJson): void {
  const filePath = taskJsonPath(worktreePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  // writeFileSync mode only applies on CREATE. Remove first to guarantee 0600
  // even if an operator loosened perms on a prior run.
  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    // non-fatal — writeFileSync surfaces the real error if any
  }
  fs.writeFileSync(filePath, JSON.stringify(task, null, 2), { mode: 0o600 })
}

/**
 * Read `.mc/task.json`. Returns null on ENOENT or parse failure so callers
 * can treat "no task.json yet" the same as "corrupt task.json" without a
 * try/catch — matches the defensive-default pattern from Phase 13.
 */
export function readMcTaskJson(worktreePath: string): McTaskJson | null {
  let raw: string
  try {
    raw = fs.readFileSync(taskJsonPath(worktreePath), 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(raw) as McTaskJson
  } catch {
    return null
  }
}

/**
 * Convert a unix-seconds prior-attempt entry into the WORK-02 ISO-string shape.
 *
 * The runner's in-memory attempt record is unix seconds (cheaper to compare /
 * serialise to SQLite); task.json is ISO per the locked shape.
 */
export function buildPriorAttemptsEntry(
  startedAtUnix: number,
  exitCode: number | null,
  reason: string | null,
): PriorAttemptIso {
  return {
    started_at: new Date(startedAtUnix * 1000).toISOString(),
    exit_code: exitCode,
    failure_reason: reason,
  }
}

export interface SeedMcDirInput {
  task: McTaskJson
  /**
   * Phase 15 CP-04: when the task resumes AFTER a blocker, the marker
   * is appended as a single visible line to progress.md. Ignored on
   * first attempts (is_resuming=false). Null / undefined means no marker.
   *
   * Marker format (LOCKED by 15-CONTEXT.md):
   *   <at_iso> | <<< RESUMED AFTER BLOCKER: <blocker_reason> >>>
   */
  resume_marker?: { blocker_reason: string; at_iso: string } | null
}

/**
 * Seed `.mc/` for a given attempt.
 *
 * On a first attempt (is_resuming=false): create the dir, write task.json,
 * write an empty progress.md (with a small header), write an empty
 * checkpoints.jsonl, write .gitignore. `resume_marker` is IGNORED on first
 * attempts — first attempts are never marker-prefixed.
 *
 * On a resume attempt (is_resuming=true): create the dir if absent, REWRITE
 * task.json with the new attempt counter + prior_attempts, PRESERVE existing
 * progress.md and checkpoints.jsonl (no overwrite), rewrite .gitignore.
 * If `resume_marker` is provided, append a single marker line to progress.md
 * AFTER the defensive fallback ensures the file exists.
 *
 * mkdirSync recursive is idempotent — calling seedMcDir twice is safe.
 */
export function seedMcDir(worktreePath: string, input: SeedMcDirInput): void {
  const { task, resume_marker } = input
  fs.mkdirSync(mcDir(worktreePath), { recursive: true })

  // task.json is always rewritten (new attempt counter on resume, fresh shape on first attempt)
  writeMcTaskJson(worktreePath, task)

  // progress.md + checkpoints.jsonl: created on first attempt, preserved on resume
  if (!task.is_resuming) {
    // First attempt — unchanged from Phase 14. resume_marker is IGNORED.
    const progressHeader = `# Progress — Task ${task.task_id}\n\n`
    fs.writeFileSync(progressPath(worktreePath), progressHeader)
    fs.writeFileSync(checkpointsPath(worktreePath), '')
  } else {
    // Defensive: if an operator wiped the worktree but re-marked is_resuming,
    // create empty files so the agent's append-only write doesn't ENOENT.
    if (!fs.existsSync(progressPath(worktreePath))) {
      fs.writeFileSync(progressPath(worktreePath), `# Progress — Task ${task.task_id}\n\n`)
    }
    if (!fs.existsSync(checkpointsPath(worktreePath))) {
      fs.writeFileSync(checkpointsPath(worktreePath), '')
    }

    // Phase 15 CP-04: append the blocker-resume marker line if provided.
    // The agent's preamble reads progress.md at startup, so this surfaces
    // the blocker reason without expanding the runtime env surface.
    if (resume_marker) {
      const line = `${resume_marker.at_iso} | <<< RESUMED AFTER BLOCKER: ${resume_marker.blocker_reason} >>>\n`
      fs.appendFileSync(progressPath(worktreePath), line)
    }
  }

  // .gitignore contents are LITERALLY "*\n" per CONTEXT.md. Always rewrite —
  // single-line file, idempotent.
  fs.writeFileSync(gitignorePath(worktreePath), '*\n')
}
