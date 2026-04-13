# Pitfalls Research

**Domain:** Nested workspace views in a panel-based SPA (Next.js catch-all route with Zustand)
**Researched:** 2026-04-13
**Confidence:** HIGH (based on direct codebase analysis against known SPA workspace patterns)

## Critical Pitfalls

### Pitfall 1: URL/State Desynchronization in a Flat Panel Router

**What goes wrong:**
The existing routing model is flat: `pathname.slice(1)` becomes `activeTab`, and `ContentRouter` switches on that single string. A project workspace introduces hierarchy (`/projects/42/tasks`) but the catch-all route `[[...panel]]` currently extracts only the first segment. If the workspace uses URL segments for sub-views (e.g., `/projects/42/tasks`), the existing `panelFromUrl` logic (`pathname === '/' ? 'overview' : pathname.slice(1)`) will interpret the entire path as a single tab name like `"projects/42/tasks"`, which matches nothing in `ContentRouter` and falls through to the plugin panel fallback (rendering `<Dashboard />`).

**Why it happens:**
The catch-all route already captures multi-segment paths, but the URL-to-tab mapping assumes a single segment. Developers add the new workspace panel and test it with click-based navigation (which sets Zustand state directly), never testing direct URL entry or browser refresh. It works via clicks but breaks on reload.

**How to avoid:**
- Parse the `[[...panel]]` segments as an array, not a single string. The catch-all already provides `params.panel` as `string[]` but the current code uses `usePathname()` instead.
- Define a clear URL schema: `/projects/:id` for dashboard, `/projects/:id/:subview` for sub-views. Parse these into structured state (e.g., `{ panel: 'project-workspace', projectId: 42, subView: 'tasks' }`).
- Always test with direct URL entry, browser back/forward, and page refresh -- not just click navigation.

**Warning signs:**
- Browser refresh on a workspace sub-view shows the main dashboard instead of the workspace.
- Browser back button skips workspace sub-views or jumps to unexpected panels.
- `activeTab` in Zustand does not match the URL visible in the browser address bar.

**Phase to address:**
Phase 1 (foundation). This is the routing contract. Every subsequent feature depends on it.

---

### Pitfall 2: Zustand Store Bloat from Workspace-Scoped State

**What goes wrong:**
The monolithic Zustand store (1,192 lines, already flagged as tech debt) gets extended with project workspace state: current project ID, sub-view, project-scoped task filters, project activity feed, project settings form state, breadcrumb trail, etc. Each new slice interacts with existing slices (tasks, sessions, agents) via project filtering, creating implicit coupling. State updates in the workspace trigger re-renders across unrelated panels because no selector memoization exists.

**Why it happens:**
The store is the established pattern -- every feature adds its state there. Adding workspace state follows the path of least resistance. The coupling creeps in when workspace-scoped views need filtered subsets of existing data (e.g., tasks for project X), and developers add computed getters or filter logic directly in the store rather than in component selectors.

**How to avoid:**
- Do NOT add workspace navigation state (active project, sub-view) to the global Zustand store. Use URL segments as the source of truth for workspace context, parsed in a `useProjectWorkspace()` hook.
- For project-scoped data (filtered tasks, filtered sessions), use component-level selectors like `useMissionControl(state => state.tasks.filter(t => t.project_id === projectId))` rather than adding `projectTasks` as a store field.
- If new persistent state is needed (e.g., user's last-viewed project), use `localStorage` directly as the existing `activeProject` pattern already does.

**Warning signs:**
- Adding more than 2-3 new fields to `src/store/index.ts` for workspace features.
- Components outside the workspace re-rendering when workspace state changes.
- Circular logic where the store computes project-filtered data that components could compute themselves.

**Phase to address:**
Phase 1 (foundation). State architecture decisions in the first phase propagate to every sub-view built afterward.

---

### Pitfall 3: Workspace Panel Becomes Another 3,000-Line Monster Component

**What goes wrong:**
The project workspace panel starts as a reasonable component, then accumulates the dashboard view, task list, session list, agent list, settings form, breadcrumb bar, activity feed, and sub-view routing all in one file. Within two iterations it mirrors the pattern of `agent-detail-tabs.tsx` (2,951 lines) or `task-board-panel.tsx` (2,527 lines). The file becomes impossible to modify without risk.

**Why it happens:**
The codebase has an established anti-pattern of monolithic panels. Developers follow existing patterns. Sub-views that start as 50-line stubs grow as features are added. Extraction feels like a premature refactor until it is too late.

**How to avoid:**
- Enforce a strict file structure from day one: `src/components/project-workspace/` directory with separate files for each sub-view (`dashboard.tsx`, `task-list.tsx`, `session-list.tsx`, `agent-list.tsx`, `settings.tsx`).
- The workspace panel itself (`project-workspace-panel.tsx`) should be a thin router that renders the active sub-view component. Target: under 100 lines.
- Each sub-view component should own its own data fetching and not share fetch logic with siblings.

**Warning signs:**
- The workspace panel file exceeds 300 lines.
- More than one `fetch()` call in the workspace panel file itself (vs. in sub-view components).
- Conditional rendering blocks (`{subView === 'tasks' && <div>...200 lines of JSX...</div>}`) instead of component delegation.

**Phase to address:**
Phase 1 (foundation). The component directory structure must be established before any sub-view implementation begins.

---

### Pitfall 4: Breadcrumb Navigation Creates Parallel Navigation System

**What goes wrong:**
Breadcrumbs are implemented as a separate navigation mechanism that sets state independently from the existing `useNavigateToPanel()` hook. Users click a breadcrumb to go "back to projects list" but the panel router, URL, and Zustand `activeTab` get out of sync. Worse, breadcrumbs render globally but only make sense inside the workspace, leading to either conditional rendering bugs or breadcrumbs appearing on non-workspace panels.

**Why it happens:**
Breadcrumbs feel like a UI-only concern, so they are implemented as a visual component that calls `router.push()` directly. The existing `useNavigateToPanel` hook does not know about hierarchical navigation. Developers bypass the navigation abstraction.

**How to avoid:**
- Extend `useNavigateToPanel` (or create `useNavigateToWorkspace`) to handle hierarchical navigation: `navigateToPanel('projects', { projectId: 42, subView: 'tasks' })`.
- Breadcrumb data should be derived from the URL, not from separate state. A `useBreadcrumbs()` hook that parses the current pathname into breadcrumb segments ensures consistency.
- Breadcrumbs should render only inside the workspace layout, not in the global `HeaderBar`. The workspace panel owns its own header region.

**Warning signs:**
- Breadcrumb `onClick` handlers call `router.push()` directly instead of going through the navigation abstraction.
- Breadcrumb state is stored in Zustand as a separate `breadcrumbs: string[]` array.
- Breadcrumbs show stale project names after navigating away from the workspace.

**Phase to address:**
Phase 1 (foundation) for the navigation contract; Phase 2 (dashboard) for breadcrumb rendering.

---

### Pitfall 5: Project-Scoped Queries Without Database Indexes

**What goes wrong:**
Every workspace sub-view filters by `project_id`: tasks where `project_id = ?`, sessions joined to tasks where `project_id = ?`, agents assigned to project, activity feed filtered by project. Without composite indexes on the filtered columns, these queries scan full tables. With 10,000+ tasks across many projects, the workspace dashboard loads noticeably slowly.

**Why it happens:**
SQLite is fast enough during development with small datasets. Developers add `WHERE project_id = ?` to existing queries and it works. Nobody adds indexes because there is no performance test suite, and the existing migration system has no performance review step.

**How to avoid:**
- Add composite indexes in the first migration for this feature:
  - `CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status)`
  - `CREATE INDEX IF NOT EXISTS idx_tasks_project_updated ON tasks(project_id, updated_at)`
  - Index on any join table for project-agent assignments.
- Test with realistic data volumes (1,000+ tasks, 50+ projects) during development, not just 5 tasks in 2 projects.

**Warning signs:**
- Workspace dashboard takes >200ms for the API calls to return.
- `EXPLAIN QUERY PLAN` shows `SCAN TABLE` instead of `SEARCH TABLE ... USING INDEX`.
- Performance degrades linearly as total task count grows.

**Phase to address:**
Phase 1 (foundation) for the migration with indexes; validate in Phase 2 (dashboard) when aggregation queries land.

---

### Pitfall 6: SSE Event Flooding in Project-Scoped Views

**What goes wrong:**
The existing `useServerEvents()` hook receives ALL events from the `eventBus` -- every task update, agent heartbeat, session change across all projects. Inside a project workspace, the dashboard and activity feed re-render on every event, then filter client-side to show only the current project's events. With 20 active agents sending heartbeats every 30 seconds, the workspace receives 40 irrelevant events per minute that trigger Zustand updates and React re-renders for nothing.

**Why it happens:**
The SSE architecture is a single broadcast channel with no topic/filter support. Adding server-side filtering requires changes to the event bus and SSE route. Developers take the easier path of filtering on the client.

**How to avoid:**
- Do NOT add server-side SSE filtering in Phase 1 -- it is a larger change. Instead, ensure workspace components use `subscribeWithSelector` or `useSyncExternalStoreWithSelector` patterns to only re-render when their project's data actually changes.
- Use `React.memo` on sub-view components with project-scoped data. Memoize filtered lists with `useMemo` keyed on the project ID and the relevant data version.
- If SSE noise becomes measurable (profile with React DevTools), add optional `project_id` filtering to the SSE endpoint in a later phase.

**Warning signs:**
- React DevTools Profiler shows the workspace dashboard re-rendering on every SSE event.
- The activity feed flickers or scrolls unexpectedly when unrelated events arrive.
- CPU usage climbs with more active agents even when the viewed project is idle.

**Phase to address:**
Phase 2 (dashboard) for memoization; defer SSE filtering to a later optimization phase.

---

### Pitfall 7: i18n String Explosion Without Namespace Organization

**What goes wrong:**
The workspace adds 100+ new user-facing strings (dashboard labels, breadcrumb names, sub-view titles, empty states, settings labels, confirmation dialogs). Developers dump them all into the existing flat namespace in `messages/en.json`. The file becomes unmaintainable, translation keys collide or become ambiguous, and translators lack context.

**Why it happens:**
The existing i18n setup uses `useTranslations('page')`, `useTranslations('boot')`, etc. as flat namespaces. There is no established pattern for feature-scoped namespaces. Developers follow the existing pattern and add keys to `page` or create ad-hoc prefixes like `page.projectWorkspace.dashboard.title`.

**How to avoid:**
- Create a dedicated `projectWorkspace` namespace in the message files from the start: `messages/en.json` should have a `"projectWorkspace": { "dashboard": {...}, "tasks": {...}, "breadcrumbs": {...} }` structure.
- Use `useTranslations('projectWorkspace')` in all workspace components.
- Add all 10 language files in the same commit -- do not add English first and "translate later."

**Warning signs:**
- Workspace strings are scattered across `page`, `common`, and `dashboard` namespaces.
- Translation keys are ambiguous (e.g., `page.status` could be task status or project status).
- Non-English message files fall behind English because workspace strings were added piecemeal.

**Phase to address:**
Phase 1 (foundation). Establish the namespace before any UI strings are added.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Put all workspace state in global Zustand store | Works immediately, follows existing pattern | Re-render cascades, impossible to isolate workspace from main app | Never -- URL is the source of truth for workspace context |
| Single workspace panel file with inline sub-views | Faster initial development | Replicates the 3,000-line panel anti-pattern; extraction costs 2-3x the original effort | Never -- create component directory from day one |
| Skip database indexes for project queries | No migration needed | Workspace loads slowly at realistic data volumes; fixing requires migration + re-index | Never -- indexes are trivial to add and impossible to retrofit without downtime |
| Use `as any` for new project query results | Matches existing codebase pattern | No type safety for new code; bugs surface at runtime in project-scoped views | Only if typed interfaces are added within the same phase |
| Fetch all tasks then filter client-side by project | Avoids new API endpoints | Transfers entire task list to browser for every workspace load; breaks at 1,000+ tasks | Only during prototyping; replace with server-side filtering before merge |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Existing `useNavigateToPanel()` | Bypassing it for workspace navigation and calling `router.push()` directly | Extend the hook to accept hierarchical params; always navigate through the abstraction |
| `useServerEvents()` SSE hook | Assuming events are scoped to the current view; re-rendering on every event | Add project-aware selectors that compare `event.project_id` before updating component state |
| `fetchProjects()` in Zustand | Calling it on every workspace mount, duplicating fetches | Call once on boot (already happens); workspace reads from store, not redundant fetches |
| `activeProject` in localStorage | Storing full project object in localStorage; stale after project renames | Store only `project_id`; resolve current data from the store on mount |
| Plugin panel system | Registering workspace as a plugin panel | Workspace is a first-party panel in `ContentRouter`, not a plugin. Plugin panels are for extensions. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fetching unfiltered task list for project view | Dashboard load >1s, growing with total task count | Add `GET /api/projects/:id/tasks` with server-side `WHERE project_id = ?` | >500 total tasks |
| Re-rendering workspace on every SSE event | Jank, CPU spike during active agent periods | `useMemo` + `subscribeWithSelector` for project-scoped data | >5 concurrent active agents |
| Loading all sub-view data on workspace mount | Slow initial workspace load, wasted bandwidth | Lazy-load sub-view data only when that sub-view is active | >3 sub-views with non-trivial data |
| Inline activity feed without pagination | DOM grows unbounded, memory leak over long sessions | Paginate with "load more" or virtual scroll; cap initial load at 50 items | >200 activity items per project |
| Polling project stats on interval instead of SSE | Redundant API calls every 10s per open workspace | Derive stats from SSE-updated Zustand state; no additional polling needed | Any scale -- wastes requests immediately |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Not validating `project_id` ownership in workspace API routes | User can view/modify another workspace's projects by guessing IDs | Every project API route must verify `workspace_id` matches the authenticated user's workspace |
| Exposing project-scoped task data without re-checking auth | If task auth is checked at `/api/tasks` but workspace calls a different endpoint, auth gaps appear | Reuse `requireRole()` in every new workspace endpoint; do not assume callers are authenticated |
| Storing project ID in URL without validating access | Direct URL manipulation lets users probe for project IDs | Validate project belongs to user's workspace on every request, not just on initial navigation |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No loading state between workspace sub-views | User clicks "Tasks" tab, sees blank space, thinks it is broken | Show skeleton/spinner scoped to the sub-view content area; keep breadcrumbs and tabs visible |
| Workspace replaces the entire page with no quick escape | User feels trapped; cannot see main nav or quickly switch panels | Keep the nav rail visible (collapsed or overlay); breadcrumb "home" returns to main view instantly |
| Empty project workspace with no guidance | New project has no tasks, no sessions -- workspace feels broken | Show an onboarding state: "This project has no tasks yet. Create one?" with a direct action |
| Breadcrumbs truncate project name on mobile | User cannot identify which project they are in | Show full project name in the workspace header; breadcrumbs are secondary navigation, not the identity |
| Sub-view tabs look identical to main nav tabs | User confuses workspace tabs (Dashboard, Tasks, Sessions) with main nav items (which also have Tasks, Sessions) | Visually differentiate workspace tabs (horizontal tabs or segmented control) from the main nav rail (vertical icon rail) |

## "Looks Done But Isn't" Checklist

- [ ] **URL routing:** Direct URL entry to `/projects/42/tasks` renders the correct workspace sub-view, not the global tasks panel or a blank page.
- [ ] **Browser back/forward:** Navigating between sub-views creates history entries; back button returns to previous sub-view, not previous panel.
- [ ] **Page refresh:** Refreshing on any workspace sub-view restores the exact same view with correct project context.
- [ ] **Deep linking:** Sharing a workspace URL with another authenticated user shows them the same project and sub-view.
- [ ] **Empty states:** Every sub-view has an empty state (no tasks, no sessions, no agents assigned, no activity).
- [ ] **Error states:** Project not found (deleted/wrong ID) shows a meaningful error, not a blank workspace or crash.
- [ ] **i18n completeness:** All 10 language files have workspace strings, not just English.
- [ ] **Mobile responsiveness:** Workspace tabs, breadcrumbs, and dashboard all render usably on mobile viewports.
- [ ] **Keyboard navigation:** Tab key moves through workspace tabs and breadcrumbs logically.
- [ ] **Data freshness:** Workspace dashboard reflects task status changes within 2 seconds (via SSE), not requiring a page refresh.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| URL/state desync (Pitfall 1) | MEDIUM | Rewrite URL parsing to use `params.panel` array; add integration tests for direct URL entry. 1-2 day effort. |
| Store bloat (Pitfall 2) | HIGH | Extract workspace state from global store; refactor all workspace components to use URL-derived context. 3-5 day effort once coupled. |
| Monster component (Pitfall 3) | HIGH | Extract sub-views into separate files; rewire data fetching. 2-4 day effort; high regression risk without tests. |
| Parallel navigation (Pitfall 4) | MEDIUM | Consolidate breadcrumb navigation through the navigation hook. 1-2 day effort. |
| Missing indexes (Pitfall 5) | LOW | Add a migration with `CREATE INDEX IF NOT EXISTS`. Minutes to write, requires a restart to apply. |
| SSE flooding (Pitfall 6) | MEDIUM | Add memoization and selectors. 1 day effort; risk of subtle re-render bugs. |
| i18n chaos (Pitfall 7) | MEDIUM | Restructure message keys into namespace; update all component references. 1-2 day effort across 10 language files. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| URL/state desync | Phase 1 (routing foundation) | Direct URL entry test for every workspace route pattern |
| Store bloat | Phase 1 (state architecture) | Workspace adds zero new fields to global Zustand store; URL is source of truth |
| Monster component | Phase 1 (directory structure) | Workspace panel file is under 100 lines; sub-views are separate files |
| Parallel navigation | Phase 1 (navigation contract) | All workspace navigation goes through a single hook; no direct `router.push()` |
| Missing indexes | Phase 1 (database migration) | `EXPLAIN QUERY PLAN` for all project-scoped queries shows index usage |
| SSE flooding | Phase 2 (dashboard) | React DevTools Profiler shows no unnecessary re-renders on cross-project events |
| i18n namespace | Phase 1 (foundation) | All workspace strings live under `projectWorkspace` namespace in all 10 language files |

## Sources

- Direct codebase analysis: `src/app/[[...panel]]/page.tsx` (catch-all routing), `src/store/index.ts` (Zustand store), `src/lib/navigation.ts` (navigation hook)
- Existing tech debt documented in `.planning/codebase/CONCERNS.md` (monolithic panels, monolithic store, `as any` patterns)
- Existing project data model: `src/store/index.ts` (Project interface), `src/app/api/projects/` (API routes)
- SSE architecture: `src/lib/use-server-events.ts`, `src/lib/event-bus.ts`
- i18n setup: `messages/en.json`, `next-intl` configuration

---
*Pitfalls research for: Project workspace views in Mission Control SPA*
*Researched: 2026-04-13*
