---
phase: 12-recipe-system-v1-2
plan: 02
subsystem: recipe-indexer
tags: [recipes, indexer, dir-sha, sha256, fts5, model-registry]

# Dependency graph
requires:
  - phase: 12-recipe-system-v1-2
    plan: 01
    provides: "parseRecipeYaml, RecipeYaml/RecipeRow/RecipeErrorRow types, recipes table (+ error_message column + FTS5 triggers)"
provides:
  - "computeDirSha(absDir) — deterministic SHA-256 of recipe directory contents (recipe.yaml + SOUL.md + README.md + tools/** + skills/**)"
  - "indexRecipe(absDir, opts) — single write path for recipes rows; handles valid UPSERT + error-row flow + dedup"
  - "removeRecipe(slug) — DELETE; migration 059 triggers cascade to recipes_fts"
  - "getIndexedRecipeBySlug(slug) — read path; returns RecipeRow | RecipeErrorRow | null discriminated on error_message"
  - "IndexResult union (indexed | unchanged | error | skipped_missing) for callers in 12-03 and 12-04"
affects: [12-03-recipe-watcher, 12-04-recipe-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Null-byte-delimited SHA-256 over (path + size + content) stream — prevents boundary collisions between adjacent files"
    - "POSIX path normalisation + lexicographic sort for cross-platform determinism"
    - "Error rows stay in the recipes table with error_message populated; fast-path dedup ONLY short-circuits when error_message IS NULL so a fix flips the row healthy on next index"
    - "SQLite INSERT ... ON CONFLICT(slug) DO UPDATE (UPSERT) — fires migration 059 recipes_fts_au trigger which re-syncs FTS5 on every update"

key-files:
  created:
    - src/lib/recipe-hash.ts
    - src/lib/recipe-indexer.ts
    - src/lib/__tests__/recipe-hash.test.ts
    - src/lib/__tests__/recipe-indexer.test.ts
  modified: []

key-decisions:
  - "Error rows carry the computed dir_sha (not an empty string) so future schema joins on dir_sha still work; error rows are never fast-path-deduped anyway (error_message IS NOT NULL blocks the short-circuit)"
  - "Slug-mismatch between directory basename and recipe.yaml's slug field is treated as a hard-fail (error row) because the watcher and API would disagree on which row to operate on otherwise"
  - "indexRecipe is an async function (reads files) but removeRecipe and getIndexedRecipeBySlug are sync (DB-only) — matches better-sqlite3's synchronous API and avoids false-positive Promise wrappers"
  - "getIndexedRecipeBySlug owns the JSON column deserialisation (env_json → env, etc.) so API routes in 12-04 never touch JSON.parse directly — single place to change if schema evolves"

patterns-established:
  - "Pattern: every Phase 12 row-writing caller (watcher, POST endpoint) imports indexRecipe; there is no alternative write path — the error_message flow is unskippable"
  - "Pattern: callers switch on IndexResult.status to decide side-effects (event emission, log level, HTTP status code)"
  - "Pattern: logger.error({ slug, path, reason }, 'recipe index failed') — Phase 17 log-parsing tests can assert this JSON shape"

requirements-completed: [RECIPE-01, RECIPE-03, RECIPE-04, MODEL-02]

# Metrics
duration: 9min
completed: 2026-04-19
---

# Phase 12 Plan 02: Recipe Indexer Summary

**Single write path for the recipes table — computeDirSha for dedup, indexRecipe for UPSERT + error-row flow, removeRecipe with FTS cascade, getIndexedRecipeBySlug with JSON column deserialisation.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-19T03:29:47Z
- **Completed:** 2026-04-19T03:38:56Z
- **Tasks:** 2
- **Files created:** 4 (2 source, 2 test)
- **Files modified:** 0

## Accomplishments

- `computeDirSha(absDir)` — deterministic SHA-256 over recipe.yaml + SOUL.md + README.md + tools/** + skills/** with POSIX path normalisation, lexicographic sort, and null-byte-delimited (path + size + content) hash stream; editor temp files at root are ignored
- `indexRecipe(absDir, opts)` — 9-step flow: basename→slug, read recipe.yaml (skipped_missing if absent), computeDirSha, fast-path dedup (only when error_message IS NULL), parseRecipeYaml, slug-mismatch check, optional SOUL.md, UPSERT full row
- Hard-fail cases all surface through one path — YAML parse errors, Zod schema failures, unknown `model.primary` (MODEL-02), and slug mismatch all write the same minimal error row with `error_message` populated
- `removeRecipe(slug)` — plain DELETE; migration 059 `recipes_fts_ad` trigger cascades to `recipes_fts` so search queries never return stale matches
- `getIndexedRecipeBySlug(slug)` — reads + parses JSON columns; returns discriminated `RecipeRow | RecipeErrorRow | null` so API handlers in 12-04 get a fully typed view
- 16 new Vitest cases (5 recipe-hash + 11 recipe-indexer); full suite 1759 pass, 44 todo, 0 fail
- `pnpm typecheck` clean; lint clean on new files (76 pre-existing warnings in React components untouched)

## Task Commits

1. **Task 1: computeDirSha + tests** — `b0976e5` (feat)
2. **Task 2: recipe-indexer + tests** — `ddc6b3f` (feat)

_Plan metadata commit follows this summary._

## Files Created/Modified

**Created:**
- `src/lib/recipe-hash.ts` — `computeDirSha(absDir): Promise<string>`
- `src/lib/recipe-indexer.ts` — `indexRecipe`, `removeRecipe`, `getIndexedRecipeBySlug`, `IndexResult`, `IndexOptions`
- `src/lib/__tests__/recipe-hash.test.ts` — 5 cases (determinism, byte-flip, nested inclusion, stray-file ignore, sort invariance)
- `src/lib/__tests__/recipe-indexer.test.ts` — 11 cases (valid index, unchanged dedup, force reindex, YAML parse error, Zod missing-fields, unknown model MODEL-02, slug mismatch, missing recipe.yaml, remove + FTS cascade, broken→valid recovery, no-op remove)

**Modified:** None — plan was strictly additive.

## Exported Signatures for 12-03 (Watcher) and 12-04 (API)

Import these verbatim in Plan 12-03 and Plan 12-04 — the type union drives the switch statements in both callers.

```ts
// src/lib/recipe-indexer.ts
import type Database from 'better-sqlite3'
import type { RecipeRow, RecipeErrorRow } from '@/types/recipe'

export type IndexResult =
  | { status: 'indexed'; slug: string; dirSha: string }
  | { status: 'unchanged'; slug: string; dirSha: string }
  | { status: 'error'; slug: string; error: string }
  | { status: 'skipped_missing'; slug: string }

export interface IndexOptions {
  workspaceId?: number   // default 1
  tenantId?: number      // default 1
  force?: boolean        // skip fast-path dedup
  dbOverride?: Database.Database  // for tests
}

export function indexRecipe(absDir: string, opts?: IndexOptions): Promise<IndexResult>
export function removeRecipe(slug: string, opts?: { dbOverride?: Database.Database }): { removed: boolean }
export function getIndexedRecipeBySlug(
  slug: string,
  opts?: { dbOverride?: Database.Database },
): RecipeRow | RecipeErrorRow | null
```

### Watcher (12-03) switch pattern

```ts
const result = await indexRecipe(absDir)
switch (result.status) {
  case 'indexed':
    eventBus.emit('recipe.indexed', { slug: result.slug, dirSha: result.dirSha })
    break
  case 'unchanged':
    // dedup fast path — no event, no log
    break
  case 'error':
    // error already logged by indexRecipe — watcher can emit an event or skip
    eventBus.emit('recipe.invalid', { slug: result.slug, error: result.error })
    break
  case 'skipped_missing':
    // recipe.yaml absent → caller decides whether to removeRecipe
    removeRecipe(result.slug)
    break
}
```

### API (12-04) discrimination rule for GET /api/recipes/:slug

```ts
const row = getIndexedRecipeBySlug(slug)
if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

if ('error_message' in row && row.error_message !== null) {
  // RecipeErrorRow — project as { slug, error_message } only
  return NextResponse.json({ slug: row.slug, error_message: row.error_message }, { status: 200 })
}

// RecipeRow — return full shape (all JSON columns already deserialised)
return NextResponse.json(row, { status: 200 })
```

### API (12-04) POST /api/recipes pattern

```ts
// Force reindex so even a fast-path-deduped recipe returns fresh { dirSha }
const result = await indexRecipe(absDir, { force: true })
if (result.status === 'error') {
  return NextResponse.json({ error: result.error }, { status: 400 })
}
if (result.status === 'skipped_missing') {
  return NextResponse.json({ error: 'recipe.yaml not found' }, { status: 404 })
}
// 'indexed' or 'unchanged' — both are success
return NextResponse.json({ slug: result.slug, status: result.status }, { status: 201 })
```

## MODEL-02 Error Copy Surfaces

The same error_message string flows through all three surfaces — no re-wording:

1. `logger.error({ slug, path, reason }, 'recipe index failed')` — indexer log line
2. `recipes.error_message` column value — read back via `getIndexedRecipeBySlug`
3. `IndexResult.error` — returned to the watcher/API caller for HTTP response

Example for unknown model:
```
recipe.model.primary 'gpt-4' is not in the model registry. Known models: claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5-20251001
```

Example for slug mismatch:
```
slug mismatch: directory is 'hello' but recipe.yaml says 'something-else'
```

Example for YAML parse error:
```
YAML parse error: <yaml library's message>
```

Example for Zod validation error (multiple issues joined with `; `):
```
slug: Invalid input: expected string, received undefined; name: Invalid input: expected string, received undefined; …
```

## Decisions Made

- **Error rows carry the computed `dir_sha`, not empty string** — makes the row self-consistent and keeps the column's semantics intact (any query that joins on dir_sha still works). The fast-path dedup never triggers on error rows anyway because the `error_message IS NULL` guard blocks it; this is a deliberate design choice so a fix in the YAML re-runs the parser on the next index attempt even when no other files changed.
- **Slug-mismatch is a hard-fail** — when the directory basename says `hello` but `recipe.yaml`'s `slug: something-else`, the watcher (12-03) and the API (12-04) would disagree on which row to operate on. Treating it as an error row with a specific message ("slug mismatch: directory is 'X' but recipe.yaml says 'Y'") forces operators to fix it explicitly.
- **`getIndexedRecipeBySlug` owns JSON deserialisation** — the `env_json`, `secrets_json`, `tags_json`, `model_json` columns are parsed here into their declared types. API routes in 12-04 never touch `JSON.parse` directly, so if the JSON encoding ever needs to change (compression, alternate format), only one file moves.
- **Sync vs async signatures** — `indexRecipe` is `async` (reads files); `removeRecipe` and `getIndexedRecipeBySlug` are synchronous because better-sqlite3's API is synchronous and there's no I/O. This matches the existing project pattern and avoids false-positive `Promise<T>` wrappers in callers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Test for "YAML syntax error" was actually exercising the Zod schema path**
- **Found during:** Task 2 (test run)
- **Issue:** The plan's test wrote `:: broken\n  - [` expecting a YAML parse error. The `yaml` library is surprisingly permissive and parses that as an object with no keys, so the error surfaces from Zod schema validation ("slug: Invalid input: expected string, received undefined; ...") rather than the YAML parser. Test assertion `expect(read.error_message).toMatch(/YAML parse error|recipe\.yaml must be/i)` failed.
- **Fix:** Split the test into two cases: one using a real YAML syntax error (unterminated flow-sequence `tags: [unterminated`) and one using parseable-but-invalid YAML (empty required fields). Both still prove the "hard-fail class" coverage the plan intended; the split also gives better diagnostic messages when either path regresses independently.
- **Files modified:** `src/lib/__tests__/recipe-indexer.test.ts` (two test cases in place of one)
- **Committed in:** `ddc6b3f` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — test coverage split, not a production-code change)
**Impact on plan:** None on production code. Test coverage is stronger: both the YAML-parse branch and the Zod-validation branch are now individually asserted. Plan's success criterion ("Invalid YAML / unknown model / slug mismatch → status: 'error' and minimal error row with error_message set") is fully satisfied.

## Issues Encountered

- None beyond the deviation above.

## User Setup Required

None — no external service configuration. The indexer uses only Node built-in `fs` / `fs/promises` / `crypto` modules; no new dependencies.

## Next Phase Readiness

- **Plan 12-03 (recipe watcher)** is ready:
  - Import `indexRecipe` + `removeRecipe` + `IndexResult` from `@/lib/recipe-indexer`
  - Chokidar-wrapped watcher switches on `IndexResult.status` per the pattern above
  - On `add` / `change` events → call `indexRecipe`
  - On `unlink` of `recipe.yaml` → call `removeRecipe(slug)` (recipe.yaml is the sentinel file)
  - Event emission via `eventBus.emit('recipe.indexed'|'recipe.invalid'|'recipe.removed', ...)`

- **Plan 12-04 (recipe API)** is ready:
  - Import `indexRecipe` + `getIndexedRecipeBySlug` from `@/lib/recipe-indexer`
  - GET /api/recipes/:slug → `getIndexedRecipeBySlug(slug)` + discriminate on `'error_message' in row`
  - GET /api/recipes (list + search) → SQL directly against `recipes` + `recipes_fts` (migration 059 bm25 pattern from 12-01)
  - POST /api/recipes → `indexRecipe(absDir, { force: true })`

No blockers.

## Self-Check: PASSED

- **Files exist:**
  - `/Users/aaronwhaley/Github/mission-control/src/lib/recipe-hash.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/src/lib/recipe-indexer.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/src/lib/__tests__/recipe-hash.test.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/src/lib/__tests__/recipe-indexer.test.ts` — FOUND
  - `/Users/aaronwhaley/Github/mission-control/.planning/phases/12-recipe-system-v1-2/12-02-SUMMARY.md` — FOUND (this file)

- **Commits exist:**
  - `b0976e5` (Task 1: computeDirSha) — FOUND in `git log --oneline`
  - `ddc6b3f` (Task 2: recipe-indexer) — FOUND in `git log --oneline`

- **Exports verified:**
  - `indexRecipe` (async), `removeRecipe`, `getIndexedRecipeBySlug`, `IndexResult`, `IndexOptions` — all exported from `src/lib/recipe-indexer.ts`
  - `computeDirSha` — exported from `src/lib/recipe-hash.ts`

- **Tests pass:** 16/16 new cases pass (5 recipe-hash + 11 recipe-indexer); full suite 1759 pass / 0 fail.

---
*Phase: 12-recipe-system-v1-2*
*Completed: 2026-04-19*
