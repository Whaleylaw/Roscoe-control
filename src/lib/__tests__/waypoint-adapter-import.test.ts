import { describe, expect, it } from 'vitest'

describe('waypoint adapter package scaffold', () => {
  it('exports Mission Control adapter factory symbols', async () => {
    const adapter = await import('@/lib/waypoint-adapter')
    expect(adapter).toHaveProperty('createMissionControlWaypointAdapters')
  })
})
