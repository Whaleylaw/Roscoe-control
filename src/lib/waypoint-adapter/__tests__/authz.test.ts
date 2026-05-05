import { describe, expect, it, vi } from 'vitest'
import type { IWaypointAuthz } from '@waypoint/core'
import { createWaypointAuthzAdapter } from '../authz'

describe('createWaypointAuthzAdapter', () => {
  it('returns the same authz dependency when required methods exist', async () => {
    const authz: IWaypointAuthz = {
      requireProjectReadAccess: vi.fn(async () => undefined),
      requireProjectMutateAccess: vi.fn(async () => undefined),
    }

    const adapter = createWaypointAuthzAdapter(authz)
    const input = {
      actor: { id: 1, role: 'admin' as const, workspaceId: 1, tenantId: 1 },
      projectId: 1,
    }

    await adapter.requireProjectReadAccess(input)
    await adapter.requireProjectMutateAccess(input)

    expect(authz.requireProjectReadAccess).toHaveBeenCalledWith(input)
    expect(authz.requireProjectMutateAccess).toHaveBeenCalledWith(input)
    expect(adapter).toBe(authz)
  })

  it('throws when read access function is missing', () => {
    expect(() => createWaypointAuthzAdapter({
      requireProjectMutateAccess: vi.fn(async () => undefined),
    } as unknown as IWaypointAuthz)).toThrow(
      'Waypoint authz adapter requires requireProjectReadAccess and requireProjectMutateAccess functions'
    )
  })

  it('throws when mutate access function is missing', () => {
    expect(() => createWaypointAuthzAdapter({
      requireProjectReadAccess: vi.fn(async () => undefined),
    } as unknown as IWaypointAuthz)).toThrow(
      'Waypoint authz adapter requires requireProjectReadAccess and requireProjectMutateAccess functions'
    )
  })
})
