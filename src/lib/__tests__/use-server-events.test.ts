/**
 * Unit tests for src/lib/use-server-events.ts (Phase 16 Wave-0 extension).
 *
 * Covers the 6 new runtime SSE event-type → DOM CustomEvent relays added in
 * Plan 16-01 Task 1 Step 6:
 *   task.checkpoint_added     → mc:checkpoint-added
 *   task.container_started    → mc:task-container-started
 *   task.container_exited     → mc:task-container-exited
 *   task.runner_requested     → mc:task-runner-requested
 *   recipe.indexed            → mc:recipe-indexed
 *   recipe.removed            → mc:recipe-removed
 *
 * Strategy: stub global EventSource with a controllable class, mount the hook
 * via renderHook from @testing-library/react, drive `onmessage` synthetically,
 * and assert the DOM event fires on `window` with a matching `detail` payload.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock the Zustand store so the hook's setters don't reach into the real store.
// Every setter is a vi.fn() so the hook's useEffect dependency array can resolve.
// `refreshRecipes` added in Phase 16 Plan 16-02 — the hook destructures it to
// seed the recipes cache on mount + refresh on `mc:recipe-indexed/removed`.
vi.mock('@/store', () => ({
  useMissionControl: () => ({
    setConnection: vi.fn(),
    addTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    addAgent: vi.fn(),
    updateAgent: vi.fn(),
    addChatMessage: vi.fn(),
    addNotification: vi.fn(),
    addActivity: vi.fn(),
    refreshRecipes: vi.fn().mockResolvedValue(undefined),
  }),
}))

// Silence client logger noise.
vi.mock('@/lib/client-logger', () => ({
  createClientLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

/**
 * Minimal controllable EventSource stub. The hook keeps a ref to the most
 * recent instance; we capture it by intercepting the constructor so tests can
 * drive `onmessage`/`onopen` handlers directly.
 */
let currentSource: FakeEventSource | null = null

class FakeEventSource {
  url: string
  onmessage: ((evt: MessageEvent) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0
  CONNECTING = 0
  OPEN = 1
  CLOSED = 2

  constructor(url: string) {
    this.url = url
    currentSource = this
    // Open asynchronously so the hook's useEffect has a chance to set refs.
    queueMicrotask(() => {
      this.readyState = this.OPEN
      this.onopen?.()
    })
  }

  close() {
    this.readyState = this.CLOSED
  }

  /** Test helper — synthesise an incoming SSE frame. */
  emit(data: unknown) {
    // MessageEvent is available in jsdom.
    const evt = new MessageEvent('message', { data: JSON.stringify(data) })
    this.onmessage?.(evt)
  }
}

async function loadHook() {
  // Dynamic import so vi.mock() calls above are applied before the hook file runs.
  const { useServerEvents } = await import('@/lib/use-server-events')
  return useServerEvents
}

describe('useServerEvents — Phase 16 Wave-0 DOM CustomEvent relays', () => {
  let originalEventSource: typeof globalThis.EventSource

  beforeEach(() => {
    currentSource = null
    originalEventSource = globalThis.EventSource
    ;(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource =
      FakeEventSource
  })

  afterEach(() => {
    ;(globalThis as unknown as { EventSource: typeof globalThis.EventSource }).EventSource =
      originalEventSource
    currentSource = null
  })

  const relayCases: Array<{
    eventType: string
    domName: string
    payload: Record<string, unknown>
  }> = [
    {
      eventType: 'task.checkpoint_added',
      domName: 'mc:checkpoint-added',
      payload: { task_id: 42, attempt: 1, step: 'build', status: 'completed', summary: 'ok' },
    },
    {
      eventType: 'task.container_started',
      domName: 'mc:task-container-started',
      payload: { task_id: 42, attempt: 1, container_id: 'abc123' },
    },
    {
      eventType: 'task.container_exited',
      domName: 'mc:task-container-exited',
      payload: { task_id: 42, attempt: 1, reason: 'exit', exit_code: 0 },
    },
    {
      eventType: 'task.runner_requested',
      domName: 'mc:task-runner-requested',
      payload: { task_id: 99 },
    },
    {
      eventType: 'recipe.indexed',
      domName: 'mc:recipe-indexed',
      payload: { slug: 'my-recipe', name: 'My Recipe', model: 'claude-opus-4-7' },
    },
    {
      eventType: 'recipe.removed',
      domName: 'mc:recipe-removed',
      payload: { slug: 'my-recipe' },
    },
  ]

  for (const { eventType, domName, payload } of relayCases) {
    it(`relays ${eventType} → window CustomEvent('${domName}') with detail === event.data`, async () => {
      const useServerEvents = await loadHook()

      const listener = vi.fn()
      window.addEventListener(domName, listener as EventListener)

      renderHook(() => useServerEvents())

      // Wait for the queued microtask in FakeEventSource so onopen has fired.
      await Promise.resolve()
      await Promise.resolve()

      expect(currentSource).not.toBeNull()
      currentSource!.emit({
        type: eventType,
        data: payload,
        timestamp: Date.now(),
      })

      expect(listener).toHaveBeenCalledTimes(1)
      const received = listener.mock.calls[0][0] as CustomEvent
      expect(received).toBeInstanceOf(CustomEvent)
      expect(received.type).toBe(domName)
      expect(received.detail).toEqual(payload)

      window.removeEventListener(domName, listener as EventListener)
    })
  }

  it('does NOT emit a DOM event for unknown SSE types', async () => {
    const useServerEvents = await loadHook()

    const listener = vi.fn()
    window.addEventListener('mc:checkpoint-added', listener as EventListener)
    window.addEventListener('mc:recipe-indexed', listener as EventListener)

    renderHook(() => useServerEvents())
    await Promise.resolve()
    await Promise.resolve()

    currentSource!.emit({ type: 'some.unknown.event', data: { foo: 'bar' }, timestamp: 0 })

    expect(listener).not.toHaveBeenCalled()

    window.removeEventListener('mc:checkpoint-added', listener as EventListener)
    window.removeEventListener('mc:recipe-indexed', listener as EventListener)
  })
})
