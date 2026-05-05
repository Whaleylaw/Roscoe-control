import { describe, expect, it } from 'vitest'

describe('waypoint-core contracts export surface', () => {
  it('exports host interface contracts and system ports', async () => {
    const core = await import('@waypoint/core')

    expect(core.WAYPOINT_CORE_PACKAGE).toBe('waypoint-core')
    expect(core).toHaveProperty('WAYPOINT_CORE_PACKAGE')

    // runtime interface modules should be exported once M2.1 is complete
    expect(core).toHaveProperty('WaypointSubjectType')
  })
})
