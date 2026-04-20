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
