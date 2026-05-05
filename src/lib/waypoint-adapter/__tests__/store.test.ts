import { describe, expect, it, vi } from 'vitest'
import type { IWaypointStore } from '@waypoint/core'
import { createWaypointStoreAdapter } from '../store'

describe('createWaypointStoreAdapter', () => {
  it('returns the same store when required methods are implemented', async () => {
    const store: IWaypointStore = {
      getRouteById: vi.fn(async () => null),
      listRoutes: vi.fn(async () => ({ items: [], total: 0 })),
      appendRouteEvent: vi.fn(async () => ({
        id: 1,
        routeId: 10,
        kind: 'waypoint.route.updated',
        createdAt: 123,
      })),
    }

    const adapter = createWaypointStoreAdapter(store)

    await adapter.getRouteById(42)
    await adapter.listRoutes({ projectId: 7, limit: 25, offset: 0 })
    await adapter.appendRouteEvent({
      routeId: 10,
      kind: 'waypoint.route.updated',
      createdAt: 123,
    })

    expect(store.getRouteById).toHaveBeenCalledWith(42)
    expect(store.listRoutes).toHaveBeenCalledWith({ projectId: 7, limit: 25, offset: 0 })
    expect(store.appendRouteEvent).toHaveBeenCalledWith({
      routeId: 10,
      kind: 'waypoint.route.updated',
      createdAt: 123,
    })
    expect(adapter).toBe(store)
  })

  it('throws when required methods are missing', () => {
    expect(() => createWaypointStoreAdapter({} as IWaypointStore)).toThrow(
      'Waypoint store adapter requires getRouteById(routeId), listRoutes(input), and appendRouteEvent(input) functions'
    )
  })
})
