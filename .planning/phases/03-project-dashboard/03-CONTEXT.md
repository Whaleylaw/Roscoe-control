# Phase 3: Project Dashboard - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning
**Source:** Auto-selected recommended defaults

<domain>
## Phase Boundary

Project dashboard view that tells the user exactly what is happening in their project — task status counts, progress, blocked items, project brief, recent activity, and health indicator. All data updates in real-time via SSE. This replaces the `DashboardView` stub created in Phase 1.

</domain>

<decisions>
## Implementation Decisions

### Dashboard Layout
- **D-01:** Responsive CSS grid layout. Top row: status overview cards (active, blocked, completed task counts). Middle row: progress bar + health indicator. Bottom section: project brief card and activity feed side by side (or stacked on narrow viewports).
- **D-02:** Dashboard component lives in `src/components/project/dashboard-view.tsx` (replacing the existing stub). It may extract sub-components to `src/components/project/dashboard/` if complexity warrants it (Claude's discretion).

### Status Overview Cards (DASH-01)
- **D-03:** Three count cards displaying task counts grouped by status: Active (in-progress + pending), Blocked, Completed. Each card shows the count number prominently with a label below.
- **D-04:** Data fetched from `GET /api/tasks?project_id={id}` — the API already supports `project_id` filtering. Group counts client-side from the task list, or use a dedicated summary endpoint if one exists.

### Progress Indicator (DASH-02)
- **D-05:** Horizontal progress bar showing completed tasks / total tasks ratio. Display percentage text (e.g., "75%") and absolute count (e.g., "6/8 tasks"). Bar uses Tailwind width utility (`style={{ width: '75%' }}`).
- **D-06:** Progress bar color: use existing theme colors. Green fill on neutral background.

### Project Brief (DASH-03)
- **D-07:** Read-only card displaying the project description. Render as markdown using the existing `react-markdown` + `remark-gfm` dependency already in the project. Title: "About" or i18n equivalent.
- **D-08:** If no description exists, show an empty state with a prompt to add one (link to Settings tab).

### Activity Feed (DASH-04)
- **D-09:** Chronological list of recent activity, most recent first. Show task status changes, task creation, and agent session activity. Each entry shows: description, timestamp (relative — "2 min ago"), and type indicator.
- **D-10:** Data fetched from `GET /api/activities` (activities API exists at `src/app/api/activities/route.ts`). Filter by project context. Limit to 20 most recent entries.
- **D-11:** If no activity exists yet, show an empty state message.

### Blocked/Attention Tasks (DASH-05)
- **D-12:** Within the status overview section, blocked tasks card is visually distinct — use a warning/amber background tint or border to draw attention. Clicking the blocked count navigates to the Tasks tab filtered to blocked items.
- **D-13:** If blocked count is 0, the card still shows "0 Blocked" but without the attention styling.

### Health Indicator (DASH-06)
- **D-14:** Text badge with emoji prefix: "On Track" (green), "At Risk" (yellow/amber), "Off Track" (red). No icon library — use text/emoji per CLAUDE.md.
- **D-15:** Health derived from blocked task ratio: 0 blocked = On Track, <25% blocked = At Risk, >=25% blocked = Off Track. This is a simple heuristic — can be refined later.
- **D-16:** Health indicator sits in the middle row next to the progress bar, visible without scrolling.

### Real-time Updates (DASH-07)
- **D-17:** Dashboard subscribes to SSE events via the existing `useServerEvents` pattern. When a task or session event fires that matches the current project, re-fetch dashboard data (task counts, activity feed).
- **D-18:** Use the existing Zustand store's `tasks` array (updated by SSE) to compute counts reactively. For activity feed, poll or re-fetch on relevant SSE event types (task-created, task-updated, session-started, session-ended).

### Data Fetching Strategy
- **D-19:** Dashboard data comes from two sources: (1) tasks from `GET /api/tasks?project_id={id}` for status counts, progress, blocked items, and health; (2) activities from `GET /api/activities` filtered by project for the activity feed.
- **D-20:** Use `useProjectWorkspace()` context to get the project ID for API calls. The context already provides `project` object with `id`, `slug`, `name`, `description`.

### Claude's Discretion
- Exact grid column/row configuration and breakpoints
- Whether to extract dashboard sub-components into a `dashboard/` subdirectory
- Loading skeleton design for dashboard sections
- Activity feed entry formatting and relative timestamp implementation
- Whether to add a new API endpoint for aggregated dashboard stats or compute client-side

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning
- `.planning/PROJECT.md` — Core value statement, constraints
- `.planning/REQUIREMENTS.md` — DASH-01 through DASH-07 requirements
- `.planning/ROADMAP.md` — Phase 3 goal, success criteria

### Phase 1 & 2 Foundation
- `.planning/phases/01-foundation/01-CONTEXT.md` — URL routing, context provider, i18n decisions
- `.planning/phases/02-navigation-workspace-shell/02-CONTEXT.md` — Workspace shell, breadcrumb, tabs, data fetching decisions
- `src/components/project/project-context.tsx` — React context with project data (id, slug, name, description)
- `src/components/project/dashboard-view.tsx` — Current stub to be replaced

### Data Sources
- `src/app/api/tasks/route.ts` — Tasks API with `project_id` query param support
- `src/app/api/activities/route.ts` — Activities API
- `src/lib/use-server-events.ts` — SSE hook for real-time updates
- `src/store/index.ts` — Zustand store with tasks array updated by SSE

### Existing Patterns
- `src/components/panels/token-dashboard-panel.tsx` — Example of a dashboard panel with charts (recharts)
- `src/components/panels/task-board-panel.tsx` — Task data fetching and rendering patterns

### Codebase Architecture
- `.planning/codebase/ARCHITECTURE.md` — Data flow, SSE patterns
- `.planning/codebase/CONVENTIONS.md` — Naming, component patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `react-markdown` + `remark-gfm` — already installed, used for markdown rendering in chat/comments; reuse for project brief
- `useServerEvents` hook — SSE real-time updates already dispatch to Zustand store
- `useMissionControl()` — Zustand store provides `tasks` array that's kept in sync via SSE
- `useProjectWorkspace()` — context provides `project` with `id`, `slug`, `name`, `description`, `status`
- `recharts` — already installed (LineChart, BarChart, PieChart) though may not be needed for simple progress bar

### Established Patterns
- Panels fetch data via `fetch('/api/...')` in `useEffect` + `useCallback`
- Components use `useTranslations('project')` for i18n
- Named exports, kebab-case files, `@/` imports
- No icon libraries — text/emoji only

### Integration Points
- `src/components/project/dashboard-view.tsx` — replace stub with full dashboard
- `src/app/api/tasks/route.ts` — already supports `?project_id=N` filtering
- `src/app/api/activities/route.ts` — activity data source
- SSE events — task-created, task-updated, session events trigger Zustand updates

</code_context>

<specifics>
## Specific Ideas

No specific requirements — auto-selected standard approaches based on existing patterns.

</specifics>

<deferred>
## Deferred Ideas

None — auto-mode stayed within phase scope.

</deferred>

---

*Phase: 03-project-dashboard*
*Context gathered: 2026-04-13 via auto-mode*
