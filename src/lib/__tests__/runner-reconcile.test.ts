import { describe, expect, it } from 'vitest'
import {
  reconcileContainers,
  type LiveContainer,
  type PendingTask,
} from '../runner-reconcile'

describe('reconcileContainers', () => {
  it('RUNNER-13: live running + pending matching → adopt', () => {
    const live: LiveContainer[] = [
      {
        container_id: 'c-adopt',
        labels: { 'mc.task_id': '42' },
        state: 'running',
      },
    ]
    const pending: PendingTask[] = [
      {
        id: 42,
        container_id: 'c-adopt',
        status: 'running',
        runner_started_at: 1_700_000_000,
      },
    ]
    const result = reconcileContainers(live, pending)
    expect(result.adopt).toHaveLength(1)
    expect(result.adopt[0].task.id).toBe(42)
    expect(result.adopt[0].container.container_id).toBe('c-adopt')
    expect(result.kill).toEqual([])
    expect(result.orphaned).toEqual([])
  })

  it('pending task with no live match → orphaned', () => {
    const live: LiveContainer[] = []
    const pending: PendingTask[] = [
      {
        id: 43,
        container_id: 'c-missing',
        status: 'running',
        runner_started_at: 1_700_000_000,
      },
    ]
    const result = reconcileContainers(live, pending)
    expect(result.adopt).toEqual([])
    expect(result.kill).toEqual([])
    expect(result.orphaned).toHaveLength(1)
    expect(result.orphaned[0].id).toBe(43)
  })

  it('live running container with no pending row → kill', () => {
    const live: LiveContainer[] = [
      {
        container_id: 'c-stray',
        labels: { 'mc.task_id': '99' },
        state: 'running',
      },
    ]
    const pending: PendingTask[] = []
    const result = reconcileContainers(live, pending)
    expect(result.adopt).toEqual([])
    expect(result.kill).toHaveLength(1)
    expect(result.kill[0].container_id).toBe('c-stray')
    expect(result.orphaned).toEqual([])
  })

  it('live exited containers are ignored entirely (not in any bucket)', () => {
    // docker --rm removes exited containers on exit, but `docker ps -a
    // --filter` can surface them transiently. The reconciler must skip
    // them — classifying as kill would issue docker kill against an
    // already-removed container.
    const live: LiveContainer[] = [
      {
        container_id: 'c-gone',
        labels: { 'mc.task_id': '77' },
        state: 'exited',
      },
    ]
    // Pending task with the SAME container_id — we still expect orphaned,
    // because exited state means the container is not present to adopt.
    const pending: PendingTask[] = [
      {
        id: 77,
        container_id: 'c-gone',
        status: 'running',
        runner_started_at: 1_700_000_000,
      },
    ]
    const result = reconcileContainers(live, pending)
    expect(result.adopt).toEqual([])
    expect(result.kill).toEqual([])
    expect(result.orphaned).toHaveLength(1)
    expect(result.orphaned[0].id).toBe(77)
  })

  it('pending task with placeholder container_id starting with "pending:" + no live match → orphaned (daemon posts runner-exit reason=crash)', () => {
    const live: LiveContainer[] = []
    const pending: PendingTask[] = [
      {
        id: 55,
        container_id: 'pending:abc-claim-id',
        status: 'assigned',
        runner_started_at: null,
      },
    ]
    const result = reconcileContainers(live, pending)
    expect(result.adopt).toEqual([])
    expect(result.kill).toEqual([])
    expect(result.orphaned).toHaveLength(1)
    expect(result.orphaned[0].container_id).toBe('pending:abc-claim-id')
  })

  it('empty inputs → empty outputs', () => {
    const result = reconcileContainers([], [])
    expect(result).toEqual({ adopt: [], kill: [], orphaned: [] })
  })
})
