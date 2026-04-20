/**
 * Plan 14-05 pure-unit tests for src/lib/runner-claim.ts.
 *
 * Covers:
 *   - resolveEffectiveModel precedence (MODEL-04)
 *   - composeEnvMap merge order + MC_MODEL_FALLBACK omission + params JSON
 *   - resolveResourceLimits defaults + ceiling enforcement
 *   - checkGlobalCap / checkPerRecipeCap counts with pending-placeholder rows
 *   - readPriorAttempts ordering
 *   - resolveRecipeMaxAttempts filesystem re-parse (missing / present / absent-field)
 *
 * Test infrastructure mirrors `runtime-settings-phase14.test.ts`:
 *   - vi.hoisted db + logger mocks
 *   - In-memory better-sqlite3 via runMigrations()
 *   - mkdtemp-backed recipes root fixture
 */

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMigrations } from '../migrations'

const hoisted = vi.hoisted(() => ({
  warnSpy: vi.fn(),
  infoSpy: vi.fn(),
  errorSpy: vi.fn(),
  debugSpy: vi.fn(),
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
  resolveEffectiveModel,
  composeEnvMap,
  resolveResourceLimits,
  checkGlobalCap,
  checkPerRecipeCap,
  readPriorAttempts,
  resolveRecipeMaxAttempts,
  buildDispatchPayload,
  parseMemoryBytes,
  RUNNER_DEFAULT_MEMORY_LIMIT,
  RUNNER_DEFAULT_CPU_LIMIT,
} from '../runner-claim'

let tmpRecipesRoot: string

beforeEach(async () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  hoisted.dbRef.current = db
  hoisted.warnSpy.mockReset()
  hoisted.infoSpy.mockReset()
  hoisted.errorSpy.mockReset()
  hoisted.debugSpy.mockReset()
  tmpRecipesRoot = await mkdtemp(join(tmpdir(), 'mc14-05-'))
})

afterEach(async () => {
  hoisted.dbRef.current?.close()
  hoisted.dbRef.current = null
  if (tmpRecipesRoot) await rm(tmpRecipesRoot, { recursive: true, force: true })
})

// Helper to seed a task row (minimal columns + the 14-01/14-02 runtime columns).
function seedTask(
  status: string,
  recipeSlug: string | null,
  containerId: string | null,
  runnerAttempts = 0,
): number {
  const db = hoisted.dbRef.current!
  const result = db
    .prepare(
      `INSERT INTO tasks (title, status, priority, created_by, recipe_slug, container_id, runner_attempts)
       VALUES (?, ?, 'medium', 'test', ?, ?, ?)`,
    )
    .run('task', status, recipeSlug, containerId, runnerAttempts)
  return Number(result.lastInsertRowid)
}

// ---------------------------------------------------------------------------
// 1-2. resolveEffectiveModel (MODEL-04)
// ---------------------------------------------------------------------------

describe('resolveEffectiveModel (MODEL-04)', () => {
  it('returns taskOverride when set', () => {
    expect(resolveEffectiveModel('claude-opus-4-7', 'claude-sonnet-4-6')).toBe(
      'claude-opus-4-7',
    )
  })

  it('returns recipePrimary when override is null / undefined / empty string', () => {
    expect(resolveEffectiveModel(null, 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    expect(resolveEffectiveModel(undefined, 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    expect(resolveEffectiveModel('', 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })
})

// ---------------------------------------------------------------------------
// 3-5. composeEnvMap (CONTAINER-01)
// ---------------------------------------------------------------------------

describe('composeEnvMap', () => {
  const baseParams = {
    apiUrl: 'http://host.docker.internal:3000',
    taskId: 42,
    workspacePath: '/workspace',
    recipePath: '/recipe',
    preamblePath: '/recipe/PREAMBLE.md',
    runnerToken: 'rt-abc',
    modelPrimary: 'claude-opus-4-7',
    modelProvider: 'anthropic',
    modelParams: { temperature: 0.2, max_tokens: 8192 },
  } as const

  it('emits all MC_* system keys and stringifies model params', () => {
    const env = composeEnvMap({ ...baseParams })
    expect(env.MC_API_URL).toBe('http://host.docker.internal:3000')
    expect(env.MC_TASK_ID).toBe('42')
    expect(env.MC_API_TOKEN).toBe('rt-abc')
    expect(env.MC_WORKSPACE).toBe('/workspace')
    expect(env.MC_RECIPE_PATH).toBe('/recipe')
    expect(env.MC_PREAMBLE_PATH).toBe('/recipe/PREAMBLE.md')
    expect(env.MC_MODEL_PRIMARY).toBe('claude-opus-4-7')
    expect(env.MC_MODEL_PROVIDER).toBe('anthropic')
    expect(JSON.parse(env.MC_MODEL_PARAMS_JSON)).toEqual({ temperature: 0.2, max_tokens: 8192 })
  })

  it('merges recipeEnv OVER MC_* keys and recipeSecrets OVER recipeEnv', () => {
    const env = composeEnvMap({
      ...baseParams,
      recipeEnv: { DEBUG: '1', SHARED: 'from-env' },
      recipeSecrets: { SHARED: 'from-secrets', ANTHROPIC_API_KEY: 'sk-xxx' },
    })
    expect(env.DEBUG).toBe('1')
    expect(env.SHARED).toBe('from-secrets') // secrets win
    expect(env.ANTHROPIC_API_KEY).toBe('sk-xxx')
    // System MC_* still present
    expect(env.MC_API_URL).toBe('http://host.docker.internal:3000')
  })

  it('omits MC_MODEL_FALLBACK when modelFallback is null / undefined / empty', () => {
    const e1 = composeEnvMap({ ...baseParams, modelFallback: null })
    const e2 = composeEnvMap({ ...baseParams, modelFallback: undefined })
    const e3 = composeEnvMap({ ...baseParams, modelFallback: '' })
    expect('MC_MODEL_FALLBACK' in e1).toBe(false)
    expect('MC_MODEL_FALLBACK' in e2).toBe(false)
    expect('MC_MODEL_FALLBACK' in e3).toBe(false)
  })

  it('emits MC_MODEL_FALLBACK when modelFallback is a non-empty string', () => {
    const env = composeEnvMap({ ...baseParams, modelFallback: 'claude-sonnet-4-6' })
    expect(env.MC_MODEL_FALLBACK).toBe('claude-sonnet-4-6')
  })

  it('defaults MC_MODEL_PARAMS_JSON to "{}" when modelParams is undefined', () => {
    const env = composeEnvMap({ ...baseParams, modelParams: undefined })
    expect(env.MC_MODEL_PARAMS_JSON).toBe('{}')
  })
})

// ---------------------------------------------------------------------------
// 6-9. resolveResourceLimits (RUNNER-09)
// ---------------------------------------------------------------------------

describe('resolveResourceLimits', () => {
  it('uses recipe values when present and under ceilings', () => {
    const r = resolveResourceLimits({
      recipeMemoryLimit: '4g',
      recipeCpuLimit: 2.0,
      adminMemoryCeiling: '8g',
      adminCpuCeiling: 4.0,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.memory).toBe('4g')
    expect(r.cpus).toBe(2.0)
  })

  it('falls back to runner defaults (2g, 1.0) when recipe values are absent', () => {
    const r = resolveResourceLimits({
      recipeMemoryLimit: null,
      recipeCpuLimit: null,
      adminMemoryCeiling: '8g',
      adminCpuCeiling: 4.0,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.memory).toBe(RUNNER_DEFAULT_MEMORY_LIMIT)
    expect(r.cpus).toBe(RUNNER_DEFAULT_CPU_LIMIT)
  })

  it('rejects when recipe.memory_limit exceeds admin ceiling (CAP_EXCEEDED)', () => {
    const r = resolveResourceLimits({
      recipeMemoryLimit: '16g',
      recipeCpuLimit: 1.0,
      adminMemoryCeiling: '8g',
      adminCpuCeiling: 4.0,
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error.code).toBe('CAP_EXCEEDED')
    expect(r.error.field).toBe('recipe.memory_limit')
    expect(r.error.message).toContain('16g')
    expect(r.error.message).toContain('8g')
  })

  it('rejects when recipe.cpu_limit exceeds admin ceiling (CAP_EXCEEDED)', () => {
    const r = resolveResourceLimits({
      recipeMemoryLimit: '2g',
      recipeCpuLimit: 8.0,
      adminMemoryCeiling: '8g',
      adminCpuCeiling: 4.0,
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error.code).toBe('CAP_EXCEEDED')
    expect(r.error.field).toBe('recipe.cpu_limit')
  })

  it('rejects a malformed recipe.memory_limit with INVALID_FIELD', () => {
    const r = resolveResourceLimits({
      recipeMemoryLimit: 'nonsense',
      recipeCpuLimit: 1.0,
      adminMemoryCeiling: '8g',
      adminCpuCeiling: 4.0,
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error.code).toBe('INVALID_FIELD')
  })

  it('parseMemoryBytes handles b / k / m / g suffixes (case-insensitive)', () => {
    expect(parseMemoryBytes('2g')).toBe(2 * 1024 ** 3)
    expect(parseMemoryBytes('2G')).toBe(2 * 1024 ** 3)
    expect(parseMemoryBytes('512m')).toBe(512 * 1024 ** 2)
    expect(parseMemoryBytes('512MB')).toBe(512 * 1024 ** 2)
    expect(parseMemoryBytes('1024k')).toBe(1024 * 1024)
    expect(parseMemoryBytes('1000')).toBe(1000)
    expect(Number.isNaN(parseMemoryBytes('abc'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 10-12. checkGlobalCap / checkPerRecipeCap (RUNNER-08)
// ---------------------------------------------------------------------------

describe('checkGlobalCap / checkPerRecipeCap', () => {
  it('checkGlobalCap returns ok when current count < max', () => {
    seedTask('in_progress', 'recipe-a', 'pending:1:1')
    const r = checkGlobalCap(hoisted.dbRef.current!, 4)
    expect(r.ok).toBe(true)
  })

  it('checkGlobalCap returns !ok with current=max when at cap (includes pending placeholders)', () => {
    seedTask('in_progress', 'recipe-a', 'pending:1:1')
    seedTask('in_progress', 'recipe-a', 'pending:2:1')
    seedTask('in_progress', 'recipe-b', 'abc123')
    seedTask('in_progress', 'recipe-b', 'def456')
    const r = checkGlobalCap(hoisted.dbRef.current!, 4)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.current).toBe(4)
  })

  it('checkGlobalCap ignores rows without container_id and rows in other statuses', () => {
    seedTask('in_progress', 'recipe-a', null) // claimed-but-not-running? no, claim always sets placeholder — still should not count
    seedTask('assigned', 'recipe-a', null)
    seedTask('done', 'recipe-a', 'completed-id')
    const r = checkGlobalCap(hoisted.dbRef.current!, 1)
    expect(r.ok).toBe(true)
  })

  it('checkPerRecipeCap filters by recipe_slug', () => {
    seedTask('in_progress', 'recipe-a', 'x1')
    seedTask('in_progress', 'recipe-a', 'x2')
    seedTask('in_progress', 'recipe-b', 'x3') // different recipe, irrelevant
    const hit = checkPerRecipeCap(hoisted.dbRef.current!, 'recipe-a', 2)
    expect(hit.ok).toBe(false)
    if (hit.ok) throw new Error('unreachable')
    expect(hit.current).toBe(2)

    const miss = checkPerRecipeCap(hoisted.dbRef.current!, 'recipe-b', 2)
    expect(miss.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 13-14. readPriorAttempts (WORK-02)
// ---------------------------------------------------------------------------

describe('readPriorAttempts', () => {
  it('returns empty array when no rows', () => {
    const taskId = seedTask('in_progress', 'recipe-a', 'pending:1:1')
    expect(readPriorAttempts(hoisted.dbRef.current!, taskId)).toEqual([])
  })

  it('returns rows sorted by attempt ASC', () => {
    const taskId = seedTask('in_progress', 'recipe-a', 'pending:1:3')
    const db = hoisted.dbRef.current!
    const insert = db.prepare(
      `INSERT INTO task_runner_attempts (task_id, attempt, started_at, exit_code, failure_reason)
       VALUES (?, ?, ?, ?, ?)`,
    )
    // Insert in reverse order — helper should re-sort.
    insert.run(taskId, 2, 2000, 137, 'container_oom')
    insert.run(taskId, 1, 1000, 1, 'crash')

    const rows = readPriorAttempts(db, taskId)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ attempt: 1, started_at: 1000, exit_code: 1, failure_reason: 'crash' })
    expect(rows[1]).toMatchObject({ attempt: 2, started_at: 2000, exit_code: 137, failure_reason: 'container_oom' })
  })
})

// ---------------------------------------------------------------------------
// 15-17. resolveRecipeMaxAttempts (LOCKED)
// ---------------------------------------------------------------------------

describe('resolveRecipeMaxAttempts', () => {
  const minimalYaml = `
slug: example
name: Example
image: some-image
workspace_mode: worktree
timeout_seconds: 300
model:
  primary: claude-sonnet-4-6
`.trim()

  it('returns undefined when recipe.yaml is missing', () => {
    // No file seeded in tmpRecipesRoot/example/ — should resolve to undefined.
    expect(resolveRecipeMaxAttempts('example', tmpRecipesRoot)).toBeUndefined()
  })

  it('returns the numeric value when recipe.yaml declares max_attempts: 5', async () => {
    const recipeDir = join(tmpRecipesRoot, 'example')
    await mkdir(recipeDir, { recursive: true })
    await writeFile(
      join(recipeDir, 'recipe.yaml'),
      `${minimalYaml}\nmax_attempts: 5\n`,
      'utf8',
    )
    expect(resolveRecipeMaxAttempts('example', tmpRecipesRoot)).toBe(5)
  })

  it('returns undefined when recipe.yaml has no max_attempts field', async () => {
    const recipeDir = join(tmpRecipesRoot, 'example')
    await mkdir(recipeDir, { recursive: true })
    await writeFile(join(recipeDir, 'recipe.yaml'), minimalYaml, 'utf8')
    expect(resolveRecipeMaxAttempts('example', tmpRecipesRoot)).toBeUndefined()
  })

  it('returns undefined when recipe.yaml is malformed (non-throwing)', async () => {
    const recipeDir = join(tmpRecipesRoot, 'example')
    await mkdir(recipeDir, { recursive: true })
    await writeFile(join(recipeDir, 'recipe.yaml'), '!!! not yaml at all :::', 'utf8')
    expect(resolveRecipeMaxAttempts('example', tmpRecipesRoot)).toBeUndefined()
  })

  it('returns undefined for empty slug (defensive)', () => {
    expect(resolveRecipeMaxAttempts('', tmpRecipesRoot)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 18. buildDispatchPayload shape sanity
// ---------------------------------------------------------------------------

describe('buildDispatchPayload', () => {
  it('sets is_resuming=false when newAttempt === 1', () => {
    const p = buildDispatchPayload({
      taskId: 1,
      recipeSlug: 'r',
      workspaceSource: null,
      readOnlyMounts: [],
      extraSkills: [],
      newAttempt: 1,
      priorAttempts: [],
      runnerMaxAttempts: 3,
    })
    expect(p.is_resuming).toBe(false)
    expect(p.attempt).toBe(1)
    expect(p.prior_attempts).toEqual([])
  })

  it('sets is_resuming=true when newAttempt > 1 and preserves priorAttempts verbatim', () => {
    const prior = [
      { attempt: 1, started_at: 1000, exit_code: 1, failure_reason: 'crash' },
    ]
    const p = buildDispatchPayload({
      taskId: 1,
      recipeSlug: 'r',
      workspaceSource: { project_id: 1, base_ref: 'main' },
      readOnlyMounts: [{ host_path: '/x', container_path: '/y', label: 'z' }],
      extraSkills: ['/skills/a'],
      newAttempt: 2,
      priorAttempts: prior,
      runnerMaxAttempts: 3,
    })
    expect(p.is_resuming).toBe(true)
    expect(p.attempt).toBe(2)
    expect(p.prior_attempts).toBe(prior)
    expect(p.workspace_source).toEqual({ project_id: 1, base_ref: 'main' })
  })
})
