---
phase: 07-post-audit-gap-closure
plan: 01
subsystem: gap-closure
tags: [flow-e, phase-02-techdebt, timeout-escape, archive-visibility, audit-closure, tdd]

# Dependency graph
requires:
  - phase: 07-post-audit-gap-closure
    provides: "Wave-0 scaffolds (3 loadTimeout* i18n keys × 10 locales, 4 it.todo stubs in project-context.test.tsx, 3 it.todo stubs in projects-archive-behavior.test.ts, Option-2 block comment at the top of the archive-behavior test file)"
provides:
  - "10-second load-timeout escape path in ProjectWorkspaceProvider that surfaces error='load-timeout' + loading=false when Zustand projects[] fails to populate within LOAD_TIMEOUT_MS"
  - "New error branch in project-workspace.tsx rendering loadTimeoutHeading/Body + a Retry button wired to useMissionControl().fetchProjects()"
  - "Multi-line clarifying comment at src/store/index.ts:878-891 quoting the FLOW-E Option-2 decision verbatim so future refactors cannot silently add ?includeArchived=1"
  - "4 real passing it(...) tests covering the timeout's four branches (fires after 10s, does-not-fire on populate, cleanup-on-unmount, cleanup-when-populated-mid-wait)"
  - "3 real passing it(...) tests codifying FLOW-E intentional behavior (exact fetch URL, archived drop-out after refresh, active persistence)"
affects: [07-01-post-audit-gap-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level constant exported for testability (LOAD_TIMEOUT_MS) with in-file AUDIT rationale comment"
    - "vi.useFakeTimers + act + vi.advanceTimersByTime for React setTimeout testing"
    - "global.fetch spy + useMissionControl.setState + useMissionControl.getState().fetchProjects() for Zustand store contract tests"
    - "Decision documentation stored as block comment in production code (store/index.ts) so refactors see intent without needing to consult planning files"

key-files:
  created: []
  modified:
    - src/components/project/project-context.tsx
    - src/components/project/project-workspace.tsx
    - src/store/index.ts
    - src/components/project/__tests__/project-context.test.tsx
    - src/store/__tests__/projects-archive-behavior.test.ts

key-decisions:
  - "Timeout threshold 10_000ms (10 seconds): matches industry-typical network-stall perception and is ≥2× the sub-5s boot budget observed across all 16 prior plans per STATE.md velocity metrics — documented as a comment on LOAD_TIMEOUT_MS"
  - "setTimeout + clearTimeout lives inside the same primary useEffect (not a separate effect): the effect already depends on [slug, projects, setActiveProject], so when projects populates, the effect re-runs, the cleanup fires, clearTimeout runs, and a new branch (happy path) sets state — zero extra dependency surface"
  - "Raw <button> for the Retry control (not the Button component): matches the inline pattern of the not-found error branch for visual consistency between the two error surfaces"
  - "FLOW-E Option-2 comment placed INSIDE fetchProjects() (not as a top-of-function JSDoc): the comment is the whole reason the query string is absent, so it belongs adjacent to the fetch() call it guards"

patterns-established:
  - "AUDIT-<ID> grep-addressable markers for audit-driven gap closures — `grep -r 'AUDIT-PHASE-02-TECHDEBT' src/` surfaces every file touched by this plan"
  - "Decision-in-production-code pattern: the archive-visibility contract lives in (a) the test file (contract + decision header), (b) the production code (Option-2 rationale), (c) SUMMARY.md (this file) — three layers so no single deletion can silently regress the decision"

requirements-completed:
  - AUDIT-FLOW-E
  - AUDIT-PHASE-02-TECHDEBT

# Metrics
duration: 7min
completed: 2026-04-14
---

# Phase 07 Plan 01: Post-Audit Gap Closure Summary

**Closed both v1.0 milestone audit gaps with minimum-viable production change — one new state branch + one comment — and converted all 7 Wave-0 it.todo stubs into real passing tests (4 project-context timeout branches + 3 FLOW-E archive-behavior branches).**

## Performance

- **Duration:** ~7 min (14:42 → 14:49 UTC)
- **Started:** 2026-04-14T14:42:26Z
- **Completed:** 2026-04-14T14:48:59Z
- **Tasks:** 2 / 2
- **Commits:** 3 atomic (1 RED test commit + 1 GREEN production commit + 1 FLOW-E comment+tests commit)
- **Files modified:** 5 (3 production + 2 tests)
- **Files created:** 0

## Accomplishments

### Gap 1 — AUDIT-PHASE-02-TECHDEBT (load-timeout escape path)

- **`src/components/project/project-context.tsx`** gained:
  - `export const LOAD_TIMEOUT_MS = 10_000` constant with in-file AUDIT rationale comment (4-line header citing the 07-01-PLAN.md + STATE.md sub-5s-boot observation).
  - `setTimeout(..., LOAD_TIMEOUT_MS)` inside the primary `useEffect` at the `projects.length === 0` branch. On fire: `setProject(null)` + `setLoading(false)` + `setError('load-timeout')`.
  - `clearTimeout` in the effect's cleanup, ensuring the timer is cleared on: unmount, slug change, OR projects populate (effect re-runs).
- **`src/components/project/project-workspace.tsx`** gained:
  - New `if (error === 'load-timeout')` branch placed between the existing `not-found` branch and the normal shell return.
  - Renders `loadTimeoutHeading` / `loadTimeoutBody` / `loadTimeoutRetry` via `useTranslations('project')` — all three keys pre-wired in Plan 07-00 across 10 locales, zero additional locale work.
  - Retry button calls `useMissionControl().fetchProjects()` on click.
- **`src/components/project/__tests__/project-context.test.tsx`** converted **4 it.todo stubs → 4 real passing it(...) tests**:
  1. Fires after 10_000ms when projects stays empty.
  2. Does NOT fire when projects populates before 10s.
  3. Clears on unmount (no setState-after-unmount).
  4. Clears when projects becomes non-empty mid-wait.
  - Added `vi.mock('@/store', ...)` with `mockProjects` + `setActiveProjectSpy` for isolated hook testing.
  - Wrapped the timeout describe block in `vi.useFakeTimers()` / `vi.useRealTimers()`.

### Gap 2 — AUDIT-FLOW-E (archive-visibility decision comment + tests)

- **`src/store/index.ts`** gained a **14-line clarifying comment** inside `fetchProjects()` at the top of the `try` block, quoting the Option-2 decision verbatim, citing `07-01-PLAN.md`, enumerating the 3 rationale bullets (project-manager-modal.tsx authority, nav-rail/task-board consumer surface, server default parity), and pointing to the contract test file.
- **Zero runtime behavior change** — the `fetch('/api/projects', ...)` call is unchanged. No `?includeArchived=1` added.
- **`src/store/__tests__/projects-archive-behavior.test.ts`** converted **3 it.todo stubs → 3 real passing it(...) tests**:
  1. `fetchProjects()` calls exactly `'/api/projects'` (no query string; `includeArchived` never appears in the URL).
  2. After a PATCH that archives a project, a refresh drops the archived row from `state.projects` while active rows persist.
  3. Pure-active response keeps all active projects in `state.projects` (regression guard).
  - Retained the Plan 07-00 Option-2 block-comment header at the top of the file intact.

### Test suite metrics (baseline → after)

| Metric | Baseline (post Plan 07-00) | After Plan 07-01 | Delta |
|--------|----------------------------|------------------|-------|
| Passing | 1117 | **1124** | **+7** |
| Todo    | 51   | **44**   | **-7** |
| Failed  | 0    | **0**    | **0** |

Exact 7-up-in-passing / 7-down-in-todo matches plan expectation.

## Task Commits

Each task committed atomically using the Conventional Commits convention (no AI attribution per CLAUDE.md):

1. **Task 1 RED — Failing timeout tests** — `9369a8d`
   `test(07-01): add failing tests for load-timeout escape path (AUDIT-PHASE-02-TECHDEBT)`
2. **Task 1 GREEN — Timeout implementation + Retry UI** — `c77c7ab`
   `feat(07-01): add 10s load-timeout escape path to ProjectWorkspaceProvider (AUDIT-PHASE-02-TECHDEBT)`
3. **Task 2 — FLOW-E comment + archive-behavior tests** — `89f7b0e`
   `test(07-01): codify FLOW-E intentional archive behavior with 3 real tests + decision comment (AUDIT-FLOW-E)`

## Files Modified

**Modified (5):**

- `src/components/project/project-context.tsx` — LOAD_TIMEOUT_MS export + AUDIT comment + setTimeout + clearTimeout
- `src/components/project/project-workspace.tsx` — useMissionControl import + fetchProjects destructure + load-timeout branch
- `src/store/index.ts` — 14-line Option-2 decision comment inside fetchProjects (no runtime change)
- `src/components/project/__tests__/project-context.test.tsx` — vi.mock('@/store'), 4 real timeout tests replacing 4 it.todo
- `src/store/__tests__/projects-archive-behavior.test.ts` — full harness + 3 real tests replacing 3 it.todo (Option-2 block comment preserved verbatim)

**Created:** None.

## Decisions Made

### Timeout threshold = 10_000 ms

- **Why:** Matches industry-typical network-stall perception; comfortably above the sub-5s boot sequence observed across all 16 prior plans in STATE.md; closes the hang-forever gap without false-positive on slow-but-healthy connections.
- **Documented where:** In-file comment on the `LOAD_TIMEOUT_MS` constant (`src/components/project/project-context.tsx`).

### setTimeout lives inside the primary useEffect (not a separate effect)

- **Why:** The existing effect already depends on `[slug, projects, setActiveProject]`. When projects populates, the effect re-runs, the cleanup fires first (which `clearTimeout`s), and the new invocation enters the happy-path branch. This gives cleanup-when-populated for free with zero extra state/effect surface.
- **Documented where:** SUMMARY.md key-decisions + implicit in code structure.

### Raw `<button>` for Retry (not the Button component)

- **Why:** Matches the inline `<button>` pattern already used by the `not-found` error branch for visual consistency — both error surfaces share the same minimal-dependency treatment.
- **Documented where:** SUMMARY.md key-decisions.

### FLOW-E decision comment lives inside `fetchProjects()` (not as top-of-function JSDoc)

- **Why:** The comment's entire purpose is to guard the single `fetch('/api/projects')` line it sits immediately above. Placing it as JSDoc would separate it from the code it protects.
- **Documented where:** Plan intent + final comment position at `src/store/index.ts:878-891`.

## Deviations from Plan

### Minor: `grep -c "includeArchived" src/store/index.ts` returns 2 instead of the plan's stated 1

- **Issue:** The plan's acceptance criterion anticipated exactly 1 occurrence ("Do NOT add ?includeArchived=1 here"). The final comment contains TWO mentions of the string: the directive line plus the project-manager-modal rationale line ("project-manager-modal.tsx:68 already fetches ?includeArchived=1 independently").
- **Why this is correct:** Both occurrences are inside the comment block (lines 880 and 884). The deeper intent of the acceptance criterion — "the string only appears inside the comment — NEVER in an actual fetch() call" — is fully satisfied. The `fetch('/api/projects', ...)` call at line 892 has no query string. The criterion's literal count-of-1 was imprecise about the verbatim-Option-2 quote's self-reference to the project-manager-modal fetch.
- **Rule classification:** N/A — plan expectation was slightly miscounted, not a real deviation. No code change required.

No other deviations — both tasks executed exactly as specified with the exact commit messages from the acceptance criteria.

## Issues Encountered

None. TDD flow was clean:
- **RED:** 1 of the 4 new tests failed on first run (the timeout-fires test), confirming the production code was not yet written. The other 3 timeout tests coincidentally passed pre-implementation because they assert the *absence* of state mutations (cleanup-on-unmount) or the happy-path (populates-before-10s) that was already working.
- **GREEN:** After adding `LOAD_TIMEOUT_MS` + `setTimeout` + `clearTimeout`, all 4 timeout tests pass.
- **FLOW-E tests:** All 3 passed on first run because they assert the intentional current behavior — the Wave-1 production change is documentation only.

## User Setup Required

None — no external configuration, no database migration, no new env var.

## Next Phase Readiness

**All v1.0 milestone audit gaps are now closed:**

| Audit item | Status |
|------------|--------|
| AUDIT-FLOW-E — archive visibility ambiguity | **CLOSED** — Option-2 decision committed to production code comment + 3 tests codifying current behavior |
| AUDIT-PHASE-02-TECHDEBT — loading-state has no timeout escape | **CLOSED** — 10s timeout + error branch + Retry UI + 4 tests |

**Optional follow-ups (not in scope for this plan):**
- Manual smoke-test: block `/api/projects` in devtools Network tab, navigate to `/project/anything`, confirm after 10s the Retry UI appears and the button successfully re-fetches.
- The four Nyquist-non-compliant phase VALIDATION.md files flagged in the audit (01, 02, 03, 06) remain for a separate `/gsd:validate-phase` pass — out of scope for gap closure.

## Self-Check

**0 it.todo remaining in either Phase-7-touched test file:**
- `src/components/project/__tests__/project-context.test.tsx`: 5 it.todo (all pre-existing NAV-04 stubs from Phase 2, untouched by this plan)
- `src/store/__tests__/projects-archive-behavior.test.ts`: **0 it.todo** (all 3 converted to real tests) ✓

**Commit verification:**
- `9369a8d` — FOUND in git log (Task 1 RED)
- `c77c7ab` — FOUND in git log (Task 1 GREEN)
- `89f7b0e` — FOUND in git log (Task 2)

**File verification:**
- `src/components/project/project-context.tsx` — FOUND (LOAD_TIMEOUT_MS present, clearTimeout present, load-timeout present)
- `src/components/project/project-workspace.tsx` — FOUND (loadTimeoutHeading/Body/Retry all present, fetchProjects wired)
- `src/store/index.ts` — FOUND (FLOW-E comment at fetchProjects, fetch URL unchanged at line 892)
- `src/components/project/__tests__/project-context.test.tsx` — FOUND (4 new it(...) tests, vi.useFakeTimers used)
- `src/store/__tests__/projects-archive-behavior.test.ts` — FOUND (3 real it(...) tests, 0 it.todo)

**Test-suite verification:**
- `pnpm test --run` — **1124 passed / 44 todo / 0 failed** (baseline 1117 / 51 / 0 → +7 passing, -7 todo exactly)
- `pnpm typecheck` — exit 0
- `pnpm lint` — 0 errors (72 pre-existing warnings in unrelated files)
- `pnpm build` — exit 0

**Self-Check: PASSED**

---
*Phase: 07-post-audit-gap-closure*
*Completed: 2026-04-14*
