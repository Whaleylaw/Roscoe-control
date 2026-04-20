/**
 * Runner GC decision helpers (Phase 14 Plan 08a).
 *
 * Pure-logic module — no filesystem, child_process, or HTTP side effects.
 * Consumed by the runner daemon (`scripts/mc-runner.mjs`) via inline
 * duplication at build time; this file is the canonical contract + test
 * surface.
 *
 * Destroy rules (locked per 14-CONTEXT.md "Retention policy"):
 *   - done / cancelled → destroy immediately on detection
 *   - failed           → destroy after `failed_gc_window_days` elapsed
 *   - anything else    → do not destroy (defensive default)
 *
 * See: .planning/phases/14-runner-container-v1-2/14-CONTEXT.md "Retention policy"
 */

export interface TerminalRow {
  task_id: number
  status: 'done' | 'failed' | 'cancelled'
  /** Unix seconds when the task entered a terminal state. */
  terminal_at: number
}

export interface DestroyPlan {
  task_id: number
  reason: 'terminal-immediate' | 'failed-aged-out'
}

const SECONDS_PER_DAY = 86_400

/**
 * Decide whether a terminal task's worktree + logs should be destroyed NOW.
 *
 * @param row terminal task row from `GET /api/runner/terminal-tasks`
 * @param nowUnix current time in unix seconds
 * @param failedWindowDays days to retain `failed` tasks (admin setting `runtime.failed_gc_window_days`)
 */
export function gcShouldDestroy(
  row: TerminalRow,
  nowUnix: number,
  failedWindowDays: number,
): boolean {
  if (row.status === 'done' || row.status === 'cancelled') {
    return true
  }
  if (row.status === 'failed') {
    const ageSeconds = nowUnix - row.terminal_at
    const windowSeconds = failedWindowDays * SECONDS_PER_DAY
    return ageSeconds >= windowSeconds
  }
  // Defensive: unknown status values are not destroyed.
  return false
}

/**
 * Project a list of terminal rows onto a list of destroy plans, preserving
 * input ordering. Rows that do NOT meet the destroy criteria are filtered out.
 */
export function planDestroy(
  rows: TerminalRow[],
  nowUnix: number,
  failedWindowDays: number,
): DestroyPlan[] {
  const out: DestroyPlan[] = []
  for (const row of rows) {
    if (!gcShouldDestroy(row, nowUnix, failedWindowDays)) continue
    const reason: DestroyPlan['reason'] =
      row.status === 'failed' ? 'failed-aged-out' : 'terminal-immediate'
    out.push({ task_id: row.task_id, reason })
  }
  return out
}
