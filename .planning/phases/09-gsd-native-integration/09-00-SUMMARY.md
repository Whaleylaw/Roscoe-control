---
phase: 09-gsd-native-integration
plan: 00
subsystem: testing
tags: [vitest, playwright, i18n, next-intl, scaffolds, gsd]

requires:
  - phase: 08-projects-entry-point
    provides: atomic 10-locale seed pattern (ephemeral Node script) + reusable test directory conventions
provides:
  - project.lifecycle.* + project.nav.lifecycle keys seeded atomically across all 10 locales
  - 17 test scaffolds (16 vitest it.todo + 1 Playwright test.fixme) pre-wired to every Phase 09 GSD requirement
  - New __tests__ directories under src/components/project/lifecycle/ and src/components/panels/task-card/
  - Green vitest + green typecheck baseline for all downstream Phase 09 waves
affects: [09-01, 09-02, 09-03, 09-04, 09-05, 09-06, 09-07, 09-08, 09-09, 09-10]

tech-stack:
  added: []
  patterns:
    - Wave-0 scaffolds as it.todo/test.fixme stubs (continues Phase 01-08 precedent)
    - Atomic 10-locale i18n seed via ephemeral Node script (Phase 05/06/08 precedent)
    - Per-file GSD-ID coverage comment at top of every scaffold for traceability

key-files:
  created:
    - src/lib/__tests__/migrations-052.test.ts
    - src/lib/__tests__/gsd-templates.test.ts
    - src/lib/__tests__/validation-gsd.test.ts
    - src/lib/__tests__/locale-parity-gsd.test.ts
    - src/app/api/projects/__tests__/projects-crud-gsd.test.ts
    - src/app/api/projects/__tests__/bootstrap.test.ts
    - src/app/api/projects/__tests__/transition.test.ts
    - src/app/api/tasks/__tests__/gate.test.ts
    - src/app/api/tasks/__tests__/status-gate-block.test.ts
    - src/app/api/tasks/__tests__/tasks-gsd-fields.test.ts
    - src/components/project/lifecycle/__tests__/lifecycle-view.test.ts
    - src/components/project/lifecycle/__tests__/gate-task-row.test.ts
    - src/components/project/lifecycle/__tests__/empty-state.test.ts
    - src/components/project/lifecycle/__tests__/phase-timeline.test.ts
    - src/components/panels/task-card/__tests__/phase-badge.test.ts
    - src/components/panels/task-card/__tests__/gate-badge.test.ts
    - tests/gsd-lifecycle.spec.ts
  modified:
    - messages/en.json
    - messages/de.json
    - messages/es.json
    - messages/fr.json
    - messages/ja.json
    - messages/ko.json
    - messages/pt.json
    - messages/ru.json
    - messages/ar.json
    - messages/zh.json

key-decisions:
  - "Continued wave-0 it.todo()/test.fixme() scaffold pattern from Phases 01-08 so pnpm test stays green before implementation"
  - "Atomic 10-locale i18n seed via single ephemeral Node script — eliminates messages/*.json merge-conflict surface across parallel Wave 1-3 plans"
  - "English-fallback strategy for all 10 locales per D-37/D-38 and STATE entries 130, 141 — phase/track/gate-mode names remain literal English"
  - "ICU placeholders ({next}, {toPhase}, {reason}, {remedy}, {serverError}) preserved verbatim across every locale"
  - "Top-of-file block comment in every scaffold enumerates the covered GSD-IDs so downstream plans can find test homes by requirement"
  - "First __tests__ directories under src/components/project/lifecycle/ and src/components/panels/task-card/ — canonical homes for Wave 3 UI unit tests"

patterns-established:
  - "Scaffold comment header: `// Wave N fills these in. Covers: GSD-XX, GSD-YY.` followed by brief file-level description"
  - "it.todo('<behavior> (GSD-ID)') — one stub per requirement so filling in a stub is a single find-and-replace for downstream agents"
  - "Playwright cross-layer E2E uses test.fixme with async ({ page: _page }) to keep TS happy while body is empty"

requirements-completed: [GSD-29]

duration: 6min
completed: 2026-04-15
---

# Phase 09 Plan 00: Wave 0 Scaffolds Summary

**17 vitest/Playwright test scaffolds pre-wired to every GSD requirement, plus atomic project.lifecycle.* seed across all 10 locales — Phase 09 baseline ready.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-15T02:30:00Z (approx.)
- **Completed:** 2026-04-15T02:36:17Z
- **Tasks:** 2
- **Files modified:** 27 (17 new test files + 10 locale files)

## Accomplishments

- Seeded `project.lifecycle.*` namespace (title, cta, gate, settings, empty, error branches) + `project.nav.lifecycle` key across all 10 locales in a single atomic commit
- Created 17 test scaffolds covering every Phase 09 GSD requirement (GSD-01 through GSD-29) with named `it.todo()` / `test.fixme()` stubs for downstream agents to fill in
- Established new test directories: `src/components/project/lifecycle/__tests__/` and `src/components/panels/task-card/__tests__/`
- Kept `pnpm test` + `pnpm typecheck` green — 98 passed test files, 1164 assertions, 137 new todos, zero `expect()` calls in scaffolds

## Task Commits

1. **Task 1: Atomic 10-locale i18n seed (project.lifecycle.\* + project.nav.lifecycle)** — `665c67d` (feat)
2. **Task 2: Create 17 test scaffolds (vitest it.todo + Playwright test.fixme)** — `e521d6d` (test)

_Plan metadata commit follows (docs: complete plan)._

## Files Created/Modified

### Test Scaffolds (17 new files — 137 `it.todo` + 1 `test.fixme`)

**src/lib/\_\_tests\_\_/** (4 files — GSD-02, GSD-06, GSD-17, GSD-18, GSD-03, GSD-14, GSD-29)
- `migrations-052.test.ts` — 6 stubs: DB schema migration contract (GSD-02, GSD-06)
- `gsd-templates.test.ts` — 5 stubs: template loader + soft-miss fallback (GSD-17, GSD-18)
- `validation-gsd.test.ts` — 6 stubs: Zod schemas for phase/track/gate-mode/transition/taskGate/template (GSD-03, GSD-14)
- `locale-parity-gsd.test.ts` — 5 stubs: 10-locale key parity + emoji-prefix assertions (GSD-29)

**src/app/api/projects/\_\_tests\_\_/** (3 files — GSD-01, GSD-03, GSD-07, GSD-08, GSD-09, GSD-10, GSD-11, GSD-13, GSD-14, GSD-17, GSD-19, GSD-28)
- `projects-crud-gsd.test.ts` — 8 stubs: POST/GET/PATCH gsd_* fields + role + phase-routing lockout
- `bootstrap.test.ts` — 9 stubs: role + creates 8 tasks + idempotent + template soft-miss + event broadcast
- `transition.test.ts` — 11 stubs: legal/illegal transitions + waiver + error codes + Pitfall 4 dual-timestamp update

**src/app/api/tasks/\_\_tests\_\_/** (3 files — GSD-04, GSD-05, GSD-11, GSD-13, GSD-15, GSD-16, GSD-28)
- `gate.test.ts` — 8 stubs: approve/reject + stamps + NO_GATE + event broadcast (GSD-05, GSD-11, GSD-28)
- `status-gate-block.test.ts` — 7 stubs: forward-motion blocks + backward/lateral passes (D-31, D-32)
- `tasks-gsd-fields.test.ts` — 3 stubs: GET returns gsd_phase + gate_* on every task (GSD-04, GSD-13)

**src/components/project/lifecycle/\_\_tests\_\_/** (4 files — GSD-20, GSD-21, GSD-22, GSD-23)
- `lifecycle-view.test.ts` — 5 stubs: main LifecycleView variants by state/role
- `gate-task-row.test.ts` — 4 stubs: approve/reject UI + viewer visibility + Escape cancel
- `empty-state.test.ts` — 4 stubs: disabled-project empty state + Enable CTA
- `phase-timeline.test.ts` — 5 stubs: 5-step strip + aria-current + ✓ prefix + responsive

**src/components/panels/task-card/\_\_tests\_\_/** (2 files — GSD-24, GSD-25)
- `phase-badge.test.ts` — 3 stubs: upper-cased phase pill + null-phase-renders-nothing (D-22) + class list
- `gate-badge.test.ts` — 4 stubs: amber/green badge + gate_required=0 hides + i18n copy

**tests/** (1 file — cross-layer E2E)
- `gsd-lifecycle.spec.ts` — 1 `test.fixme` covering the end-to-end GSD flow for Wave 4

### i18n Seed (10 locale files modified)

`messages/{en,de,es,fr,ja,ko,pt,ru,ar,zh}.json` — each gained:
- `project.lifecycle` (title, currentPhase, phaseTimeline, gateTasks*, cta{enable,bootstrap,bootstrapRerun,bootstrapHelper,advance,waive,waiveConfirmBody,waiveConfirmSubmit,cancel}, gate{approve,reject,statusPending,statusRequired,statusApproved,statusRejected,rejectConfirmBody,rejectConfirmSubmit,rejectNotePlaceholder}, settings{heading,enableLabel,enableHelper,trackLabel,trackHelperDisabled,gateModeLabel,gateModeHelper}, empty{heading,body,notBootstrapped{heading,body}}, error{illegalTransition,gateBlocked,bootstrapFailed,enableFailed,transitionFailed})
- `project.nav.lifecycle = "Lifecycle"`

All 10 locales are byte-for-byte identical for the lifecycle tree per D-37/D-38 English-fallback policy.

### Exact LIFECYCLE_TREE seeded into every locale

```json
{
  "title": "Lifecycle",
  "currentPhase": "Current phase",
  "phaseTimeline": "Phase timeline",
  "gateTasks": "Tasks awaiting approval",
  "gateTasksNone": "No tasks awaiting approval",
  "gateTasksEmptyBody": "Nothing needs approval right now. Gate-required tasks appear here when they are created or promoted to pending approval.",
  "cta": {
    "enable": "Enable GSD for this project",
    "bootstrap": "Bootstrap phase tasks",
    "bootstrapRerun": "Re-run bootstrap",
    "bootstrapHelper": "Safe to re-run — creates only missing tasks",
    "advance": "Advance to {next} phase",
    "waive": "Waive remaining and continue",
    "waiveConfirmBody": "Waive the remaining Execute tasks and move to Verify? The reason is recorded in the activity log.",
    "waiveConfirmSubmit": "Confirm waiver",
    "cancel": "Cancel"
  },
  "gate": {
    "approve": "Approve",
    "reject": "Reject",
    "statusPending": "Pending approval",
    "statusRequired": "🔒 Approval required",
    "statusApproved": "✓ Approved",
    "statusRejected": "Rejected",
    "rejectConfirmBody": "Reject this gate? The task will stay blocked until an operator re-approves.",
    "rejectConfirmSubmit": "Confirm reject",
    "rejectNotePlaceholder": "Note (optional) — why is this rejected?"
  },
  "settings": {
    "heading": "GSD lifecycle",
    "enableLabel": "GSD enabled",
    "enableHelper": "Turn on to track this project through Discuss → Plan → Execute → Verify → Done phases",
    "trackLabel": "Track",
    "trackHelperDisabled": "Enable GSD to choose a track",
    "gateModeLabel": "Gate approval mode",
    "gateModeHelper": "Manual approval requires an operator to approve each gate. Auto internal skips approval for internal-only work."
  },
  "empty": {
    "heading": "GSD is not enabled on this project",
    "body": "Turn on GSD to track this project through its Discuss, Plan, Execute, Verify, and Done phases, bootstrap default phase tasks, and enforce approval gates on high-impact work.",
    "notBootstrapped": {
      "heading": "No phase tasks yet",
      "body": "Bootstrap to create the default Discuss → Plan → Execute → Verify task pack for this project. You can customize any task after bootstrap."
    }
  },
  "error": {
    "illegalTransition": "Can't advance to {toPhase} yet: {reason}. {remedy}",
    "gateBlocked": "This task needs approval before it can move forward. Approve the gate below or ask an operator to approve it.",
    "bootstrapFailed": "Couldn't reach the server. Retry bootstrap in a moment.",
    "enableFailed": "Couldn't enable GSD. {serverError} Try again.",
    "transitionFailed": "Couldn't advance the phase. Check your connection and try again."
  }
}
```

And `project.nav.lifecycle = "Lifecycle"` seeded alongside existing nav keys.

## Decisions Made

See frontmatter `key-decisions` — all six logged to STATE.md.

## Deviations from Plan

None — plan executed exactly as written. The ephemeral Node script (`tmp-seed-lifecycle-i18n.cjs`) was created, executed, and deleted in a single bash invocation; no script artifacts remain in the repo.

## Issues Encountered

None. Verification gates all passed first try:

- `node -e "..."` 10-locale sanity check: OK
- `pnpm typecheck`: PASS
- `pnpm test`: 98 test files passed, 20 skipped, 1164 assertions, 137 todos, 0 failed
- `grep -c "expect("` across all 17 scaffolds: 0

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Wave 1 (09-01, 09-02)** can run in parallel: migrations-052 + schemas-gsd-validation have named test files to populate
- **Wave 2 (09-03, 09-04, 09-05, 09-06, 09-07)** can run in parallel once migration is merged: every projects/tasks route has its test home pre-created
- **Wave 3 (09-08, 09-09)** can use `useTranslations('project.lifecycle')` on day one — no i18n work needed
- **Wave 4 (09-10)** has `tests/gsd-lifecycle.spec.ts` scaffold ready for end-to-end assertions
- **Zero merge-conflict surface** on `messages/*.json` for the remainder of Phase 09 — downstream plans only READ translation keys

## Self-Check: PASSED

- [x] All 17 test files exist at their prescribed paths
- [x] All 10 locale files carry `project.lifecycle.title` and `project.nav.lifecycle`
- [x] Commit `665c67d` present in `git log`
- [x] Commit `e521d6d` present in `git log`
- [x] No `tmp-*.cjs` files remain in repo
- [x] Zero `expect(` calls in any of the 17 scaffolds
- [x] `pnpm typecheck` exited 0
- [x] `pnpm test` exited 0 (1164 passed, 137 todos)

---
*Phase: 09-gsd-native-integration*
*Completed: 2026-04-15*
