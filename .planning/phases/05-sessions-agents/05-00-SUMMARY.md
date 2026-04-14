---
phase: 05-sessions-agents
plan: 00
subsystem: testing
tags: [vitest, playwright, i18n, next-intl, scope-prop, scaffolding]

# Dependency graph
requires:
  - phase: 04-project-tasks
    provides: scope-prop embed pattern (TaskBoardScope), wave-0 it.todo()/test.fixme() scaffolding rhythm, co-located panels __tests__ directory
  - phase: 02-navigation-workspace-shell
    provides: project-context (useProjectWorkspace), URL-driven view parsing, project-view-router dispatch
  - phase: 01-foundation
    provides: i18n namespace structure (project.* in messages/{10 locales}.json), workspace component directory layout
provides:
  - 8 vitest scaffolds (6 new, 2 extended) with 95 it.todo() pending tests covering SESS-01/SESS-02/SESS-03 across panels, API routes, view components, router dispatch, and context parsing
  - 1 Playwright scaffold with 11 test.fixme() pending stubs covering the SESS-01/SESS-02/SESS-03 end-to-end flow
  - 30 i18n keys per locale × 10 locales = 300 new translated strings under project.sessions.*, project.agents.*, and project.common.retry, all matching the UI-SPEC copy contract verbatim
  - Locked test buckets that downstream Wave 1/2 plans (05-01, 05-02, 05-03) can fill in parallel without locale-file conflicts
affects: [05-01, 05-02, 05-03, 05-VERIFICATION]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave 0 it.todo()/test.fixme() rhythm extended to API route tests (DB-backed) and Playwright E2E — same vitest todos pattern, no failure noise"
    - "Locale edits consolidated into a single Wave 0 task so parallel Wave 1 implementation plans never conflict on messages/*.json"
    - "Embedded comment headers in every scaffold listing exact mock setup needed by the consuming Wave 1/2 task — keeps execution self-contained"

key-files:
  created:
    - src/components/panels/__tests__/agent-squad-panel.test.tsx
    - src/components/panels/__tests__/session-details-panel.test.tsx
    - src/app/api/agents/__tests__/agents-route.test.ts
    - src/app/api/projects/__tests__/project-sessions.test.ts
    - src/components/project/__tests__/agents-view.test.tsx
    - src/components/project/__tests__/sessions-view.test.tsx
    - src/components/project/__tests__/project-view-router.test.tsx
    - tests/project-sessions.spec.ts
  modified:
    - src/components/project/__tests__/project-context.test.tsx
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

key-decisions:
  - "Continued Phase 1–4 wave-0 it.todo()/test.fixme() pattern — every implementation task in 05-01/02/03 now has a concrete test bucket"
  - "Embedded mock setup as block comments at the top of each scaffold so consuming agents in 05-01/02/03 don't need to re-derive the harness"
  - "Translated all 10 locales in a single atomic commit — Wave 1 plans run in parallel without conflicting on messages/*.json (i18n is single-source-of-truth)"
  - "Settings namespace deferred — Phase 5 only owns sessions/agents/common; settings remains stubbed (will be touched by a later phase)"
  - "Brand names (Claude, Codex, Hermes, Gateway) intentionally untranslated across all locales (proper nouns)"

patterns-established:
  - "Pattern 1: API route test scaffolds use the same it.todo() rhythm as component tests, with mock comments describing better-sqlite3 :memory: + migrations setup for the consuming Wave 1 plan"
  - "Pattern 2: Playwright E2E scaffolds use test.fixme() with Phase 4–style describe nesting (one describe per requirement, one fixme per acceptance bullet)"
  - "Pattern 3: Locale edits batch into a single i18n-only task at Wave 0 — sister Wave 1 plans never touch messages/*.json again"

requirements-completed: [SESS-01, SESS-02, SESS-03]

# Metrics
duration: 4min
completed: 2026-04-14
---

# Phase 05 Plan 00: Sessions & Agents Wave 0 Scaffolds Summary

**Wave 0 test scaffolds (95 vitest todos + 11 Playwright fixmes) and the full Phase 5 i18n copy contract (30 keys × 10 locales) landed atomically — every Wave 1/2 implementation task now has a concrete test bucket and parallel implementation plans never conflict on messages/*.json**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-14T00:51:00Z (approx)
- **Completed:** 2026-04-14T00:55:19Z
- **Tasks:** 7 / 7
- **Files modified:** 18 (8 new test scaffolds + 1 extended test + 1 Playwright spec + 10 locale files − 2 overlap = 18 distinct paths touched)

## Accomplishments

- Established the complete test-bucket layout for Phase 5 — every Wave 1/2 task in 05-01, 05-02, and 05-03 has a pre-named scaffold with named describe blocks matching its acceptance criteria
- Phase 5 i18n copy contract (sessions, agents, common) translated and shipped in all 10 locales in a single atomic commit, eliminating cross-plan conflicts on locale files
- Full vitest suite remains green (968 passed, 156 todo, 0 failed) and Playwright lists the new spec without TypeScript errors
- Embedded the Pitfall 9 (Zustand-clobber guard) and Pitfall 6 (LOWER() dedupe) test stubs explicitly so they cannot be forgotten downstream

## Task Commits

Each task committed atomically (no AI attribution per CLAUDE.md):

1. **Task 1: Add all Phase 5 i18n keys to all 10 locale files** — `d6f14c0` (feat)
2. **Task 2: Create AgentSquadPanel unit test scaffold (SESS-02)** — `fcd79a6` (test) — 16 it.todo()
3. **Task 3: Create SessionDetailsPanel scope-prop unit test scaffold (SESS-01, SESS-03, Pitfall 9)** — `cbdd469` (test) — 19 it.todo()
4. **Task 4: Create API route test scaffolds — agents union + project-sessions** — `1a21aa5` (test) — 17 + 19 = 36 it.todo()
5. **Task 5: Create view-component test scaffolds — agents-view + sessions-view** — `b14dc8b` (test) — 7 + 20 = 27 it.todo()
6. **Task 6: Extend project-context test + create project-view-router test (SESS-03)** — `3423bae` (test) — 6 (extend) + 8 (new) = 14 it.todo()
7. **Task 7: Create Playwright E2E scaffold for SESS-01 + SESS-03 click-through** — `2d85ce2` (test) — 11 test.fixme()

**Plan metadata commit:** pending after this SUMMARY (will commit as `docs(05-00)`).

## Pending-Test Counts Per File

| File | Pending count | Type |
|------|---------------|------|
| src/components/panels/__tests__/agent-squad-panel.test.tsx | 16 | it.todo |
| src/components/panels/__tests__/session-details-panel.test.tsx | 19 | it.todo |
| src/app/api/agents/__tests__/agents-route.test.ts | 17 | it.todo |
| src/app/api/projects/__tests__/project-sessions.test.ts | 19 | it.todo |
| src/components/project/__tests__/agents-view.test.tsx | 7 | it.todo |
| src/components/project/__tests__/sessions-view.test.tsx | 20 | it.todo |
| src/components/project/__tests__/project-context.test.tsx | +6 (added) | it.todo |
| src/components/project/__tests__/project-view-router.test.tsx | 8 | it.todo |
| tests/project-sessions.spec.ts | 11 | test.fixme |

**Vitest total added in Wave 0:** 112 it.todo()
**Playwright total added in Wave 0:** 11 test.fixme()

## i18n Key Additions Per Namespace

Added 30 new keys per locale × 10 locales = **300 new translated strings**.

| Namespace | Keys added | Notes |
|-----------|------------|-------|
| project.sessions.* | 19 keys (title, threadsHeader, runtimeHeader, runtimeClaude, runtimeCodex, runtimeHermes, runtimeGateway, statusRunning, statusFinished, statusFailed, threadEmptyPreview, taskLabel, emptyHeading, emptyBody, emptyCta, errorHeading, errorBody, detailBackLink, loading) | Replaces the 2-key placeholder block; brand names (Claude/Codex/Hermes/Gateway) untranslated; `{ticketRef}` placeholder preserved verbatim |
| project.agents.* | 10 keys (title, listHeader, assignedChip, activeTaskCount, emptyHeading, emptyBody, emptyCta, errorHeading, errorBody, loading) | Replaces the 2-key placeholder block; ICU plural in `activeTaskCount` preserved verbatim across all locales |
| project.common.retry | 1 key | New sibling block for shared error-state retry button |

`project.settings.*` left as 2-key placeholder — out of scope for Phase 5.

## Decisions Made

- **Continued wave-0 it.todo()/test.fixme() pattern from Phases 1–4** — keeps the suite green while every downstream task has a named bucket to fill
- **Embedded mock setup as block comments at the top of each scaffold** — Wave 1/2 agents read the comment, write the implementation, no harness archaeology needed
- **Translated all 10 locales in one atomic commit (Task 1)** — eliminates messages/*.json merge contention across parallel Wave 1 plans
- **Brand names (Claude, Codex, Hermes, Gateway) intentionally untranslated** — they are product identifiers, not localizable strings
- **Settings namespace deferred** — Phase 5 only ships sessions and agents UI; settings stays stubbed
- **`activeTaskCount` ICU plural preserved verbatim per locale** — including =0 / one / other branches with `#` placeholder, matching next-intl's expected syntax exactly

## Deviations from Plan

None — plan executed exactly as written. All 7 tasks completed with the exact file content specified in the plan body (it.todo / test.fixme stubs, no implementations). i18n strings translated using the locale's existing tone/formality (e.g. `"Zugewiesen"` for German "Assigned", formal `です/ます`-equivalent register for Japanese, `معيَّن` for Arabic with the masculine passive form matching surrounding terminology).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All Wave 0 deliverables for Phase 5 land in main; Plans 05-01, 05-02, 05-03 can now run in parallel
- Wave 1 plans (05-01 agents API + view, 05-02 session detail route + scope prop) are unblocked — each has a named test scaffold with mock setup comments
- Wave 2 plan (05-03 sessions list + thread API + E2E) is unblocked — its API test scaffold (`project-sessions.test.ts`), view test scaffold (`sessions-view.test.tsx`), and Playwright spec are already in place
- Locale files frozen for Phase 5 — Wave 1/2 plans must NOT modify messages/*.json (all needed keys already exist)

---
*Phase: 05-sessions-agents*
*Completed: 2026-04-14*

## Self-Check: PASSED

Verified at 2026-04-14T00:55:19Z:

- All 8 created scaffold files exist on disk
- Extended file (project-context.test.tsx) contains the new SESS-03 detailId block
- All 7 task commits exist in `git log`:
  - d6f14c0 feat(05-00): i18n keys
  - fcd79a6 test(05-00): AgentSquadPanel scaffold
  - cbdd469 test(05-00): SessionDetailsPanel scaffold
  - 1a21aa5 test(05-00): API route scaffolds
  - b14dc8b test(05-00): AgentsView + SessionsView scaffolds
  - 3423bae test(05-00): project-context + project-view-router scaffolds
  - 2d85ce2 test(05-00): Playwright E2E scaffold
- `pnpm vitest run` (full suite): 968 passed, 156 todo, 0 failed
- `pnpm exec playwright test --list tests/project-sessions.spec.ts`: 11 tests listed without errors
- All 10 locale files validated via Node JSON.parse + key-existence check
