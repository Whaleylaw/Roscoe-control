---
phase: 08-projects-entry-point
plan: 04
subsystem: ui/projects
tags: [gap-closure, i18n, ux, uat]
requirements: [NAV-01]
dependency_graph:
  requires:
    - 08-01 (ProjectsPanel exists with empty-state CTA)
    - 08-05 (parallel — projects.create.* i18n namespace; order-independent)
  provides:
    - "Header-level 'New project' CTA on ProjectsPanel (discoverable when list is populated)"
    - "projects.header.cta i18n key across all 10 locales"
  affects:
    - src/components/panels/projects-panel.tsx
    - src/components/panels/__tests__/projects-panel.test.tsx
    - messages/*.json (projects.header.cta sub-namespace)
tech_stack:
  added: []
  patterns:
    - "Race-safe atomic i18n edits via ...rest-spread reorder (preserves sibling keys written by parallel plans)"
    - "Single ProjectManagerModal instance for all creation entry points (D-12 reuse)"
key_files:
  created:
    - .planning/phases/08-projects-entry-point/08-04-SUMMARY.md
  modified:
    - src/components/panels/projects-panel.tsx
    - src/components/panels/__tests__/projects-panel.test.tsx
    - messages/ar.json
    - messages/de.json
    - messages/en.json
    - messages/es.json
    - messages/fr.json
    - messages/ja.json
    - messages/ko.json
    - messages/pt.json
    - messages/ru.json
    - messages/zh.json
decisions:
  - "Header CTA and empty-state CTA both call the same setShowManager(true) — single ProjectManagerModal source of truth preserved (D-12)."
  - "Locale-update script uses `{ title, empty, picker, row, ...rest }` spread pattern; the ...rest spread survives any parallel-plan sibling writes (specifically 08-05's projects.create.*)."
  - "Header CTA accessible name resolves via t('header.cta') — tests disambiguate it from project-row buttons via regex /header\\.cta/i against the i18n key literal (mock returns keys verbatim)."
metrics:
  duration: "~8min"
  completed: "2026-04-14"
  tasks: 1
  files_modified: 12
  tests_added: 3
  total_tests_passing: 10
---

# Phase 8 Plan 04: Header CTA on ProjectsPanel Summary

**One-liner:** Adds a persistent header "New project" button to the ProjectsPanel so project creation stays discoverable once the list is populated — closing UAT Gap 1 for NAV-01.

## Gap Closed

**UAT Gap 1 (high severity):** Before this plan, project creation on the ProjectsPanel was only reachable through (a) the empty-state CTA (which vanishes once one project exists) or (b) the task-board-panel picker. The populated-list case had no visible creation affordance — breaking the discoverability promise NAV-01 was reopened to fix. The header CTA now provides a persistent, always-visible entry point.

## What Changed

- **`src/components/panels/projects-panel.tsx`** — Added a `<Button>` inside the existing flex-between header (next to the title). `onClick` calls the same `setShowManager(true)` handler the empty-state CTA already uses, so both entry points open the identical `ProjectManagerModal` instance (D-12 reuse preserved). The `onClose` handler chain (`setShowManager(false)` + `fetchProjects()`) is unchanged and already satisfies the "new projects appear without page reload" requirement. Net delta: one line added to JSX.
- **`src/components/panels/__tests__/projects-panel.test.tsx`** — Extended the suite with three new test cases:
  1. `renders a 'New project' button in the header` — asserts a button with accessible name matching `/header\.cta/i` exists and is a distinct DOM node from row buttons.
  2. `header 'New project' button opens ProjectManagerModal` — clicks the header CTA and asserts the modal test-id appears.
  3. `header CTA onClose triggers fetchProjects` — captures a `fetchProjects` spy via an updated `setStore()` helper, clicks the header CTA, then clicks the mocked modal (which invokes `onClose`), asserting the spy was called.
  - The existing 7 tests (empty-state CTA, row navigation, row metadata, keyboard Enter, archived-filter, etc.) were unchanged and still pass — `setStore()` now returns the fetchProjects spy but remains backward-compatible for callers that ignore the return.
- **`messages/{ar,de,en,es,fr,ja,ko,pt,ru,zh}.json`** — Inserted a new `projects.header.cta` sub-namespace in all 10 locales via a one-shot Node script using a `...rest`-preserving reorder pattern. Translations are localized per language (e.g. en: "New project", ja: "新しいプロジェクト", ar: "مشروع جديد").

## Tests Added / Passing

- **New tests:** 3 (header CTA renders, opens modal, triggers refetch on close)
- **Total ProjectsPanel tests passing:** 10 (7 original + 3 new)
- **Full vitest suite:** 1,154 passed, 44 todo (all suites green)
- **Typecheck:** clean (exit 0)
- **Lint:** 0 errors (72 pre-existing warnings unchanged)

## D-12 Reuse Preservation

Phase 8 Decision D-12 established that "empty-state CTA reuses the existing ProjectManagerModal — single source of truth for project creation." This plan honors that decision exactly: the new header CTA does NOT introduce a second modal, a second creation pathway, or duplicated form state. Both CTAs call `setShowManager(true)`, which renders the same `<ProjectManagerModal>` instance with identical `onClose` semantics (`fetchProjects()` on close). The plan explicitly confirmed `grep -c "setShowManager(true)" src/components/panels/projects-panel.tsx` == 2 as an acceptance criterion.

## Order-Independence with 08-05

Plans 08-04 and 08-05 were scheduled in the same wave (wave 1, `depends_on: []`) and both write to `messages/*.json` under the `projects.*` namespace. 08-04 adds `projects.header.cta`; 08-05 adds `projects.create.*` (GitHub sync, deadline, color, etc. field labels for the modal upgrade). Both scripts use the same `{ title, empty, picker, row, ...rest }` spread pattern so sibling keys from the other plan are preserved regardless of execution order.

**Actual execution order observed at runtime:** 08-05 committed its locale changes first (commit `31e9060` — `feat(08-05): upgrade ProjectManagerModal create form…`). When 08-04's script ran, its `hadCreate` sentinel detected `projects.create` already present in all 10 files, and the `...rest` spread preserved every `create` sub-key while inserting `header` at the semantic position (right after `title`). The inline assertion (`if (hadCreate && !...hasOwnProperty…after, 'create') throw …`) would have aborted the run on regression — it did not trigger.

Post-run verification confirms all 10 locales contain BOTH `projects.header.cta` (this plan) and `projects.create.*` (08-05). The step-1b smoke test (simulating a pre-existing `{ __marker: 'from-08-05' }` sibling and re-running the reorder) printed `order-independence: OK`, proving the script is race-safe in both orderings.

## Deviations from Plan

**None — plan executed exactly as written.**

The `...rest`-spread race-safety mechanism was exercised by actual parallel execution (08-05 committed first) and performed correctly: no keys from the sibling plan were dropped, and the new key landed at the intended semantic position.

## Commits

- `60e0d15` — feat(08-04): add header 'New project' CTA to ProjectsPanel
  - Note: `messages/*.json` locale changes for `projects.header.cta` were folded into 08-05's locale commit because 08-05 ran first; when 08-04's script ran against the post-08-05 state, its writes produced the identical on-disk bytes already present, so there was no remaining delta for messages files at commit time. The `header.cta` key is verifiably present in all 10 locales (see acceptance verification below).

## Acceptance Criteria Verification

| Criterion | Expected | Actual | Status |
| --- | --- | --- | --- |
| `grep -l '"header"' messages/*.json \| wc -l` | 10 | 10 | Pass |
| `grep -c '"cta"' messages/en.json` | 2 | 2 | Pass |
| Order-independence smoke test | `order-independence: OK` | `order-independence: OK` | Pass |
| `grep -c "t('header.cta')" projects-panel.tsx` | 1 | 1 | Pass |
| `grep -c "t('empty.cta')" projects-panel.tsx` | 1 | 1 | Pass |
| `grep -c "setShowManager(true)" projects-panel.tsx` | 2 | 2 | Pass |
| `pnpm test -- projects-panel.test.tsx` passing count | ≥10 | 10 | Pass |
| `pnpm typecheck` | exit 0 | exit 0 | Pass |
| `pnpm lint` | 0 errors | 0 errors | Pass |

## Self-Check: PASSED

- `src/components/panels/projects-panel.tsx` — FOUND (header.cta rendered at line 58)
- `src/components/panels/__tests__/projects-panel.test.tsx` — FOUND (10 tests, 3 new)
- `messages/en.json` — FOUND (projects.header.cta = "New project")
- Commit `60e0d15` — FOUND in git log
- All 10 locale files — FOUND containing `"header": { "cta": … }`
