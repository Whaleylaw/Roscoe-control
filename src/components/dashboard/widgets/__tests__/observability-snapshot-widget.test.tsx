import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ObservabilitySnapshotWidget } from '../observability-snapshot-widget'
import type { DashboardData } from '../../widget-primitives'

function makeJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

function makeDashboardData(): DashboardData {
  return {
    isLocal: true,
    systemStats: null,
    dbStats: {
      tasks: { total: 0, byStatus: {} },
      agents: { total: 0, byStatus: {} },
      audit: { day: 0, week: 0, loginFailures: 0 },
      activities: { day: 3 },
      notifications: { unread: 0 },
      pipelines: { active: 0, recentDay: 0 },
      backup: null,
      dbSizeBytes: 0,
      webhookCount: 0,
    },
    claudeStats: null,
    githubStats: null,
    loading: { system: false, sessions: false, claude: false, github: false },
    sessions: [],
    logs: [],
    agents: [],
    tasks: [],
    connection: { isConnected: true, url: 'local', reconnectAttempts: 0, latency: 20 },
    subscription: null,
    navigateToPanel: vi.fn(),
    openSession: vi.fn(),
    memPct: 20,
    diskPct: 30,
    systemLoad: 10,
    activeSessions: 1,
    errorCount: 0,
    onlineAgents: 0,
    claudeActive: 0,
    codexActive: 0,
    hermesActive: 0,
    claudeLocalSessions: [],
    codexLocalSessions: [],
    hermesLocalSessions: [],
    runningTasks: 0,
    inboxCount: 0,
    assignedCount: 0,
    reviewCount: 0,
    doneCount: 0,
    backlogCount: 0,
    mergedRecentLogs: [],
    recentErrorLogs: 0,
    localOsStatus: { value: 'ok', status: 'good' },
    claudeHealth: { value: 'ok', status: 'good' },
    codexHealth: { value: 'ok', status: 'good' },
    hermesHealth: { value: 'ok', status: 'good' },
    mcHealth: { value: 'ok', status: 'good' },
    gatewayHealthStatus: 'good',
    isSystemLoading: false,
    isSessionsLoading: false,
    isClaudeLoading: false,
    isGithubLoading: false,
    hermesCronJobCount: 0,
    subscriptionLabel: null,
    subscriptionPrice: null,
  }
}

const snapshot = {
  generatedAt: '2026-05-19T20:00:00Z',
  signals: {
    traffic: { tone: 'good', value: '7 events', detail: '2 active sessions' },
    errors: { tone: 'good', value: '0', detail: '0 recent' },
    saturation: { tone: 'good', value: '12%', detail: 'mem 20% · disk 30%' },
    latency: { tone: 'good', value: '20ms', detail: 'gateway connected' },
    queue: { tone: 'good', value: '0', detail: '0 running · 0 review' },
  },
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(makeJsonResponse(snapshot))
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('ObservabilitySnapshotWidget refresh control', () => {
  it('refreshes the server snapshot on demand without clearing loaded detail', async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse(snapshot))
      .mockResolvedValueOnce(makeJsonResponse({ generatedAt: '2026-05-19T20:01:00Z', counts: { total: 1, enabled: 1, paused: 0, failures: 0 }, jobs: [] }))
      .mockResolvedValueOnce(makeJsonResponse({
        ...snapshot,
        signals: { ...snapshot.signals, traffic: { tone: 'good', value: '8 events', detail: '3 active sessions' } },
      }))

    render(<ObservabilitySnapshotWidget data={makeDashboardData()} />)

    await waitFor(() => expect(screen.getByText('7 events')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Inspect cron' }))
    await waitFor(() => expect(screen.getByText('cron detail')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }))

    await waitFor(() => expect(screen.getByText('8 events')).toBeTruthy())
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
})
