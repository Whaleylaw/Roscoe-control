import { describe, expect, it, vi } from 'vitest'
import type { IRecipeRuntime } from '@waypoint/core'
import { createWaypointRecipeRuntimeAdapter } from '../recipe-runtime'

describe('createWaypointRecipeRuntimeAdapter', () => {
  it('returns the same recipe runtime when required functions are implemented', async () => {
    const runtime: IRecipeRuntime = {
      startRecipe: vi.fn().mockResolvedValue({ runId: 'run-1', status: 'queued' }),
      getRun: vi.fn().mockResolvedValue({ runId: 'run-1', status: 'running' }),
      cancelRun: vi.fn().mockResolvedValue(undefined),
    }

    const adapter = createWaypointRecipeRuntimeAdapter(runtime)

    await adapter.startRecipe({ recipe: 'gsd-generalist' })
    await adapter.getRun('run-1')
    await adapter.cancelRun('run-1')

    expect(runtime.startRecipe).toHaveBeenCalledWith({ recipe: 'gsd-generalist' })
    expect(runtime.getRun).toHaveBeenCalledWith('run-1')
    expect(runtime.cancelRun).toHaveBeenCalledWith('run-1')
    expect(adapter).toBe(runtime)
  })

  it('throws when any required runtime function is missing', () => {
    expect(() => createWaypointRecipeRuntimeAdapter({} as IRecipeRuntime)).toThrow(
      'Waypoint recipe runtime adapter requires startRecipe(request), getRun(runId), and cancelRun(runId) functions'
    )
  })
})
