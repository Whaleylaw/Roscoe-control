/**
 * Runner preamble generator (WORK-04, WORK-05).
 *
 * Pure-function generation of the `/recipe/PREAMBLE.md` text that the runner
 * writes at claim time. Two variants:
 *
 *   - first-attempt: short intro + filesystem contract + checkpoint + submit
 *     HTTP skeleton (≈ 30-50 non-blank lines)
 *   - resume: longer — mandatory read-first steps + reconciliation rules +
 *     prior-attempts summary + the same checkpoint + submit HTTP skeleton
 *     (≈ 35-55 non-blank lines)
 *
 * Tool-agnostic: no Claude Code / Aegis / any specific agent runtime is
 * assumed. Phrasing uses generic "read this file", "run this command", "POST
 * to this URL". The contract surface is file-system + HTTP + env vars.
 *
 * Deterministic: given identical inputs the output is byte-stable. No
 * Date.now(), no random. Callers that need a timestamp in the generated text
 * must pass it in via `priorAttempts[].started_at` (unix seconds).
 *
 * The output is returned as-is (no leading BOM). Body ends with a single
 * trailing newline so `fs.writeFileSync(path, text)` yields a well-formed
 * Markdown file.
 */

export interface PriorAttempt {
  started_at: number // unix seconds
  exit_code: number | null
  failure_reason: string | null
}

export interface PreambleInput {
  isResuming: boolean
  taskId: number | string
  apiBase: string // e.g. 'http://host.docker.internal:3000'
  priorAttempts: PriorAttempt[]
}

function isoFromUnix(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString()
}

function formatPriorAttempts(attempts: PriorAttempt[]): string {
  if (attempts.length === 0) {
    return '- (no prior attempts recorded)'
  }
  return attempts
    .map((a, idx) => {
      const when = isoFromUnix(a.started_at)
      const code = a.exit_code === null ? 'null' : String(a.exit_code)
      const reason = a.failure_reason === null ? 'null' : a.failure_reason
      return `- attempt ${idx + 1}: started_at=${when}, exit_code=${code}, failure_reason=${reason}`
    })
    .join('\n')
}

/**
 * Checkpoint + submit HTTP skeleton shared by both variants.
 *
 * Phase 14 does NOT wire /api/runner/checkpoint live — Phase 15 does. The
 * preamble copy still forward-references the endpoint so the copy stays
 * stable across the Phase 14/15 boundary.
 *
 * The /submit endpoint reference uses the /api/runner/tasks/:id/submit path
 * (per the runner-token allowlist in src/lib/runner-tokens.ts). This closes
 * the blocker where agents called PUT /api/tasks/:id and hit the runner-token
 * allowlist reject.
 */
function buildHttpSkeleton(apiBase: string): string {
  return [
    '## Emitting checkpoints',
    '',
    'As you make progress, POST a checkpoint so Mission Control and any watcher can follow along:',
    '',
    '```',
    `POST ${apiBase}/api/runner/checkpoint`,
    'Authorization: Bearer $MC_API_TOKEN',
    'Content-Type: application/json',
    '',
    '{ "task_id": $MC_TASK_ID, "step": "short-slug", "status": "in_progress", "summary": "what you just did" }',
    '```',
    '',
    '## Finishing',
    '',
    'When finished, POST your result to the submit endpoint, then exit with code 0:',
    '',
    '```',
    `POST ${apiBase}/api/runner/tasks/$MC_TASK_ID/submit`,
    'Authorization: Bearer $MC_API_TOKEN',
    'Content-Type: application/json',
    '',
    '{ "status": "done" }',
    '```',
  ].join('\n')
}

function buildFirstAttemptPreamble(input: PreambleInput): string {
  const { apiBase, taskId } = input
  const lines: string[] = []
  lines.push(`# Task ${taskId} — Runner Preamble (first attempt)`)
  lines.push('')
  lines.push('You are running inside an ephemeral container spawned by Mission Control.')
  lines.push(
    'This preamble is the runner-authored contract; the recipe author\'s SOUL.md ships next.',
  )
  lines.push('')
  lines.push('## Environment')
  lines.push('')
  lines.push('These environment variables are set inside the container:')
  lines.push('')
  lines.push('- `MC_TASK_ID` — the task identifier')
  lines.push('- `MC_API_URL` — Mission Control base URL (reach it via host-gateway)')
  lines.push('- `MC_API_TOKEN` — per-task runner bearer; short-lived, task-scoped')
  lines.push('- `MC_MODEL_PRIMARY` — the model identifier resolved for this task')
  lines.push('- `MC_WORKSPACE` — absolute path to the mounted worktree (`/workspace`)')
  lines.push('- `MC_RECIPE_PATH` — absolute path to the read-only recipe mount (`/recipe`)')
  lines.push('- `MC_PREAMBLE_PATH` — path to THIS file; read it first, then `/recipe/SOUL.md`')
  lines.push('')
  lines.push('## Filesystem contract')
  lines.push('')
  lines.push(
    'Read `/recipe/SOUL.md` after this file — it is the task-specific instructions authored with the recipe.',
  )
  lines.push('')
  lines.push('As you work, append a line to `/workspace/.mc/progress.md` for each meaningful step:')
  lines.push('')
  lines.push('```')
  lines.push('2026-04-20T14:03:00Z | parsed recipe, identified target files')
  lines.push('```')
  lines.push('')
  lines.push('Append a JSON line to `/workspace/.mc/checkpoints.jsonl` for each checkpoint you emit:')
  lines.push('')
  lines.push('```')
  lines.push(
    '{"step":"parse-recipe","status":"completed","summary":"identified 3 target files","ts":"2026-04-20T14:03:00Z"}',
  )
  lines.push('```')
  lines.push('')
  lines.push(buildHttpSkeleton(apiBase))
  lines.push('')
  return lines.join('\n') + '\n'
}

function buildResumePreamble(input: PreambleInput): string {
  const { apiBase, taskId, priorAttempts } = input
  const attemptNumber = priorAttempts.length + 1
  const lines: string[] = []
  lines.push(`# Task ${taskId} — Runner Preamble (resume, attempt ${attemptNumber})`)
  lines.push('')
  lines.push(
    `This is attempt ${attemptNumber} (is_resuming=true). Do NOT redo prior work — reconcile with it.`,
  )
  lines.push('You are running inside an ephemeral container spawned by Mission Control.')
  lines.push('')
  lines.push('## Mandatory first steps (in order)')
  lines.push('')
  lines.push('1. read .mc/task.json — attempt counter and prior_attempts summary')
  lines.push('2. read .mc/progress.md — append-only work log from prior attempts')
  lines.push('3. read .mc/checkpoints.jsonl — one JSON line per checkpoint')
  lines.push('4. run `git -C /workspace status` to see uncommitted changes')
  lines.push('5. run `git -C /workspace log --oneline` to see what was committed previously')
  lines.push('6. re-read /recipe/SOUL.md for the task-specific instructions')
  lines.push('')
  lines.push('## Reconciliation rules')
  lines.push('')
  lines.push('- Trust git over progress.md when they conflict.')
  lines.push(
    '- If a prior attempt committed the deliverable but did not submit, submit now and exit.',
  )
  lines.push(`- Append new notes under a \`## attempt ${attemptNumber}\` header in progress.md.`)
  lines.push('')
  lines.push('## Prior attempts')
  lines.push('')
  lines.push(formatPriorAttempts(priorAttempts))
  lines.push('')
  lines.push('## Environment')
  lines.push('')
  lines.push('- `MC_TASK_ID`, `MC_API_URL`, `MC_API_TOKEN`, `MC_MODEL_PRIMARY`')
  lines.push('- `MC_WORKSPACE`=/workspace, `MC_RECIPE_PATH`=/recipe, `MC_PREAMBLE_PATH`=this file')
  lines.push('')
  lines.push(buildHttpSkeleton(apiBase))
  lines.push('')
  return lines.join('\n') + '\n'
}

/**
 * Generate the preamble Markdown text for a task run.
 *
 * Returns a deterministic string for fixed inputs. Caller writes it to
 * `<recipe-stage>/PREAMBLE.md` after the recipe-directory deep-copy.
 */
export function generatePreamble(input: PreambleInput): string {
  return input.isResuming ? buildResumePreamble(input) : buildFirstAttemptPreamble(input)
}
