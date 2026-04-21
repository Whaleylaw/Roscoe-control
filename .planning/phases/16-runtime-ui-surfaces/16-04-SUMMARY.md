---
phase: 16-runtime-ui-surfaces
plan: 04
subsystem: ui
tags: [next-intl, react, sse, i18n, tailwind, vitest]

# Dependency graph
requires:
  - phase: 15-checkpoints-scheduler-v1-2
    provides: GET /api/tasks/:id/checkpoints with ORDER BY (attempt ASC, id ASC) contract
  - phase: 16-runtime-ui-surfaces
    plan: 01
    provides: window 'mc:checkpoint-added' DOM CustomEvent relay + Task interface widened with recipe_slug + 16 seeded taskBoard.progressTab.* i18n keys across 10 locales

provides:
  - ProgressTab React component at `src/components/panels/task-detail/progress-tab.tsx` — orchestrates REST load + SSE append for the task detail Progress tab
  - CheckpointRow React component at `src/components/panels/task-detail/checkpoint-row.tsx` — per-checkpoint timeline entry with status dot + artifacts
  - `task-detail/` directory pattern for future task-detail sub-components (future phases can colocate review-history, cost-breakdown, etc.)
  - TaskDetailModal gains a conditional `Progress` tab scoped to recipe-tagged tasks (task.recipe_slug != null) — legacy tasks unaffected
affects: [17]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Subscribe-before-fetch lifecycle: useEffect registering the DOM event listener runs strictly before the useEffect that fires the initial GET, so SSE arrivals during the in-flight fetch merge cleanly"
    - "Map-by-id de-dupe for REST ↔ SSE overlap: state shape is `Map<number, Checkpoint>` keyed by checkpoint.id rather than an array sorted on every push"
    - "DOM CustomEvent consumption: `window.addEventListener('mc:checkpoint-added', h)` filtered by `detail.task_id === taskId` — matches the chat.message precedent set by use-server-events.ts"
    - "jsdom-safe smooth-scroll: guard `typeof el.scrollTo === 'function'` with `el.scrollTop = 0` fallback so headless environments and tests don't throw on first paint"
    - "data-checkpoint-id attribute for deterministic test DOM ordering assertions — avoids text-regex fragility against trailing timestamp digits"

key-files:
  created:
    - src/components/panels/task-detail/progress-tab.tsx
    - src/components/panels/task-detail/checkpoint-row.tsx
    - src/components/panels/task-detail/__tests__/progress-tab.test.tsx
    - src/components/panels/task-detail/__tests__/checkpoint-row.test.tsx
  modified:
    - src/components/panels/task-board-panel.tsx (3 surgical edits — import, tab state + button, tab panel)
    - .planning/phases/16-runtime-ui-surfaces/deferred-items.md (parallel-wave noise documented)

key-decisions:
  - "Map<number, Checkpoint> over Array<Checkpoint> for state — O(1) id-keyed de-dupe across REST + SSE without sort-on-every-push"
  - "Subscribe-before-fetch ordering enforced by declaration order: the SSE useEffect appears above the fetch useEffect; React guarantees effect-registration order across commits"
  - "jsdom scrollTo guard with scrollTop fallback added as an auto-fix (Rule 1 — bug) after jsdom's missing Element.scrollTo threw on first paint; production browsers take the smooth-scroll path unchanged"
  - "data-checkpoint-id attribute added to CheckpointRow to enable deterministic row-ordering assertions in tests — the first regex attempt matched across step label and timestamp digits (no whitespace separator in DOM text content)"
  - "userScrolledUpRef threshold at 16px (not 0) so a small jitter / user mouse-wheel tick doesn't disable auto-scroll; Open Question 4 LOCKED — anchored-unless-user-scrolled"
  - "collapsedInitialisedRef.current latches to true after first seed so user-initiated collapse/expand actions survive subsequent state updates from SSE arrivals"
  - "ProgressTab owns its SSE subscription lifecycle — TaskDetailModal passes only `taskId` and does NOT subscribe on its own; keeps the event listener scoped to the panel's mount/unmount"
  - "Tab panel double-guards on `task.recipe_slug` (both button and panel conditional on the field) — defensive against a transient state where activeTab was set to 'progress' but the task's recipe_slug was later cleared"
  - "Progress tab button placed AFTER the conditional session tab button, not inside the static `['details','comments','quality']` tabs map — preserves the static-tabs assumption for existing tests"

patterns-established:
  - "task-detail/ subdirectory: future task-detail tabs (review history, cost breakdown, etc.) can colocate under `src/components/panels/task-detail/` rather than bloating task-board-panel.tsx further"
  - "jsdom compatibility guard for scroll APIs: `typeof el.scrollTo === 'function'` + `el.scrollTop = 0` fallback becomes the template for future scroll-driven UI"
  - "SSE-consumer test harness: dispatch `new CustomEvent('mc:<name>', { detail })` on window inside an `act()` block; no need to stub EventSource — the dispatcher relay is already proven by Plan 16-01's use-server-events.test.ts"

requirements-completed: [RUI-03]

# Metrics
duration: 11min
completed: 2026-04-21
---

# Phase 16 Plan 04: Progress Tab (RUI-03) Summary

**Live checkpoint timeline on the task detail modal — vertical timeline grouped by attempt (latest expanded, older collapsed), subscribe-before-fetch ordering via `mc:checkpoint-added` DOM CustomEvent + GET /api/tasks/:id/checkpoints, Map-by-id de-dupe, newest-first sort within each attempt, blocked rows show red border + inline blocker_reason, tab rendered only for recipe-tagged tasks.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-04-21T01:22:52Z
- **Completed:** 2026-04-21T01:33:33Z
- **Tasks:** 2
- **Files created:** 4 (2 components + 2 test files)
- **Files modified:** 2 (task-board-panel.tsx surgical edits + deferred-items.md)
- **Tests added:** 21 (10 CheckpointRow + 11 ProgressTab)

## Accomplishments

- `ProgressTab` component ships at `src/components/panels/task-detail/progress-tab.tsx` — orchestrates `GET /api/tasks/:id/checkpoints` on mount plus `window.addEventListener('mc:checkpoint-added', handler)` for live append, filtered by `event.detail.task_id === taskId`.
- `CheckpointRow` component ships at `src/components/panels/task-detail/checkpoint-row.tsx` — pure render from `{ checkpoint }` props with status dot (green/blue-pulse/red), red-bordered blocked rows, inline blocker_reason, 6-kind artifact glyph mapping (📄 file / 🔗 url / 📝 diff / ✅ test_result / 💬 comment / ✨ other), URL artifacts as `<a target="_blank" rel="noreferrer">`, and optional tokens/duration bottom row.
- 21 unit tests cover REST load, empty state, load error, SSE append, SSE filter by task_id, subscribe-before-fetch ordering (Pitfall 6), REST + SSE de-dupe by id, newest-first sort within attempt (id DESC), outer attempt sort (attempt DESC), collapse-by-default for older attempts, and blocked-row styling. All 21 pass.
- TaskDetailModal inside `task-board-panel.tsx` gains a conditional `Progress` tab button (button conditional on `task.recipe_slug`) and a conditional panel render (also guarded on `task.recipe_slug`). Legacy non-recipe tasks see no change in their tab set.
- `pnpm typecheck` exits 0 against the committed state (HEAD). All 21 existing `task-board-panel.test.tsx` tests continue to pass against HEAD.

## Task Commits

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create CheckpointRow + ProgressTab components with tests | `edde713` | 4 new files (components + tests) |
| 2 | Render Progress tab panel in TaskDetailModal | `e2159c8` | `src/components/panels/task-board-panel.tsx` (1 surgical hunk) |

Plan metadata commit (this SUMMARY + STATE.md + ROADMAP.md) to follow.

## TaskDetailModal Surgical Edits — Line Numbers

Recorded against the committed HEAD state (which includes parallel-wave RunnerStatusBanner import on line 20):

- **Import (line 21)** — `import { ProgressTab } from './task-detail/progress-tab'`
- **activeTab state widening + progressT declaration (lines 1311-1312):**
  ```tsx
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'quality' | 'session' | 'progress'>('details')
  const progressT = useTranslations('taskBoard.progressTab')
  ```
- **Conditional Progress tab button (lines ~1641-1660)** — rendered after the existing conditional session tab button; `aria-selected={activeTab === 'progress'}`, `aria-controls="tabpanel-progress"`, label sourced from `progressT('tabLabel')`.
- **Conditional Progress tab panel (lines 1914-1918):**
  ```tsx
  {activeTab === 'progress' && task.recipe_slug && (
    <div id="tabpanel-progress" className="mt-4">
      <ProgressTab taskId={task.id} />
    </div>
  )}
  ```

Task 2's literal verify `grep -c "<ProgressTab" src/components/panels/task-board-panel.tsx` returns exactly `1`.

## i18n Contract

The tab label renders via `progressT('tabLabel')` where `progressT = useTranslations('taskBoard.progressTab')` — resolving to the `taskBoard.progressTab.tabLabel` key seeded by Plan 16-01's Task 2 across all 10 locale files. **No new i18n keys were added in Plan 16-04.** All other user-facing strings (`empty`, `loadError`, `attemptLabel`, `attemptCheckpointCount`, `blockerPrefix`, `tokensLabel`, `durationLabel`, `collapseAttempt`, `expandAttempt`) were also pre-seeded by 16-01 and resolve identically.

Verified by reading `messages/en.json`:
```
taskBoard.progressTab.tabLabel                 → "Progress"
taskBoard.progressTab.empty                    → "Waiting for first checkpoint…"
taskBoard.progressTab.blockerPrefix            → "Blocked:"
taskBoard.progressTab.attemptLabel             → "Attempt {n}"
taskBoard.progressTab.attemptCheckpointCount   → "{count} checkpoints"
taskBoard.progressTab.tokensLabel              → "{tokens} tokens"
taskBoard.progressTab.durationLabel            → "{ms} ms"
taskBoard.progressTab.loadError                → "Failed to load checkpoints"
taskBoard.progressTab.collapseAttempt          → "Collapse attempt"
taskBoard.progressTab.expandAttempt            → "Expand attempt"
```

## Auto-scroll Anchoring Rule (Open Question 4 LOCKED)

ProgressTab anchors the scroll position to the top (newest-first sort puts the latest checkpoint at the top) via `el.scrollTo({ top: 0, behavior: 'smooth' })`, fired on every increase to `checkpoints.size`. The anchor is DISABLED when the user has scrolled more than 16px down — tracked in `userScrolledUpRef.current` via the panel's `onScroll` handler. When the user scrolls back to the top (within 16px), auto-scroll re-arms. This matches the chat-panel precedent and avoids the "live feed yanks the viewport away from what I'm reading" failure mode.

The scroll code is wrapped in a `typeof el.scrollTo === 'function'` guard with an `el.scrollTop = 0` fallback so jsdom (which doesn't implement `Element.scrollTo`) and any other headless environment don't throw on first paint. Real browsers take the smooth-scroll path unchanged.

## Test Coverage Matrix

### CheckpointRow (10 tests in `checkpoint-row.test.tsx`)

| # | Case | Asserts |
|---|------|---------|
| 1 | Renders step + summary + ISO timestamp | Text content present |
| 2 | Completed status → green dot | `bg-green-500` class, no red border |
| 3 | In-progress status → blue dot with animate-pulse | `bg-blue-500 animate-pulse` classes |
| 4 | Blocked status → red dot + red border + blocker text | `bg-red-500`, `border-red-500/40`, "Blocked:" prefix, reason text |
| 5 | Blocked WITHOUT blocker_reason → no paragraph | "Blocked:" absent |
| 6 | All 6 artifact kinds with glyphs | 📄 / 🔗 / 📝 / ✅ / 💬 / ✨ rendered with labels |
| 7 | URL artifacts as `<a target="_blank" rel="noreferrer">` | href + target + rel attributes |
| 8 | tokens + duration rendered | Both texts present |
| 9 | No tokens/duration → bottom row omitted | Neither word in container |
| 10 | Only tokens → no duration | tokens present, "ms" absent |

### ProgressTab (11 tests in `progress-tab.test.tsx`)

| # | Case | Asserts |
|---|------|---------|
| 1 | REST load renders rows | Both rows + fetch URL |
| 2 | Empty response → empty state | `empty` i18n text |
| 3 | 500 response → loadError | `loadError` i18n text |
| 4 | SSE append via CustomEvent | New row appears, old row preserved |
| 5 | SSE filter by task_id | Wrong-task events ignored |
| 6 | Subscribe-before-fetch ordering | Event fired mid-fetch retained |
| 7 | REST + SSE de-dupe by id | Exactly one row for shared id; SSE update wins |
| 8 | Outer group sort — attempt DESC | attempts 3, 2, 1 in order |
| 9 | Collapse all but latest attempt by default | attempt-1-rows absent, attempt-2-rows present |
| 10 | Inner sort — id DESC within attempt | row id=7 before row id=5 (via data-checkpoint-id) |
| 11 | Blocked row red-bordered with blocker_reason | `border-red-500/40` + blocker text |

**Total: 21 unit tests, all passing.** Exceeds the plan's `must_haves` bar of "≥ 18 unit tests".

## Decisions Made

1. **Map<number, Checkpoint> state shape** — chose O(1) id-keyed de-dupe over array-with-sort-on-every-push. SSE arrivals with an id already in state perform a single `.set()` overwrite; stale props are replaced atomically (useful when a `task.checkpoint_added` fires with an updated `summary` for a previously-recorded id).
2. **Subscribe-before-fetch ordering enforced by useEffect declaration order** — no explicit queue needed. React registers effects in source order on first commit; the listener is live before the fetch kicks off. Test #6 proves the invariant by deferring the fetch resolution until after an SSE event dispatches.
3. **jsdom scrollTo guard (Rule 1 auto-fix)** — initial test run threw `TypeError: el.scrollTo is not a function` because jsdom does not implement `Element.scrollTo`. Added `typeof el.scrollTo === 'function'` check with `el.scrollTop = 0` fallback. Production browsers unchanged.
4. **data-checkpoint-id attribute on CheckpointRow** — initial test for "newest-first within attempt" used a regex against text content, which swallowed trailing ISO-timestamp digits (e.g. `step_id_72026-04-20...`). Switched to a deterministic DOM attribute for row-id assertions. Incidentally makes the component easier to inspect via devtools.
5. **userScrolledUpRef threshold of 16px (not 0)** — a sub-pixel scroll jitter or trackpad tick at the top of the list should not disable auto-scroll. 16px is roughly one line of text in the CheckpointRow layout and matches common "near the top" thresholds.
6. **collapsedInitialisedRef.current latch** — user-initiated collapse/expand actions persist across subsequent SSE arrivals. Without the latch, every state change would re-seed the collapse set and revert user intent.
7. **ProgressTab owns its SSE subscription, TaskDetailModal does not** — the listener is registered/torn down with the tab's mount/unmount lifecycle. If a future phase renders the modal with the session tab active and the Progress tab never mounted, zero listeners are registered.
8. **Double-guard on task.recipe_slug (button AND panel)** — the button conditionally renders based on `task.recipe_slug`; the panel also conditionally renders on the same field. A stale `activeTab === 'progress'` that somehow persists after recipe_slug is cleared stays hidden.
9. **Path-scoped `git commit -- path` pattern for Task 2** — parallel-wave contention on `task-board-panel.tsx` caused three prior commit attempts to absorb unrelated hunks. Isolated patch export + revert + targeted re-apply + `git commit -- path` guarantees only Plan 16-04's hunk lands.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] jsdom scrollTo missing in tests**
- **Found during:** Task 1 verification (first full `pnpm vitest run` of both test files)
- **Issue:** `TypeError: el.scrollTo is not a function` thrown from `ProgressTab` useEffect on every mount in jsdom — 6 of 10 progress-tab tests uncaught-exception'd.
- **Fix:** Wrap the call in `typeof el.scrollTo === 'function'` with `el.scrollTop = 0` fallback.
- **Files modified:** `src/components/panels/task-detail/progress-tab.tsx`
- **Verification:** 11/11 progress-tab tests pass.
- **Committed in:** `edde713` (Task 1 commit — the fix landed with the initial component).

**2. [Rule 1 - Bug] Regex swallowed timestamp digits in row-ordering test**
- **Found during:** Task 1 verification (post-scrollTo fix, test #10 "sorts newest-first within attempt")
- **Issue:** `.match(/step_id_\d+/)` matched `step_id_72026-04-20...` because the ISO timestamp digits followed the step label with no separator.
- **Fix:** Added `data-checkpoint-id={checkpoint.id}` attribute on CheckpointRow and rewrote the test assertion to read it directly instead of regex-matching text content. Deterministic and readable.
- **Files modified:** `src/components/panels/task-detail/checkpoint-row.tsx`, `src/components/panels/task-detail/__tests__/progress-tab.test.tsx`
- **Verification:** 11/11 progress-tab tests pass.
- **Committed in:** `edde713` (Task 1 commit).

**3. [Rule 4 - Architectural scope boundary] Parallel-wave ReferenceError in EditTaskModal region**
- **Found during:** Task 2 post-typecheck verification with 16-05's in-flight hunks in the working tree
- **Issue:** `src/components/panels/task-board-panel.tsx` carried an uncommitted hunk from Plan 16-05 referencing `recipeSlug` / `setRecipeSlug` / etc. at line ~2648 that has no corresponding `useState` declarations yet committed. `pnpm typecheck` reports 11 `Cannot find name` errors and 2 of 21 task-board-panel tests fail with `ReferenceError: recipeSlug is not defined`.
- **Fix:** None applied by Plan 16-04. Stashing 16-05's in-flight hunk and rerunning demonstrates 21/21 task-board-panel tests pass and `pnpm typecheck` exits 0 against HEAD — confirming the noise is out of scope for 16-04.
- **Files modified:** `.planning/phases/16-runtime-ui-surfaces/deferred-items.md` (documented the parallel-wave scenario for the next executor).
- **Verification:** 21/21 task-board-panel tests pass against HEAD; 21/21 plan-16-04 tests pass unconditionally.
- **Impact:** Zero impact on 16-04's correctness. Plan 16-05's next commit will land the `useState` declarations and clear the ReferenceError; if 16-05 finishes first, their commit absorbs the hunk cleanly.

### Process Observations (Parallel-Wave Execution)

Plans 16-02/03/04/05/06 all edited `src/components/panels/task-board-panel.tsx` concurrently. Two race patterns observed:

1. **`git add path/to/directory/` pulled in untracked files from sibling plans.** First Task 1 commit attempt accidentally committed 8 files from Plan 16-05's `task-form/` subdirectory because the agent that ran `git add` most-recently-past had tracked the directory. Fixed by `git reset HEAD~1` + `git add <explicit-file-list>` + `git commit -- <path>` (path-scoped).
2. **Working-tree hunks on the same file absorbed by whichever commit landed first.** Plan 16-03's `feat(16-03)` commit ended up containing 16-04's Task 2 tab-button edits. Plan 16-04 re-applied its tab-panel hunk after-the-fact and committed path-scoped; 16-03's commit gains 16-04's hunks as a byproduct but the final file state is correct. **Historical note:** Plan 16-04's Task 2 commit `e2159c8` contains ONLY the tab-panel hunk (6 insertions) — the tab-button + activeTab-widen + import hunks are in Plan 16-03's `1b6bef8` commit.

---

**Total deviations:** 3 auto-fixed (2 bugs + 1 architectural scope boundary).
**Impact on plan:** All three preserve Plan 16-04 intent. The bug fixes are minor test-env compatibility improvements; the scope-boundary note keeps the executor honest about where the ReferenceError came from.

## Issues Encountered

None during the logic of Plan 16-04 itself. The two race conditions with parallel-wave plans were resolved by reapplying diffs via path-scoped commit. Documented above under "Process Observations".

## Auth Gates Encountered

None.

## User Setup Required

None — the Progress tab is self-configuring. A dev-server smoke test can be run at any time:

1. `pnpm dev`
2. Create a task with a non-null `recipe_slug` (`POST /api/tasks` or the create-task modal after Plan 16-05 lands).
3. Open the task detail modal → observe the new `Progress` tab button between Session and the end of the tab list.
4. Click Progress → observe either the empty state (`Waiting for first checkpoint…`) or the timeline if the task has existing checkpoints.
5. Post a checkpoint via `POST /api/tasks/:id/checkpoints` with a runner-token → observe the new row appears at the top of the list without a page reload.

## Next Plan Readiness

Plan 16-04 is file-disjoint from Plans 16-02/16-03/16-05/16-06 except for the coordinated multi-wave edits to `src/components/panels/task-board-panel.tsx` (all handled via path-scoped commits). The `task-detail/` directory is now the canonical place for future task-detail sub-components. Plan 17 (integration tests) can exercise the Progress tab end-to-end via a real runner emitting checkpoints.

## Self-Check: PASSED

All created files present:
- `src/components/panels/task-detail/progress-tab.tsx` — FOUND
- `src/components/panels/task-detail/checkpoint-row.tsx` — FOUND
- `src/components/panels/task-detail/__tests__/progress-tab.test.tsx` — FOUND
- `src/components/panels/task-detail/__tests__/checkpoint-row.test.tsx` — FOUND

All task commits present in `git log`:
- `edde713` — Task 1 (ProgressTab + CheckpointRow components + 21 tests)
- `e2159c8` — Task 2 (Progress tab panel render in TaskDetailModal)

Plan verification gates:
- `pnpm typecheck` → 0 (against HEAD, with 16-05's uncommitted in-flight hunk stashed)
- `pnpm vitest run src/components/panels/task-detail/__tests__/` → 21/21 passing
- `pnpm vitest run src/components/panels/__tests__/task-board-panel.test.tsx` → 21/21 passing against HEAD (with 16-05's uncommitted in-flight hunk stashed)
- `grep -c "<ProgressTab" src/components/panels/task-board-panel.tsx` → 1

---
*Phase: 16-runtime-ui-surfaces*
*Completed: 2026-04-21*
