---
phase: 12-recipe-system-v1-2
plan: 01
subsystem: database
tags: [sqlite, fts5, migrations, zod, yaml, recipes]

# Dependency graph
requires:
  - phase: 11-runtime-foundation-v1-2
    provides: "model-registry (isKnownModel, MODEL_IDS); recipes table (migration 054); migrations chain ending at 057"
provides:
  - "Migration 058_recipes_error_message — error_message TEXT column + partial index idx_recipes_error_null"
  - "Migration 059_recipes_fts5 — recipes_fts virtual table over name/description/when_to_use/tags + AFTER INSERT/UPDATE/DELETE triggers that keep it synced"
  - "parseRecipeYaml(raw): ParseResult — single validation surface for recipe.yaml → RecipeYaml used by 12-02/12-03/12-04"
  - "RecipeRow / RecipeErrorRow / RecipeModel shared types"
  - "yaml@^2.8.3 dependency"
affects: [12-02-recipe-indexer, 12-03-recipe-watcher, 12-04-recipe-api]

# Tech tracking
tech-stack:
  added: [yaml@^2.8.3]
  patterns:
    - "Discriminated ParseResult union ({ok:true,value}|{ok:false,error}) for never-throwing parse paths"
    - "Standalone (contentful) FTS5 virtual table with INSERT/UPDATE/DELETE triggers vs external-content — sidesteps the FTS5 rule that content='X' requires identical column names"
    - "Pinned-model validation via Zod .refine(isKnownModel) with registry-enumerating error message"

key-files:
  created:
    - src/lib/recipe-schema.ts
    - src/types/recipe.ts
    - src/lib/__tests__/recipe-schema.test.ts
    - src/lib/__tests__/migrations-v12-recipe.test.ts
  modified:
    - src/lib/migrations.ts
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "FTS5 table is standalone (contentful), not external-content, because FTS5 column 'tags' cannot be linked to recipes.tags_json when column names differ — triggers give equivalent sync semantics"
  - "Column weights (tags 2x) applied in bm25() at QUERY time (Plan 12-04), not in the schema — keeps the virtual table neutral and lets callers tune ranking without re-migrating"
  - "parseRecipeYaml returns a discriminated ParseResult, never throws — aligns with the error-row flow (error_message column) so indexer/API uniformly write messages without try/catch"
  - "Zod v4 dynamic error messages use { error: (issue) => ... } shape for the model-registry refinement (v3 function-form was removed in Phase 11-01)"

patterns-established:
  - "Pattern: every Phase 12 consumer (indexer, watcher, API) imports parseRecipeYaml — rejection messages stay identical across surfaces"
  - "Pattern: broken-recipe rows stay in the recipes table with error_message populated (vs being deleted); the partial index idx_recipes_error_null keeps list/search queries fast"
  - "Pattern: FTS5 triggers DELETE FROM recipes_fts WHERE rowid = old.id on DELETE and UPDATE (standalone FTS5), not the ('delete', ...) sentinel (external-content only)"

requirements-completed: [RECIPE-02, RECIPE-04, RECIPE-08]

# Metrics
duration: 7min
completed: 2026-04-19
---

# Phase 12 Plan 01: Recipe Substrate Summary

**SQLite substrate for Phase 12 — recipes.error_message column, recipes_fts FTS5 virtual table with sync triggers, and a Zod parseRecipeYaml that refuses unknown model.primary with registry-enumerating errors**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-19T03:15:23Z
- **Completed:** 2026-04-19T03:23:20Z
- **Tasks:** 2
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- Migration 058 adds `recipes.error_message TEXT` and partial index `idx_recipes_error_null` (WHERE error_message IS NULL) so list/search filters stay fast
- Migration 059 creates `recipes_fts` (FTS5) over `name`, `description`, `when_to_use`, `tags` with AFTER INSERT/UPDATE/DELETE triggers plus a backfill SELECT for pre-existing rows
- `parseRecipeYaml(raw)` — single validation entry point returning `{ok:true,value}` or `{ok:false,error}`; rejects unknown `model.primary` with an error that cites the offending ID and enumerates all registered model IDs (MODEL-02 surface copy)
- Shared types `RecipeRow` (with `error_message: null` narrow), `RecipeErrorRow`, and `RecipeModel` ready for 12-02/12-03/12-04 to import
- 13 new Vitest cases — 5 migration, 8 schema — all passing; full suite 1743 pass

## Task Commits

1. **Task 1: Append migrations 058 + 059 to migrations.ts** — `b8472c2` (feat)
2. **Task 2: Install yaml; write recipe-schema + types + tests** — `d764b05` (feat)

_Plan metadata commit follows this summary._

## Files Created/Modified

**Created:**
- `src/lib/recipe-schema.ts` — `parseRecipeYaml`, `recipeYamlSchema`, `RecipeYaml`, `ParseResult`
- `src/types/recipe.ts` — `RecipeRow`, `RecipeErrorRow`, `RecipeModel`, re-export `RecipeYaml`
- `src/lib/__tests__/recipe-schema.test.ts` — 8 cases (valid, unparseable, non-object root, missing required, bad slug shapes, unknown model, out-of-range timeout, full optional roundtrip)
- `src/lib/__tests__/migrations-v12-recipe.test.ts` — 5 cases (column, partial index, virtual table, trigger sync, idempotency)

**Modified:**
- `src/lib/migrations.ts` — appended 058_recipes_error_message (line 1662) and 059_recipes_fts5 (line 1676); did NOT touch migrations 001–057
- `package.json` — added `yaml@^2.8.3` dependency
- `pnpm-lock.yaml` — regenerated lockfile

## Usage Example for 12-02 / 12-03 / 12-04

```ts
import { parseRecipeYaml } from '@/lib/recipe-schema'
import type { RecipeYaml } from '@/types/recipe'
import { readFileSync } from 'node:fs'

const raw = readFileSync('/recipes/hello-world/recipe.yaml', 'utf8')
const result = parseRecipeYaml(raw)

if (!result.ok) {
  // Write result.error into recipes.error_message verbatim — the same copy
  // renders in the indexer log AND GET /api/recipes/:slug AND POST /api/recipes.
  db.prepare(`
    INSERT INTO recipes (slug, name, image, workspace_mode, timeout_seconds, dir_sha, error_message, workspace_id, tenant_id)
    VALUES (?, ?, '', 'worktree', 0, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET error_message = excluded.error_message, updated_at = unixepoch()
  `).run(slug, slug, dirSha, result.error, workspaceId, tenantId)
  return
}

const recipe: RecipeYaml = result.value
// ... proceed with indexing
```

## MODEL-02 Error Message Format (mirror this in 12-02 log and 12-04 API response)

```
recipe.model.primary 'gpt-4' is not in the model registry. Known models: claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5-20251001
```

Path prefix: `model.primary: ...` (issues are joined with `; ` when multiple fields fail).

## FTS5 Query Pattern (for Plan 12-04 search endpoint)

```sql
SELECT r.slug, r.name, r.description, bm25(recipes_fts, 1.0, 1.0, 1.0, 2.0) AS rank
FROM recipes_fts
JOIN recipes r ON r.id = recipes_fts.rowid
WHERE recipes_fts MATCH ?
  AND r.error_message IS NULL
  AND r.workspace_id = ?
ORDER BY rank
LIMIT 50
```

Column weights in `bm25(recipes_fts, name_w, desc_w, when_w, tags_w)` — tags weighted 2x satisfies RECIPE-08.

## Decisions Made

- **Standalone FTS5 over external-content** — the plan specified `content='recipes' + content_rowid='id'`, but FTS5 external-content requires the FTS5 column names to match the content table. Our FTS5 `tags` column would have to be named `tags_json` to link to `recipes.tags_json`, which would leak a JSON-encoded column name into every MATCH query. Chose standalone (contentful) FTS5; triggers give identical behaviour without that constraint.
- **Weights live in query, not schema** — `bm25()` ranking weights are a query-time concern (Plan 12-04). Keeping the virtual table weight-neutral lets us tune RECIPE-08's 2x tag boost without a re-migration.
- **ParseResult never throws** — the discriminated union cleanly wires into the error_message column flow: one path writes `result.value`, the other writes `result.error`. No try/catch at call sites.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] FTS5 column-name mismatch broke INSERT triggers**
- **Found during:** Task 1 (first test run)
- **Issue:** The plan's migration 059 used `CREATE VIRTUAL TABLE ... USING fts5(..., content='recipes', content_rowid='id')`. With external-content FTS5, every FTS5 column must match a column name in the content table. The schema declared `tags` (FTS5) but `recipes` has `tags_json` — so `INSERT INTO recipes_fts(..., tags) VALUES (...)` from the trigger errored with `SqliteError: no such column: T.tags`.
- **Fix:** Removed the `content='recipes'` / `content_rowid='id'` options so the virtual table is standalone (contentful). Rewrote the DELETE and UPDATE triggers to use `DELETE FROM recipes_fts WHERE rowid = old.id` (standard contentful syntax) instead of the `('delete', old.id, ...)` sentinel (external-content-only syntax). Added inline comments documenting the reason so future maintainers don't re-introduce the constraint.
- **Files modified:** `src/lib/migrations.ts` (migration 059 only)
- **Verification:** All 5 migration tests pass, including the trigger INSERT+UPDATE+DELETE sync assertion
- **Committed in:** `b8472c2` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix was required for correctness — FTS5 external-content + mismatched column names cannot work together. No scope creep; semantics of the triggers are identical to the plan's intent.

## Issues Encountered

- None beyond the deviation above.

## User Setup Required

None — no external service configuration required. Migrations run automatically on first DB open.

## Next Phase Readiness

- Ready for **Plan 12-02 (recipe indexer)**: `parseRecipeYaml` is the parse surface, `RecipeRow` / `RecipeErrorRow` are the write targets, migration 058 provides `error_message`
- Ready for **Plan 12-03 (recipe watcher)**: same imports as 12-02
- Ready for **Plan 12-04 (recipe API)**: migration 059 provides `recipes_fts`; use the SQL pattern above for search; mirror the MODEL-02 error format for consistency

No blockers.

## Self-Check: PASSED

- Files: src/lib/recipe-schema.ts, src/types/recipe.ts, src/lib/__tests__/recipe-schema.test.ts, src/lib/__tests__/migrations-v12-recipe.test.ts, .planning/phases/12-recipe-system-v1-2/12-01-SUMMARY.md — all exist
- Commits: b8472c2, d764b05 — both present in git log

---
*Phase: 12-recipe-system-v1-2*
*Completed: 2026-04-19*
