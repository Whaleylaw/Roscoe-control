import type { IEventBus } from '@waypoint/core'

export function createWaypointEventBusAdapter(eventBus: IEventBus): IEventBus {
  if (!eventBus || typeof eventBus.publish !== 'function') {
    throw new Error('Waypoint event bus adapter requires a publish(event) function')
  }

  return eventBus
}
