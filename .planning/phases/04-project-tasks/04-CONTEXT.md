# Phase 4: Project Tasks - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Scoped task management within the project workspace. Users can view, create, reassign, and update tasks entirely from within the project context. The existing global task board is embedded (not rebuilt) with project-specific adaptations: locked project filter, auto-scoped creation, and redundant label removal.

</domain>

<decisions>
## Implementation Decisions

### Task Board Reuse Strategy
- **D-01:** Embed the existing `task-board-panel.tsx` component inside the project workspace's `tasks-view.tsx`. The full kanban board with all 9 columns, drag-and-drop, Aegis approval gate, agent spawning, GitHub links, and project manager modal all work identically inside the project workspace.
- **D-02:** The task board component must accept a prop (e.g., `projectId` or `projectScope`) that pre-filters tasks to the current project. This replaces the user-selectable project filter dropdown.
- **D-03:** The project filter dropdown is **hidden** (not shown disabled) when the board is rendered inside a project workspace. The workspace breadcrumb already communicates the project context.
- **D-04:** Full feature parity with the global board — no features stripped out.

### Task Creation Flow
- **D-05:** When creating a task from within the project workspace, the project field is **pre-filled with the current project but remains editable**. The user can change it to create a task for a different project if needed.
- **D-06:** The existing `CreateTaskModal` is reused. It receives the current project ID as a default value for the project dropdown.

### Reassignment UX
- **D-07:** Task reassignment (changing a task's project) works exclusively through the existing **edit modal's project dropdown** — same as the global board. No new reassignment UI is needed.
- **D-08:** When a task is reassigned out of the current project, it **disappears immediately** from the board on the next re-fetch. No toast or confirmation — consistent with the board's existing behavior for state changes.

### View Presentation
- **D-09:** The project label/prefix on task cards is **hidden** when inside the project workspace since all tasks belong to the same project. This reduces visual noise.
- **D-10:** All 9 status columns are **always visible**, even when empty. Consistent with the global board and preserves drag-and-drop targets.

### Claude's Discretion
- How to pass project scope into the task board component (prop interface design)
- Whether to use a wrapper component or direct prop modification on the existing board
- Loading state and error handling for the embedded board
- Any CSS adjustments needed for the board to fit within the workspace layout (breadcrumb + tabs above)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning
- `.planning/PROJECT.md` — Core value statement, constraints
- `.planning/REQUIREMENTS.md` — TASK-01 through TASK-04 requirements with acceptance criteria
- `.planning/ROADMAP.md` — Phase 4 goal, success criteria

### Prior Phase Context
- `.planning/phases/01-foundation/01-CONTEXT.md` — URL routing decisions, component directory layout, i18n namespace
- `.planning/phases/02-navigation-workspace-shell/02-CONTEXT.md` — Workspace shell, breadcrumb, tabs, data fetching
- `.planning/phases/03-project-dashboard/03-CONTEXT.md` — Dashboard patterns, SSE real-time updates

### Key Source Files (Task Board)
- `src/components/panels/task-board-panel.tsx` — The existing ~2500-line task board with kanban, create/edit modals, detail panel, drag-and-drop, Aegis approval, agent spawning. This is the component being embedded.
- `src/app/api/tasks/route.ts` — Tasks API with `project_id` filtering on GET, project-scoped creation on POST
- `src/app/api/tasks/[id]/route.ts` — Single task CRUD including reassignment (project_id change with ticket number reallocation)
- `src/app/api/projects/[id]/tasks/route.ts` — Project-scoped task list endpoint

### Key Source Files (Project Workspace)
- `src/components/project/tasks-view.tsx` — Current stub to be replaced with embedded board
- `src/components/project/project-context.tsx` — React context providing `project` (id, slug, name, description, status)
- `src/components/project/project-workspace.tsx` — Workspace shell with breadcrumb + tabs

### Codebase Architecture
- `.planning/codebase/ARCHITECTURE.md` — Data flow, SSE patterns, panel system
- `.planning/codebase/CONVENTIONS.md` — Naming, imports, component patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `task-board-panel.tsx` — Full task board with all functionality; the primary asset being embedded
- `CreateTaskModal` (inside task-board-panel) — Task creation form with project dropdown, assignee, tags, due date
- `EditTaskModal` (inside task-board-panel) — Task edit form including project reassignment dropdown
- `useProjectWorkspace()` — Context hook providing `project.id` for API filtering
- `useSmartPoll` — Smart polling hook used by the task board for data refresh
- SSE integration — Task board already responds to real-time task events

### Established Patterns
- Task board uses `projectFilter` state to filter by project; in workspace mode this becomes a fixed prop
- `activeProject` in Zustand store is set when entering workspace (Phase 2 D-02)
- Task board fetches from `GET /api/tasks?project_id={id}` — same filter used for project scoping
- Board initializes `projectFilter` from `activeProject` if present — this existing behavior partially solves the scoping

### Integration Points
- `src/components/project/tasks-view.tsx` — Replace stub with embedded board component
- `task-board-panel.tsx` — Needs to accept props for project scope mode (hide filter, pre-set project, hide project labels on cards)
- `CreateTaskModal` — Needs to accept default project ID prop
- `messages/*.json` — `project.tasks.*` i18n keys may need additions

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

*Phase: 04-project-tasks*
*Context gathered: 2026-04-13*
