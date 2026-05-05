import type { IEventBus, IRecipeRuntime, IWaypointAuthz, IWaypointStore } from '@waypoint/core'
import { createWaypointStoreAdapter } from './store'
import { createWaypointAuthzAdapter } from './authz'
import { createWaypointEventBusAdapter } from './event-bus'
import { createWaypointRecipeRuntimeAdapter } from './recipe-runtime'

export interface MissionControlWaypointAdapterDeps {
  store: IWaypointStore
  authz: IWaypointAuthz
  eventBus: IEventBus
  recipeRuntime: IRecipeRuntime
}

export function createMissionControlWaypointAdapters(deps: MissionControlWaypointAdapterDeps) {
  return {
    store: createWaypointStoreAdapter(deps.store),
    authz: createWaypointAuthzAdapter(deps.authz),
    eventBus: createWaypointEventBusAdapter(deps.eventBus),
    recipeRuntime: createWaypointRecipeRuntimeAdapter(deps.recipeRuntime),
  }
}

export { createWaypointStoreAdapter } from './store'
export { createWaypointAuthzAdapter } from './authz'
export { createWaypointEventBusAdapter } from './event-bus'
export { createWaypointRecipeRuntimeAdapter } from './recipe-runtime'
