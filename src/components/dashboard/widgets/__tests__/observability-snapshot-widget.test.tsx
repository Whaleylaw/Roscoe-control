import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ObservabilitySnapshotWidget } from '../observability-snapshot-widget'
import { makeDashboardData } from '@/test/factories/dashboard-data'

function makeJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

const snapshot = {
  generatedAt: '2026-05-19T20:00:00Z',
  status: 'healthy',
  signals: {
    traffic: { tone: 'good', value: '7 events', detail: '2 active sessions' },
    errors: { tone: 'good', value: '0', detail: '0 recent' },
    saturation: { tone: 'good', value: '12%', detail: 'mem 20% · disk 30%' },
    latency: { tone: 'good', value: '20ms', detail: 'gateway connected' },
    queue: { tone: 'good', value: '0', detail: '0 running · 0 review' },
  },
  services: {
    hermesApi: { name: 'Hermes API', status: 'healthy', port: 8642, httpStatus: 200 },
    paperclip: { name: 'Paperclip', status: 'down', port: 3100, note: 'port closed' },
  },
  hermes: { profileCount: 4, gatewaysHealthy: 3, gatewaysDown: 1, gatewaysUnknown: 0, homePresent: true, profilesPathPresent: true },
  cron: { jobCount: 9, enabledCount: 7, pausedCount: 2, failureCount: 1, jobsPathPresent: true },
  safeguards: { readOnly: true, localOnlyProbes: true, secretsRedacted: true, caseScopedOverview: true },
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.localStorage.clear()
  fetchMock = vi.fn().mockResolvedValue(makeJsonResponse(snapshot))
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('ObservabilitySnapshotWidget refresh control', () => {
  it('refreshes the server snapshot on demand without clearing drawer detail', async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse(snapshot))
      .mockResolvedValueOnce(makeJsonResponse({ generatedAt: '2026-05-19T20:01:00Z', counts: { total: 1, enabled: 1, paused: 0, failures: 0 }, jobs: [] }))
      .mockResolvedValueOnce(makeJsonResponse({
        ...snapshot,
        signals: { ...snapshot.signals, traffic: { tone: 'good', value: '8 events', detail: '3 active sessions' } },
      }))

    render(<ObservabilitySnapshotWidget data={makeDashboardData()} />)

    await waitFor(() => expect(screen.getByText('7 events')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics details' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Observability diagnostics' })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: 'cron' }))
    await waitFor(() => expect(screen.getByText('cron detail')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh snapshot' })[1])

    await waitFor(() => expect(screen.getAllByText('8 events').length).toBeGreaterThan(0))
    expect(screen.getByText('cron detail')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/observability?scope=snapshot')
  })

  it('debounces rapid manual refreshes', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(makeJsonResponse(snapshot))

    render(<ObservabilitySnapshotWidget data={makeDashboardData()} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const initialCalls = fetchMock.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const afterFirstRefresh = fetchMock.mock.calls.length
    expect(afterFirstRefresh).toBeGreaterThan(initialCalls)

    expect(screen.getByRole('button', { name: 'Refresh cooling down' })).toBeDisabled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(fetchMock.mock.calls.length).toBe(afterFirstRefresh)
    expect(screen.getByRole('button', { name: 'Refresh cooling down' })).toBeDisabled()
  })

  it('backs off after a failed manual refresh while preserving the prior snapshot', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse(snapshot))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))

    render(<ObservabilitySnapshotWidget data={makeDashboardData()} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('7 events')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('7 events')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh cooling down' })).toBeDisabled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.getByRole('button', { name: 'Refresh snapshot' })).not.toBeDisabled()
  })

  it('opens the last selected diagnostics tab on reopen', async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse(snapshot))
      .mockResolvedValueOnce(makeJsonResponse({ generatedAt: '2026-05-19T20:01:00Z', filesScanned: 1, entries: [] }))

    render(<ObservabilitySnapshotWidget data={makeDashboardData()} />)
    await waitFor(() => expect(screen.getByText('7 events')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics details' }))
    fireEvent.click(screen.getByRole('tab', { name: 'logs' }))
    await waitFor(() => expect(screen.getByText('logs detail')).toBeTruthy())
    expect(window.localStorage.getItem('mission-control:observability-diagnostics-tab')).toBe('logs')

    fireEvent.click(screen.getByRole('button', { name: '×' }))
    expect(screen.queryByRole('dialog', { name: 'Observability diagnostics' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics details' }))
    expect(screen.getByRole('tab', { name: 'logs' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(screen.getByText('logs detail')).toBeTruthy())
  })
})
