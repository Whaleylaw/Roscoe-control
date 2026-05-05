import { describe, expect, it, vi } from 'vitest'
import type { IEventBus, IRecipeRuntime, IWaypointAuthz, IWaypointStore } from '@waypoint/core'
import { createMissionControlWaypointAdapters } from '../index'

function createStoreMock(): IWaypointStore {
  return {
    getRouteById: vi.fn(async () => null),
    listRoutes: vi.fn(async () => ({ items: [], total: 0 })),
    appendRouteEvent: vi.fn(async () => ({ id: 1, routeId: 1, kind: 'test', createdAt: Date.now() })),
  }
}

function createAuthzMock(): IWaypointAuthz {
  return {
    requireProjectReadAccess: vi.fn(async () => undefined),
    requireProjectMutateAccess: vi.fn(async () => undefined),
  }
}

function createEventBusMock(): IEventBus {
  return {
    publish: vi.fn(),
  }
}

function createRecipeRuntimeMock(): IRecipeRuntime {
  return {
    startRecipe: vi.fn(async () => ({ runId: 'run-1', status: 'queued' as const })),
    getRun: vi.fn(async () => null),
    cancelRun: vi.fn(async () => undefined),
  }
}

describe('createMissionControlWaypointAdapters', () => {
  it('returns the provided adapter dependencies', () => {
    const store = createStoreMock()
    const authz = createAuthzMock()
    const eventBus = createEventBusMock()
    const recipeRuntime = createRecipeRuntimeMock()

    const adapters = createMissionControlWaypointAdapters({
      store,
      authz,
      eventBus,
      recipeRuntime,
    })

    expect(adapters.store).toBe(store)
    expect(adapters.authz).toBe(authz)
    expect(adapters.eventBus).toBe(eventBus)
    expect(adapters.recipeRuntime).toBe(recipeRuntime)
  })

  it('throws when a required dependency is missing', () => {
    expect(() => createMissionControlWaypointAdapters({
      store: undefined as unknown as IWaypointStore,
      authz: createAuthzMock(),
      eventBus: createEventBusMock(),
      recipeRuntime: createRecipeRuntimeMock(),
    })).toThrow('Missing required Waypoint adapter dependency: store')
  })
})
