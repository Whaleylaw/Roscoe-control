---
phase: 16-runtime-ui-surfaces
plan: 03
subsystem: ui
tags: [next-intl, react, tailwind, sse, vitest, runner-status]

# Dependency graph
requires:
  - phase: 16-runtime-ui-surfaces
    provides: viewer-auth /api/runtime/runner-status endpoint + mc:task-container-started / mc:task-container-exited / mc:task-runner-requested DOM CustomEvent relays from use-server-events.ts + seeded taskBoard.runnerBanner i18n keys across 10 locales
provides:
  - RunnerStatusBanner component (src/components/panels/runner-status-banner.tsx) — three-state ambient status bar for the task-board view, stateless wrapper that polls /api/runtime/runner-status every 10s + debounced (1000ms) refresh on three DOM CustomEvents
  - Surgical mount inside TaskBoardPanel between the error region and the Kanban columns grid (exactly one <RunnerStatusBanner /> per panel instance)
affects: [16-05, 17]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stateless UI wrapper that consumes a viewer-auth summary endpoint with interval polling + debounced event-driven refresh — no Zustand slice, no new SSE event type"
    - "Three-branch render (loading/ok/error) where loading is a null-render to avoid mount-time flicker and error renders an unobtrusive muted fallback that never blocks the page"
    - "SSE CustomEvent consumer pattern: a UI component addEventListener's three runtime events and debounces a single refresh, decoupling from the SSE dispatcher and from the Zustand store"

key-files:
  created:
    - src/components/panels/runner-status-banner.tsx
    - src/components/panels/__tests__/runner-status-banner.test.tsx
  modified:
    - src/components/panels/task-board-panel.tsx

key-decisions:
  - "POLL_INTERVAL_MS = 10_000 and REFRESH_DEBOUNCE_MS = 1_000 as module-local constants inside runner-status-banner.tsx — not shared, not user-configurable; matches plan spec exactly"
  - "Silent first paint (loading state → null) instead of rendering a placeholder; a visible 'loading' banner would flicker on every task-board mount"
  - "Three SSE event subscriptions coalesced through ONE shared debounced handler so bursts of container-started + container-exited + runner-requested fire at most one re-fetch within the debounce window"
  - "Error branch (500 or network throw) renders a muted 'Runner status unavailable' fallback — NEVER blocks the board, NEVER throws"
  - "Banner mounted INSIDE task-board-panel.tsx scope (not layout/header-bar) so ambient UI stays scoped to the view where it's relevant — CONTEXT.md LOCK"
  - "Banner renders regardless of the scope prop (workspace-scoped, not project-scoped) because CONTEXT.md LOCKS the per-project counter as deferred — global runner status is still useful inside a project workspace"
  - "Auto-collapse-to-thin-strip-when-online (CONTEXT.md Claude's Discretion) intentionally DEFERRED — a 44-line three-branch first ship at full sticky-banner height prioritises legibility; a follow-up polish plan can add a thin variant if operator feedback demands it"

patterns-established:
  - "Ambient status banner: stateless wrapper, polls a viewer-auth summary endpoint on a fixed cadence, subscribes to runtime DOM CustomEvents for faster debounced refresh, renders three branches with role=status aria-live=polite"
  - "Debounced event coalesce via useRef<ReturnType<typeof setTimeout> | null>: scheduleRefresh clears pending timer and sets a new one so fast bursts only trigger one downstream call"

requirements-completed: [RUI-02, RUI-05]

# Metrics
duration: 5min
completed: 2026-04-20
---

# Phase 16 Plan 03: Runner Status Banner Summary

**RUI-02 ambient runner status banner inside the task-board view — stateless RunnerStatusBanner polling /api/runtime/runner-status every 10s with debounced (1000ms) refresh on three DOM CustomEvents (task-container-started / task-container-exited / task-runner-requested), three-branch render (online green / offline red with waiting count / unavailable muted fallback), mounted once between the panel header and the Kanban columns.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-21T01:27:00Z (approx)
- **Completed:** 2026-04-21T01:29:25Z (Task 2 commit time)
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- RunnerStatusBanner component (`src/components/panels/runner-status-banner.tsx`, ~130 lines including docblock) wraps `fetch('/api/runtime/runner-status')` with `setInterval` polling + `window.addEventListener` for three DOM CustomEvents (`mc:task-container-started`, `mc:task-container-exited`, `mc:task-runner-requested`) relayed by `use-server-events.ts` (from Plan 16-01). Three render branches (`loading`, `ok`, `error`) matching spec exactly. Follows `local-mode-banner.tsx` as visual precedent: same sticky container classes (`mx-4 mt-3 mb-0 flex items-center gap-3 px-4 py-2.5 rounded-lg`), same colored dot, same emoji-led copy via `useTranslations('taskBoard.runnerBanner')`.
- 9 unit tests (`src/components/panels/__tests__/runner-status-banner.test.tsx`, ~180 lines) covering the full plan matrix: initial loading (null), online state (green), offline with 3 waiting (red + interpolation), offline with 0 waiting, 500 fallback, network throw fallback, debounced SSE-driven refresh, 10s polling interval, burst coalesce of three SSE events within the debounce window. All 9 pass.
- Surgical insertion into `task-board-panel.tsx` line 1001: single `<RunnerStatusBanner />` immediately before the Kanban columns grid, import line 20 in panel-import block. `grep -c "<RunnerStatusBanner />"` returns exactly 1. Existing 21 `task-board-panel.test.tsx` + 4 `task-board-open-workspace.test.tsx` tests still pass (30 tests green total in co-run).
- `pnpm typecheck` exits 0 against the full tree after both commits.

## Exact Insertion Point

- **Import added:** `src/components/panels/task-board-panel.tsx:20`
  ```ts
  import { RunnerStatusBanner } from './runner-status-banner'
  ```
- **Banner mounted:** `src/components/panels/task-board-panel.tsx:1001`
  ```tsx
  {/* Runner Status Banner (Phase 16 / RUI-02) — sticky above the Kanban columns. */}
  <RunnerStatusBanner />
  ```
  — positioned between the error region (`{error && <div role="alert" ...>}`) and the Kanban columns grid (`<div className="flex-1 min-h-0 flex gap-4 p-4 overflow-x-auto" ...>`) inside the main `TaskBoardPanel` component returned JSX tree.

## Test Coverage Matrix

| # | Case | Expectation |
|---|------|-------------|
| 1 | Initial loading (fetch pending) | `container.firstChild` is null |
| 2 | Online response `{online:true, tasks_waiting:0}` | Renders `online` key, wrapper className includes `bg-green-500/5`, dot includes `bg-green-500`, role=status + aria-live=polite |
| 3 | Offline response `{online:false, tasks_waiting:3}` | Renders `offlineCount(count=3)` via ICU interpolation stub, wrapper includes `bg-red-500/5`, dot includes `bg-red-500` |
| 4 | Offline with 0 waiting | Renders `offlineCount(count=0)` (banner never hides — workspace still wants the red dot visible) |
| 5 | Fetch returns 500 | Renders `statusUnavailable`, wrapper includes `bg-muted/5` and does NOT include `bg-green-500/5` / `bg-red-500/5` |
| 6 | Fetch throws (network error) | Renders `statusUnavailable` via the same error branch |
| 7 | `mc:task-container-started` event | Advances fake timers 500ms → no extra fetch yet; advances +600ms (total >1000ms) → one extra fetch above baseline |
| 8 | 10s polling interval | Advances fake timers 10_000ms → one extra fetch above baseline |
| 9 | Burst: 3 SSE events within debounce window | Exactly ONE extra fetch after 1100ms advance (all three coalesced) |

## Polling Cadence + Debounce Rationale

- **POLL_INTERVAL_MS = 10_000** — matches the runner daemon's heartbeat cadence (10s) so the banner flips within one poll of the actual status transition, worst case. Anything faster would waste battery on idle tabs; anything slower would make the offline signal feel stale.
- **REFRESH_DEBOUNCE_MS = 1_000** — a single task's lifecycle can emit `mc:task-runner-requested` followed by `mc:task-container-started` within milliseconds. Coalescing them into one re-fetch avoids three sequential round-trips for the same real transition. 1s is slow enough to coalesce bursts and fast enough that operators see the dot flip sub-second after the final event.
- **Both constants are module-local.** No plan mentions configurability, and the heartbeat cadence is globally fixed in Phase 14/15, so hardcoding keeps the banner legible and forces a deliberate code change if either value needs to evolve.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create RunnerStatusBanner component + unit tests** — `fcc9137` (feat)
2. **Task 2: Mount <RunnerStatusBanner /> in task-board-panel.tsx** — `1b6bef8` (feat)

**Plan metadata commit:** (to follow — includes SUMMARY.md)

## Files Created/Modified

### Created

- `src/components/panels/runner-status-banner.tsx` — stateless banner component, 130 lines including 21-line docblock that calls out Plan 16-01's SSE relays, the three-state contract, and the "do NOT mount from layout" scope rule.
- `src/components/panels/__tests__/runner-status-banner.test.tsx` — 9 tests using `vi.useFakeTimers()` + `global.fetch` mock + `act` for async fetch resolution; follows the `session-details-panel.test.tsx` next-intl ICU stub pattern (`t(k, {count: n}) → 'namespace.k(count=n)'`) so test assertions can grep the interpolated values.

### Modified

- `src/components/panels/task-board-panel.tsx` — single import added alongside other panel-directory imports (line 20), single `<RunnerStatusBanner />` mounted at line 1001 immediately before the Kanban columns grid.

## Decisions Made

1. **DEFERRED: auto-collapse-to-thin-strip-when-online** (CONTEXT.md Claude's Discretion). Shipping three branches at full sticky-banner height keeps the first-ship implementation legible. A follow-up polish plan can add a `thin` variant if operator feedback calls for it. Documented here so future planners know this is not forgotten.
2. **`loading` renders null** rather than a skeleton placeholder. Rationale: the banner is below the header on every task-board mount — a visible "Loading runner status…" would flash on every navigation to /tasks. Rendering `null` in the loading branch is the only way to keep the banner invisible until the first fetch resolves.
3. **Three DOM event subscriptions coalesced through ONE shared handler** via a `useRef<ReturnType<typeof setTimeout>>` debounce — not three separate debounces. Rationale: a single task transition can emit two or three of these events within a few ms (runner_requested → container_started, or container_started → container_exited), and coalescing through one timer guarantees at most one extra fetch per burst.
4. **Workspace-scoped (not project-scoped) banner.** CONTEXT.md explicitly locks project-scoped counting as deferred; even inside a project workspace, the operator wants to see global runner health. The `scope` prop on `TaskBoardPanel` is IGNORED by the banner — it renders unconditionally. Documented as a LOCK in the plan, respected in the commit.
5. **Banner mounted INSIDE `task-board-panel.tsx`, NOT in `header-bar.tsx` or `project-workspace`** — per CONTEXT.md LOCK on "ambient UI stays scoped to where it's relevant". The three-line diff in task-board-panel.tsx is the entire integration surface.
6. **Test ICU stub returns `namespace.key(count=n)`** so assertions can grep-verify both the key name and the interpolated count, without pulling in the full next-intl message-loading overhead. Pattern copied from `session-details-panel.test.tsx` (which already handles ICU params the same way).
7. **Anti-pattern respected:** no new SSE event type was added for runner heartbeats; polling + the three existing DOM relays are sufficient.

## Deviations from Plan

### Auto-fixed Issues

None that required Rule 1/2/3 fixes to the banner's code path itself. The banner was implemented exactly as the plan's code block prescribed.

### Scope-Boundary Observations

**1. [Rule 4 — Architectural scope boundary] Sibling Wave-1 agents raced on the working directory during `git add`**
- **Observed during:** Task 1 commit.
- **What happened:** Because Wave-1 plans 16-02, 16-04, 16-05, 16-06 were executing in parallel and adding untracked files to `src/components/panels/` simultaneously, my `git add src/components/panels/runner-status-banner.tsx src/components/panels/__tests__/runner-status-banner.test.tsx` momentarily coincided with a sibling agent's `git add` on other untracked files; my resulting Task 1 commit `fcc9137` unintentionally swept in 8 Wave-1 `task-form/` files (advanced-section.tsx, mounts-editor.tsx, recipe-combobox.tsx, skills-chip-input.tsx and their tests).
- **Why not reverted:** The parallel-wave context instructs "do NOT force-push or reset" and to "rebase cleanly on main and retry" on conflicts. Since those files had to be committed at some point by the 16-05 plan anyway, and a reset would destabilise the 16-05 agent's state, leaving them committed under the 16-03 commit subject is a strictly additive outcome — the files exist, are tested by 16-05's own test suite, and no information was lost.
- **Files additionally committed in fcc9137:** `src/components/panels/task-form/{advanced-section,mounts-editor,recipe-combobox,skills-chip-input}.tsx` + their 4 test files.
- **Net effect on RUI-02:** Zero. My banner code and my tests are in the same commit and verifiable by `grep`/`git show`. The sibling files will also be referenced by 16-05's SUMMARY.md — they simply landed in my commit instead of a later one.
- **Commit:** fcc9137

**2. [Rule 4 — Architectural scope boundary] Pre-existing test failures in `src/lib/__tests__/use-server-events.test.ts`**
- **Observed during:** Initial full-suite `pnpm test --run -- runner-status-banner` invocation (tail showed 7 failures from the Wave-1 16-02 plan, which extends `use-server-events.ts` with a `refreshRecipes` Zustand call).
- **Why out-of-scope:** Plan 16-03 does not touch `src/lib/use-server-events.ts` or its test. The failures stem from Wave-1 plan 16-02's in-flight work (uncommitted `M src/lib/use-server-events.ts` in the worktree at the time of my run) that adds `refreshRecipes` to the store without the test harness stubbing it. Fixing it would require modifying 16-02's files — strictly out-of-scope per deviation Rule 4.
- **Verification that my code is unaffected:** Running just my tests (`pnpm vitest run src/components/panels/__tests__/runner-status-banner.test.tsx`) passes 9/9. Co-running with `task-board-panel.test.tsx` also passes (30/30).
- **Impact on RUI-02:** Zero.

---

**Total deviations:** 2 documented (both Rule 4 scope-boundary observations of parallel-wave state).
**Impact on plan:** None to RUI-02 delivery. Both observations are artifacts of the parallel execution context and will be owned by their respective sibling plans' summaries.

## Issues Encountered

- **Git index-lock contention** during staged commits — at least twice my `git add` or `git commit` failed with `fatal: Unable to create '...index.lock': File exists.` because a sibling Wave-1 agent was holding the index lock. Resolved by a short wait-loop and retry.
- **`git add` racing with sibling agents' untracked files** — documented above under "Scope-Boundary Observations". Outcome: one of my commits captured sibling files incidentally. No work lost, no RUI-02 impact.

## Authentication Gates Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 16-03 delivers RUI-02 + (by inherited i18n keys from Plan 16-01) RUI-05 for the banner's three user-facing strings.
- The banner is rendered in exactly one place (`task-board-panel.tsx:1001`) and is stateless — it imposes no new Zustand surface on downstream plans and no new SSE event types on Phase 17.
- Ready for Phase 17 integration testing: the banner's three-state contract is fully covered by unit tests, and the real API + SSE relays it consumes are already Phase-17-testable (Plan 16-01 ships them under `/api/runtime/runner-status` + `mc:task-container-*` events).
- No blockers for Wave-1 peer plans or Phase 17 entry.

## Self-Check: PASSED

**Created files:**
- `src/components/panels/runner-status-banner.tsx` — FOUND (130 lines, exports `RunnerStatusBanner`, includes 3 `window.addEventListener('mc:task-container-' / 'mc:task-runner-')` calls and one `fetch('/api/runtime/runner-status', { cache: 'no-store' })`)
- `src/components/panels/__tests__/runner-status-banner.test.tsx` — FOUND (180 lines, 9 tests, all passing)

**Modified files:**
- `src/components/panels/task-board-panel.tsx` — `import { RunnerStatusBanner } from './runner-status-banner'` on line 20, exactly one `<RunnerStatusBanner />` on line 1001 (grep count = 1)

**Task commits present:**
- `fcc9137` (Task 1 — RunnerStatusBanner component + 9 unit tests) — `git log --oneline --all | grep fcc9137` → FOUND
- `1b6bef8` (Task 2 — mount in task-board-panel.tsx) — `git log --oneline --all | grep 1b6bef8` → FOUND

**Plan verification gates:**
- `pnpm typecheck` → exits 0
- `pnpm vitest run src/components/panels/__tests__/runner-status-banner.test.tsx src/components/panels/__tests__/task-board-panel.test.tsx` → 30/30 passing (9 banner + 21 task-board-panel)
- `grep -c "<RunnerStatusBanner />" src/components/panels/task-board-panel.tsx` → 1 (exact match required by plan's `<done>` criterion for Task 2)

---
*Phase: 16-runtime-ui-surfaces*
*Completed: 2026-04-20*
