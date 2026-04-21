# Phase 16: Runtime UI Surfaces — Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 16 ships the operator-facing UI for v1.2 runtime in Mission Control. It delivers five surfaces, all localized atomically across 10 locales (en/es/fr/de/ja/ko/pt/ru/zh/ar):

1. **Recipe badge** on task cards (RUI-01)
2. **Runner-status banner** on the task-board shell (RUI-02)
3. **Progress tab** on the task detail view with live checkpoint timeline (RUI-03)
4. **Recipe dropdown + Advanced section** on the task create/edit form (RUI-04)
5. **Recipes panel** reachable from main nav (RUI-06)

Plus **locale coverage** for every new string (RUI-05 — pattern-locked via next-intl JSON files, no design choices).

**Out of scope (deferred — see below):** recipe authoring in the UI, per-runner multi-runner UI, filter-by-recipe on Kanban, rich artifact previews, recipe analytics.

</domain>

<decisions>
## Implementation Decisions

### Recipe badge (RUI-01)
- **Style:** Chip/pill with recipe name as label, filled background using model-tier color (opus=purple, sonnet=blue, haiku=green tints).
- **Color source:** Reuse existing Mission Control palette from `MODEL_TIER_COLORS` (see `src/components/panels/agent-detail-tabs.tsx:808-810`) — single source of truth, consistent with agent builder.
- **Placement:** Top-right of the task card, joining the existing badge row that holds `phase-badge.tsx` and `gate-badge.tsx` (in `src/components/panels/task-card/`). No layout shift.
- **Long-name handling:** Truncate with ellipsis + full name in the native `title` attribute / tooltip on hover. Standard Mission Control pattern.
- **No-recipe cards:** No badge rendered — cards without `recipe_slug` look identical to today (roadmap SC 1).

### Runner-status banner (RUI-02)
- **Placement:** Sticky bar inside `task-board-panel.tsx`, between the panel header and the Kanban columns. Scoped to the task-board view only (does not appear on other panels).
- **Copy (localized):**
  - Online: `🟢 Runner online`
  - Offline: `🔴 Runner offline — tasks waiting: N` (where N is the count of tasks with `recipe_slug` in `assigned`/`inbox` awaiting a runner)
- **Click behavior:** Informational only — no click action, no popover, no filter. Keeps the surface tight.
- **Multi-runner handling:** Treat as single-runner for Phase 16. "Online" = ANY runner heartbeat is fresh. Multi-runner UI is deferred.
- **Live updates:** Driven by existing SSE heartbeat events from Phase 15 (`runner.heartbeat`, `runner.offline`-equivalent via heartbeat staleness).

### Progress tab on task detail (RUI-03)
- **Format:** Vertical timeline with a connector line and a colored status dot per checkpoint (completed=green, in_progress=blue w/ pulse, blocked=red).
- **Grouping:** Collapsible sections per attempt. Latest attempt open by default, older attempts collapsed with a checkpoint-count summary. Backed by `GET /api/tasks/:id/checkpoints?attempt=N`.
- **Sort within each attempt:** Newest-first, so live SSE updates land at the visible edge.
- **Artifact rendering:** Lightweight — each artifact = kind-glyph + name, clickable where applicable. Kind glyphs: 📄 file, 🔗 url, 📝 diff, ✅ test_result, 💬 comment, ✨ other. No inline preview (deferred).
- **Blocker styling:** Red border on the checkpoint row, `blocker_reason` shown inline prominently (not hidden behind a click).
- **Running styling:** Pulsing blue dot on the current `in_progress` checkpoint.
- **Live updates:** Subscribe to `task.checkpoint_added` SSE events scoped to the task id; new rows append without a page reload (roadmap SC 3).

### Task form — Recipe dropdown (RUI-04)
- **Dropdown UX:** Command-palette-style combobox. Type to filter via `/api/recipes/search`. Keyboard-nav (↑/↓/Enter). Each result row shows recipe name + model-tier chip + short description. Clear button to deselect (no recipe = legacy task behavior).
- **Validation:** Inline (zod) — invalid `recipe_slug` rejected at submit.

### Task form — Advanced section (RUI-04)
- **Default state:** Collapsed. Expands on click. Session-local open state (not persisted across reloads/accounts).
- **Fields exposed (three, from the v1.2 task schema):**
  - `read_only_mounts`: **repeatable text-input rows** with ➕ add and ✖ remove per row. One path per row.
  - `extra_skills`: **chip input** — type a skill name + Enter to commit as a chip; ✖ on the chip to remove. Free-text, no backend allowlist (authoring stays filesystem-first).
  - `model_override`: **plain text input** (e.g., `anthropic/claude-sonnet-4-20250514`).
- **Validation:** Inline (zod) on submit. No backend path autocomplete — deferred.

### Recipes panel (RUI-06)
- **Nav entry:** Reachable from main nav rail (`src/components/layout/nav-rail.tsx`). Panel slug decided by Claude; follows existing panel-naming conventions.
- **Layout:** Vertical list (not grid). One row per indexed recipe showing:
  - Recipe name
  - One-line description
  - Model chip (reuses MODEL_TIER_COLORS)
  - Tag chips
  - Row action: "View" link (shows YAML read-only detail — implementation detail for planner)
- **Resync button:** Lives in the panel header. Shows spinner while syncing. Emits a toast on success/error with counts (e.g., `Indexed 12 recipes (3 new, 1 removed)`).
- **Authoring:** Filesystem-first — no create/edit/delete UI in Phase 16 (roadmap SC 5).

### Localization (RUI-05)
- Every new user-facing string goes through `next-intl` and lands atomically across all 10 locale JSON files in `messages/` (en/es/fr/de/ja/ko/pt/ru/zh/ar).
- Shipping a PR with missing locales is a blocker — pattern already enforced by existing i18n infrastructure.

### Claude's Discretion
The following are not explicit user decisions — planner/implementer should choose the best fit consistent with Mission Control conventions:
- Exact component names, file paths, and test scaffolding
- Dark/light theme variant tuning for the new chips/dots/banner
- Heartbeat-freshness threshold for "runner online" (default to existing scheduler config; no new tunable needed)
- Banner state transition animation (subtle or none)
- Dismissibility of the banner when online (suggestion: non-dismissible, auto-collapses to a thin strip when online)
- Empty-state copy before first checkpoint on the Progress tab
- Tokens/duration display format inside a checkpoint row
- Scroll-anchoring behavior on SSE arrival in the Progress tab
- Combobox keyboard shortcuts beyond ↑/↓/Enter
- Mobile/compact layout variants (follow existing responsive patterns)
- ARIA/a11y labels and focus management across all surfaces — must meet existing Mission Control a11y bar
- Toast component reuse (pick the existing one; do not introduce a new toast system)
- Panel slug for the Recipes panel

</decisions>

<specifics>
## Specific Ideas

- **Model-tier color source is locked:** the map in `src/components/panels/agent-detail-tabs.tsx:808-810` (`MODEL_TIER_COLORS`) is the one source of truth. If the recipe indexer maps recipe `model` → tier, that mapping belongs in a shared util so both the badge and the Recipes panel chip use the same logic.
- **Badge row location:** `src/components/panels/task-card/` already contains `gate-badge.tsx` and `phase-badge.tsx`. The new `recipe-badge.tsx` lives in the same directory and composes into the existing badge row.
- **Existing banner reference:** `src/components/layout/local-mode-banner.tsx` and `openclaw-update-banner.tsx` are the visual reference for the runner-status banner styling (same border treatment, emoji-led copy).
- **Banner scope:** this banner lives INSIDE `task-board-panel.tsx`, not in `header-bar.tsx`. Keep ambient UI scoped to where it's relevant.
- **Progress tab endpoint:** `GET /api/tasks/:id/checkpoints?attempt=N` is already shipped (Phase 15). The UI is a consumer, not a producer.
- **SSE event names locked (from Phase 15):** `task.checkpoint_added`, runner heartbeat events. Do not invent new events in this phase.
- **Artifact kinds are a closed set of 6:** `file | url | diff | test_result | comment | other`. The glyph map above is the full map.
- **Autocomplete endpoint:** `/api/recipes/search` is the autocomplete source (from Phase 12). UI consumes it — no new backend route for autocomplete.
- **No-icon-library rule (CLAUDE.md):** all glyphs use raw text/emoji. No new icon imports.

</specifics>

<deferred>
## Deferred Ideas

These came up during discussion but belong to later phases — capture, don't act on:

- **Filter-by-recipe on Kanban** — clicking a recipe badge or the runner banner to filter the board to tasks with that recipe / waiting tasks. New capability; future phase.
- **Rich artifact previews** — inline diff rendering, test-result summaries, URL link-previews on the Progress tab. Deferred to a future "Rich Progress" phase.
- **Recipe authoring UI** — create/edit/delete recipes from the Recipes panel. v1.2 explicitly keeps authoring filesystem-first; a UI authoring phase is post-v1.2.
- **Multi-runner UI** — per-runner chips in the banner, per-runner status dashboards. Requires backend multi-runner model; deferred.
- **Recipe analytics** — per-recipe success rate, average tokens, average duration, leaderboard. Future phase.
- **Recipe detail view beyond YAML** — rendered docs, usage stats, change history. Future phase.
- **Mobile-first redesign of the task-board shell** — the runner banner and recipe badge must work at narrow widths (Claude's discretion), but a broader mobile rework is out of scope.
- **Toast system overhaul** — reuse the existing toast; if no toast component exists, use the closest existing feedback mechanism; don't introduce a new one in this phase.
- **Banner-freshness threshold as a user-configurable setting** — for Phase 16, use existing scheduler config; exposing a UI knob is a future enhancement.
- **Persisted "Advanced section open" preference** — Phase 16 keeps it session-local. Persisting across sessions is a future polish.

</deferred>

---

*Phase: 16-runtime-ui-surfaces*
*Context gathered: 2026-04-20*
