---
phase: 20-lane-aware-routing-unified-blocker-contract
plan: 02
subsystem: api
tags: [blocker, awaiting_owner, put-handler, zod, legacy-dispatch, COMPAT-03]

# Dependency graph
requires:
  - phase: 15-recipe-runner-daemon-and-blocker-flow
    provides: "recipe-path blocker checkpoint flow (status='blocked' → status='awaiting_owner', runner_last_failure_reason column); legacy path mirrors this pattern"
  - phase: 19-project-scoped-queue-plan-activation
    provides: "project-scoped queue filtering + plan in_progress activation pass; lane primitives the Phase 20 routing layer (20-01) builds on"
provides:
  - "BLOCKER_KINDS enum + BlockerKind type exported from src/lib/validation.ts (needs_input, needs_approval, external_dependency, policy, other)"
  - "updateTaskSchema extended with optional blocker_reason (1-2000), blocker_kind (enum), resume_hint (1-500)"
  - "PUT /api/tasks/:id legacy pause branch: in_progress → awaiting_owner with JSON envelope persisted to runner_last_failure_reason inside db.transaction()"
  - "PUT /api/tasks/:id legacy resume branch: awaiting_owner → assigned clears envelope in db.transaction(), preserves assigned_to"
  - "task.status_changed broadcast with reason blocker_pause_legacy / blocker_resume_legacy (additive, coexists with task.updated)"
  - "Recipe-tagged pause PUTs rejected with 409 RECIPE_BLOCKER_VIA_CHECKPOINTS redirect"
  - "CONCURRENT_TRANSITION 409 when WHERE-guarded UPDATE races another writer"
  - "Vitest route-handler coverage (12 cases) in src/app/api/tasks/__tests__/blocker-transition.test.ts"
affects: [20-03 shared event shape, 21 MCP surface, 23 accept-01 loop]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner-intervention pause/resume with structured envelope persisted as JSON in an existing TEXT column (zero-migration, mirrors recipe path's runner_last_failure_reason semantics)"
    - "WHERE-guarded UPDATE inside db.transaction() with explicit 'concurrent_transition' throw pathway for 409 on races"
    - "Short-circuit write branch that owns status + column write atomically, then falls through to generic path only when neither pause nor resume conditions match"
    - "Blocker-envelope Zod fields optional at schema level; cross-field required-when-pausing check lives in the handler because it depends on DB state (recipe_slug + current status)"

key-files:
  created:
    - src/app/api/tasks/__tests__/blocker-transition.test.ts
  modified:
    - src/lib/validation.ts
    - src/app/api/tasks/[id]/route.ts

key-decisions:
  - "Blocker envelope persisted as JSON in existing runner_last_failure_reason column — zero migrations, reuses the column the recipe path already writes to (just with a different payload shape)"
  - "Pause/resume branches short-circuit the generic fieldsToUpdate write path — generic dynamic column builder is a misuse for atomic blocker writes"
  - "Recipe-tagged pause PUTs rejected with 409 (redirect to POST /api/tasks/:id/checkpoints) — recipe path owns its own checkpoint-driven blocker flow"
  - "Concurrent-transition guard uses WHERE status='in_progress' AND recipe_slug IS NULL in the UPDATE; changes === 0 triggers 409"
  - "Comment markers placed in both pause and resume branches reserving the future task.blocker_transition broadcast site for Plan 20-03 (shared event shape)"
  - "Existing gate-required guard continues to run BEFORE the blocker branch and inherently bypasses because awaiting_owner is not a forward-motion target — gate-blocked tasks can still be paused (D-31 preserve)"

patterns-established:
  - "Legacy blocker PUT contract: caller PUTs {status: 'awaiting_owner', blocker_reason, blocker_kind, resume_hint} to pause; PUTs {status: 'assigned'} to resume; handler branches own status + envelope atomically"
  - "Test simulation of concurrent-write race in single-threaded harness: prepare-spy intercepts the handler's initial SELECT to return a stale in_progress snapshot while the guarded UPDATE sees the real raced on-disk status"

requirements-completed: [ROUTE-02, COMPAT-03]

# Metrics
duration: ~20min
completed: 2026-04-22
---

# Phase 20 Plan 02: Legacy Blocker Contract Summary

**Legacy PUT /api/tasks/:id gains structured pause/resume (`{status: 'awaiting_owner', blocker_reason, blocker_kind, resume_hint}` / `{status: 'assigned'}`) atomically persisting a JSON envelope in `runner_last_failure_reason` with zero migrations, mirroring the recipe runner's `awaiting_owner` semantics while preserving retry/fail scheduler paths.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-22T01:59:00Z (approx)
- **Completed:** 2026-04-22T02:19:42Z
- **Tasks:** 3
- **Files modified:** 2 (src/lib/validation.ts, src/app/api/tasks/[id]/route.ts)
- **Files created:** 1 (src/app/api/tasks/__tests__/blocker-transition.test.ts)

## Accomplishments

- Extended `updateTaskSchema` with optional `blocker_reason` / `blocker_kind` / `resume_hint` and exported the `BLOCKER_KINDS` constant + `BlockerKind` type from `src/lib/validation.ts`.
- Added a legacy-blocker branch to the PUT handler that owns the status flip + envelope JSON write atomically inside `db.transaction()`, short-circuiting the generic `fieldsToUpdate` path.
  - Pause branch (in_progress → awaiting_owner): validates all three fields, rejects recipe-tagged tasks with 409 `RECIPE_BLOCKER_VIA_CHECKPOINTS`, returns 400 `BLOCKER_FIELDS_MISSING` when required fields absent, emits `task.status_changed { reason: 'blocker_pause_legacy' }` + mirrors `task.updated`.
  - Resume branch (awaiting_owner → assigned, legacy only): clears `runner_last_failure_reason = NULL`, preserves `assigned_to`, emits `task.status_changed { reason: 'blocker_resume_legacy' }` + mirrors `task.updated`.
  - Both branches use WHERE-guarded UPDATE; `changes === 0` throws `concurrent_transition` → 409 `CONCURRENT_TRANSITION`.
- Comment markers placed in both branches reserving the emission site for Plan 20-03's `task.blocker_transition` broadcast (per the plan sequencing note).
- 12-case vitest route-handler file covers happy-path pause, every missing-field 400 permutation, invalid-kind Zod 400, recipe 409 redirect, happy-path resume, non-paused fallthrough, retry/fail preservation (COMPAT-03 sanity), gate-required preserved, and concurrent-transition 409.
- All 12 tests pass; existing `status-gate-block.test.ts` (9 tests), `task-dispatch-requeue.test.ts` (7), `task-dispatch-dispatch.test.ts` (4) continue to pass — no regression.

## Task Commits

Each task was committed atomically on branch `worktree-agent-af0b9256` (no-verify per parallel worktree protocol):

1. **Task 1: Extend updateTaskSchema with optional blocker envelope fields** — `3232016` (feat)
2. **Task 2: PUT handler — legacy pause branch + legacy resume branch, both in db.transaction()** — `6f6d89a` (feat)
3. **Task 3: Route-handler vitest — legacy pause, legacy resume, 400/409 error paths, retry-fail preservation** — `3aa9459` (test)

_Note: STATE.md / ROADMAP.md / REQUIREMENTS.md updates are owned by the phase orchestrator after the wave merges._

## Files Created/Modified

- `src/lib/validation.ts` — Added `BLOCKER_KINDS` constant + `BlockerKind` type; extended `updateTaskSchema` via `.extend({ blocker_reason, blocker_kind, resume_hint })` (all optional). `createTaskSchema` untouched.
- `src/app/api/tasks/[id]/route.ts` — Added a ~165-line blocker branch inside the `if (normalizedStatus !== undefined)` block, AFTER the gate-required + Aegis checks and BEFORE `fieldsToUpdate.push('status = ?')`. Branch short-circuits on pause or resume, falls through for all other `awaiting_owner`/`assigned` transitions.
- `src/app/api/tasks/__tests__/blocker-transition.test.ts` — New 12-case vitest file following the in-memory better-sqlite3 + `runMigrations` pattern from `queue-route.test.ts` and `route-recipe-emission.test.ts`.

## Decisions Made

- **Envelope persisted as JSON in `runner_last_failure_reason`** (not a new column) — follows the plan's zero-migration policy and mirrors the recipe runner's column use, just with a structured JSON payload instead of `blocked:<reason>`.
- **Cross-field "required-when-pausing" check lives in the handler, not the Zod schema** — the schema cannot see DB state (recipe_slug + current status), and the blocker contract is LEGACY-ONLY. A schema-level refine would either reject valid non-blocker PUTs or force callers to carry blocker fields on unrelated PUTs.
- **Short-circuit ownership** — pause/resume branches own the status + column write; they do NOT feed into the generic dynamic `fieldsToUpdate` path. Other fields sent alongside the pause (e.g., `description`) are intentionally ignored in this branch, matching the CONTEXT.md-deferred-items allowance.
- **Resume branch guarded with `!isRecipe`** — recipe-tagged tasks with `awaiting_owner` → `assigned` fall through to the generic write path (unchanged behavior). Only legacy resumes clear the envelope via this branch.
- **`task.updated` mirrored on each blocker branch return** — keeps back-compat with every current subscriber of the PUT handler's existing `eventBus.broadcast('task.updated', parsedTask)` at line 695; the new `task.status_changed { reason: 'blocker_*_legacy' }` is additive.
- **Concurrent-transition test uses a prepare-spy to intercept the handler's initial `SELECT * FROM tasks`** so the pause branch enters with a stale `in_progress` snapshot while the WHERE-guarded UPDATE sees the raced on-disk `failed` status. This is the cleanest single-threaded simulation of a scheduler-wins-the-race scenario and keeps the DB rollback semantics intact (the 'failed' flip is on-disk before the PUT begins).

## Deviations from Plan

None — plan executed exactly as written. All three tasks matched their `<action>` / `<verify>` / `<done>` contracts. The only judgment call was the concurrent-transition test's race simulation strategy: the plan said "pre-flip the row to failed RIGHT BEFORE the PUT invocation" — taken literally that makes `currentTask.status === 'failed'`, causing the pause branch to skip entirely. I implemented the plan's intent (raced concurrent flip caught by the WHERE guard, 409 returned, on-disk row unchanged) via a prepare-spy that keeps `currentTask.status === 'in_progress'` in-memory while the real row is `failed`. Documented in the test comment. This is not a deviation in behavior or scope — the 409 + `CONCURRENT_TRANSITION` + DB-unchanged assertions all pass per the plan.

## Issues Encountered

- **Recipe-tagged test initially failed with 400 instead of 409** — the Phase 13 runtime-context validator checks that the effective `recipe_slug` references an indexed recipe; without seeding the `recipes` row, the PUT short-circuited with `RECIPE_NOT_FOUND` 400 before reaching the new blocker branch. Fixed by adding an `INSERT INTO recipes ('hello-world', ...)` seed at the top of the recipe-409 test (the route-recipe-emission.test.ts pattern).
- **Concurrent-transition test initially failed with DB row reverted to 'in_progress'** — the first simulation approach flipped the row to 'failed' inside the pause branch's transaction closure (via a `stmt.run` spy), which was correctly rolled back when the transaction threw. Reworked to seed the row as 'failed' on-disk and spy only on the handler's initial SELECT to return an in-memory `in_progress` snapshot; this keeps the on-disk state stable across the rollback.

## Verification

- `pnpm typecheck` — passed.
- `pnpm lint src/lib/validation.ts` / `src/app/api/tasks/[id]/route.ts` — 0 errors (pre-existing warnings unrelated to this plan).
- `pnpm vitest run src/app/api/tasks/__tests__/blocker-transition.test.ts` — 12/12 pass.
- `pnpm vitest run src/app/api/tasks/__tests__/status-gate-block.test.ts` — 9/9 pass (gate guard + D-31 lateral motion preserved).
- `pnpm vitest run src/lib/__tests__/task-dispatch-requeue.test.ts src/lib/__tests__/task-dispatch-dispatch.test.ts` — 11/11 pass (COMPAT-03 scheduler paths unchanged).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 20-03 (shared event shape) entry point is pre-wired.** Both pause and resume branches carry explicit comment markers (`// Plan 20-03 will add a third 'task.blocker_transition' broadcast here, after both broadcasts above.`) so the next plan can land the additive broadcast without searching for the emission site.
- **Plan 20-01 (lane-aware routing) is independent of this plan** — they both modify the dispatch surface but touch different files and branches (20-01 edits `autoRouteInboxTasks` in `src/lib/task-dispatch.ts`; this plan edited the PUT handler in `src/app/api/tasks/[id]/route.ts`).
- **Recipe path untouched** — recipe-tagged pause/resume continues to use `POST /api/tasks/:id/checkpoints` and the generic PUT write path respectively; the new branch rejects recipe pauses at the 409 gate.
- **Out-of-scope / deferred** — MCP tool exposure of the blocker envelope (Phase 21), full end-to-end acceptance test (Phase 23 / ACCEPT-01), UI surfacing of blocker_kind.

## Self-Check: PASSED

- [x] `src/lib/validation.ts` — `BLOCKER_KINDS`, `BlockerKind`, extended `updateTaskSchema` present (committed in `3232016`).
- [x] `src/app/api/tasks/[id]/route.ts` — pause + resume branches present with comment markers for Plan 20-03 (committed in `6f6d89a`).
- [x] `src/app/api/tasks/__tests__/blocker-transition.test.ts` — 12 test cases all passing (committed in `3aa9459`).
- [x] Commits `3232016`, `6f6d89a`, `3aa9459` verified in `git log --oneline`.
- [x] Typecheck, lint, related existing tests all green.

---
*Phase: 20-lane-aware-routing-unified-blocker-contract*
*Plan: 20-02*
*Completed: 2026-04-22*
