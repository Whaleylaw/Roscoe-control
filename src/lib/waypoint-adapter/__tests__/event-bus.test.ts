import { describe, expect, it, vi } from 'vitest'
import type { IEventBus } from '@waypoint/core'
import { createWaypointEventBusAdapter } from '../event-bus'

describe('createWaypointEventBusAdapter', () => {
  it('returns the same event bus when publish is implemented', () => {
    const eventBus: IEventBus = { publish: vi.fn() }

    const adapter = createWaypointEventBusAdapter(eventBus)

    const event = { type: 'waypoint.route.updated', timestamp: Date.now() }
    adapter.publish(event)
    expect(eventBus.publish).toHaveBeenCalledWith(event)
    expect(adapter).toBe(eventBus)
  })

  it('throws when publish is missing', () => {
    expect(() => createWaypointEventBusAdapter({} as IEventBus)).toThrow(
      'Waypoint event bus adapter requires a publish(event) function'
    )
  })
})
