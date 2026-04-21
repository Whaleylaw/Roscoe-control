# Phase 15 — Deferred Items Log

Out-of-scope discoveries made during plan execution. Each item is an untouched
working-tree change or untracked file that a future plan (typically the one that
owns it) should pick up.

## From Plan 15-01 execution (2026-04-20)

### Pre-existing uncommitted changes in working tree at plan start

These files had modifications BEFORE Plan 15-01 began and were NOT part of this
plan's `files_modified` manifest. The executor left them untouched per the scope
boundary rule (only auto-fix issues directly caused by the current task).

- **`src/lib/scheduler.ts`** — tick interval reduced from 60s to 30s, new
  `reconcile_runner_heartbeat` task entry added, and updated `tasks.set(...)`
  metadata. Belongs to Plan 15-02 Task 1 per the companion untracked test file
  `src/lib/__tests__/scheduler-reconcile.test.ts` comment header.
- **`src/lib/task-dispatch.ts`** — unknown diff content (not read during 15-01).
  Likely Plan 15-02 reconcileRunnerHeartbeat + SCHED-05 emission points.

### Untracked files already present in working tree

- **`src/lib/__tests__/runner-worktree-resume-marker.test.ts`** — file header
  says "Phase 15 CP-04 resume_marker extension of seedMcDir". Belongs to the
  plan that owns CP-04 (likely 15-04 or 15-05).
- **`src/lib/__tests__/scheduler-reconcile.test.ts`** — file header says "Phase
  15 Plan 15-02 Task 1". Belongs to Plan 15-02.

**Action:** none required from 15-01. The owning plans will either confirm
these match their expected deliverables or rewrite as needed.

## From Plan 15-06 execution (2026-04-20)

### Pre-existing typecheck error (untouched during 15-06)

- **`src/app/api/tasks/[id]/checkpoints/__tests__/route.test.ts:126`** — TS2345
  error: `Argument of type 'RequestInit & { method; headers }' is not assignable
  to parameter of type 'RequestInit | undefined'. Type 'null' is not assignable
  to type 'AbortSignal | undefined'.` This is Plan 15-04's test file (checkpoints
  POST/GET route). The test pre-dates Plan 15-06 and was authored under Plan 15-04
  (Wave 1). Per the scope boundary rule — we only auto-fix issues DIRECTLY caused
  by the current task's changes — the 15-06 executor does NOT touch it. 15-04's
  verifier or a subsequent cleanup pass should resolve this.

### Pre-existing untracked files (outside 15-06 scope)

- **`src/lib/task-checkpoints.ts`** — untracked at plan start. Belongs to Plan
  15-04 (checkpoints POST/GET endpoint implementation). Left untouched.
- **`src/app/api/tasks/[id]/checkpoints/` directory** — untracked at plan start.
  Contains Plan 15-04's POST/GET route + tests. Left untouched.

### Pre-existing failing test (outside 15-06 scope)

- **`src/lib/__tests__/runner-tokens.test.ts:194`** — asserts
  `RUNNER_TOKEN_ALLOWLIST.length === 6`, but Plan 15-01 intentionally added a
  7th entry for POST `/api/tasks/:id/checkpoints` (commit e0e30e8 per 15-01
  SUMMARY). The 15-01 SUMMARY's 20 new tests in
  `runner-tokens-allowlist.test.ts` correctly assert length === 7; this legacy
  `runner-tokens.test.ts` assertion was left untouched and now fails. Belongs
  to Plan 15-01 cleanup or a phase-wide test refactor.

## From Plan 15-04 execution (2026-04-20)

### Pre-existing failing test confirmed (still not fixed)

- **`src/lib/__tests__/runner-tokens.test.ts:194`** — same failure as logged
  under 15-06 above. Plan 15-04 does NOT own the runner-tokens allowlist
  module; per the scope boundary rule we re-confirmed the failure exists on
  a clean checkout (`git stash; pnpm test src/lib/__tests__/runner-tokens.test.ts`
  → 1 failed) BEFORE starting 15-04 and left it untouched.
- Impact on 15-04: `pnpm test --run` full-suite reports 1 failed / 2208
  passed / 44 todo. All 56 new 15-04 tests (31 helper + 25 route) pass.
  `pnpm typecheck` exits 0.

## From Plan 15-07 execution (2026-04-20)

### Pre-existing failing test confirmed (still not fixed)

- **`src/lib/__tests__/runner-tokens.test.ts:194`** — same failure as logged
  under 15-04 / 15-06 above. Plan 15-07 is integration-tests-only (no
  production code modifications per plan frontmatter) and does NOT own the
  runner-tokens allowlist module. Per the scope boundary rule we re-confirmed
  the failure exists on a clean checkout before committing the three
  integration files.
- Impact on 15-07: `pnpm test --run` full-suite reports 1 failed / 2245
  passed / 44 todo — same shape as 15-04/15-06 full-suite reports. All 18
  new 15-07 tests (9 checkpoint POST+GET + 8 scheduler orchestration + 1
  blocker→resume end-to-end) pass. `pnpm typecheck` exits 0.
