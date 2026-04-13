# Phase 2: Navigation & Workspace Shell - Research

**Researched:** 2026-04-13
**Domain:** Client-side navigation, breadcrumb UI, tab routing within Next.js App Router catch-all route
**Confidence:** HIGH

## Summary

Phase 2 transforms the Phase 1 stub workspace into a navigable project workspace with breadcrumb navigation, tab-based sub-view switching, and proper project data fetching. The foundation is solid: `ProjectWorkspaceProvider` already parses URL into slug/view, `ProjectViewRouter` already switches on view name, and the catch-all route already detects `/project/` URLs and renders `ProjectWorkspace`.

The primary work is: (1) extend the context provider to fetch and expose project data by slug, (2) build breadcrumb and tab bar components inside the workspace shell, (3) add i18n keys for navigation labels, and (4) handle the "project not found" error state. No new libraries are needed -- this is purely component composition using existing patterns (`useRouter`, `useTranslations`, `startTransition`).

**Primary recommendation:** Build breadcrumb and tabs as two small, focused components (`project-breadcrumb.tsx`, `project-tabs.tsx`) that read from the extended `ProjectWorkspaceContext`. Fetch project by slug using the already-booted Zustand `projects` array for instant lookup, with a fallback API call for direct-navigation scenarios.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Users navigate into a project by clicking a project row in the existing project list (or any project link throughout the app). Navigation uses `router.push('/project/{slug}')` following the same pattern as `useNavigateToPanel`.
- **D-02:** The existing `activeProject` in Zustand store can be set when entering a project workspace (for use by header bar and other global components), but workspace routing state comes from URL/React context (per Phase 1 D-04).
- **D-03:** Horizontal text breadcrumb at the top of the workspace content area, replacing any panel title area. Format: `Projects > {Project Name} > {View Name}` with each segment clickable.
- **D-04:** Separator is `>` (text, not icon -- per no icon libraries constraint). Each segment is a link: "Projects" navigates to main project list, project name navigates to project dashboard, view name is the current page (not clickable).
- **D-05:** Breadcrumb component lives in `src/components/project/project-breadcrumb.tsx`. It reads project name from the API (fetched by workspace) and current view from the React context.
- **D-06:** Horizontal tab bar below the breadcrumb, showing all 5 sub-views: Dashboard, Tasks, Sessions, Agents, Settings. Active tab is visually highlighted.
- **D-07:** Tabs are `<a>` elements (or use `router.push`) that update the URL to `/project/{slug}/{view}`. No page reload -- client-side navigation.
- **D-08:** Tab component lives in `src/components/project/project-tabs.tsx`. Uses i18n keys from the `project.nav` namespace for tab labels.
- **D-09:** Nav rail stays visible on the left. Header bar stays visible at the top. The workspace takes over only the main content area (where panels normally render). This is consistent with the existing catch-all route integration from Phase 1.
- **D-10:** When inside a project workspace, the nav rail's active state should indicate the user is in a project context (no nav rail item is "active" since projects aren't a nav rail item -- or optionally highlight a "Projects" item if one exists).
- **D-11:** The workspace shell fetches project details (name, description, status, slug) from `GET /api/projects/{id}` or by slug. This data is needed for the breadcrumb (project name) and is shared via the React context provider.
- **D-12:** If a project slug in the URL doesn't match any project, show a "Project not found" state with a link back to the project list. Use i18n key `project.workspace.notFound`.
- **D-13:** Primary back navigation is the breadcrumb "Projects" segment, which navigates to the main project list view.
- **D-14:** Browser back button works naturally because all navigation uses `router.push` which updates the history stack.

### Claude's Discretion
- Loading state design while project data is being fetched
- Exact Tailwind classes for breadcrumb and tab bar styling (should match existing app aesthetic)
- Whether to add a "Projects" item to the nav rail or rely solely on breadcrumb for returning to the list
- Tab bar responsive behavior on narrow viewports

### Deferred Ideas (OUT OF SCOPE)
None -- auto-mode stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NAV-01 | User can navigate into a project via full-takeover workspace view | Catch-all route already renders `ProjectWorkspace` for `/project/` URLs. Extend context provider to fetch project data; add breadcrumb + tabs to workspace shell. |
| NAV-02 | Breadcrumb navigation shows Projects > Project Name > Sub-view with clickable trail | New `project-breadcrumb.tsx` component reading project name from context and view from URL. Uses `router.push` for navigation. |
| NAV-03 | User can navigate between project sub-views (dashboard, tasks, sessions, agents, settings) | New `project-tabs.tsx` component with links to `/project/{slug}/{view}`. View router already handles the switch. |
| NAV-04 | URL reflects current project and sub-view (e.g., /project/my-app/tasks) | Already working from Phase 1 -- URL parsing in `ProjectWorkspaceProvider` extracts slug and view. Tab navigation updates URL via `router.push`. |
| NAV-05 | User can return to main view via breadcrumb or back navigation | Breadcrumb "Projects" segment links to project list. `router.push` maintains history stack for browser back. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.1.x | App Router, `useRouter`, `usePathname` | Already in project, provides client-side navigation |
| react | 19.0.x | Component rendering, `useState`, `useEffect`, `useCallback`, `useMemo`, `startTransition` | Already in project |
| next-intl | 4.8.x | `useTranslations('project')` for breadcrumb/tab labels | Already in project, all UI text must use it |
| zustand | 5.0.x | `useMissionControl()` for `projects` array and `setActiveProject` | Already in project |
| tailwindcss | 3.4.x | Styling for breadcrumb and tab components | Already in project |

### Supporting
No additional libraries needed. This phase is pure component composition.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom breadcrumb | @radix-ui/react-breadcrumb | Overkill -- 2 segments with text separator, no complex behavior needed |
| Custom tabs | @radix-ui/react-tabs | Tabs are navigation links (URL-based), not content tabs -- radix tabs are wrong abstraction |

## Architecture Patterns

### Component Structure
```
src/components/project/
  project-context.tsx        # MODIFY: extend to include fetched project data
  project-workspace.tsx      # MODIFY: add breadcrumb + tabs above view router
  project-breadcrumb.tsx     # NEW: breadcrumb component
  project-tabs.tsx           # NEW: tab bar component
  project-view-router.tsx    # EXISTING: no changes needed
  dashboard-view.tsx         # EXISTING: stub (future phases)
  tasks-view.tsx             # EXISTING: stub
  sessions-view.tsx          # EXISTING: stub
  agents-view.tsx            # EXISTING: stub
  settings-view.tsx          # EXISTING: stub
```

### Pattern 1: Extend Context Provider with Fetched Data
**What:** The existing `ProjectWorkspaceProvider` only provides `{ slug, view }` from the URL. It needs to also provide the full project object (name, description, status, etc.) after fetching it.
**When to use:** When workspace child components (breadcrumb, tabs, views) need project metadata.
**Approach:**

The context should be extended to:
```typescript
export interface ProjectWorkspaceState {
  slug: string
  view: string
  project: Project | null       // fetched project data
  loading: boolean              // fetch in progress
  error: string | null          // fetch failed / not found
}
```

Fetch strategy (two-tier):
1. **Instant lookup:** Check Zustand `projects` array (populated on boot) for `p.slug === slug`. If found, use immediately -- zero loading state.
2. **API fallback:** If not in store (direct URL navigation, stale store), call `GET /api/projects?slug={slug}` or find from the list API. This handles deep-link scenarios.

This avoids needing a new API endpoint -- the projects list is already loaded on boot and includes slug.

### Pattern 2: Navigation with router.push + startTransition
**What:** Follow the exact same pattern as `useNavigateToPanel` for smooth client-side navigation.
**When to use:** All navigation within the workspace (breadcrumb clicks, tab clicks).
**Example:**
```typescript
// From existing navigation.ts pattern
import { useRouter } from 'next/navigation'
import { startTransition } from 'react'

function handleTabClick(slug: string, view: string) {
  startTransition(() => {
    router.push(`/project/${slug}/${view}`, { scroll: false })
  })
}
```

### Pattern 3: i18n for Navigation Labels
**What:** All tab labels and breadcrumb text use next-intl translation keys.
**When to use:** Every user-visible string in breadcrumb and tabs.
**Keys needed in `project.nav` namespace:**
```json
{
  "project": {
    "nav.projects": "Projects",
    "nav.dashboard": "Dashboard",
    "nav.tasks": "Tasks",
    "nav.sessions": "Sessions",
    "nav.agents": "Agents",
    "nav.settings": "Settings"
  }
}
```

### Pattern 4: Setting activeProject in Zustand on Entry
**What:** When the workspace loads a project, call `setActiveProject(project)` so the header bar (which already reads `activeProject`) shows the project context.
**When to use:** After successful project fetch in the provider.
**Cleanup:** When leaving the workspace (navigating away), set `setActiveProject(null)`.

### Anti-Patterns to Avoid
- **Don't add workspace routing state to Zustand:** Per FOUN-01, workspace state is URL-derived. The context provider reads from `usePathname()`, not Zustand.
- **Don't use icon libraries for breadcrumb separator:** Use text `>` per D-04 and CLAUDE.md constraints.
- **Don't make tabs content-switching components:** Tabs are navigation links that change the URL. The `ProjectViewRouter` handles content switching based on the URL-derived view.
- **Don't create a new API endpoint for slug lookup:** The projects list is already loaded on boot. Use client-side lookup first, with the existing list API as fallback.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Client-side routing | Custom history management | `next/navigation` `useRouter().push()` | Next.js handles history, prefetching, transitions |
| Internationalization | Hardcoded strings | `next-intl` `useTranslations()` | Already required by project conventions |
| Active tab detection | Manual URL parsing in each component | `useProjectWorkspace().view` from context | Already parsed once in the provider |

## Common Pitfalls

### Pitfall 1: Slug Lookup Failure on Direct Navigation
**What goes wrong:** User bookmarks `/project/my-app/tasks` and navigates directly. The Zustand store may not have loaded `projects` yet (boot sequence still running).
**Why it happens:** Boot fetches projects in parallel with other data. If the workspace renders before boot completes, `projects` array is empty.
**How to avoid:** Two-tier fetch strategy: check store first, then fall back to API. Show a loading skeleton while fetching.
**Warning signs:** "Project not found" flash on page load that resolves after a moment.

### Pitfall 2: activeProject Stale After Navigation Away
**What goes wrong:** User navigates from `/project/my-app/tasks` to `/agents` via nav rail. The header bar still shows `activeProject` context.
**Why it happens:** Nothing clears `activeProject` when leaving the project workspace.
**How to avoid:** Use an effect in the workspace provider that clears `setActiveProject(null)` on unmount (cleanup function in `useEffect`). Or detect in the main `Home` component when `isProjectRoute` changes from true to false.
**Warning signs:** Header bar showing stale project name after returning to main views.

### Pitfall 3: Breadcrumb View Name Not Matching Tab Labels
**What goes wrong:** Breadcrumb shows "dashboard" (raw view key) instead of "Dashboard" (translated label).
**Why it happens:** Using the URL segment directly instead of translating it.
**How to avoid:** Map view key to i18n key: `t(\`nav.${view}\`)`.

### Pitfall 4: Tab Active State Not Updating
**What goes wrong:** User clicks a tab but the visual highlight doesn't move.
**Why it happens:** Tab component reads `view` from context, which derives from `usePathname()`. If `router.push` hasn't completed yet, the pathname hasn't changed.
**How to avoid:** Use `usePathname()` directly in the tab component (which is what the context already does). React's `startTransition` will handle the update correctly.

### Pitfall 5: Missing ErrorBoundary Key Update
**What goes wrong:** Navigating between project sub-views doesn't reset the error boundary.
**Why it happens:** The `ErrorBoundary` in `page.tsx` uses `pathname` as key for project routes, which already changes per view. This should work correctly.
**How to avoid:** Verify the existing `key={isProjectRoute ? pathname : activeTab}` pattern covers this.

## Code Examples

### Breadcrumb Component Pattern
```typescript
// src/components/project/project-breadcrumb.tsx
'use client'

import { useRouter } from 'next/navigation'
import { startTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useProjectWorkspace } from '@/components/project/project-context'

export function ProjectBreadcrumb() {
  const router = useRouter()
  const t = useTranslations('project')
  const { slug, view, project } = useProjectWorkspace()

  const navigate = (href: string) => {
    startTransition(() => {
      router.push(href, { scroll: false })
    })
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <button
        onClick={() => navigate('/tasks')}  // or wherever project list lives
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        {t('nav.projects')}
      </button>
      <span className="text-muted-foreground/50">{'>'}</span>
      <button
        onClick={() => navigate(`/project/${slug}`)}
        className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]"
      >
        {project?.name || slug}
      </button>
      {view !== 'dashboard' && (
        <>
          <span className="text-muted-foreground/50">{'>'}</span>
          <span className="text-foreground font-medium">
            {t(`nav.${view}` as any)}
          </span>
        </>
      )}
    </nav>
  )
}
```

### Tab Bar Component Pattern
```typescript
// src/components/project/project-tabs.tsx
'use client'

import { useRouter } from 'next/navigation'
import { startTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useProjectWorkspace } from '@/components/project/project-context'

const VIEWS = ['dashboard', 'tasks', 'sessions', 'agents', 'settings'] as const

export function ProjectTabs() {
  const router = useRouter()
  const t = useTranslations('project')
  const { slug, view } = useProjectWorkspace()

  const navigate = (targetView: string) => {
    const href = targetView === 'dashboard'
      ? `/project/${slug}`
      : `/project/${slug}/${targetView}`
    startTransition(() => {
      router.push(href, { scroll: false })
    })
  }

  return (
    <nav aria-label="Project views" className="flex gap-1 border-b border-border">
      {VIEWS.map((v) => (
        <button
          key={v}
          onClick={() => navigate(v)}
          className={`px-3 py-2 text-sm transition-colors ${
            view === v
              ? 'text-foreground border-b-2 border-primary font-medium'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t(`nav.${v}` as any)}
        </button>
      ))}
    </nav>
  )
}
```

### Extended Workspace Shell
```typescript
// src/components/project/project-workspace.tsx (modified)
'use client'

import { useTranslations } from 'next-intl'
import { ProjectWorkspaceProvider } from '@/components/project/project-context'
import { ProjectBreadcrumb } from '@/components/project/project-breadcrumb'
import { ProjectTabs } from '@/components/project/project-tabs'
import { ProjectViewRouter } from '@/components/project/project-view-router'

export function ProjectWorkspace() {
  return (
    <ProjectWorkspaceProvider>
      <div className="flex flex-col min-h-full">
        <div className="px-4 pt-4 pb-0 space-y-3">
          <ProjectBreadcrumb />
          <ProjectTabs />
        </div>
        <div className="flex-1">
          <ProjectViewRouter />
        </div>
      </div>
    </ProjectWorkspaceProvider>
  )
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Next.js Pages Router with `getServerSideProps` | App Router with client components + `usePathname` | Next.js 13+ (2023) | This project uses App Router correctly; catch-all route is idiomatic |
| Zustand for all state | URL-derived state for routing, Zustand for non-URL state | Architectural decision (Phase 1 FOUN-01) | Workspace routing reads from URL, not store |

## Open Questions

1. **Project list navigation target**
   - What we know: "Projects" breadcrumb segment should navigate to the main project list
   - What's unclear: Is the project list a standalone panel (e.g., `/projects`), or is it part of the existing overview/tasks view? Currently projects appear in a modal (`ProjectManagerModal`), not a dedicated panel.
   - Recommendation: Navigate to the existing view where projects are listed. If no dedicated panel exists, this may need to be the overview or a tasks panel with project filter. Check if there's a nav rail item for projects -- from the code, there isn't one yet. The simplest approach: navigate to `/overview` where the dashboard lives, or create a lightweight project list route. The decision D-13 says "navigates to main project list view" -- this may need clarification during planning, but navigating to overview is a safe default.

2. **Slug-based project lookup API**
   - What we know: The existing `GET /api/projects/[id]` only accepts numeric IDs. The projects list API returns all projects including slugs.
   - What's unclear: Whether we need a dedicated slug lookup endpoint.
   - Recommendation: Use the Zustand store's `projects` array (loaded on boot) for client-side slug lookup. For direct navigation fallback, fetch `/api/projects` and filter client-side. No new API endpoint needed for Phase 2.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.x with jsdom |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test -- --run` |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NAV-01 | Workspace renders when URL starts with /project/ | unit (component) | `pnpm test -- --run src/lib/__tests__/project-workspace.test.ts` | No -- Wave 0 |
| NAV-02 | Breadcrumb shows correct segments with clickable links | unit (component) | `pnpm test -- --run src/lib/__tests__/project-breadcrumb.test.ts` | No -- Wave 0 |
| NAV-03 | Tab bar renders all 5 views, active tab highlighted | unit (component) | `pnpm test -- --run src/lib/__tests__/project-tabs.test.ts` | No -- Wave 0 |
| NAV-04 | URL reflects current project and sub-view | unit | `pnpm test -- --run src/lib/__tests__/project-context.test.ts` | No -- Wave 0 |
| NAV-05 | Back navigation works via breadcrumb and browser back | unit (component) | `pnpm test -- --run src/lib/__tests__/project-breadcrumb.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test -- --run`
- **Per wave merge:** `pnpm test && pnpm typecheck`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/project-breadcrumb.test.ts` -- covers NAV-02, NAV-05
- [ ] `src/lib/__tests__/project-tabs.test.ts` -- covers NAV-03
- [ ] `src/lib/__tests__/project-context.test.ts` -- covers NAV-04 (extend existing context tests)
- [ ] `src/lib/__tests__/project-workspace.test.ts` -- covers NAV-01 (workspace renders with breadcrumb + tabs)

## Project Constraints (from CLAUDE.md)

- **No AI attribution:** Never add `Co-Authored-By` or similar trailers to commits
- **Package manager:** pnpm only
- **Icons:** No icon libraries -- raw text/emoji only. Breadcrumb separator must be text `>`
- **i18n:** All user-facing strings through next-intl message files
- **Commits:** Conventional Commits format (`feat:`, `fix:`, etc.)
- **Named exports:** For all components (not default exports, except Next.js pages)
- **Path alias:** Use `@/` prefix for imports, never relative paths between feature areas
- **Standalone output:** `next.config.js` has `output: 'standalone'`
- **No ORM:** SQLite via better-sqlite3 with prepared statements only

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all referenced files (catch-all route, workspace components, context provider, navigation patterns, store, API routes, i18n messages)
- Phase 1 CONTEXT.md decisions (D-01 through D-10)
- Phase 2 CONTEXT.md decisions (D-01 through D-14)
- CLAUDE.md project conventions

### Secondary (MEDIUM confidence)
- Next.js App Router patterns (useRouter, usePathname, startTransition) -- verified against codebase usage

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all existing
- Architecture: HIGH -- extending existing Phase 1 patterns with clear decisions from CONTEXT.md
- Pitfalls: HIGH -- identified from direct code inspection of integration points

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable -- internal codebase patterns, no external dependency risk)
