---
phase: 11-runtime-foundation-v1-2
plan: 03
subsystem: database
tags: [sqlite, migrations, better-sqlite3, schema, v1.2, runtime]

requires:
  - phase: 09-gsd-native-integration
    provides: migrations scaffold and runMigrations loop the v1.2 entries append onto
  - phase: 10
    provides: migration 053_gsd_hierarchy_foundation — the tail of the migrations[] array this plan appends after
provides:
  - recipes table (slug/image/workspace_mode/timeout_seconds/max_concurrent/env_json/secrets_json/tags_json/model_json/version/dir_sha/soul_md + workspace+tenant scoping) for Phase 12 recipe indexer
  - task_runner_tokens table (task_id/attempt/token_hash/expires_at/revoked_at) with FK CASCADE for Plan 11-04 runner-token principal
  - task_checkpoints table (task_id/attempt/step/summary/status/artifacts_json/next_step/blocker_reason/tokens_used/duration_ms) with FK CASCADE for Phase 15
  - 12 additive tasks columns — recipe_slug, workspace_source, read_only_mounts, extra_skills, model_override, container_id, runner_started_at, runner_exit_code, worktree_path, runner_attempts (DEFAULT 0), runner_max_attempts, runner_last_failure_reason
affects: [11-04 runner-token principal, 12 recipe-indexer, 14 runner-daemon, 15 checkpoint-api]

tech-stack:
  added: []
  patterns:
    - "hasTaskCol-guarded ALTER TABLE for idempotent column additions (mirrored from 053_gsd_hierarchy_foundation)"
    - "Partial indexes for cleanup paths: idx_task_runner_tokens_expires_not_revoked WHERE revoked_at IS NULL; idx_tasks_recipe_slug WHERE recipe_slug IS NOT NULL; idx_tasks_runner_started_at WHERE runner_started_at IS NOT NULL"
    - "FK CASCADE on child rows (task_runner_tokens, task_checkpoints) — parent task deletion sweeps children"
    - "In-memory better-sqlite3 (:memory:) for migration test isolation, no getDatabase() singleton dependency"

key-files:
  created:
    - src/lib/__tests__/migrations-v12-runtime.test.ts
  modified:
    - src/lib/migrations.ts

key-decisions:
  - "Migration IDs renumbered 054–057 (not 036–039 as plan specified) because the actual migrations[] array already extends through 053_gsd_hierarchy_foundation; slots 036–053 are taken by prior phases"
  - "task_runner_tokens and task_checkpoints do NOT carry workspace_id/tenant_id columns — scoping flows through the parent tasks row and FK CASCADE handles cleanup; Plan 11-04 enforces task→workspace scoping at the auth layer, not at the token row"
  - "runner_attempts is the only new tasks column with a non-null default (INTEGER NOT NULL DEFAULT 0); all other runtime fields are nullable — downstream code MUST treat recipe_slug, model_override, container_id, runner_started_at, runner_exit_code, worktree_path, runner_max_attempts, runner_last_failure_reason, workspace_source, read_only_mounts, extra_skills as potentially NULL"
  - "Tasks test seed uses (title, status, priority, workspace_id) only — the tasks table has workspace_id (added in 021_workspace_isolation_phase1) but has never had a tenant_id column"

patterns-established:
  - "v1.2 substrate pattern: one migration per logical group (tables grouped by concern), additive-only, no DROP/rename, no down scripts"
  - "Migration file is append-only; the hasTaskCol idiom is reused verbatim from migration 053 for the tasks runtime columns"

requirements-completed:
  - TCTX-07

duration: 8min
completed: 2026-04-19
---

# Phase 11 Plan 03: v1.2 Runtime Substrate Migrations Summary

**Four additive migrations (054–057) adding recipes, task_runner_tokens, task_checkpoints tables and twelve nullable runtime columns on tasks — unblocks Plan 11-04, Phase 12, Phase 14, Phase 15.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-19T01:48:15Z
- **Completed:** 2026-04-19T01:56:10Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Three new tables land on a fresh boot: `recipes` (20 columns + 3 indexes), `task_runner_tokens` (7 columns + 3 indexes including one partial index), `task_checkpoints` (12 columns + 2 indexes)
- Twelve nullable runtime columns added to `tasks` with two partial indexes; ADD COLUMN guarded by `hasTaskCol` idiom so upgrade paths are true no-ops
- `runner_attempts` is the only new column with a default (INTEGER NOT NULL DEFAULT 0); every other runtime field is nullable
- FK CASCADE on both child tables — deleting a task sweeps its runner_tokens and checkpoints
- 7-test Vitest suite proves: fresh-DB schema shape, FK+partial-index presence, column additivity, null-default behavior for legacy rows, idempotency (2x runMigrations no-op), and upgrade-path forward-compat (drop + re-run with tasks cols intact)

## Task Commits

1. **Task 1: Append four additive migrations to src/lib/migrations.ts** — `e8594e7` (feat)
2. **Task 2: Add migration test suite proving fresh + existing DB forward-compat** — `53e4809` (test)

**Plan metadata:** [pending final commit]

## Files Created/Modified

- `src/lib/migrations.ts` — +102 lines appending four migration entries (054_recipes, 055_task_runner_tokens, 056_task_checkpoints, 057_tasks_runtime_columns) after 053_gsd_hierarchy_foundation
- `src/lib/__tests__/migrations-v12-runtime.test.ts` — new 135-line test suite (7 test cases) covering the full substrate contract

## Schema Reference (for downstream plans)

### task_runner_tokens (Plan 11-04 entry point)

| column | type | nullable | notes |
| --- | --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | no | |
| task_id | INTEGER | no | FK → tasks(id) ON DELETE CASCADE |
| attempt | INTEGER | no | | 
| token_hash | TEXT | no | UNIQUE — sha256 hex of bearer |
| expires_at | INTEGER | no | unix seconds, RAUTH-02 expiry |
| revoked_at | INTEGER | yes | null until terminal flip (RAUTH-05) |
| created_at | INTEGER | no | DEFAULT (unixepoch()) |

**Indexes:** `idx_task_runner_tokens_task_attempt (task_id, attempt)`, `idx_task_runner_tokens_token_hash (token_hash)`, `idx_task_runner_tokens_expires_not_revoked (expires_at) WHERE revoked_at IS NULL`.

Plan 11-04's SHA-256 write path should hash the bearer with `sha256.hex` and INSERT ({task_id, attempt, token_hash, expires_at}). The read path looks up by `token_hash` with `revoked_at IS NULL AND expires_at > ?`.

### task_checkpoints (Phase 15 entry point)

| column | type | nullable |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | no |
| task_id | INTEGER | no (FK CASCADE) |
| attempt | INTEGER | no |
| step | TEXT | no |
| summary | TEXT | no |
| status | TEXT | no (`completed` \| `in_progress` \| `blocked`) |
| artifacts_json | TEXT | no (DEFAULT `'[]'`) |
| next_step | TEXT | yes |
| blocker_reason | TEXT | yes |
| tokens_used | INTEGER | yes |
| duration_ms | INTEGER | yes |
| created_at | INTEGER | no (DEFAULT unixepoch()) |

**Indexes:** `idx_task_checkpoints_task_attempt_created (task_id, attempt, created_at)` for timeline queries, `idx_task_checkpoints_status (status)` for blocked-tasks lookup.

### tasks runtime columns — nullability summary

| column | type | default |
| --- | --- | --- |
| recipe_slug | TEXT | NULL |
| workspace_source | TEXT (JSON) | NULL |
| read_only_mounts | TEXT (JSON array) | NULL |
| extra_skills | TEXT (JSON array) | NULL |
| model_override | TEXT | NULL |
| container_id | TEXT | NULL |
| runner_started_at | INTEGER | NULL |
| runner_exit_code | INTEGER | NULL |
| worktree_path | TEXT | NULL |
| **runner_attempts** | **INTEGER NOT NULL** | **0** |
| runner_max_attempts | INTEGER | NULL (→ runner defaults to 3 per WORK-06; recipe override drives this) |
| runner_last_failure_reason | TEXT | NULL |

All selects touching these columns must handle NULL (`??` / `COALESCE`) for every field except `runner_attempts`.

## Decisions Made

- **Migration IDs 054–057, not 036–039.** The plan referenced an outdated tail. Phase 10 and prior work already occupied IDs 036–053 (36 `_recurring_tasks_index` through 53 `_gsd_hierarchy_foundation`). Appending four entries after the true tail keeps the numbering sequential and collision-free.
- **No workspace_id/tenant_id on token and checkpoint rows.** Those are scoped through the parent `tasks` row; the FK CASCADE plus Plan 11-04's auth-layer enforcement cover row-level tenancy without denormalising every child row.
- **`runner_attempts NOT NULL DEFAULT 0` is the only non-null runtime column.** Picked because SQLite permits constant defaults in ADD COLUMN, and the runner code path will increment it on each claim — starting at 0 makes the first claim's increment deterministic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Renumbered migrations from 036-039 to 054-057**
- **Found during:** Task 1 (pre-write grep)
- **Issue:** Plan specified migration IDs `036_recipes` through `039_tasks_runtime_columns`, but `grep "id: '0" src/lib/migrations.ts` shows the last existing entry is `053_gsd_hierarchy_foundation`. IDs 036-053 are already taken by prior phases (036_recurring_tasks_index, 037_security_audit, ..., 053_gsd_hierarchy_foundation). Using 036-039 would have collided with applied migrations and been silently skipped by the `applied.has(migration.id)` guard in `runMigrations` — zero tables created, silent failure downstream.
- **Fix:** Used the next four sequential IDs: `054_recipes`, `055_task_runner_tokens`, `056_task_checkpoints`, `057_tasks_runtime_columns`. Updated test assertions to match.
- **Files modified:** src/lib/migrations.ts, src/lib/__tests__/migrations-v12-runtime.test.ts
- **Verification:** `grep -c "id: '0" migrations.ts` reports 55 entries (was 51). `grep "CREATE TABLE IF NOT EXISTS recipes\|task_runner_tokens\|task_checkpoints"` reports 3 hits. All 7 tests pass.
- **Committed in:** e8594e7 (Task 1) and 53e4809 (Task 2)

**2. [Rule 1 - Bug] Removed tenant_id from legacy-task seed INSERT in test**
- **Found during:** Task 2 (first test run)
- **Issue:** Plan's test scaffold used `INSERT INTO tasks (title, status, priority, workspace_id, tenant_id) VALUES (?, ?, ?, ?, ?)`. The real tasks table — inspected via `PRAGMA table_info` and confirmed against `schema.sql` + migration history — has no `tenant_id` column. Migration `021_workspace_isolation_phase1` added `workspace_id` to tasks but never added `tenant_id`. Running the plan-as-written raised `SqliteError: table tasks has no column named tenant_id`.
- **Fix:** Dropped `tenant_id` from the INSERT column list and parameter tuple in the "leaves pre-existing task rows" test.
- **Files modified:** src/lib/__tests__/migrations-v12-runtime.test.ts
- **Verification:** All 7 tests now pass. Full `pnpm test` run shows 1648 passed, 0 failed.
- **Committed in:** 53e4809 (Task 2)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs in plan assumptions that would have caused silent or loud failures). Functionality matches plan intent exactly; only the numerics and column list needed correction.

**Impact on plan:** Neither deviation changes the scope, schema, or behaviour of the migrations. Downstream plans (11-04, Phase 12, Phase 14, Phase 15) must reference IDs 054–057 instead of 036–039 — everything else is identical.

## Issues Encountered

- **Pre-existing typecheck error in `src/lib/validation.ts:58`** unrelated to this plan (Zod v4 API migration from Phase 10's commit 3567675). Logged to `deferred-items.md` in the phase directory; not fixed here per GSD scope boundary rules.
- **Pre-existing lint warnings (76, all `react-hooks/exhaustive-deps`)** unrelated to this plan. Not fixed; logged to deferred-items.

## Self-Check: PASSED

Verified files and commits exist:
- FOUND: src/lib/migrations.ts (modified with 4 new migration entries)
- FOUND: src/lib/__tests__/migrations-v12-runtime.test.ts (new file)
- FOUND: commit e8594e7 (Task 1)
- FOUND: commit 53e4809 (Task 2)
- FOUND: .planning/phases/11-runtime-foundation-v1-2/deferred-items.md
- 7/7 tests pass in `pnpm test -- migrations-v12-runtime`
- Full `pnpm test` run: 1648 pass, 0 fail, 44 todo, 4 skipped test files

## Next Phase Readiness

- **Plan 11-04 (runner-token principal)** can now INSERT into `task_runner_tokens`. Columns and indexes exist exactly as RAUTH-02/RAUTH-05 expect.
- **Phase 12 (recipe indexer)** can now INSERT into `recipes`. `dir_sha` column is the anchor for idempotent indexing.
- **Phase 13/14 (task runtime context, runner daemon)** can now read/write the 12 runtime fields on `tasks`. Nullability contract documented above — only `runner_attempts` is non-null.
- **Phase 15 (checkpoint API)** can now INSERT into `task_checkpoints`. Timeline index supports the per-(task, attempt) scan.

No blockers. Wave 1 substrate is complete.

---
*Phase: 11-runtime-foundation-v1-2*
*Completed: 2026-04-19*
