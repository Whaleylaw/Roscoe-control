---
phase: 07-post-audit-gap-closure
plan: 00
subsystem: testing
tags: [i18n, vitest, scaffolds, gap-closure, flow-e, audit-phase-02-techdebt]

# Dependency graph
requires:
  - phase: 06-settings
    provides: project.workspace.* i18n namespace (title/notFound/loading/projectNotFound/projectNotFoundDescription/backToProjects) in all 10 locales
  - phase: 02-navigation-workspace-shell
    provides: src/components/project/project-context.tsx ProjectWorkspaceProvider with {slug,view,detailId,project,loading,error} state shape
provides:
  - 3 new project.workspace.* i18n keys (loadTimeoutHeading/Body/Retry) landed atomically across 10 locale files with identical English-fallback values
  - 1 real passing i18n-coverage test asserting the 3 new keys exist in all 10 locales
  - 4 it.todo scaffolds in project-context.test.tsx covering the 10s loading-timeout escape path
  - 3 it.todo scaffolds in new projects-archive-behavior.test.ts codifying the FLOW-E Option 2 contract
  - Archive-visibility decision documented verbatim in a block comment at src/store/__tests__/projects-archive-behavior.test.ts
affects: [07-01-post-audit-gap-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave-0 it.todo scaffolds + atomic 10-locale i18n commit (continuing Phases 1-6 precedent)"
    - "First test file under src/store/__tests__/ (new directory — mirrors existing src/components/*/__tests__/ convention)"
    - "Planning decisions persisted as block comments in test files (not just SUMMARY.md) — prevents silent regressions via test-name + block-comment rationale"

key-files:
  created:
    - src/store/__tests__/projects-archive-behavior.test.ts
  modified:
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
    - src/components/project/__tests__/i18n-coverage.test.tsx
    - src/components/project/__tests__/project-context.test.tsx

key-decisions:
  - "FLOW-E resolution: Option 2 (archived projects vanish from Zustand projects[]) adopted as intentional per existing architecture — project-manager-modal.tsx:68 owns archive-visible UX; Zustand projects[] serves nav-rail + task-board pickers that should show only active projects"
  - "New loadTimeout* i18n keys use identical English values across all 10 locales per existing project.workspace.title/notFound/loading English-fallback precedent (not the projectNotFound translation precedent) — matches explicit plan directive"
  - "Decision quoted verbatim in projects-archive-behavior.test.ts block comment (not just SUMMARY.md) so the contract lives with the test — prevents silent regressions if someone removes the tests first and then flips the fetch URL"

patterns-established:
  - "src/store/__tests__/ as the canonical location for Zustand store contract tests"
  - "Block-comment rationale directly above it.todo stubs, naming the Wave 1 implementation plan inline so the continuation agent has zero ambiguity"

requirements-completed:
  - AUDIT-FLOW-E
  - AUDIT-PHASE-02-TECHDEBT

# Metrics
duration: 3min
completed: 2026-04-14
---

# Phase 07 Plan 00: Wave-0 Scaffolds for Post-Audit Gap Closure Summary

**Pre-wired 7 it.todo scaffolds + 1 real i18n-coverage test + 3 new project.workspace.* i18n keys across 10 locales, atomically — Wave 1 (07-01) is now pure implementation.**

## Performance

- **Duration:** ~3 min (10:36 → 10:38 UTC from first commit to second)
- **Started:** 2026-04-14T10:35:00Z
- **Completed:** 2026-04-14T10:38:37Z
- **Tasks:** 2 / 2
- **Files modified:** 12 (11 existing + 1 new)

## Accomplishments

- **10 locale files updated atomically** with 3 new `project.workspace.loadTimeoutHeading` / `loadTimeoutBody` / `loadTimeoutRetry` keys using identical English-fallback values (per the existing title/notFound/loading precedent in the same sub-object).
- **1 real passing i18n-coverage test** added asserting all 10 locales contain the 3 new keys and English source-of-truth values match canonical strings.
- **4 new it.todo stubs** in `project-context.test.tsx` under a new `ProjectWorkspaceProvider - loading timeout escape path (Phase 7 gap closure / AUDIT-PHASE-02-TECHDEBT)` describe block covering the 4 timeout branches: fires after 10s, doesn't fire on normal load, clears on unmount, clears when projects populates mid-wait.
- **3 new it.todo stubs** in the new `src/store/__tests__/projects-archive-behavior.test.ts` file under `FLOW-E: store.fetchProjects archive-visibility contract (Phase 7 gap closure)` codifying the intentional-behavior contract: fetch URL has no `?includeArchived=1`, archived projects drop from store, active projects remain.
- **Archive-visibility decision (Option 2) documented verbatim** in a block comment at the top of the new test file — the rationale lives with the contract it guards.
- **Vitest suite stays green**: 1117 passed, 51 todo, 0 failed (todo count increased by exactly 7 vs. baseline of 44).

## Task Commits

Each task was committed atomically:

1. **Task 1: Atomic 10-locale i18n keys + extend i18n-coverage test** — `7ab1690` (test)
2. **Task 2: Wave-0 it.todo scaffolds for timeout escape path + FLOW-E archive-behavior contract** — `5f4e7c5` (test)

_Note: Both commits are test-only — no production logic landed, matching the plan's explicit "scaffolds-only" directive._

## Files Created/Modified

**Created:**
- `src/store/__tests__/projects-archive-behavior.test.ts` — 3 it.todo stubs + block-comment rationale for FLOW-E Option 2 decision

**Modified:**
- `messages/en.json` — canonical English source for loadTimeout keys
- `messages/ar.json`, `de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt.json`, `ru.json`, `zh.json` — English-fallback values for loadTimeout keys (per project.workspace.* precedent)
- `src/components/project/__tests__/i18n-coverage.test.tsx` — new `it(...)` (real, not todo) asserting 10-locale coverage of the 3 new keys + English value contract
- `src/components/project/__tests__/project-context.test.tsx` — new describe block with 4 it.todo stubs for the loading timeout escape path

## Decisions Made

### FLOW-E Archive Visibility — Option 2 (Archived projects vanish from active store list)

**Quoted verbatim from 07-00-PLAN.md objective (and replicated in the test file's block comment):**

> `store.fetchProjects()` at `src/store/index.ts:877` fetches `/api/projects` WITHOUT `?includeArchived=1`. The server (`src/app/api/projects/route.ts:47`) filters `status = 'active'` when the flag is absent. Result: archiving a project via Settings causes it to drop out of the Zustand projects array on the next refresh.
>
> **PLANNING DECISION:** OPTION 2 — ARCHIVED PROJECTS VANISH FROM THE ACTIVE STORE LIST (INTENTIONAL).
>
> Rationale:
> 1. `project-manager-modal.tsx:68` is the authoritative archive UI and already fetches `?includeArchived=1` independently, showing an "Activate" toggle on archived rows. Admin archive/unarchive already works there.
> 2. The Zustand projects array is consumed by `nav-rail.tsx:755` (quick switcher) and `task-board-panel.tsx` (three project-picker sites). Showing archived projects in those surfaces would clutter navigation and allow creating tasks against archived projects.
> 3. Adding the flag to `store.fetchProjects` would force a 7-call-site redesign.
> 4. No milestone requirement mandates archived visibility in the active list.

**Outcome:** No production change in this plan. Wave 1 (07-01) will add a clarifying comment at `src/store/index.ts:877-885` alongside filling in the 3 it.todo bodies.

### i18n key values — English fallback (not translated)

Followed the existing `project.workspace.title` / `notFound` / `loading` precedent (already English in all 10 locales) rather than the `projectNotFound` / `backToProjects` precedent (translated). Per plan directive: additive, not translated. Matches Phase 5 precedent.

## Deviations from Plan

None — plan executed exactly as written. Both tasks committed atomically with the exact commit messages specified in the plan's acceptance criteria.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready for Plan 07-01 (Wave 1 implementation):**

1. **i18n keys in place** — Wave 1 can call `t('loadTimeoutHeading')` / `t('loadTimeoutBody')` / `t('loadTimeoutRetry')` via `useTranslations('project.workspace')` in `project-workspace.tsx` with zero additional locale-file changes.
2. **Timeout test scaffolds in place** — Wave 1 fills in the 4 bodies using `vi.useFakeTimers()`, implements the `setTimeout(10_000)` inside the `useEffect([slug, projects])` in `project-context.tsx`, adds the `error = 'load-timeout'` state branch, and wires the Retry button.
3. **FLOW-E contract test scaffolds in place** — Wave 1 fills in the 3 bodies asserting current behavior + adds a clarifying comment at `src/store/index.ts:877-885`. No production code change to the fetch URL itself.

**Ready signal:** Plan 07-01 can proceed immediately — no blockers, no pending decisions, no locale conflicts.

---

## Self-Check: PASSED

**Commit verification:**
- `7ab1690` — FOUND in git log (Task 1: atomic 10-locale i18n keys)
- `5f4e7c5` — FOUND in git log (Task 2: wave-0 it.todo scaffolds)

**File verification:**
- `src/store/__tests__/projects-archive-behavior.test.ts` — FOUND
- `src/components/project/__tests__/project-context.test.tsx` — FOUND (extended, 9 it.todo total)
- `src/components/project/__tests__/i18n-coverage.test.tsx` — FOUND (extended, 4 passing + 2 todo)
- All 10 `messages/*.json` — FOUND with loadTimeoutHeading/Body/Retry keys

**Test-suite verification:**
- `pnpm vitest run` — 1117 passed, 51 todo, 0 failed (baseline 44 todo → +7 exactly as expected)
- `tsc --noEmit` — exit 0
- `pnpm vitest run src/components/project/__tests__/i18n-coverage.test.tsx` — 4 passed, 2 todo (including the new passing loadTimeout-coverage test)

---
*Phase: 07-post-audit-gap-closure*
*Completed: 2026-04-14*
