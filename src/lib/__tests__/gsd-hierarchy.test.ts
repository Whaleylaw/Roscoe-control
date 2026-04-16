import { describe, it, expect } from 'vitest'
import {
  NEXT_GSD_LIFECYCLE_PHASE,
  canTransitionGsdLifecycle,
  serializeDependencyIds,
  parseDependencyIds,
  optimisticLockMatches,
  makeHierarchyIdempotencyKey,
} from '@/lib/gsd-hierarchy'

describe('gsd hierarchy helpers', () => {
  it('enforces strictly linear lifecycle transitions', () => {
    expect(NEXT_GSD_LIFECYCLE_PHASE.discuss).toBe('plan')
    expect(canTransitionGsdLifecycle('discuss', 'plan')).toBe(true)
    expect(canTransitionGsdLifecycle('plan', 'verify')).toBe(false)
    expect(canTransitionGsdLifecycle('done', 'done')).toBe(false)
  })

  it('serializes dependency ids as sorted unique JSON', () => {
    expect(serializeDependencyIds([5, 1, 5, 2])).toBe('[1,2,5]')
    expect(serializeDependencyIds([])).toBe('[]')
    expect(serializeDependencyIds(null)).toBe('[]')
  })

  it('parses dependency ids defensively from JSON text', () => {
    expect(parseDependencyIds('[4,2,9]')).toEqual([4, 2, 9])
    expect(parseDependencyIds('[4,0,-1,"x"]')).toEqual([4])
    expect(parseDependencyIds('not json')).toEqual([])
    expect(parseDependencyIds(null)).toEqual([])
  })

  it('matches optimistic locks only when the expected row version equals actual', () => {
    expect(optimisticLockMatches(10, undefined)).toBe(true)
    expect(optimisticLockMatches(10, 10)).toBe(true)
    expect(optimisticLockMatches(10, 11)).toBe(false)
    expect(optimisticLockMatches(null, 0)).toBe(true)
  })

  it('builds stable lowercase idempotency keys from hierarchy parts', () => {
    expect(
      makeHierarchyIdempotencyKey(['Project', 42, 'CORE', 'v1.2', '10', '10-01']),
    ).toBe('project:42:core:v1.2:10:10-01')
  })
})
