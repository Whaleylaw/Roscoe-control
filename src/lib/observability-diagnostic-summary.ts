type SignalTone = 'good' | 'warn' | 'bad' | 'info'

type SummarySignal = {
  label: string
  value: string
  detail: string
  tone: SignalTone
}

type SnapshotLike = {
  generatedAt?: string
  status?: string
  hermes?: { profileCount?: number; gatewaysHealthy?: number; gatewaysDown?: number }
  cron?: { jobCount?: number; enabledCount?: number; failureCount?: number }
}

type DetailKind = 'cron' | 'logs' | 'memory'

type CronDetailLike = {
  generatedAt?: string
  counts?: { total?: number; enabled?: number; paused?: number; failures?: number }
  jobs?: Array<{ name?: string; id?: string; enabled?: boolean; paused?: boolean; lastStatus?: string; deliveryMode?: string }>
}

type LogsDetailLike = {
  generatedAt?: string
  filesScanned?: number
  truncated?: boolean
  entries?: Array<{ level?: string; source?: string; message?: string }>
}

type MemoryDetailLike = {
  generatedAt?: string
  caseScopedProfiles?: number
  honchoLocal?: { status?: string }
  honchoGlobal?: { note?: string }
  profiles?: Array<{ name?: string; restricted?: boolean }>
}

type DetailLike = CronDetailLike | LogsDetailLike | MemoryDetailLike | null

export interface ObservabilityDiagnosticSummaryInput {
  generatedAt?: string
  snapshotSource: 'server' | 'client-fallback'
  snapshot?: SnapshotLike | null
  signals: SummarySignal[]
  detailKind?: DetailKind | null
  detail?: DetailLike
}

function safeLine(value: unknown, max = 220): string {
  return String(value ?? 'n/a')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function renderCronDetail(detail: CronDetailLike): string[] {
  const counts = detail.counts || {}
  const failingJobs = (detail.jobs || [])
    .filter((job) => job.lastStatus && /fail|error/i.test(job.lastStatus))
    .slice(0, 5)
    .map((job) => `  - ${safeLine(job.name || job.id)}: ${safeLine(job.lastStatus, 80)} · ${job.deliveryMode || 'delivery redacted'}`)
  return [
    `Cron detail: ${counts.enabled ?? 0}/${counts.total ?? 0} enabled · ${counts.paused ?? 0} paused · ${counts.failures ?? 0} failures`,
    ...(failingJobs.length ? ['Failing cron jobs:', ...failingJobs] : []),
  ]
}

function renderLogsDetail(detail: LogsDetailLike): string[] {
  const entries = detail.entries || []
  const errors = entries.filter((entry) => entry.level === 'error').length
  const warnings = entries.filter((entry) => entry.level === 'warn').length
  const notable = entries
    .filter((entry) => entry.level === 'error' || entry.level === 'warn')
    .slice(0, 5)
    .map((entry) => `  - ${safeLine(entry.level, 20)} ${safeLine(entry.source, 80)}: ${safeLine(entry.message)}`)
  return [
    `Logs detail: ${detail.filesScanned ?? 0} files scanned · ${errors} errors · ${warnings} warnings${detail.truncated ? ' · truncated' : ''}`,
    ...(notable.length ? ['Notable log entries:', ...notable] : []),
  ]
}

function renderMemoryDetail(detail: MemoryDetailLike): string[] {
  const profiles = detail.profiles || []
  const restricted = detail.caseScopedProfiles ?? profiles.filter((profile) => profile.restricted).length
  return [
    `Memory detail: ${profiles.length} profiles · ${restricted} restricted · local Honcho ${detail.honchoLocal?.status || 'unknown'}`,
    `Memory guardrail: ${safeLine(detail.honchoGlobal?.note || 'global Honcho not probed')}`,
  ]
}

export function buildObservabilityDiagnosticSummary(input: ObservabilityDiagnosticSummaryInput): string {
  const generatedAt = input.generatedAt || input.snapshot?.generatedAt || new Date().toISOString()
  const lines = [
    'Mission Control observability diagnostic',
    `Generated: ${safeLine(generatedAt)}`,
    `Source: ${input.snapshotSource}`,
    `Overall status: ${safeLine(input.snapshot?.status || 'unknown')}`,
    '',
    'Golden signals:',
    ...input.signals.map((signal) => `- ${safeLine(signal.label, 40)}: ${safeLine(signal.value, 80)} [${signal.tone}] — ${safeLine(signal.detail)}`),
  ]

  if (input.snapshot?.hermes) {
    lines.push('', `Hermes: ${input.snapshot.hermes.gatewaysHealthy ?? 0} healthy · ${input.snapshot.hermes.gatewaysDown ?? 0} down/degraded · ${input.snapshot.hermes.profileCount ?? 0} profiles`)
  }
  if (input.snapshot?.cron) {
    lines.push(`Cron: ${input.snapshot.cron.enabledCount ?? 0}/${input.snapshot.cron.jobCount ?? 0} enabled · ${input.snapshot.cron.failureCount ?? 0} failures`)
  }

  if (input.detailKind && input.detail) {
    lines.push('')
    if (input.detailKind === 'cron') lines.push(...renderCronDetail(input.detail as CronDetailLike))
    if (input.detailKind === 'logs') lines.push(...renderLogsDetail(input.detail as LogsDetailLike))
    if (input.detailKind === 'memory') lines.push(...renderMemoryDetail(input.detail as MemoryDetailLike))
  }

  lines.push('', 'Safety: read-only observability; detail is server-bounded/redacted; no case/client memory excerpts included.')
  return lines.join('\n')
}
