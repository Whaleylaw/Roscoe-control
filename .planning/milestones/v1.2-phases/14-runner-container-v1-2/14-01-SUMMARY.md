---
phase: 14-runner-container-v1-2
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, migrations, runner, heartbeat, attempts, fk-cascade]

# Dependency graph
requires:
  - phase: 11-runtime-foundation-v1-2
    provides: "Migrations 054-057 (recipes, task_runner_tokens, task_checkpoints, tasks runtime columns) — structural precedent and FK target (tasks.id)"
  - phase: 12-recipe-system-v1-2
    provides: "Migrations 058-059 (recipes.error_message, recipes_fts5) — most recent in-tree migrations; shape + placement precedent"
provides:
  - "Migration 060_runner_heartbeats (runner_id PK, last_heartbeat_at, registered_at, metadata_json + idx_runner_heartbeats_last)"
  - "Migration 061_task_runner_attempts (FK CASCADE to tasks.id, UNIQUE(task_id, attempt), nullable exit columns, idx_task_runner_attempts_task)"
  - "runner_heartbeats UPSERT semantics proven (ON CONFLICT(runner_id) DO UPDATE SET last_heartbeat_at = excluded.last_heartbeat_at)"
  - "task_runner_attempts INSERT ON CONFLICT DO NOTHING idempotency proven — claim route (Plan 14-05) can retry safely"
affects:
  - 14-04-heartbeat-endpoint
  - 14-05-claim-endpoint
  - 14-06-runner-exit-endpoint
  - 15-checkpoints-scheduler (reconcileRunnerHeartbeat consumer)
  - 16-ui-surfaces (offline banner consumer)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Operational runtime state in dedicated tables (not settings/JSON columns) — scales to multi-runner, keeps queries relational"
    - "Additive-only migrations via CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS — matches migrations 054-059"

key-files:
  created:
    - src/lib/__tests__/migrations-060-061.test.ts
  modified:
    - src/lib/migrations.ts

key-decisions:
  - "Appended to the main migrations[] array (not extraMigrations[]) — matches the actual placement of Phase 11/12 migrations 054-059. extraMigrations[] is populated only via the registerMigrations() plugin hook, so the plan's literal instruction would have left 060/061 unloaded."
  - "runner_heartbeats.runner_id is TEXT PRIMARY KEY (not id INTEGER AUTOINCREMENT) so UPSERT key is the runner identity directly — no lookup indirection needed at heartbeat time."
  - "UPSERT clause intentionally omits registered_at from the SET list so the first-registration timestamp is preserved across heartbeats — test pinned this semantic."
  - "task_runner_attempts exit columns (exited_at, exit_code, failure_reason, stderr_tail) are nullable because the row is INSERTed at claim time (only task_id/attempt/started_at known) and UPDATEd at runner-exit — a single row per attempt, two writes."
  - "UNIQUE(task_id, attempt) is the dedup key that lets Plan 14-05's claim route use INSERT ON CONFLICT DO NOTHING safely on claim retries without extra SELECT."
  - "FK CASCADE on task_id follows the task_runner_tokens precedent (migration 055) — task deletion cleans attempt history automatically."

patterns-established:
  - "Dual-table operational state: freshness tracking (heartbeats) kept separate from per-unit-of-work history (attempts). Downstream endpoints query them independently."
  - "Claim-time INSERT / exit-time UPDATE on a single attempt row — one row per (task_id, attempt), never split across tables."

requirements-completed: [RUNNER-05, WORK-02]

# Metrics
duration: 7min
completed: 2026-04-20
---

# Phase 14 Plan 01: Runner Operational-State Tables Summary

**Two additive SQLite migrations (060 runner_heartbeats + 061 task_runner_attempts) with UPSERT, UNIQUE(task_id, attempt), and FK CASCADE — fully covered by a 6-case Vitest suite.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-20T17:57:47Z
- **Completed:** 2026-04-20T18:04:27Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `runner_heartbeats` table — single row per runner, UPSERT by `runner_id`, index on `last_heartbeat_at DESC` for freshness queries (Phase 15 reconcile, Phase 16 offline banner).
- `task_runner_attempts` table — one row per `(task_id, attempt)` with FK CASCADE to tasks.id, UNIQUE dedup constraint, nullable exit columns populated at runner-exit. Feeds `.mc/task.json.prior_attempts[]` (WORK-02) and claim-route idempotency (Plan 14-05).
- Test suite pins: schema shape, idempotent re-run, UPSERT semantics (registered_at preserved), UNIQUE rejection, FK CASCADE.

## Task Commits

Each task was committed atomically:

1. **Task 1: Append migration 060 (runner_heartbeats) and 061 (task_runner_attempts) to migrations[]** — `2c0fe32` (feat)
2. **Task 2: Write migration test covering fresh-DB schema + UPSERT + UNIQUE + FK CASCADE + idempotency** — `96a89a8` (test)

**Plan metadata:** (to be added)

## Files Created/Modified

- `src/lib/migrations.ts` — appended migration 060 (runner_heartbeats) and 061 (task_runner_attempts) after 059_recipes_fts5 inside the main migrations[] array.
- `src/lib/__tests__/migrations-060-061.test.ts` — 6-case Vitest suite against a `:memory:` better-sqlite3 DB with `foreign_keys = ON`.

## Decisions Made

- **Use `migrations[]` not `extraMigrations[]`:** The plan body said "append to extraMigrations" but the precedent pattern (054-059) and the runtime wiring both point at the main array. `extraMigrations[]` is initialized empty and populated only by `registerMigrations()` (a plugin hook). Appending to `extraMigrations` would have compiled but the new migrations would never run. Corrected per deviation Rule 3.
- **UPSERT preserves `registered_at`:** The SET clause updates only `last_heartbeat_at`. First-registration time is never overwritten — the test pins this, and Phase 15's reconcileRunnerHeartbeat relies on it.
- **UNIQUE(task_id, attempt) at schema level:** Lets Plan 14-05 claim route do `INSERT ... ON CONFLICT DO NOTHING` without a SELECT-then-INSERT round-trip.
- **Nullable exit columns:** Row is INSERTed at claim-time with only started_at known; runner-exit (Plan 14-06) UPDATEs exited_at/exit_code/failure_reason/stderr_tail. One row per attempt, two writes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Corrected target array for migration append**

- **Found during:** Task 1 (Append migration 060 and 061)
- **Issue:** The plan's `<action>` text said "Append TWO migration objects to the `extraMigrations` array". Reading `src/lib/migrations.ts` showed that `extraMigrations[]` is initialized as `const extraMigrations: Migration[] = []` and is only populated via the `registerMigrations()` plugin hook. The actual Phase 11/12 migrations (054-059) live in the main `migrations[]` array. Following the plan's literal instruction would have added two Migration objects to a variable that is never populated at module-eval time, so the two migrations would silently never run on a fresh DB.
- **Fix:** Appended the two new migrations to the main `migrations[]` array immediately after `'059_recipes_fts5'`, matching the precedent placement for 054-059. Noted in the Task 1 commit message.
- **Files modified:** `src/lib/migrations.ts`
- **Verification:** `pnpm test src/lib/__tests__/migrations-060-061.test.ts` — 6/6 pass (a fresh `:memory:` DB actually gets the tables, confirming the migrations ran).
- **Committed in:** `2c0fe32` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Correction was mechanically necessary for the migrations to execute; downstream Phase 14 plans reference the locked decision in STATE.md.

## Issues Encountered

- None beyond the deviation above. Typecheck clean, tests green on first run, no test flakes.

## User Setup Required

None — no external service configuration, no environment variables, no migration rollback concerns (both migrations are additive CREATE statements).

## Next Phase Readiness

- **Plan 14-04 (heartbeat endpoint):** `runner_heartbeats` table + UPSERT semantics locked. Endpoint can prepare-and-run the UPSERT without schema work.
- **Plan 14-05 (claim endpoint):** `task_runner_attempts` UNIQUE(task_id, attempt) enables INSERT ON CONFLICT DO NOTHING; claim-time attempt row insert is a single statement.
- **Plan 14-06 (runner-exit endpoint):** Exit columns ready for UPDATE (exited_at, exit_code, failure_reason, stderr_tail).
- **Phase 15 (reconcileRunnerHeartbeat):** Can query `idx_runner_heartbeats_last` directly.
- **Phase 16 (offline banner):** Same query surface as Phase 15; no additional schema needed.

No blockers. Phase 14 wave 1 plans can proceed in parallel against these tables.

## Self-Check: PASSED

- FOUND: `src/lib/migrations.ts`
- FOUND: `src/lib/__tests__/migrations-060-061.test.ts`
- FOUND: `.planning/phases/14-runner-container-v1-2/14-01-SUMMARY.md`
- FOUND commit: `2c0fe32` (Task 1)
- FOUND commit: `96a89a8` (Task 2)

---
*Phase: 14-runner-container-v1-2*
*Completed: 2026-04-20*
