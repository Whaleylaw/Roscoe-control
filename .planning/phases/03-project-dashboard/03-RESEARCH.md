# Phase 3: Project Dashboard - Research

**Researched:** 2026-04-13
**Domain:** React dashboard component, real-time SSE updates, Zustand state derivation
**Confidence:** HIGH

## Summary

Phase 3 replaces the `DashboardView` stub in `src/components/project/dashboard-view.tsx` with a full project dashboard showing task status counts, progress bar, project brief, activity feed, blocked task highlighting, and health indicator. All data updates live via SSE.

The implementation is straightforward because the foundation is solid: tasks API already supports `project_id` filtering, the Zustand store holds tasks updated via SSE, `useProjectWorkspace()` provides the project context, and `MarkdownRenderer` already exists for rendering the project brief. The primary gap is that the activities API has **no project_id filter** -- activities will need to be filtered by cross-referencing task entity_ids against project tasks.

**Primary recommendation:** Build the dashboard as a single component with extracted sub-components, deriving all task metrics from the Zustand store's `tasks` array (filtered by `project_id`) for instant reactivity, and fetching activities separately from the API with client-side project filtering.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Responsive CSS grid layout. Top row: status overview cards (active, blocked, completed task counts). Middle row: progress bar + health indicator. Bottom section: project brief card and activity feed side by side (or stacked on narrow viewports).
- **D-02:** Dashboard component lives in `src/components/project/dashboard-view.tsx` (replacing the existing stub). It may extract sub-components to `src/components/project/dashboard/` if complexity warrants it.
- **D-03:** Three count cards displaying task counts grouped by status: Active (in-progress + pending), Blocked, Completed. Each card shows the count number prominently with a label below.
- **D-04:** Data fetched from `GET /api/tasks?project_id={id}` -- the API already supports `project_id` filtering. Group counts client-side from the task list, or use a dedicated summary endpoint if one exists.
- **D-05:** Horizontal progress bar showing completed tasks / total tasks ratio. Display percentage text (e.g., "75%") and absolute count (e.g., "6/8 tasks"). Bar uses Tailwind width utility (`style={{ width: '75%' }}`).
- **D-06:** Progress bar color: use existing theme colors. Green fill on neutral background.
- **D-07:** Read-only card displaying the project description. Render as markdown using the existing `react-markdown` + `remark-gfm` dependency. Title: "About" or i18n equivalent.
- **D-08:** If no description exists, show an empty state with a prompt to add one (link to Settings tab).
- **D-09:** Chronological list of recent activity, most recent first. Show task status changes, task creation, and agent session activity. Each entry shows: description, timestamp (relative), and type indicator.
- **D-10:** Data fetched from `GET /api/activities`. Filter by project context. Limit to 20 most recent entries.
- **D-11:** If no activity exists yet, show an empty state message.
- **D-12:** Within the status overview section, blocked tasks card is visually distinct -- use a warning/amber background tint or border to draw attention. Clicking the blocked count navigates to the Tasks tab filtered to blocked items.
- **D-13:** If blocked count is 0, the card still shows "0 Blocked" but without the attention styling.
- **D-14:** Text badge with emoji prefix: "On Track" (green), "At Risk" (yellow/amber), "Off Track" (red). No icon library.
- **D-15:** Health derived from blocked task ratio: 0 blocked = On Track, <25% blocked = At Risk, >=25% blocked = Off Track.
- **D-16:** Health indicator sits in the middle row next to the progress bar, visible without scrolling.
- **D-17:** Dashboard subscribes to SSE events via existing `useServerEvents` pattern. When a task or session event fires, re-fetch dashboard data.
- **D-18:** Use the existing Zustand store's `tasks` array (updated by SSE) to compute counts reactively. For activity feed, re-fetch on relevant SSE event types.
- **D-19:** Dashboard data comes from two sources: (1) tasks from `GET /api/tasks?project_id={id}`; (2) activities from `GET /api/activities` filtered by project.
- **D-20:** Use `useProjectWorkspace()` context to get the project ID for API calls.

### Claude's Discretion
- Exact grid column/row configuration and breakpoints
- Whether to extract dashboard sub-components into a `dashboard/` subdirectory
- Loading skeleton design for dashboard sections
- Activity feed entry formatting and relative timestamp implementation
- Whether to add a new API endpoint for aggregated dashboard stats or compute client-side

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-01 | Status overview with task counts by status (active, blocked, completed) | Tasks API supports `project_id` filter; Zustand store holds tasks updated by SSE; Task.status has 9 values that map to 3 groups |
| DASH-02 | Progress indicator (completion percentage + progress bar) | Derived from task counts: `done` status = completed; simple ratio calculation; Tailwind inline width styling |
| DASH-03 | Project brief (description, goals, key info) | `useProjectWorkspace()` provides `project.description`; `MarkdownRenderer` component exists at `src/components/markdown-renderer.tsx` |
| DASH-04 | Activity feed with recent task updates and agent activity | Activities API at `/api/activities` with entity details; no native project_id filter -- needs cross-referencing (see pitfall) |
| DASH-05 | Blocked/needs-attention tasks prominently displayed | Task status `'review'` or custom blocked detection; amber styling via Tailwind; click navigates to Tasks tab |
| DASH-06 | Health indicator (on track / at risk / off track) | Pure computation from blocked ratio; text badge with emoji per CLAUDE.md icon constraint |
| DASH-07 | Real-time updates via SSE | SSE already dispatches `task.created`, `task.updated`, `task.status_changed`, `task.deleted`, `activity.created` to Zustand; dashboard derives from store reactively |
</phase_requirements>

## Architecture Patterns

### Recommended Component Structure
```
src/components/project/
  dashboard-view.tsx          # Main dashboard (replaces stub)
  dashboard/                  # Sub-components (Claude's discretion)
    status-cards.tsx          # DASH-01: Active/Blocked/Completed counts
    progress-bar.tsx          # DASH-02: Progress bar + percentage
    health-badge.tsx          # DASH-06: On Track / At Risk / Off Track
    project-brief.tsx         # DASH-03: Markdown description card
    activity-feed.tsx         # DASH-04: Recent activity list
```

### Pattern 1: Reactive Zustand Derivation for Task Metrics
**What:** Compute task counts, progress, and health from the Zustand store's `tasks` array rather than a separate API call, since SSE keeps it up to date.
**When to use:** For DASH-01, DASH-02, DASH-05, DASH-06 -- all task-derived metrics.
**Example:**
```typescript
// Source: existing codebase pattern (src/store/index.ts)
const { tasks } = useMissionControl()
const { project } = useProjectWorkspace()

const projectTasks = useMemo(() =>
  tasks.filter(t => t.project_id === project?.id),
  [tasks, project?.id]
)

const counts = useMemo(() => {
  const active = projectTasks.filter(t =>
    ['in_progress', 'assigned', 'inbox', 'backlog', 'awaiting_owner', 'review', 'quality_review'].includes(t.status)
  ).length
  const blocked = projectTasks.filter(t => t.status === 'failed').length
  const completed = projectTasks.filter(t => t.status === 'done').length
  return { active, blocked, completed, total: projectTasks.length }
}, [projectTasks])
```

### Pattern 2: Activity Feed with API Fetch + SSE Refresh
**What:** Fetch activities from the API on mount, then re-fetch when SSE delivers activity or task events.
**When to use:** For DASH-04 -- the activity feed.
**Example:**
```typescript
// Source: existing pattern (src/components/panels/task-board-panel.tsx)
const [activities, setActivities] = useState<Activity[]>([])

const fetchActivities = useCallback(async () => {
  if (!project?.id) return
  const res = await fetch(`/api/activities?entity_type=task&limit=20`)
  const data = await res.json()
  // Filter to project tasks client-side
  const projectTaskIds = new Set(projectTasks.map(t => t.id))
  const filtered = data.activities?.filter((a: Activity) =>
    a.entity_type === 'task' && projectTaskIds.has(a.entity_id)
  ) || []
  setActivities(filtered)
}, [project?.id, projectTasks])
```

### Pattern 3: Relative Timestamps
**What:** Display timestamps as "2 min ago", "1 hour ago" etc.
**When to use:** For activity feed entries (DASH-04).
**Example:**
```typescript
function relativeTime(unixTs: number): string {
  const seconds = Math.floor(Date.now() / 1000) - unixTs
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
```

### Anti-Patterns to Avoid
- **Polling for task data:** The Zustand store already gets SSE updates for tasks -- do not add a polling interval for task counts.
- **Direct SSE subscription in dashboard:** The `useServerEvents` hook already dispatches to the store globally. Dashboard should read from the store, not create its own SSE connection.
- **Fetching tasks separately when store has them:** The global boot sequence loads all tasks into the store. Filter from the store rather than making a separate API call for task metrics.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom markdown parser | `MarkdownRenderer` from `src/components/markdown-renderer.tsx` | Already styled for this app's dark theme, supports GFM |
| Relative timestamps | External library (date-fns, moment) | Simple utility function (see Pattern 3) | Only need basic relative time; no need for a dependency |
| Real-time updates | Custom EventSource connection | Zustand store + existing `useServerEvents` global hook | SSE is already connected globally and dispatches to store |

## Common Pitfalls

### Pitfall 1: Activities API Has No project_id Filter
**What goes wrong:** The `/api/activities` endpoint has no `project_id` query parameter. The `activities` table schema has no `project_id` column. Attempting `?project_id=N` will be silently ignored.
**Why it happens:** Activities are entity-scoped (entity_type + entity_id), not project-scoped.
**How to avoid:** Two options: (A) Fetch activities with `entity_type=task`, then filter client-side by checking if `entity_id` is in the set of project task IDs. (B) Add a server-side join to the activities API. Option A is simpler for 20 items; Option B is better long-term.
**Recommendation:** Use option A (client-side filtering) for this phase. Fetch recent task activities, cross-reference with project tasks. This avoids an API schema change.

### Pitfall 2: Task Status Mapping to "Active" / "Blocked" / "Completed"
**What goes wrong:** Task.status has 9 possible values: `backlog`, `inbox`, `assigned`, `awaiting_owner`, `in_progress`, `review`, `quality_review`, `done`, `failed`. The CONTEXT.md says "Active (in-progress + pending)" but the actual statuses are more granular.
**Why it happens:** The context used simplified terms. The real status enum is richer.
**How to avoid:** Define clear mapping:
- **Active:** `inbox`, `assigned`, `awaiting_owner`, `in_progress`, `review`, `quality_review` (any task being worked on or waiting for work)
- **Blocked:** `failed` (only clear "blocked" status; consider also tasks with stale `awaiting_owner`)
- **Completed:** `done`
- **Backlog:** `backlog` (excluded from active counts, or counted as active -- discretion area)
**Warning signs:** If blocked count is always 0, verify the mapping includes the right statuses.

### Pitfall 3: Empty Dashboard on Fresh Projects
**What goes wrong:** A new project has 0 tasks and 0 activities. Dashboard shows all zeros with no visual guidance.
**Why it happens:** No tasks have been created yet.
**How to avoid:** Design attractive empty states for each section (D-08, D-11 from context). Show "0" counts gracefully, display an encouraging message in the activity feed, and show the "add description" prompt for the brief.

### Pitfall 4: Zustand Store Tasks May Not Be Loaded Yet
**What goes wrong:** On direct URL navigation to `/project/my-app/dashboard`, the Zustand store's `tasks` array may be empty during the boot sequence, causing the dashboard to briefly show all-zero counts.
**Why it happens:** The boot sequence loads tasks asynchronously. The store starts empty.
**How to avoid:** Show loading skeletons while the store is booting. Detect boot state from the store or use a `loading` flag. The `ProjectWorkspaceProvider` already has a `loading` state that covers the project lookup -- but task data loading is separate.
**Warning signs:** Dashboard flashes "0 tasks" then updates to correct counts.

### Pitfall 5: i18n String Coverage
**What goes wrong:** Missing translation keys cause runtime errors or show raw key strings.
**Why it happens:** New dashboard UI needs many new i18n keys in `messages/en.json` under `project.dashboard.*`.
**How to avoid:** Add all new keys to `messages/en.json` before implementing components. Existing keys only cover `project.dashboard.title` and `project.dashboard.placeholder`.

## Code Examples

### Existing MarkdownRenderer Usage
```typescript
// Source: src/components/markdown-renderer.tsx
import { MarkdownRenderer } from '@/components/markdown-renderer'

// In project brief card:
<MarkdownRenderer content={project.description || ''} />
```

### Task Status Groups (Verified from Store Type)
```typescript
// Source: src/store/index.ts line 103
type TaskStatus = 'backlog' | 'inbox' | 'assigned' | 'awaiting_owner' | 'in_progress' | 'review' | 'quality_review' | 'done' | 'failed'

const STATUS_GROUPS = {
  active: ['inbox', 'assigned', 'awaiting_owner', 'in_progress', 'review', 'quality_review'] as const,
  blocked: ['failed'] as const,
  completed: ['done'] as const,
  backlog: ['backlog'] as const,
}
```

### SSE Event Types That Trigger Dashboard Updates
```typescript
// Source: src/lib/use-server-events.ts
// These events update the Zustand store automatically:
// - task.created -> addTask()
// - task.updated -> updateTask()
// - task.status_changed -> updateTask()
// - task.deleted -> deleteTask()
// - activity.created -> addActivity()
// Dashboard reads from store, so it updates reactively.
```

### Activities API Response Shape
```typescript
// Source: src/app/api/activities/route.ts
interface ActivitiesResponse {
  activities: Array<{
    id: number
    type: string           // e.g., "task_created", "task_updated"
    entity_type: string    // "task", "agent", "comment"
    entity_id: number
    actor: string
    description: string
    data: object | null
    created_at: number     // Unix timestamp
    entity?: {             // Joined entity details
      type: string
      id?: number
      title?: string
      status?: string
    }
  }>
  total: number
  hasMore: boolean
}
```

### Navigation to Filtered Tasks Tab (for Blocked Click)
```typescript
// Source: existing routing pattern (src/components/project/project-context.tsx)
import { useRouter } from 'next/navigation'

// Navigate to tasks tab (within project workspace):
const router = useRouter()
const { slug } = useProjectWorkspace()
router.push(`/project/${slug}/tasks`, { scroll: false })
// Task filtering within the tasks view is a Phase 4 concern,
// but the navigation itself is immediate.
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.x + @testing-library/react 16.1.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm vitest run src/components/project/__tests__/` |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | Status cards show correct task counts | unit | `pnpm vitest run src/components/project/__tests__/dashboard-view.test.tsx -t "status counts"` | Wave 0 |
| DASH-02 | Progress bar shows correct percentage | unit | `pnpm vitest run src/components/project/__tests__/dashboard-view.test.tsx -t "progress"` | Wave 0 |
| DASH-03 | Project brief renders markdown description | unit | `pnpm vitest run src/components/project/__tests__/dashboard-view.test.tsx -t "brief"` | Wave 0 |
| DASH-04 | Activity feed displays entries | unit | `pnpm vitest run src/components/project/__tests__/dashboard-view.test.tsx -t "activity"` | Wave 0 |
| DASH-05 | Blocked tasks card has distinct styling | unit | `pnpm vitest run src/components/project/__tests__/dashboard-view.test.tsx -t "blocked"` | Wave 0 |
| DASH-06 | Health badge shows correct status | unit | `pnpm vitest run src/components/project/__tests__/dashboard-view.test.tsx -t "health"` | Wave 0 |
| DASH-07 | Dashboard updates when store tasks change | unit | `pnpm vitest run src/components/project/__tests__/dashboard-view.test.tsx -t "real-time"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run src/components/project/__tests__/`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/components/project/__tests__/dashboard-view.test.tsx` -- covers DASH-01 through DASH-07
- [ ] Mock setup for `useMissionControl` returning tasks with various statuses
- [ ] Mock setup for `useProjectWorkspace` returning project with description
- [ ] Mock setup for `fetch` to return activities

## Project Constraints (from CLAUDE.md)

- **Stack:** Next.js 16 / React 19 / TypeScript 5 / Tailwind CSS 3 / Zustand 5
- **Icons:** No icon libraries -- use raw text/emoji in components
- **i18n:** All user-facing strings via next-intl message files (`messages/en.json`)
- **Imports:** Use `@/` prefix for all internal imports
- **Components:** Named exports, kebab-case files
- **No AI attribution:** Never add Co-Authored-By or similar trailers to commits
- **Package manager:** pnpm only
- **Database:** SQLite via better-sqlite3, prepared statements only (relevant if activities API is enhanced)

## Open Questions

1. **What counts as "blocked"?**
   - What we know: The only clearly blocked status is `failed`. There is no explicit `blocked` status in the Task type.
   - What's unclear: Should `awaiting_owner` count as blocked? Should tasks past their `due_date` count as "at risk"?
   - Recommendation: Use `failed` only for blocked count per D-15 heuristic. Refine later.

2. **Should backlog tasks be included in totals?**
   - What we know: `backlog` is a distinct status from active work statuses.
   - What's unclear: Should a project with 100 backlog tasks and 2 done tasks show "2% progress"?
   - Recommendation: Exclude `backlog` from the total for progress calculation. Count only tasks in active + blocked + completed groups. Show backlog separately or not at all.

3. **Activity feed project scoping strategy**
   - What we know: Activities API has no project_id filter. Activities reference entity_type/entity_id.
   - What's unclear: Should we modify the API or filter client-side?
   - Recommendation: Client-side filtering for this phase (fetch recent task activities, cross-reference with project task IDs). API enhancement is a future optimization.

## Sources

### Primary (HIGH confidence)
- `src/store/index.ts` -- Task type definition (9 statuses), Activity type, Zustand store methods
- `src/lib/use-server-events.ts` -- SSE event dispatch to store (task.*, activity.*)
- `src/app/api/tasks/route.ts` -- Tasks API with `project_id` query param support
- `src/app/api/activities/route.ts` -- Activities API (no project_id param, confirmed)
- `src/lib/schema.sql` -- Activities table schema (no project_id column)
- `src/components/project/project-context.tsx` -- `useProjectWorkspace()` providing project data
- `src/components/markdown-renderer.tsx` -- Reusable markdown rendering component
- `messages/en.json` -- Current i18n keys (only `project.dashboard.title` and `project.dashboard.placeholder` exist)

### Secondary (MEDIUM confidence)
- `src/components/panels/token-dashboard-panel.tsx` -- Dashboard layout patterns (recharts usage, state management)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all components use existing project dependencies
- Architecture: HIGH -- patterns verified from codebase; no new dependencies needed
- Pitfalls: HIGH -- verified activities API gap, task status mapping, and SSE patterns from source code

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable internal codebase)
