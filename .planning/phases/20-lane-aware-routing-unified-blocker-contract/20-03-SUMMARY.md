---
phase: 20-lane-aware-routing-unified-blocker-contract
plan: 03
subsystem: api-events
tags: [blocker, event-bus, task-blocker-transition, recipe-path, legacy-path, ROUTE-02, COMPAT-02, COMPAT-03]

# Dependency graph
requires:
  - phase: 15-recipe-runner-daemon-and-blocker-flow
    provides: "recipe checkpoint blocker flow (task.status_changed + task.checkpoint_added) — this plan appends a third broadcast after that pair"
  - phase: 20-lane-aware-routing-unified-blocker-contract
    plan: 02
    provides: "legacy pause/resume PUT branches with Plan 20-03 comment markers reserving the emission site; this plan replaces those markers with the broadcast"
provides:
  - "task.blocker_transition EventType literal on EventType union (src/lib/event-bus.ts)"
  - "Recipe pause broadcast at src/app/api/tasks/[id]/checkpoints/route.ts — source='recipe', direction='paused', attempt=runner_attempts, blocker_kind/resume_hint=null"
  - "Legacy pause broadcast at src/app/api/tasks/[id]/route.ts pause branch — source='legacy', direction='paused', full envelope (blocker_reason/blocker_kind/resume_hint), attempt=null"
  - "Legacy resume broadcast at src/app/api/tasks/[id]/route.ts resume branch — source='legacy', direction='resumed', priorEnvelope captured BEFORE UPDATE clears runner_last_failure_reason"
  - "Recipe resume broadcast at src/app/api/tasks/[id]/route.ts generic write path — source='recipe', direction='resumed', best-effort reason extraction via 'blocked:' prefix strip"
  - "10-key payload contract (task_id, workspace_id, direction, previous_status, status, blocker_reason, blocker_kind, resume_hint, source, attempt, ts) shared across all four emission sites"
  - "Cross-path integration test at src/lib/__tests__/phase-20-blocker-event-parity.test.ts — 7 cases"
affects: [21 MCP surface expansion, 23 ACCEPT-01 loop, any future UI subscriber for blocker affordances]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive event emission: new broadcast appended AFTER existing task.status_changed / task.updated / task.checkpoint_added calls without modifying or reordering them (backward-compat lock)"
    - "Pre-transaction envelope capture for legacy resume — priorEnvelope parsed from currentTask.runner_last_failure_reason BEFORE the UPDATE clears the column so the event carries pre-clear context"
    - "Best-effort reason extraction for recipe resume — strips `blocked:` prefix when present, falls through for pre-v1.3 free-text values"
    - "10-key payload shape enforced by shared vitest helper (assertBlockerTransitionShape) rather than a typed payload alias — see CONTEXT.md § 'no payload type alias here'"
    - "Cross-path parity test drives real POST + PUT + autoRouteInboxTasks handlers (no mocking of handler bodies) and asserts identical JSON key set across all four sites"

key-files:
  created:
    - src/lib/__tests__/phase-20-blocker-event-parity.test.ts
  modified:
    - src/lib/event-bus.ts
    - src/app/api/tasks/[id]/checkpoints/route.ts
    - src/app/api/tasks/[id]/route.ts
    - src/app/api/tasks/[id]/checkpoints/__tests__/route-blocker.test.ts
    - src/lib/__tests__/phase-15-blocker-flow-integration.test.ts

key-decisions:
  - "No payload type alias in event-bus.ts — EventType union stays literal-only per plan; shape documentation lives in 20-CONTEXT.md and the integration test helper enforces it"
  - "Legacy resume priorEnvelope capture placed on same scope level as the transaction, sourced from currentTask (not a re-SELECT) — currentTask is frozen from the handler's initial SELECT at line 185 and still carries the pre-clear envelope"
  - "Recipe resume column-clear policy — LOCKED option A from CONTEXT.md — this plan intentionally does NOT clear runner_last_failure_reason on recipe resume. The recipe path's blocked:<reason> is self-healing via the next checkpoint POST (see src/app/api/tasks/[id]/checkpoints/route.ts:170-183)"
  - "Four emission sites assembled as four distinct payload objects rather than a helper function — CLAUDE preference follows CONTEXT.md 'readability > DRY for ten-key payloads with path-specific defaults'"
  - "Emission order locked: recipe pause fires task.status_changed → task.checkpoint_added → task.blocker_transition; legacy pause fires task.status_changed → task.updated → task.blocker_transition; legacy resume fires task.status_changed → task.updated → task.blocker_transition; recipe resume fires task.updated → task.blocker_transition (generic write path only emits task.updated today)"

patterns-established:
  - "Cross-path event parity test pattern: real POST + PUT handlers driven with in-memory better-sqlite3 + runMigrations + a shape-assertion helper that enforces the contract with per-call expectation overrides — portable to Phase 21+ if more cross-path contracts emerge"
  - "Additive broadcast convention: when extending an existing emission site, the new event ALWAYS fires AFTER the existing ones, NEVER replaces or reorders them — preserves every current subscriber"
  - "Auth mock case-split: requireRole real-defer for Bearer tokens (runner-token path) + operator principal fallback for session/API-key PUT callers — lets a single test file drive both auth personas"

requirements-completed: [ROUTE-02, COMPAT-02, COMPAT-03]

# Metrics
duration: ~7min
completed: 2026-04-22
---

# Phase 20 Plan 03: Unified Blocker Transition Event Shape Summary

**Unified `task.blocker_transition` event with identical 10-key payload emitted from all four pause/resume paths — recipe checkpoint, legacy PUT pause, legacy PUT resume, recipe resume via generic write — landing additively on top of every existing broadcast and proven by a 7-case cross-path parity test.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-22T02:25:17Z
- **Completed:** 2026-04-22T02:33:12Z
- **Tasks:** 3
- **Files modified:** 4 (event-bus.ts, checkpoints/route.ts, tasks/[id]/route.ts, plus two existing test files updated for additive emission)
- **Files created:** 1 (phase-20-blocker-event-parity.test.ts)

## Accomplishments

- Extended `EventType` union in `src/lib/event-bus.ts` with the `task.blocker_transition` literal (Phase 20 ROUTE-02 discriminator).
- Emitted `task.blocker_transition` from all four sites with the locked 10-key payload:
  - **Site 1 — Recipe pause** (POST `/api/tasks/:id/checkpoints` with `status='blocked'`): appended after the existing `task.status_changed` + `task.checkpoint_added` pair; `source='recipe'`, `direction='paused'`, `attempt=runner_attempts`, `blocker_kind`/`resume_hint=null`, `blocker_reason=trimmed body.blocker_reason`.
  - **Site 2 — Legacy pause** (PUT `/api/tasks/:id` with `status='awaiting_owner'` + envelope): replaced Plan 20-02's Plan 20-03 comment marker; `source='legacy'`, full envelope, `attempt=null`.
  - **Site 3 — Legacy resume** (PUT `/api/tasks/:id` with `status='assigned'` from `awaiting_owner`, non-recipe): captures `priorEnvelope` from `currentTask.runner_last_failure_reason` BEFORE the transaction's UPDATE clears the column; `source='legacy'`, `direction='resumed'`, pre-clear envelope context.
  - **Site 4 — Recipe resume** (PUT `/api/tasks/:id` generic write path, `awaiting_owner → assigned` on a recipe-tagged task): `source='recipe'`, `direction='resumed'`, `attempt=runner_attempts`, best-effort `blocker_reason` via `blocked:` prefix strip.
- Created `src/lib/__tests__/phase-20-blocker-event-parity.test.ts` — 7 cases covering each site individually, identical-key-set assertion across all four, zero-emission on non-blocker PUTs + scheduler fails, and COMPAT-02 recipe fast-path sanity.
- Updated two existing tests (`src/lib/__tests__/phase-15-blocker-flow-integration.test.ts`, `src/app/api/tasks/[id]/checkpoints/__tests__/route-blocker.test.ts`) so their exact-broadcast-sequence assertions accommodate the new additive emission. Byte-for-byte equality on the pre-existing two broadcasts is preserved; the third broadcast is appended at the end, matching the locked emission order from the plan.
- All 39 tests across 5 related test files pass: 7 new parity + 12 blocker-transition + 13 autoroute + 1 phase-15 integration + 6 route-blocker. COMPAT-03 sanity tests (20 across dispatch-requeue, dispatch-dispatch, status-gate-block) continue to pass.

## Task Commits

Each task was committed atomically on branch `worktree-agent-ae03bf17` (no-verify per parallel worktree protocol):

1. **Task 1: Extend EventType union with task.blocker_transition** — `5d72876` (feat)
2. **Task 2: Emit task.blocker_transition from all four pause/resume sites** — `1d02c20` (feat)
3. **Task 3: Cross-path integration test proving identical event shape** — `3003d11` (test)

_Note: STATE.md / ROADMAP.md / REQUIREMENTS.md updates are owned by the phase orchestrator after the wave merges._

## Files Created/Modified

- `src/lib/event-bus.ts` — Added `'task.blocker_transition'` to the `EventType` union, immediately after `gsd.plan.tasks_activated` with the Phase 20 ROUTE-02 inline comment.
- `src/app/api/tasks/[id]/checkpoints/route.ts` — Appended the `task.blocker_transition` broadcast AFTER the existing `task.status_changed` + `task.checkpoint_added` pair; gated on `body.status === 'blocked'`; uses `body.blocker_reason!.trim()` and `inserted.nowUnix`.
- `src/app/api/tasks/[id]/route.ts` — Three edits:
  - Pause branch (around line 540): replaced Plan 20-02's Plan 20-03 comment marker with the legacy pause broadcast (full envelope, `source='legacy'`, `attempt=null`).
  - Resume branch (around line 590): inserted `priorEnvelope` capture block BEFORE the `runResume()` transaction; replaced the Plan 20-03 comment marker with the legacy resume broadcast carrying the pre-clear envelope context.
  - Generic write path (around line 928): added recipe resume detection immediately after the existing `eventBus.broadcast('task.updated', parsedTask)`; gated on `currentTask.status === 'awaiting_owner' && normalizedStatus === 'assigned' && recipe_slug != null`.
- `src/lib/__tests__/phase-20-blocker-event-parity.test.ts` — NEW 7-case vitest file with `assertBlockerTransitionShape` helper, `findBlockerEvents` filter, real POST + PUT + autoRouteInboxTasks handler drives, and a case-split auth mock that defers to real runner-token auth for Bearer requests and synthesizes an operator principal otherwise.
- `src/app/api/tasks/[id]/checkpoints/__tests__/route-blocker.test.ts` — Updated one assertion: `toHaveBeenCalledTimes(2)` → `toHaveBeenCalledTimes(3)`; added shape check on the new `task.blocker_transition` broadcast (Rule 1 auto-fix — additive emission required accommodating the pre-existing exact count).
- `src/lib/__tests__/phase-15-blocker-flow-integration.test.ts` — Updated the `types` equality from `['task.status_changed', 'task.checkpoint_added']` to append `'task.blocker_transition'` (Rule 1 auto-fix for additive emission).

## Decisions Made

- **No payload type alias in event-bus.ts** — EventType union stays literal-only per the plan's explicit AVOID. Shape documentation lives in 20-CONTEXT.md and is enforced by the integration test helper. Phase 21+ can normalize into a typed payload map if/when consumer typing becomes painful.
- **Legacy resume priorEnvelope capture sourced from currentTask**, not a re-SELECT — currentTask is frozen from the handler's initial SELECT at line 185 and carries the pre-clear envelope. Re-selecting after the transaction would return NULL because the UPDATE wipes the column.
- **Recipe resume column-clear policy — LOCKED option A** — this plan does NOT clear `runner_last_failure_reason` on recipe resume. The recipe path's `blocked:<reason>` is self-healing via the next blocker checkpoint POST. A stale value between resume and next blocker cycle is acceptable; observers that care about "is this task currently blocked" check `status`, not the column.
- **Four distinct payload objects rather than a helper function** — follows the plan's AVOID ("the path-specific defaults differ enough that a helper adds noise"). Phase 22 doc/tech-debt can extract a helper if one is warranted.
- **Updated existing exact-count assertions** — when the additive emission broke pre-existing `toHaveBeenCalledTimes(2)` and `toEqual([...two entries...])` assertions in phase-15-blocker-flow-integration and route-blocker tests, I updated them in place rather than loosening the assertions to matcher-style. The plan's intent is that the existing two broadcasts remain byte-identical and the third is purely additive — the updated assertions preserve that contract explicitly by listing all three in order.
- **Auth mock case-split in the parity test** — POST (runner-token Bearer) and PUT (operator session) share a test file, so the mock defers to `actual.requireRole` when a Bearer header is present and synthesizes an operator principal otherwise. Cleaner than two separate test files and matches the plan's "both recipe + legacy in one file" structure.

## Deviations from Plan

**Auto-fixed issues (Rule 1 — additive-change assertion updates):**

1. **[Rule 1 — Pre-existing test assertion updated]** `src/lib/__tests__/phase-15-blocker-flow-integration.test.ts:259` asserted the exact broadcast type sequence via `toEqual(['task.status_changed', 'task.checkpoint_added'])`. Our additive emission adds a third type. Updated the expected array to include `'task.blocker_transition'` at the end, preserving the pre-existing order lock.
   - **Commit:** `1d02c20`.

2. **[Rule 1 — Pre-existing test assertion updated]** `src/app/api/tasks/[id]/checkpoints/__tests__/route-blocker.test.ts:218` asserted `toHaveBeenCalledTimes(2)`. Updated to `3` and added shape coverage for the new broadcast.
   - **Commit:** `1d02c20`.

No other deviations — plan executed exactly as written. The four emission sites landed at the exact locations the plan specified (line 256 of checkpoints/route.ts post-existing broadcast; lines 540 and 590 of tasks/[id]/route.ts where Plan 20-02 left comment markers; line 928 immediately after the generic `task.updated` broadcast for recipe resume).

## Issues Encountered

- **Two existing tests had exact-count/exact-sequence assertions.** The plan's verification block explicitly required both tests to continue passing. Resolved by updating the assertions (not loosening them) to include the new additive broadcast — the updated assertions still prove byte-for-byte equality of the pre-existing broadcasts and add a shape check for the new one.
- **TypeScript `any`-property reads from `currentTask`.** `currentTask` is typed as `Task` from `@/lib/db` which doesn't expose `recipe_slug` / `runner_last_failure_reason` / `runner_attempts` as strictly-typed fields on the base type. Followed the pattern already used at line 456 of the same file: `(currentTask as unknown as { recipe_slug: string | null }).recipe_slug`. Phase 21+ cleanup could expand the `Task` base type to surface these fields without casts.

## Verification

- `pnpm typecheck` — passed (exit 0).
- `pnpm lint src/app/api/tasks/[id]/checkpoints/route.ts src/app/api/tasks/[id]/route.ts` — 0 errors (12 pre-existing repo warnings unrelated to this plan).
- `pnpm vitest run src/lib/__tests__/phase-20-blocker-event-parity.test.ts` — 7/7 pass.
- `pnpm vitest run src/app/api/tasks/__tests__/blocker-transition.test.ts` — 12/12 pass (Plan 20-02 regression check).
- `pnpm vitest run src/lib/__tests__/phase-15-blocker-flow-integration.test.ts` — 1/1 pass (updated for additive emission).
- `pnpm vitest run src/app/api/tasks/[id]/checkpoints/__tests__/route-blocker.test.ts` — 6/6 pass (updated for additive emission).
- `pnpm vitest run src/lib/__tests__/task-dispatch-autoroute.test.ts` — 13/13 pass (COMPAT-02 lock).
- `pnpm vitest run src/lib/__tests__/task-dispatch-requeue.test.ts src/lib/__tests__/task-dispatch-dispatch.test.ts src/app/api/tasks/__tests__/status-gate-block.test.ts` — 20/20 pass (COMPAT-03 sanity).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 20-02 and 20-03 together complete Phase 20's blocker-contract scope.** Both the structured legacy pause/resume PUT contract (20-02) and the unified cross-path event (20-03) are in place. Plan 20-01's lane-aware routing is independent and was landed in Wave 1.
- **Phase 21 (MCP-01..03)** can surface the blocker envelope on the MCP tool layer — PUT handler already accepts the three fields; MCP just needs to pass them through. The event is stable and Phase 21 can subscribe without further contract changes.
- **Phase 23 (ACCEPT-01) end-to-end acceptance test** has everything it needs to assert both paths emit the shared event on pause and resume across the full `lifecycle → activation → claim → pause → resume` loop.
- **Out-of-scope / deferred:** Typed payload map in event-bus.ts (Phase 21+ if needed), UI surfacing of the new event (Phase 22 / dashboard panels), column rename of `runner_last_failure_reason` to a more blocker-specific name (deferred per CONTEXT.md).

## Self-Check: PASSED

- [x] `src/lib/event-bus.ts` — contains `'task.blocker_transition'` literal (verified in file; commit `5d72876`).
- [x] `src/app/api/tasks/[id]/checkpoints/route.ts` — appended broadcast in the blocker branch (verified after existing pair; commit `1d02c20`).
- [x] `src/app/api/tasks/[id]/route.ts` — broadcasts on pause, legacy resume, and recipe resume (verified at three sites; commit `1d02c20`).
- [x] `src/lib/__tests__/phase-20-blocker-event-parity.test.ts` — 7 passing cases (verified; commit `3003d11`).
- [x] Commits `5d72876`, `1d02c20`, `3003d11` verified in `git log --oneline`.
- [x] `pnpm typecheck` exits 0 — verified.
- [x] All related tests pass (39 new + pre-existing; 20 COMPAT-03 sanity) — verified.

---
*Phase: 20-lane-aware-routing-unified-blocker-contract*
*Plan: 20-03*
*Completed: 2026-04-22*
