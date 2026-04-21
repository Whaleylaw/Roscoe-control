---
phase: 16-runtime-ui-surfaces
plan: 01
subsystem: ui
tags: [next-intl, zustand, sse, i18n, tailwind, react, vitest, better-sqlite3]

# Dependency graph
requires:
  - phase: 11-runtime-foundation-v1-2
    provides: runner_heartbeats migration + recipe_slug column on tasks
  - phase: 12-recipe-system-v1-2
    provides: recipes table + /api/recipes/search + /api/recipes/resync
  - phase: 13-task-runtime-context-v1-2
    provides: task.workspace_source/read_only_mounts/extra_skills/model_override columns
  - phase: 14-runner-container-v1-2
    provides: runner_heartbeats rows + container_id/runner_started_at/runner_exit_code/worktree_path columns
  - phase: 15-checkpoints-scheduler-v1-2
    provides: 6 new EventType members (task.checkpoint_added, task.container_started/exited, task.runner_requested, recipe.indexed/removed)

provides:
  - MODEL_TIER_COLORS shared util (`src/lib/model-tier-colors.ts`) — opus/sonnet/haiku palette + modelToTier()/modelTierClassName() helpers
  - Task interface widened to 12 v1.2 runtime fields (in both `src/store/index.ts` and `src/components/panels/task-board-panel.tsx`)
  - SSE dispatcher relays 6 new event types as DOM CustomEvents (mc:checkpoint-added, mc:task-container-started, mc:task-container-exited, mc:task-runner-requested, mc:recipe-indexed, mc:recipe-removed)
  - Viewer-auth GET `/api/runtime/runner-status` returning `{online, last_heartbeat_at, tasks_waiting}`
  - 54 new i18n keys present in all 10 locale files (en/es/fr/de/ja/ko/pt/ru/zh/ar)
affects: [16-02, 16-03, 16-04, 16-05, 16-06, 17]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared-util extraction: lift inline constants (MODEL_TIER_COLORS) into `src/lib/` so multiple consumers import from one file"
    - "SSE → DOM CustomEvent relay: keep useServerEvents minimal; UI components addEventListener without Zustand coupling (follows chat.message precedent)"
    - "Viewer-auth summary endpoints: thin projections over runner-secret-scoped tables so the browser never sees secrets"
    - "Atomic i18n seeding via idempotent Node script that refuses key clobbers and hard-fails on drift"

key-files:
  created:
    - src/lib/model-tier-colors.ts
    - src/lib/__tests__/model-tier-colors.test.ts
    - src/lib/__tests__/use-server-events.test.ts
    - src/app/api/runtime/runner-status/route.ts
    - src/app/api/runtime/runner-status/__tests__/route.test.ts
    - .planning/phases/16-runtime-ui-surfaces/seed-i18n.mjs
    - .planning/phases/16-runtime-ui-surfaces/deferred-items.md
  modified:
    - src/store/index.ts
    - src/components/panels/task-board-panel.tsx
    - src/components/panels/agent-detail-tabs.tsx
    - src/lib/use-server-events.ts
    - messages/en.json (+ 9 other locale files)

key-decisions:
  - "DOM CustomEvent relays (Wave-0 default) over new Zustand slice — matches chat.message precedent, zero additional store surface, Wave-1 components can subscribe without cross-file coupling"
  - "Viewer-auth endpoint (Option A) over SSE runner.heartbeat broadcast (Option B) — avoids 600 events/min churn on idle systems; banner polls every ~10s"
  - "Workspace-scoped tasks_waiting count so per-workspace banners show accurate numbers; heartbeat itself is global"
  - "STALE_WINDOW_SECS = 90 declared module-local (not shared const) — matches task-dispatch.ts + inventory/route.ts per Plan 15-06 LOCKED pattern; 3× 30s reconcile tick"
  - "modelTierClassName('unknown') returns a neutral muted fallback so callers never branch on the unknown case themselves"
  - "i18n seeding via idempotent Node script rather than per-file hand edits — 10 × 54 = 540 insertions atomic, refuses to clobber pre-existing keys"
  - "Phase 16 key PARITY across 10 locales ships as the gate; real translations deferred as a chore PR per Phase 9 precedent"
  - "Pre-existing 131-line drift between en.json and other locales is out-of-scope for 16-01; logged but untouched"

patterns-established:
  - "Model-tier color source: `src/lib/model-tier-colors.ts` is the ONE place to change palette, add a tier, or tweak class variants"
  - "SSE runtime-event relay: `window.dispatchEvent(new CustomEvent('mc:<kebab-name>', {detail: event.data}))` with SSR guard, one case per event type"
  - "Runner-status viewer endpoint: 90s stale window as module-local const, workspace-scoped waiting count filter, graceful 500 → 'status unknown' UI treatment"
  - "i18n seeding: Node script under `.planning/phases/<phase>/` that is idempotent and hard-fails on value drift; reusable for subsequent phases"

requirements-completed: [RUI-01, RUI-02, RUI-03, RUI-04, RUI-05, RUI-06]

# Metrics
duration: 10min
completed: 2026-04-21
---

# Phase 16 Plan 01: Runtime UI Surfaces Wave-0 Foundation Summary

**Substrate for five parallel Wave-1 UI plans: Task interface widened to 12 v1.2 runtime fields, MODEL_TIER_COLORS lifted to a shared util, SSE dispatcher relays 6 new runtime events as DOM CustomEvents, viewer-auth /api/runtime/runner-status endpoint, 54 new i18n keys seeded atomically across 10 locales.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-21T01:04:44Z
- **Completed:** 2026-04-21T01:15:34Z
- **Tasks:** 2
- **Files modified:** 19 (5 created, 14 modified — 10 locale JSONs + 4 src files)

## Accomplishments

- `MODEL_TIER_COLORS` is now the canonical source of truth at `src/lib/model-tier-colors.ts` with `MODEL_TIER_COLORS`, `ModelTier` union, `modelToTier()`, and `modelTierClassName()` helpers; `agent-detail-tabs.tsx` imports from the new module and the inline declaration is gone.
- Task interface carries all 12 v1.2 runtime fields in both declarations (`src/store/index.ts` Zustand shape and `src/components/panels/task-board-panel.tsx` local) — Wave-1 components can now `task.recipe_slug` without cast or undefined-flicker.
- `useServerEvents` dispatcher extended with 6 new `case` branches that relay each v1.2 runtime event as an SSR-safe DOM CustomEvent (matches `chat.message` precedent at lines 152-158).
- `GET /api/runtime/runner-status` is live at viewer auth, projecting `{online, last_heartbeat_at, tasks_waiting}` over the same `runner_heartbeats` table the runner-secret `inventory` endpoint reads.
- All 10 locale files (`messages/*.json`) now carry 54 new Phase 16 keys under `nav.recipes`, `taskBoard.recipeBadge/runnerBanner/progressTab/recipeField/advancedSection`, and new top-level `recipesPanel`. English copy placeholders per Phase 9 precedent; key PARITY verified via targeted jq filter (56 paths × 10 locales identical).
- 30 new unit tests (16 model-tier-colors, 7 use-server-events relays, 7 runner-status route) all passing; `pnpm typecheck` exits 0; `pnpm lint` exits 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared util + interface widening + SSE relays + runner-status endpoint** — `763ae9d` (feat)
2. **Task 2: Atomic 10-locale Phase 16 i18n seeding** — `d4b3fb3` (feat)

**Plan metadata commit:** (to follow — includes SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified

### Created

- `src/lib/model-tier-colors.ts` — canonical MODEL_TIER_COLORS map + modelToTier() + modelTierClassName() helper
- `src/lib/__tests__/model-tier-colors.test.ts` — 16 unit tests covering tier inference, class mapping, byte-for-byte parity with the old inline declaration
- `src/lib/__tests__/use-server-events.test.ts` — 7 tests covering the 6 new DOM CustomEvent relays plus an "unknown event ignored" test; stubs global EventSource to drive `onmessage` synthetically
- `src/app/api/runtime/runner-status/route.ts` — viewer-auth GET handler projecting `{online, last_heartbeat_at, tasks_waiting}`
- `src/app/api/runtime/runner-status/__tests__/route.test.ts` — 7 tests (401 unauth, fresh-heartbeat happy path, stale heartbeat, no heartbeat, freshest-of-multiple, workspace-scoped count, DB throw → 500)
- `.planning/phases/16-runtime-ui-surfaces/seed-i18n.mjs` — idempotent Node script for the 10-locale seeding (reusable artifact for future phases)
- `.planning/phases/16-runtime-ui-surfaces/deferred-items.md` — documents pre-existing `recipe-watcher-events.test.ts` flake as out-of-scope

### Modified

- `src/store/index.ts` — Task interface widened with 12 v1.2 runtime fields (after `depends_on_task_ids`, before closing `}`)
- `src/components/panels/task-board-panel.tsx` — local Task interface mirrors the same 12 field additions
- `src/components/panels/agent-detail-tabs.tsx` — added `import { MODEL_TIER_COLORS } from '@/lib/model-tier-colors'`; removed the 4-line inline declaration at the former line 807
- `src/lib/use-server-events.ts` — 6 new `case` branches appended after `activity.created`
- `messages/en.json` + `messages/es.json` + `messages/fr.json` + `messages/de.json` + `messages/ja.json` + `messages/ko.json` + `messages/pt.json` + `messages/ru.json` + `messages/zh.json` + `messages/ar.json` — 54 new Phase 16 keys each

## Task Interface Additions (for Wave-1 grep-verification)

Appended to the `Task` interface in BOTH `src/store/index.ts` and `src/components/panels/task-board-panel.tsx`:

```typescript
// Phase 13/14 v1.2 runtime-context fields (all nullable — pre-v1.2 rows have NULL).
recipe_slug?: string | null
workspace_source?: { project_id: number; base_ref: string } | null
read_only_mounts?: Array<{ host_path: string; container_path: string; label: string }>
extra_skills?: string[]
model_override?: string | null
container_id?: string | null
runner_started_at?: number | null
runner_exit_code?: number | null
worktree_path?: string | null
runner_attempts?: number
runner_max_attempts?: number | null
runner_last_failure_reason?: string | null
```

## DOM CustomEvent Names Relayed (for Wave-1 `addEventListener`)

| SSE event type           | DOM event name                | Detail payload shape                                                |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------- |
| `task.checkpoint_added`  | `mc:checkpoint-added`         | `{ task_id, attempt, step, summary, status, blocker_reason?, ... }` |
| `task.container_started` | `mc:task-container-started`   | `{ task_id, attempt, container_id }`                                |
| `task.container_exited`  | `mc:task-container-exited`    | `{ task_id, attempt, reason, exit_code }`                           |
| `task.runner_requested`  | `mc:task-runner-requested`    | `{ task_id }`                                                       |
| `recipe.indexed`         | `mc:recipe-indexed`           | `{ slug, name, model, dir_sha, ... }`                               |
| `recipe.removed`         | `mc:recipe-removed`           | `{ slug }`                                                          |

All cases guard on `typeof window !== 'undefined'` for SSR safety. `detail` is passed through verbatim from `event.data`.

## GET /api/runtime/runner-status Contract

**Auth:** viewer tier (session cookie, admin API key, or proxy auth). Runner-secret / runner-token principals pass the viewer gate via role hierarchy.

**Response 200:**
```json
{
  "online": true,
  "last_heartbeat_at": 1776733470,
  "tasks_waiting": 3
}
```

**Response 401:** `{ "error": "Authentication required" }` when no valid credential.

**Response 500:** `{ "error": "Failed to read runner status" }` — Wave-1 banner treats this as "status unknown" and renders neither online nor offline state.

**Behavior:**
- `online = true` iff ANY row in `runner_heartbeats` has `last_heartbeat_at >= now - 90s`.
- `last_heartbeat_at` is the freshest heartbeat value, or `null` when no fresh heartbeat exists.
- `tasks_waiting` counts the CALLER'S workspace only: `COUNT(*)` of rows in `tasks` where `workspace_id = auth.user.workspace_id` AND `recipe_slug IS NOT NULL` AND `status IN ('inbox', 'assigned')`.
- 90s stale window is module-local const, matching `task-dispatch.ts` + `/api/runner/inventory/route.ts` per Plan 15-06 LOCKED decision.

## i18n Parity Verification

Custom Phase-16-scoped verification (the plan's literal verify command would fail on pre-existing drift — see Deviations below):

```bash
jq_filter='[paths(scalars) | join(".")] | map(select(
  startswith("nav.recipes") or
  startswith("taskBoard.recipeBadge.") or
  startswith("taskBoard.runnerBanner.") or
  startswith("taskBoard.progressTab.") or
  startswith("taskBoard.recipeField.") or
  startswith("taskBoard.advancedSection.") or
  startswith("recipesPanel.")
)) | sort'

expected=$(jq -r "$jq_filter" messages/en.json)
for loc in es fr de ja ko pt ru zh ar; do
  actual=$(jq -r "$jq_filter" messages/$loc.json)
  [ "$expected" = "$actual" ] && echo "OK: $loc" || echo "DRIFT: $loc"
done
```

Result: **OK for all 9 non-en locales. 56 Phase-16 paths identical across 10 files.**

## Decisions Made

1. **DOM CustomEvent relay pattern chosen over a new Zustand slice** (deviation from research recommendation that suggested "extend useServerEvents + Zustand store with new slices"). Rationale: file-disjointness for Wave-1 plans, zero coupling to the store, and the `chat.message` precedent at `use-server-events.ts:152-158` already established the shape. Wave-1 plans that *need* cached recipe data (e.g. the recipe badge on the task card) can fetch `/api/recipes` once and refresh on `mc:recipe-indexed` / `mc:recipe-removed` — no store extension required in Wave 0.
2. **Option A (viewer-auth endpoint) chosen over Option B (runner.heartbeat SSE)** for the runner-status banner. Simpler, no event-bus churn (would have been ~600 events/min on idle), and matches the `/api/status` precedent.
3. **`workspace_id` (not `tenant_id`) used for `tasks_waiting` scoping.** `auth.user.workspace_id` is verified in `src/lib/auth.ts:63` on the `User` interface, matches existing multi-workspace conventions in the codebase.
4. **Idempotent Node script for i18n seeding rather than Edit tool on each of 10 files.** 540 key insertions with merge-only semantics (refuses to clobber existing keys, hard-fails on value drift).
5. **Pre-existing drift between en.json and other locales left untouched.** 131 lines of drift predate Phase 16 and are out-of-scope per deviation Rule 4 (architectural — reconciling 131 lines of translation drift is not a "bug in current task's changes").
6. **`modelTierClassName()` helper added to the module** (beyond what the plan prescribed) so Wave-1 components never have to branch on `tier === 'unknown'` themselves. Exported alongside the raw map so callers can pick.
7. **Byte-for-byte parity test added for `MODEL_TIER_COLORS`** to guard the visual regression surface: any future palette change requires a visible test update, not a silent override.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `modelTierClassName()` helper to the model-tier-colors module**
- **Found during:** Task 1 Step 1 (creating the shared util)
- **Issue:** The raw `MODEL_TIER_COLORS` map does not cover the `'unknown'` tier; the plan's own `interfaces` block defines `ModelTier = 'opus' | 'sonnet' | 'haiku' | 'unknown'` but leaves callers to hand-roll the muted-fallback branch. Five Wave-1 plans would each duplicate the same conditional.
- **Fix:** Exported `modelTierClassName(tier: ModelTier): string` alongside the map — known tiers hit `MODEL_TIER_COLORS[tier]`, `'unknown'` returns the neutral `'bg-muted/20 text-muted-foreground border-muted/30'` fallback. Added three `modelTierClassName` tests.
- **Files modified:** `src/lib/model-tier-colors.ts`, `src/lib/__tests__/model-tier-colors.test.ts`
- **Verification:** All 16 model-tier-colors tests pass.
- **Committed in:** 763ae9d (Task 1 commit)

**2. [Rule 4 - Architectural scope boundary] Left pre-existing en.json ↔ other-locale drift untouched**
- **Found during:** Task 2 verification (initial jq diff showed 131 lines of drift per locale)
- **Issue:** The plan's literal verify command (`diff <(jq -S 'paths' en.json ...) <(jq -S 'paths' $loc.json ...)`) would fail with non-empty output on every locale because 131 keys drift between en.json and other locales — drift that PRE-DATES Phase 16.
- **Fix:** None applied to existing keys. Used a targeted Phase-16-scoped jq filter (`startswith("nav.recipes") or startswith("taskBoard.recipeBadge.") or ...`) to verify the NEW keys have parity. Result: `56 paths × 10 locales identical`.
- **Files modified:** None beyond the planned 10 locale files.
- **Verification:** Phase-16-scoped parity check passes for all 9 non-en locales.
- **Impact:** Plan's truth-axiom "Every new i18n key exists in all 10 locale files" is satisfied. The plan's verify-shell one-liner is stricter than its own success criterion; reconciling 131 keys of pre-existing translation drift is a separate chore (deferred).

**3. [Rule 3 - Blocking] Documented pre-existing `recipe-watcher-events.test.ts` flake in deferred-items.md**
- **Found during:** Full-suite `pnpm test --run` during Task 1 verification
- **Issue:** Test "broadcasts recipe.indexed after a live change event (debounce observed)" times out in full-suite runs on macOS but passes in isolation — not caused by 16-01 code changes (confirmed via isolated re-run: 5/5 pass).
- **Fix:** Documented in `.planning/phases/16-runtime-ui-surfaces/deferred-items.md`. Plan 16-01 does not touch `src/lib/recipe-watcher.ts`.
- **Files modified:** `.planning/phases/16-runtime-ui-surfaces/deferred-items.md` (new file)
- **Verification:** Isolated `pnpm vitest run src/lib/__tests__/recipe-watcher-events.test.ts` → 5/5 pass.
- **Impact:** Zero — this is pre-existing macOS/fsevents timing noise, not a Phase 16 regression.

---

**Total deviations:** 3 auto-fixed (1 missing critical, 1 architectural scope boundary, 1 blocking).
**Impact on plan:** All three preserve Plan 16-01 intent. The helper extension reduces Wave-1 duplication; the scope boundary protects against unrelated drift-reconciliation pollution; the flake note is defensive documentation.

## Issues Encountered

None during planned work.

## Auth Gates Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Wave-1 plans (16-02 through 16-06) can now execute in parallel:
- **Task interface** is widened in both declarations → `task.recipe_slug`, `task.worktree_path`, etc. compile cleanly in Wave-1 code.
- **MODEL_TIER_COLORS** is importable from `@/lib/model-tier-colors` → recipe badge, recipes panel chip, combobox tier indicator all share one palette.
- **SSE relays** are firing DOM CustomEvents → Wave-1 components addEventListener for the 6 runtime events without touching the dispatcher.
- **Runner-status endpoint** returns the documented shape under viewer auth → RUI-02 banner polls it every 10s.
- **i18n keys** are present in all 10 locales → Wave-1 components call `useTranslations('taskBoard.recipeBadge')` / `taskBoard.runnerBanner` / `recipesPanel` / etc. and the next-intl loader resolves every key (no raw-key-literal fallbacks visible to users).

No blockers for Phase 16 Wave 1 entry.

## Self-Check: PASSED

All created files present:
- `src/lib/model-tier-colors.ts`
- `src/lib/__tests__/model-tier-colors.test.ts`
- `src/lib/__tests__/use-server-events.test.ts`
- `src/app/api/runtime/runner-status/route.ts`
- `src/app/api/runtime/runner-status/__tests__/route.test.ts`
- `.planning/phases/16-runtime-ui-surfaces/seed-i18n.mjs`
- `.planning/phases/16-runtime-ui-surfaces/deferred-items.md`

All task commits present in `git log`:
- 763ae9d — Task 1 (shared util + interface widening + SSE relays + runner-status endpoint)
- d4b3fb3 — Task 2 (atomic 10-locale i18n seeding)

Plan verification gates:
- `pnpm typecheck` → 0
- `pnpm lint` → 0 errors (77 pre-existing warnings)
- `pnpm vitest run <3 plan test files>` → 30/30 passing
- Grep `from '@/lib/model-tier-colors'` in agent-detail-tabs.tsx → PRESENT
- Grep `^const MODEL_TIER_COLORS` in agent-detail-tabs.tsx → ABSENT (as required)
- Grep `case 'task.checkpoint_added'` in use-server-events.ts → count 1
- Phase 16 key-parity jq diff across 10 locales → empty

---
*Phase: 16-runtime-ui-surfaces*
*Completed: 2026-04-21*
