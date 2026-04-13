# Phase 1: Foundation - Research

**Researched:** 2026-04-13
**Domain:** Next.js App Router routing, SQLite indexing, React Context, next-intl i18n
**Confidence:** HIGH

## Summary

Phase 1 creates the technical substrate for a project workspace: URL-driven routing within the existing catch-all route, database composite indexes for project-scoped queries, a component directory structure with stub files, and an i18n namespace for all project UI strings. No user-visible features ship -- this is pure infrastructure for Phases 2-6.

The codebase has well-established patterns for all four areas. The catch-all route (`src/app/[[...panel]]/page.tsx`) already parses URL segments into panel names. Migrations use a numbered ID system (currently at `049`). The i18n setup uses a single flat JSON file per locale with top-level namespace keys. Components are organized by feature directory under `src/components/`. Phase 1 follows each of these patterns precisely.

**Primary recommendation:** Implement as four discrete work streams -- URL detection/context provider, database migration with composite indexes, component directory scaffolding, and i18n namespace creation -- each independently testable.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** URL shape is `/project/:slug/:view` (singular "project", slug-based, human-readable)
- **D-02:** Routing works within the existing `[[...panel]]` catch-all route -- when URL starts with `/project/`, parse slug and view from segments and render the project workspace instead of `ContentRouter`
- **D-03:** Default view when no view segment is provided: dashboard (`/project/my-app` -> dashboard)
- **D-04:** Workspace state is derived from URL (FOUN-01) but provided via a React context provider so deeply nested components can access project slug and view without prop drilling. No Zustand for workspace routing state.
- **D-05:** Project workspace components live in `src/components/project/` -- a new top-level directory alongside panels/, layout/, chat/, ui/
- **D-06:** Phase 1 creates the workspace shell (context provider + view router) plus stub files for each sub-view (dashboard, tasks, sessions, agents, settings) that render placeholders. Later phases fill them in.
- **D-07:** All project workspace strings use a `"project"` top-level key in message files, with sub-keys matching views: `project.workspace.title`, `project.dashboard.title`, `project.tasks.empty`, `project.nav.dashboard`, etc.
- **D-08:** Sessions continue to use `project_slug` (not `project_id`) -- existing `idx_claude_sessions_project` index is sufficient. No FK migration needed for v1.
- **D-09:** Add composite indexes for dashboard query patterns: `idx_tasks_project_status` (project_id, status) for task count grouping, `idx_sessions_project_active` (project_slug, active) for active session filtering.
- **D-10:** Verify existing indexes via EXPLAIN QUERY PLAN on key project-scoped queries; add additional indexes only where table scans are found.

### Claude's Discretion
None -- all areas were discussed and decided.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUN-01 | Workspace state derived from URL, not stored in global Zustand store | URL parsing in catch-all route + React context provider pattern (D-01 through D-04). Store at `src/store/index.ts` must NOT gain project workspace routing state. |
| FOUN-02 | Database indexes added for project_id composite queries (tasks, sessions) | New migration `050_project_workspace_indexes` adding composite indexes (D-08, D-09, D-10). Verify with EXPLAIN QUERY PLAN. |
| FOUN-03 | Component directory structure prevents monolithic panel anti-pattern | New `src/components/project/` directory with separate files per sub-view (D-05, D-06). Named exports, kebab-case filenames per conventions. |
| FOUN-04 | All user-facing strings use next-intl message files | New `"project"` top-level key in `messages/en.json` and all locale files (D-07). All stub components use `useTranslations('project')`. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **No AI attribution**: Never add `Co-Authored-By` or similar trailers to commits
- **Package manager**: pnpm only
- **Icons**: No icon libraries -- use raw text/emoji
- **Standalone output**: `next.config.js` sets `output: 'standalone'`
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`)
- **i18n**: All user-facing strings must go through next-intl message files
- **Database**: SQLite via better-sqlite3 -- no ORM, prepared statements only
- **Routing**: Must work within the existing catch-all route and panel system
- **Named exports** for lib functions and React components (default exports only for Next.js pages)
- **Path alias**: `@/*` maps to `./src/*` -- always use `@/` prefix for internal imports

## Architecture Patterns

### Recommended Project Structure
```
src/components/project/
  project-context.tsx       # React context provider + hook (useProjectWorkspace)
  project-workspace.tsx     # Shell: reads context, routes to sub-view
  project-view-router.tsx   # Switch on view name -> sub-view component
  dashboard-view.tsx        # Stub: placeholder for Phase 3
  tasks-view.tsx            # Stub: placeholder for Phase 4
  sessions-view.tsx         # Stub: placeholder for Phase 5
  agents-view.tsx           # Stub: placeholder for Phase 5
  settings-view.tsx         # Stub: placeholder for Phase 6
```

### Pattern 1: URL Detection in Catch-All Route

**What:** The `Home` component in `page.tsx` already derives `panelFromUrl` from `usePathname()`. When the path starts with `project/`, intercept before `ContentRouter` and render `ProjectWorkspace` instead.

**When to use:** This is the single integration point for project workspace routing.

**Example:**
```typescript
// In src/app/[[...panel]]/page.tsx, inside the returned JSX
// Before: <ContentRouter tab={activeTab} />
// After:
const pathname = usePathname()
const isProjectRoute = pathname.startsWith('/project/')

// In render:
<ErrorBoundary key={isProjectRoute ? pathname : activeTab}>
  {isProjectRoute ? <ProjectWorkspace /> : <ContentRouter tab={activeTab} />}
</ErrorBoundary>
```

**Key detail:** The `normalizedPanel` / `setActiveTab` logic runs on every pathname change. For project routes, this will set activeTab to something like `project/my-app/tasks`. This is acceptable -- it just won't match any case in `ContentRouter` since we intercept before it renders. The NavRail and HeaderBar still render (they already show for all routes).

### Pattern 2: React Context Provider for Workspace State

**What:** A context provider that parses the URL once and provides `{ slug, view, projectId }` to all children. No Zustand involvement.

**When to use:** Every project workspace component accesses workspace state via this context.

**Example:**
```typescript
// src/components/project/project-context.tsx
'use client'

import { createContext, useContext, useMemo } from 'react'
import { usePathname } from 'next/navigation'

interface ProjectWorkspaceState {
  slug: string
  view: string       // 'dashboard' | 'tasks' | 'sessions' | 'agents' | 'settings'
}

const ProjectWorkspaceContext = createContext<ProjectWorkspaceState | null>(null)

export function ProjectWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const state = useMemo(() => {
    // pathname: /project/:slug/:view?
    const segments = pathname.split('/').filter(Boolean)
    // segments[0] = 'project', segments[1] = slug, segments[2] = view
    return {
      slug: segments[1] || '',
      view: segments[2] || 'dashboard',  // D-03: default to dashboard
    }
  }, [pathname])

  return (
    <ProjectWorkspaceContext.Provider value={state}>
      {children}
    </ProjectWorkspaceContext.Provider>
  )
}

export function useProjectWorkspace(): ProjectWorkspaceState {
  const ctx = useContext(ProjectWorkspaceContext)
  if (!ctx) throw new Error('useProjectWorkspace must be used within ProjectWorkspaceProvider')
  return ctx
}
```

### Pattern 3: Database Migration for Composite Indexes

**What:** A new migration (ID `050`) adds composite indexes and verifies existing ones.

**When to use:** Single migration that runs on next app startup.

**Example:**
```typescript
// In src/lib/migrations.ts, add to the migrations array:
{
  id: '050_project_workspace_indexes',
  up: (db) => {
    // D-09: Composite index for task count grouping by project + status
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status)`)
    // D-09: Composite index for active session filtering by project
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_project_active ON claude_sessions(project_slug, is_active)`)
  }
}
```

**Existing indexes confirmed:**
- `idx_claude_sessions_project` on `claude_sessions(project_slug)` -- exists (migration 019)
- `idx_tasks_workspace_project` on `tasks(workspace_id, project_id)` -- exists (migration 024)
- `idx_claude_sessions_active` partial index on `claude_sessions(is_active) WHERE is_active = 1` -- exists (migration 019)

**What's missing:** A composite index on `tasks(project_id, status)` for grouped count queries, and a composite on `claude_sessions(project_slug, is_active)` for active session filtering by project.

### Pattern 4: i18n Namespace Addition

**What:** Add a `"project"` top-level key to all 10 locale message files.

**When to use:** Phase 1 adds the namespace with stub strings. Later phases add more keys.

**Example structure in en.json:**
```json
{
  "project": {
    "workspace": {
      "title": "Project Workspace",
      "notFound": "Project not found",
      "loading": "Loading project..."
    },
    "nav": {
      "dashboard": "Dashboard",
      "tasks": "Tasks",
      "sessions": "Sessions",
      "agents": "Agents",
      "settings": "Settings"
    },
    "dashboard": {
      "title": "Dashboard",
      "placeholder": "Project dashboard coming soon"
    },
    "tasks": {
      "title": "Tasks",
      "placeholder": "Project tasks coming soon"
    },
    "sessions": {
      "title": "Sessions",
      "placeholder": "Project sessions coming soon"
    },
    "agents": {
      "title": "Agents",
      "placeholder": "Project agents coming soon"
    },
    "settings": {
      "title": "Settings",
      "placeholder": "Project settings coming soon"
    }
  }
}
```

**Locale files to update (10 total):** ar.json, de.json, en.json, es.json, fr.json, ja.json, ko.json, pt.json, ru.json, zh.json

### Anti-Patterns to Avoid
- **Adding workspace routing to Zustand store:** FOUN-01 explicitly forbids this. Project slug/view come from URL via React context only.
- **Single monolithic component:** FOUN-03 requires separate files. Do not create one giant `project-workspace.tsx` that handles everything.
- **Hardcoded strings:** FOUN-04 requires all UI text through `useTranslations('project')`. No string literals in JSX.
- **Default exports for components:** Project conventions require named exports (`export function DashboardView()`, not `export default function`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL parsing for project routes | Custom regex URL parser | `usePathname()` + `split('/')` | Next.js App Router handles all routing; just parse the segments |
| Component state sharing | Prop drilling through 5+ levels | `createContext` + `useContext` | React's built-in context is the right tool for this scope |
| Database migrations | Manual ALTER TABLE scripts | Existing `migrations.ts` system | Already numbered, transactional, runs on startup |
| i18n message access | Manual JSON loading | `useTranslations('project')` from next-intl | Already configured with locale detection, SSR support |

## Common Pitfalls

### Pitfall 1: Catch-All Route Interference
**What goes wrong:** The `[[...panel]]` route captures ALL paths including `/project/slug`. The existing `setActiveTab` effect will fire with a nonsensical panel name like `project/my-app/tasks`.
**Why it happens:** The `useEffect` that syncs URL to Zustand activeTab runs for every pathname change.
**How to avoid:** For project routes, either skip the `setActiveTab` call entirely, or let it set an irrelevant value and ensure `ContentRouter` never renders (because we branch to `ProjectWorkspace` first).
**Warning signs:** NavRail highlights random items when viewing a project workspace.

### Pitfall 2: Missing Index Verification
**What goes wrong:** Adding indexes without verifying they are used by actual queries. SQLite may still choose a table scan if the query planner estimates it is faster.
**Why it happens:** Composite index column order matters. `(project_id, status)` helps queries filtering by project_id first; `(status, project_id)` would help queries filtering by status first.
**How to avoid:** Run `EXPLAIN QUERY PLAN SELECT ...` for the actual dashboard queries after adding indexes. Confirm output shows `SEARCH` using the new index, not `SCAN`.
**Warning signs:** `SCAN TABLE tasks` in EXPLAIN output instead of `SEARCH TABLE tasks USING INDEX`.

### Pitfall 3: Context Provider Placement
**What goes wrong:** Placing `ProjectWorkspaceProvider` inside a component that unmounts/remounts on navigation, causing unnecessary re-renders or lost state.
**Why it happens:** If the provider wraps only the view router but not the shell, navigating between views remounts the provider.
**How to avoid:** Place `ProjectWorkspaceProvider` as the outermost wrapper in `ProjectWorkspace`, above both the shell chrome and the view router.
**Warning signs:** Flickering or re-fetching when switching between project sub-views.

### Pitfall 4: i18n File Sync Across Locales
**What goes wrong:** Adding the `"project"` key to `en.json` but forgetting one or more of the other 9 locale files. next-intl will fall back gracefully but the app logs warnings.
**Why it happens:** 10 locale files is a lot to update manually.
**How to avoid:** Update all 10 files in the same task. For non-English locales, use the English strings as placeholders (translation can be done later).
**Warning signs:** Console warnings about missing message keys in non-English locales.

### Pitfall 5: Stale Slug After Project Rename
**What goes wrong:** If a project slug changes (e.g., via settings), bookmarked URLs break.
**Why it happens:** Slugs are derived from project names and stored in the database.
**How to avoid:** Phase 1 does not need to solve this -- just be aware. The workspace reads slug from URL and fetches the project by slug. If not found, show a "not found" state. Phase 6 (settings) will need to handle slug changes.
**Warning signs:** 404-like state when navigating to a renamed project.

## Code Examples

### Existing Pattern: How Panels Route Today
```typescript
// src/app/[[...panel]]/page.tsx (current pattern)
const pathname = usePathname()
const panelFromUrl = pathname === '/' ? 'overview' : pathname.slice(1)
// Then: <ContentRouter tab={activeTab} />
```
The project workspace detection inserts BEFORE this switch -- checking if `pathname` starts with `/project/`.

### Existing Pattern: How Migrations Are Numbered
```typescript
// src/lib/migrations.ts (last migration)
{ id: '049_agent_runtime_type', up: (db) => { ... } }
// Next migration MUST be:
{ id: '050_project_workspace_indexes', up: (db) => { ... } }
```

### Existing Pattern: How i18n Keys Are Consumed
```typescript
// Any client component:
import { useTranslations } from 'next-intl'

export function SomePanel() {
  const t = useTranslations('taskBoard')  // top-level key
  return <h1>{t('title')}</h1>            // nested key
}
```

### Existing Pattern: Named Exports for Components
```typescript
// All components use named exports:
export function TaskBoardPanel() { ... }
export function AgentSquadPanelPhase3() { ... }
// NOT: export default function ...
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test -- --run` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUN-01 | URL parsing produces correct slug/view; context provides values | unit | `pnpm test -- --run src/components/project/__tests__/project-context.test.tsx` | Wave 0 |
| FOUN-02 | Migration creates indexes; EXPLAIN QUERY PLAN shows index usage | unit | `pnpm test -- --run src/lib/__tests__/project-indexes.test.ts` | Wave 0 |
| FOUN-03 | Component directory has separate files per view; no single file > threshold | smoke | Manual verification via file listing | N/A (structural) |
| FOUN-04 | All stub components render text from i18n, not hardcoded | unit | `pnpm test -- --run src/components/project/__tests__/i18n-coverage.test.tsx` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test -- --run`
- **Per wave merge:** `pnpm test && pnpm typecheck`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/components/project/__tests__/project-context.test.tsx` -- covers FOUN-01 (URL parsing, context values, default view)
- [ ] `src/lib/__tests__/project-indexes.test.ts` -- covers FOUN-02 (migration runs, index exists)
- [ ] `src/components/project/__tests__/i18n-coverage.test.tsx` -- covers FOUN-04 (stub views use translations)
- [ ] Test setup: `@testing-library/react` already available; `src/test/setup.ts` imports `@testing-library/jest-dom`

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of `src/app/[[...panel]]/page.tsx` -- routing pattern, URL parsing, ContentRouter
- Direct codebase analysis of `src/lib/migrations.ts` -- migration numbering (last: 049), index creation patterns
- Direct codebase analysis of `messages/en.json` -- 10 locale files, top-level namespace keys
- Direct codebase analysis of `src/store/index.ts` -- Zustand store structure (must NOT modify for FOUN-01)
- Direct codebase analysis of `vitest.config.ts` -- test framework config, jsdom environment

### Secondary (MEDIUM confidence)
- SQLite EXPLAIN QUERY PLAN behavior for composite indexes -- well-documented SQLite behavior, column order matters for leftmost prefix matching

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all technologies already in use in the codebase (Next.js App Router, React Context, better-sqlite3, next-intl)
- Architecture: HIGH - patterns directly observed in existing code; decisions fully locked in CONTEXT.md
- Pitfalls: HIGH - derived from direct code analysis of catch-all route behavior and SQLite indexing semantics

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable -- no external dependencies, all patterns are internal)
