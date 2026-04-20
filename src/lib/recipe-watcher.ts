/**
 * Recipe directory watcher + boot scanner + admin-resync entry point.
 *
 * Makes `recipes/<slug>/` the source of truth. At server boot we eagerly
 * reconcile the DB with disk (insert new, drop stale, skip unchanged) BEFORE
 * the server starts accepting traffic. After boot, chokidar watches the
 * recipes root and debounces add/change/unlink bursts per-slug to 250ms
 * before re-running the indexer.
 *
 * CONTEXT.md locks applied here:
 *   - Eager blocking boot scan (no async settle)
 *   - 250ms per-slug debounce
 *   - Watch only known filenames (recipe.yaml, SOUL.md, README.md, tools/**, skills/**)
 *   - Ignore editor/OS noise (.swp, ~, .tmp, .DS_Store)
 *   - Synchronous admin-facing resync() returns a typed report
 *
 * Boundary notes:
 *   - This module does NOT install any server-start hook. Plan 12-04 is
 *     responsible for calling startRecipeWatcher() after the resync API
 *     route is registered, so traffic only opens once both are live.
 *   - All write paths go through indexRecipe / removeRecipe from Plan 12-02.
 *     There is no alternative way to update a recipes row.
 */

import { readdir, stat } from 'fs/promises'
import { join, resolve, basename } from 'path'
import type { FSWatcher } from 'chokidar'
import chokidar from 'chokidar'
import { logger } from './logger'
import { indexRecipe, removeRecipe } from './recipe-indexer'
import { eventBus } from './event-bus'

/**
 * Returns the absolute recipes directory.
 *
 * Resolution order:
 *   1. MISSION_CONTROL_RECIPES_DIR (if set, used verbatim as absolute or cwd-relative)
 *   2. <process.cwd()>/recipes
 *
 * We deliberately DO NOT default to MISSION_CONTROL_DATA_DIR/recipes because
 * recipe directories are authored code (committed to the repo, not runtime state).
 * They live alongside `scripts/` and `src/`.
 */
export function getRecipesRoot(): string {
  const env = process.env.MISSION_CONTROL_RECIPES_DIR
  if (env && env.trim()) return resolve(env)
  return resolve(process.cwd(), 'recipes')
}

export interface ResyncReport {
  scanned: number
  inserted: number
  updated: number
  deleted: number
  errors: Array<{ slug: string; reason: string }>
}

/**
 * Perform a single eager scan of the recipes root, reconciling the DB:
 *   - For each subdirectory of recipesRoot, call indexRecipe
 *   - Any DB row whose slug does NOT correspond to an on-disk directory is removed
 *   - Returns a ResyncReport
 *
 * If recipesRoot does not exist, returns a zero-count report (this is legitimate
 * in dev environments where the user has not created `recipes/` yet).
 *
 * Used by startRecipeWatcher (boot flow) and resyncRecipes (admin endpoint).
 */
export async function scanRecipesDir(opts?: {
  recipesRoot?: string
  workspaceId?: number
  tenantId?: number
}): Promise<ResyncReport> {
  const root = opts?.recipesRoot ?? getRecipesRoot()
  const report: ResyncReport = { scanned: 0, inserted: 0, updated: 0, deleted: 0, errors: [] }

  // If the root does not exist, treat as "zero recipes on disk" and drop any
  // rows from the DB (someone deleted the entire recipes directory).
  let rootExists = true
  try {
    const rootStat = await stat(root)
    if (!rootStat.isDirectory()) rootExists = false
  } catch {
    rootExists = false
  }

  const diskSlugs = new Set<string>()

  if (rootExists) {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      // Skip hidden dirs (.git, .DS_Store inside the recipes root, etc.)
      if (entry.name.startsWith('.')) continue

      const absDir = join(root, entry.name)
      diskSlugs.add(entry.name)
      report.scanned += 1

      try {
        const result = await indexRecipe(absDir, {
          workspaceId: opts?.workspaceId ?? 1,
          tenantId: opts?.tenantId ?? 1,
        })
        switch (result.status) {
          case 'indexed':
            // POST /api/recipes/resync's CONTEXT.md contract does not demand a
            // strict insert-vs-update split; indexRecipe UPSERTs, so we count
            // every successful write as 'updated'. The caller sees the total
            // number of rows touched without needing a pre-SELECT.
            report.updated += 1
            // SCHED-06: broadcast recipe.indexed on initial/boot index. Global
            // (no workspace_id) per 15-CONTEXT.md — recipes are cross-workspace
            // and the SSE route only drops events with a PRESENT-but-mismatched
            // workspace_id (absent flows through to every subscriber).
            eventBus.broadcast('recipe.indexed', { slug: result.slug, dir_sha: result.dirSha })
            break
          case 'unchanged':
            // Fast-path dedup. Not counted.
            break
          case 'error':
            report.errors.push({ slug: result.slug, reason: result.error })
            // Error rows still land in the DB — diskSlugs already contains
            // this slug, so reconciliation below will NOT delete the error row.
            // No event emitted: the event stream is reserved for transitions
            // into/out of the "valid indexed" state; Phase 16 UI polls the DB
            // for error rows directly.
            break
          case 'skipped_missing': {
            // Directory exists but recipe.yaml is absent — not an error, just
            // "folder with no recipe". If a DB row existed for this slug,
            // it's orphaned: remove it. Users can re-add recipe.yaml later
            // to resurrect it.
            const { removed } = removeRecipe(result.slug)
            if (removed) {
              report.deleted += 1
              // SCHED-06: broadcast recipe.removed only when a row was actually
              // dropped — a directory that never had a row doesn't need an event.
              eventBus.broadcast('recipe.removed', { slug: result.slug })
            }
            // Drop from diskSlugs so the reconciliation sweep below doesn't
            // also try to remove it (avoids double-counting report.deleted).
            diskSlugs.delete(result.slug)
            break
          }
        }
      } catch (err) {
        const reason = (err as Error).message || String(err)
        logger.error({ slug: entry.name, path: absDir, reason }, 'scanRecipesDir: indexRecipe threw')
        report.errors.push({ slug: entry.name, reason })
      }
    }
  }

  // Drop any DB rows whose slug does NOT appear on disk (the directory was
  // deleted since the last scan). Dynamic import keeps this file cheap to
  // load in contexts that never call the scanner.
  const db = (await import('./db')).getDatabase()
  const allRows = db.prepare(`SELECT slug FROM recipes`).all() as Array<{ slug: string }>
  for (const row of allRows) {
    if (!diskSlugs.has(row.slug)) {
      const { removed } = removeRecipe(row.slug)
      if (removed) {
        report.deleted += 1
        // SCHED-06: cross-workspace global event (no workspace_id).
        eventBus.broadcast('recipe.removed', { slug: row.slug })
      }
    }
  }

  return report
}

/**
 * Force a full resync. Behaves identically to scanRecipesDir but is the public
 * admin-facing entry point (called from POST /api/recipes/resync in 12-04).
 */
export async function resyncRecipes(opts?: {
  recipesRoot?: string
  workspaceId?: number
  tenantId?: number
}): Promise<ResyncReport> {
  logger.info({ root: opts?.recipesRoot ?? getRecipesRoot() }, 'resyncRecipes: starting')
  const report = await scanRecipesDir(opts)
  logger.info({ ...report }, 'resyncRecipes: complete')
  return report
}

// ---------- chokidar watcher ----------

/**
 * Known recipe filenames that trigger reindexing. Anything outside these
 * (and the tools/** / skills/** subtrees handled below) is ignored — this
 * is CONTEXT.md's "watch only the known recipe filenames" requirement.
 */
const WATCHED_ROOT_FILES = ['recipe.yaml', 'SOUL.md', 'README.md'] as const

let _watcher: FSWatcher | null = null
const _debounceTimers = new Map<string, NodeJS.Timeout>()
const DEBOUNCE_MS = 250

/**
 * Derive the owning recipe slug from an event path.
 *
 * For `/abs/recipes/my-slug/tools/foo.sh`, returns `my-slug`.
 * Returns null if the path is directly at the root or the first segment is
 * a hidden directory.
 */
function extractSlug(eventPath: string, recipesRoot: string): string | null {
  const abs = resolve(eventPath)
  const rootAbs = resolve(recipesRoot)
  if (!abs.startsWith(rootAbs)) return null
  const rel = abs.slice(rootAbs.length)
  const parts = rel.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts[0].startsWith('.')) return null
  return parts[0]
}

function scheduleReindex(slug: string, absDir: string, kind: 'change' | 'unlink'): void {
  const key = `${kind}:${slug}`
  const existing = _debounceTimers.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(async () => {
    _debounceTimers.delete(key)
    try {
      if (kind === 'unlink') {
        // A file was unlinked inside this recipe. Re-run indexRecipe: if
        // recipe.yaml is still present, the row is refreshed with a new
        // dir_sha; if recipe.yaml is the file that was removed, the result
        // is `skipped_missing` and we drop the row.
        const result = await indexRecipe(absDir)
        if (result.status === 'skipped_missing') {
          removeRecipe(slug)
          logger.info({ slug, path: absDir }, 'recipe removed (recipe.yaml gone)')
          // SCHED-06: cross-workspace global event (no workspace_id).
          eventBus.broadcast('recipe.removed', { slug })
        } else if (result.status === 'indexed') {
          logger.info({ slug, path: absDir }, 'recipe re-indexed after partial unlink')
          // SCHED-06: carry dir_sha so clients can correlate with DB rows.
          eventBus.broadcast('recipe.indexed', { slug, dir_sha: result.dirSha })
        } else if (result.status === 'error') {
          logger.error({ slug, path: absDir, reason: result.error }, 'recipe index failed post-unlink')
          // No event on error path — error_message row persists in DB for
          // polling-based UIs, but the event stream stays clean (no
          // transition into the "valid indexed" state).
        }
      } else {
        const result = await indexRecipe(absDir)
        logger.debug({ slug, status: result.status }, 'recipe watcher: reindex')
        if (result.status === 'indexed') {
          // SCHED-06: cross-workspace global event (no workspace_id).
          eventBus.broadcast('recipe.indexed', { slug, dir_sha: result.dirSha })
        }
        // 'unchanged' and 'error' do not transition into/out of the valid
        // indexed state, so no event.
      }
    } catch (err) {
      logger.error({ slug, path: absDir, err: (err as Error).message }, 'recipe watcher: reindex threw')
    }
  }, DEBOUNCE_MS)
  _debounceTimers.set(key, timer)
}

export interface StartWatcherOptions {
  recipesRoot?: string
  /** Skip the eager boot scan; tests use this to assert boot-scan behaviour separately. */
  skipBootScan?: boolean
}

/**
 * Start the chokidar watcher on the recipes root.
 *
 * Flow:
 *   1. Run scanRecipesDir() to reconcile DB with disk BEFORE returning (eager
 *      boot per CONTEXT.md — traffic should not open until the DB matches disk).
 *   2. chokidar.watch(root, { ignoreInitial: true }) — step 1 already handled
 *      the initial state.
 *   3. Filter events to only the known recipe filenames + tools/** / skills/**
 *      subtrees. Ignore .swp, ~, .tmp, .DS_Store.
 *   4. On any relevant event, debounce per-slug for DEBOUNCE_MS then call
 *      indexRecipe (add/change) or re-check via indexRecipe (unlink — handler
 *      decides whether to removeRecipe based on skipped_missing).
 *
 * Idempotent: calling twice is a no-op (second call returns early).
 */
export async function startRecipeWatcher(opts: StartWatcherOptions = {}): Promise<void> {
  if (_watcher) return

  const root = opts.recipesRoot ?? getRecipesRoot()

  if (!opts.skipBootScan) {
    logger.info({ root }, 'recipe watcher: eager boot scan starting')
    const report = await scanRecipesDir({ recipesRoot: root })
    logger.info({ ...report }, 'recipe watcher: eager boot scan complete')
  }

  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    // Filter function receives the absolute path; return true to skip. Handles
    // editor/OS noise (CONTEXT.md's explicit list).
    ignored: (p: string) => {
      const name = basename(p)
      if (name === '.DS_Store') return true
      if (name.startsWith('.') && name.endsWith('.swp')) return true
      if (name.endsWith('~')) return true
      if (name.endsWith('.tmp')) return true
      return false
    },
    // awaitWriteFinish protects against reading mid-save. 200ms stability is
    // a reasonable ceiling for recipe.yaml edits; pollInterval 50ms keeps
    // the write-finish detection responsive.
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
    persistent: true,
  })

  const handle = (eventPath: string, kind: 'change' | 'unlink') => {
    const slug = extractSlug(eventPath, root)
    if (!slug) return
    // Determine which part of the recipe directory the event touched. We only
    // react to files that contribute to dir_sha (recipe.yaml, SOUL.md,
    // README.md, tools/**, skills/**). Anything else is skipped.
    const recipeDir = resolve(join(root, slug))
    const relInsideRecipe = resolve(eventPath).slice(recipeDir.length + 1)
    const firstSegment = relInsideRecipe.split(/[\\/]/)[0]
    const isWatchedRoot = WATCHED_ROOT_FILES.some((f) => f === firstSegment)
    const isWatchedSub = firstSegment === 'tools' || firstSegment === 'skills'
    if (!isWatchedRoot && !isWatchedSub) return
    scheduleReindex(slug, join(root, slug), kind)
  }

  watcher.on('add', (p) => handle(p, 'change'))
  watcher.on('change', (p) => handle(p, 'change'))
  watcher.on('unlink', (p) => handle(p, 'unlink'))
  watcher.on('addDir', (p) => {
    // A new directory directly under recipesRoot = a potential new recipe.
    // Don't react yet — wait for the recipe.yaml add event (which triggers
    // handle() with kind='change' and will run indexRecipe).
    void p
  })
  watcher.on('unlinkDir', (p) => {
    // The whole recipe directory was removed → drop the DB row immediately.
    // Only fire when the removed path IS the recipe dir (not a nested subdir).
    const slug = extractSlug(p, root)
    if (slug && resolve(p) === resolve(join(root, slug))) {
      const { removed } = removeRecipe(slug)
      logger.info({ slug, removed }, 'recipe watcher: directory removed')
      if (removed) {
        // SCHED-06: cross-workspace global event (no workspace_id).
        eventBus.broadcast('recipe.removed', { slug })
      }
    }
  })
  watcher.on('error', (err) => {
    logger.error({ err: (err as Error).message }, 'recipe watcher: chokidar error')
  })

  // Wait for chokidar to finish scanning + registering its platform watchers
  // before returning. Without this, tests (and production) can race: a write
  // that happens in the first ~50ms after `watch()` returns may not fire any
  // event on fsevents-backed platforms (macOS).
  await new Promise<void>((resolveReady) => {
    watcher.once('ready', () => resolveReady())
  })

  _watcher = watcher
  logger.info({ root }, 'recipe watcher: started')
}

/**
 * Stop the watcher. Flushes any pending debounced timers so callers can safely
 * restart without double-firing reindex events.
 */
export async function stopRecipeWatcher(): Promise<void> {
  for (const t of _debounceTimers.values()) clearTimeout(t)
  _debounceTimers.clear()
  if (_watcher) {
    await _watcher.close()
    _watcher = null
  }
}
