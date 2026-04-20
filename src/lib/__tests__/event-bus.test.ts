import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventBus, type EventType, type ServerEvent } from '@/lib/event-bus'

/**
 * Phase 15 (15-01 / CP-01 + SCHED-06): coverage for the six new EventType union members.
 *
 * These tests assert both runtime fan-out (broadcast → 'server-event' listener) and
 * compile-time typing (`satisfies EventType`). If any of the six string literals are
 * mis-typed in the union, `pnpm typecheck` fails in CI before this file even runs.
 *
 * The test does NOT mock anything — eventBus is a singleton EventEmitter over an
 * in-memory EventEmitter. Listeners are torn down in afterEach to prevent leakage
 * into other test files that also use eventBus.
 */

const PHASE_15_EVENT_TYPES = [
  'task.runner_requested',
  'task.container_started',
  'task.container_exited',
  'task.checkpoint_added',
  'recipe.indexed',
  'recipe.removed',
] as const satisfies readonly EventType[]

type Phase15EventType = (typeof PHASE_15_EVENT_TYPES)[number]

describe('event-bus Phase 15 EventType additions', () => {
  let handler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    handler = vi.fn()
    eventBus.on('server-event', handler)
  })

  afterEach(() => {
    eventBus.off('server-event', handler)
  })

  // One it(...) per new event type — six total per the plan's acceptance criteria.
  it.each(PHASE_15_EVENT_TYPES)(
    'broadcast(%s, data) fires handler with correct ServerEvent shape',
    (eventType: Phase15EventType) => {
      const data = { task_id: 42, note: `payload for ${eventType}` }
      const before = Date.now()
      const event = eventBus.broadcast(eventType, data)
      const after = Date.now()

      // Return value from broadcast conforms to ServerEvent.
      expect(event.type).toBe(eventType)
      expect(event.data).toEqual(data)
      expect(typeof event.timestamp).toBe('number')
      expect(event.timestamp).toBeGreaterThanOrEqual(before)
      expect(event.timestamp).toBeLessThanOrEqual(after)

      // Listener fired exactly once with the same ServerEvent.
      expect(handler).toHaveBeenCalledTimes(1)
      const forwarded = handler.mock.calls[0][0] as ServerEvent
      expect(forwarded.type).toBe(eventType)
      expect(forwarded.data).toEqual(data)
      expect(forwarded.timestamp).toBe(event.timestamp)
    },
  )

  it('compile-time: each new event type is assignable to EventType', () => {
    // `satisfies EventType` would fail the typecheck if any literal were missing
    // from the union. The runtime assertion is a tautology; the real test is tsc.
    const t1 = 'task.runner_requested' satisfies EventType
    const t2 = 'task.container_started' satisfies EventType
    const t3 = 'task.container_exited' satisfies EventType
    const t4 = 'task.checkpoint_added' satisfies EventType
    const t5 = 'recipe.indexed' satisfies EventType
    const t6 = 'recipe.removed' satisfies EventType
    expect([t1, t2, t3, t4, t5, t6]).toEqual([
      'task.runner_requested',
      'task.container_started',
      'task.container_exited',
      'task.checkpoint_added',
      'recipe.indexed',
      'recipe.removed',
    ])
  })

  it('existing event types still broadcast (regression guard)', () => {
    // Quick check that the additive-only compat policy is honored.
    const event = eventBus.broadcast('task.created', { id: 1 })
    expect(event.type).toBe('task.created')
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
