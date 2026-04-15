---
phase: 09-gsd-native-integration
plan: 08
subsystem: ui
tags: [ui, task-card, badges, phase, gate, next-intl, wave-3c]

requires:
  - phase: 09-gsd-native-integration
    plan: 01
    provides: messages/*.json project.lifecycle.gate.{statusApproved,statusRequired} + scaffolds in src/components/panels/task-card/__tests__/
  - phase: 09-gsd-native-integration
    plan: 02
    provides: store Task type + in-file task-board Task type with gsd_phase, gate_required, gate_status (Wave 2a)
  - phase: 09-gsd-native-integration
    plan: 05
    provides: gate_status lifecycle on tasks (approved vs pending/rejected/not_required) + task GET SELECT t.* lock
provides:
  - <PhaseBadge /> — src/components/panels/task-card/phase-badge.tsx
  - <GateBadge /> — src/components/panels/task-card/gate-badge.tsx
  - Task-board cards and detail modal render phase + gate badges when task.gsd_phase / task.gate_required are set (conditional, zero-DOM for non-GSD tasks)
affects: [09-10, 09-11]

tech-stack:
  added: []
  patterns:
    - Badge visual parity pattern — new GSD badges reuse the verbatim ticket_ref badge geometry (text-[10px] px-1.5 py-0.5 rounded font-mono) so the metadata row reads as one visual family
    - Atomic-i18n-unit pattern — emoji prefixes ("🔒", "✓") live inside translated message values (project.lifecycle.gate.statusRequired/Approved) rather than as separate adjacent spans; survives i18n extraction as one string per UI-SPEC
    - Null-render pattern — both badges return null when their gating prop is unset; non-GSD tasks emit zero extra DOM (D-22 invariant)
    - Test pattern — RTL + NextIntlClientProvider with imported messages/en.json (no next-intl mock) so real translation resolution is exercised; establishes first use of this pattern in the repo

key-files:
  created:
    - src/components/panels/task-card/phase-badge.tsx
    - src/components/panels/task-card/gate-badge.tsx
    - src/components/panels/task-card/__tests__/phase-badge.test.tsx
    - src/components/panels/task-card/__tests__/gate-badge.test.tsx
  modified:
    - src/components/panels/task-board-panel.tsx
    - .planning/phases/09-gsd-native-integration/deferred-items.md
  deleted:
    - src/components/panels/task-card/__tests__/phase-badge.test.ts (renamed to .test.tsx)
    - src/components/panels/task-card/__tests__/gate-badge.test.ts (renamed to .test.tsx)

key-decisions:
  - "Task-card badge test files renamed .test.ts → .test.tsx to enable JSX syntax for NextIntlClientProvider — the TS overload for <NextIntlClientProvider messages locale> requires children as a JSX child (not a createElement arg), so JSX was the cleanest fix. Vitest include globs already accept both extensions."
  - "Injected both PhaseBadge and GateBadge into TWO locations in task-board-panel.tsx — regular card (line 1052) AND task detail modal header (line 1485) — per plan pitfall 'keep read paths in sync'. Grep for <PhaseBadge task={task} / returns 2 occurrences, matching acceptance criterion."
  - "Extended the in-file task-board Task interface with the five GSD fields (gsd_phase, gate_required, gate_status, gate_approved_by, gate_approved_at) mirroring the Zustand store Task type from Wave 2a — in-file type had diverged and TypeScript needed the fields to typecheck the badge props at the insertion sites."
  - "GateBadge two-branch render: gate_status='approved' → green, anything else → amber. Pending / rejected / not_required all render the same 'Approval required' visual because gate_required=1 + non-approved always means 'blocked on approval' semantically (pending waiting, rejected reset by operator, not_required transient pre-gate state). Only approved earns the affirmative green state."
  - "Phase value rendered literal English per D-37 (gsd_phase.toUpperCase() → DISCUSS/PLAN/EXECUTE/VERIFY/DONE); only the surrounding gate copy goes through next-intl. Establishes untranslated-brand-token pattern for phase names across all 10 locales."

requirements-completed: [GSD-24, GSD-25]

duration: ~5min
completed: 2026-04-15
---

# Phase 09 Plan 08: Task-Card Phase + Gate Badges Summary

**Two atomic badge components ship on the task board — phase name (primary pill, literal English per D-37) and gate status (green/amber with emoji prefix inside the translated string) — with visual parity to the existing ticket_ref badge and zero DOM impact on non-GSD tasks.**

## Performance

- **Duration:** ~5 min
- **Tasks:** 2
- **Files created:** 4 (2 components, 2 .tsx tests)
- **Files modified:** 2 (task-board-panel.tsx injection site ×2, deferred-items log)
- **Files deleted:** 2 (original .test.ts scaffolds, superseded by .test.tsx)

## Accomplishments

- **PhaseBadge (`src/components/panels/task-card/phase-badge.tsx`)** — renders `<span>{task.gsd_phase.toUpperCase()}</span>` with `text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono` classes; returns `null` when `gsd_phase` is null or undefined (D-22).
- **GateBadge (`src/components/panels/task-card/gate-badge.tsx`)** — two-branch render: `gate_status='approved'` → green badge with `t('gate.statusApproved')` → `✓ Approved`; anything else (pending/rejected/not_required) → amber badge with `t('gate.statusRequired')` → `🔒 Approval required`. Returns `null` when `gate_required !== 1`. Uses `useTranslations('project.lifecycle')` for both strings per GSD-29 / D-36 / D-38.
- **Task-board injection** — both badges inserted directly after the `ticket_ref` badge in the regular card metadata row (line 1052) AND in the task detail modal header (line 1485). Grep-based acceptance: `<PhaseBadge task={task}` appears twice, `<GateBadge task={task}` appears twice.
- **Task interface extension** — added the five GSD fields (`gsd_phase`, `gate_required`, `gate_status`, `gate_approved_by`, `gate_approved_at`) to the in-file Task interface so TypeScript accepts the badge props at insertion sites. Mirrors the Zustand store Task type (Wave 2a).
- **Test coverage** — 10 real RTL assertions replace the 7 it.todo() scaffolds from Wave 0. Tests render against a real `NextIntlClientProvider` with `messages/en.json` so translation keys (`project.lifecycle.gate.statusApproved` / `statusRequired`) are exercised end-to-end; any future copy drift in en.json flips a test red.

## Task Commits

1. **Task 1 RED: failing tests for PhaseBadge + GateBadge** — `edaf776` (test)
2. **Task 1 GREEN: implement PhaseBadge + GateBadge components** — `28918eb` (feat; also renames .test.ts → .test.tsx)
3. **Task 2: inject both badges into task-board card + detail modal** — `f9131c0` (feat)

_Plan metadata commit follows (docs: complete plan)._

## Files Created/Modified

### `src/components/panels/task-card/phase-badge.tsx` (new, 22 lines)

```tsx
'use client'
type TaskLike = { gsd_phase?: string | null }
export function PhaseBadge({ task }: { task: TaskLike }) {
  if (!task.gsd_phase) return null
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono"
      title={`GSD phase: ${task.gsd_phase}`}
    >
      {task.gsd_phase.toUpperCase()}
    </span>
  )
}
```

### `src/components/panels/task-card/gate-badge.tsx` (new, 28 lines)

```tsx
'use client'
import { useTranslations } from 'next-intl'
type TaskLike = { gate_required?: 0 | 1; gate_status?: string }
export function GateBadge({ task }: { task: TaskLike }) {
  const t = useTranslations('project.lifecycle')
  if (task.gate_required !== 1) return null
  if (task.gate_status === 'approved') {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20">
        {t('gate.statusApproved')}
      </span>
    )
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
      {t('gate.statusRequired')}
    </span>
  )
}
```

### `src/components/panels/task-card/__tests__/phase-badge.test.tsx` (new, 4 tests, 0 todos)

| # | Test | Asserts |
|---|------|---------|
| 1 | gsd_phase='plan' → 'PLAN' | `screen.getByText('PLAN')` renders |
| 2 | gsd_phase=null | container empty (D-22) |
| 3 | gsd_phase=undefined | container empty (D-22) |
| 4 | UI-SPEC classes | `toHaveClass('text-[10px]', 'px-1.5', …, 'font-mono')` |

### `src/components/panels/task-card/__tests__/gate-badge.test.tsx` (new, 6 tests, 0 todos)

| # | Input | Asserts |
|---|-------|---------|
| 1 | `gate_required=0` | container empty |
| 2 | `gate_required=undefined` | container empty |
| 3 | `gate_required=1, gate_status='approved'` | `✓ Approved` + green classes |
| 4 | `gate_required=1, gate_status='pending'` | `🔒 Approval required` + amber classes |
| 5 | `gate_required=1, gate_status='rejected'` | `🔒 Approval required` |
| 6 | `gate_required=1, gate_status='not_required'` | `🔒 Approval required` |

Tests wrap render in `NextIntlClientProvider` with imported `messages/en.json` so `t('gate.statusApproved')` / `t('gate.statusRequired')` resolve to the real translation values (`✓ Approved` / `🔒 Approval required`).

### `src/components/panels/task-board-panel.tsx` (modified, +16 lines)

- **Imports (line 18-19):** `PhaseBadge`, `GateBadge` from `@/components/panels/task-card/`
- **Task interface (lines 49-53):** added `gsd_phase`, `gate_required`, `gate_status`, `gate_approved_by`, `gate_approved_at` — mirrors Wave 2a store Task type
- **Injection point 1 (line 1052, regular card metadata row):** `<PhaseBadge task={task} />` + `<GateBadge task={task} />` placed directly after the closing `</span>` of the ticket_ref badge, before the GitHub issue link
- **Injection point 2 (line 1485, detail modal header):** same pair, placed after the ticket_ref mono badge, before the status pill

Both insertion points carry a block comment citing GSD-24 / GSD-25 / D-22 for future readers.

## Decisions Made

See frontmatter `key-decisions` — five logged for STATE.md.

## Deviations from Plan

**1. [Rule 3 - Blocking issue] Renamed test files `.test.ts` → `.test.tsx`**
- **Found during:** Task 1 typecheck after GREEN
- **Issue:** The `NextIntlClientProvider` component type requires `children` as a JSX child (not a props key), so calling it via `React.createElement(…, { messages, locale }, ui)` produced TS2769. The plan sketched createElement for simplicity but the real type needs JSX.
- **Fix:** Renamed both test files to `.test.tsx` and rewrote them using JSX syntax with `<NextIntlClientProvider messages={…} locale="en">{ui}</NextIntlClientProvider>`. Vitest `include` globs (`src/**/*.test.ts` + `src/**/*.test.tsx`) already accept both extensions.
- **Files modified:** renamed + rewritten in commit `28918eb`
- **No scope change** — same tests, same assertions, same file location.

**2. [Rule 2 - Missing critical functionality] Extended in-file `Task` interface with GSD fields**
- **Found during:** Task 2 typecheck after badge injection
- **Issue:** The in-file `Task` interface in `task-board-panel.tsx` (line 21) predates Wave 2a and did not include the five GSD fields. Passing `task` to the badges worked at runtime because the props are optional, but the plan's note ("rely on the Zustand store Task type — TypeScript will accept the optional fields") was inaccurate: the local interface shadows the store type, so TypeScript saw `gsd_phase`/`gate_required` as missing.
- **Fix:** Added the five GSD fields (with the exact same type union as the store Task type) to the in-file interface.
- **Files modified:** `src/components/panels/task-board-panel.tsx` in commit `f9131c0`
- **CLAUDE.md compliance:** preserved `@/*` imports, kept named exports, no icon libraries, no new deps.

## Issues Encountered

- **TS2769 `NextIntlClientProvider children missing`** — root cause: createElement type inference for intersection props (`Attributes & Omit<IntlConfig & { children: ReactNode }, 'locale'>`) requires `children` to be a JSX child, not a props key. Fixed by switching to JSX (rename to .tsx).
- **TS2307 `Cannot find module '@/components/project/lifecycle/…'`** — sibling-parallel-plan errors from 09-07 test scaffolds that were un-implemented at the moment this plan's typecheck ran. These resolved before Task 2 (09-07 landed between my Task 1 commit and Task 2 commit per `git log --oneline --all`: `ccf9ebd feat(09-07)…`). Logged to deferred-items.md for transparency; final typecheck at Task 2 completion was clean.

## Out-of-Scope Deferred

None — all lifecycle-view errors observed during this plan resolved before Task 2 completion (09-07 implementation landed in parallel). Deferred-items.md entry records the observation for audit trail.

## User Setup Required

None — badges render automatically when a task has `gsd_phase` or `gate_required` set. GSD-aware projects will see the badges populate as tasks flow through the lifecycle; v1.0 projects are unaffected.

## Next Phase Readiness

- **Plans 09-10 and 09-11 (verifier / wrap-up)** can reference a fully wired task-card badge system — no additional UI work is required to surface phase/gate state on the task board.
- **Lifecycle-view (09-07)** and **task-board badges (09-08)** are now the two user-visible touchpoints of GSD state — audit trail from DB (migration 052) → API (GET /api/tasks with SELECT t.*) → store (Task type extension) → UI (this plan) is complete and testable end-to-end.
- **Manual smoke (deferred to 09-10 verifier):** seed a task with `gsd_phase='plan'`, `gate_required=1`, `gate_status='pending'` → open task board → expect to see `PLAN` primary pill + amber `🔒 Approval required` pill immediately after the ticket_ref badge on the card.

## Self-Check: PASSED

- [x] FOUND: `src/components/panels/task-card/phase-badge.tsx`
- [x] FOUND: `src/components/panels/task-card/gate-badge.tsx`
- [x] FOUND: `src/components/panels/task-card/__tests__/phase-badge.test.tsx`
- [x] FOUND: `src/components/panels/task-card/__tests__/gate-badge.test.tsx`
- [x] FOUND commit: `edaf776` (test RED)
- [x] FOUND commit: `28918eb` (feat GREEN)
- [x] FOUND commit: `f9131c0` (feat injection)
- [x] `pnpm vitest run src/components/panels/task-card/__tests__/` → 10/10 passed
- [x] `pnpm vitest run src/components/panels/__tests__/` → 74/74 passed (no regressions)
- [x] `npx tsc --noEmit` → exit 0
- [x] `pnpm build` → succeeded
- [x] Acceptance criteria: both imports present, `<PhaseBadge task={task}` appears twice, `<GateBadge task={task}` appears twice, UI-SPEC classes grep-matched, no it.todo remaining
- [x] CLAUDE.md: no icon libraries, no new deps, kebab-case filenames, named exports, `@/*` imports, pnpm only, i18n for user-facing strings (phase names are English per D-37 — documented exception)

---
*Phase: 09-gsd-native-integration*
*Completed: 2026-04-15*
