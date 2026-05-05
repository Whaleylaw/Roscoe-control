import type { IWaypointStore } from '@waypoint/core'

export function createWaypointStoreAdapter(store: IWaypointStore): IWaypointStore {
  if (
    !store
    || typeof store.getRouteById !== 'function'
    || typeof store.listRoutes !== 'function'
    || typeof store.appendRouteEvent !== 'function'
  ) {
    throw new Error(
      'Waypoint store adapter requires getRouteById(routeId), listRoutes(input), and appendRouteEvent(input) functions'
    )
  }

  return store
}
