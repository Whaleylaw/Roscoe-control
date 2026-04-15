'use client'

type TaskLike = { gsd_phase?: string | null }

/**
 * Phase 09 GSD-24, D-22 — renders a phase badge on task cards when task.gsd_phase is set.
 * Non-GSD tasks (gsd_phase=null) render nothing. Visual parity with existing ticket_ref badge
 * (text-[10px] + px-1.5 py-0.5 + bg-primary/15 text-primary + font-mono), per UI-SPEC.
 * Phase value rendered literal English per D-37 (DISCUSS / PLAN / EXECUTE / VERIFY / DONE).
 */
export function PhaseBadge({ task }: { task: TaskLike }) {
  if (!task.gsd_phase) return null
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono"
      title={`GSD phase: ${task.gsd_phase}`}
    >
      {task.gsd_phase.toUpperCase()}
    </span>
  )
}
