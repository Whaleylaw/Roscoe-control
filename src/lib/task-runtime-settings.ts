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
} as const

export const DEFAULT_READ_ONLY_MOUNTS_CAP = 10
export const DEFAULT_EXTRA_SKILLS_CAP = 20

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
