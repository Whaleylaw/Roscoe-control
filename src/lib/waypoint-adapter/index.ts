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

function assertWaypointAdapterDependency<T>(value: T | undefined, key: string): T {
  if (!value) {
    throw new Error(`Missing required Waypoint adapter dependency: ${key}`)
  }

  return value
}

export function createMissionControlWaypointAdapters(deps: MissionControlWaypointAdapterDeps) {
  return {
    store: createWaypointStoreAdapter(assertWaypointAdapterDependency(deps.store, 'store')),
    authz: createWaypointAuthzAdapter(assertWaypointAdapterDependency(deps.authz, 'authz')),
    eventBus: createWaypointEventBusAdapter(assertWaypointAdapterDependency(deps.eventBus, 'eventBus')),
    recipeRuntime: createWaypointRecipeRuntimeAdapter(
      assertWaypointAdapterDependency(deps.recipeRuntime, 'recipeRuntime')
    ),
  }
}

export { createWaypointStoreAdapter } from './store'
export { createWaypointAuthzAdapter } from './authz'
export { createWaypointEventBusAdapter } from './event-bus'
export { createWaypointRecipeRuntimeAdapter } from './recipe-runtime'
