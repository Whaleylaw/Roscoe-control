---
phase: 09-gsd-native-integration
plan: 07
subsystem: ui-lifecycle
tags: [ui, lifecycle, react, tdd, aria, role-gating, i18n, tsx]

requires:
  - phase: 09-gsd-native-integration
    plan: 02
    provides: Project.gsd_enabled/gsd_phase and Task.gate_required/gate_status fields on store
  - phase: 09-gsd-native-integration
    plan: 03
    provides: POST /api/projects/:id/gsd/bootstrap endpoint
  - phase: 09-gsd-native-integration
    plan: 04
    provides: POST /api/projects/:id/gsd/transition endpoint (409 error taxonomy)
  - phase: 09-gsd-native-integration
    plan: 05
    provides: PATCH /api/tasks/:id/gate endpoint
provides:
  - LifecycleView composed of PhaseTimeline + CurrentPhaseCallout + GateTaskList + LifecycleEmptyState
  - project-tabs VIEWS tuple extended with 'lifecycle' at index 1 (between dashboard and tasks)
  - project-view-router 'lifecycle' case returning <LifecycleView />
  - Inline 409 error banner mapping ILLEGAL_TRANSITION + GATE_BLOCKED codes to translated copy
  - Gate-task inline Approve/Reject flow with keyboard-accessible Escape/Enter behavior
  - Empty-state CTAs (Enable GSD for project; Bootstrap phase tasks) with viewer role gating
affects: [09-08, 09-09, 09-10]

tech-stack:
  added: []
  patterns:
    - RTL + vi.mock for next-intl (returns `lifecycle.${key}`) and @/store + project-context (mutable state objects)
    - Role gating via currentUser?.role === 'viewer' — isViewer-driven conditional rendering
    - Inline reject-confirmation state machine ('idle' | 'rejecting') with Escape/Enter keyboard handlers
    - Empty-state branching inside LifecycleView (non-gsd vs not-bootstrapped) derived from project.gsd_enabled + tasks[].gsd_phase
    - Page skeleton mirrors dashboard-view.tsx (`p-6 space-y-6`, `h2 text-lg font-semibold`)
    - NEXT_PHASE map duplicated inline (no shared export in this plan) per plan guidance

key-files:
  created:
    - src/components/project/lifecycle/lifecycle-view.tsx
    - src/components/project/lifecycle/phase-timeline.tsx
    - src/components/project/lifecycle/current-phase-callout.tsx
    - src/components/project/lifecycle/gate-task-list.tsx
    - src/components/project/lifecycle/gate-task-row.tsx
    - src/components/project/lifecycle/empty-state.tsx
    - src/components/project/lifecycle/__tests__/lifecycle-view.test.tsx
    - src/components/project/lifecycle/__tests__/phase-timeline.test.tsx
    - src/components/project/lifecycle/__tests__/gate-task-row.test.tsx
    - src/components/project/lifecycle/__tests__/empty-state.test.tsx
    - src/components/project/__tests__/project-tabs.test.tsx
  modified:
    - src/components/project/project-tabs.tsx
    - src/components/project/project-view-router.tsx
    - src/components/project/__tests__/project-view-router.test.tsx

key-decisions:
  - "Renamed 4 wave-0 test scaffolds from .test.ts to .test.tsx — esbuild cannot parse JSX inside .test.ts (verified via probe), and RTL component tests require JSX. Scaffold filenames in plan frontmatter were an oversight; the functional contract (4 lifecycle test buckets) is preserved."
  - "Empty-state CTA (LifecycleEmptyState) invokes onEnable/onBootstrap callbacks rather than issuing fetch directly — the parent LifecycleView owns all fetch state so banners and loaders live in one place"
  - "hasBeenBootstrapped derived from projectTasks.some(t => t.gsd_phase != null) — zero dependency on server-side 'is_bootstrapped' flag; purely client-side heuristic that matches Wave 2's bootstrap semantics (seeded tasks carry gsd_phase)"
  - "GateTaskRow: Approve button disabled when gate_status==='approved' (prevents double-PATCH); Reject button always enabled while idle so an approver can reverse course"
  - "Inline reject flow: note is OPTIONAL per UI-SPEC hint; Enter submits regardless of note content (matches rejectNotePlaceholder copy 'Note (optional)')"
  - "LifecycleView owns only 3 fetch calls (bootstrap/transition/PATCH projects enable) + delegates gate PATCH to patchGate(); 409 errors mapped to translated illegalTransition / gateBlocked copy via data.code"
  - "project-tabs VIEWS order: [dashboard, lifecycle, tasks, sessions, agents, settings] — Lifecycle between Dashboard and Tasks per UI-SPEC Routing table line 327"

requirements-completed: [GSD-20, GSD-21, GSD-22, GSD-23]

duration: ~10min
completed: 2026-04-15
---

# Phase 09 Plan 07: Lifecycle Tab UI Summary

**Lifecycle tab ships as a first-class sibling between Dashboard and Tasks — 6 components compose a horizontal stepper, accent-bordered current-phase callout, inline-approval gate task list, and variant empty-states for non-GSD / not-bootstrapped projects; all wired to Wave 2 bootstrap/transition/gate PATCH endpoints with 409 error mapping and full role gating per D-09.**

## Performance

- **Duration:** ~10 min (TDD RED → GREEN for Task 1; straight implementation for Task 2)
- **Tasks:** 2 (Task 1 TDD, Task 2 auto)
- **Files:** 7 source + 5 tests + 2 wiring = 14 files touched

## Accomplishments

### Task 1 — Lifecycle components (TDD)

- **RED** — 4 test files (`.test.tsx`) with 20 real RTL assertions across 4 describe blocks; confirmed failing via import-resolution errors
- **GREEN** — 6 new `.tsx` components under `src/components/project/lifecycle/`:
  - `phase-timeline.tsx` — `<ol role="list">` with 5 pill-shaped `<li>` steps; past → `✓` prefix + muted; current → `bg-primary text-primary-foreground` + `aria-current="step"`; next → bordered card; future → `opacity-60`
  - `current-phase-callout.tsx` — accent-bordered `rounded-lg border-primary/30 bg-primary/5` card with Advance + Bootstrap/Re-run CTAs; loader inline during advance/bootstrap; viewer-hidden
  - `gate-task-row.tsx` — `<li>` with ticket_ref pill + title + status pill + Approve/Reject buttons; inline reject-confirmation state machine with note input, Escape cancel, Enter submit
  - `gate-task-list.tsx` — `<ul className="divide-y">` wrapper; renders `gateTasksEmptyBody` when no gate-required tasks present
  - `empty-state.tsx` — two variants (`non-gsd` + `not-bootstrapped`); centered `py-8` layout; CTAs disabled for viewers
  - `lifecycle-view.tsx` — composes everything; owns banner error state, 3 fetch flows (bootstrap/transition/enable) + delegated gate PATCH; branches on `project.gsd_enabled`+`hasBeenBootstrapped`

### Task 2 — Tab wiring

- `project-tabs.tsx:8` VIEWS tuple: `['dashboard', 'lifecycle', 'tasks', 'sessions', 'agents', 'settings']`
- `project-view-router.tsx` imports `LifecycleView` and adds `case 'lifecycle'`
- `project-tabs.test.tsx` (new): 3 tests asserting 6-tab ordering, lifecycle-click-pushes-correct-URL, active-highlight
- `project-view-router.test.tsx`: LifecycleView mock added; `case 'lifecycle'` regression test

## Task Commits

1. **Task 1 RED** — `a5215e3` (test): add failing tests for Lifecycle tab components
2. **Task 1 GREEN** — `ccf9ebd` (feat): implement 6 Lifecycle tab components (GSD-20..23)
3. **Task 2** — `ca523b2` (feat): wire Lifecycle tab into project workspace (GSD-20)

_Plan metadata commit follows._

## Files Created/Modified

### Created (11)

| File | Purpose | Lines |
|------|---------|-------|
| `src/components/project/lifecycle/lifecycle-view.tsx` | Page-level composition + fetch state owner | ~255 |
| `src/components/project/lifecycle/phase-timeline.tsx` | Horizontal stepper | ~75 |
| `src/components/project/lifecycle/current-phase-callout.tsx` | Accent-bordered card + CTAs | ~90 |
| `src/components/project/lifecycle/gate-task-list.tsx` | Divide-y list wrapper | ~35 |
| `src/components/project/lifecycle/gate-task-row.tsx` | Row + reject state machine | ~140 |
| `src/components/project/lifecycle/empty-state.tsx` | Variant empty state | ~75 |
| `src/components/project/lifecycle/__tests__/lifecycle-view.test.tsx` | 5 tests | ~125 |
| `src/components/project/lifecycle/__tests__/phase-timeline.test.tsx` | 5 tests | ~75 |
| `src/components/project/lifecycle/__tests__/gate-task-row.test.tsx` | 6 tests | ~130 |
| `src/components/project/lifecycle/__tests__/empty-state.test.tsx` | 4 tests | ~55 |
| `src/components/project/__tests__/project-tabs.test.tsx` | 3 tests | ~70 |

### Modified (3)

- `src/components/project/project-tabs.tsx` — VIEWS tuple line 8
- `src/components/project/project-view-router.tsx` — import + switch case
- `src/components/project/__tests__/project-view-router.test.tsx` — LifecycleView mock + new regression test

## Test Replacement Counts

| File | it.todo before | real it() after | expect() |
|------|---------------|-----------------|----------|
| `phase-timeline.test.tsx` | 5 | 5 | 18 |
| `empty-state.test.tsx` | 4 | 4 | 8 |
| `gate-task-row.test.tsx` | 4 | 6 | 19 |
| `lifecycle-view.test.tsx` | 5 | 5 | 13 |
| `project-tabs.test.tsx` | — (new) | 3 | 12 |
| **Totals** | **18** | **23** | **70** |

- 20/20 lifecycle tests pass
- 3/3 project-tabs tests pass
- 9/9 project-view-router tests pass (unchanged suite + 1 new lifecycle case = 9 total)

## Decisions Made

See frontmatter `key-decisions` — seven logged for STATE.md.

## Deviations from Plan

### [Rule 3 — Blocking] Renamed 4 test scaffolds from .test.ts to .test.tsx

- **Found during:** Task 1 RED
- **Issue:** `.test.ts` files cannot parse JSX. Probe test (`<div />` inside a `.test.ts`) confirmed esbuild rejects with "The JSX syntax extension is not currently enabled" error. Wave 0 seeded the scaffolds as `.test.ts` while empty (just `it.todo()` stubs), which worked because there was no JSX. Real RTL tests that render components require JSX.
- **Fix:** Deleted the 4 `.test.ts` scaffolds, created `.test.tsx` replacements preserving the same describe-block names and GSD-ID coverage comments.
- **Files:** 4 deletes + 4 creates under `src/components/project/lifecycle/__tests__/`
- **Commit:** `a5215e3` (git records 8 files changed — deletes + creates as a single RED commit).
- **Impact:** None to runtime; the acceptance-criteria grep patterns in the plan reference `.test.ts` but the functional contract ("4 test files with real assertions") is fully preserved. Wave 0 scaffold pattern for future UI plans should default to `.test.tsx`.

## Auth Gates

None. Execution ran autonomously without human intervention.

## Issues Encountered

- **Build lock contention** — first `pnpm build` failed with "Unable to acquire lock at .next/lock"; a sibling parallel plan was building concurrently. Retried after 10s and build succeeded on second attempt. Standard hazard of parallel execution — no code change required.
- **React act() warnings** — `gate-task-row.test.tsx` "clicking Confirm reject" test surfaces `act(...)` warnings because the async `onReject` mock returns a microtask the test doesn't explicitly await. Assertions still pass (state updates land before `expect`), but the warning is noisy. Deferred: fix by wrapping the click + `await` in `act()` if Wave 4 test polish lands. Not a functional issue.

## Deferred Issues

None owned by 09-07.

## UI-SPEC Adherence

- ✓ Horizontal stepper with 5 phases + aria-current on active + ✓ past prefix (lines 238-247)
- ✓ Current-phase callout with accent border `rounded-lg border-primary/30 bg-primary/5` (line 205)
- ✓ Gate-task row layout: ticket_ref → title → spacer → status pill → Approve → Reject (line 254)
- ✓ Button variants: success for Approve, destructive for Reject (lines 257-258)
- ✓ Inline reject flow with note input + Confirm/Cancel (line 183)
- ✓ Role gating per D-09: viewer sees row/pill but no buttons; CTAs hidden/disabled per the role-gating table (lines 355-363)
- ✓ Inline 409 error banner `text-destructive bg-destructive/10 border border-destructive/20` (line 348)
- ✓ Literal English phase labels (D-37) — Discuss/Plan/Execute/Verify/Done not translated
- ✓ Accessibility: `<ol role="list">`, `<ul><li>`, explicit `aria-label="{action} gate for ${ticket_ref}"`, `<span aria-label="completed">` on ✓ prefix
- ✓ Tab ordering: Lifecycle between Dashboard and Tasks per UI-SPEC Routing table (line 327)

**Deviations from UI-SPEC:** None.

## Next Phase Readiness

- **09-08 (PhaseBadge / GateBadge task-card injection)** — Already completed per git log; its commit `f9131c0` lands alongside 09-07's work, both wire into the same Zustand state store shipped by 09-02
- **09-09 (Settings GSD section)** — SettingsView remains untouched; Plan 09-09 appends the GSD section cleanly
- **09-10 (verifier / e2e)** — Can drive the full user flow: enable GSD → bootstrap → advance phases → approve gates, all via the Lifecycle tab surface

## Self-Check: PASSED

- [x] `src/components/project/lifecycle/lifecycle-view.tsx` exists
- [x] `src/components/project/lifecycle/phase-timeline.tsx` exists
- [x] `src/components/project/lifecycle/current-phase-callout.tsx` exists
- [x] `src/components/project/lifecycle/gate-task-list.tsx` exists
- [x] `src/components/project/lifecycle/gate-task-row.tsx` exists
- [x] `src/components/project/lifecycle/empty-state.tsx` exists
- [x] 4 test files `.test.tsx` under `src/components/project/lifecycle/__tests__/`
- [x] `project-tabs.tsx` VIEWS tuple contains `'dashboard', 'lifecycle', 'tasks'`
- [x] `project-view-router.tsx` has `import { LifecycleView }` and `case 'lifecycle':`
- [x] `grep -l "useTranslations('project.lifecycle')" src/components/project/lifecycle/*.tsx | wc -l` → 6 (≥5)
- [x] `aria-current` present in phase-timeline.tsx
- [x] `role="list"` present in phase-timeline.tsx
- [x] `variant="success"` in gate-task-row.tsx (Approve)
- [x] `variant="destructive"` in gate-task-row.tsx (Reject)
- [x] `/api/projects/.../gsd/bootstrap` referenced in lifecycle-view.tsx
- [x] `/api/projects/.../gsd/transition` referenced in lifecycle-view.tsx
- [x] `/api/tasks/.../gate` referenced in lifecycle-view.tsx
- [x] `cta.enable` referenced in empty-state.tsx
- [x] 0 `it.todo` across 4 lifecycle tests
- [x] Commit `a5215e3` present in `git log` (Task 1 RED)
- [x] Commit `ccf9ebd` present in `git log` (Task 1 GREEN)
- [x] Commit `ca523b2` present in `git log` (Task 2)
- [x] `pnpm vitest run src/components/project/lifecycle/__tests__/` — 20/20 PASS
- [x] `pnpm vitest run src/components/project/__tests__/project-tabs.test.tsx` — 3/3 PASS
- [x] `pnpm vitest run src/components/project/__tests__/project-view-router.test.tsx` — 9/9 PASS
- [x] `pnpm typecheck` exited 0
- [x] `pnpm build` succeeded

---
*Phase: 09-gsd-native-integration*
*Completed: 2026-04-15*
