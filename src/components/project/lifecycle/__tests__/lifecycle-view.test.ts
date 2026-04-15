import { describe, it } from 'vitest'

// Wave 3 fills these in. Covers: GSD-20, GSD-21.
// LifecycleView renders the project Lifecycle tab: current-phase
// callout, phase timeline, gate-task list, and conditional CTAs
// driven by gsd_enabled / bootstrapped state + role.

describe('LifecycleView (GSD-20, GSD-21)', () => {
  it.todo('renders translated title via useTranslations("project.lifecycle")')
  it.todo('gsd_enabled=1, not bootstrapped → renders CurrentPhaseCallout + Bootstrap CTA')
  it.todo('gsd_enabled=1, bootstrapped → renders PhaseTimeline + GateTaskList sections')
  it.todo('gsd_enabled=0 → renders LifecycleEmptyState (with Enable CTA)')
  it.todo('viewer role hides Advance/Bootstrap buttons but shows Phase Timeline read-only')
})
