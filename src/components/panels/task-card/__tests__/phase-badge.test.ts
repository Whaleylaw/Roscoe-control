import { describe, it } from 'vitest'

// Wave 3 fills these in. Covers: GSD-24.
// PhaseBadge renders a small monospace pill of the task's GSD phase
// on the task card. Returns null when task.gsd_phase is nullish (D-22).

describe('PhaseBadge (GSD-24)', () => {
  it.todo('renders upper-cased phase value when task.gsd_phase="plan" → "PLAN"')
  it.todo('renders nothing when task.gsd_phase is null (D-22)')
  it.todo('carries classes text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono (UI-SPEC)')
})
