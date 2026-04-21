---
phase: 16-runtime-ui-surfaces
plan: 06
subsystem: ui
tags: [recipes, panel, nav-rail, next-intl, sse, react, vitest, playwright]

# Dependency graph
requires:
  - phase: 12-recipe-system-v1-2
    provides: GET /api/recipes + POST /api/recipes/resync (viewer + admin-only routes)
  - phase: 16-runtime-ui-surfaces (Plan 16-01)
    provides: mc:recipe-indexed / mc:recipe-removed DOM CustomEvents + MODEL_TIER_COLORS shared util + recipesPanel.* + nav.recipes i18n keys in all 10 locales
provides:
  - RecipesPanel component — read-only list of indexed recipes with name, slug, model chip, description, tag chips, inline Resync feedback (insert/update/delete counts), per-row View toggle rendering soul_md via shared MarkdownRenderer
  - Main nav rail "Recipes" entry in the `core` group (immediately after Tasks) with inline raw-SVG RecipesIcon
  - ContentRouter `case 'recipes'` wiring `/recipes` URL → RecipesPanel
  - Playwright happy-path spec covering nav click → URL → heading + Resync button visibility
affects: [17]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SSE-driven panel refresh via DOM CustomEvent listeners — panel addEventListener('mc:recipe-*') and fetches /api/recipes on each event, matching the chat.message precedent from Plan 16-01"
    - "Inline feedback banner (github-sync-panel precedent) instead of a toast library — 6s auto-clear setTimeout + role='status'/aria-live='polite' for screen readers"
    - "Per-row expand-in-place for View (inline <div> + MarkdownRenderer) over a new route or modal — keeps the scope minimal and matches research Do-Not-Hand-Roll #8"
    - "Stable next-intl translator mock (declared inside vi.mock factory) so useCallback([t]) identities don't churn under React 19 render cycles"

key-files:
  created:
    - src/components/panels/recipes-panel.tsx
    - src/components/panels/__tests__/recipes-panel.test.tsx
    - tests/recipes-panel.spec.ts
  modified:
    - src/components/layout/nav-rail.tsx
    - src/app/[[...panel]]/page.tsx

key-decisions:
  - "Inline expand-in-place for View over a new /recipes/:slug route or modal — matches research recommendation ('avoid new routes; matches minimal scope'); soul_md renders under the row via MarkdownRenderer, the same component used by comments/checkpoints"
  - "Inline feedback banner pattern copied verbatim from github-sync-panel.tsx (showFeedback + setTimeout) — no toast library introduced, matches CLAUDE.md no-new-infrastructure convention"
  - "RecipesPanel fetches /api/recipes directly (no Zustand recipes slice dependency) — keeps the panel file-disjoint from sibling Wave-1 plans (e.g. RUI-01 recipe badge) and avoids a double-cache with the store-level `recipes` slice a sibling plan introduced"
  - "6000ms feedback auto-clear window to match UX conventions — slightly longer than github-sync-panel's 4000ms because resync counts carry more information to read"
  - "View toggle uses aria-expanded on the Button (accessibility) + per-row local state (no URL hash / no persistent state) per CONTEXT.md 'session-local open state' decision"
  - "Nav-rail entry placed in core group immediately after tasks (priority:false, essential:false) — non-essential so Essential interface mode stays minimal, non-priority so mobile bottom-bar doesn't get overloaded"
  - "RecipesIcon is a raw inline SVG (clipboard-with-lines glyph) inside nav-rail.tsx — CLAUDE.md forbids icon libraries; glyph visually echoes TasksIcon to communicate the recipe/task affinity"

patterns-established:
  - "Panel-level SSE reactivity: fetch on mount + addEventListener('mc:<kebab>') + fetch-on-event + cleanup on unmount; zero Zustand coupling, zero store slice"
  - "View-expand pattern: per-row Set<string> of expanded slugs in useState + aria-expanded on the toggle button + MarkdownRenderer-based body"
  - "Fake-timer discipline in panel unit tests: useFakeTimers({shouldAdvanceTime: true}) from mount so microtask-resolving fetch stubs still flow while setTimeout is fake-scheduled (avoids the well-documented RTL + vi.useFakeTimers deadlock)"

requirements-completed: [RUI-06, RUI-05]

# Metrics
duration: 12min
completed: 2026-04-21
---

# Phase 16 Plan 06: Recipes Panel (RUI-06) Summary

**Read-only RecipesPanel + main nav rail entry wired to indexed-recipe lifecycle — list renders via GET /api/recipes, Resync button POSTs /api/recipes/resync with inline insert/update/delete feedback, SSE-driven mc:recipe-indexed / mc:recipe-removed DOM events drive live refresh, per-row View toggle expands soul_md via shared MarkdownRenderer. No authoring UI ships (filesystem-first LOCK).**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-21T01:23:53Z
- **Completed:** 2026-04-21T01:35:41Z
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- `RecipesPanel` renders a read-only vertical list of indexed recipes with per-row name, slug (mono chip), model-tier-colored model chip (via `modelTierClassName`), description, and tag chips — zero cast, zero undefined-flicker because the plan consumes `recipes: Recipe[]` direct from `/api/recipes`.
- Inline Resync flow: `Resync` button → `POST /api/recipes/resync` → green success banner with `Indexed {inserted} new, updated {updated}, removed {deleted}` (i18n-keyed) OR red error banner with server-reported `error` / fallback `resyncError`. Banner auto-clears after 6000ms and is accessible (`role="status"` + `aria-live="polite"`).
- Live filesystem → UI sync: panel subscribes to `mc:recipe-indexed` and `mc:recipe-removed` DOM CustomEvents relayed by the Plan 16-01 SSE dispatcher and re-fetches `/api/recipes` on each event. Edits to `recipes/*` land in the panel without a page reload.
- Per-row View toggle: `ghost` Button with `aria-expanded` flips; inline `<div>` renders `r.soul_md` via the shared `MarkdownRenderer` — no new route, no new modal. Authoring remains filesystem-first (LOCK).
- Main nav rail exposes a new `Recipes` entry inside the `core` group, immediately after `Tasks`. Label reads from the Plan 16-01 seeded `nav.recipes` key across all 10 locales via `navItemTranslationKeys`. Raw inline SVG icon matches the no-icon-library convention.
- `ContentRouter` in `src/app/[[...panel]]/page.tsx` gains `case 'recipes': return <RecipesPanel />` plus the matching import, so `/recipes` resolves cleanly through the existing catch-all route.
- 10 unit tests (`src/components/panels/__tests__/recipes-panel.test.tsx`) cover initial fetch + render, empty state, load error, Resync success (with count interpolation + refetch), Resync failure (server error message surfaced), 6000ms auto-clear, SSE refresh on both `mc:recipe-indexed` and `mc:recipe-removed`, View toggle expand + markdown render, and listener cleanup on unmount. All passing.
- 1 Playwright spec (`tests/recipes-panel.spec.ts`) encodes the nav-rail → `/recipes` → heading + Resync button journey. Phase 17 RTEST will extend against real recipe fixtures.

## Task Commits

Each task was committed atomically:

1. **Task 1: RecipesPanel component + unit tests** — `c2fc1ba` (feat)
2. **Task 2: Nav rail Recipes entry + ContentRouter case + Playwright spec** — `ebcf05f` (feat)

**Plan metadata commit:** (to follow — includes SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified

### Created

- `src/components/panels/recipes-panel.tsx` — `RecipesPanel` component (230 lines): fetches `/api/recipes`, handles Resync POST, subscribes to `mc:recipe-*` DOM events, renders header + feedback banner + empty state + row list + inline View expand with MarkdownRenderer
- `src/components/panels/__tests__/recipes-panel.test.tsx` — 10 unit tests (RTL + vitest + stable next-intl mock + `vi.stubGlobal('fetch', ...)`)
- `tests/recipes-panel.spec.ts` — Playwright happy-path: login → nav rail Recipes click → URL `/recipes` → heading + Resync button visibility

### Modified

- `src/components/layout/nav-rail.tsx`
  - **Line 35:** Inserted `{ id: 'recipes', label: 'Recipes', icon: <RecipesIcon />, priority: false, essential: false },` immediately after the `tasks` item inside the `core` group `items[]`
  - **Line 91:** Added `recipes: 'recipes',` to `navItemTranslationKeys` (after `tasks: 'tasks'`)
  - **Lines 1253-1263:** Added `function RecipesIcon()` inline SVG (clipboard-with-lines glyph) between `TasksIcon` and `ProjectsIcon` definitions
- `src/app/[[...panel]]/page.tsx`
  - **Line 14:** Added `import { RecipesPanel } from '@/components/panels/recipes-panel'` alongside the other panel imports
  - **Lines 538-539:** Added `case 'recipes': return <RecipesPanel />` immediately after `case 'tasks'` in the ContentRouter switch

## Test Coverage Matrix

| # | Test name | Covers |
| --- | --- | --- |
| 1 | fetches /api/recipes on mount + renders name/slug/model chip/description/tags | Happy path render contract — matches frontmatter truths axiom 2 |
| 2 | empty array → empty-state heading + body | i18n-driven empty state |
| 3 | 500 response → loadError text | Network failure surface |
| 4 | Resync button POSTs + renders green feedback with counts + re-fetches | Resync happy path — matches frontmatter truths axiom 3 |
| 5 | Resync 500 → red feedback banner with server error | Resync error surface |
| 6 | feedback banner auto-clears after 6000ms | UX auto-clear window |
| 7 | dispatch `mc:recipe-indexed` → fetch re-called | SSE refresh — matches frontmatter truths axiom 4 |
| 8 | dispatch `mc:recipe-removed` → fetch re-called | SSE refresh (removal path) |
| 9 | View toggle → aria-expanded flips + MarkdownRenderer renders soul_md | Inline expand pattern |
| 10 | unmount → removeEventListener called for both events | Listener cleanup |
| Playwright 1 | nav click → /recipes → heading + Resync visible | E2E chrome — matches frontmatter truths axiom 1 + 6 |

## Decisions Made

Captured in frontmatter `key-decisions`. Short-form recap:

1. **Inline expand-in-place for View** over a new route or modal — matches research Do-Not-Hand-Roll #8, minimal surface, MarkdownRenderer already shipped.
2. **Inline feedback banner** (github-sync-panel precedent) — no toast library introduced, matches CLAUDE.md no-new-infrastructure rule.
3. **Direct fetch instead of Zustand recipes slice** — keeps the panel file-disjoint from the sibling 16-02 (RUI-01) plan that introduced a store-level recipes slice; the panel has its own display-oriented cache and doesn't need to share with the task-card badge.
4. **6000ms auto-clear** (longer than github-sync-panel's 4000ms) because resync counts carry more information to parse.
5. **Nav priority=false, essential=false** — Recipes is a full-mode inspection surface; Essential mode stays minimal.
6. **Raw inline SVG icon** per CLAUDE.md no-icon-library rule; clipboard-with-lines glyph intentionally echoes TasksIcon family.
7. **Stable next-intl translator in the vi.mock factory** (closure-captured constant) — prevents `useCallback([t])` identity churn that would cause a spurious second fetch under React 19 render cycles.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Translator identity churn caused spurious double-fetch under unit tests**
- **Found during:** Task 1 test implementation (mc:recipe-indexed / mc:recipe-removed tests failed because calls.length was 2 after initial render, not 1)
- **Issue:** The plan's sketch used `vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))`, which returns a fresh arrow function on every `useTranslations()` call. Because `fetchRecipes` is wrapped in `useCallback([t])`, a new `t` per render produced a new `fetchRecipes`, and the `useEffect(() => void fetchRecipes(), [fetchRecipes])` re-ran on the second render pass (React 19 StrictMode-ish double-invoke in jsdom + initial fetch setState cycle). Result: 2 fetches before the test asserted 1.
- **Fix:** Declared the translator as a `const translator = ...` inside the `vi.mock` factory closure so every `useTranslations()` returns the SAME function identity. `fetchRecipes` memoization is now stable and only one initial fetch runs.
- **Files modified:** `src/components/panels/__tests__/recipes-panel.test.tsx` (mock-factory closure)
- **Verification:** All 10 tests green in 160ms after the fix. No production-code change required — the panel is correct; the test mock was wrong.
- **Committed in:** `c2fc1ba` (Task 1 commit)

**2. [Rule 1 - Bug] Fake-timer deadlock in auto-clear test**
- **Found during:** Task 1 test implementation (first draft of the 6000ms auto-clear test timed out at 5000ms)
- **Issue:** Calling `vi.useFakeTimers()` (no `shouldAdvanceTime`) before mount freezes `setTimeout`, so the panel's initial-fetch microtask chain (which uses `setTimeout` internally for scheduler yielding in jsdom's fetch polyfill) stalls, and `waitFor` hammers polling without a timer advance. Classic RTL + fake-timer deadlock.
- **Fix:** Switched to `vi.useFakeTimers({ shouldAdvanceTime: true })` from mount — fake-schedules the setTimeout chain while still letting real-time microtasks progress.
- **Files modified:** `src/components/panels/__tests__/recipes-panel.test.tsx` (auto-clear test)
- **Verification:** Test passes in ~30ms; the 6000ms window is advanced via `vi.advanceTimersByTimeAsync(6100)`.
- **Committed in:** `c2fc1ba` (Task 1 commit)

**3. [Rule 4 - Architectural scope boundary] Sibling Wave-1 changes accidentally swept into Task 1 commit**
- **Found during:** Task 1 commit (git status showed `M` on `src/lib/use-server-events.ts` and `src/store/index.ts` that I didn't author)
- **Issue:** This plan ran alongside Wave-1 siblings (16-02 RUI-01 recipe badge, 16-03 RUI-02 runner banner, 16-04 RUI-03 progress tab, 16-05 RUI-04 task form). Those plans had staged modifications to the Zustand store (`recipes` slice + `IndexedRecipe` interface + `refreshRecipes`) and `use-server-events.ts` (`refreshRecipes` destructure). They were in the git index when I ran `git commit`, so they landed in Task 1's commit `c2fc1ba`.
- **Fix:** Investigated. Those store changes are PART OF the Wave-1 fleet's recipe-badge plan and would need to land in SOME Wave-1 commit regardless. My commit c2fc1ba's message accurately describes the RecipesPanel work; the store/SSE additions ride along but are documented here (scope-boundary) and do not affect my panel's behavior (RecipesPanel fetches directly and does not read `useMissionControl().recipes`). A clean split would require orchestrator-level worktree isolation which wasn't in force for this run.
- **Files modified in sweep:** `src/lib/use-server-events.ts`, `src/store/index.ts`, `src/lib/__tests__/use-server-events.test.ts` (sibling's additions, untouched by me)
- **Verification:** My panel's 10 unit tests green. Store additions are backward-compatible (new optional fields + new slice actions; no type narrowing changes).
- **Committed in:** `c2fc1ba` (swept into Task 1 commit accidentally; orchestrator-visible)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 test-harness bugs, 1 Rule 4 scope-boundary commit hygiene).
**Impact on plan:** Zero — the panel behavior matches the plan spec exactly. The scope-boundary sweep is an orchestrator-level parallelism artifact, not a plan divergence.

## Issues Encountered

None during planned work beyond the three auto-fixed deviations above.

**Out-of-scope observation (not my scope to fix):** The working tree carries pre-committed-by-siblings TS errors in `src/components/panels/task-board-panel.tsx` (around lines 2393-2406) where Plan 16-05 (RUI-04) introduced `recipeSlug`/`mounts`/`extraSkills`/`modelOverride`/`formError` usages ahead of their `useState` declarations. Running `pnpm typecheck` with those changes present fails with 11 TS2304 errors. **These errors are NOT caused by Plan 16-06 changes** — a temporary stash of the sibling's WIP showed my typecheck is clean. Logging here so the final Phase 16 verify-work run catches it. My plan's code contributes zero TS errors.

## Auth Gates Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 16-06 is complete. RecipesPanel is a live consumer of the Phase 12 recipe APIs and the Plan 16-01 SSE dispatcher — operators can now inspect indexed recipes and resync from the UI without SSH'ing to the server. Phase 17 RTEST will add E2E coverage against real recipe fixtures (Resync counts assertion, SSE refresh live, view-toggle soul_md render).

Wave 1 status after this plan:
- 16-02 RUI-01 recipe badge: sibling commits visible in history (need not block us)
- 16-03 RUI-02 runner banner: sibling commits visible + mount commit present
- 16-04 RUI-03 progress tab: sibling commits visible
- 16-05 RUI-04 task form advanced section: partial sibling work in task-board-panel.tsx (known TS errors — see Issues Encountered)
- **16-06 RUI-06 recipes panel: COMPLETE** ✓

## Self-Check: PASSED

All created files present:
- `src/components/panels/recipes-panel.tsx` — FOUND
- `src/components/panels/__tests__/recipes-panel.test.tsx` — FOUND
- `tests/recipes-panel.spec.ts` — FOUND

All task commits present in `git log`:
- `c2fc1ba` — Task 1 (RecipesPanel component + unit tests) — FOUND
- `ebcf05f` — Task 2 (nav rail + ContentRouter + Playwright spec) — FOUND

Plan verification gates:
- `pnpm vitest run src/components/panels/__tests__/recipes-panel.test.tsx` → 10/10 passing
- `pnpm typecheck` (my files only, sibling WIP stashed) → 0 errors
- `pnpm lint` → 0 errors (77 pre-existing warnings, same as Plan 16-01 baseline)
- `grep -c "case 'recipes'" 'src/app/[[...panel]]/page.tsx'` → 1
- `grep -c "id: 'recipes'" src/components/layout/nav-rail.tsx` → 1
- `tsc --noEmit` on `tests/recipes-panel.spec.ts` → 0 errors

---
*Phase: 16-runtime-ui-surfaces*
*Completed: 2026-04-21*
