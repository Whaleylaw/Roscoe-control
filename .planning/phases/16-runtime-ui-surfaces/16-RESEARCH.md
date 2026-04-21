# Phase 16: Runtime UI Surfaces — Research

**Researched:** 2026-04-20
**Domain:** React 19 panel/modal extension + next-intl i18n + SSE consumer wiring over existing Phase 11–15 runtime substrate
**Confidence:** HIGH (every finding cites an exact file:line; no external library speculation beyond the locked Mission Control stack)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Recipe badge (RUI-01)**
- Style: Chip/pill with recipe name as label, filled background using model-tier color (opus=purple, sonnet=blue, haiku=green tints).
- Color source: Reuse existing `MODEL_TIER_COLORS` in `src/components/panels/agent-detail-tabs.tsx:807-810` — single source of truth.
- Placement: Top-right of the task card, joining the existing badge row that holds `phase-badge.tsx` and `gate-badge.tsx` in `src/components/panels/task-card/`. No layout shift.
- Long-name handling: Truncate with ellipsis + full name in the native `title` attribute / tooltip on hover.
- No-recipe cards: No badge rendered — cards without `recipe_slug` look identical to today.

**Runner-status banner (RUI-02)**
- Placement: Sticky bar INSIDE `task-board-panel.tsx` (NOT `header-bar.tsx`), between the panel header and the Kanban columns. Scoped to the task-board view only.
- Copy (localized):
  - Online: `🟢 Runner online`
  - Offline: `🔴 Runner offline — tasks waiting: N` (N = count of tasks with `recipe_slug` in `assigned`/`inbox` awaiting a runner).
- Click behavior: Informational only — no click action, no popover, no filter.
- Multi-runner handling: Treat as single-runner. "Online" = ANY runner heartbeat is fresh.
- Live updates: Driven by existing SSE runtime events from Phase 15 (heartbeat staleness via polling the freshest-heartbeat surface; no dedicated `runner.heartbeat` SSE event exists today — see Focus Area 2).

**Progress tab on task detail (RUI-03)**
- Format: Vertical timeline with connector line and colored status dot (completed=green, in_progress=blue w/ pulse, blocked=red).
- Grouping: Collapsible sections per attempt. Latest attempt open by default, older attempts collapsed with a checkpoint-count summary. Backed by `GET /api/tasks/:id/checkpoints?attempt=N`.
- Sort within each attempt: Newest-first, so live SSE updates land at the visible edge.
- Artifact rendering: Lightweight — each artifact = kind-glyph + name, clickable where applicable. Kind glyphs: 📄 file, 🔗 url, 📝 diff, ✅ test_result, 💬 comment, ✨ other. No inline preview.
- Blocker styling: Red border on the checkpoint row, `blocker_reason` shown inline prominently.
- Running styling: Pulsing blue dot on the current `in_progress` checkpoint.
- Live updates: Subscribe to `task.checkpoint_added` SSE events scoped to the task id; new rows append without a page reload.

**Task form — Recipe dropdown (RUI-04)**
- Dropdown UX: Command-palette-style combobox. Type to filter via `/api/recipes/search`. Keyboard-nav (↑/↓/Enter). Each result row shows recipe name + model-tier chip + short description. Clear button to deselect.
- Validation: Inline (zod) — invalid `recipe_slug` rejected at submit.

**Task form — Advanced section (RUI-04)**
- Default state: Collapsed. Expands on click. Session-local open state (not persisted).
- Fields exposed:
  - `read_only_mounts`: Repeatable text-input rows with ➕ add and ✖ remove per row. One path per row.
  - `extra_skills`: Chip input — type a skill name + Enter to commit as a chip; ✖ on the chip to remove.
  - `model_override`: Plain text input (e.g., `anthropic/claude-sonnet-4-20250514`).
- Validation: Inline (zod) on submit. No backend path autocomplete.

**Recipes panel (RUI-06)**
- Nav entry: Reachable from main nav rail (`src/components/layout/nav-rail.tsx`). Panel slug decided by Claude.
- Layout: Vertical list. One row per indexed recipe showing name, description, model chip, tag chips, "View" action.
- Resync button: In panel header. Shows spinner while syncing. Toast on success/error with counts (e.g., `Indexed 12 recipes (3 new, 1 removed)`).
- Authoring: Filesystem-first — no create/edit/delete UI in Phase 16.

**Localization (RUI-05)**
- Every new user-facing string goes through `next-intl` and lands atomically across all 10 locale JSON files in `messages/` (en/es/fr/de/ja/ko/pt/ru/zh/ar).

### Claude's Discretion
- Exact component names, file paths, and test scaffolding.
- Dark/light theme variant tuning for the new chips/dots/banner.
- Heartbeat-freshness threshold for "runner online" (default to existing scheduler config — 90s LOCKED per Phase 15).
- Banner state transition animation.
- Dismissibility of the banner when online (suggestion: non-dismissible, auto-collapses).
- Empty-state copy before first checkpoint on the Progress tab.
- Tokens/duration display format inside a checkpoint row.
- Scroll-anchoring behavior on SSE arrival in the Progress tab.
- Combobox keyboard shortcuts beyond ↑/↓/Enter.
- Mobile/compact layout variants.
- ARIA/a11y labels and focus management.
- Toast component reuse (pick the existing feedback mechanism; do not introduce a new toast system).
- Panel slug for the Recipes panel.

### Deferred Ideas (OUT OF SCOPE)
- Filter-by-recipe on Kanban.
- Rich artifact previews (inline diff, test summary, URL preview).
- Recipe authoring UI (create/edit/delete in Recipes panel).
- Multi-runner UI (per-runner chips, per-runner dashboards).
- Recipe analytics (success rate, avg tokens, leaderboard).
- Recipe detail view beyond YAML.
- Mobile-first redesign of the task-board shell.
- Toast system overhaul.
- Banner-freshness threshold as user-configurable setting.
- Persisted "Advanced section open" preference.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RUI-01 | Task card displays recipe badge (name + model tier color) when `recipe_slug` set | Focus Areas 1, 3 — `MODEL_TIER_COLORS` extraction, task-card directory extension, `Task` interface widening, no-recipe parity |
| RUI-02 | Task-board shell shows live runner-status banner (🟢 online / 🔴 offline — N waiting) | Focus Areas 2, 4 — no `runner.heartbeat` SSE today; new viewer-auth endpoint OR heartbeat→SSE emission needed; banner placement inside `task-board-panel.tsx`; waiting count query |
| RUI-03 | Task detail "Progress" tab — live checkpoint timeline grouped by attempt via SSE | Focus Areas 5, 6 — `TaskDetailModal` tab extension, `GET /api/tasks/:id/checkpoints` consumer, `task.checkpoint_added` SSE wiring into `use-server-events.ts` |
| RUI-04 | Task create/edit form — Recipe combobox (`/api/recipes/search`) + collapsible Advanced section (`read_only_mounts`, `extra_skills`, `model_override`) | Focus Areas 7, 8 — CreateTaskModal/EditTaskModal structure, existing autocomplete precedent (MentionTextarea), POST/PUT payload shape |
| RUI-05 | All new UI strings translated across 10 locales atomically | Focus Area 9 — `messages/<locale>.json` structure, namespace conventions (`taskBoard`, `project.lifecycle`, `nav`), 2,400-line en.json template |
| RUI-06 | Recipes panel (main nav) lists indexed recipes with Resync button; authoring stays filesystem-first | Focus Areas 10, 11 — nav-rail group/item addition, ContentRouter case, `GET /api/recipes` + `POST /api/recipes/resync` consumers |
</phase_requirements>

## Summary

Phase 16 is "UI consumer" work over a fully-shipped runtime. Every backend endpoint the plan needs already exists (`/api/recipes/search` — Phase 12; `/api/tasks/:id/checkpoints` — Phase 15; `/api/recipes/resync` — Phase 12; recipe POST/PUT fields — Phase 13). The SSE event bus emits the six new event types (`task.runner_requested`, `task.container_started`, `task.container_exited`, `task.checkpoint_added`, `recipe.indexed`, `recipe.removed`). The UI has to **catch them and render**, not produce them.

There are two sharp edges the planner must NOT miss:

1. **The client-side SSE dispatcher in `src/lib/use-server-events.ts:95-192` currently handles only 7 event types (`task.created`, `task.updated`, `task.status_changed`, `task.deleted`, `agent.created`, `agent.updated`/`agent.status_changed`, `chat.message`, `notification.created`, `activity.created`). None of the six new runtime event types are dispatched today.** Any component that wants to react to `task.checkpoint_added`, `task.container_started`, `task.container_exited`, `recipe.indexed`, `recipe.removed`, or `task.runner_requested` must either (a) extend `useServerEvents` + Zustand store with new slices, or (b) subscribe to the raw EventSource inline (anti-pattern; avoid). **Recommendation: extend `useServerEvents` once with a minimal runtime-state slice (runner heartbeat freshness + a per-task-id `checkpoints` cache) and consume from components via Zustand selectors.** See Focus Area 6.

2. **There is no viewer-authenticated endpoint that exposes runner heartbeat state.** `GET /api/runner/inventory` (Phase 15-06, runner-secret only at `src/app/api/runner/inventory/route.ts:37-42`) and `POST /api/runner/heartbeat` (runner-secret only) both gate on `user.id === -1000`. The runner-status banner needs a viewer- or operator-readable surface. **Recommendation: add a new thin `GET /api/runtime/runner-status` endpoint (viewer auth) that projects `{ online: boolean, last_heartbeat_at: number | null, tasks_waiting: number }` from the same `runner_heartbeats` table query the inventory endpoint uses, plus a `SELECT COUNT(*) FROM tasks WHERE recipe_slug IS NOT NULL AND status IN ('inbox','assigned')` for `tasks_waiting`.** The 90s stale window constant is module-local in three places (`task-dispatch.ts`, `inventory/route.ts`, upcoming `runner-status/route.ts`) per Plan 15-06's LOCKED decision. See Focus Area 2.

**Primary recommendation:** Structure Phase 16 as **six parallel Wave-1 plans sharing one Wave-0 foundation**:
- **Wave 0** — Extend `Task` interface (`store/index.ts`, `task-board-panel.tsx`) with `recipe_slug`, `workspace_source`, `read_only_mounts`, `extra_skills`, `model_override`, `runner_attempts`, `worktree_path`, `container_id`, `runner_started_at`, `runner_exit_code`, `runner_max_attempts`, `runner_last_failure_reason`; extract `MODEL_TIER_COLORS` + a new `modelToTier()` helper into `src/lib/model-tier-colors.ts`; add ALL new i18n keys (en stub) across ALL 10 locale JSON files with pass-through placeholders so later plans never race on JSON merges; extend `use-server-events.ts` with the six new event dispatchers + a minimal runtime-state slice in the Zustand store.
- **Wave 1** — Six file-disjoint plans (see Plan Decomposition).

---

## Focus Area 1 — Task card & Task interface extension

**Files to read / extend:**
- `src/components/panels/task-card/phase-badge.tsx` (21 lines) — template for the new `recipe-badge.tsx`
- `src/components/panels/task-card/gate-badge.tsx` (27 lines) — template with `useTranslations('project.lifecycle')` pattern
- `src/components/panels/task-card/__tests__/phase-badge.test.tsx` (36 lines) — template for the new `recipe-badge.test.tsx`
- `src/components/panels/task-board-panel.tsx:1059-1062` — composition site on the card
- `src/components/panels/task-board-panel.tsx:1499-1501` — composition site on the TaskDetailModal header
- `src/components/panels/task-board-panel.tsx:23-58` — the local `Task` interface (MISSING `recipe_slug` and the other v1.2 runtime fields)
- `src/store/index.ts:99-139` — the global `Task` interface in Zustand (MISSING same fields)
- `src/components/panels/agent-detail-tabs.tsx:807-810` — the locked `MODEL_TIER_COLORS` map to reuse

**Existing `MODEL_TIER_COLORS` (single source of truth per CONTEXT.md):**

```ts
// src/components/panels/agent-detail-tabs.tsx:807-810
const MODEL_TIER_COLORS: Record<string, string> = {
  opus: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  sonnet: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  haiku: 'bg-green-500/20 text-green-400 border-green-500/30',
}
```

**Extraction recommendation:** Move to `src/lib/model-tier-colors.ts` so both the recipe badge and the recipes panel chip import from the same place. Export both the map AND a helper:

```ts
// src/lib/model-tier-colors.ts (new — Phase 16)
export const MODEL_TIER_COLORS: Record<'opus' | 'sonnet' | 'haiku', string> = {
  opus: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  sonnet: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  haiku: 'bg-green-500/20 text-green-400 border-green-500/30',
}

export type ModelTier = keyof typeof MODEL_TIER_COLORS | 'unknown'

/**
 * Derive a model tier from a recipe's model.primary string.
 * Examples:
 *   'claude-opus-4-7-20251001'   → 'opus'
 *   'anthropic/claude-sonnet-4-6' → 'sonnet'
 *   'claude-haiku-4-5-20251001'   → 'haiku'
 *   unknown                        → 'unknown' (falls back to a neutral chip)
 */
export function modelToTier(model: string | null | undefined): ModelTier {
  if (!model) return 'unknown'
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('sonnet')) return 'sonnet'
  if (lower.includes('haiku')) return 'haiku'
  return 'unknown'
}
```

Then patch `agent-detail-tabs.tsx` to import from the new module — drops duplicate, preserves visual parity.

**Task interface widening — two files must change atomically:**

```ts
// src/store/index.ts:99-139 — add AFTER line 138 (before the closing brace)
  // Phase 13/14 v1.2 runtime-context fields (nullable — pre-Phase-13 rows have NULL)
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

`src/components/panels/task-board-panel.tsx:23-58` — mirror the same additions.

**Note:** `src/app/api/tasks/route.ts:29-47` already serializes these fields (`mapTaskRow` parses `workspace_source`, `read_only_mounts`, `extra_skills` JSON columns and spreads the rest via `...task`). The store simply does not declare them in its TypeScript shape — the runtime data is already flowing end-to-end.

**Recipe badge component shape:**

```tsx
// src/components/panels/task-card/recipe-badge.tsx (new)
'use client'
import { MODEL_TIER_COLORS, modelToTier, type ModelTier } from '@/lib/model-tier-colors'

type TaskLike = { recipe_slug?: string | null; recipe_model?: string | null }

export function RecipeBadge({ task }: { task: TaskLike }) {
  if (!task.recipe_slug) return null
  const tier = modelToTier(task.recipe_model)
  const classes = tier === 'unknown'
    ? 'bg-muted/20 text-muted-foreground border-muted/30'
    : MODEL_TIER_COLORS[tier]
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-mono truncate max-w-[10rem] ${classes}`}
      title={task.recipe_slug}
    >
      {task.recipe_slug}
    </span>
  )
}
```

**Pitfall:** `Task` rows from `/api/tasks` carry `recipe_slug` but NOT the recipe's `model.primary`. The badge needs tier color. Two options:
- **A (simple, 1 extra join):** Extend the `GET /api/tasks` SELECT to LEFT JOIN `recipes` on `t.recipe_slug = r.slug` and project `r.model_json` (already stored as JSON) → client parses and derives tier. Cost: one SQL JOIN + a 200-byte JSON parse per task row.
- **B (normalize at card):** Store the full recipe map once in Zustand (fetch `/api/recipes` on boot), and look up `recipe_model` by slug at render time. Cost: one extra fetch on boot; cheap and reusable by the Recipes panel too.

**Recommendation: Option B.** It's also what the Recipes panel needs anyway, and the lookup is O(1) by slug. Add a `recipes` slice to the Zustand store (loaded once on mount, refreshed on `recipe.indexed` / `recipe.removed` SSE events — which Plan 15-06 already emits).

## Focus Area 2 — Runner-status banner

**Files to read:**
- `src/components/layout/local-mode-banner.tsx` (44 lines) — visual reference for sticky banner styling
- `src/components/layout/openclaw-update-banner.tsx` (138 lines) — extended-state banner (idle/updating/success/error) reference
- `src/components/panels/task-board-panel.tsx` (2,611 lines, main `TaskBoardPanel` export at line 410) — banner host
- `src/app/api/runner/heartbeat/route.ts` — existing heartbeat persistence; DOES NOT broadcast SSE
- `src/app/api/runner/inventory/route.ts:37-42` — runner-secret-only endpoint; NOT consumable from the browser

**Critical gap — no viewer-authenticated runner-status surface exists today.**

Grep'd every route: `/api/runner/*` are all runner-secret (id=-1000) or runner-token (id=-2000). The heartbeat POST at `src/app/api/runner/heartbeat/route.ts` does NOT call `eventBus.broadcast('runner.heartbeat', ...)` — only writes to `runner_heartbeats` table. The `EventType` union at `src/lib/event-bus.ts:15-61` has NO `runner.heartbeat` or `runner.online`/`runner.offline` member.

**Two solutions (planner must pick one):**

**Option A — Add a read-only viewer-auth endpoint** (RECOMMENDED):
```ts
// src/app/api/runtime/runner-status/route.ts (new)
// GET — viewer auth. Returns:
// {
//   online: boolean,                 // last_heartbeat_at >= now - 90s
//   last_heartbeat_at: number|null,
//   tasks_waiting: number            // count(recipe_slug IS NOT NULL AND status IN ('inbox','assigned'))
// }
```
Banner polls this every 10s (matches heartbeat cadence). No SSE extension needed. 90s stale window is the same module-local const pattern established by `task-dispatch.ts` and `inventory/route.ts` per Plan 15-06.

**Option B — Extend heartbeat POST to broadcast SSE + add new EventType member**:
Append `'runner.heartbeat'` to `EventType` union, have heartbeat POST broadcast on every beat, `useServerEvents` maintains a `lastHeartbeatAt` slice, banner subscribes. Cost: 10 heartbeats/min × ~60 SSE clients = 600 events/min on an idle system. Cheap but noisy.

**Tradeoff:** Option A is simpler (no SSE noise, no event-bus churn, clear viewer/operator contract); Option B is push-not-pull (no 10s lag). Given the banner is an ambient status indicator, not a hot path, **Option A is the better fit and matches how `/api/status` already serves similar overview data.** The banner then ALSO subscribes to `task.container_started` / `task.container_exited` SSE events for near-real-time transitions (optional polish).

**Banner placement inside `task-board-panel.tsx`:**

The `TaskBoardPanel` export at line 410 returns a JSX tree. The Kanban column grid starts around line 950 (after header/filters). The banner slots between panel header and Kanban columns. Use `local-mode-banner.tsx`'s sticky styling as template:

```tsx
<div className="mx-4 mt-3 mb-0 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-{state}/5 border border-{state}/15 text-sm">
  <span className="w-1.5 h-1.5 rounded-full bg-{state} shrink-0" />
  <p className="flex-1 text-xs text-muted-foreground">{t(state === 'online' ? 'runnerOnline' : 'runnerOffline', { count: tasksWaiting })}</p>
</div>
```

**Tasks-waiting query** (backend, in the new runner-status route):
```sql
SELECT COUNT(*) FROM tasks
WHERE workspace_id = ?
  AND recipe_slug IS NOT NULL
  AND status IN ('inbox', 'assigned')
```
Workspace-scoped so per-workspace banners show the right count.

## Focus Area 3 — Task card composition points

**Composition sites (two) per `src/components/panels/task-board-panel.tsx`:**

1. **Kanban task card badge row (line ~1060):** The row is `<div className="flex items-center gap-1.5 ...">` holding `<PhaseBadge />`, `<GateBadge />`, ticket_ref chip, GitHub issue, PR badge, Aegis chip, "awaiting_owner" chip. **Insert `<RecipeBadge task={task} />` directly after `<GateBadge />` at line 1062.** Also shows `task.ticket_ref`, `task.spawned` and other chips interleaved. Order: recipe badge should be LEFT of GitHub/PR/Aegis chips so runtime context clusters with phase/gate context.

2. **TaskDetailModal header (line ~1499):** Same badge row pattern in the detail modal. **Insert `<RecipeBadge task={task} />` directly after `<GateBadge />` at line 1501.**

**Layout guard:** CONTEXT.md says "no layout shift for cards without a recipe." The badge returns `null` when `recipe_slug` is nullish — verified against `phase-badge.tsx:12` precedent. No layout shift because the parent is `flex items-center gap-1.5` and renders no gap between absent badges.

## Focus Area 4 — Task-board panel structure

**File:** `src/components/panels/task-board-panel.tsx` (2,611 lines — yes, single file; no splitting in this phase).

**Top-level function tree:**
- Line 199: `MentionTextarea` (autocomplete pattern — DO reuse for recipe combobox)
- Line 343: `DunkItButton`
- Line 410: `export function TaskBoardPanel` — main panel (banner host)
- Line 1254: `function TaskDetailModal` — Progress tab host (lines 1580-1620 tab bar, activeTab state at 1289)
- Line 1879: `function TaskSessionFeed`
- Line 1968: `function ClaudeCodeTasksSection`
- Line 2052: `function HermesCronSection`
- Line 2112: `export function CreateTaskModal` — recipe dropdown host
- Line 2400: `function EditTaskModal` — recipe dropdown host (read-only for `recipe_slug` per Phase 13 decision)

**Key:** CreateTaskModal and EditTaskModal are BOTH in this file. Extending both means coordinating a single edit pass. They share no helpers for Recipe dropdown or Advanced section, so the new components MUST live outside as reusable primitives (keep the file from growing past 3k lines).

**Recommendation:** Create new directory `src/components/panels/task-form/` (matches `src/components/panels/task-card/` convention) with:
- `recipe-combobox.tsx` (search input + dropdown list)
- `recipe-combobox.test.tsx`
- `advanced-section.tsx` (collapsible wrapper + the three field editors)
- `advanced-section.test.tsx`
- `mounts-editor.tsx` (repeatable text-input rows)
- `skills-chip-input.tsx` (chip-input)

CreateTaskModal + EditTaskModal import from there.

## Focus Area 5 — TaskDetailModal Progress tab

**Current tab bar** at `src/components/panels/task-board-panel.tsx:1580-1620`:
- State: `const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'quality' | 'session'>('details')` (line 1289)
- Static tabs: `['details', 'comments', 'quality']` rendered via `.map` (line 1581)
- Conditional tab: `session` (rendered only when `task.metadata?.dispatch_session_id`, line 1601)
- Panel containers: `activeTab === 'details'` (line 1622), `'comments'` (1733), `'quality'` (1811), `'session'` (1864)

**Extension pattern for Progress tab:**

Three surgical edits:
1. Widen `activeTab` state type: `'details' | 'comments' | 'quality' | 'session' | 'progress'`.
2. Add conditional tab button (after `comments` but before `quality`, or after `session` — planner's call) — conditional on `task.recipe_slug != null` (Progress tab only shown for recipe-tagged tasks per RUI-03 intent).
3. Add a new tabpanel container after `activeTab === 'session'` block: `{activeTab === 'progress' && <ProgressTab taskId={task.id} />}`.

**Component skeleton:**

```tsx
// src/components/panels/task-detail/progress-tab.tsx (new)
'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

type Checkpoint = {
  id: number
  attempt: number
  step: string
  summary: string
  status: 'completed' | 'in_progress' | 'blocked'
  artifacts?: Array<{ kind: 'file'|'url'|'diff'|'test_result'|'comment'|'other'; path?: string; url?: string; summary?: string }>
  next_step?: string
  blocker_reason?: string
  tokens_used?: number
  duration_ms?: number
  ts: string  // ISO-8601
}

export function ProgressTab({ taskId }: { taskId: number }) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [loading, setLoading] = useState(true)
  // Fetch once on mount
  useEffect(() => {
    fetch(`/api/tasks/${taskId}/checkpoints`)
      .then(r => r.json())
      .then(data => setCheckpoints(data.checkpoints ?? []))
      .finally(() => setLoading(false))
  }, [taskId])
  // Live updates via SSE — see Focus Area 6 for the subscription helper
  // useCheckpointEvents(taskId, (c) => setCheckpoints(prev => [c, ...prev]))
  // Group by attempt, render timeline…
}
```

**GET endpoint response shape** (verified from `src/app/api/tasks/[id]/checkpoints/route.ts:320`):
```ts
{ checkpoints: Array<{ id, task_id, attempt, step, summary, status, artifacts, next_step, blocker_reason, tokens_used, duration_ms, ts }> }
```

**Sort invariant:** Route hands back rows `ORDER BY (attempt ASC, id ASC)` per plan 15-04 contract. Client flips to newest-first by attempt-desc grouping + reversing within each attempt.

**Empty state:** First attempt with zero checkpoints — show placeholder per CONTEXT.md Claude's-discretion: "Waiting for first checkpoint…" (suggestion).

## Focus Area 6 — SSE dispatcher extension

**File:** `src/lib/use-server-events.ts` (217 lines).

**Current dispatch switch** (line 95-192) handles ONLY:
- `connected`
- `task.created` / `task.updated` / `task.status_changed` / `task.deleted`
- `agent.created` / `agent.updated` / `agent.status_changed`
- `chat.message`
- `notification.created`
- `activity.created`

**Missing (Phase 15-shipped events the UI must catch):**
- `task.runner_requested` — for banner "tasks waiting" counter updates (or just refetch)
- `task.container_started` — could transition banner to online (or just refetch)
- `task.container_exited` — could invalidate progress tab + refetch runner-status
- `task.checkpoint_added` — MUST catch: drives live Progress-tab updates
- `recipe.indexed` / `recipe.removed` — MUST catch: keeps Recipes panel + per-task recipe cache fresh

**Extension pattern** — append cases to the existing `switch (event.type)` block:

```ts
// src/lib/use-server-events.ts (additions)
case 'task.checkpoint_added':
  // Minimal store slice: push to per-task checkpoints cache if present
  if (event.data?.task_id) {
    addCheckpoint(event.data)
  }
  // Also dispatch a DOM event so the currently-open Progress tab can react
  // without taking a direct store coupling (matches the chat-message D-20 relay pattern)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mc:checkpoint-added', { detail: event.data }))
  }
  break
case 'recipe.indexed':
case 'recipe.removed':
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(`mc:${event.type.replace('.', '-')}`, { detail: event.data }))
  }
  // Slice-level refresh: Zustand `refreshRecipes()` invalidator
  refreshRecipes()
  break
case 'task.container_started':
case 'task.container_exited':
  // Ambient transitions — useful for the banner / card runtime indicator.
  // Consumer components can either listen to custom DOM events or re-fetch
  // /api/runtime/runner-status on a short debounce.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(`mc:${event.type.replace('.', '-')}`, { detail: event.data }))
  }
  break
case 'task.runner_requested':
  // Debounced banner-count refresh. The banner component owns the debounce.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mc:task-runner-requested', { detail: event.data }))
  }
  break
```

**Precedent for window.dispatchEvent pattern:** Lines 152-158 already use `window.dispatchEvent(new CustomEvent('mc:chat-message', ...))` as a decoupling relay — "lets scoped views re-fetch without needing direct store coupling" per the comment. Phase 16 extends this cleanly.

**Store slice additions** (minimal):
```ts
// src/store/index.ts
// In the main state tree
recipes: Recipe[]          // indexed recipes, loaded once + refreshed on SSE
refreshRecipes: () => Promise<void>
// OR, if simpler: don't store recipes in Zustand, use a standalone `useRecipes()` hook.
```

**Workspace-scoping caveat:** `src/app/api/events/route.ts:29-32` drops events whose `data.workspace_id` is PRESENT but mismatched. Plan 15-06 explicitly emits `recipe.indexed` / `recipe.removed` WITHOUT `workspace_id` (cross-workspace). `task.checkpoint_added` / `task.container_started` / `task.container_exited` all carry `workspace_id` per the handlers that emit them — they'll be filtered correctly. No new SSE-layer work.

## Focus Area 7 — Recipe combobox (RUI-04)

**Precedent to reuse: `MentionTextarea`** at `src/components/panels/task-board-panel.tsx:199-339`. Exactly the combobox-with-filtered-list UX the planner needs:
- Input ref + `[open, setOpen]` state + `[activeIndex, setActiveIndex]`
- Keyboard handling: ↑/↓ cycles via modular arithmetic, Enter/Tab inserts, Escape closes
- Filtered list computed from a prop (`mentionTargets`) via lowercase substring match + `.slice(0, 8)` cap
- Absolute-positioned dropdown with auto-upward flip based on `window.innerHeight - rect.bottom`

**Differences for Recipe combobox:**
- Data source is async (`/api/recipes/search?q=`) vs static prop. Add `useDebouncedEffect` or `setTimeout`-based 300ms debounce on the fetch.
- Single selection (not insertion), with a "clear" button to un-select.
- Display each recipe name + model-tier chip + description (reuse `MODEL_TIER_COLORS`).

**Endpoint contract** (verified from `src/app/api/recipes/search/route.ts`):
```
GET /api/recipes/search?q=STRING&limit=N
→ { recipes: Array<{ slug, name, description, model: {primary, fallback?, provider?}, tags: string[], ... }> }
```

Empty `q` returns the full list (up to limit 50, capped 200). Recipes with `error_message IS NOT NULL` are excluded.

**Skeleton:**

```tsx
// src/components/panels/task-form/recipe-combobox.tsx (new)
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MODEL_TIER_COLORS, modelToTier } from '@/lib/model-tier-colors'

type RecipeResult = { slug: string; name: string; description?: string; model?: { primary?: string } }

export function RecipeCombobox({
  value, onChange,
}: {
  value: string | null
  onChange: (slug: string | null) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<RecipeResult[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const t = useTranslations('taskBoard')

  // debounced fetch — exact pattern from search endpoint usage elsewhere
  useEffect(() => {
    if (!open) return
    const h = setTimeout(async () => {
      const res = await fetch(`/api/recipes/search?q=${encodeURIComponent(q)}&limit=20`)
      const data = await res.json()
      setResults(data.recipes ?? [])
      setActiveIndex(0)
    }, 300)
    return () => clearTimeout(h)
  }, [q, open])

  // Render: input + clear button + absolute dropdown with keyboard handling
  // Exactly mirror MentionTextarea's open/activeIndex/onKeyDown pattern
}
```

## Focus Area 8 — Advanced section (RUI-04 part 2)

**Three fields, each with a distinct UX primitive:**

1. **`read_only_mounts`**: Array of `{ host_path, container_path, label }`. UI: repeatable row with three inputs + ✖ remove. Header row with ➕ add.
2. **`extra_skills`**: Array of strings (host paths). UI: chip input. Type `/path/to/skill` + Enter → chip added. ✖ on chip removes.
3. **`model_override`**: Single string. UI: plain text input.

**Submit payload shape** (verified against `src/app/api/tasks/route.ts:380-390` INSERT):

```ts
// POST body — v1.2 additions on top of existing task schema
{
  // ... existing fields (title, description, priority, etc.)
  recipe_slug?: string | null,
  workspace_source?: { project_id: number, base_ref: string } | null,
  read_only_mounts?: Array<{ host_path: string, container_path: string, label: string }>,
  extra_skills?: string[],
  model_override?: string | null,
}
```

**Backend validation already done at the API** (Phase 13 — `src/lib/task-runtime-validation.ts` exports `TASK_RUNTIME_ERROR_CODES`, validates allowlist + caps + schema). The UI does NOT duplicate allowlist checks — it surfaces the structured 400 response. The task route returns:
```
400 { error: 'Validation failed', issues: [{ field, code, message, hint? }] }
```

Map `code` → localized inline error under the offending field.

**Zod on the client** is optional — the server is source-of-truth. But client-side zod gives instant feedback for trivial errors (empty fields when required). Planner's call.

**Collapsed state — session-local:**

```tsx
const [advancedOpen, setAdvancedOpen] = useState(false)  // Session-local per CONTEXT.md
```

No localStorage, no Zustand. Modal re-open = collapsed again. Matches CONTEXT.md LOCK.

**RECIPE_LOCKED caveat for EditTaskModal:**

Phase 13-03 documented: `recipe_slug` is mutable on a task ONLY pre-dispatch. Once the runner claims (status progresses past `assigned`), mutation is rejected with `RECIPE_LOCKED` error. **UI recommendation: in EditTaskModal, disable the recipe combobox when `task.status !== 'inbox' && task.status !== 'assigned'`** and show a small "locked — dispatch started" hint. The Advanced section fields have the same lock; disable them too.

## Focus Area 9 — i18n atomic 10-locale update

**Files:** `messages/{en,es,fr,de,ja,ko,pt,ru,zh,ar}.json` (10 files, all present; en.json is 2,412 lines).

**Namespace conventions already used** (verified from en.json):
- `common.*` — save, cancel, dismiss, etc.
- `nav.*` — nav-rail item labels + `nav.group.*`
- `taskBoard.*` — task board panel strings (lines 743-...). Includes `taskBoard.tabDetails`, `tabComments`, `tabQualityReview`, `tabSession`, `project`, `priority_*`, `colBacklog`, etc.
- `project.lifecycle.*` — GSD tab (lines 2349-...)
- `projects.*` — Projects panel list view

**Naming for Phase 16 strings (RECOMMENDED):**
- `taskBoard.recipeBadge.*` — badge tooltip / aria-label
- `taskBoard.runnerBanner.*` — `runnerOnline`, `runnerOfflineCount`, connection-lost states
- `taskBoard.progressTab.*` — `tabLabel`, `empty`, `artifactKindFile`, `artifactKindUrl`, etc., `attemptLabel`, `blockerPrefix`
- `taskBoard.recipeField.*` — `label`, `placeholder`, `clear`, `noResults`, `lockedHint`
- `taskBoard.advancedSection.*` — `heading`, `readOnlyMountsLabel`, `addMount`, `extraSkillsLabel`, `skillPlaceholder`, `modelOverrideLabel`
- `recipesPanel.*` — top-level panel namespace (NEW): `title`, `resync`, `resyncSpinner`, `resyncSuccess`, `resyncError`, `emptyHeading`, `emptyBody`, `viewRecipe`, etc.
- `nav.recipes` — nav-rail entry

**Process:** Add ALL keys first to `en.json`, then write a brief script or do a mechanical copy-paste into the other 9 with English as placeholder (sufficient per Phase 9 precedent — real translations can follow as separate edits). Precedent locked by Phase 9-10 which shipped English-everywhere for complex new namespaces (`project.lifecycle.*`).

**Atomic coverage enforcement:** Existing convention is an ESLint rule / inspection; verify via grep `jq 'paths[]' messages/{en,es}.json | sort | diff -` equivalence check before commit.

## Focus Area 10 — Nav rail Recipes entry (RUI-06)

**File:** `src/components/layout/nav-rail.tsx` (1,535 lines).

**Pattern to extend** (lines 27-83): `navGroups: NavGroup[]` declares an ordered list of groups. Each group has `id`, optional `label`, and `items: NavItem[]`. Each item has `id`, `label`, `icon` (React node), `priority` (show in mobile bottom bar), `essential?`.

**Insertion recommendation: add a new item under the existing `core` group between `tasks` and `chat`:**

```ts
// src/components/layout/nav-rail.tsx (edit around line 34)
{ id: 'recipes', label: 'Recipes', icon: <RecipesIcon />, priority: false, essential: false },
```

And a translation key:
```ts
// line 90 in navItemTranslationKeys
recipes: 'recipes',
```

And the i18n key in `nav.recipes` (10 locales).

**Icon:** No icon library per CLAUDE.md. Define an inline `<RecipesIcon />` component using a raw SVG path (precedent: `<ProjectsIcon />`, `<TasksIcon />` etc. all defined as inline SVG React components at the top of the file). Simple 🧾 or 📋-shaped SVG works.

**ContentRouter case:**

```ts
// src/app/[[...panel]]/page.tsx, switch starts line 522 — add after 'tasks' case
case 'recipes':
  return <RecipesPanel />
```

(Import added at top of page.tsx.)

## Focus Area 11 — Recipes panel (RUI-06)

**File to create:** `src/components/panels/recipes-panel.tsx`.

**Data sources (all exist):**
- `GET /api/recipes` — full list, admin-excluded broken rows by default (`error_message IS NULL`). Response shape via `mapRow` (src/app/api/recipes/route.ts:65-96):
  ```
  { recipes: Array<{ id, slug, name, description, when_to_use, image, workspace_mode, timeout_seconds, max_concurrent, env, secrets, tags, model: {primary, ...}, version, dir_sha, soul_md, workspace_id, tenant_id, created_at, updated_at }> }
  ```
- `POST /api/recipes/resync` — admin-only. Returns `{ scanned, inserted, updated, deleted, errors: [{slug, reason}] }`. Toast source.
- SSE: `recipe.indexed` / `recipe.removed` — Plan 15-06 broadcasts these; useServerEvents extension (Focus Area 6) relays them.

**Precedent panel for list-with-action layout:** `src/components/panels/github-sync-panel.tsx` (`handleSyncProject` / `handleSyncAll` at lines 248-290). Standard pattern:
1. `const [loading, setLoading] = useState(true)` — initial fetch.
2. `const [syncing, setSyncing] = useState(false)` — action in-flight.
3. `const [feedback, setFeedback] = useState<{ ok: boolean, message: string } | null>(null)` — toast surface (inline banner, auto-clear timer). NOTE: MC has no dedicated toast system. Inline feedback is the precedent (see github-sync-panel `showFeedback` helper).

**Skeleton:**

```tsx
// src/components/panels/recipes-panel.tsx (new)
'use client'
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { MODEL_TIER_COLORS, modelToTier } from '@/lib/model-tier-colors'

type Recipe = {
  slug: string; name: string; description?: string;
  model?: { primary?: string }; tags?: string[];
  timeout_seconds?: number; max_concurrent?: number;
}

export function RecipesPanel() {
  const t = useTranslations('recipesPanel')
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean, message: string } | null>(null)

  const fetchRecipes = useCallback(async () => {
    const res = await fetch('/api/recipes')
    const data = await res.json()
    setRecipes(data.recipes ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchRecipes() }, [fetchRecipes])

  // SSE reactivity via the Phase 16 extension to useServerEvents
  useEffect(() => {
    const onChange = () => { void fetchRecipes() }
    window.addEventListener('mc:recipe-indexed', onChange)
    window.addEventListener('mc:recipe-removed', onChange)
    return () => {
      window.removeEventListener('mc:recipe-indexed', onChange)
      window.removeEventListener('mc:recipe-removed', onChange)
    }
  }, [fetchRecipes])

  const handleResync = async () => {
    setSyncing(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/recipes/resync', { method: 'POST' })
      const report = await res.json()
      if (!res.ok) {
        setFeedback({ ok: false, message: report.error ?? t('resyncError') })
      } else {
        setFeedback({
          ok: true,
          message: t('resyncSuccess', { inserted: report.inserted, updated: report.updated, deleted: report.deleted })
        })
        await fetchRecipes()
      }
    } finally {
      setSyncing(false)
      setTimeout(() => setFeedback(null), 6000)  // precedent from showFeedback
    }
  }

  // Render header (title + Resync button + feedback banner) + list of rows
}
```

**"View" row action:** Navigate to `/recipes/:slug` OR open a read-only modal showing `soul_md` (Markdown-rendered via `MarkdownRenderer` — already imported by task-board-panel). **Recommendation: inline expand/collapse per-row** to avoid introducing new routes; matches the "minimal" scope lock.

## Focus Area 12 — Testing conventions

**Unit tests** (vitest + jsdom + @testing-library/react):
- Location: `<component-dir>/__tests__/<component-name>.test.tsx`. Example: `src/components/panels/task-card/__tests__/phase-badge.test.tsx`.
- Pattern: `render()` + `screen.getByText` / `expect(container).toBeEmptyDOMElement()` for nullable-render assertions.
- `NextIntlClientProvider` is NOT mocked in existing badge tests (line 17 of gate-badge.tsx uses `useTranslations('project.lifecycle')` — and the test at `__tests__/gate-badge.test.tsx` must wrap in a locale provider). Verify actual wrap pattern before copying.
- Store: panels that touch `useMissionControl()` typically use `vi.mock('@/store', …)` to stub the slice.

**Panel tests (existing):**
- `src/components/panels/__tests__/task-board-panel.test.tsx`
- `src/components/panels/__tests__/projects-panel.test.tsx`
- `src/components/panels/__tests__/create-task-modal-open-workspace.test.tsx` — exact precedent for testing CreateTaskModal in isolation

**SSE mocking:** Dispatcher in `use-server-events.ts` reads from `new EventSource(...)`. Tests typically either (a) `vi.mock('@/lib/use-server-events')` to stub the hook, or (b) simulate via `window.dispatchEvent(new CustomEvent('mc:checkpoint-added', { detail: ... }))` — the dispatcher's relay pattern (Focus Area 6) makes this trivial. ProgressTab tests use approach (b).

**Playwright E2E** (`tests/*.spec.ts`):
- 40+ existing spec files (e.g., `task-crud.spec.ts`, `agents-crud.spec.ts`). No `task-card.spec.ts` yet.
- Phase 17 RTEST-04 covers the E2E verification that the recipe badge and Progress tab update live on SSE events. Phase 16 does NOT need to add Playwright coverage — unit tests per component suffice.
- HOWEVER, a sanity-check E2E spec (`recipe-badge-renders.spec.ts` — 10 lines) is cheap. Planner's call whether to land in Phase 16 or defer to Phase 17.

## Focus Area 13 — Accessibility patterns

**Existing conventions (pulled from `task-board-panel.tsx` TaskDetailModal):**
- `role="dialog" aria-modal="true" aria-labelledby="task-detail-title"` on modal wrapper
- `role="tablist" aria-label={t('taskDetailTabs')}` on tab container
- `role="tab" aria-selected={activeTab === tab} aria-controls={`tabpanel-${tab}`}` on each tab button
- `role="tabpanel" aria-label={t('tabDetails')} id="tabpanel-details"` on each tab panel
- `aria-label={t('closeTaskDetails')}` on icon-only buttons
- `useFocusTrap(onClose)` hook (`@/lib/use-focus-trap`) for modal focus containment
- Icon-only buttons use `aria-label` or `title` attrs

**Phase 16 extensions must inherit these conventions:**
- Progress tab button gets `role="tab"` + `aria-selected` + `aria-controls` matching existing siblings.
- Recipe combobox: `role="combobox" aria-expanded={open} aria-activedescendant={…}` + list with `role="listbox"` and each item `role="option" aria-selected`.
- Banner: `role="status" aria-live="polite"` so screen readers announce state changes without stealing focus (matches local-mode-banner semantics).
- ✖/➕ icon buttons in mounts/skills editors need `aria-label` with localized text.

---

## Standard Stack

### Core (already installed — reuse)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next-intl | 4.8.x | i18n message files + `useTranslations` hook | Locked by project; all UI strings flow here |
| next-themes | 0.4.x | Dark/light theme tokens | Existing tailwind utilities `bg-*/15 text-*-400` etc. honour it |
| Tailwind CSS | 3.4.x | Utility classes for chips/dots/borders | Entire UI already written in Tailwind |
| Zustand | 5.0.x | Client state (task list, runner status, recipes cache) | Only shared-state mechanism |
| zod | 4.3.x | Client-side form validation (optional; server is source-of-truth) | Already used throughout for validation |
| @testing-library/react | 16.1.x | Unit tests | Existing patterns |
| vitest | 2.1.x | Test runner (jsdom) | Locked |

### Supporting (reuse existing infra)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@/components/ui/button` | — | Shared Button with `variant`, `size` props | ALL new buttons; no raw `<button>` except for role="tab" |
| `@/lib/use-focus-trap` | — | Modal focus containment | Any new modal |
| `@/lib/navigation` | — | `useNavigateToPanel()`, `usePrefetchPanel()` | Nav-rail item → panel wire-up |
| `@/components/markdown-renderer` | — | Safe markdown rendering | Recipe SOUL.md preview; checkpoint summaries if needed |

### Do NOT introduce

- **Any icon library** (CLAUDE.md LOCK — raw text/emoji only).
- **Any toast library** (no toast system exists; reuse inline-feedback pattern from `github-sync-panel.tsx`).
- **Any new combobox/command-palette library** (`MentionTextarea` is the precedent; extend the pattern rather than import cmdk/radix-combobox/downshift).

---

## Architecture Patterns

### Recommended project structure (NEW directories / files)

```
src/
├── components/
│   ├── panels/
│   │   ├── task-card/
│   │   │   ├── phase-badge.tsx        (existing)
│   │   │   ├── gate-badge.tsx         (existing)
│   │   │   ├── recipe-badge.tsx       (NEW — RUI-01)
│   │   │   └── __tests__/
│   │   │       └── recipe-badge.test.tsx
│   │   ├── task-form/                 (NEW)
│   │   │   ├── recipe-combobox.tsx    (RUI-04)
│   │   │   ├── advanced-section.tsx
│   │   │   ├── mounts-editor.tsx
│   │   │   ├── skills-chip-input.tsx
│   │   │   └── __tests__/
│   │   ├── task-detail/               (NEW)
│   │   │   ├── progress-tab.tsx       (RUI-03)
│   │   │   ├── checkpoint-row.tsx
│   │   │   └── __tests__/
│   │   ├── runner-status-banner.tsx   (NEW — RUI-02)
│   │   ├── runner-status-banner.test.tsx
│   │   ├── recipes-panel.tsx          (NEW — RUI-06)
│   │   ├── __tests__/
│   │   │   └── recipes-panel.test.tsx
│   │   └── task-board-panel.tsx       (EDIT — 3 surgical insertions)
│   └── layout/
│       └── nav-rail.tsx               (EDIT — add Recipes item + icon)
├── lib/
│   ├── model-tier-colors.ts           (NEW — extract from agent-detail-tabs.tsx)
│   └── use-server-events.ts           (EDIT — append 6 new case branches)
├── store/
│   └── index.ts                       (EDIT — widen Task interface + add recipes/runner slices)
├── app/
│   ├── api/
│   │   └── runtime/
│   │       └── runner-status/
│   │           ├── route.ts           (NEW — viewer-auth runner-status GET)
│   │           └── __tests__/route.test.ts
│   └── [[...panel]]/page.tsx          (EDIT — add 'recipes' case in ContentRouter)
└── messages/
    ├── en.json                        (EDIT — add ~50 new keys)
    ├── {es,fr,de,ja,ko,pt,ru,zh,ar}.json  (EDIT — mirror new keys, English fallback acceptable per Phase 9 precedent)
```

### Pattern 1: Badge composition over monolithic task card

Already established by `phase-badge.tsx` and `gate-badge.tsx`. Each badge is a self-contained, null-returnable component that composes into the existing flex row in `task-board-panel.tsx:1060`. **Do NOT refactor the task card into a separate component in this phase** — it's 2,611 lines, and the composition points are narrow (3 lines changed per insertion). A refactor belongs to a dedicated follow-up phase.

### Pattern 2: SSE dispatcher with DOM-event relay for scoped consumers

Seeded by `src/lib/use-server-events.ts:152-158` for chat messages. A global dispatcher updates Zustand, AND also `window.dispatchEvent(new CustomEvent('mc:chat-message', {...}))` so scoped components (like a currently-open session view) can subscribe without taking a direct store coupling. Phase 16 extends this to six new event types. **Every per-task consumer (Progress tab, runner-status banner) filters by `event.detail.task_id` before reacting.**

### Pattern 3: Inline feedback banner instead of toast

Precedent: `github-sync-panel.tsx` `showFeedback(ok, message)` → renders a small banner at the panel header that auto-clears after 5s. Recipe resync uses the same pattern — no toast library introduced.

### Anti-Patterns to Avoid

- **Don't refactor `task-board-panel.tsx`.** Surgical 3-line insertions at composition sites; do NOT extract TaskDetailModal, CreateTaskModal, or EditTaskModal in this phase (separate refactor phase later).
- **Don't add a new SSE endpoint for Phase 16.** Use the existing `/api/events` stream + extend the client dispatcher.
- **Don't cache `/api/recipes/search` results.** Always issue a fresh debounced fetch on query change — the backend is fast (FTS5 + BM25 + tag-weighted) and results are small.
- **Don't bypass `useTranslations`.** Every new string lives in next-intl message files, period.
- **Don't introduce a new icon library.** All chips/glyphs are raw text/emoji per CLAUDE.md. If an SVG is needed (e.g., nav-rail icon), inline it as a React component following existing `<ProjectsIcon />` precedent.
- **Don't add a `runner.heartbeat` SSE event just for the banner.** Either (a) poll the new `GET /api/runtime/runner-status` endpoint every 10s (recommended), or (b) use `task.container_started`/`task.container_exited` as proxies. Adding 10 heartbeats/min to the SSE stream is bandwidth waste.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Model-tier → color mapping | A new util in each component | `src/lib/model-tier-colors.ts` (NEW — extracted once, reused by badge + panel chip) | Single source of truth; DRY |
| Autocomplete/combobox UX | A new headless library | Pattern from `MentionTextarea` (task-board-panel.tsx:199-339) | Same repo, same tailwind tokens, same keyboard model |
| Tab bar on detail modal | A new tab component | Extend existing array at line 1581 (`['details', 'comments', 'quality']` → `['details', 'comments', 'quality', 'progress']`) | Existing `role="tab"` + aria wiring reuses seamlessly |
| SSE re-subscription / reconnect | A new hook | Extend `use-server-events.ts` dispatcher | Already handles 20-attempt exponential backoff, connection state, Zustand updates |
| Modal focus trap | A new hook | `useFocusTrap` from `@/lib/use-focus-trap` | Works with existing modal precedent |
| Toast notifications | Any toast library | Inline banner like `showFeedback` in `github-sync-panel.tsx:240-290` | No toast system exists; banner pattern is project-idiomatic |
| Markdown rendering for recipe SOUL.md | Pull in a new parser | `@/components/markdown-renderer` (already imported throughout) | Existing sanitised `react-markdown` + `remark-gfm` |
| Recipe slug → model tier derivation | Hardcode per component | `modelToTier(recipe.model.primary)` helper in `model-tier-colors.ts` | One place; tested once |
| i18n key management across 10 locales | ad-hoc scripts | JSON merge pattern established by Phase 9's `project.lifecycle.*` rollout | Atomic-PR convention already enforced |

**Key insight:** Every piece of UI plumbing Phase 16 needs already has a precedent in the codebase. The phase is 95% "compose existing patterns" and 5% "one genuinely new surface" (`/api/runtime/runner-status`). Resist the temptation to pull in new libraries.

---

## Common Pitfalls

### Pitfall 1: SSE dispatcher silently drops new event types
**What goes wrong:** Plan 15-01 added six new `EventType` union members, but `src/lib/use-server-events.ts:95-192` has no case for them. The server broadcasts; the client silently discards. Progress tab never updates. Banner never flips.
**Why:** The dispatcher's `switch (event.type)` has no `default: log warning` branch. Missing handlers are silent.
**How to avoid:** Wave 0 of Phase 16 MUST include the dispatcher extension. Any component that subscribes to checkpoint/container/recipe events must first verify the dispatcher relays them.
**Warning signs:** A component adds a `window.addEventListener('mc:checkpoint-added', ...)` but nothing ever fires → dispatcher isn't relaying → check `use-server-events.ts` case list.

### Pitfall 2: `runner_heartbeats` is NOT viewer-accessible
**What goes wrong:** The obvious banner implementation `fetch('/api/runner/inventory')` returns 403 — that endpoint is runner-secret (id=-1000) only.
**Why:** Phase 14/15 scoped `/api/runner/*` to the runner principal by design (RAUTH-01).
**How to avoid:** Create `GET /api/runtime/runner-status` with `requireRole('viewer')` and project a minimal subset (online, last_heartbeat_at, tasks_waiting) from the same DB query. Do NOT attempt to call inventory from the browser.
**Warning signs:** Tests pass but `fetch('/api/runner/inventory')` logs hit 403 in dev. OR the banner shows "Runner offline" permanently (because the fetch fails and the catch sets offline).

### Pitfall 3: `recipe_slug` missing from the client `Task` interface
**What goes wrong:** `task.recipe_slug` reads `undefined` in React even though the backend returns it, because the TypeScript interface doesn't declare it. Type-check passes; runtime sort/filter shows nothing.
**Why:** `src/store/index.ts:99-139` and the local `Task` in `task-board-panel.tsx:23-58` pre-date Phase 13. API response (`SELECT t.*` at src/app/api/tasks/route.ts:105) already carries the column, just untyped.
**How to avoid:** Wave 0 — widen both Task interfaces in ONE commit. Add all 12 Phase 13/14 runtime fields at once so later plans don't race.
**Warning signs:** Badge never renders even on known recipe-tagged tasks; TypeScript errors like "Property 'recipe_slug' does not exist on type 'Task'".

### Pitfall 4: Workspace-scoped events skipped on cross-workspace fixtures
**What goes wrong:** Unit tests simulate `recipe.indexed` events with workspace_id that doesn't match the session user; the SSE filter at `src/app/api/events/route.ts:31-32` drops them. Test asserts UI updated; assertion fails.
**Why:** `recipe.indexed` is emitted cross-workspace (no workspace_id) per Plan 15-06 LOCK. Any test that attaches workspace_id to recipe events will fail in integration. Contrast: `task.checkpoint_added` DOES carry workspace_id and MUST match the user's workspace to pass.
**How to avoid:** Component unit tests use `window.dispatchEvent` directly (bypass SSE filter). Integration tests must match workspace_id on task.* events and omit it on recipe.* events.
**Warning signs:** "Recipe indexed" test passes when dispatching via DOM but fails end-to-end via SSE mock.

### Pitfall 5: Recipe combobox races on rapid typing
**What goes wrong:** User types "foo" → fetch fires; before response returns, user types "foobar" → second fetch fires; first response arrives AFTER second, overwriting newer results with stale.
**Why:** No abort signal / no ordering.
**How to avoid:** Standard fetch debounce (300ms) as shown in skeleton. If a stale response returns, compare the query string when the response arrives to the current query — discard if mismatched. OR use `AbortController`.
**Warning signs:** Typing produces flickering / wrong results. Test that fires two queries in quick succession and asserts only the second's results land.

### Pitfall 6: Progress tab subscribes AFTER checkpoints are already in-flight
**What goes wrong:** User opens the Progress tab; ProgressTab fetches via REST; between the fetch and the SSE subscription activating, one new checkpoint fires and is lost.
**Why:** Order of operations: mount → fetch (async) → setState → then effect that subscribes.
**How to avoid:** Subscribe FIRST (sync in useEffect), THEN fetch. Any events that fire during the fetch are queued in the local state. After fetch returns, de-dupe by checkpoint_id before merging. (A lightweight `Map<checkpoint_id, Checkpoint>` works.)
**Warning signs:** Opening the tab at a moment of high checkpoint activity shows stale rows; refresh fixes it.

### Pitfall 7: i18n keys drift across the 10 locale files
**What goes wrong:** Plan lands English keys to en.json and forgets ar.json. Next-intl renders missing keys as the key literal (`taskBoard.runnerBanner.online`) in Arabic — visible to users.
**Why:** No automated enforcement; manual process.
**How to avoid:** Wave 0 MUST populate all 10 locale files atomically with English fallbacks; Waves 1-N only MUTATE existing keys' values, never ADD new keys. This matches Phase 9 precedent. Plan a final ad-hoc `jq` diff check before commit.
**Warning signs:** CI / manual testing shows the raw key string in a non-English locale.

### Pitfall 8: EditTaskModal allows mutating `recipe_slug` post-dispatch
**What goes wrong:** User edits a task whose runner already claimed it; sets a new recipe_slug; PUT returns 409 (`RECIPE_LOCKED`). UI shows generic error.
**Why:** Phase 13-03 locks `recipe_slug` mutation once `status != inbox && status != assigned`. Client didn't disable the field.
**How to avoid:** In EditTaskModal, disable the recipe combobox + Advanced section when `task.status` is past `assigned`; show localized "locked — dispatch started" hint below the field.
**Warning signs:** Users report "recipe won't update" errors that are actually the backend lock.

### Pitfall 9: Progress tab doesn't appear for non-recipe tasks
**What goes wrong:** A legacy task (no `recipe_slug`) shows an empty Progress tab (because no checkpoints exist) — confusing.
**Why:** RUI-03 implies the tab is for recipe-tagged tasks specifically.
**How to avoid:** Show the Progress tab conditionally: `{task.recipe_slug != null && <TabButton id="progress" />}`. Legacy tasks don't see the tab at all.
**Warning signs:** Users see an empty Progress tab on non-recipe tasks and ask what it's for.

### Pitfall 10: Recipe badge shows before recipe data loads
**What goes wrong:** Task has `recipe_slug='foo'`; recipes cache hasn't loaded; `modelToTier(undefined)` returns `'unknown'`; badge renders with neutral grey instead of tier color.
**Why:** Badge uses `task.recipe_model` but that field doesn't exist on tasks by default; must come from the recipes cache or a JOIN.
**How to avoid:** Either (a) fetch recipes BEFORE rendering badges (add to boot sequence), or (b) accept a brief `unknown` flash and stabilize as recipes load, or (c) include `recipe_model` in the `/api/tasks` response via a JOIN.
**Warning signs:** First paint shows grey recipe chips; they turn colored after a couple hundred ms.

---

## Code Examples

### Example 1 — Phase 9 GateBadge (composition precedent for RecipeBadge)

```tsx
// Source: src/components/panels/task-card/gate-badge.tsx (existing)
'use client'
import { useTranslations } from 'next-intl'

type TaskLike = { gate_required?: 0 | 1; gate_status?: string }

export function GateBadge({ task }: { task: TaskLike }) {
  const t = useTranslations('project.lifecycle')
  if (task.gate_required !== 1) return null
  if (task.gate_status === 'approved') {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20">
        {t('gate.statusApproved')}
      </span>
    )
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
      {t('gate.statusRequired')}
    </span>
  )
}
```

### Example 2 — Local-mode banner (sticky banner precedent for runner-status)

```tsx
// Source: src/components/layout/local-mode-banner.tsx:14-44 (existing)
if (!capabilitiesChecked || dashboardMode === 'full' || bannerDismissed) return null

return (
  <div className="mx-4 mt-3 mb-0 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-void-cyan/5 border border-void-cyan/15 text-sm">
    <span className="w-1.5 h-1.5 rounded-full bg-void-cyan shrink-0" />
    <p className="flex-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{t('noGatewayDetected')}</span>
      {t('runningInLocalMode')}
    </p>
  </div>
)
```

### Example 3 — Existing tab bar to extend (TaskDetailModal)

```tsx
// Source: src/components/panels/task-board-panel.tsx:1580-1600 (existing — extend)
<div className="flex gap-1.5 mb-4" role="tablist" aria-label={t('taskDetailTabs')}>
  {(['details', 'comments', 'quality'] as const).map(tab => (
    <button
      key={tab}
      type="button"
      role="tab"
      aria-selected={activeTab === tab}
      aria-controls={`tabpanel-${tab}`}
      onClick={() => setActiveTab(tab)}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        activeTab === tab ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
      }`}
    >
      {tab === 'details' ? t('tabDetails') : tab === 'comments' ? t('tabComments') : t('tabQualityReview')}
    </button>
  ))}
  {/* Phase 16 addition: conditional Progress tab when recipe_slug is set */}
  {task.recipe_slug && (
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === 'progress'}
      aria-controls="tabpanel-progress"
      onClick={() => setActiveTab('progress')}
      className={`... same class pattern`}
    >
      {t('tabProgress')}
    </button>
  )}
</div>
```

### Example 4 — MentionTextarea autocomplete pattern (reusable for recipe combobox)

```tsx
// Source: src/components/panels/task-board-panel.tsx:288-307 (existing) — keyboard pattern
onKeyDown={(e) => {
  if (!open || filtered.length === 0) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    setActiveIndex((prev) => (prev + 1) % filtered.length)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
    return
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    insertMention(filtered[activeIndex])
    return
  }
  if (e.key === 'Escape') {
    setOpen(false)
  }
}}
```

### Example 5 — Inline feedback / toast-equivalent

```tsx
// Source: src/components/panels/github-sync-panel.tsx:248-268 (existing)
const handleSyncProject = async (projectId: number) => {
  setSyncingProjectId(projectId)
  try {
    const res = await fetch('/api/github/sync', { method: 'POST', ... })
    const data = await res.json()
    if (res.ok) {
      showFeedback(true, data.message || 'Sync triggered')
      fetchSyncHistory()
    } else {
      showFeedback(false, data.error || t('syncFailed'))
    }
  } catch {
    showFeedback(false, t('networkError'))
  } finally {
    setSyncingProjectId(null)
  }
}
```

### Example 6 — `/api/tasks/:id/checkpoints` response shape (GET, from source)

```ts
// Source: src/app/api/tasks/[id]/checkpoints/route.ts:314-320 + src/lib/task-checkpoints.ts:47-129
// Response body
{
  checkpoints: Array<{
    id: number
    task_id: number
    attempt: number
    step: string            // min 1, max 200
    summary: string         // min 1, max 4000
    status: 'completed' | 'in_progress' | 'blocked'
    artifacts?: Array<
      | { kind: 'file', path: string, summary?: string }
      | { kind: 'url', url: string, summary?: string }
      | { kind: 'diff', path?: string, ref?: string, summary?: string }
      | { kind: 'test_result', path?: string, url?: string, summary?: string }
      | { kind: 'comment', summary: string }
      | { kind: 'other', path?: string, url?: string, ref?: string, summary?: string }
    >
    next_step?: string
    blocker_reason?: string   // non-empty when status==='blocked' (Zod refine)
    tokens_used?: number
    duration_ms?: number
    ts: string                // ISO-8601
  }>
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling `/api/tasks` for updates | SSE via `useServerEvents` + Zustand updates | Phase 3 (v1.0) | Real-time UI without REST polling |
| Bespoke tab components per panel | Reusable `role="tab"` pattern in TaskDetailModal | Phase 9 | Accessible, i18n-consistent |
| Tasks without runtime context | Phase 13 added 12 runtime fields on the task row | Phase 13 | Badge + form can reflect all runtime state |
| Runner visibility via `docker ps` | `runner_heartbeats` table + `task.container_started`/`exited` SSE | Phase 15-06 | UI can show runner status without shelling out |
| Recipe authoring via API only | Filesystem-first (`recipes/<slug>/`) + chokidar indexer | Phase 12 | Recipes panel is read-only by design (no create/edit UI) |

**Deprecated/outdated:**
- Do NOT add `recipe.*` read endpoints under `/api/runner/*` for UI use — those are runner-scoped. Use `/api/recipes*` (Phase 12).
- Do NOT try to wire the Progress tab to `task.runner_requested` events — those announce claim readiness, not checkpoint progress. Use `task.checkpoint_added`.

---

## Open Questions

1. **Should the Progress tab be visible on non-recipe tasks?**
   - What we know: RUI-03 describes "live checkpoint timeline" which only exists for recipe-tagged tasks.
   - What's unclear: Claude's discretion per CONTEXT.md. Hiding it on non-recipe tasks is cleaner; showing it with an empty state is more consistent.
   - Recommendation: Hide when `task.recipe_slug` is null (Pitfall 9). Document in plan.

2. **Where does the recipe's `model.primary` flow to the task card?**
   - What we know: `/api/tasks` returns `recipe_slug` but not `recipe_model`.
   - What's unclear: Boot-time fetch of all recipes into Zustand (one query, reused by Recipes panel) vs JOIN in `/api/tasks`.
   - Recommendation: Boot-fetch to Zustand; refreshed on `recipe.indexed`/`recipe.removed` SSE (Focus Area 1 Option B). Document in plan.

3. **Does the runner-status banner also need operator-scoped `tasks_waiting` filtering?**
   - What we know: The count is global-by-workspace in the recommended endpoint.
   - What's unclear: When a user is viewing a project-scoped task board, should "waiting" count reflect only that project's tasks?
   - Recommendation: Phase 16 banner is workspace-scoped (matches CONTEXT.md "task-board view" lock). Project-scoped counter is a deferred polish.

4. **Should `task.container_exited` (reason='blocked') trigger a Progress-tab scroll anchor?**
   - What we know: CONTEXT.md leaves scroll-anchoring to Claude's discretion.
   - What's unclear: UX expectation.
   - Recommendation: Smooth-scroll the new checkpoint into view UNLESS the user has manually scrolled up (detect via scrollTop at mount time). Document in plan.

5. **What's the fallback when `/api/runtime/runner-status` returns 500?**
   - What we know: Existing banners (local-mode-banner) render based on Zustand flags that never fail.
   - What's unclear: Degraded state messaging.
   - Recommendation: Treat 500 as "status unknown" — render neither online nor offline state; show an ambient `Runner status unavailable` hint. Document in plan.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.x (unit/component) + Playwright 1.51.x (e2e) |
| Config file | `vitest.config.ts` (jsdom env, 60% coverage threshold on `src/lib/**/*.ts`) |
| Quick run command | `pnpm test -- <path-filter>` (e.g. `pnpm test -- recipe-badge`) |
| Full suite command | `pnpm test --run` + `pnpm typecheck` |
| E2E command | `pnpm test:e2e` (Playwright — Phase 17 scope, optional in Phase 16) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RUI-01 | Recipe badge renders recipe name + tier color when `recipe_slug` set; null otherwise | unit (component) | `pnpm test -- recipe-badge` | Wave 0 (template: phase-badge.test.tsx) |
| RUI-02 | Runner banner flips state based on `/api/runtime/runner-status`; shows waiting count | unit (component) + route test | `pnpm test -- runner-status-banner runner-status-route` | Wave 0 |
| RUI-03 | Progress tab renders checkpoints from REST; appends on SSE `task.checkpoint_added` DOM relay | unit (component) | `pnpm test -- progress-tab` | Wave 0 |
| RUI-04 (combobox) | Recipe combobox filters via debounced fetch + keyboard-navigates + selects | unit (component) | `pnpm test -- recipe-combobox` | Wave 0 |
| RUI-04 (advanced) | Mounts editor add/remove rows; skills chip input commit/remove; payload shape matches POST schema | unit (component) | `pnpm test -- advanced-section mounts-editor skills-chip-input` | Wave 0 |
| RUI-05 | i18n keys present in all 10 locale files | build-time (jq diff) | `diff <(jq 'paths' messages/en.json \| sort) <(jq 'paths' messages/<locale>.json \| sort)` for each locale | Wave 0 gap (script) |
| RUI-06 | Recipes panel lists recipes from `/api/recipes`; Resync posts + updates + fires feedback | unit (component) | `pnpm test -- recipes-panel` | Wave 0 |

**Manual-only verification** (candidate for Phase 17 E2E):
- RUI-03 live SSE update under real server (Playwright spec from Phase 17 RTEST-04).
- RUI-02 banner state transitions under real heartbeat timing.
- Visual regression on dark/light theme for all new chips (human inspection).

### Sampling Rate

- **Per task commit:** `pnpm test -- <file-pattern>` (sub-1s for a single component test in jsdom).
- **Per wave merge:** `pnpm test --run` + `pnpm typecheck` (full suite — 45s on current repo).
- **Phase gate:** Full suite green + manual smoke of all six UI surfaces in dev server before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `src/lib/model-tier-colors.ts` (NEW — source for badge + panel)
- [ ] `src/lib/__tests__/model-tier-colors.test.ts` (modelToTier coverage)
- [ ] `src/store/index.ts` Task interface widening (RUI-01 prerequisite for every subsequent plan)
- [ ] `src/components/panels/task-board-panel.tsx` local Task interface widening (same)
- [ ] `src/lib/use-server-events.ts` dispatcher extension + minimal Zustand slice (RUI-02/RUI-03/RUI-06 prerequisite)
- [ ] `messages/{en,es,fr,de,ja,ko,pt,ru,zh,ar}.json` — atomic addition of ALL ~50 new keys with English fallbacks (RUI-05 baseline)
- [ ] `src/app/api/runtime/runner-status/route.ts` (NEW — viewer-auth endpoint) + `__tests__/route.test.ts` (RUI-02 prerequisite)
- [ ] Decide Task interface sourcing: both `src/store/index.ts` AND `src/components/panels/task-board-panel.tsx:23-58` define conflicting shapes — either unify (preferred) or maintain both (current pattern)
- [ ] Agree on recipes cache strategy: Zustand slice (recommended) vs per-component fetch

**Test infrastructure already exists; no framework install needed.**

---

## Plan Decomposition

Based on file-disjoint analysis, **six Wave-1 plans can run in parallel after Wave 0**:

**Wave 0 — Foundation (single plan, ~1 hour):**
- `model-tier-colors.ts` extraction + helper + unit tests
- `Task` interface widening (store + task-board)
- `use-server-events.ts` 6 new event cases + Zustand recipes/runner-status slices
- ALL i18n keys added atomically across 10 locales with English fallbacks
- `GET /api/runtime/runner-status` endpoint + route tests
- 10-locale diff assertion script (CI helper)

**Wave 1 — Six parallel plans (file-disjoint):**
1. **Recipe Badge (RUI-01)** — `task-card/recipe-badge.tsx` + test + 2 composition-site insertions in `task-board-panel.tsx` (lines 1062, 1501)
2. **Runner Status Banner (RUI-02)** — `runner-status-banner.tsx` + test + insertion point in `task-board-panel.tsx` (below panel header, above columns — line ~950)
3. **Progress Tab (RUI-03)** — `task-detail/progress-tab.tsx` + `task-detail/checkpoint-row.tsx` + tests + 2 surgical edits in `task-board-panel.tsx` TaskDetailModal (activeTab state + conditional tab button + new tabpanel container)
4. **Recipe Combobox + Advanced Section (RUI-04)** — `task-form/recipe-combobox.tsx`, `advanced-section.tsx`, `mounts-editor.tsx`, `skills-chip-input.tsx` + tests + edits to CreateTaskModal (line 2112) AND EditTaskModal (line 2400) in task-board-panel.tsx
5. **Recipes Panel (RUI-06)** — `recipes-panel.tsx` + test + nav-rail insertion (`src/components/layout/nav-rail.tsx`) + ContentRouter case (`src/app/[[...panel]]/page.tsx`)
6. **i18n Key Fills (RUI-05)** — Does NOT need a dedicated plan IF Wave 0 lands all keys; translation quality improvements can follow as a standalone chore plan or defer to a translation pass. In this model, RUI-05 closes at Wave 0.

**Parallelization check:** Wave 1 plans 1-4 all touch `task-board-panel.tsx` but at disjoint line ranges (1060 area, 950 area, 1289+1580+1864 areas, 2112+2400 areas). Executing them in parallel could collide at the import statement block (top of file) if they each add imports. **Recommendation: sequence plans 1-4 sequentially OR use a single "task-board-panel imports" import-reservation checklist in Wave 0** to prevent merge churn.

**Alternate decomposition (5 plans if imports collision dominates):**
- Plan 1: Recipe Badge + Progress Tab (both edit TaskDetailModal area)
- Plan 2: Runner Status Banner
- Plan 3: CreateTaskModal + EditTaskModal extensions (Recipe combobox + Advanced section)
- Plan 4: Recipes Panel + nav-rail
- Plan 5: Optional Playwright sanity E2E

---

## Sources

### Primary (HIGH confidence)

- `src/lib/event-bus.ts:15-61` — EventType union (10 new members since v1.0; 6 run-time-related)
- `src/lib/use-server-events.ts:95-192` — Client SSE dispatcher (missing 6 new event cases)
- `src/components/panels/task-card/phase-badge.tsx` + `gate-badge.tsx` — Badge composition precedent
- `src/components/panels/task-board-panel.tsx` — 2,611-line panel (all runtime UI host)
- `src/components/panels/agent-detail-tabs.tsx:807-810` — `MODEL_TIER_COLORS` source
- `src/app/api/tasks/[id]/checkpoints/route.ts` — Phase 15 checkpoint GET/POST
- `src/app/api/recipes/search/route.ts` — Phase 12 search endpoint
- `src/app/api/recipes/route.ts` + `resync/route.ts` — Phase 12 list + resync
- `src/app/api/runner/heartbeat/route.ts` + `inventory/route.ts` — Phase 15 heartbeat persistence (both runner-secret-only)
- `src/app/api/events/route.ts` — SSE stream + workspace filter
- `src/app/api/tasks/route.ts` — Task POST/GET (verified task row shape + v1.2 field plumbing)
- `src/components/layout/local-mode-banner.tsx` + `openclaw-update-banner.tsx` — Banner styling precedents
- `src/components/layout/nav-rail.tsx:27-83` — Nav group / item declaration pattern
- `src/app/[[...panel]]/page.tsx:485-585` — ContentRouter switch
- `src/components/panels/github-sync-panel.tsx:240-290` — Inline feedback ("toast") pattern
- `messages/en.json` — 2,412-line i18n template; namespaces `taskBoard.*`, `project.lifecycle.*`, `nav.*`, `projects.*`
- `.planning/phases/15-checkpoints-scheduler-v1-2/15-05-SUMMARY.md` + `15-06-SUMMARY.md` — LOCKED decisions for SSE emission, heartbeat metadata shape, 90s stale window
- `.planning/REQUIREMENTS.md` — RUI-01..06 authoritative definitions
- `.planning/STATE.md` — Phase 15 completion state; no outstanding runtime blockers
- `CLAUDE.md` — Stack + conventions + no-icon-library + i18n + no-Co-Authored-By

### Secondary (MEDIUM confidence)

- `src/components/panels/task-board-panel.tsx:199-339` — MentionTextarea (implementation verified; behavior pattern transferable to recipe combobox with debounce added)
- `src/app/api/status/route.ts` — Viewer-auth endpoint precedent (matches proposed `/api/runtime/runner-status` shape)

### Tertiary (LOW confidence)

- None. All assertions cross-referenced against exact repo paths.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — entire stack is the locked Mission Control tooling; no speculation.
- Architecture: HIGH — every pattern is already instantiated in the codebase and cited.
- Pitfalls: HIGH for 1-5 (confirmed via grep); MEDIUM for 6-10 (extrapolated from existing behavior, not yet observed under Phase 16 code).

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (30 days — MC repo is actively evolving; SSE dispatch contract and task row shape are both v1.2 products that could drift)

---

## RESEARCH COMPLETE
