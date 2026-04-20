/**
 * Phase 14 Plan 14-02 unit tests.
 *
 * Covers:
 *   1. Five runtime.* getters exported from `task-runtime-settings`:
 *      getMaxConcurrentContainers, getProjectRepoMap,
 *      getMaxMemoryPerContainer, getMaxCpuPerContainer, getFailedGcWindowDays
 *   2. Optional `max_attempts` (int 1..10) field on the recipe Zod schema.
 *
 * Test infra mirrors `task-runtime-settings.test.ts` — vi.hoisted db + logger
 * mocks, in-memory sqlite via runMigrations().
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../migrations'

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

// Imports AFTER mocks so the modules bind to them.
import {
  getMaxConcurrentContainers,
  getProjectRepoMap,
  getMaxMemoryPerContainer,
  getMaxCpuPerContainer,
  getFailedGcWindowDays,
  TASK_RUNTIME_SETTING_KEYS,
  DEFAULT_MAX_CONCURRENT_CONTAINERS,
  DEFAULT_MAX_MEMORY_PER_CONTAINER,
  DEFAULT_MAX_CPU_PER_CONTAINER,
  DEFAULT_FAILED_GC_WINDOW_DAYS,
} from '../task-runtime-settings'
import { parseRecipeYaml } from '../recipe-schema'

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

describe('task-runtime-settings Phase 14: getMaxConcurrentContainers', () => {
  it('returns DEFAULT_MAX_CONCURRENT_CONTAINERS (4) when no setting row exists', () => {
    expect(getMaxConcurrentContainers()).toBe(DEFAULT_MAX_CONCURRENT_CONTAINERS)
    expect(getMaxConcurrentContainers()).toBe(4)
  })

  it("returns the parsed integer when the row holds '6'", () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.MAX_CONCURRENT_CONTAINERS, '6')
    expect(getMaxConcurrentContainers()).toBe(6)
  })

  it('falls back to the default when row value is non-numeric junk', () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.MAX_CONCURRENT_CONTAINERS, 'abc')
    expect(getMaxConcurrentContainers()).toBe(4)
  })
})

describe('task-runtime-settings Phase 14: getProjectRepoMap', () => {
  it('returns {} when no row exists', () => {
    expect(getProjectRepoMap()).toEqual({})
  })

  it('returns the parsed object when row has valid JSON', () => {
    seedSetting(
      TASK_RUNTIME_SETTING_KEYS.PROJECT_REPO_MAP,
      JSON.stringify({ '1': '/Users/me/repos/a', '2': '/Users/me/repos/b' }),
    )
    expect(getProjectRepoMap()).toEqual({
      '1': '/Users/me/repos/a',
      '2': '/Users/me/repos/b',
    })
  })

  it('returns {} when row value is malformed JSON (defensive)', () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.PROJECT_REPO_MAP, '{not json')
    expect(getProjectRepoMap()).toEqual({})
  })
})

describe('task-runtime-settings Phase 14: getMaxMemoryPerContainer', () => {
  it("returns default '8g' when no row exists", () => {
    expect(getMaxMemoryPerContainer()).toBe(DEFAULT_MAX_MEMORY_PER_CONTAINER)
    expect(getMaxMemoryPerContainer()).toBe('8g')
  })

  it("returns stored value '12g' when row is set", () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.MAX_MEMORY_PER_CONTAINER, '12g')
    expect(getMaxMemoryPerContainer()).toBe('12g')
  })
})

describe('task-runtime-settings Phase 14: getMaxCpuPerContainer', () => {
  it('returns default 4.0 when no row exists', () => {
    expect(getMaxCpuPerContainer()).toBe(DEFAULT_MAX_CPU_PER_CONTAINER)
    expect(getMaxCpuPerContainer()).toBe(4.0)
  })

  it("returns 2.5 when stored as '2.5'", () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.MAX_CPU_PER_CONTAINER, '2.5')
    expect(getMaxCpuPerContainer()).toBe(2.5)
  })
})

describe('task-runtime-settings Phase 14: getFailedGcWindowDays', () => {
  it('returns default 7 when no row exists', () => {
    expect(getFailedGcWindowDays()).toBe(DEFAULT_FAILED_GC_WINDOW_DAYS)
    expect(getFailedGcWindowDays()).toBe(7)
  })

  it("returns 14 when stored as '14'", () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.FAILED_GC_WINDOW_DAYS, '14')
    expect(getFailedGcWindowDays()).toBe(14)
  })

  it('returns default 7 when stored as junk', () => {
    seedSetting(TASK_RUNTIME_SETTING_KEYS.FAILED_GC_WINDOW_DAYS, 'xyz')
    expect(getFailedGcWindowDays()).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// recipe-schema max_attempts field (optional int 1..10)
// ---------------------------------------------------------------------------

const minimalValidYaml = `
slug: hello-world
name: Hello World
image: mc-hello-world-agent
workspace_mode: worktree
timeout_seconds: 300
model:
  primary: claude-sonnet-4-6
`.trim()

describe('recipe-schema: max_attempts (Phase 14 — RUNNER-08)', () => {
  it('accepts a recipe with max_attempts: 5', () => {
    const yaml = `${minimalValidYaml}\nmax_attempts: 5\n`
    const result = parseRecipeYaml(yaml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.value.max_attempts).toBe(5)
  })

  it('accepts a recipe WITHOUT max_attempts (field is optional)', () => {
    const result = parseRecipeYaml(minimalValidYaml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.value.max_attempts).toBeUndefined()
  })

  it('rejects max_attempts: 0 with a Zod issue on path max_attempts', () => {
    const yaml = `${minimalValidYaml}\nmax_attempts: 0\n`
    const result = parseRecipeYaml(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/max_attempts/)
  })

  it('rejects max_attempts: 11 with a Zod issue on path max_attempts', () => {
    const yaml = `${minimalValidYaml}\nmax_attempts: 11\n`
    const result = parseRecipeYaml(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/max_attempts/)
  })
})
