import { describe, it } from 'vitest'

// Wave 3 fills these in. Covers: GSD-23.
// LifecycleEmptyState renders when gsd_enabled=0 and exposes the
// Enable CTA that issues PATCH /api/projects/:id with {gsd_enabled:1}
// per D-21.

describe('LifecycleEmptyState (GSD-23)', () => {
  it.todo('gsd_enabled=0 renders heading "GSD is not enabled on this project"')
  it.todo('renders body copy and primary Enable CTA button')
  it.todo('viewer role renders Enable CTA disabled with tooltip')
  it.todo('clicking Enable CTA issues PATCH /api/projects/:id with {gsd_enabled:1} (per D-21)')
})
