# Stack Research

**Domain:** Project workspace/dashboard in existing Next.js agent orchestration SPA
**Researched:** 2026-04-13
**Confidence:** HIGH

## Context

This is NOT a greenfield stack decision. Mission Control already runs Next.js 16.1, React 19, TypeScript 5.7, Zustand 5, Tailwind 3.4, SQLite via better-sqlite3, and recharts 3.7. The project workspace feature must integrate within these constraints. This research covers what existing stack features to leverage, what patterns to adopt, and the few targeted additions needed.

## Recommended Stack

### Core Technologies (Already In Place -- No Changes)

| Technology | Version | Purpose | Why It Stays |
|------------|---------|---------|--------------|
| Next.js | 16.1.x | App Router, catch-all route | Workspace routes via existing `[[...panel]]` catch-all; no new routing needed |
| React 19 | 19.0.x | UI rendering | `useTransition` for smooth tab switches within workspace; `use()` for data promises |
| TypeScript | 5.7.x | Type safety | Discriminated unions for workspace sub-view state |
| Zustand | 5.0.x | Client state | Extend existing store with workspace slice; `subscribeWithSelector` already enabled |
| Tailwind CSS | 3.4.x | Styling | Grid layouts for dashboard widgets; existing utility patterns |
| better-sqlite3 | 12.6.x | Database | Aggregation queries for dashboard stats; existing prepared statement pattern |
| recharts | 3.7.x | Charts | Already used in cost-tracker; reuse for project progress/burndown charts |
| next-intl | 4.8.x | i18n | All new workspace strings go through message files |

### Supporting Libraries (Already In Place -- Reuse)

| Library | Version | Purpose | How to Reuse |
|---------|---------|---------|--------------|
| zod | 4.3.x | Validation | Schema for project settings, workspace config |
| class-variance-authority | 0.7.x | Component variants | Tab/breadcrumb active state variants |
| tailwind-merge + clsx | 3.4.x / 2.1.x | Class composition | Conditional styling on workspace views |
| react-markdown | 10.x | Markdown rendering | Project brief/description display |
| pino | 10.3.x | Logging | Structured logs for new API endpoints |

### New Dependencies: NONE

No new packages needed. The existing stack covers every requirement:

- **Dashboard layout**: Existing `WidgetGrid` pattern with CSS grid (12-column, `xl:col-span-*`) -- reuse for project dashboard
- **Tabs/navigation**: Build with existing `Button` + `clsx` + Zustand state -- no tab library needed
- **Breadcrumbs**: 20 lines of JSX with Tailwind, no library needed
- **Activity feed**: SSE via existing `useServerEvents` + `eventBus` -- filter by `project_id`
- **Data aggregation**: SQLite `COUNT`/`GROUP BY` queries in API routes
- **Charts**: recharts 3.7 already installed

### Development Tools (No Changes)

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest 2.1.x | Unit tests | Test workspace store slice, aggregation utilities |
| Playwright 1.51.x | E2E tests | Test workspace navigation, breadcrumb flow |
| Turbopack | Dev server | Already configured in next.config.js |

## Architecture Patterns to Use

### 1. Workspace as a Panel with Internal Router

The existing `ContentRouter` maps `activeTab` to panel components. The project workspace should be a single panel entry (`project-workspace`) that contains its own internal sub-view switcher.

```typescript
// In ContentRouter switch:
case 'project-workspace':
  return <ProjectWorkspace />

// ProjectWorkspace has its own internal tabs:
function ProjectWorkspace() {
  const { activeProjectView } = useMissionControl()
  switch (activeProjectView) {
    case 'dashboard': return <ProjectDashboard />
    case 'tasks': return <ProjectTasks />
    case 'sessions': return <ProjectSessions />
    case 'agents': return <ProjectAgents />
    case 'settings': return <ProjectSettings />
  }
}
```

**Why**: Matches the existing pattern. The catch-all route stays clean. Sub-view state lives in Zustand like everything else.

### 2. Zustand Store Extension (Slice Pattern)

Add workspace state to the existing single store. Do NOT create a second store.

```typescript
// Additions to src/store/index.ts
activeProjectView: 'dashboard' | 'tasks' | 'sessions' | 'agents' | 'settings'
setActiveProjectView: (view: string) => void
projectDashboardData: ProjectDashboardData | null
setProjectDashboardData: (data: ProjectDashboardData | null) => void
```

**Why**: The app already has a single-store pattern with `useMissionControl()`. A second store creates subscription confusion and breaks the established `useServerEvents` dispatch pattern.

### 3. URL Encoding for Project Context

Extend the `panelHref` function to support project workspace URLs: `/project/<slug>` or `/project/<slug>/tasks`.

```typescript
// navigation.ts extension
export function projectHref(slug: string, view?: string): string {
  return view ? `/project/${slug}/${view}` : `/project/${slug}`
}
```

The catch-all `[[...panel]]` already captures multi-segment paths. Parse `params.panel` as `['project', slug, view?]` in the page component.

**Why**: Deep-linkable project views. Users can bookmark `/project/my-app/tasks`. Browser back/forward works naturally.

### 4. Server-Side Aggregation for Dashboard Data

Dashboard stats (task counts by status, recent activity, progress) should be computed server-side via a single API endpoint, not stitched client-side from multiple fetches.

```sql
-- Single query: task summary for a project
SELECT status, COUNT(*) as count
FROM tasks
WHERE project_id = ? AND workspace_id = ?
GROUP BY status
```

Expose as `GET /api/projects/[id]/dashboard` returning pre-aggregated data.

**Why**: SQLite is fast for aggregations. One round-trip beats 4-5 separate fetches. The existing `useSmartPoll` hook handles refresh.

### 5. Scoped SSE Filtering

The existing `eventBus` emits events with resource data. Client-side filtering by `project_id` is sufficient -- no server-side SSE filtering needed.

```typescript
// In useServerEvents handler, when inside project workspace:
if (event.type === 'task-updated' && event.data.project_id === activeProject.id) {
  // Update project dashboard data
}
```

**Why**: The SSE stream is already a single channel. Adding server-side topic filtering adds complexity for marginal gain at this scale.

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Zustand single store extension | Separate Zustand store for workspace | Breaks `useMissionControl()` pattern; complicates SSE dispatch |
| CSS Grid dashboard (existing pattern) | react-grid-layout for drag-drop | Over-engineered for a project dashboard; adds 40KB; existing widget grid works |
| Internal tab switcher in Zustand | React Router nested routes | App uses catch-all route + Zustand, not React Router; introducing it creates two routing systems |
| Single `/api/projects/[id]/dashboard` endpoint | Multiple fetches composed client-side | More round-trips, loading state complexity, waterfall risk |
| Tailwind-built breadcrumbs | @radix-ui/react-breadcrumb or aria-breadcrumb library | Breadcrumbs are ~20 lines of accessible JSX with `nav[aria-label]` + `ol` + Tailwind |
| recharts 3.7 (already installed) | Victory, Nivo, Chart.js | Already in the bundle; team knows the API; no justification to switch for project charts |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| react-grid-layout | Adds drag-and-drop complexity for a fixed dashboard layout; 40KB bundle cost | CSS Grid with Tailwind (`grid-cols-12`) -- already proven in `widget-grid.tsx` |
| TanStack Query (React Query) | App uses Zustand + fetch + `useSmartPoll`; adding React Query creates two caching layers with conflicting invalidation | Existing `useSmartPoll` + SSE pattern |
| Separate micro-frontend / module federation | Massive over-engineering for internal workspace views | Simple component composition within existing panel system |
| Headless UI tab components (@headlessui, @radix-ui/react-tabs) | Extra dependency for what amounts to a button group + conditional render | Zustand state + `Button` variants with `aria-selected` |
| react-beautiful-dnd / @dnd-kit | No drag-and-drop requirement in project workspace; task board already has its own DnD if needed | Standard list/grid views |
| New icon library (lucide, heroicons) | Violates project convention: "No icon libraries -- use raw text/emoji" | Text/emoji as per CLAUDE.md |

## Stack Patterns by Variant

**If project dashboard needs drag-to-reorder widgets later:**
- Use the existing `WidgetGrid` customization pattern (user picks layout, stored in localStorage/settings)
- The current approach uses `dashboardLayout` in Zustand with a layout array -- extend, don't replace

**If project workspace needs offline support later:**
- Zustand already persists `activeProject` to localStorage
- Extend with `zustand/middleware/persist` for project dashboard data cache
- SQLite queries already work synchronously server-side, so this is purely a client caching concern

**If cross-project views are needed later:**
- The existing global `tasks`, `agents`, `sessions` arrays in Zustand remain the source for cross-project views
- Project workspace filters these; it does not replace them

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Next.js 16.1.x | React 19.0.x | Bundled together; no compatibility risk |
| Zustand 5.0.x | React 19.0.x | Zustand 5 is React 19 compatible; uses `useSyncExternalStore` |
| recharts 3.7.x | React 19.0.x | Recharts 3.x targets React 18+; works with 19 |
| next-intl 4.8.x | Next.js 16.x | Version 4.x specifically supports App Router in Next 15+/16 |
| better-sqlite3 12.6.x | Node.js 22.x | Native addon; already building successfully per existing CI |

## Database Schema Additions

The existing `projects` table already has: `id`, `workspace_id`, `name`, `slug`, `description`, `ticket_prefix`, `ticket_counter`, `status`, `github_repo`, `deadline`, `color`, `metadata`, `created_at`, `updated_at`.

**Needed additions for dashboard:**
- `brief` TEXT column (or reuse `description` + `metadata` JSON) -- project goals/brief content
- No new tables needed; all dashboard data derives from existing `tasks`, `sessions`, `project_agent_assignments` tables via aggregation queries

**New API endpoint:**
- `GET /api/projects/[id]/dashboard` -- returns aggregated stats, recent activity, progress metrics in one payload

## Sources

- Codebase analysis: `src/store/index.ts`, `src/app/[[...panel]]/page.tsx`, `src/components/dashboard/widget-grid.tsx`, `src/lib/migrations.ts` -- PRIMARY source, HIGH confidence
- Existing patterns: `src/lib/navigation.ts`, `src/lib/use-server-events.ts` -- verified in codebase
- Project constraints: `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md` -- project-defined requirements

---
*Stack research for: Project Workspace & Dashboard*
*Researched: 2026-04-13*
