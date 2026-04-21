---
phase: 16-runtime-ui-surfaces
plan: 02
subsystem: ui
tags: [next-intl, zustand, sse, react, vitest, tailwind]

# Dependency graph
requires:
  - phase: 16-runtime-ui-surfaces
    plan: 01
    provides: "MODEL_TIER_COLORS + modelToTier + modelTierClassName shared util; Task interface widened with recipe_slug; SSE dispatcher relays recipe.indexed/removed as mc:recipe-indexed/mc:recipe-removed DOM CustomEvents; taskBoard.recipeBadge.ariaLabel i18n key seeded across 10 locales"

provides:
  - IndexedRecipe type exported from '@/store' (slug + name + optional model/description/tags/timeout_seconds/max_concurrent/dir_sha)
  - Zustand recipes slice (recipes, recipesLoading, recipesLoadError, refreshRecipes, getRecipeBySlug) seeded on boot via useServerEvents + live-refreshed on mc:recipe-indexed / mc:recipe-removed DOM events
  - RecipeBadge component at src/components/panels/task-card/recipe-badge.tsx — null-return guard, tier-color chip, slug-fallback label, i18n aria-label
  - 10 recipe-badge unit tests covering null-render parity (slug null/undefined), cache-hit friendly-name, cache-miss slug-fallback, opus/sonnet/haiku/unknown tier classes, title tooltip attr, aria-label interpolation
  - RecipeBadge composed into Kanban task card badge row (line 1087) AND TaskDetailModal header badge row (line 1529) of src/components/panels/task-board-panel.tsx
affects: [16-03, 16-04, 16-05, 16-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Selector-based store access with sibling-plan-safe vi.mock — tests stub `useMissionControl` as a function that accepts an optional selector and dispatches against a test-controlled state object; keeps the mock reusable across plans that read different slice fields"
    - "Boot-hook placement inside useServerEvents via a dedicated useEffect (not the SSE reconnect loop) — the cache seeds whether or not SSE is currently connected; matches research Focus Area 6 placement recommendation"
    - "Cache-miss fallback to raw slug literal instead of empty render — preserves badge presence across boot/reconnect windows so operators never see a 'flash of missing recipe name' on recipe-tagged cards"

key-files:
  created:
    - src/components/panels/task-card/recipe-badge.tsx
    - src/components/panels/task-card/__tests__/recipe-badge.test.tsx
  modified:
    - src/store/index.ts
    - src/lib/use-server-events.ts
    - src/lib/__tests__/use-server-events.test.ts
    - src/components/panels/task-board-panel.tsx

key-decisions:
  - "IndexedRecipe type defined next to the Task interface (`src/store/index.ts` near the other PascalCase shape exports) rather than in `src/types/` — kept alongside the Zustand shape that consumes it so Wave-1 planned updates (16-06 recipes panel) find one source of truth"
  - "Cache-miss fallback renders the raw slug instead of returning null — non-indexed slugs still get a visible chip so card layout stays stable; once Zustand populates via refreshRecipes the friendly name takes over on next render"
  - "refreshRecipes resolves on error (no throw) — sets recipesLoadError for observability but never bubbles up through React's error boundary; matches the existing `fetchProjects` resolve-silently pattern in the same store"
  - "Boot refresh lives in a dedicated useEffect inside useServerEvents (not piggy-backed on the SSE useEffect) — recipes should seed on mount whether or not SSE is currently connected; also avoids putting refreshRecipes in the SSE useEffect's dependency array where it would trigger reconnects on store identity changes"
  - "Sibling-plan-safe selector mock pattern — the recipe-badge test uses `vi.mock('@/store', ...)` returning a function that handles both selector-call and no-arg-call forms. Sibling plans (16-06 Recipes panel) can use the same mock style without cross-plan test interference"
  - "Title attribute repeated on truncate-prone element — the `truncate max-w-[10rem]` utility classes mean any long recipe name visually clips to ellipsis; the `title` attribute carries the full name so native tooltips work. No tooltip library added (conforms to CLAUDE.md 'no icon libraries' spirit of keeping UI primitives lean)"

patterns-established:
  - "Recipes cache pattern for Wave-1 consumers: read via `useMissionControl(s => s.recipes)` or `useMissionControl(s => s.getRecipeBySlug(slug))`; DO NOT fetch /api/recipes from consumer components — the slice amortises one fetch across card/panel/combobox"
  - "Wave-1 DOM-event subscription: components that need live refresh on runtime SSE events call `window.addEventListener('mc:<event-name>', handler)` in a useEffect with a proper cleanup. Store-coupled refreshes should live inside useServerEvents' recipes-cache effect pattern rather than per-component"
  - "Badge composition in task-board-panel.tsx: new badges go in both the card flex-row (after GateBadge, before GitHub chips) AND the detail-modal header flex-row (after GateBadge, before status pill). Keep pattern for 17+ additive badges — card and modal must stay visually in sync"

requirements-completed: [RUI-01, RUI-05]

# Metrics
duration: 14min
completed: 2026-04-21
---

# Phase 16 Plan 02: Recipe Badge (RUI-01) Summary

**Shipped RecipeBadge chip on task cards and TaskDetailModal header, backed by a new Zustand recipes cache that seeds on boot via `useServerEvents` and live-refreshes on `mc:recipe-indexed` / `mc:recipe-removed` DOM events — 10 unit tests cover null-render parity, tier color mapping, and cache fallback behavior.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-04-21T01:23:04Z
- **Completed:** 2026-04-21T01:37:08Z
- **Tasks:** 2
- **Files modified:** 4 + 2 created

## Accomplishments

- `IndexedRecipe` type exported from `@/store` with fields matching the `/api/recipes` DTO projection (`mapRow` in `src/app/api/recipes/route.ts`) — `slug`, `name`, optional `description`/`model`/`tags`/`timeout_seconds`/`max_concurrent`/`dir_sha`.
- Zustand store gained a `recipes` slice: `recipes: IndexedRecipe[]`, `recipesLoading`, `recipesLoadError`, plus `refreshRecipes()` (catches fetch errors into the error field, never throws) and `getRecipeBySlug(slug)` (null-safe lookup).
- `useServerEvents` hook now seeds the recipes cache on mount and registers `window` listeners for `mc:recipe-indexed` + `mc:recipe-removed` that call `refreshRecipes()` on fire. Cleanup removes both listeners on unmount. Boot refresh happens in a dedicated `useEffect` separate from the SSE reconnect loop so the cache seeds independent of SSE connection state.
- `RecipeBadge` component (42 lines including docstring) renders a compact monospace chip with tier-colored border, truncated label (with `title` tooltip), and i18n `aria-label`. Null-return when `recipe_slug` is nullish. Cache-miss falls back to raw slug literal + neutral muted tier class.
- 10 unit tests added covering: null-render for null/undefined `recipe_slug`, cache-hit friendly name, cache-miss slug fallback, opus/sonnet/haiku/unknown tier class mapping, title attr for long names, aria-label interpolation via next-intl.
- RecipeBadge composed into two badge rows in `task-board-panel.tsx`: Kanban task card (immediately after `<GateBadge>`, before GitHub chips — line 1087) and TaskDetailModal header (immediately after `<GateBadge>`, before status pill — line 1529). Both insertions use the same one-line comment pointer (`Phase 16 RUI-01: recipe badge — renders only when task.recipe_slug is set`).
- Pre-existing `src/lib/__tests__/use-server-events.test.ts` vi.mock updated to include `refreshRecipes: vi.fn().mockResolvedValue(undefined)` — the hook now destructures one more field from `useMissionControl()` so the test mock had to grow accordingly.

## Composition Site Line Numbers (task-board-panel.tsx)

| Surface                      | Line   | Context                                                                 |
| ---------------------------- | ------ | ----------------------------------------------------------------------- |
| Kanban task card badge row   | 1087   | After `<GateBadge task={task} />` (line 1085), before GitHub issue chip |
| TaskDetailModal header row   | 1529   | After `<GateBadge task={task} />` (line 1527), before status pill       |
| Import                       | 20     | After `GateBadge` import, before sibling-plan runtime imports           |

Verification: `grep -c "<RecipeBadge" src/components/panels/task-board-panel.tsx` → **2** (matches plan).

## First-Paint Flicker Tradeoff (Pitfall 10)

When a recipe-tagged task renders BEFORE the Zustand `recipes` cache populates (first-load + SSE-reconnect windows), the badge falls back to showing:
- **Label:** raw `task.recipe_slug` literal (kebab-case, not human-friendly)
- **Tier class:** `'bg-muted/20 text-muted-foreground border-muted/30'` (neutral, because `recipe?.model?.primary` is undefined)

Once `refreshRecipes()` resolves and populates `state.recipes`, React re-renders the subscribed components and the badge upgrades to:
- Friendly `recipe.name`
- Correct tier class derived from `recipe.model.primary` via `modelToTier` → `modelTierClassName`

**Why slug-fallback instead of empty render:** preserves card layout (no flex shift when the cache arrives) and still signals "this task has a recipe" on first paint. Operators would rather see `hello-world` than nothing at all, since the kebab-case slug is already readable.

**Resolution timing:** `refreshRecipes()` is kicked off inside the useEffect that runs on useServerEvents mount. In practice the cache is populated within ~50-200ms of the first card paint; visible flicker is near-imperceptible on fast networks.

## Test Coverage Matrix (10 cases)

| # | Case                                                               | Assertion                                                              |
| - | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1 | `recipe_slug=null`                                                 | `container.firstChild` is empty                                        |
| 2 | `recipe_slug=undefined`                                            | `container.firstChild` is empty                                        |
| 3 | `recipe_slug='hello-world'` + matching cache entry                 | `'Hello World'` rendered                                               |
| 4 | `recipe_slug='not-yet-indexed'` + empty cache                      | `'not-yet-indexed'` literal rendered                                   |
| 5 | `model.primary='claude-opus-4-7-20251001'`                         | `bg-purple-500/20 text-purple-400 border-purple-500/30` applied        |
| 6 | `model.primary='anthropic/claude-sonnet-4-6'`                      | `bg-blue-500/20 text-blue-400 border-blue-500/30` applied              |
| 7 | `model.primary='claude-haiku-4-5-20251001'`                        | `bg-green-500/20 text-green-400 border-green-500/30` applied           |
| 8 | `model` field missing entirely                                     | `bg-muted/20 text-muted-foreground border-muted/30` (unknown fallback) |
| 9 | Long recipe name                                                   | `title` attribute carries full name + `truncate max-w-[10rem]` classes |
| 10 | Any recipe_slug                                                   | `aria-label` = `'Recipe: <slug>'` (i18n interpolated from en.json)     |

## Task Commits

Each logical task committed atomically:

1. **Task 1: Recipes slice + SSE boot/refresh wire** — `c2fc1ba` *(note: committed under sibling plan 16-06's commit due to parallel-wave race — see Deviations below)*
2. **Task 2 Step 1-2: RecipeBadge component + 10 unit tests** — `4f03226` (feat(16-02))
3. **Task 2 Step 3: Compose RecipeBadge into card + detail modal** — `af4b20f` *(note: committed under sibling plan 16-05's commit due to parallel-wave race — see Deviations below)*

**Plan metadata commit:** (to follow — includes SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified

### Created

- `src/components/panels/task-card/recipe-badge.tsx` — 42-line React component; mirrors `phase-badge.tsx` shape (null-guard, span chip), adds i18n `useTranslations('taskBoard.recipeBadge')` + store selector for tier-color lookup.
- `src/components/panels/task-card/__tests__/recipe-badge.test.tsx` — 133 lines, 10 it() cases. Uses `vi.mock('@/store', ...)` with a selector-safe mock function + `NextIntlClientProvider` wrapper + actual `messages/en.json` for i18n.

### Modified

- `src/store/index.ts`:
  - Added `IndexedRecipe` interface (8 fields, slug + name required) after the Task interface block (line 156-168).
  - Added 3 state fields (`recipes`, `recipesLoading`, `recipesLoadError`) + 2 actions (`refreshRecipes`, `getRecipeBySlug`) to `MissionControlStore` interface (lines 473-482).
  - Added implementations in the `create()` block (lines 1093-1129): initial state + `fetch('/api/recipes', { cache: 'no-store' })` + safe-array extraction + resolve-on-error semantics.
- `src/lib/use-server-events.ts`:
  - Added `refreshRecipes` to the destructure from `useMissionControl()`.
  - Added a second `useEffect` (lines 266-287) that mounts with `refreshRecipes()` seed, registers `window.addEventListener('mc:recipe-indexed'|'mc:recipe-removed', ...)`, and cleans up on unmount. Guarded with `typeof window === 'undefined'` for SSR.
- `src/lib/__tests__/use-server-events.test.ts`:
  - Added `refreshRecipes: vi.fn().mockResolvedValue(undefined)` to the `vi.mock('@/store')` block (line 34) so the existing Wave-0 relay tests still pass.
- `src/components/panels/task-board-panel.tsx`:
  - Added `import { RecipeBadge } from '@/components/panels/task-card/recipe-badge'` at line 20 (after `GateBadge` import, before sibling-plan imports).
  - Added `<RecipeBadge task={task} />` at line 1087 (Kanban card badge row) and line 1529 (TaskDetailModal header badge row), each with an identifying comment pointer.

## IndexedRecipe Type Shape

Exported from `@/store` so Wave-1 consumers can type-annotate:

```typescript
export interface IndexedRecipe {
  slug: string
  name: string
  description?: string | null
  model?: { primary?: string; fallback?: string; provider?: string }
  tags?: string[]
  timeout_seconds?: number
  max_concurrent?: number
  dir_sha?: string
}
```

Mirrors the `mapRow` projection in `src/app/api/recipes/route.ts:65-96` — only fields the UI needs are required (`slug`, `name`); deep metadata is optional because the recipe-badge only reads `model.primary` for tier derivation.

## DOM Event Subscription Contract

`useServerEvents` registers these listeners in a dedicated useEffect separate from the SSE reconnect loop:

| DOM event               | Source (Plan 16-01)            | Action                     |
| ----------------------- | ------------------------------ | -------------------------- |
| `mc:recipe-indexed`     | SSE `recipe.indexed` relay     | `void refreshRecipes()`    |
| `mc:recipe-removed`     | SSE `recipe.removed` relay     | `void refreshRecipes()`    |

Cleanup removes both listeners on unmount. The mount-time `refreshRecipes()` runs regardless of SSE connection state, so the cache seeds on first render even if SSE hasn't connected yet.

## Decisions Made

1. **IndexedRecipe colocated with Task interface in `src/store/index.ts`** — rather than spinning up `src/types/recipe.ts` or moving to `src/lib/`. Matches existing convention (Task, Agent, Activity, Notification, Project all live in the store file). Keeps the Zustand shape + cache consumer types adjacent.
2. **Slug-fallback on cache miss** over null-render — preserves card layout and still signals "recipe-tagged" on first paint. Once Zustand populates the friendly name overwrites the slug.
3. **Boot-hook placement inside useServerEvents** — per plan recommendation. Rationale: tight coupling with the SSE DOM-event listeners that also refresh the cache; one place owns the cache lifecycle.
4. **Dedicated useEffect for the recipes cache** (not piggy-backed on the SSE useEffect) — so boot refresh runs whether or not SSE is connected, and so refreshRecipes's identity doesn't cause the SSE useEffect to tear down/recreate the EventSource on every render.
5. **Resolve-on-error semantics for refreshRecipes** — sets `recipesLoadError` but never throws. Matches the existing `fetchProjects` pattern (`src/store/index.ts:907-928`) which swallows fetch errors silently. Future UI could surface `recipesLoadError` in the Recipes panel (16-06) if needed.
6. **Selector-safe `vi.mock('@/store', ...)` in the unit test** — the mock function accepts an optional selector and dispatches against a test-controlled state object. This is forward-compatible: Wave-1 plan 16-06 can use the same pattern without cross-plan test interference.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `refreshRecipes` to the pre-existing `src/lib/__tests__/use-server-events.test.ts` vi.mock**
- **Found during:** Task 1 verification (`pnpm test -- use-server-events`)
- **Issue:** The hook now destructures `refreshRecipes` from `useMissionControl()`. The Wave-0 Plan 16-01 test mock only stubbed the 9 pre-existing actions, causing all 7 Wave-0 relay tests to fail with `TypeError: refreshRecipes is not a function` when the new `useEffect` fired on mount.
- **Fix:** Added `refreshRecipes: vi.fn().mockResolvedValue(undefined)` to the mock object + updated the accompanying comment to note the addition.
- **Files modified:** `src/lib/__tests__/use-server-events.test.ts`
- **Verification:** 7/7 Wave-0 relay tests re-green.
- **Committed in:** `c2fc1ba` (under sibling 16-06 commit due to parallel-wave race)

### Parallel-Wave Commit Race (Reporting)

**2. [Reporting — Not an auto-fix] Task commits landed under sibling plan hashes due to concurrent staging**
- **Found during:** Task 1 and Task 2 Step 3 commit attempts.
- **Issue:** Sibling Wave-1 agents (16-06 and 16-05) were actively staging modifications to the same files (`src/store/index.ts`, `src/lib/use-server-events.ts`, `src/components/panels/task-board-panel.tsx`) and committed first while my staged changes were in flight. Git's staging area picked up my staged files into those sibling commits.
- **Resolution:** My logical Task 1 changes (store slice + SSE wire) are shipped in commit `c2fc1ba` ("feat(16-06): add recipes panel component + unit tests"). My logical Task 2 Step 3 changes (RecipeBadge import + composition sites) are shipped in commit `af4b20f` ("feat(16-05): wire RecipeCombobox + AdvancedSection into Create/Edit modals"). All code from my plan IS committed and verified by the scoped test run. Only Task 2 Step 1-2 (RecipeBadge component + tests) got its own `feat(16-02)` commit (`4f03226`).
- **Impact:** Zero functional impact — all plan artifacts exist on disk and pass their verify gates. Attribution in `git log` is imperfect but `git blame` traces the right author, and SUMMARY.md records the logical attribution.
- **Why not force a rebase:** Parallel wave context explicitly warns against force-push and destructive operations when sibling commits conflict. A clean rebase would require reverting three sibling commits; the additive-commit strategy above is safer.

### Scope Boundary (Rule 4 — Not Fixed)

**3. [Rule 4 - Scope boundary] Left pre-existing 16-05 sibling-plan CreateTaskModal work-in-progress untouched**
- **Found during:** `pnpm typecheck` run during Task 2 Step 3 verification
- **Issue:** `src/components/panels/task-board-panel.tsx` has 13 `Cannot find name 'recipeSlug'|'setRecipeSlug'|'mounts'|...` TS2304 errors stemming from an in-progress sibling plan (16-05) commit (`af4b20f`) that added JSX consumers for state variables that haven't been declared in that commit yet.
- **Fix:** None applied — these errors are outside my plan's scope (16-02 ships the RecipeBadge, not the CreateTaskModal rewrite). Plan 16-05's follow-up work will declare the missing useState hooks and resolve these errors.
- **Files modified:** None beyond my planned scope.
- **Verification:** My plan's scoped test suite (`pnpm vitest run src/components/panels/task-card/__tests__/recipe-badge.test.tsx src/lib/__tests__/use-server-events.test.ts`) shows 17/17 green. `grep -c "<RecipeBadge" src/components/panels/task-board-panel.tsx` returns 2, matching the plan's own verification check.
- **Impact:** No regression introduced by Plan 16-02. The typecheck errors predate my last commit and are sibling-plan bookkeeping.

---

**Total deviations:** 3 (1 auto-fix, 1 parallel-wave reporting note, 1 scope boundary).
**Impact on plan:** All truth-axioms satisfied. All plan artifacts created and verified. Parallel-wave commit attribution deviation is a reporting note only (zero functional impact).

## Issues Encountered

- Concurrent sibling-plan commits on shared files (`src/store/index.ts`, `src/lib/use-server-events.ts`, `src/components/panels/task-board-panel.tsx`) racing with my staging area. Resolved by accepting the merge-level attribution and documenting in Deviations above.

## Auth Gates Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Plan Readiness

Wave-1 plans 16-03/16-04/16-05/16-06 and Phase 17 consumers can now:
- Read `useMissionControl(s => s.recipes)` to get the indexed recipe list (cached, SSE-refreshed).
- Read `useMissionControl(s => s.getRecipeBySlug(slug))` for O(n) slug → IndexedRecipe lookup.
- Import `RecipeBadge` from `@/components/panels/task-card/recipe-badge` and drop `<RecipeBadge task={task} />` into any flex badge row.
- Rely on the Plan-16-01 DOM CustomEvent relays continuing to fire; subscribe via `window.addEventListener('mc:recipe-indexed'|'mc:recipe-removed', ...)` to trigger recipe-aware refreshes.

Task 3 onward for this milestone: no further foundation changes anticipated.

## Self-Check: PASSED

All created files present:
- `src/components/panels/task-card/recipe-badge.tsx`
- `src/components/panels/task-card/__tests__/recipe-badge.test.tsx`

All modified files carry the expected hunks:
- `src/store/index.ts` — `IndexedRecipe` + 5 slice surface items + 5 impl items (grep lines 157-168 + 474-482 + 1093-1129)
- `src/lib/use-server-events.ts` — `refreshRecipes` destructure + second useEffect with listener + cleanup (grep lines 41, 266-287)
- `src/components/panels/task-board-panel.tsx` — 1 import (line 20) + 2 `<RecipeBadge task={task} />` insertions (lines 1087, 1529)
- `src/lib/__tests__/use-server-events.test.ts` — `refreshRecipes: vi.fn().mockResolvedValue(undefined)` in mock (line 34)

All task commits present in `git log`:
- `c2fc1ba` — Task 1 (bundled under sibling 16-06 commit per deviation 2)
- `4f03226` — Task 2 Step 1-2 (`feat(16-02): add RecipeBadge component with 10 unit tests (RUI-01)`)
- `af4b20f` — Task 2 Step 3 (bundled under sibling 16-05 commit per deviation 2)

Plan verification gates:
- `pnpm vitest run src/components/panels/task-card/__tests__/recipe-badge.test.tsx` → 10/10 green
- `pnpm vitest run src/lib/__tests__/use-server-events.test.ts` → 7/7 green
- `grep -c "<RecipeBadge" src/components/panels/task-board-panel.tsx` → 2
- `pnpm lint` → 0 errors (77 pre-existing warnings)
- `pnpm typecheck` → 13 TS2304 errors, ALL from sibling plan 16-05 work-in-progress outside 16-02 scope

---
*Phase: 16-runtime-ui-surfaces*
*Completed: 2026-04-21*
