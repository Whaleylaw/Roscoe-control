import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'

// ─── Module mocks ────────────────────────────────────────────────────
//
// Banner only consumes next-intl + global fetch + window events, so the
// mock surface is tiny. Follows the same t() stub pattern the other
// panel tests use (session-details-panel.test.tsx) so ICU `{count}`
// renders as a readable `key(count=N)` we can assert on.

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (k: string, vars?: Record<string, unknown>) => {
    if (vars) {
      const parts = Object.entries(vars).map(([key, val]) => `${key}=${val}`).join(',')
      return ns ? `${ns}.${k}(${parts})` : `${k}(${parts})`
    }
    return ns ? `${ns}.${k}` : k
  },
}))

// Import AFTER mocks so the component picks them up.
import { RunnerStatusBanner } from '../runner-status-banner'

function makeJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('RunnerStatusBanner', () => {
  it('renders nothing on initial loading (before first fetch resolves)', () => {
    // Fetch never resolves — stays in `loading` forever.
    fetchMock.mockReturnValue(new Promise(() => { /* pending */ }))
    const { container } = render(<RunnerStatusBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders online state with green dot when API reports online', async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse({ online: true, last_heartbeat_at: 1_700_000_000, tasks_waiting: 0 }),
    )
    const { container } = render(<RunnerStatusBanner />)
    await waitFor(() => {
      expect(container.textContent).toContain('taskBoard.runnerBanner.online')
    })
    // Green dot color token + online tone on wrapper.
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.className).toContain('bg-green-500/5')
    const dot = wrapper.querySelector('span')
    expect(dot?.className).toContain('bg-green-500')
    expect(wrapper.getAttribute('role')).toBe('status')
    expect(wrapper.getAttribute('aria-live')).toBe('polite')
  })

  it('renders offline state with red dot and interpolated waiting count (3)', async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse({ online: false, last_heartbeat_at: null, tasks_waiting: 3 }),
    )
    const { container } = render(<RunnerStatusBanner />)
    await waitFor(() => {
      expect(container.textContent).toContain('taskBoard.runnerBanner.offlineCount(count=3)')
    })
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('bg-red-500/5')
    const dot = wrapper.querySelector('span')
    expect(dot?.className).toContain('bg-red-500')
  })

  it('still renders offlineCount when offline with 0 waiting (banner never hides)', async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse({ online: false, last_heartbeat_at: null, tasks_waiting: 0 }),
    )
    const { container } = render(<RunnerStatusBanner />)
    await waitFor(() => {
      expect(container.textContent).toContain('taskBoard.runnerBanner.offlineCount(count=0)')
    })
  })

  it('renders statusUnavailable fallback when the fetch returns 500', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
    )
    const { container } = render(<RunnerStatusBanner />)
    await waitFor(() => {
      expect(container.textContent).toContain('taskBoard.runnerBanner.statusUnavailable')
    })
    // Neutral muted tone — not green, not red.
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).not.toContain('bg-green-500/5')
    expect(wrapper.className).not.toContain('bg-red-500/5')
    expect(wrapper.className).toContain('bg-muted/5')
  })

  it('renders statusUnavailable fallback when fetch throws (network error)', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'))
    const { container } = render(<RunnerStatusBanner />)
    await waitFor(() => {
      expect(container.textContent).toContain('taskBoard.runnerBanner.statusUnavailable')
    })
  })

  it('re-fetches after debounced delay when mc:task-container-started fires', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(
      makeJsonResponse({ online: true, last_heartbeat_at: 1, tasks_waiting: 0 }),
    )
    render(<RunnerStatusBanner />)
    // Drain the initial effect + its promise.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const initialCalls = fetchMock.mock.calls.length
    expect(initialCalls).toBeGreaterThanOrEqual(1)

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mc:task-container-started', { detail: {} }))
      // Before the debounce window elapses, no new fetch should fire.
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(fetchMock.mock.calls.length).toBe(initialCalls)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600) // total > 1000ms debounce
    })
    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls)
  })

  it('re-fetches at the 10s polling interval', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(
      makeJsonResponse({ online: true, last_heartbeat_at: 1, tasks_waiting: 0 }),
    )
    render(<RunnerStatusBanner />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const initialCalls = fetchMock.mock.calls.length
    expect(initialCalls).toBeGreaterThanOrEqual(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls)
  })

  it('debounces bursts of SSE events to a single refresh fetch', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(
      makeJsonResponse({ online: true, last_heartbeat_at: 1, tasks_waiting: 0 }),
    )
    render(<RunnerStatusBanner />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const initialCalls = fetchMock.mock.calls.length

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mc:task-container-started', { detail: {} }))
      window.dispatchEvent(new CustomEvent('mc:task-container-exited', { detail: {} }))
      window.dispatchEvent(new CustomEvent('mc:task-runner-requested', { detail: {} }))
      await vi.advanceTimersByTimeAsync(1_100)
    })
    // Exactly one extra fetch — all three events coalesced by the debounce.
    expect(fetchMock.mock.calls.length).toBe(initialCalls + 1)
  })
})
