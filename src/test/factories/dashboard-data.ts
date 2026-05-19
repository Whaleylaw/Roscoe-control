import { vi } from 'vitest'
import type { DashboardData } from '../../components/dashboard/widget-primitives'

type Primitive = string | number | boolean | bigint | symbol | null | undefined

export type DeepPartial<T> = T extends Primitive | Function
  ? T
  : T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : { [K in keyof T]?: DeepPartial<T[K]> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeDeep<T>(base: T, overrides: unknown): T {
  if (overrides == null) return base
  if (!isRecord(base) || !isRecord(overrides)) return overrides as T

  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    const existing = merged[key]
    merged[key] = isRecord(existing) && isRecord(value)
      ? mergeDeep(existing, value)
      : value
  }

  return merged as T
}

export function makeDashboardData(overrides?: DeepPartial<DashboardData>): DashboardData {
  const base: DashboardData = {
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

  return mergeDeep(base, overrides)
}
