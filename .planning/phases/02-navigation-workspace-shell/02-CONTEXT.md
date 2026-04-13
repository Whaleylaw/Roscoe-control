# Phase 2: Navigation & Workspace Shell - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning
**Source:** Auto-selected recommended defaults

<domain>
## Phase Boundary

Full-takeover workspace entry point with breadcrumb navigation and sub-view routing. Users can click into a project from the main view, see a workspace that replaces the content area, navigate between sub-views via tabs, and return to the main view via breadcrumb. The nav rail and header bar remain visible — only the content area changes.

</domain>

<decisions>
## Implementation Decisions

### Workspace Entry Point
- **D-01:** Users navigate into a project by clicking a project row in the existing project list (or any project link throughout the app). Navigation uses `router.push('/project/{slug}')` following the same pattern as `useNavigateToPanel`.
- **D-02:** The existing `activeProject` in Zustand store can be set when entering a project workspace (for use by header bar and other global components), but workspace routing state comes from URL/React context (per Phase 1 D-04).

### Breadcrumb Navigation
- **D-03:** Horizontal text breadcrumb at the top of the workspace content area, replacing any panel title area. Format: `Projects > {Project Name} > {View Name}` with each segment clickable.
- **D-04:** Separator is `>` (text, not icon — per no icon libraries constraint). Each segment is a link: "Projects" navigates to main project list, project name navigates to project dashboard, view name is the current page (not clickable).
- **D-05:** Breadcrumb component lives in `src/components/project/project-breadcrumb.tsx`. It reads project name from the API (fetched by workspace) and current view from the React context.

### Sub-view Tab Navigation
- **D-06:** Horizontal tab bar below the breadcrumb, showing all 5 sub-views: Dashboard, Tasks, Sessions, Agents, Settings. Active tab is visually highlighted.
- **D-07:** Tabs are `<a>` elements (or use `router.push`) that update the URL to `/project/{slug}/{view}`. No page reload — client-side navigation.
- **D-08:** Tab component lives in `src/components/project/project-tabs.tsx`. Uses i18n keys from the `project.nav` namespace for tab labels.

### Workspace Chrome Behavior
- **D-09:** Nav rail stays visible on the left. Header bar stays visible at the top. The workspace takes over only the main content area (where panels normally render). This is consistent with the existing catch-all route integration from Phase 1.
- **D-10:** When inside a project workspace, the nav rail's active state should indicate the user is in a project context (no nav rail item is "active" since projects aren't a nav rail item — or optionally highlight a "Projects" item if one exists).

### Project Data Fetching
- **D-11:** The workspace shell fetches project details (name, description, status, slug) from `GET /api/projects/{id}` or by slug. This data is needed for the breadcrumb (project name) and is shared via the React context provider.
- **D-12:** If a project slug in the URL doesn't match any project, show a "Project not found" state with a link back to the project list. Use i18n key `project.workspace.notFound`.

### Back Navigation
- **D-13:** Primary back navigation is the breadcrumb "Projects" segment, which navigates to the main project list view.
- **D-14:** Browser back button works naturally because all navigation uses `router.push` which updates the history stack.

### Claude's Discretion
- Loading state design while project data is being fetched
- Exact Tailwind classes for breadcrumb and tab bar styling (should match existing app aesthetic)
- Whether to add a "Projects" item to the nav rail or rely solely on breadcrumb for returning to the list
- Tab bar responsive behavior on narrow viewports

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning
- `.planning/PROJECT.md` — Core value statement, constraints, key decisions
- `.planning/REQUIREMENTS.md` — NAV-01 through NAV-05 requirements with acceptance criteria
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, dependencies

### Phase 1 Foundation (built artifacts)
- `.planning/phases/01-foundation/01-CONTEXT.md` — URL routing decisions (D-01 through D-10) that Phase 2 builds on
- `src/components/project/project-context.tsx` — React context provider with URL parsing (slug, view)
- `src/components/project/project-workspace.tsx` — Workspace shell wrapping provider + router
- `src/components/project/project-view-router.tsx` — View switch component routing to stub views
- `src/app/[[...panel]]/page.tsx` — Catch-all route with project workspace integration

### Navigation Patterns
- `src/lib/navigation.ts` — `useNavigateToPanel` and `panelHref` patterns for client-side navigation
- `src/components/layout/nav-rail.tsx` — Nav rail structure, NavItem/NavGroup types
- `src/components/layout/header-bar.tsx` — Header bar using `activeProject` from store

### Codebase Architecture
- `.planning/codebase/ARCHITECTURE.md` — Routing/shell layer, panel system, data flow patterns
- `.planning/codebase/CONVENTIONS.md` — Naming, imports, component patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useNavigateToPanel` in `src/lib/navigation.ts` — pattern for client-side panel navigation with prefetching; project navigation should follow similar approach
- `activeProject` in Zustand store — already exists for tracking selected project context; localStorage-persisted
- `ProjectWorkspaceProvider` in `src/components/project/project-context.tsx` — already parses URL into slug/view; extend to include fetched project data
- `useTranslations('project')` — i18n namespace already set up with view-specific sub-keys

### Established Patterns
- Navigation uses `router.push()` with `startTransition` for smooth client-side transitions
- Components are named exports in kebab-case files
- All UI text goes through next-intl translations
- No icon libraries — text/emoji only per CLAUDE.md

### Integration Points
- `src/app/[[...panel]]/page.tsx` — project workspace already renders when URL starts with `/project/`; breadcrumb and tabs will be added inside `ProjectWorkspace` component
- `src/store/index.ts` — `setActiveProject` can be called when entering workspace
- `src/components/project/project-workspace.tsx` — breadcrumb and tab bar slot above the view router
- `messages/*.json` — `project.nav.*` keys needed for tab labels

</code_context>

<specifics>
## Specific Ideas

No specific requirements — auto-selected standard approaches based on existing app patterns.

</specifics>

<deferred>
## Deferred Ideas

None — auto-mode stayed within phase scope.

</deferred>

---

*Phase: 02-navigation-workspace-shell*
*Context gathered: 2026-04-13 via auto-mode*
