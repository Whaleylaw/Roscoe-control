import type { IWaypointAuthz } from '@waypoint/core'

export function createWaypointAuthzAdapter(authz: IWaypointAuthz): IWaypointAuthz {
  if (
    !authz
    || typeof authz.requireProjectReadAccess !== 'function'
    || typeof authz.requireProjectMutateAccess !== 'function'
  ) {
    throw new Error(
      'Waypoint authz adapter requires requireProjectReadAccess and requireProjectMutateAccess functions'
    )
  }

  return authz
}
