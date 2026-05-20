'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { buildObservabilityDiagnosticSummary } from '@/lib/observability-diagnostic-summary'
import { useFocusTrap } from '@/lib/use-focus-trap'
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
  services?: Record<string, { name?: string; status?: string; port?: number; httpStatus?: number; note?: string }>
  hermes?: { profileCount?: number; gatewaysHealthy?: number; gatewaysDown?: number; gatewaysUnknown?: number; homePresent?: boolean; profilesPathPresent?: boolean }
  cron?: { jobCount?: number; enabledCount?: number; pausedCount?: number; failureCount?: number; jobsPathPresent?: boolean }
  safeguards?: Record<string, boolean>
}

type DetailKind = 'cron' | 'logs' | 'memory'

type RefreshState = 'idle' | 'loading' | 'cooldown'

const SNAPSHOT_REFRESH_DEBOUNCE_MS = 1_000
const SNAPSHOT_REFRESH_BACKOFF_MS = 5_000

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
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const [refreshState, setRefreshState] = useState<RefreshState>('idle')
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const cancelledRef = useRef(false)
  const refreshInFlightRef = useRef(false)
  const refreshTimerRef = useRef<number | null>(null)

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [])

  const fetchSnapshot = useCallback(async (options?: { manual?: boolean }) => {
    const manual = options?.manual ?? false
    if (refreshInFlightRef.current) return

    if (manual) {
      setRefreshState('loading')
    }

    refreshInFlightRef.current = true
    try {
      const res = await fetch('/api/observability?scope=snapshot')
      if (!res.ok) throw new Error(`observability ${res.status}`)
      const snapshot = await res.json()
      if (!cancelledRef.current) {
        setApiSnapshot(snapshot)
        setApiError(false)
        if (manual) {
          setRefreshState('cooldown')
          clearRefreshTimer()
          refreshTimerRef.current = window.setTimeout(() => {
            refreshTimerRef.current = null
            if (!cancelledRef.current) setRefreshState('idle')
          }, SNAPSHOT_REFRESH_DEBOUNCE_MS)
        }
      }
    } catch {
      if (!cancelledRef.current) {
        // Preserve the existing snapshot/detail panes; only mark the endpoint as unavailable.
        setApiError(true)
        if (manual) {
          setRefreshState('cooldown')
          clearRefreshTimer()
          refreshTimerRef.current = window.setTimeout(() => {
            refreshTimerRef.current = null
            if (!cancelledRef.current) setRefreshState('idle')
          }, SNAPSHOT_REFRESH_BACKOFF_MS)
        }
      }
    } finally {
      refreshInFlightRef.current = false
    }
  }, [clearRefreshTimer])

  useEffect(() => {
    cancelledRef.current = false
    void fetchSnapshot()
    return () => {
      cancelledRef.current = true
      clearRefreshTimer()
    }
  }, [clearRefreshTimer, fetchSnapshot])

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


  const loadDetail = useCallback((kind: DetailKind) => {
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
  }, [])

  const signals = apiSignals || fallbackSignals

  const copyDiagnosticSummary = async () => {
    const summary = buildObservabilityDiagnosticSummary({
      generatedAt: new Date().toISOString(),
      snapshotSource: apiSnapshot ? 'server' : 'client-fallback',
      snapshot: apiSnapshot,
      signals,
      detailKind: detail?.data ? detail.kind : null,
      detail: detail?.data || null,
    })

    try {
      await navigator.clipboard.writeText(summary)
      setCopyStatus('copied')
      window.setTimeout(() => setCopyStatus('idle'), 2_000)
    } catch {
      setCopyStatus('error')
      window.setTimeout(() => setCopyStatus('idle'), 2_000)
    }
  }

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
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchSnapshot({ manual: true })}
          disabled={refreshState !== 'idle'}
          className="h-7 rounded-md px-2 text-2xs"
        >
          {refreshState === 'loading' ? 'Refreshing…' : refreshState === 'cooldown' ? 'Refresh cooling down' : 'Refresh snapshot'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDiagnosticsOpen(true)}
          className="h-7 rounded-md px-2 text-2xs"
        >
          Diagnostics details
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={copyDiagnosticSummary}
          className="h-7 rounded-md px-2 text-2xs"
        >
          {copyStatus === 'copied' ? 'Copied summary' : copyStatus === 'error' ? 'Copy failed' : 'Copy diagnostic summary'}
        </Button>
      </div>

      {diagnosticsOpen && (
        <DiagnosticsDetailsModal
          snapshot={apiSnapshot}
          apiError={apiError}
          signals={signals}
          detail={detail}
          refreshState={refreshState}
          onClose={() => setDiagnosticsOpen(false)}
          onRefresh={() => void fetchSnapshot({ manual: true })}
          onLoadDetail={loadDetail}
          onClearDetail={() => setDetail(null)}
          onCopySummary={copyDiagnosticSummary}
          copyStatus={copyStatus}
        />
      )}
    </div>
  )
}

type SignalSummary = Array<{ label: string; value: string; detail: string; tone: Tone }>
type DiagnosticsTab = 'overview' | DetailKind

const DIAGNOSTICS_TAB_STORAGE_KEY = 'mission-control:observability-diagnostics-tab'

function isDiagnosticsTab(value: string | null): value is DiagnosticsTab {
  return value === 'overview' || value === 'cron' || value === 'logs' || value === 'memory'
}

function loadStoredDiagnosticsTab(): DiagnosticsTab {
  if (typeof window === 'undefined') return 'overview'
  try {
    const stored = window.localStorage.getItem(DIAGNOSTICS_TAB_STORAGE_KEY)
    return isDiagnosticsTab(stored) ? stored : 'overview'
  } catch {
    return 'overview'
  }
}

function storeDiagnosticsTab(tab: DiagnosticsTab) {
  try {
    window.localStorage.setItem(DIAGNOSTICS_TAB_STORAGE_KEY, tab)
  } catch {
    // Non-critical: storage may be disabled in hardened browser contexts.
  }
}

function DiagnosticsDetailsModal({
  snapshot,
  apiError,
  signals,
  detail,
  refreshState,
  onClose,
  onRefresh,
  onLoadDetail,
  onClearDetail,
  onCopySummary,
  copyStatus,
}: {
  snapshot: ApiSnapshot | null
  apiError: boolean
  signals: SignalSummary
  detail: DetailState
  refreshState: RefreshState
  onClose: () => void
  onRefresh: () => void
  onLoadDetail: (kind: DetailKind) => void
  onClearDetail: () => void
  onCopySummary: () => void
  copyStatus: 'idle' | 'copied' | 'error'
}) {
  const [activeTab, setActiveTab] = useState<DiagnosticsTab>(() => loadStoredDiagnosticsTab())
  const dialogRef = useFocusTrap(onClose)
  const services = Object.entries(snapshot?.services || {})
  const safeguards = Object.entries(snapshot?.safeguards || {}).filter(([, enabled]) => enabled)
  const activeDetailKind = activeTab === 'overview' ? null : activeTab
  const activeDetail = activeDetailKind && detail?.kind === activeDetailKind ? detail : null

  const selectTab = (tab: DiagnosticsTab) => {
    setActiveTab(tab)
    storeDiagnosticsTab(tab)
  }

  useEffect(() => {
    if (activeTab !== 'overview' && detail?.kind !== activeTab) {
      onLoadDetail(activeTab)
    }
  }, [activeTab, detail?.kind, onLoadDetail])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="observability-diagnostics-title"
        className="h-full w-full max-w-3xl overflow-y-auto border-l border-border bg-card shadow-2xl"
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="observability-diagnostics-title" className="text-lg font-semibold text-foreground">Observability diagnostics</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {snapshot ? `Server snapshot generated ${formatGeneratedAt(snapshot.generatedAt)}.` : apiError ? 'Server endpoint unavailable; showing client fallback.' : 'Waiting for server snapshot.'}
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} className="text-xl">&times;</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshState !== 'idle'} className="h-7 rounded-md px-2 text-2xs">
              {refreshState === 'loading' ? 'Refreshing…' : refreshState === 'cooldown' ? 'Refresh cooling down' : 'Refresh snapshot'}
            </Button>
            <Button variant="outline" size="sm" onClick={onCopySummary} className="h-7 rounded-md px-2 text-2xs">
              {copyStatus === 'copied' ? 'Copied summary' : copyStatus === 'error' ? 'Copy failed' : 'Copy diagnostic summary'}
            </Button>
          </div>
          <div role="tablist" aria-label="Observability detail sections" className="mt-3 flex gap-1 rounded-lg border border-border/70 bg-background/40 p-1">
            {(['overview', 'cron', 'logs', 'memory'] as DiagnosticsTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => selectTab(tab)}
                className={`flex-1 rounded-md px-2 py-1.5 text-2xs font-medium capitalize transition-colors ${activeTab === tab ? 'bg-primary/20 text-primary border border-primary/30' : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 p-4">
          {activeTab === 'overview' ? (
            <>
              <section className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">Golden signals</h4>
                  <span className={`rounded border px-2 py-0.5 text-2xs ${toneClasses(snapshot?.status === 'down' ? 'bad' : snapshot?.status === 'degraded' ? 'warn' : snapshot ? 'good' : 'info')}`}>{snapshot?.status || 'fallback'}</span>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                  {signals.map((signal) => (
                    <div key={signal.label} className={`rounded-lg border p-2 ${toneClasses(signal.tone)}`}>
                      <div className="text-2xs uppercase tracking-wide opacity-70">{signal.label}</div>
                      <div className="mt-1 font-mono-tight text-base font-semibold">{signal.value}</div>
                      <div className="mt-1 text-2xs opacity-75">{signal.detail}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                  <h4 className="mb-2 text-sm font-semibold">Hermes runtime</h4>
                  <div className="grid grid-cols-2 gap-2 text-2xs">
                    <DetailStat label="Profiles" value={snapshot?.hermes?.profileCount ?? 'n/a'} />
                    <DetailStat label="Healthy gateways" value={snapshot?.hermes?.gatewaysHealthy ?? 'n/a'} />
                    <DetailStat label="Gateway issues" value={snapshot?.hermes?.gatewaysDown ?? 'n/a'} alert={(snapshot?.hermes?.gatewaysDown ?? 0) > 0} />
                    <DetailStat label="Unknown gateways" value={snapshot?.hermes?.gatewaysUnknown ?? 'n/a'} />
                  </div>
                  <p className="mt-2 text-2xs text-muted-foreground">Hermes home {snapshot?.hermes?.homePresent ? 'present' : snapshot ? 'missing' : 'not loaded'} · profiles path {snapshot?.hermes?.profilesPathPresent ? 'present' : snapshot ? 'missing' : 'not loaded'}</p>
                </div>

                <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                  <h4 className="mb-2 text-sm font-semibold">Cron scheduler</h4>
                  <div className="grid grid-cols-2 gap-2 text-2xs">
                    <DetailStat label="Jobs" value={snapshot?.cron?.jobCount ?? 'n/a'} />
                    <DetailStat label="Enabled" value={snapshot?.cron?.enabledCount ?? 'n/a'} />
                    <DetailStat label="Paused" value={snapshot?.cron?.pausedCount ?? 'n/a'} />
                    <DetailStat label="Failures" value={snapshot?.cron?.failureCount ?? 'n/a'} alert={(snapshot?.cron?.failureCount ?? 0) > 0} />
                  </div>
                  <p className="mt-2 text-2xs text-muted-foreground">Jobs file {snapshot?.cron?.jobsPathPresent ? 'present' : snapshot ? 'missing' : 'not loaded'}.</p>
                </div>
              </section>

              <section className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                <h4 className="mb-2 text-sm font-semibold">Local services</h4>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {services.map(([key, service]) => (
                    <div key={key} className="rounded border border-border/60 bg-background/50 p-2 text-2xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{service.name || key}</span>
                        <span className={service.status === 'healthy' ? 'text-green-300' : service.status === 'degraded' ? 'text-amber-300' : service.status === 'down' ? 'text-red-300' : 'text-muted-foreground'}>{service.status || 'unknown'}</span>
                      </div>
                      <div className="mt-1 text-muted-foreground">port {service.port ?? 'n/a'}{service.httpStatus ? ` · HTTP ${service.httpStatus}` : ''}{service.note ? ` · ${service.note}` : ''}</div>
                    </div>
                  ))}
                  {services.length === 0 && <div className="rounded border border-border/60 bg-background/50 p-2 text-2xs text-muted-foreground">No server service probes loaded.</div>}
                </div>
              </section>

              <section className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                <h4 className="mb-2 text-sm font-semibold">Safeguards</h4>
                <div className="flex flex-wrap gap-2 text-2xs text-muted-foreground">
                  {(safeguards.length ? safeguards : [['readOnly', true], ['secretsRedacted', true], ['boundedDetail', true]]).map(([name]) => (
                    <span key={String(name)} className="rounded border border-green-500/20 bg-green-500/10 px-2 py-1 text-green-300">{String(name)}</span>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <section className="rounded-lg border border-border/70 bg-secondary/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold capitalize">{activeTab} detail</h4>
                  <p className="text-2xs text-muted-foreground">Loaded on demand; bounded and redacted server-side.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => onLoadDetail(activeTab)} className="h-7 px-2 text-2xs">Reload</Button>
                  {detail && <Button variant="outline" size="sm" onClick={() => { onClearDetail(); selectTab('overview') }} className="h-7 px-2 text-2xs">Clear</Button>}
                </div>
              </div>
              {activeDetail?.loading && <div className="text-xs text-muted-foreground">Loading {activeTab}…</div>}
              {activeDetail?.error && <div className="text-xs text-red-300">{activeDetail.error}</div>}
              {!activeDetail && <div className="text-xs text-muted-foreground">Loading {activeTab} detail…</div>}
              {!activeDetail?.loading && !activeDetail?.error && activeDetail?.data && <DetailPanel kind={activeTab} data={activeDetail.data} />}
            </section>
          )}
        </div>
      </div>
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
