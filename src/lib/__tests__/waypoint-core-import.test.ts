import { describe, it, expect } from 'vitest'

describe('waypoint-core package scaffold', () => {
  it('exposes a base core package marker export', async () => {
    const core = await import('@waypoint/core')
    expect(core.WAYPOINT_CORE_PACKAGE).toBe('waypoint-core')
  })
})
