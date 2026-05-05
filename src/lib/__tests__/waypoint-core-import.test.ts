import { describe, it, expect } from 'vitest'

describe('waypoint-core package scaffold', () => {
  it('exposes a base core package marker export', async () => {
    const core = await import('@waypoint/core')
    expect(core.WAYPOINT_CORE_PACKAGE).toBe('waypoint-core')
  })

  it('exposes canonical and compatibility subject type constants', async () => {
    const core = await import('@waypoint/core')
    expect(core.WAYPOINT_SUBJECT_TYPES.plan).toBe('waypoint_plan')
    expect(core.WAYPOINT_COMPAT_SUBJECT_TYPES.plan).toBe('gsd_plan')
  })
})
