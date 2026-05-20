import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { URL } from 'node:url'
import { config } from '@/lib/config'

type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown'
type SignalTone = 'good' | 'warn' | 'bad' | 'info'

export interface ObservabilitySignal {
  status: HealthStatus
  tone: SignalTone
  value: string
  detail: string
}

export interface ServiceProbeResult {
  name: string
  status: HealthStatus
  url: string
  port: number
  httpStatus?: number
  note?: string
}

export interface ObservabilitySnapshot {
  generatedAt: string
  status: HealthStatus
  signals: {
    traffic: ObservabilitySignal
    errors: ObservabilitySignal
    saturation: ObservabilitySignal
    latency: ObservabilitySignal
    queue: ObservabilitySignal
  }
  services: Record<string, ServiceProbeResult>
  hermes: {
    home: string
    homePresent: boolean
    profilesPath: string
    profilesPathPresent: boolean
    profileCount: number
    gatewaysHealthy: number
    gatewaysDown: number
    gatewaysUnknown: number
  }
  cron: {
    jobsPath: string
    jobsPathPresent: boolean
    jobCount: number
    enabledCount: number
    pausedCount: number
    failureCount: number
  }
  safeguards: {
    readOnly: true
    localOnlyProbes: true
    secretsRedacted: true
    caseScopedOverview: true
  }
}

export interface CollectObservabilityOptions {
  hermesHome?: string
  services?: Array<{ key: string; name: string; url: string; port: number }>
  probeServices?: boolean
  timeoutMs?: number
}


export interface ObservabilityCronJobSummary {
  id: string
  name: string
  enabled: boolean
  schedule: string
  timezone?: string
  lastRun?: number
  nextRun?: number
  lastStatus?: string
  lastError?: string
  deliveryMode?: string
  source: 'hermes' | 'openclaw'
}

export interface ObservabilityCronDetail {
  generatedAt: string
  jobsPath: string
  jobsPathPresent: boolean
  jobs: ObservabilityCronJobSummary[]
  counts: {
    total: number
    enabled: number
    paused: number
    failures: number
  }
  safeguards: {
    promptsRedacted: true
    scriptsRedacted: true
    deliveryTargetsRedacted: true
  }
}

export interface ObservabilityLogEntry {
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  message: string
}

export interface ObservabilityLogsDetail {
  generatedAt: string
  roots: Array<{ path: string; present: boolean }>
  filesScanned: number
  entries: ObservabilityLogEntry[]
  truncated: boolean
  safeguards: {
    bounded: true
    secretsRedacted: true
  }
}

export interface ObservabilityMemoryProfile {
  name: string
  path: string
  restricted: boolean
  memoryPaths: string[]
  sessionPaths: string[]
  note?: string
}

export interface ObservabilityMemoryDetail {
  generatedAt: string
  honchoLocal: ServiceProbeResult
  honchoGlobal: { status: HealthStatus; note: string; url: null }
  profiles: ObservabilityMemoryProfile[]
  caseScopedProfiles: number
  safeguards: {
    caseClientExcerptsRestricted: true
    noHonchoContentPulled: true
    secretsRedacted: true
  }
}

const SECRET_KEY_RE = /(token|secret|password|passwd|api[_-]?key|authorization|bearer|cookie|private[_-]?key|credential)/i
const SECRET_VALUE_RE = /(?:xox[baprs]-[A-Za-z0-9-]+|sk-[A-Za-z0-9_-]{12,}|sb_[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})/
const REDACTED = '[REDACTED]'

const DEFAULT_SERVICES = [
  { key: 'hermesApi', name: 'Hermes API', url: config.hermesApiUrl ? `${config.hermesApiUrl.replace(/\/$/, '')}/health` : 'http://127.0.0.1:8642/health', port: portFromUrl(config.hermesApiUrl, 8642) },
  { key: 'paperclip', name: 'Paperclip', url: 'http://127.0.0.1:3100/', port: 3100 },
  { key: 'langfuse', name: 'Langfuse', url: 'http://127.0.0.1:3000/api/public/health', port: 3000 },
  { key: 'honcho', name: 'Honcho', url: 'http://127.0.0.1:8000/health', port: 8000 },
]


const LOG_SUFFIXES = new Set(['.log', '.txt', '.jsonl'])
const MEMORY_DIR_NAMES = ['memory', 'honcho', 'context']
const SESSION_DIR_NAMES = ['sessions', 'chat', 'history', 'messages']
const RESTRICTED_PROFILE_RE = /(paralegal|case|client|legal|court|matter)/i
const MAX_LOG_FILES = 16
const MAX_LOG_FILE_BYTES = 128 * 1024
const MAX_LOG_LINE_LENGTH = 500

function portFromUrl(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  try {
    const u = new URL(raw)
    if (u.port) return Number(u.port)
    return u.protocol === 'https:' ? 443 : 80
  } catch {
    return fallback
  }
}

export function redactObservabilityValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactObservabilityValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_RE.test(key) ? REDACTED : redactObservabilityValue(nested)
    }
    return out
  }
  if (typeof value === 'string') {
    return value.replace(SECRET_VALUE_RE, REDACTED).slice(0, 500)
  }
  return value
}

export function isLocalHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['127.0.0.1', 'localhost', '::1'].includes(u.hostname)
  } catch {
    return false
  }
}

export function parseGatewayPid(raw: string): { pid: number; metadata: Record<string, unknown> } {
  const text = raw.trim()
  if (!text) throw new Error('empty pid file')
  if (text.startsWith('{')) {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') throw new Error('pid JSON not an object')
    const pid = Number((parsed as any).pid)
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('pid field missing or invalid')
    const metadata: Record<string, unknown> = {}
    for (const key of ['started_at', 'host', 'port']) {
      const v = (parsed as any)[key]
      if (typeof v === 'string' || typeof v === 'number') metadata[key] = v
    }
    return { pid, metadata: redactObservabilityValue(metadata) as Record<string, unknown> }
  }
  const pid = Number(text.split(/\s+/)[0])
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('pid field missing or invalid')
  return { pid, metadata: {} }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    return err?.code === 'EPERM'
  }
}

function gatewayStatus(profileDir: string): HealthStatus {
  const pidPath = path.join(profileDir, 'gateway.pid')
  if (!fs.existsSync(pidPath)) return 'unknown'
  try {
    const { pid } = parseGatewayPid(fs.readFileSync(pidPath, 'utf8'))
    return pidAlive(pid) ? 'healthy' : 'down'
  } catch {
    return 'degraded'
  }
}

function discoverHermesProfiles(hermesHome: string) {
  const profilesPath = path.join(hermesHome, 'profiles')
  if (!fs.existsSync(profilesPath)) {
    return { profilesPath, statuses: [] as HealthStatus[] }
  }
  const statuses = fs.readdirSync(profilesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => gatewayStatus(path.join(profilesPath, entry.name)))
  return { profilesPath, statuses }
}

function readCronSummary(hermesHome: string) {
  const jobsPath = path.join(hermesHome, 'cron', 'jobs.json')
  if (!fs.existsSync(jobsPath)) {
    return { jobsPath, jobsPathPresent: false, jobCount: 0, enabledCount: 0, pausedCount: 0, failureCount: 0 }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(jobsPath, 'utf8'))
    const jobs = Array.isArray(raw) ? raw : Array.isArray(raw?.jobs) ? raw.jobs : []
    let enabledCount = 0
    let pausedCount = 0
    let failureCount = 0
    for (const job of jobs) {
      if (!job || typeof job !== 'object') continue
      if ((job as any).enabled === true) enabledCount++
      if ((job as any).paused_at || (job as any).paused_reason || (job as any).paused === true) pausedCount++
      const status = String((job as any).last_status || (job as any).state?.lastStatus || '').toLowerCase()
      if ((job as any).last_error || (job as any).last_delivery_error || ['error', 'failed', 'failure'].includes(status)) failureCount++
    }
    return { jobsPath, jobsPathPresent: true, jobCount: jobs.length, enabledCount, pausedCount, failureCount }
  } catch {
    return { jobsPath, jobsPathPresent: true, jobCount: 0, enabledCount: 0, pausedCount: 0, failureCount: 1 }
  }
}



function readJsonFileIfPresent(filePath: string): any | null {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function cronJobsFromFile(raw: any): any[] {
  return Array.isArray(raw) ? raw : Array.isArray(raw?.jobs) ? raw.jobs : []
}

function summarizeCronJob(job: any, source: 'hermes' | 'openclaw'): ObservabilityCronJobSummary {
  const schedule = typeof job?.schedule === 'string'
    ? job.schedule
    : typeof job?.schedule?.expr === 'string'
      ? job.schedule.expr
      : typeof job?.cron === 'string'
        ? job.cron
        : 'unspecified'
  const id = String(job?.id || job?.job_id || job?.name || 'unknown').slice(0, 120)
  const lastStatus = String(job?.last_status || job?.state?.lastStatus || job?.status || '').slice(0, 80) || undefined
  const lastError = typeof job?.last_error === 'string'
    ? job.last_error
    : typeof job?.state?.lastError === 'string'
      ? job.state.lastError
      : undefined

  return redactObservabilityValue({
    id,
    name: String(job?.name || id).slice(0, 160),
    enabled: job?.enabled !== false && job?.paused !== true && !job?.paused_at,
    schedule: schedule.slice(0, 120),
    timezone: typeof job?.timezone === 'string' ? job.timezone : typeof job?.schedule?.tz === 'string' ? job.schedule.tz : undefined,
    lastRun: typeof job?.last_run === 'number' ? job.last_run : job?.state?.lastRunAtMs,
    nextRun: typeof job?.next_run === 'number' ? job.next_run : job?.state?.nextRunAtMs,
    lastStatus,
    lastError: lastError ? lastError.slice(0, 300) : undefined,
    deliveryMode: typeof job?.delivery === 'string'
      ? job.delivery.split(':')[0]
      : typeof job?.delivery?.mode === 'string'
        ? job.delivery.mode
        : undefined,
    source,
  }) as ObservabilityCronJobSummary
}

export function collectObservabilityCronDetail(options: { hermesHome?: string; source?: 'hermes' | 'openclaw' } = {}): ObservabilityCronDetail {
  const source = options.source || 'hermes'
  const root = source === 'openclaw'
    ? config.openclawStateDir
    : (options.hermesHome || path.join(config.homeDir || os.homedir(), '.hermes'))
  const jobsPath = path.join(root || '', 'cron', 'jobs.json')
  const raw = readJsonFileIfPresent(jobsPath)
  const jobs = raw ? cronJobsFromFile(raw).map((job) => summarizeCronJob(job, source)) : []
  const failures = jobs.filter((job) => {
    const status = String(job.lastStatus || '').toLowerCase()
    return Boolean(job.lastError) || ['error', 'failed', 'failure'].includes(status)
  }).length

  return {
    generatedAt: new Date().toISOString(),
    jobsPath,
    jobsPathPresent: fs.existsSync(jobsPath),
    jobs,
    counts: {
      total: jobs.length,
      enabled: jobs.filter((job) => job.enabled).length,
      paused: jobs.filter((job) => !job.enabled).length,
      failures,
    },
    safeguards: {
      promptsRedacted: true,
      scriptsRedacted: true,
      deliveryTargetsRedacted: true,
    },
  }
}

function recentLogFiles(root: string): string[] {
  if (!root || !fs.existsSync(root)) return []
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && LOG_SUFFIXES.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(root, entry.name))
      .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, MAX_LOG_FILES)
      .map((item) => item.filePath)
  } catch {
    return []
  }
}

function classifyLogLevel(line: string): ObservabilityLogEntry['level'] {
  if (/\b(error|failed|failure|traceback|exception)\b/i.test(line)) return 'error'
  if (/\b(warn|warning|degraded|timeout)\b/i.test(line)) return 'warn'
  if (/\b(debug|trace)\b/i.test(line)) return 'debug'
  return 'info'
}

function parseLogTimestamp(line: string, fallback: number): number {
  const match = line.match(/\b(20\d{2}-\d{2}-\d{2}[T ][0-9:.+-]+Z?)\b/)
  if (!match) return fallback
  const parsed = Date.parse(match[1])
  return Number.isFinite(parsed) ? parsed : fallback
}

export function collectObservabilityLogsDetail(options: { roots?: string[]; limit?: number } = {}): ObservabilityLogsDetail {
  const roots = (options.roots || [
    config.logsDir,
    config.tempLogsDir,
    path.join(config.homeDir || os.homedir(), '.hermes', 'logs'),
  ]).filter(Boolean)
  const limit = Math.max(1, Math.min(options.limit || 80, 200))
  const files = roots.flatMap(recentLogFiles).slice(0, MAX_LOG_FILES)
  const entries: ObservabilityLogEntry[] = []

  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath)
      const fd = fs.openSync(filePath, 'r')
      const bytes = Math.min(stat.size, MAX_LOG_FILE_BYTES)
      const buffer = Buffer.alloc(bytes)
      fs.readSync(fd, buffer, 0, bytes, Math.max(0, stat.size - bytes))
      fs.closeSync(fd)
      const source = path.basename(filePath)
      for (const rawLine of buffer.toString('utf8').split(/\r?\n/).filter(Boolean)) {
        const redacted = String(redactObservabilityValue(rawLine)).slice(0, MAX_LOG_LINE_LENGTH)
        entries.push({
          timestamp: parseLogTimestamp(redacted, stat.mtimeMs),
          level: classifyLogLevel(redacted),
          source,
          message: redacted,
        })
      }
    } catch {
      // Bad log files should not break the observability surface.
    }
  }

  entries.sort((a, b) => b.timestamp - a.timestamp)
  return {
    generatedAt: new Date().toISOString(),
    roots: roots.map((root) => ({ path: root, present: fs.existsSync(root) })),
    filesScanned: files.length,
    entries: entries.slice(0, limit),
    truncated: entries.length > limit,
    safeguards: {
      bounded: true,
      secretsRedacted: true,
    },
  }
}

function existingProfileSubdirs(profilePath: string, names: string[]): string[] {
  return names
    .map((name) => path.join(profilePath, name))
    .filter((candidate) => fs.existsSync(candidate))
}

export async function collectObservabilityMemoryDetail(options: { hermesHome?: string; timeoutMs?: number } = {}): Promise<ObservabilityMemoryDetail> {
  const hermesHome = options.hermesHome || path.join(config.homeDir || os.homedir(), '.hermes')
  const profilesPath = path.join(hermesHome, 'profiles')
  const profiles: ObservabilityMemoryProfile[] = fs.existsSync(profilesPath)
    ? fs.readdirSync(profilesPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const profilePath = path.join(profilesPath, entry.name)
        const restricted = RESTRICTED_PROFILE_RE.test(entry.name)
        return {
          name: entry.name,
          path: profilePath,
          restricted,
          memoryPaths: existingProfileSubdirs(profilePath, MEMORY_DIR_NAMES),
          sessionPaths: existingProfileSubdirs(profilePath, SESSION_DIR_NAMES),
          note: restricted ? 'case/client scoped profile; excerpts restricted' : undefined,
        }
      })
    : []

  const [, honchoProbe] = await probeService({ key: 'honcho', name: 'Honcho', url: 'http://127.0.0.1:8000/health', port: 8000 }, options.timeoutMs ?? 700)

  return redactObservabilityValue({
    generatedAt: new Date().toISOString(),
    honchoLocal: honchoProbe,
    honchoGlobal: { status: 'unknown', note: 'remote/global Honcho content is not probed by Mission Control observability', url: null },
    profiles,
    caseScopedProfiles: profiles.filter((profile) => profile.restricted).length,
    safeguards: {
      caseClientExcerptsRestricted: true,
      noHonchoContentPulled: true,
      secretsRedacted: true,
    },
  }) as ObservabilityMemoryDetail
}

function socketProbe(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const done = (ok: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => done(true))
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
  })
}

async function probeService(service: { key: string; name: string; url: string; port: number }, timeoutMs: number): Promise<[string, ServiceProbeResult]> {
  if (!isLocalHttpUrl(service.url)) {
    return [service.key, { name: service.name, status: 'unknown', url: '', port: service.port, note: 'non-local URL skipped' }]
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(service.url, { method: 'GET', signal: controller.signal })
    clearTimeout(timer)
    return [service.key, {
      name: service.name,
      status: response.status >= 200 && response.status < 400 ? 'healthy' : 'degraded',
      url: service.url,
      port: service.port,
      httpStatus: response.status,
    }]
  } catch {
    clearTimeout(timer)
    const portOpen = await socketProbe(service.port, Math.min(timeoutMs, 500))
    return [service.key, {
      name: service.name,
      status: portOpen ? 'degraded' : 'down',
      url: service.url,
      port: service.port,
      note: portOpen ? 'port open but HTTP probe failed' : undefined,
    }]
  }
}

function healthToTone(status: HealthStatus): SignalTone {
  if (status === 'healthy') return 'good'
  if (status === 'degraded') return 'warn'
  if (status === 'down') return 'bad'
  return 'info'
}

function worstStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes('down')) return 'down'
  if (statuses.includes('degraded')) return 'degraded'
  if (statuses.includes('healthy')) return 'healthy'
  return 'unknown'
}

function systemSaturation() {
  const load = os.loadavg()[0] || 0
  const cpus = Math.max(1, os.cpus().length)
  const loadPct = Math.round((load / cpus) * 100)
  const total = os.totalmem()
  const memPct = total > 0 ? Math.round(((total - os.freemem()) / total) * 100) : 0
  const pct = Math.max(loadPct, memPct)
  const status: HealthStatus = pct >= 95 ? 'down' : pct >= 80 ? 'degraded' : 'healthy'
  return { pct, loadPct, memPct, status }
}

export async function collectObservabilitySnapshot(options: CollectObservabilityOptions = {}): Promise<ObservabilitySnapshot> {
  const hermesHome = options.hermesHome || path.join(config.homeDir || os.homedir(), '.hermes')
  const { profilesPath, statuses } = discoverHermesProfiles(hermesHome)
  const cron = readCronSummary(hermesHome)
  const servicesEntries = options.probeServices === false
    ? DEFAULT_SERVICES.map((svc) => [svc.key, { name: svc.name, status: 'unknown' as HealthStatus, url: svc.url, port: svc.port, note: 'probe skipped' }] as [string, ServiceProbeResult])
    : await Promise.all((options.services || DEFAULT_SERVICES).map((svc) => probeService(svc, options.timeoutMs ?? 900)))
  const services = Object.fromEntries(servicesEntries)
  const serviceStatuses = Object.values(services).map((svc) => svc.status)
  const saturation = systemSaturation()
  const gatewaysHealthy = statuses.filter((s) => s === 'healthy').length
  const gatewaysDown = statuses.filter((s) => s === 'down' || s === 'degraded').length
  const gatewaysUnknown = statuses.filter((s) => s === 'unknown').length
  const trafficStatus: HealthStatus = gatewaysHealthy > 0 ? 'healthy' : statuses.length > 0 ? 'degraded' : 'unknown'
  const errorStatus: HealthStatus = cron.failureCount > 0 || gatewaysDown > 0 ? 'degraded' : 'healthy'
  const latencyStatus = worstStatus(serviceStatuses)
  const queueStatus: HealthStatus = cron.failureCount > 0 ? 'degraded' : cron.pausedCount > 0 ? 'degraded' : 'healthy'
  const overall = worstStatus([trafficStatus, errorStatus, saturation.status, latencyStatus, queueStatus])

  return redactObservabilityValue({
    generatedAt: new Date().toISOString(),
    status: overall,
    signals: {
      traffic: {
        status: trafficStatus,
        tone: healthToTone(trafficStatus),
        value: `${gatewaysHealthy}/${statuses.length}`,
        detail: 'Hermes gateways healthy',
      },
      errors: {
        status: errorStatus,
        tone: healthToTone(errorStatus),
        value: `${cron.failureCount + gatewaysDown}`,
        detail: `${cron.failureCount} cron failures · ${gatewaysDown} gateway issues`,
      },
      saturation: {
        status: saturation.status,
        tone: healthToTone(saturation.status),
        value: `${saturation.pct}%`,
        detail: `mem ${saturation.memPct}% · load ${saturation.loadPct}%`,
      },
      latency: {
        status: latencyStatus,
        tone: healthToTone(latencyStatus),
        value: `${serviceStatuses.filter((s) => s === 'healthy').length}/${serviceStatuses.length}`,
        detail: 'local service probes healthy',
      },
      queue: {
        status: queueStatus,
        tone: healthToTone(queueStatus),
        value: `${cron.enabledCount}`,
        detail: `${cron.pausedCount} paused · ${cron.jobCount} scheduled`,
      },
    },
    services,
    hermes: {
      home: hermesHome,
      homePresent: fs.existsSync(hermesHome),
      profilesPath,
      profilesPathPresent: fs.existsSync(profilesPath),
      profileCount: statuses.length,
      gatewaysHealthy,
      gatewaysDown,
      gatewaysUnknown,
    },
    cron,
    safeguards: {
      readOnly: true,
      localOnlyProbes: true,
      secretsRedacted: true,
      caseScopedOverview: true,
    },
  }) as ObservabilitySnapshot
}
