---
phase: 14-runner-container-v1-2
plan: 02
subsystem: runtime-settings
tags: [runtime, settings, recipe-schema, phase-14]
requires:
  - Phase 11 migrations 054-057 (settings table — already present)
  - Phase 12 recipe-schema baseline (`parseRecipeYaml`, `recipeYamlSchema`)
  - Phase 13 `task-runtime-settings` defensive-default pattern
provides:
  - getMaxConcurrentContainers getter (default 4)
  - getProjectRepoMap getter (default {})
  - getMaxMemoryPerContainer getter (default '8g')
  - getMaxCpuPerContainer getter (default 4.0)
  - getFailedGcWindowDays getter (default 7)
  - recipe.yaml `max_attempts` optional field (int 1..10)
  - 5 new settingDefinitions under runtime.* category
affects:
  - Plan 14-05 (claim route) — consumes all five getters + re-parses recipe.yaml for max_attempts
  - Plan 14-06 (runner-exit route) — re-parses recipe.yaml for max_attempts
  - Plan 14-08b (runner daemon GC tick) — consumes getFailedGcWindowDays
tech-stack:
  added: []
  patterns:
    - Mirrored Phase 13's defensive-default getter pattern (Number.isFinite + positivity guard + documented default)
    - Introduced DEFAULT_* exported constants so downstream plans and tests use named constants instead of magic numbers
key-files:
  created:
    - src/lib/__tests__/runtime-settings-phase14.test.ts
  modified:
    - src/app/api/settings/route.ts
    - src/lib/task-runtime-settings.ts
    - src/lib/recipe-schema.ts
decisions:
  - "max_attempts is NOT persisted into the recipes DB row (no migration). Plan 14-05 and 14-06 resolve via filesystem re-parse: `path.join(getRecipesRoot(), slug, 'recipe.yaml')` → `parseRecipeYaml()` → `parsed.value.max_attempts`. Resolution at claim: `task.runner_max_attempts ?? recipe.max_attempts ?? 3`."
  - "getProjectRepoMap filters out non-string or empty-string values at read time so downstream claim code can trust the returned shape without re-validation."
  - "All new getters use the Phase 13 defensive-default pattern: missing row, empty value, or unparseable content returns the documented default — a corrupt settings row must never brick claim or GC."
  - "DEFAULT_* constants exported from task-runtime-settings so Plan 14-05 / 14-06 / 14-08b can import named constants instead of re-typing magic numbers."
metrics:
  completed_date: 2026-04-20
  duration_minutes: 4
  task_count: 3
  files_changed: 4
  tests_added: 17
requirements: [RUNNER-08, WORK-06, RUNNER-09]
---

# Phase 14 Plan 02: Runtime Settings + Recipe `max_attempts` Summary

**One-liner:** Five admin-mutable runtime.* setting keys with typed getters (global concurrency cap, project→repo path map, per-container memory/CPU ceilings, failed-task GC window) plus an optional `max_attempts` field on the recipe Zod schema — everything Plan 14-05 (claim route) and Plan 14-08b (runner daemon) need as primitives.

## What Shipped

### 1. Five new runtime.* setting definitions

Added to `src/app/api/settings/route.ts` `settingDefinitions` immediately after the existing `runtime.extra_skills_cap` entry (Phase 13 precedent):

| Key                                   | Default | Purpose                                                                                                |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `runtime.max_concurrent_containers`   | `4`     | Global cap on concurrent containers the runner launches. Over-cap claims return 409 CAP_EXCEEDED.      |
| `runtime.project_repo_map`            | `{}`    | JSON object mapping `project_id` → absolute git repo path. Runner passes to `git worktree add`.        |
| `runtime.max_memory_per_container`    | `8g`    | Admin ceiling for container memory. Claim-time rejection if recipe.memory_limit exceeds.               |
| `runtime.max_cpu_per_container`       | `4.0`   | Admin ceiling for container CPU. Claim-time rejection if recipe.cpu_limit exceeds.                     |
| `runtime.failed_gc_window_days`       | `7`     | Days to preserve worktree + logs for `failed` tasks before runner GC tick destroys them.               |

GET/PUT/DELETE handlers already iterate `settingDefinitions` — no handler changes required. Admin-only via `requireRole(..., 'admin')`.

### 2. Five new getters in `src/lib/task-runtime-settings.ts`

All follow the Phase 13 defensive-default pattern (missing row / unparseable value → documented default).

| Getter                          | Return type               | Default                             |
| ------------------------------- | ------------------------- | ----------------------------------- |
| `getMaxConcurrentContainers()`  | `number`                  | `4` (DEFAULT_MAX_CONCURRENT_CONTAINERS) |
| `getProjectRepoMap()`           | `Record<string, string>`  | `{}`                                |
| `getMaxMemoryPerContainer()`    | `string`                  | `'8g'` (DEFAULT_MAX_MEMORY_PER_CONTAINER) |
| `getMaxCpuPerContainer()`       | `number`                  | `4.0` (DEFAULT_MAX_CPU_PER_CONTAINER) |
| `getFailedGcWindowDays()`       | `number`                  | `7` (DEFAULT_FAILED_GC_WINDOW_DAYS) |

Also exported: `TASK_RUNTIME_SETTING_KEYS.MAX_CONCURRENT_CONTAINERS`, `…PROJECT_REPO_MAP`, `…MAX_MEMORY_PER_CONTAINER`, `…MAX_CPU_PER_CONTAINER`, `…FAILED_GC_WINDOW_DAYS` — downstream plans should import the constant, not re-type the key string.

### 3. Recipe schema `max_attempts` field

Added `max_attempts: z.number().int().min(1).max(10).optional()` to `recipeYamlSchema` alongside `max_concurrent` / `timeout_seconds` in `src/lib/recipe-schema.ts`. Inferred `RecipeYaml` type now carries `max_attempts?: number`.

### Locked contract for Plan 14-05 / 14-06 executors

**`max_attempts` is NOT round-tripped through the recipes DB row.**

`getIndexedRecipeBySlug` (`src/lib/recipe-indexer.ts:177`) projects a fixed column set from the `recipes` table and that table has no `max_attempts` column (verified 2026-04-20 — no migration added this phase, per 14-02 locked decision).

Plans **14-05 (claim route)** and **14-06 (runner-exit route)** resolve `max_attempts` by filesystem re-parse:

```typescript
import { getRecipesRoot } from '@/lib/recipe-watcher'
import { parseRecipeYaml } from '@/lib/recipe-schema'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const yamlPath = path.join(getRecipesRoot(), slug, 'recipe.yaml')
const raw = readFileSync(yamlPath, 'utf8')
const parsed = parseRecipeYaml(raw)
if (!parsed.ok) {
  // treat as recipe-not-found or 500 — handlers decide
}
const recipeMaxAttempts = parsed.ok ? parsed.value.max_attempts : undefined
```

Resolution rule at claim time (per plan frontmatter locked decision):

```
final_max_attempts = task.runner_max_attempts ?? recipe.max_attempts ?? 3
```

## Tasks Completed

| # | Name                                                 | Commit    | Files                                             |
| - | ---------------------------------------------------- | --------- | ------------------------------------------------- |
| 1 | Extend settingDefinitions with 5 new runtime.* keys  | `0bd4575` | `src/app/api/settings/route.ts`                   |
| 2 | Add typed getters + recipe-schema max_attempts       | `4121dbe` | `src/lib/task-runtime-settings.ts`, `src/lib/recipe-schema.ts` |
| 3 | Unit tests for getters + recipe-schema max_attempts  | `8437747` | `src/lib/__tests__/runtime-settings-phase14.test.ts` |

## Test Coverage

**File:** `src/lib/__tests__/runtime-settings-phase14.test.ts` — 17 tests / 17 pass.

Getter tests (13 cases as required by plan, expanded into 13 focused cases across five getter `describe` blocks):

1. `getMaxConcurrentContainers` → default 4 when no row
2. `getMaxConcurrentContainers` → returns 6 when row is '6'
3. `getMaxConcurrentContainers` → falls back to 4 when row is non-numeric
4. `getProjectRepoMap` → `{}` when no row
5. `getProjectRepoMap` → parsed object when row is valid JSON
6. `getProjectRepoMap` → `{}` when row is malformed JSON
7. `getMaxMemoryPerContainer` → default '8g' when no row
8. `getMaxMemoryPerContainer` → returns '12g' when row is '12g'
9. `getMaxCpuPerContainer` → default 4.0 when no row
10. `getMaxCpuPerContainer` → returns 2.5 when row is '2.5'
11. `getFailedGcWindowDays` → default 7 when no row
12. `getFailedGcWindowDays` → returns 14 when row is '14'
13. `getFailedGcWindowDays` → default 7 on junk

Recipe-schema tests (4 cases):

14. `parseRecipeYaml` accepts recipe with `max_attempts: 5`
15. `parseRecipeYaml` accepts recipe WITHOUT max_attempts (field optional)
16. `parseRecipeYaml` rejects `max_attempts: 0` with a `max_attempts` issue
17. `parseRecipeYaml` rejects `max_attempts: 11` with a `max_attempts` issue

Test infra mirrors the existing `task-runtime-settings.test.ts` — vi.hoisted db + logger mocks, `beforeEach` spawns a fresh `:memory:` sqlite, `runMigrations`, then seeds via `INSERT OR REPLACE INTO settings`.

## Verification

- `pnpm test src/lib/__tests__/runtime-settings-phase14.test.ts -- --run` → 17/17 pass, 494ms
- `pnpm test src/lib/__tests__/recipe-schema.test.ts -- --run` → 8/8 pass (existing tests still green after `max_attempts` addition)
- `pnpm typecheck` → exit 0, no errors
- `pnpm lint` → 0 errors; 76 pre-existing warnings in unrelated files (scope boundary — not in-phase-14-02 surfaces)
- `grep -c "runtime\\." src/app/api/settings/route.ts` → 8 (3 existing + 5 new) — satisfies ≥ 8 criterion

## Deviations from Plan

**Expanded test count from 13 → 17** — still covers all 13 cases the plan specified, but split some into more focused `it()` blocks (e.g., default / stored / junk) for clearer failure reporting. No deviation of scope or intent. Tracked here for plan-vs-shipped parity only.

No Rule 1-4 deviations. No auth gates. Plan executed as written.

## Key Decisions

- **No DB column for `max_attempts`.** Plan locked decision reaffirmed: `recipes` table stays schema-stable, Plan 14-05 / 14-06 re-parse recipe.yaml from disk. Avoids a migration for a single optional integer and keeps the recipe-indexer projection surface unchanged.
- **`getProjectRepoMap` filters non-string values at read time.** Downstream claim code gets a guaranteed `Record<string, string>` and can dispatch `MISSING_PROJECT_REPO` based purely on key membership, no additional type-guard.
- **Exported `DEFAULT_*` constants.** Plan 14-05 / 14-06 / 14-08b import named constants instead of duplicating magic numbers; tests use the same constants to assert defaults.
- **All new getter string keys added to `TASK_RUNTIME_SETTING_KEYS`.** Ensures downstream plans never hardcode the setting key; `TASK_RUNTIME_SETTING_KEYS.MAX_CONCURRENT_CONTAINERS` (etc.) is the canonical reference.

## Entry Point for Downstream Plans

Plans 14-05, 14-06, 14-08b can now import directly:

```typescript
import {
  getMaxConcurrentContainers,
  getProjectRepoMap,
  getMaxMemoryPerContainer,
  getMaxCpuPerContainer,
  getFailedGcWindowDays,
} from '@/lib/task-runtime-settings'
```

For `max_attempts` resolution, Plans 14-05 and 14-06 must re-parse from `getRecipesRoot()/<slug>/recipe.yaml` (see "Locked contract" above). No getter or indexer helper added this phase by design.

## Self-Check: PASSED

- FOUND: src/app/api/settings/route.ts (modified, 5 new keys)
- FOUND: src/lib/task-runtime-settings.ts (modified, 5 new getters + constants)
- FOUND: src/lib/recipe-schema.ts (modified, max_attempts added)
- FOUND: src/lib/__tests__/runtime-settings-phase14.test.ts (created, 17 tests)
- FOUND: commit 0bd4575 (Task 1)
- FOUND: commit 4121dbe (Task 2)
- FOUND: commit 8437747 (Task 3)
