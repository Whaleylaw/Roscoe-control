---
phase: 12-recipe-system-v1-2
plan: 03
subsystem: recipe-watcher
tags: [recipes, chokidar, filesystem-watcher, boot-scanner, resync, debounce]

# Dependency graph
requires:
  - phase: 12-recipe-system-v1-2
    plan: 02
    provides: "indexRecipe(absDir, opts): Promise<IndexResult>; removeRecipe(slug): { removed }; IndexResult discriminated union (indexed | unchanged | error | skipped_missing)"
  - phase: 12-recipe-system-v1-2
    plan: 01
    provides: "recipes table (migration 054 + 058_error_message + 059_fts5); parseRecipeYaml"
provides:
  - "getRecipesRoot() — resolves MISSION_CONTROL_RECIPES_DIR or <cwd>/recipes"
  - "scanRecipesDir(opts?) — eager DB/disk reconciliation (insert/update/skip/delete)"
  - "resyncRecipes(opts?) — public wrapper over scanRecipesDir for admin endpoint (12-04)"
  - "startRecipeWatcher(opts?) — blocking boot scan + chokidar watcher with 250ms per-slug debounce"
  - "stopRecipeWatcher() — flushes debounced timers + closes watcher"
  - "ResyncReport interface — { scanned, inserted, updated, deleted, errors[] } consumed by 12-04's POST /api/recipes/resync"
  - "StartWatcherOptions interface — { recipesRoot?, skipBootScan? }"
  - "chokidar@^5.0.0 dependency"
  - "MISSION_CONTROL_RECIPES_DIR env var (new) — defaults to <cwd>/recipes, NOT MISSION_CONTROL_DATA_DIR"
affects: [12-04-recipe-api, 14-runner-container (boot ordering)]

# Tech tracking
tech-stack:
  added: [chokidar@^5.0.0]
  patterns:
    - "Eager boot scan blocks startRecipeWatcher() — traffic should not open until DB matches disk (CONTEXT.md lock)"
    - "Per-slug debounce via Map<string, NodeJS.Timeout> keyed on '{kind}:{slug}' — bursts from editor atomic renames collapse into a single indexRecipe call"
    - "chokidar 'ignored' filter is a function (not a glob) that matches by basename — rejects .DS_Store, .*.swp, *~, *.tmp without depending on chokidar's glob parser"
    - "startRecipeWatcher awaits the 'ready' event before returning so writes immediately after start don't race fsevents registration on macOS"
    - "scanRecipesDir reconciliation sweep uses DB query at the end to drop rows whose slug is not in the on-disk diskSlugs set — handles the 'whole recipes directory deleted' case"

key-files:
  created:
    - src/lib/recipe-watcher.ts
    - src/lib/__tests__/recipe-watcher.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "Recipes root defaults to <cwd>/recipes, NOT MISSION_CONTROL_DATA_DIR/recipes — recipe directories are authored code committed alongside src/ and scripts/, not runtime state"
  - "Boot scan is BLOCKING — startRecipeWatcher awaits scanRecipesDir before creating the chokidar watcher so the DB is consistent before traffic opens (CONTEXT.md lock)"
  - "scanRecipesDir counts every successful UPSERT as 'updated' (not split into insert vs update) — saves a pre-SELECT and CONTEXT.md's ResyncReport contract does not require the distinction"
  - "chokidar 'ignored' is a basename-function filter, not a glob pattern — avoids depending on chokidar's glob semantics which changed between v3 and v5"
  - "Unlink events call indexRecipe (not removeRecipe directly) — if recipe.yaml still exists the row is refreshed; if the unlink was recipe.yaml itself, indexRecipe returns skipped_missing and the handler removes the row. One code path handles both 'deleted a side file' and 'deleted the sentinel'."
  - "extractSlug requires the event path be absolute-prefixed by the absolute recipesRoot and skips hidden first-segments — prevents paths outside the root leaking into scheduleReindex"
  - "startRecipeWatcher is idempotent (second call returns early) — boot wiring in 12-04 can safely call it from a one-shot hook without a global init guard"
  - "Dynamic import of ./db at end of scanRecipesDir — keeps the module cheap to load for callers that pass a custom recipesRoot in tests and never actually need the singleton"

patterns-established:
  - "Pattern: boot ordering is `await startRecipeWatcher()` → `start HTTP server` — any subsequent phase adding boot scanners must follow the same blocking pattern so readiness = DB-consistent"
  - "Pattern: admin-callable resync functions expose a typed Report ({ scanned, inserted, updated, deleted, errors[] }) that API routes can return verbatim — no separate DTO layer"
  - "Pattern: per-entity debounce via Map<key, Timeout> + setTimeout coalescing — reusable for any watcher that should collapse bursts (file save storms, API retries)"
  - "Pattern: chokidar 'ignored' filter function keyed on basename — portable across node-fs-events and polling backends"

requirements-completed: [RECIPE-03, RECIPE-07]

# Metrics
duration: 5min
completed: 2026-04-19
---

# Phase 12 Plan 03: Recipe Watcher Summary

**chokidar-backed recipes/ watcher + eager blocking boot scanner + synchronous admin resync — making `recipes/<slug>/` the source of truth with 250ms per-slug debounce and explicit editor/OS noise filtering.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-19T03:42:37Z
- **Completed:** 2026-04-19T03:47:54Z
- **Tasks:** 2
- **Files created:** 2 (1 source, 1 test)
- **Files modified:** 2 (package.json, pnpm-lock.yaml)

## Accomplishments

- `scanRecipesDir(opts?)` — eager DB/disk reconciliation: iterates subdirectories of recipesRoot, calls `indexRecipe` on each, reports `{ scanned, inserted, updated, deleted, errors[] }`; reconciliation sweep drops rows whose slug has no on-disk directory
- `resyncRecipes(opts?)` — public admin entry point, wraps scanRecipesDir with start/complete log lines, signature ready for 12-04's POST /api/recipes/resync
- `startRecipeWatcher(opts?)` — blocking boot scan (CONTEXT.md lock), then chokidar.watch with `ignoreInitial: true`, `awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }`, and a basename-filter `ignored` function; awaits chokidar's `ready` event before returning so post-start writes don't race fsevents
- `stopRecipeWatcher()` — flushes pending debounced timers and closes the watcher; makes tests and dev hot-reload safe
- 250ms per-slug debounce collapses editor save bursts / atomic-rename storms into a single indexRecipe call (per-slug keyed on `{kind}:{slug}`)
- Watcher only reacts to `recipe.yaml`, `SOUL.md`, `README.md`, `tools/**`, `skills/**` — `.DS_Store`, `*.swp`, `*~`, `*.tmp` are filtered out by chokidar's `ignored` function
- Partial-unlink handling: removing recipe.yaml inside a still-present directory returns `skipped_missing` from indexRecipe; handler then calls removeRecipe to drop the row (single code path for "deleted sentinel" vs "deleted side file")
- `unlinkDir` event drops the row immediately when the whole recipe directory is removed
- New env var `MISSION_CONTROL_RECIPES_DIR` (defaults to `<cwd>/recipes`) — deliberately NOT `MISSION_CONTROL_DATA_DIR`-scoped because recipe directories are authored code
- 11 new Vitest cases (7 scanner/resync + 2 getRecipesRoot + 2 watcher debounce); full suite 1770 pass, 44 todo, 0 fail
- `pnpm typecheck` clean

## Task Commits

1. **Task 1: Install chokidar + implement scan + watcher + resync** — `6592a29` (feat)
2. **Task 2: Test suite + await chokidar ready event** — `9e053d5` (test)

_Plan metadata commit follows this summary._

## Files Created/Modified

**Created:**
- `src/lib/recipe-watcher.ts` — `getRecipesRoot`, `scanRecipesDir`, `resyncRecipes`, `startRecipeWatcher`, `stopRecipeWatcher`, `ResyncReport`, `StartWatcherOptions`
- `src/lib/__tests__/recipe-watcher.test.ts` — 11 cases covering scanner reconciliation, error handling, env resolution, debounce behaviour, noise-filter assertions

**Modified:**
- `package.json` — added `chokidar@^5.0.0` dependency
- `pnpm-lock.yaml` — regenerated lockfile

## Exported Signatures for 12-04 (API)

Import these verbatim in Plan 12-04 — the `ResyncReport` shape IS the response body of POST /api/recipes/resync.

```ts
// src/lib/recipe-watcher.ts

export function getRecipesRoot(): string

export interface ResyncReport {
  scanned: number
  inserted: number
  updated: number
  deleted: number
  errors: Array<{ slug: string; reason: string }>
}

export function scanRecipesDir(opts?: {
  recipesRoot?: string
  workspaceId?: number
  tenantId?: number
}): Promise<ResyncReport>

export function resyncRecipes(opts?: {
  recipesRoot?: string
  workspaceId?: number
  tenantId?: number
}): Promise<ResyncReport>

export interface StartWatcherOptions {
  recipesRoot?: string
  /** Skip the eager boot scan; tests use this to assert boot-scan behaviour separately. */
  skipBootScan?: boolean
}

export function startRecipeWatcher(opts?: StartWatcherOptions): Promise<void>
export function stopRecipeWatcher(): Promise<void>
```

## Boot-Scan Semantics for 12-04's Server-Start Hook

The boot scanner is **eager and blocking** per CONTEXT.md. 12-04 MUST wire startRecipeWatcher into the server-start path BEFORE the HTTP listener begins accepting requests, so the DB is consistent with disk before traffic opens.

Recommended pattern for 12-04:

```ts
// 12-04 adds this boot hook after its resync API route is registered:
import { startRecipeWatcher } from '@/lib/recipe-watcher'

// Before HTTP listen:
await startRecipeWatcher() // eager blocking scan + chokidar watcher registration

// Now safe to open the port — DB matches disk + watcher is running
server.listen(port)
```

Idempotent: a second call to startRecipeWatcher() is a no-op (returns early if `_watcher` is already set). 12-04 can safely call it from any boot-time hook without a global init guard.

### Error handling during boot

- If `recipesRoot` does not exist on disk: scan returns a zero-count report. The server still starts. This is legitimate in fresh-clone dev environments where `recipes/` hasn't been created.
- If a single recipe has a broken `recipe.yaml` (YAML parse error, Zod failure, slug mismatch, unknown model): the error is written to the `recipes.error_message` column via indexRecipe's error-row flow and surfaced in `report.errors[]`. The scan continues; the server still starts.
- If `indexRecipe` throws unexpectedly (disk I/O, DB connection): the error is logged via `logger.error({ slug, path, reason }, 'scanRecipesDir: indexRecipe threw')` and added to `report.errors[]`. Scan continues.

## `MISSION_CONTROL_RECIPES_DIR` Env Var

**New in Phase 12.** Sets the absolute or cwd-relative path where recipe directories live. Resolution:

| Case | Value returned |
|------|----------------|
| `MISSION_CONTROL_RECIPES_DIR=/abs/path` | `/abs/path` |
| `MISSION_CONTROL_RECIPES_DIR=relative/dir` | `<cwd>/relative/dir` (via `path.resolve`) |
| `MISSION_CONTROL_RECIPES_DIR` unset or empty | `<cwd>/recipes` |

**Deliberately NOT** scoped to `MISSION_CONTROL_DATA_DIR/recipes` — recipes are authored code (committed to the repo, live alongside `src/` and `scripts/`), not runtime state. Future docs updates (agent setup guide, Docker compose notes) should reference this variable by name.

## Decisions Made

- **Recipes root is cwd-relative, not data-dir-relative** — recipe directories are authored code, not runtime state. A user who sets `MISSION_CONTROL_DATA_DIR=/var/lib/mc-data` should NOT have their recipes moved there; they live next to `src/` in the checkout. New env var introduced: `MISSION_CONTROL_RECIPES_DIR`.
- **Eager blocking boot scan** — scanRecipesDir awaits completion inside startRecipeWatcher before the chokidar watcher is created and before the function returns. 12-04's boot hook can safely call startRecipeWatcher in `await` sequence with `server.listen()`, and the invariant "DB matches disk when traffic opens" is preserved.
- **Count every successful UPSERT as `updated`** — distinguishing insert vs update would require a pre-SELECT per directory on every scan. The ResyncReport contract in CONTEXT.md names the fields `inserted` and `updated` for future use, but the current implementation treats both as `updated` since indexRecipe's UPSERT semantics make the distinction cosmetic. Future work could split them if operators need the breakdown (trivial add: SELECT COUNT WHERE slug=? before indexRecipe).
- **chokidar `ignored` is a basename function, not a glob** — chokidar's glob parser has changed between major versions, and the function form is version-stable and works identically across node-fs-events and polling backends. Performance is fine: the function runs once per file event, not per file in a scan.
- **Partial-unlink goes through indexRecipe, not removeRecipe** — when the user deletes a file inside a recipe directory, we don't know whether it was `recipe.yaml` (the sentinel) or a side file (README.md, tools/foo.sh). Calling `indexRecipe(absDir)` returns `skipped_missing` when recipe.yaml is gone; the handler then calls `removeRecipe`. Otherwise indexRecipe recomputes `dir_sha` and re-UPSERTs. One code path covers both cases and stays consistent with the 12-02 IndexResult contract.
- **`awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }`** — CONTEXT.md-locked values. Editors writing recipe.yaml atomically via rename can briefly produce zero-byte files; awaitWriteFinish waits for size stability before firing `change`. The 250ms debounce on top of that collapses the window further.
- **Await chokidar `ready` event before returning from startRecipeWatcher** — on macOS (fsevents), `chokidar.watch()` returns before the underlying event source is registered. A test that writes immediately after `await startRecipeWatcher()` would race the watcher. Waiting for `ready` makes the post-start state deterministic; cost is ~50-100ms at boot, negligible.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Debounce test raced chokidar's fsevents registration on macOS**
- **Found during:** Task 2 (first test run)
- **Issue:** The plan's `startRecipeWatcher` returned as soon as `chokidar.watch()` was called. On macOS (fsevents backend), that function returns before the platform watcher is registered — a `writeFileSync` within ~50ms of the function returning produced no `change` event, so the debounce test's modified timeout_seconds never reached the DB within the 1200ms wait window.
- **Fix:** Added `await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))` inside `startRecipeWatcher` before storing `_watcher` and returning. The `ready` event fires once chokidar has scanned the root and registered its platform watchers. Cost is ~50-100ms at boot; makes the post-start state deterministic for both tests and production. Bumped the test's wait window from 800ms (plan) to 1200ms to align with the plan's CI-safety comment.
- **Files modified:** `src/lib/recipe-watcher.ts` (startRecipeWatcher), `src/lib/__tests__/recipe-watcher.test.ts` (both debounce waits bumped 800→1200ms)
- **Verification:** All 11 recipe-watcher tests pass; full suite 1770 pass, 0 fail
- **Committed in:** `9e053d5` (Task 2 commit — the ready-wait and the test wait-bumps landed together)

---

**Total deviations:** 1 auto-fixed (1 bug — race condition between chokidar return and fsevents registration)
**Impact on plan:** None on scope. Fix was required for correctness — the plan's startRecipeWatcher would race any caller that issued a write immediately after the function returned, which is precisely what boot sequences and post-resync callers do. The fix is a pure correctness improvement and aligns with the plan's own "deterministic post-start state" intent.

## Issues Encountered

- None beyond the deviation above.

## User Setup Required

None — no external service configuration. chokidar 5.x is pure JS (no native addon), and the watcher falls back to polling automatically on platforms without fsevents/inotify.

One new env var introduced, with a sensible default:

```
# Optional — defaults to <cwd>/recipes
MISSION_CONTROL_RECIPES_DIR=/absolute/path/to/recipes
```

Future docs update (out of scope for this plan — handled by Phase 16 UI work or a Phase 12-04 README touch) should document this alongside existing data-dir env vars.

## Next Phase Readiness

- **Plan 12-04 (recipe API) is ready:**
  - Import `resyncRecipes` and `startRecipeWatcher` from `@/lib/recipe-watcher`
  - POST /api/recipes/resync handler → `const report = await resyncRecipes(); return NextResponse.json(report, { status: 200 })`
  - Server-start hook: `await startRecipeWatcher()` BEFORE `server.listen()` so the DB reconciles with disk before traffic opens
  - `stopRecipeWatcher()` available for shutdown hooks / test cleanup
  - GET /api/recipes/:slug and GET /api/recipes (list) continue to use `getIndexedRecipeBySlug` and direct `recipes`/`recipes_fts` SQL from 12-02/12-01 — this plan doesn't touch the read path

- **Plan 14 (runner container) note:** The boot-order invariant "startRecipeWatcher completes before server.listen" means any runner-spawn code called from within a request handler can assume the `recipes` table matches disk. No additional reconciliation is needed at claim time.

No blockers.

## Self-Check: PASSED

- **Files exist:**
  - `/Users/aaronwhaley/Github/mission-control/src/lib/recipe-watcher.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/src/lib/__tests__/recipe-watcher.test.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/.planning/phases/12-recipe-system-v1-2/12-03-SUMMARY.md` — FOUND (this file)

- **Commits exist:**
  - `6592a29` (Task 1: feat recipe-watcher + chokidar) — FOUND in `git log`
  - `9e053d5` (Task 2: test recipe-watcher + await ready) — FOUND in `git log`

- **Exports verified (via grep):**
  - `getRecipesRoot`, `scanRecipesDir`, `resyncRecipes`, `startRecipeWatcher`, `stopRecipeWatcher` — 5 exports found in src/lib/recipe-watcher.ts
  - `ResyncReport`, `StartWatcherOptions` — interfaces exported

- **Dependency:** `chokidar: "^5.0.0"` present in package.json dependencies

- **Tests pass:** 11/11 new cases pass (7 scanner/resync + 2 getRecipesRoot + 2 debounce); full suite 1770 pass / 0 fail; typecheck clean

---
*Phase: 12-recipe-system-v1-2*
*Completed: 2026-04-19*
