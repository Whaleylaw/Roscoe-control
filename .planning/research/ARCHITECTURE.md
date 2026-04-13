# Architecture Research

**Domain:** Project workspace with sub-views inside panel-based SPA
**Researched:** 2026-04-13
**Confidence:** HIGH

## Current State Analysis

The existing architecture has these key properties that constrain the workspace design:

1. **Single catch-all route** (`src/app/[[...panel]]/page.tsx`) -- all panels render through `ContentRouter`'s switch statement based on `activeTab` from Zustand
2. **Flat panel model** -- 35+ panels at the same level, no nesting. Each case in the switch returns a component
3. **`activeProject` already exists** in the Zustand store, persisted to localStorage, used as a filter by the task board and shown in the header bar. But it acts as a global filter, not a navigation destination
4. **Navigation is panel-based** -- `useNavigateToPanel('tasks')` pushes `/tasks` and sets `activeTab`. The URL is always `/<panel-name>` (single segment)
5. **No sub-view routing exists** -- the closest precedent is the settings panel, which uses internal `useState` for sub-sections without URL reflection

## Recommended Architecture

### URL Scheme

Use a two-segment URL pattern for project workspace views:

```
/project/<slug>                    -> Project dashboard (default sub-view)
/project/<slug>/tasks              -> Project-scoped tasks
/project/<slug>/sessions           -> Project-scoped sessions
/project/<slug>/agents             -> Project-scoped agents
/project/<slug>/settings           -> Project settings
```

The catch-all route `[[...panel]]` already captures multi-segment paths. The `panelFromUrl` extraction at line 97 of `page.tsx` takes `pathname.slice(1)`, which for `/project/my-app/tasks` gives `project/my-app/tasks`. `ContentRouter` needs a single new case that matches when `tab.startsWith('project/')` and delegates to the workspace component.

### System Overview

```
+---------------------------------------------------------------+
|  Catch-all Route (page.tsx)                                   |
|  URL sync -> activeTab in Zustand                             |
+---------------------------------------------------------------+
         |                                    |
    tab matches                          tab starts with
    existing panel                       "project/"
         |                                    |
         v                                    v
+------------------+              +---------------------------+
|  ContentRouter   |              |  ProjectWorkspace         |
|  (existing)      |              |  (new top-level component)|
+------------------+              +---------------------------+
                                       |
                         Parse slug + sub-view from tab
                                       |
                    +------------------+------------------+
                    |                  |                  |
              +----------+     +----------+       +----------+
              | Workspace|     | Workspace|       | Workspace|
              | Header   |     | Content  |       | Sidebar  |
              | (breadcr)|     | (sub-view|       | (optional|
              +----------+     |  router) |       |  context)|
                               +----------+       +----------+
                                    |
                  +---------+-------+-------+---------+
                  |         |       |       |         |
              Dashboard  Tasks  Sessions  Agents  Settings
              (sub-view) (scoped)(scoped) (scoped)(project)
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|----------------|----------|
| `ProjectWorkspace` | Top-level container; parses slug/sub-view from tab string; manages project loading; renders workspace chrome + active sub-view | `src/components/workspace/project-workspace.tsx` |
| `WorkspaceHeader` | Breadcrumb navigation (Projects > Name > Sub-view); project color indicator; sub-view tab bar | `src/components/workspace/workspace-header.tsx` |
| `WorkspaceRouter` | Switch on sub-view string to render the correct sub-view component | Inside `ProjectWorkspace` (inline or extracted) |
| `ProjectDashboard` | Status overview, activity feed, project brief, progress indicators | `src/components/workspace/views/project-dashboard.tsx` |
| `ProjectTasksView` | Task board scoped to project; reuses existing task board internals with forced project filter | `src/components/workspace/views/project-tasks-view.tsx` |
| `ProjectSessionsView` | Session list filtered to project-associated sessions | `src/components/workspace/views/project-sessions-view.tsx` |
| `ProjectAgentsView` | Agents assigned to project | `src/components/workspace/views/project-agents-view.tsx` |
| `ProjectSettingsView` | Name, description, status, color, agent assignments, GitHub config | `src/components/workspace/views/project-settings-view.tsx` |

## Recommended Project Structure

```
src/components/workspace/
  project-workspace.tsx           # Top-level workspace shell
  workspace-header.tsx            # Breadcrumb + sub-view tabs
  workspace-context.tsx           # React context for workspace-scoped state
  views/
    project-dashboard.tsx         # Dashboard sub-view
    project-tasks-view.tsx        # Scoped task board
    project-sessions-view.tsx     # Scoped sessions
    project-agents-view.tsx       # Scoped agents
    project-settings-view.tsx     # Project settings
  widgets/
    status-overview.tsx           # Task status summary card
    activity-feed.tsx             # Recent project activity
    project-brief.tsx             # Description + goals card
    progress-bar.tsx              # Completion indicator
```

### Structure Rationale

- **`workspace/` directory** (not inside `panels/`): The workspace is fundamentally different from other panels -- it has its own sub-routing, chrome, and scoped state. Keeping it separate avoids muddying the flat panel convention.
- **`views/` subdirectory**: Sub-views are full-page content areas within the workspace, analogous to panels but scoped. Separating them from widgets makes the render tree obvious.
- **`widgets/` subdirectory**: Dashboard-specific composable cards. These are the building blocks of the project dashboard, not standalone views.

## Architectural Patterns

### Pattern 1: Tab String Parsing for Sub-View Routing

**What:** The `activeTab` string already carries the full URL path. For project workspaces, parse it into structured parts rather than adding new Zustand fields.

**When to use:** Always for workspace sub-view routing.

**Trade-offs:** Simple (no new state), URL-driven (shareable/bookmarkable), but requires consistent slug-based URLs.

**Example:**
```typescript
// In ContentRouter
if (tab.startsWith('project/')) {
  return <ProjectWorkspace tabPath={tab} />
}

// In ProjectWorkspace
function ProjectWorkspace({ tabPath }: { tabPath: string }) {
  // "project/my-app/tasks" -> ["project", "my-app", "tasks"]
  const segments = tabPath.split('/')
  const projectSlug = segments[1]   // "my-app"
  const subView = segments[2] || 'dashboard'  // "tasks" or default "dashboard"
  
  // Load project by slug, render sub-view
}
```

### Pattern 2: Workspace-Scoped React Context (Not Zustand)

**What:** Use a React Context provider inside `ProjectWorkspace` to share the loaded project data, scoped fetch functions, and sub-view navigation with all child components. Do NOT add workspace sub-view state to the global Zustand store.

**When to use:** For any data that only matters inside the workspace (loaded project details, project-scoped task lists, project-scoped session lists).

**Trade-offs:** Keeps the Zustand store clean. Context re-renders are fine here because the workspace is a single render subtree. Avoids stale workspace state leaking when navigating away.

**Example:**
```typescript
interface WorkspaceContextValue {
  project: Project
  subView: string
  navigateSubView: (view: string) => void
  // Scoped data loaders
  tasks: Task[]
  sessions: Session[]
  agents: Agent[]
  loading: boolean
  refresh: () => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within ProjectWorkspace')
  return ctx
}
```

### Pattern 3: Composition Over Forking for Scoped Views

**What:** Project-scoped views should compose existing components with a forced project filter, not fork/duplicate existing panels. The task board already supports `projectFilter` state. The workspace view sets it and hides the project selector.

**When to use:** For tasks, sessions, and agents sub-views.

**Trade-offs:** Reuse prevents drift between global and scoped views. But requires the existing components to accept filter props (may need minor refactoring to extract filter-accepting inner components from panels).

**Example:**
```typescript
// project-tasks-view.tsx
function ProjectTasksView() {
  const { project } = useWorkspace()
  // Reuse task board internals with locked project filter
  return <TaskBoardInner projectId={project.id} hideProjectSelector />
}
```

This means the existing `TaskBoardPanel` needs a small refactor: extract the inner board logic into a `TaskBoardInner` component that accepts `projectId` as a prop. The outer `TaskBoardPanel` passes the global filter. The workspace view passes the locked project ID.

## Data Flow

### Navigation Flow

```
User clicks project in list/card
    |
    v
navigateToPanel(`project/${slug}`)
    |
    v
URL changes to /project/<slug>
    |
    v
page.tsx syncs: activeTab = "project/<slug>"
    |
    v
ContentRouter: tab.startsWith('project/') -> <ProjectWorkspace />
    |
    v
ProjectWorkspace parses slug, fetches project, renders workspace chrome
    |
    v
WorkspaceRouter renders sub-view (default: dashboard)
```

### Sub-View Navigation Flow

```
User clicks "Tasks" tab in workspace header
    |
    v
navigateToPanel(`project/${slug}/tasks`)
    |
    v
URL changes to /project/<slug>/tasks
    |
    v
activeTab = "project/<slug>/tasks"
    |
    v
ProjectWorkspace re-parses: subView = "tasks"
    |
    v
WorkspaceRouter renders ProjectTasksView
```

### Data Loading Flow

```
ProjectWorkspace mounts
    |
    +-> fetch('/api/projects?slug=<slug>')  -> project metadata
    |
    +-> Sub-view mounts:
        |
        Dashboard:
        +-> fetch('/api/projects/<id>/tasks?summary=1')  -> status counts
        +-> fetch('/api/activity?project_id=<id>')        -> activity feed
        |
        Tasks:
        +-> fetch('/api/projects/<id>/tasks')             -> full task list
        |
        Sessions:
        +-> fetch('/api/sessions?project_id=<id>')        -> scoped sessions
        |
        Agents:
        +-> fetch('/api/projects/<id>/agents')             -> assigned agents
```

### Real-Time Updates

The existing SSE event bus already pushes task and agent mutations. The workspace components subscribe to the same events but filter client-side by `project_id`:

```
eventBus emits: { type: 'task-updated', data: { id, project_id, ... } }
    |
    v
SSE delivers to client
    |
    v
useServerEvents dispatches to Zustand (global task list updates)
    |
    v
Workspace sub-view re-renders if task.project_id matches workspace project
```

No new SSE channels needed. Client-side filtering is sufficient given the data volumes.

### State Management

```
Global Zustand Store (existing)
  - activeTab: "project/my-app/tasks"  (drives URL + ContentRouter)
  - projects: Project[]                 (global project list, already exists)
  - activeProject: Project | null       (keep for global filter, separate from workspace)
  
Workspace React Context (new, lives inside ProjectWorkspace)
  - project: Project                    (loaded workspace project)
  - subView: string                     (parsed from activeTab)
  - tasks: Task[]                       (project-scoped)
  - sessions: Session[]                 (project-scoped)
  - agents: Agent[]                     (project-scoped)
```

Key principle: the global `activeProject` (used for filtering the global task board) is independent from the workspace context. Entering a project workspace does NOT set `activeProject`. They serve different purposes -- one is a global filter toggle, the other is full immersion.

## API Surface Gaps

Existing API routes that need extension or creation:

| Route | Status | Needed For |
|-------|--------|------------|
| `GET /api/projects` | Exists | Project list for navigation |
| `GET /api/projects/[id]` | Exists | Project detail for workspace |
| `GET /api/projects/[id]/tasks` | Exists | Scoped task list |
| `GET /api/projects/[id]/agents` | Exists | Assigned agents |
| `GET /api/activity?project_id=<id>` | Needs filter param | Dashboard activity feed |
| `GET /api/sessions?project_id=<id>` | Needs filter param | Scoped sessions |
| `GET /api/projects/[id]/stats` | New | Dashboard status counts, progress |
| `PUT /api/projects/[id]` | Exists | Settings updates |
| `GET /api/projects?slug=<slug>` | Needs slug lookup | URL-based project resolution |

The sessions API does not currently support `project_id` filtering. Sessions are linked to agents, not projects directly. Two options:

1. **Join through agents**: Sessions have an `agent` field. Projects have `project_agent_assignments`. Join to get project sessions. This works but is indirect.
2. **Add `project_id` to sessions table**: More direct, but requires schema change and session-creation logic updates.

Recommendation: Option 1 for v1 (join through agents), with the stats endpoint doing the aggregation server-side. Avoids schema migration complexity for sessions.

## Build Order (Dependencies)

The components have a clear dependency chain that determines build order:

```
Phase 1: Foundation
  workspace-context.tsx          (no dependencies)
  workspace-header.tsx           (breadcrumb, tabs -- no data deps)
  project-workspace.tsx          (shell, uses context + header)
  ContentRouter integration      (one-line addition)
  Navigation helper              (extend panelHref for project URLs)

Phase 2: Dashboard
  API: /api/projects/[id]/stats  (new endpoint)
  API: /api/activity filter      (add project_id param)
  status-overview.tsx            (depends on stats API)
  activity-feed.tsx              (depends on activity API)
  project-brief.tsx              (depends on project data)
  progress-bar.tsx               (depends on stats API)
  project-dashboard.tsx          (composes widgets)

Phase 3: Scoped Views
  Extract TaskBoardInner         (refactor existing panel)
  project-tasks-view.tsx         (depends on TaskBoardInner)
  API: session aggregation       (join through agents)
  project-sessions-view.tsx      (depends on session API)
  project-agents-view.tsx        (depends on existing API)

Phase 4: Settings + Polish
  project-settings-view.tsx      (depends on existing PUT API)
  i18n message entries           (all user-facing strings)
  Nav-rail entry point           (project list in nav or entry from header)
```

**Why this order:** Phase 1 establishes the routing and shell -- everything else plugs into it. Phase 2 delivers the dashboard (the primary value -- "see everything about a project"). Phase 3 adds scoped views that require refactoring existing panels. Phase 4 is settings and polish that have no blockers from other phases.

## Anti-Patterns

### Anti-Pattern 1: Adding Sub-View State to Global Zustand

**What people do:** Add `workspaceSubView`, `workspaceProjectId`, etc. to the global Zustand store.
**Why it's wrong:** Workspace state leaks across navigations. Global store becomes a dumping ground. Stale state bugs when navigating between projects or back to global views.
**Do this instead:** Use React Context scoped to the `ProjectWorkspace` component tree. When the workspace unmounts, all state naturally cleans up.

### Anti-Pattern 2: Forking Existing Panels for Scoped Views

**What people do:** Copy `TaskBoardPanel` into `ProjectTaskBoardPanel` with hardcoded project filter.
**Why it's wrong:** Two copies drift. Bug fixes need to be applied twice. Feature additions are forgotten in one copy.
**Do this instead:** Extract the reusable inner component from the existing panel. Both the global panel and workspace view compose the same inner component with different filter props.

### Anti-Pattern 3: Creating Separate Next.js Routes for Project Pages

**What people do:** Add `src/app/project/[slug]/page.tsx`, `src/app/project/[slug]/tasks/page.tsx`, etc.
**Why it's wrong:** Breaks the SPA model. Each navigation triggers a full page load instead of a client-side panel swap. Loses the boot sequence, WebSocket connection, SSE stream, and Zustand state.
**Do this instead:** Keep everything under the catch-all route. The URL still changes (bookmarkable, shareable), but rendering stays client-side through `ContentRouter`.

### Anti-Pattern 4: Using `activeProject` as Workspace Context

**What people do:** Set the global `activeProject` when entering a workspace, then check it everywhere.
**Why it's wrong:** `activeProject` is a global filter (used by task board, header). Setting it when entering a workspace changes behavior of other panels if the user navigates away via browser back. Two different concepts (global filter vs. workspace immersion) should not share one state field.
**Do this instead:** Workspace gets its own context. `activeProject` remains the global filter, unchanged by workspace entry.

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| ContentRouter -> ProjectWorkspace | Props (`tabPath` string) | Single entry point; workspace owns everything below |
| ProjectWorkspace -> Sub-views | React Context | Workspace context provides project data, navigation, refresh |
| Sub-views -> Existing Panels | Composition (import inner components) | TaskBoardInner, etc. -- requires refactoring existing panels to export inner components |
| ProjectWorkspace -> Nav Rail | None (nav rail reads `activeTab` from Zustand) | Highlight project nav item when in workspace; de-highlight other items |
| ProjectWorkspace -> Header Bar | activeTab from Zustand | Header can detect workspace mode from tab prefix and adjust display |
| Sub-views -> REST API | Direct fetch calls | Same pattern as existing panels |
| Sub-views -> SSE events | Via existing `useServerEvents` + Zustand | Filter events client-side by project_id |

### Navigation Integration

The `useNavigateToPanel` hook and `panelHref` function need minor extension:

```typescript
// Current: panelHref('tasks') -> '/tasks'
// Extended: panelHref('project/my-app/tasks') -> '/project/my-app/tasks'
// No change needed -- it already handles any string
```

The nav rail needs a way to enter workspaces. Two approaches:
1. **Project list in nav rail** -- a "Projects" nav item that expands to show project names
2. **Entry from header/project selector** -- clicking a project name in the existing header project indicator navigates to the workspace

Recommendation: Both. The header project indicator becomes the primary entry point (it already shows the active project name). Add a "Projects" item to the nav rail core group that shows a dropdown of projects, each linking to `/project/<slug>`.

## Sources

- Codebase analysis: `src/app/[[...panel]]/page.tsx` (catch-all route, ContentRouter)
- Codebase analysis: `src/store/index.ts` (Zustand store, Project interface, activeProject)
- Codebase analysis: `src/lib/navigation.ts` (panelHref, useNavigateToPanel)
- Codebase analysis: `src/components/layout/nav-rail.tsx` (navigation structure)
- Codebase analysis: `src/components/panels/task-board-panel.tsx` (activeProject filter usage)
- Codebase analysis: `src/components/layout/header-bar.tsx` (project indicator in header)
- Codebase analysis: `src/app/api/projects/` (existing project API surface)
- Architecture patterns informed by existing codebase conventions (panel pattern, SSE pattern, Zustand usage)

---
*Architecture research for: Project workspace integration in panel-based SPA*
*Researched: 2026-04-13*
