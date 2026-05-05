import type { IRecipeRuntime } from '@waypoint/core'

export function createWaypointRecipeRuntimeAdapter(recipeRuntime: IRecipeRuntime): IRecipeRuntime {
  if (
    !recipeRuntime
    || typeof recipeRuntime.startRecipe !== 'function'
    || typeof recipeRuntime.getRun !== 'function'
    || typeof recipeRuntime.cancelRun !== 'function'
  ) {
    throw new Error(
      'Waypoint recipe runtime adapter requires startRecipe(request), getRun(runId), and cancelRun(runId) functions'
    )
  }

  return recipeRuntime
}
