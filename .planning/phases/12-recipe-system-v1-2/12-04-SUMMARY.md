---
phase: 12-recipe-system-v1-2
plan: 04
subsystem: recipe-api
tags: [recipes, rest-api, fts5, bm25, boot-wiring, atomic-write, admin-resync]

# Dependency graph
requires:
  - phase: 12-recipe-system-v1-2
    plan: 03
    provides: "resyncRecipes, startRecipeWatcher, getRecipesRoot, ResyncReport"
  - phase: 12-recipe-system-v1-2
    plan: 02
    provides: "indexRecipe, getIndexedRecipeBySlug, IndexResult"
  - phase: 12-recipe-system-v1-2
    plan: 01
    provides: "recipes table, recipes_fts FTS5 + triggers, parseRecipeYaml"
provides:
  - "GET /api/recipes — list indexed recipes (viewer+); ?include_broken=1 (admin)"
  - "GET /api/recipes/:slug — full recipe OR { slug, error_message } OR 404"
  - "GET /api/recipes/search?q=&limit= — FTS5 BM25 search with tags weighted 2x (RECIPE-08)"
  - "POST /api/recipes — admin-only disk-first atomic-write + indexRecipe + rollback-on-failure"
  - "POST /api/recipes/resync — admin-only synchronous wrapper over resyncRecipes()"
  - "mapRow(row) — shared DB-row → DTO projection; exported from route.ts"
  - "buildFtsQuery(raw) — exported helper from search/route.ts for FTS5 query sanitisation"
  - "Boot wiring: db.ts initializeSchema dynamically imports startRecipeWatcher in the same !isBuildPhase && !isTestMode branch as the scheduler"
affects: [13-task-runtime-context, 16-ui-surfaces, 17-integration-testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Disk-first, index-second, rollback-on-failure for POST create — tmpdir write + fs.rename (EXDEV cp fallback) keeps the sequence atomic from the watcher's perspective"
    - "mapRow is the sole DB-row → DTO projection — list, search, and fetch-by-slug all route through it so shape changes land in one place"
    - "FTS5 BM25 column weights applied at query time via bm25(recipes_fts, 1.0, 1.0, 1.0, 2.0); name/description/when_to_use weight 1.0, tags weight 2.0 (RECIPE-08)"
    - "Pre-flight validation via parseRecipeYaml runs BEFORE any disk write so 400 failures leave recipes/ untouched"
    - "Boot wiring mirrors the scheduler pattern — dynamic import + .then + .catch inside the webhookListenerInitialized guard, further gated by !isBuildPhase && !isTestMode"
    - "FTS5 query sanitisation strips \" ' * ( ) : ^ - to spaces, drops <2-char tokens, prefix-wildcards each token, joins with OR — prevents malformed queries from reaching the SQLite parser"

key-files:
  created:
    - src/app/api/recipes/route.ts
    - src/app/api/recipes/[slug]/route.ts
    - src/app/api/recipes/search/route.ts
    - src/app/api/recipes/resync/route.ts
    - src/app/api/recipes/__tests__/route.test.ts
    - src/app/api/recipes/__tests__/search.test.ts
    - src/app/api/recipes/__tests__/post.test.ts
    - src/app/api/recipes/__tests__/resync.test.ts
  modified:
    - src/lib/db.ts

key-decisions:
  - "mutationLimiter is called directly — mutationLimiter(request) — not mutationLimiter.check(request, key); the plan's sketch used the non-existent .check API, but every other API route in the codebase (alerts, webhooks, integrations) uses the direct invocation form. Fixed to match project convention."
  - "getRecipesRoot cannot be mocked via vi.mock for resync tests because scanRecipesDir → getRecipesRoot is a closure-bound internal reference within recipe-watcher.ts; the mock replaces the module's export binding but not the internal closure. Solved by setting MISSION_CONTROL_RECIPES_DIR directly in beforeEach/afterEach so the real getRecipesRoot returns the scratch dir."
  - "POST rollback deletes BOTH the target directory AND the error row indexRecipe wrote — otherwise a repeat POST would see a stale error row in the DB conflict-check and return 409 with a confusing message"
  - "include_broken=1 is admin-gated — error rows may contain sensitive path/stack info; viewer tier sees only fully-indexed recipes"
  - "Search empty-q behaviour falls through to the list endpoint's semantics (return all indexed rows) rather than returning []; keeps /api/recipes/search usable as a primary listing endpoint when the UI has a search box with no user input yet"
  - "EXDEV fallback in POST — CI tmpfs environments and Docker containers often put /tmp on a different filesystem from the project root, so fs.rename throws EXDEV; falling back to fs.cp + fs.rm keeps the handler working without requiring operators to align tmpdir + recipesRoot"
  - "Watcher boot-wire placed INSIDE the same if (!isBuildPhase && !isTestMode) branch as the scheduler, not in a parallel branch, so both subsystems share the same runtime-only guard and turn off together under `next build` / vitest"
  - "Route module imports `getRecipesRoot` from @/lib/recipe-watcher, so the POST test's vi.mock on that module DOES intercept the POST handler's lookup — unlike the resync test which depends on the real closure-internal reference and needs the env var trick"

patterns-established:
  - "Pattern: admin-only mutation endpoints use `requireRole(request, 'admin')` + `mutationLimiter(request)` back-to-back; any subsequent phase adding admin mutations MUST use both in this order"
  - "Pattern: viewer-tier read endpoints use `requireRole(request, 'viewer')` alone; admin-gated query params (?include_broken=1) check auth.user.role === 'admin' separately and return 403 on mismatch"
  - "Pattern: POST create endpoints that materialise filesystem state do tmpdir write → fs.rename (with EXDEV cp fallback) → indexer call → rollback on failure; re-usable for any future authored-content endpoints (agents, skills, tools)"
  - "Pattern: dynamic import + startup hook inside initializeSchema's webhook-listener guard — any future runtime-only subsystem (provisioners, reconcilers, watchers) should follow the scheduler/recipe-watcher pair so startup remains deterministic under build and test"

requirements-completed: [RECIPE-05, RECIPE-06, RECIPE-07, RECIPE-08]

# Metrics
duration: 13min
completed: 2026-04-19
---

# Phase 12 Plan 04: Recipe API + Boot Wiring Summary

**Four REST endpoints + boot-time watcher wiring — GET list/slug/search + POST create (disk-first + rollback) + POST resync, with FTS5 BM25 ranking where tags weigh 2x, admin-only mutations, and the recipe watcher starting inside initializeSchema before the first request lands.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-04-19T03:55:19Z
- **Completed:** 2026-04-19T04:08:45Z
- **Tasks:** 3
- **Files created:** 8 (4 route files + 4 test suites)
- **Files modified:** 1 (`src/lib/db.ts` — boot hook)

## Accomplishments

- **GET /api/recipes** — lists fully-indexed recipes ordered by slug (error rows excluded by default). `?include_broken=1` surfaces error rows as `{ slug, error_message, created_at, updated_at }` (admin only).
- **GET /api/recipes/:slug** — routes through `getIndexedRecipeBySlug` from Plan 12-02 which already discriminates broken vs full rows; handler re-serialises through `mapRow` so list and fetch shapes stay identical.
- **GET /api/recipes/search** — FTS5 `bm25(recipes_fts, 1.0, 1.0, 1.0, 2.0)` with tags weighted 2x; empty-q falls through to full listing; short tokens (<2 chars) dropped; special chars stripped; broken recipes excluded.
- **POST /api/recipes** — admin-only create with rate limit + Zod body validation + pre-flight YAML parse + slug-mismatch check + tmpdir write + atomic `fs.rename` (EXDEV `cp` fallback) + `indexRecipe({ force: true })` + rollback-on-index-failure (removes directory AND error row).
- **POST /api/recipes/resync** — admin-only synchronous wrapper returning `ResyncReport` verbatim `{ scanned, inserted, updated, deleted, errors[] }`.
- **Boot wire** — `src/lib/db.ts initializeSchema` dynamically imports `./recipe-watcher` and calls `startRecipeWatcher()` inside the existing `!isBuildPhase && !isTestMode` branch (next to the scheduler); the eager blocking boot scan reconciles DB with disk before the first HTTP request arrives.
- **24 new Vitest cases** (6 route + 9 search + 6 post + 3 resync); full suite 1794 pass / 0 fail; `pnpm typecheck` clean; `pnpm lint` clean on new files (all 76 lint warnings are pre-existing in unrelated files); `pnpm build` succeeds with all four recipe routes registered.

## Task Commits

1. **Task 1: recipe read API (list/slug/search + FTS5 BM25 tag weighting)** — `aac4613` (feat)
2. **Task 2: POST /api/recipes disk-first + atomic rename + rollback** — `510de96` (feat)
3. **Task 3: POST /api/recipes/resync + boot-wire recipe watcher** — `5d456e1` (feat)

_Plan metadata commit follows this summary._

## Files Created/Modified

**Created:**
- `src/app/api/recipes/route.ts` — `GET` (list) + `POST` (create) + shared `mapRow`
- `src/app/api/recipes/[slug]/route.ts` — `GET` by slug
- `src/app/api/recipes/search/route.ts` — `GET` search + exported `buildFtsQuery`
- `src/app/api/recipes/resync/route.ts` — `POST` resync
- `src/app/api/recipes/__tests__/route.test.ts` — 6 cases covering list (empty/mixed/admin-only broken) and fetch-by-slug (404/full/error-row)
- `src/app/api/recipes/__tests__/search.test.ts` — 9 cases covering the FTS5 query builder and ranked search (empty q, name prefix, tag-weight ranking proof, broken exclusion, limit cap, short-token drop)
- `src/app/api/recipes/__tests__/post.test.ts` — 6 cases covering happy path + 409 (dup) + 400 (missing slug / invalid yaml / slug mismatch / unknown model MODEL-02)
- `src/app/api/recipes/__tests__/resync.test.ts` — 3 cases (empty, scan-with-error, orphan-delete)

**Modified:**
- `src/lib/db.ts` — inserted recipe-watcher dynamic-import block inside the scheduler's `!isBuildPhase && !isTestMode` branch; no other changes to db.ts

## Endpoint Reference (for future OpenAPI regeneration)

### GET /api/recipes

- **Role:** viewer+ (default); admin for `?include_broken=1`
- **Query:** `include_broken=1` — include error rows as `{ slug, error_message, created_at, updated_at }`
- **Response (default):** `{ recipes: FullRecipeDto[] }`
- **Response (include_broken=1):** `{ recipes: Array<FullRecipeDto | ErrorRecipeDto> }`
- **Status codes:** 200, 401, 403, 500

### GET /api/recipes/:slug

- **Role:** viewer+
- **Response (indexed):** `{ recipe: FullRecipeDto }` where FullRecipeDto includes `id, slug, name, description, when_to_use, image, workspace_mode, timeout_seconds, max_concurrent, env, secrets, tags, model, version, dir_sha, soul_md, workspace_id, tenant_id, created_at, updated_at`
- **Response (broken):** `{ recipe: { slug, error_message, created_at, updated_at } }`
- **Response (missing):** `{ error: "Recipe '<slug>' not found" }`
- **Status codes:** 200, 401, 403, 404, 500

### GET /api/recipes/search?q=&limit=

- **Role:** viewer+
- **Query:** `q` (freeform, sanitised), `limit` (default 50, max 200)
- **Response:** `{ recipes: FullRecipeDto[] }` ordered by BM25 ASC (best match first). Empty q falls through to the list endpoint semantics (first N indexed, ORDER BY slug).
- **FTS5 ranking:** `bm25(recipes_fts, 1.0, 1.0, 1.0, 2.0)` — columns are name, description, when_to_use, tags; tags weight = 2.0 (RECIPE-08).
- **Status codes:** 200, 401, 403, 500

### POST /api/recipes

- **Role:** admin only (tighter than plan's initial "operator" suggestion per CONTEXT.md lock)
- **Rate limit:** `mutationLimiter` (60/minute/IP)
- **Body:** `{ slug: kebab-case 1-64 chars, recipe_yaml: string, soul_md?: string }`
- **Response (success):** 201 `{ recipe: FullRecipeDto }`
- **Status codes:** 201 (success), 400 (bad body / bad yaml / slug mismatch / unknown model MODEL-02), 401, 403, 409 (disk dir exists OR non-error row exists), 429, 500 (index failure)
- **Atomicity:** disk write goes to `os.tmpdir()` first, then `fs.rename` into `recipes/<slug>/` (EXDEV `cp` fallback for cross-filesystem tmpdir setups). If `indexRecipe` returns `'error'`, the directory is removed AND the error row deleted before returning 500.

### POST /api/recipes/resync

- **Role:** admin only
- **Rate limit:** `mutationLimiter`
- **Request body:** none
- **Response:** `{ scanned, inserted, updated, deleted, errors: Array<{ slug, reason }> }` — the `ResyncReport` shape from Plan 12-03 verbatim
- **Status codes:** 200, 401, 403, 429, 500
- **Synchronous:** awaits `resyncRecipes()` completion before responding; not for hot paths.

## Admin-Only Gate Summary

| Endpoint                      | Role   | Notes                                                        |
| ----------------------------- | ------ | ------------------------------------------------------------ |
| GET /api/recipes              | viewer | `?include_broken=1` requires admin (returns 403 otherwise)   |
| GET /api/recipes/:slug        | viewer | Broken recipes visible to viewer with error_message surfaced |
| GET /api/recipes/search       | viewer | Broken recipes always excluded from search results           |
| POST /api/recipes             | admin  | + mutationLimiter rate gate                                  |
| POST /api/recipes/resync      | admin  | + mutationLimiter rate gate                                  |

All mutation endpoints admin-only per CONTEXT.md's Phase 12 tightening decision (viewer/operator/admin; recipes are infrastructure code, not per-workspace content).

## `MISSION_CONTROL_RECIPES_DIR` Env Var

Repeat from 12-03-SUMMARY so operators can find it in one place:

| Case                                            | Value returned                     |
| ----------------------------------------------- | ---------------------------------- |
| `MISSION_CONTROL_RECIPES_DIR=/abs/path`         | `/abs/path`                        |
| `MISSION_CONTROL_RECIPES_DIR=relative/dir`      | `<cwd>/relative/dir` (via resolve) |
| `MISSION_CONTROL_RECIPES_DIR` unset or empty    | `<cwd>/recipes`                    |

**Deliberately NOT** scoped to `MISSION_CONTROL_DATA_DIR/recipes` — recipes are authored code, not runtime state. The POST /api/recipes endpoint writes to this directory; the watcher + boot scan reconciles this directory with the DB; and operators bind-mount or git-manage this directory.

## FTS5 BM25 Weight Vector (for Phase 17 integration tests)

```sql
SELECT r.*, bm25(recipes_fts, 1.0, 1.0, 1.0, 2.0) AS rank
FROM recipes_fts
JOIN recipes r ON r.id = recipes_fts.rowid
WHERE recipes_fts MATCH ?
  AND r.error_message IS NULL
ORDER BY rank ASC
LIMIT ?
```

Column order in the `recipes_fts` virtual table is **`name, description, when_to_use, tags`** (per migration 059). Weight vector `(1.0, 1.0, 1.0, 2.0)` therefore maps to (name=1, description=1, when_to_use=1, tags=2). Lower BM25 = better match, so `ORDER BY rank ASC` puts best first. Phase 17's search-ranking tests can assert against this vector.

## Phase 13 Entry Point (task-runtime-context)

Task-creation paths that reference a recipe via `recipe_slug` MUST:

```ts
import { getIndexedRecipeBySlug } from '@/lib/recipe-indexer'

const row = getIndexedRecipeBySlug(slug)
if (!row) {
  // Slug does not exist — reject task create
  throw new HttpError(400, `Recipe '${slug}' does not exist`)
}
if ('error_message' in row && row.error_message !== null) {
  // Recipe exists but failed to index — reject task create
  throw new HttpError(400, `Recipe '${slug}' is broken: ${row.error_message}`)
}
// row is RecipeRow — safe to dispatch
```

This discrimination rule is identical to the one used by GET /api/recipes/:slug in this plan and by the watcher's handler logic in Plan 12-03. Phase 13 should NOT invent a separate lookup path.

## Decisions Made

- **`mutationLimiter` is a function, not an object with `.check`** — the plan's sketch used `mutationLimiter.check(request, 'recipes:post')`, but `createRateLimiter` returns a direct function and every other mutation route (alerts, webhooks, integrations) calls it as `mutationLimiter(request)`. Fixed to match convention. Rule 3 deviation (blocking issue — the code as planned would have been a `TypeError`).
- **`getRecipesRoot` can't be mocked via `vi.mock` for resync tests** — `scanRecipesDir → getRecipesRoot` is a closure-bound internal reference. `vi.mock` rewires the module's export binding, not the closure. The resync test therefore sets `MISSION_CONTROL_RECIPES_DIR` directly in `beforeEach` and restores it in `afterEach`. The POST test still uses `vi.mock` because the route handler itself imports `getRecipesRoot` — that import IS intercepted by the mock.
- **Rollback deletes the error row too** — `indexRecipe('error')` writes a minimal row with `error_message` populated. If rollback only removed the disk directory, a repeat POST would hit 409 (non-error row check) wrongly reading the error row as "already indexed" (it's not — it's in the error state). Deleting the row on rollback keeps retries idempotent.
- **`include_broken=1` is admin-gated** — error rows may contain path fragments and parser-level detail that leak filesystem structure. Viewer tier sees only healthy recipes.
- **Empty-q search returns the list, not `[]`** — matches UI expectations where a search box with no input should show everything, not nothing.
- **EXDEV fallback to `cp` + `rm`** — Docker containers and CI runners frequently mount `/tmp` on tmpfs (a separate filesystem), which makes `fs.rename` throw `EXDEV`. The fallback keeps the atomicity guarantee (file tree appears atomically from the watcher's perspective) without requiring operators to align tmpdir and recipesRoot.
- **Boot hook INSIDE the scheduler's `!isBuildPhase && !isTestMode` branch** — the recipe watcher reads `recipes/` from disk and depends on migrations having run, so it shares exactly the same guard conditions as the scheduler. Inserting it into the same branch (rather than adding a parallel branch) keeps the startup behaviour congruent and means any future change to build/test gating lands in one place.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] `mutationLimiter.check(request, key)` API does not exist**
- **Found during:** Task 2 drafting (before test run)
- **Issue:** The plan's code sketches used `mutationLimiter.check(request, 'recipes:post')` and `mutationLimiter.check(request, 'recipes:resync')`, but `createRateLimiter` in `@/lib/rate-limit` returns a direct function — every other API route (alerts, webhooks, integrations) calls `mutationLimiter(request)`. The planned code would have been a `TypeError: mutationLimiter.check is not a function` at the first mutation.
- **Fix:** Changed all sites to `mutationLimiter(request)`. Updated the POST test mock `vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))` (was `{ check: () => null }` in the plan). Fix is a pure convention alignment; no test coverage changes.
- **Files modified:** `src/app/api/recipes/route.ts` (POST), `src/app/api/recipes/resync/route.ts`, `src/app/api/recipes/__tests__/post.test.ts`, `src/app/api/recipes/__tests__/resync.test.ts`
- **Committed in:** `510de96` (Task 2) + `5d456e1` (Task 3)

**2. [Rule 1 — Bug] `vi.mock('@/lib/recipe-watcher', ... getRecipesRoot ...)` did not intercept `resyncRecipes → scanRecipesDir → getRecipesRoot`**
- **Found during:** Task 3 (first test run — `scanned: 0` when the directory had 2 entries)
- **Issue:** `scanRecipesDir` calls `getRecipesRoot()` internally via a closure-bound reference within the same module. `vi.mock` rewires the module's export binding, but the closure inside `scanRecipesDir` still holds a reference to the original unmocked function. Net result: the resync endpoint used `<cwd>/recipes` (empty) instead of the test's scratch dir.
- **Fix:** Removed the `vi.mock('@/lib/recipe-watcher', ...)` override from the resync test. Instead, set `process.env.MISSION_CONTROL_RECIPES_DIR = recipesRoot` in `beforeEach` (and restore in `afterEach`) so the real `getRecipesRoot` resolves to the scratch dir. The POST test's mock still works because `route.ts` imports `getRecipesRoot` at the top — that's a module-level binding vi.mock CAN intercept.
- **Files modified:** `src/app/api/recipes/__tests__/resync.test.ts`
- **Verification:** 3 resync tests pass; the mocking pattern is documented via comment so future authors understand the distinction.
- **Committed in:** `5d456e1` (Task 3)

**3. [Rule 1 — Bug] Plan's broken-YAML seed for resync test wasn't actually a YAML parse error**
- **Found during:** Task 3 (second test run)
- **Issue:** The plan's `q/recipe.yaml = ':: broken yaml :['` is parseable by the `yaml` library (returns an object with no keys), so the indexer surfaced a Zod schema error ("slug: Invalid input: expected string, received undefined; ..."), not a YAML parse error. The test's `expect(...).toMatch(/YAML parse error/i)` failed. This is the same issue Plan 12-02 hit and documented in its deviation log.
- **Fix:** Switched to `'tags: [unterminated'` which IS a YAML syntax error (unterminated flow sequence). The test now asserts the intended path. Left a comment pointing to 12-02-SUMMARY deviation for future readers.
- **Files modified:** `src/app/api/recipes/__tests__/resync.test.ts`
- **Verification:** `body.errors[0].reason` now matches `/YAML parse error/i` as intended.
- **Committed in:** `5d456e1` (Task 3)

---

**Total deviations:** 3 auto-fixed (2 plan-code bugs, 1 test-sketch issue discovered by 12-02 already).
**Impact on plan:** None on scope. Fixes are all convention/correctness alignments that the plan's success criteria still demand. All 9 success criteria met. Production code is stronger than the plan sketch (correct rate-limiter API) and tests are more robust (correct mocking pattern + real YAML parse error).

## Issues Encountered

- None beyond the deviations above.

## User Setup Required

None — no external service configuration, no new env vars (MISSION_CONTROL_RECIPES_DIR was introduced in Plan 12-03), no new dependencies.

## Next Phase Readiness

- **Plan 13 (task-runtime-context) is ready:**
  - Import `getIndexedRecipeBySlug` from `@/lib/recipe-indexer` — discrimination rule documented above
  - Task-creation handlers that accept `recipe_slug` reject on `null` (doesn't exist) and on `error_message !== null` (broken); only dispatch if the returned row is a `RecipeRow`
  - Task-runtime-context code can read recipe fields (image, workspace_mode, timeout_seconds, model.primary, env, secrets, tags) directly from the returned row — no re-parsing needed

- **Plan 14 (runner container) — boot-order invariant:**
  - The boot wiring in `src/lib/db.ts initializeSchema` calls `startRecipeWatcher()` BEFORE the HTTP listener returns control. Any runner-spawn code inside a request handler can assume the `recipes` table matches disk. No additional reconciliation needed at claim time.

- **Plan 16 (UI) is ready:**
  - GET /api/recipes (list) for recipe picker
  - GET /api/recipes/:slug for recipe detail panel (use error_message presence to render broken-recipe card)
  - GET /api/recipes/search?q= for typeahead search (front-end can debounce to 150ms; backend limit defaults to 50)
  - POST /api/recipes/resync for admin "refresh recipes" button

- **Plan 17 (integration testing) — search-ranking fixture:**
  - Seed three recipes: one with "deploy" in name, one with "deploy" in description only, one with "deploy" in tags only
  - Hit GET /api/recipes/search?q=deploy
  - Assert: tag-matched recipe comes BEFORE description-matched (proves tags 2x weight)
  - The existing unit test in `src/app/api/recipes/__tests__/search.test.ts:"ranks tag-match above description-match"` is the minimal version; Phase 17's integration test should exercise the real FTS5 + real indexRecipe pipeline end-to-end.

No blockers.

## Self-Check: PASSED

- **Files exist:**
  - `/Users/aaronwhaley/Github/mission-control/src/app/api/recipes/route.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/src/app/api/recipes/[slug]/route.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/src/app/api/recipes/search/route.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/src/app/api/recipes/resync/route.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/src/app/api/recipes/__tests__/route.test.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/src/app/api/recipes/__tests__/search.test.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/src/app/api/recipes/__tests__/post.test.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/src/app/api/recipes/__tests__/resync.test.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/.planning/phases/12-recipe-system-v1-2/12-04-SUMMARY.md` — FOUND (this file)

- **Commits exist:**
  - `aac4613` (Task 1: recipe read API) — FOUND in `git log`
  - `510de96` (Task 2: POST create + rollback) — FOUND in `git log`
  - `5d456e1` (Task 3: resync + boot wiring) — FOUND in `git log`

- **Boot wiring verified:** `grep startRecipeWatcher src/lib/db.ts` returns 3 hits (1 in-comment reference + 2 in functional code: destructured import + call) inside `initializeSchema`'s `!isBuildPhase && !isTestMode` branch

- **FTS5 weight vector verified:** `grep 'bm25(recipes_fts, 1.0, 1.0, 1.0, 2.0)' src/app/api/recipes/search/route.ts` returns exactly 1 hit — RECIPE-08 tag-weighting is in place

- **Tests pass:** 24/24 new cases pass (6 route + 9 search + 6 post + 3 resync); full suite 1794 pass / 0 fail

- **Typecheck:** `pnpm typecheck` clean

- **Build:** `pnpm build` succeeds; all four recipe routes registered (`/api/recipes`, `/api/recipes/[slug]`, `/api/recipes/resync`, `/api/recipes/search`)

- **Lint:** 0 errors; 76 pre-existing warnings in unrelated files (not caused by this plan)

---
*Phase: 12-recipe-system-v1-2*
*Completed: 2026-04-19*
