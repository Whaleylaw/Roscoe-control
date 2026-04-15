import { describe, it } from 'vitest'

// Wave 3 fills these in. Covers: GSD-21.
// PhaseTimeline renders the five-phase strip with aria-current on the
// active step, "✓" prefix on completed steps, and dimmed future steps.

describe('PhaseTimeline (GSD-21)', () => {
  it.todo('renders 5 steps: Discuss, Plan, Execute, Verify, Done (literal English, D-37)')
  it.todo('current phase has aria-current="step" and bg-primary class')
  it.todo('past phases show "✓" prefix')
  it.todo('future phases have opacity-60')
  it.todo('collapses to single column (grid-cols-1) at sm breakpoint')
})
