/**
 * Tests for Phase 15-06 Task 1: recipe-watcher SSE emission.
 *
 * The watcher emits two SCHED-06 event types on its public API flow:
 *   - `recipe.indexed` when indexRecipe returns { status: 'indexed' }
 *   - `recipe.removed` when a row is dropped (skipped_missing on disk, or
 *     directory gone, or file-level unlink that cascades via indexRecipe)
 *
 * Cross-workspace semantics: events do NOT carry `workspace_id` (recipes are
 * workspace-agnostic; 15-CONTEXT.md § Event Emission & SSE Fan-out + SSE
 * route drop rule).
 *
 * This file sits alongside recipe-watcher.test.ts but covers a strictly
 * orthogonal axis: event emission rather than DB state reconciliation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runMigrations } from '../migrations'

// Mock event-bus BEFORE importing recipe-watcher so the broadcast calls hit
// the spy. Vitest hoists vi.mock() above the imports; this comment exists to
// stop a "tidy up" pass from moving it below.
vi.mock('../event-bus', () => ({
  eventBus: {
    broadcast: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
  },
}))

// Mock the DB singleton so recipe-watcher + recipe-indexer both see the
// in-memory instance (same pattern as recipe-watcher.test.ts).
let testDb: Database.Database
vi.mock('../db', () => ({
  getDatabase: () => testDb,
}))

import { scanRecipesDir, startRecipeWatcher, stopRecipeWatcher } from '../recipe-watcher'
import { eventBus } from '../event-bus'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

const validYaml = (slug: string) => `
slug: ${slug}
name: Recipe ${slug}
image: mc-agent
workspace_mode: worktree
timeout_seconds: 300
model:
  primary: claude-sonnet-4-6
`.trim()

function findBroadcast(
  type: 'recipe.indexed' | 'recipe.removed',
  match: (data: unknown) => boolean,
): [string, Record<string, unknown>] | undefined {
  const mock = vi.mocked(eventBus.broadcast)
  for (const call of mock.mock.calls) {
    if (call[0] === type && match(call[1])) {
      return [call[0] as string, call[1] as Record<string, unknown>]
    }
  }
  return undefined
}

describe('recipe watcher event emission — scanRecipesDir (boot / resync path)', () => {
  let recipesRoot: string

  beforeEach(() => {
    testDb = makeDb()
    recipesRoot = mkdtempSync(join(tmpdir(), 'recipes-events-'))
    vi.mocked(eventBus.broadcast).mockClear()
  })
  afterEach(() => {
    rmSync(recipesRoot, { recursive: true, force: true })
  })

  it('broadcasts recipe.indexed for each newly-indexed recipe (no workspace_id)', async () => {
    mkdirSync(join(recipesRoot, 'alpha'))
    writeFileSync(join(recipesRoot, 'alpha', 'recipe.yaml'), validYaml('alpha'))
    mkdirSync(join(recipesRoot, 'beta'))
    writeFileSync(join(recipesRoot, 'beta', 'recipe.yaml'), validYaml('beta'))

    const report = await scanRecipesDir({ recipesRoot })
    expect(report.updated).toBe(2)

    const indexedCalls = vi
      .mocked(eventBus.broadcast)
      .mock.calls.filter((c) => c[0] === 'recipe.indexed')

    expect(indexedCalls).toHaveLength(2)

    const slugs = indexedCalls.map((c) => (c[1] as { slug: string }).slug).sort()
    expect(slugs).toEqual(['alpha', 'beta'])

    // workspace_id MUST be absent — recipes are cross-workspace (15-CONTEXT.md
    // pitfall 5: SSE drops events with a PRESENT-but-mismatched workspace_id).
    for (const [, payload] of indexedCalls) {
      expect(payload).not.toHaveProperty('workspace_id')
      expect(payload).toHaveProperty('slug')
      expect(payload).toHaveProperty('dir_sha')
      expect(typeof (payload as { dir_sha: unknown }).dir_sha).toBe('string')
      expect((payload as { dir_sha: string }).dir_sha.length).toBeGreaterThan(0)
    }
  })

  it('does NOT broadcast for error-status recipes (valid/broken mix)', async () => {
    mkdirSync(join(recipesRoot, 'broken'))
    // Unterminated flow-sequence → YAML syntax error path
    writeFileSync(join(recipesRoot, 'broken', 'recipe.yaml'), 'tags: [unterminated\nslug: broken')
    mkdirSync(join(recipesRoot, 'valid'))
    writeFileSync(join(recipesRoot, 'valid', 'recipe.yaml'), validYaml('valid'))

    const report = await scanRecipesDir({ recipesRoot })
    expect(report.scanned).toBe(2)
    expect(report.errors).toHaveLength(1)

    const indexedCalls = vi
      .mocked(eventBus.broadcast)
      .mock.calls.filter((c) => c[0] === 'recipe.indexed')

    expect(indexedCalls).toHaveLength(1)
    expect((indexedCalls[0][1] as { slug: string }).slug).toBe('valid')

    const removedCalls = vi
      .mocked(eventBus.broadcast)
      .mock.calls.filter((c) => c[0] === 'recipe.removed')
    expect(removedCalls).toHaveLength(0)
  })

  it('broadcasts recipe.removed when a DB row is dropped (directory disappeared between scans)', async () => {
    mkdirSync(join(recipesRoot, 'gamma'))
    writeFileSync(join(recipesRoot, 'gamma', 'recipe.yaml'), validYaml('gamma'))

    await scanRecipesDir({ recipesRoot })
    vi.mocked(eventBus.broadcast).mockClear()

    rmSync(join(recipesRoot, 'gamma'), { recursive: true })
    const second = await scanRecipesDir({ recipesRoot })
    expect(second.deleted).toBe(1)

    const removedCalls = vi
      .mocked(eventBus.broadcast)
      .mock.calls.filter((c) => c[0] === 'recipe.removed')
    expect(removedCalls).toHaveLength(1)

    const [, payload] = removedCalls[0]
    expect(payload).toEqual({ slug: 'gamma' })
    expect(payload).not.toHaveProperty('workspace_id')
  })

  it('broadcasts recipe.removed via skipped_missing path (directory present, recipe.yaml deleted)', async () => {
    mkdirSync(join(recipesRoot, 'stub'))
    writeFileSync(join(recipesRoot, 'stub', 'recipe.yaml'), validYaml('stub'))
    await scanRecipesDir({ recipesRoot })
    vi.mocked(eventBus.broadcast).mockClear()

    unlinkSync(join(recipesRoot, 'stub', 'recipe.yaml'))
    const second = await scanRecipesDir({ recipesRoot })
    expect(second.deleted).toBeGreaterThanOrEqual(1)

    const removedForStub = findBroadcast(
      'recipe.removed',
      (data) => (data as { slug?: string }).slug === 'stub',
    )
    expect(removedForStub).toBeDefined()
    expect(removedForStub![1]).toEqual({ slug: 'stub' })
    expect(removedForStub![1]).not.toHaveProperty('workspace_id')
  })
})

describe('recipe watcher event emission — chokidar watch path', () => {
  let recipesRoot: string

  beforeEach(() => {
    testDb = makeDb()
    recipesRoot = mkdtempSync(join(tmpdir(), 'recipes-events-watch-'))
    vi.mocked(eventBus.broadcast).mockClear()
  })
  afterEach(async () => {
    await stopRecipeWatcher()
    rmSync(recipesRoot, { recursive: true, force: true })
  })

  it('broadcasts recipe.indexed after a live change event (debounce observed)', async () => {
    mkdirSync(join(recipesRoot, 'delta'))
    writeFileSync(join(recipesRoot, 'delta', 'recipe.yaml'), validYaml('delta'))

    await startRecipeWatcher({ recipesRoot })

    // Boot scan emitted one indexed event; clear the spy so we only see the
    // watcher-driven broadcast from the upcoming modification.
    vi.mocked(eventBus.broadcast).mockClear()

    writeFileSync(
      join(recipesRoot, 'delta', 'recipe.yaml'),
      validYaml('delta').replace('300', '600'),
    )
    // Wait longer than awaitWriteFinish (200ms) + DEBOUNCE_MS (250ms) + buffer.
    await new Promise((r) => setTimeout(r, 1200))

    const indexedForDelta = findBroadcast(
      'recipe.indexed',
      (data) => (data as { slug?: string }).slug === 'delta',
    )
    expect(indexedForDelta).toBeDefined()
    expect(indexedForDelta![1]).toHaveProperty('slug', 'delta')
    expect(indexedForDelta![1]).toHaveProperty('dir_sha')
    expect(indexedForDelta![1]).not.toHaveProperty('workspace_id')
  })
})
