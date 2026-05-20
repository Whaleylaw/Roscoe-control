/**
 * Read-only view of the Phase 13 runtime settings (TCTX-04, TCTX-06).
 *
 * Source of truth: the `settings` table (migration 010). Admin can mutate via
 * PUT /api/settings; this module only READS. Callers:
 *   - src/lib/task-runtime-validation.ts (validateHostPathAgainstAllowlist)
 *   - src/app/api/tasks/route.ts (POST — Plan 13-02)
 *   - src/app/api/tasks/[id]/route.ts (PATCH — Plan 13-03)
 *   - Phase 14 runner re-validation (claim time)
 *
 * Default semantics match the settingDefinitions registered in /api/settings:
 *   - runtime.mount_allowlist   → '[]'  → []
 *   - runtime.read_only_mounts_cap → '10' → 10
 *   - runtime.extra_skills_cap  → '20'  → 20
 *
 * Malformed stored values (unparseable JSON, non-numeric strings) are treated as
 * absent: the default is returned and a structured warn log is emitted. This keeps
 * a corrupted settings row from bricking task creation.
 */
import { getDatabase } from './db'
import { logger } from './logger'

export const TASK_RUNTIME_SETTING_KEYS = {
  MOUNT_ALLOWLIST: 'runtime.mount_allowlist',
  READ_ONLY_MOUNTS_CAP: 'runtime.read_only_mounts_cap',
  EXTRA_SKILLS_CAP: 'runtime.extra_skills_cap',
  MAX_CONCURRENT_CONTAINERS: 'runtime.max_concurrent_containers',
  PROJECT_REPO_MAP: 'runtime.project_repo_map',
  MAX_MEMORY_PER_CONTAINER: 'runtime.max_memory_per_container',
  MAX_CPU_PER_CONTAINER: 'runtime.max_cpu_per_container',
  FAILED_GC_WINDOW_DAYS: 'runtime.failed_gc_window_days',
  DOCKER_NETWORK_MODE: 'runtime.docker_network_mode',
  REVIEW_PR_PROVIDER: 'runtime.review_pr_provider',
  REVIEW_PR_REMOTE_NAME: 'runtime.review_pr_remote_name',
  FORGEJO_BASE_URL: 'runtime.forgejo_base_url',
  FORGEJO_TOKEN: 'runtime.forgejo_token',
  FORGEJO_WEBHOOK_SECRET: 'runtime.forgejo_webhook_secret',
  REVIEW_PR_AUTO_CREATE: 'runtime.review_pr_auto_create',
} as const

export const DEFAULT_READ_ONLY_MOUNTS_CAP = 10
export const DEFAULT_EXTRA_SKILLS_CAP = 20
export const DEFAULT_MAX_CONCURRENT_CONTAINERS = 4
export const DEFAULT_MAX_MEMORY_PER_CONTAINER = '8g'
export const DEFAULT_MAX_CPU_PER_CONTAINER = 4.0
export const DEFAULT_FAILED_GC_WINDOW_DAYS = 7
export const DEFAULT_DOCKER_NETWORK_MODE = ''
export const DEFAULT_REVIEW_PR_PROVIDER = 'forgejo'
export const DEFAULT_REVIEW_PR_REMOTE_NAME = 'forgejo'
export const DEFAULT_FORGEJO_BASE_URL = ''
export const DEFAULT_FORGEJO_TOKEN = ''
export const DEFAULT_FORGEJO_WEBHOOK_SECRET = ''
export const DEFAULT_REVIEW_PR_AUTO_CREATE = true

function readSettingValue(key: string): string | undefined {
  const db = getDatabase()
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value
}

/**
 * Returns the configured allowlist as a string[] of absolute path prefixes.
 *
 * Behavior:
 *   - Missing row → [] (CONTEXT.md: empty allowlist rejects all mounts by design)
 *   - Stored value parses as JSON array of strings → that array
 *   - Any parse failure or non-array/non-string shape → [] + logger.warn
 *
 * Returned paths are returned verbatim (no normalisation). The validator in
 * task-runtime-validation.ts normalises both sides at check time.
 */
export function getMountAllowlist(): string[] {
  const raw = readSettingValue(TASK_RUNTIME_SETTING_KEYS.MOUNT_ALLOWLIST)
  if (raw === undefined || raw === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      logger.warn(
        { key: TASK_RUNTIME_SETTING_KEYS.MOUNT_ALLOWLIST, raw },
        'mount_allowlist setting is not a JSON array — falling back to []',
      )
      return []
    }
    const strings: string[] = []
    for (const entry of parsed) {
      if (typeof entry === 'string' && entry.length > 0) {
        strings.push(entry)
      } else {
        logger.warn(
          { key: TASK_RUNTIME_SETTING_KEYS.MOUNT_ALLOWLIST, entry },
          'mount_allowlist contains non-string or empty entry — skipping',
        )
      }
    }
    return strings
  } catch (err) {
    logger.warn(
      { key: TASK_RUNTIME_SETTING_KEYS.MOUNT_ALLOWLIST, err, raw },
      'mount_allowlist setting is not valid JSON — falling back to []',
    )
    return []
  }
}

function readCap(key: string, defaultValue: number): number {
  const raw = readSettingValue(key)
  if (raw === undefined || raw === '') return defaultValue
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    logger.warn(
      { key, raw },
      'runtime cap setting is not a non-negative integer — falling back to default',
    )
    return defaultValue
  }
  return parsed
}

export function getMountsCap(): number {
  return readCap(TASK_RUNTIME_SETTING_KEYS.READ_ONLY_MOUNTS_CAP, DEFAULT_READ_ONLY_MOUNTS_CAP)
}

export function getExtraSkillsCap(): number {
  return readCap(TASK_RUNTIME_SETTING_KEYS.EXTRA_SKILLS_CAP, DEFAULT_EXTRA_SKILLS_CAP)
}

/**
 * Phase 14 runner getters (RUNNER-08, WORK-06, RUNNER-09).
 *
 * Consumers:
 *   - Plan 14-05 claim route: global cap + resource ceilings + project repo map
 *   - Plan 14-08b runner daemon GC tick: failed-task retention window
 *
 * Defensive-default pattern mirrors getMountsCap / getExtraSkillsCap: missing
 * row, empty string, or unparseable content falls back to the documented
 * default. A corrupt row must never brick claim or GC.
 */

export function getMaxConcurrentContainers(): number {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'runtime.max_concurrent_containers'`)
    .get() as { value: string } | undefined
  const parsed = row ? parseInt(row.value, 10) : DEFAULT_MAX_CONCURRENT_CONTAINERS
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_CONTAINERS
}

export function getProjectRepoMap(): Record<string, string> {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'runtime.project_repo_map'`)
    .get() as { value: string } | undefined
  if (!row?.value) return {}
  try {
    const parsed: unknown = JSON.parse(row.value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length > 0) out[k] = v
      }
      return out
    }
  } catch {
    /* fall through */
  }
  return {}
}

export function getMaxMemoryPerContainer(): string {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'runtime.max_memory_per_container'`)
    .get() as { value: string } | undefined
  return row?.value && row.value.length > 0 ? row.value : DEFAULT_MAX_MEMORY_PER_CONTAINER
}

export function getMaxCpuPerContainer(): number {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'runtime.max_cpu_per_container'`)
    .get() as { value: string } | undefined
  const parsed = row ? parseFloat(row.value) : DEFAULT_MAX_CPU_PER_CONTAINER
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CPU_PER_CONTAINER
}

export function getFailedGcWindowDays(): number {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'runtime.failed_gc_window_days'`)
    .get() as { value: string } | undefined
  const parsed = row ? parseInt(row.value, 10) : DEFAULT_FAILED_GC_WINDOW_DAYS
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FAILED_GC_WINDOW_DAYS
}

export function getDockerNetworkMode(): string {
  const raw = readSettingValue(TASK_RUNTIME_SETTING_KEYS.DOCKER_NETWORK_MODE)
  if (!raw) return DEFAULT_DOCKER_NETWORK_MODE
  const value = raw.trim()
  return value.length > 0 ? value : DEFAULT_DOCKER_NETWORK_MODE
}

export function getReviewPrSettings(): {
  provider: 'forgejo'
  remoteName: string
  forgejoBaseUrl: string
  forgejoToken: string
  forgejoWebhookSecret: string
  autoCreate: boolean
} {
  const provider =
    readSettingValue(TASK_RUNTIME_SETTING_KEYS.REVIEW_PR_PROVIDER)?.trim() ||
    DEFAULT_REVIEW_PR_PROVIDER
  if (provider !== 'forgejo') {
    throw new Error(`Unsupported review PR provider: ${provider}`)
  }

  const remoteName =
    readSettingValue(TASK_RUNTIME_SETTING_KEYS.REVIEW_PR_REMOTE_NAME)?.trim() ||
    DEFAULT_REVIEW_PR_REMOTE_NAME
  const forgejoBaseUrl =
    readSettingValue(TASK_RUNTIME_SETTING_KEYS.FORGEJO_BASE_URL)?.trim() ||
    DEFAULT_FORGEJO_BASE_URL
  const forgejoToken =
    readSettingValue(TASK_RUNTIME_SETTING_KEYS.FORGEJO_TOKEN)?.trim() ||
    DEFAULT_FORGEJO_TOKEN
  const forgejoWebhookSecret =
    readSettingValue(TASK_RUNTIME_SETTING_KEYS.FORGEJO_WEBHOOK_SECRET)?.trim() ||
    DEFAULT_FORGEJO_WEBHOOK_SECRET
  const autoCreateRaw = readSettingValue(TASK_RUNTIME_SETTING_KEYS.REVIEW_PR_AUTO_CREATE)

  return {
    provider,
    remoteName,
    forgejoBaseUrl,
    forgejoToken,
    forgejoWebhookSecret,
    autoCreate: autoCreateRaw !== 'false',
  }
}
