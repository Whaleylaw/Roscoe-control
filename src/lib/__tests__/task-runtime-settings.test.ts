import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../migrations'

// Hoisted holders — vi.mock factories run before top-level `const` assignments,
// so the factory must reach these through vi.hoisted.
const hoisted = vi.hoisted(() => ({
  warnSpy: (() => vi.fn())(),
  infoSpy: (() => vi.fn())(),
  errorSpy: (() => vi.fn())(),
  debugSpy: (() => vi.fn())(),
  dbRef: { current: null as Database.Database | null },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: hoisted.warnSpy,
    info: hoisted.infoSpy,
    error: hoisted.errorSpy,
    debug: hoisted.debugSpy,
  },
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => {
    if (!hoisted.dbRef.current) throw new Error('test did not initialise dbRef')
    return hoisted.dbRef.current
  },
}))

// Import AFTER mocks so the module binds to them.
import {
  getMountAllowlist,
  getMountsCap,
  getExtraSkillsCap,
  TASK_RUNTIME_SETTING_KEYS,
  DEFAULT_READ_ONLY_MOUNTS_CAP,
  DEFAULT_EXTRA_SKILLS_CAP,
} from '../task-runtime-settings'

function seedSetting(key: string, value: string) {
  if (!hoisted.dbRef.current) throw new Error('dbRef not set')
  hoisted.dbRef.current
    .prepare(
      `INSERT OR REPLACE INTO settings (key, value, category, updated_at) VALUES (?, ?, 'runtime', unixepoch())`,
    )
    .run(key, value)
}

beforeEach(() => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  hoisted.dbRef.current = db
  hoisted.warnSpy.mockReset()
  hoisted.infoSpy.mockReset()
  hoisted.errorSpy.mockReset()
  hoisted.debugSpy.mockReset()
})

afterEach(() => {
  hoisted.dbRef.current?.close()
  hoisted.dbRef.current = null
})

describe('task-runtime-settings: getMountAllowlist', () => {
  it('returns [] when setting row is absent (default path)', () => {
    expect(getMountAllowlist()).toEqual([])
    expect(hoisted.warnSpy).not.toHaveBeenCalled()
  })

  it("returns [] when stored value is the empty JSON array '[]'", () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.MOUNT_ALLOWLIST, '[]')
    expect(getMountAllowlist()).toEqual([])
    expect(hoisted.warnSpy).not.toHaveBeenCalled()
  })

  it('returns the parsed array when stored value is a JSON string array', () => {
    seedSetting(
      TASK_RUNTIME_SETTING_KEYS.MOUNT_ALLOWLIST,
      JSON.stringify(['/Users/me/repos', '/opt/refs']),
    )
    expect(getMountAllowlist()).toEqual(['/Users/me/repos', '/opt/refs'])
    expect(hoisted.warnSpy).not.toHaveBeenCalled()
  })

  it('returns [] and warns once when stored value is not valid JSON', () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.MOUNT_ALLOWLIST, 'not json')
    expect(getMountAllowlist()).toEqual([])
    expect(hoisted.warnSpy).toHaveBeenCalledTimes(1)
  })

  it('returns [] and warns when stored JSON is a scalar (not an array)', () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.MOUNT_ALLOWLIST, '"scalar-not-array"')
    expect(getMountAllowlist()).toEqual([])
    expect(hoisted.warnSpy).toHaveBeenCalledTimes(1)
  })

  it('filters non-string / empty entries from a mixed-type array and warns per skipped entry', () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.MOUNT_ALLOWLIST, '["/ok",42,""]')
    expect(getMountAllowlist()).toEqual(['/ok'])
    // 42 and '' are the two skipped entries
    expect(hoisted.warnSpy).toHaveBeenCalledTimes(2)
  })
})

describe('task-runtime-settings: getMountsCap', () => {
  it('returns DEFAULT_READ_ONLY_MOUNTS_CAP (10) when setting row is absent', () => {
    expect(getMountsCap()).toBe(DEFAULT_READ_ONLY_MOUNTS_CAP)
    expect(getMountsCap()).toBe(10)
  })

  it("returns the parsed integer when the row holds '25'", () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.READ_ONLY_MOUNTS_CAP, '25')
    expect(getMountsCap()).toBe(25)
    expect(hoisted.warnSpy).not.toHaveBeenCalled()
  })

  it('returns the default and warns when the row is a negative number', () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.READ_ONLY_MOUNTS_CAP, '-5')
    expect(getMountsCap()).toBe(10)
    expect(hoisted.warnSpy).toHaveBeenCalledTimes(1)
  })

  it('returns the default and warns when the row is non-numeric', () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.READ_ONLY_MOUNTS_CAP, 'abc')
    expect(getMountsCap()).toBe(10)
    expect(hoisted.warnSpy).toHaveBeenCalledTimes(1)
  })
})

describe('task-runtime-settings: getExtraSkillsCap', () => {
  it('returns DEFAULT_EXTRA_SKILLS_CAP (20) when setting row is absent', () => {
    expect(getExtraSkillsCap()).toBe(DEFAULT_EXTRA_SKILLS_CAP)
    expect(getExtraSkillsCap()).toBe(20)
  })

  it("returns the parsed integer when the row holds '50'", () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.EXTRA_SKILLS_CAP, '50')
    expect(getExtraSkillsCap()).toBe(50)
    expect(hoisted.warnSpy).not.toHaveBeenCalled()
  })
})
