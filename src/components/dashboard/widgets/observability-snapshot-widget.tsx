'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { DashboardData } from '../widget-primitives'

type Tone = 'good' | 'warn' | 'bad' | 'info'

type ApiSignal = {
  tone?: Tone
  value?: string
  detail?: string
}

type ApiSnapshot = {
  generatedAt?: string
  status?: string
  signals?: Record<string, ApiSignal>
  hermes?: { profileCount?: number; gatewaysHealthy?: number; gatewaysDown?: number }
  cron?: { jobCount?: number; enabledCount?: number; failureCount?: number }
}

type DetailKind = 'cron' | 'logs' | 'memory'

type CronDetail = {
  generatedAt?: string
  jobsPathPresent?: boolean
  counts?: { total?: number; enabled?: number; paused?: number; failures?: number }
  jobs?: Array<{ id?: string; name?: string; schedule?: string; enabled?: boolean; paused?: boolean; lastStatus?: string; failureCount?: number; deliveryMode?: string; source?: string }>
}

type LogsDetail = {
  generatedAt?: string
  filesScanned?: number
  truncated?: boolean
  roots?: Array<{ path: string; present: boolean }>
  entries?: Array<{ timestamp: number; level: 'info' | 'warn' | 'error' | 'debug'; source: string; message: string }>
}

type MemoryDetail = {
  generatedAt?: string
  caseScopedProfiles?: number
  honchoLocal?: { status?: string; note?: string }
  honchoGlobal?: { status?: string; note?: string }
  profiles?: Array<{ name: string; restricted: boolean; memoryPaths?: string[]; sessionPaths?: string[]; note?: string }>
}

type DetailState = {
  kind: DetailKind
  loading: boolean
  error: string | null
  data: CronDetail | LogsDetail | MemoryDetail | null
} | null

function toneClasses(tone: Tone): string {
  switch (tone) {
    case 'good':
      return 'border-green-500/20 bg-green-500/10 text-green-300'
    case 'warn':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-300'
    case 'bad':
      return 'border-red-500/20 bg-red-500/10 text-red-300'
    default:
      return 'border-blue-500/20 bg-blue-500/10 text-blue-300'
  }
}

function classifyPercent(value: number | null | undefined, warn = 70, bad = 90): Tone {
  if (value == null || Number.isNaN(value)) return 'info'
  if (value >= bad) return 'bad'
  if (value >= warn) return 'warn'
  return 'good'
}

function classifyErrors(errors: number): Tone {
  if (errors >= 5) return 'bad'
  if (errors > 0) return 'warn'
  return 'good'
}

function classifyBacklog(backlog: number, running: number): Tone {
  if (backlog >= 25 && running === 0) return 'bad'
  if (backlog >= 10 || running > 0) return 'warn'
  return 'good'
}

function formatLatency(ms?: number): string {
  if (ms == null || Number.isNaN(ms)) return 'n/a'
  return `${Math.round(ms)}ms`
}

function formatGeneratedAt(value?: string): string {
  if (!value) return 'unknown'
  const dt = new Date(value)
  return Number.isNaN(dt.getTime()) ? value : dt.toLocaleTimeString()
}

function detailEndpoint(kind: DetailKind): string {
  if (kind === 'logs') return '/api/observability/logs?limit=40'
  return `/api/observability/${kind}`
}

export function ObservabilitySnapshotWidget({ data }: { data: DashboardData }) {
  const [apiSnapshot, setApiSnapshot] = useState<ApiSnapshot | null>(null)
  const [apiError, setApiError] = useState(false)
  const [detail, setDetail] = useState<DetailState>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/observability?scope=snapshot')
      .then(async (res) => {
        if (!res.ok) throw new Error(`observability ${res.status}`)
        return res.json()
      })
      .then((snapshot) => {
        if (!cancelled) {
          setApiSnapshot(snapshot)
          setApiError(false)
        }
      })
      .catch(() => {
        if (!cancelled) setApiError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const {
    activeSessions,
    runningTasks,
    backlogCount,
    reviewCount,
    errorCount,
    recentErrorLogs,
    systemLoad,
    memPct,
    diskPct,
    connection,
    dbStats,
    mergedRecentLogs,
    isSystemLoading,
  } = data

  const activityDay = dbStats?.activities.day ?? mergedRecentLogs.length
  const latencyTone: Tone = connection.latency == null
    ? 'info'
    : connection.latency > 1_000
      ? 'bad'
      : connection.latency > 300
        ? 'warn'
        : 'good'

  const fallbackSignals = [
    {
      label: 'Traffic',
      value: `${activityDay} events`,
      detail: `${activeSessions} active session${activeSessions === 1 ? '' : 's'}`,
      tone: activityDay > 0 || activeSessions > 0 ? 'good' as Tone : 'info' as Tone,
    },
    {
      label: 'Errors',
      value: `${errorCount}`,
      detail: `${recentErrorLogs} recent`,
      tone: classifyErrors(errorCount),
    },
    {
      label: 'Saturation',
      value: isSystemLoading ? 'loading' : `${systemLoad}%`,
      detail: `mem ${memPct ?? 'n/a'}% · disk ${Number.isFinite(diskPct) ? `${diskPct}%` : 'n/a'}`,
      tone: isSystemLoading ? 'info' as Tone : classifyPercent(systemLoad, 75, 90),
    },
    {
      label: 'Latency',
      value: formatLatency(connection.latency),
      detail: connection.isConnected ? 'gateway connected' : 'local / disconnected',
      tone: latencyTone,
    },
    {
      label: 'Queue',
      value: `${backlogCount}`,
      detail: `${runningTasks} running · ${reviewCount} review`,
      tone: classifyBacklog(backlogCount, runningTasks),
    },
  ]

  const apiSignals = apiSnapshot?.signals
    ? [
        ['Traffic', apiSnapshot.signals.traffic],
        ['Errors', apiSnapshot.signals.errors],
        ['Saturation', apiSnapshot.signals.saturation],
        ['Latency', apiSnapshot.signals.latency],
        ['Queue', apiSnapshot.signals.queue],
      ].map(([label, signal]) => ({
        label: label as string,
        value: (signal as ApiSignal | undefined)?.value || 'n/a',
        detail: (signal as ApiSignal | undefined)?.detail || 'no detail',
        tone: (signal as ApiSignal | undefined)?.tone || 'info' as Tone,
      }))
    : null


  const loadDetail = (kind: DetailKind) => {
    setDetail((prev) => prev?.kind === kind && prev.data
      ? null
      : { kind, loading: true, error: null, data: null })

    fetch(detailEndpoint(kind))
      .then(async (res) => {
        if (!res.ok) throw new Error(`observability ${kind} ${res.status}`)
        return res.json()
      })
      .then((payload) => setDetail({ kind, loading: false, error: null, data: payload }))
      .catch((err) => setDetail({
        kind,
        loading: false,
        error: err instanceof Error ? err.message : `Failed to load ${kind} detail`,
        data: null,
      }))
  }

  const signals = apiSignals || fallbackSignals
  const badSignals = signals.filter((signal) => signal.tone === 'bad')
  const warnSignals = signals.filter((signal) => signal.tone === 'warn')
  const headline = badSignals.length > 0
    ? `${badSignals.length} critical signal${badSignals.length === 1 ? '' : 's'}`
    : warnSignals.length > 0
      ? `${warnSignals.length} watch item${warnSignals.length === 1 ? '' : 's'}`
      : 'All core signals steady'

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h3 className="text-sm font-semibold">Observable Snapshot</h3>
          <p className="text-2xs text-muted-foreground mt-0.5">
            {apiSnapshot ? 'Server-side snapshot from local read-only probes' : apiError ? 'Endpoint unavailable; showing client-derived fallback' : 'Golden signals for MC, agents, and queues'}
          </p>
        </div>
        <span className={`text-2xs font-medium px-2 py-1 rounded border ${toneClasses(badSignals.length ? 'bad' : warnSignals.length ? 'warn' : 'good')}`}>
          {headline}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-4 pt-0">
        {signals.map((signal) => (
          <div key={signal.label} className={`rounded-lg border p-3 ${toneClasses(signal.tone)}`}>
            <div className="text-2xs uppercase tracking-wide opacity-70">{signal.label}</div>
            <div className="text-lg font-semibold font-mono-tight mt-1">{signal.value}</div>
            <div className="text-2xs opacity-70 mt-1 truncate" title={signal.detail}>{signal.detail}</div>
          </div>
        ))}
      </div>

      <div className="px-4 pb-3 flex flex-wrap gap-2">
        {(['cron', 'logs', 'memory'] as DetailKind[]).map((kind) => (
          <Button
            key={kind}
            variant="outline"
            size="sm"
            onClick={() => loadDetail(kind)}
            className="h-7 rounded-md px-2 text-2xs capitalize"
          >
            {detail?.kind === kind && detail.loading ? `Loading ${kind}…` : detail?.kind === kind && detail.data ? `Hide ${kind}` : `Inspect ${kind}`}
          </Button>
        ))}
      </div>

      {detail && (
        <div className="mx-4 mb-4 rounded-lg border border-border/70 bg-secondary/20 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <div className="text-xs font-semibold capitalize">{detail.kind} detail</div>
              <div className="text-2xs text-muted-foreground">Loaded on demand; bounded and redacted server-side.</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setDetail(null)} className="h-7 px-2 text-2xs">Close</Button>
          </div>
          {detail.loading && <div className="text-xs text-muted-foreground">Loading…</div>}
          {detail.error && <div className="text-xs text-red-300">{detail.error}</div>}
          {!detail.loading && !detail.error && detail.data && <DetailPanel kind={detail.kind} data={detail.data} />}
        </div>
      )}
    </div>
  )
}


function DetailPanel({ kind, data }: { kind: DetailKind; data: CronDetail | LogsDetail | MemoryDetail }) {
  if (kind === 'cron') {
    const detail = data as CronDetail
    const jobs = detail.jobs || []
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-2xs">
          <DetailStat label="Jobs" value={detail.counts?.total ?? 0} />
          <DetailStat label="Enabled" value={detail.counts?.enabled ?? 0} />
          <DetailStat label="Paused" value={detail.counts?.paused ?? 0} />
          <DetailStat label="Failures" value={detail.counts?.failures ?? 0} alert={(detail.counts?.failures ?? 0) > 0} />
        </div>
        <div className="text-2xs text-muted-foreground">Generated {formatGeneratedAt(detail.generatedAt)} · jobs path {detail.jobsPathPresent ? 'present' : 'missing'}</div>
        <div className="max-h-56 overflow-auto rounded border border-border/60 divide-y divide-border/60">
          {jobs.slice(0, 12).map((job, index) => (
            <div key={job.id || `${job.name}-${index}`} className="p-2 text-2xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground truncate">{job.name || job.id || 'Unnamed job'}</span>
                <span className={job.paused ? 'text-amber-300' : job.enabled ? 'text-green-300' : 'text-muted-foreground'}>{job.paused ? 'paused' : job.enabled ? 'enabled' : 'disabled'}</span>
              </div>
              <div className="text-muted-foreground truncate">{job.schedule || 'no schedule'} · {job.deliveryMode || 'delivery redacted'} · {job.lastStatus || 'no status'}</div>
            </div>
          ))}
          {jobs.length === 0 && <div className="p-2 text-2xs text-muted-foreground">No cron jobs visible.</div>}
        </div>
      </div>
    )
  }

  if (kind === 'logs') {
    const detail = data as LogsDetail
    const entries = detail.entries || []
    return (
      <div className="space-y-2">
        <div className="text-2xs text-muted-foreground">Generated {formatGeneratedAt(detail.generatedAt)} · {detail.filesScanned ?? 0} files scanned{detail.truncated ? ' · truncated' : ''}</div>
        <div className="max-h-64 overflow-auto rounded border border-border/60 divide-y divide-border/60">
          {entries.slice(0, 40).map((entry, index) => (
            <div key={`${entry.source}-${entry.timestamp}-${index}`} className="p-2 text-2xs">
              <div className="flex items-center gap-2 mb-1">
                <span className={entry.level === 'error' ? 'text-red-300' : entry.level === 'warn' ? 'text-amber-300' : 'text-blue-300'}>{entry.level}</span>
                <span className="text-muted-foreground truncate">{entry.source}</span>
                <span className="text-muted-foreground/70">{new Date(entry.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="text-foreground/80 break-words">{entry.message}</div>
            </div>
          ))}
          {entries.length === 0 && <div className="p-2 text-2xs text-muted-foreground">No recent bounded log entries.</div>}
        </div>
      </div>
    )
  }

  const detail = data as MemoryDetail
  const profiles = detail.profiles || []
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-2xs">
        <DetailStat label="Profiles" value={profiles.length} />
        <DetailStat label="Restricted" value={detail.caseScopedProfiles ?? 0} />
        <DetailStat label="Local Honcho" value={detail.honchoLocal?.status || 'unknown'} />
      </div>
      <div className="text-2xs text-muted-foreground">Global Honcho: {detail.honchoGlobal?.note || 'not probed'} · no case/client excerpts pulled</div>
      <div className="max-h-56 overflow-auto rounded border border-border/60 divide-y divide-border/60">
        {profiles.slice(0, 16).map((profile) => (
          <div key={profile.name} className="p-2 text-2xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground truncate">{profile.name}</span>
              <span className={profile.restricted ? 'text-amber-300' : 'text-green-300'}>{profile.restricted ? 'restricted' : 'overview'}</span>
            </div>
            <div className="text-muted-foreground truncate">memory paths {profile.memoryPaths?.length ?? 0} · session paths {profile.sessionPaths?.length ?? 0}{profile.note ? ` · ${profile.note}` : ''}</div>
          </div>
        ))}
        {profiles.length === 0 && <div className="p-2 text-2xs text-muted-foreground">No memory profiles visible.</div>}
      </div>
    </div>
  )
}

function DetailStat({ label, value, alert }: { label: string; value: number | string; alert?: boolean }) {
  return (
    <div className="rounded border border-border/60 bg-background/50 px-2 py-1.5">
      <div className="uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-semibold font-mono-tight ${alert ? 'text-red-300' : 'text-foreground'}`}>{value}</div>
    </div>
  )
}
