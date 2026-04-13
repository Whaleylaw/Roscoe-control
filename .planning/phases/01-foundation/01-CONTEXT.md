# Phase 1: Foundation - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Technical substrate for the project workspace feature. Delivers URL-driven workspace state, database indexes for project-scoped queries, component directory structure with stub files, and i18n namespace setup. No user-visible features beyond placeholder views — this phase creates the foundation that Phases 2-6 build on.

</domain>

<decisions>
## Implementation Decisions

### URL Routing Strategy
- **D-01:** URL shape is `/project/:slug/:view` (singular "project", slug-based, human-readable)
- **D-02:** Routing works within the existing `[[...panel]]` catch-all route — when URL starts with `/project/`, parse slug and view from segments and render the project workspace instead of `ContentRouter`
- **D-03:** Default view when no view segment is provided: dashboard (`/project/my-app` -> dashboard)
- **D-04:** Workspace state is derived from URL (FOUN-01) but provided via a React context provider so deeply nested components can access project slug and view without prop drilling. No Zustand for workspace routing state.

### Component Directory Layout
- **D-05:** Project workspace components live in `src/components/project/` — a new top-level directory alongside panels/, layout/, chat/, ui/
- **D-06:** Phase 1 creates the workspace shell (context provider + view router) plus stub files for each sub-view (dashboard, tasks, sessions, agents, settings) that render placeholders. Later phases fill them in.

### i18n Namespace Structure
- **D-07:** All project workspace strings use a `"project"` top-level key in message files, with sub-keys matching views: `project.workspace.title`, `project.dashboard.title`, `project.tasks.empty`, `project.nav.dashboard`, etc.

### Database Index Scope
- **D-08:** Sessions continue to use `project_slug` (not `project_id`) — existing `idx_claude_sessions_project` index is sufficient. No FK migration needed for v1.
- **D-09:** Add composite indexes for dashboard query patterns: `idx_tasks_project_status` (project_id, status) for task count grouping, `idx_sessions_project_active` (project_slug, active) for active session filtering.
- **D-10:** Verify existing indexes via EXPLAIN QUERY PLAN on key project-scoped queries; add additional indexes only where table scans are found.

### Claude's Discretion
None — all areas were discussed and decided.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning
- `.planning/PROJECT.md` — Core value statement, constraints, key decisions
- `.planning/REQUIREMENTS.md` — FOUN-01 through FOUN-04 requirements with acceptance criteria
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, dependencies

### Codebase Architecture
- `.planning/codebase/ARCHITECTURE.md` — Routing/shell layer, panel system, data flow patterns
- `.planning/codebase/CONVENTIONS.md` — Naming, imports, error handling patterns
- `.planning/codebase/STRUCTURE.md` — Directory layout, component organization

### Key Source Files
- `src/app/[[...panel]]/page.tsx` — Catch-all route where project detection will be added
- `src/store/index.ts` — Zustand store (workspace state must NOT go here per FOUN-01)
- `src/lib/migrations.ts` — Database migrations including existing project indexes
- `messages/en.json` — i18n message file where "project" namespace will be added

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/[[...panel]]/page.tsx` `ContentRouter` — existing pattern for routing URL segments to components; project workspace detection goes before this
- `src/lib/migrations.ts` — migration system with numbered migrations; new indexes get added as the next migration number
- `messages/en.json` — established i18n pattern with nested keys; project namespace follows the same structure

### Established Patterns
- All panels are named exports (`export function PanelName()`) not default exports
- Components fetch their own data via `fetch('/api/...')` — project sub-views will follow this
- Zustand store accessed via `useMissionControl()` — project workspace avoids this for routing state
- Error handling: `ErrorBoundary` wraps per-tab content in ContentRouter

### Integration Points
- `src/app/[[...panel]]/page.tsx` — project URL detection branches before ContentRouter
- `src/lib/migrations.ts` — new composite indexes added as a migration
- `messages/en.json` — new "project" key added at top level
- `src/components/` — new `project/` directory alongside existing feature directories

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches within the decisions above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-13*
