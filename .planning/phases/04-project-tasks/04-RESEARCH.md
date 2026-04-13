# Phase 4: Project Tasks - Research

**Researched:** 2026-04-13
**Domain:** Reuse-and-adapt integration of a large existing React component (task board) inside the project workspace shell
**Confidence:** HIGH

## Summary

Phase 4 is a **reuse-and-adapt phase**, not greenfield. The existing `src/components/panels/task-board-panel.tsx` (2527 lines) already implements every piece of functionality the phase requires — kanban, create/edit modals, detail modal, drag-and-drop, SSE reactivity, GitHub/GNAP/Aegis integration — and the API already supports project-scoped task filtering, creation, and reassignment (including ticket-number reallocation on project change). The API uses **PUT** `/api/tasks/[id]`, not PATCH (a gotcha the phase CONTEXT slightly misstates).

The task board already partially self-scopes: it reads `activeProject` from Zustand and seeds `projectFilter` from it (lines 400-402, 529-533). Phase 1/2 already set `activeProject` when a workspace loads (`project-context.tsx` line 44). So the board will *already* filter correctly when embedded — the phase work is about **hiding UI affordances** that are now redundant (project dropdown, project labels on cards) and **pre-filling the create modal** with a default project ID.

**Primary recommendation:** Add a single optional `scope?: TaskBoardScope` prop to `TaskBoardPanel`. The scope object carries four concerns: `lockedProjectId` (forces filter), `hideProjectFilter`, `hideProjectLabels`, `defaultCreateProjectId`. Default behavior (no `scope` prop) is identical to today — zero regression risk to global board. Then `tasks-view.tsx` becomes a ~15-line wrapper that builds the scope from `useProjectWorkspace()` and renders the board. Do **not** fork the component; do **not** extract pieces; do **not** introduce a wrapper modal layer.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Task Board Reuse Strategy**
- **D-01:** Embed the existing `task-board-panel.tsx` component inside the project workspace's `tasks-view.tsx`. The full kanban board with all 9 columns, drag-and-drop, Aegis approval gate, agent spawning, GitHub links, and project manager modal all work identically inside the project workspace.
- **D-02:** The task board component must accept a prop (e.g., `projectId` or `projectScope`) that pre-filters tasks to the current project. This replaces the user-selectable project filter dropdown.
- **D-03:** The project filter dropdown is **hidden** (not shown disabled) when the board is rendered inside a project workspace. The workspace breadcrumb already communicates the project context.
- **D-04:** Full feature parity with the global board — no features stripped out.

**Task Creation Flow**
- **D-05:** When creating a task from within the project workspace, the project field is **pre-filled with the current project but remains editable**. The user can change it to create a task for a different project if needed.
- **D-06:** The existing `CreateTaskModal` is reused. It receives the current project ID as a default value for the project dropdown.

**Reassignment UX**
- **D-07:** Task reassignment works exclusively through the existing **edit modal's project dropdown** — same as the global board. No new reassignment UI is needed.
- **D-08:** When a task is reassigned out of the current project, it **disappears immediately** from the board on the next re-fetch. No toast or confirmation.

**View Presentation**
- **D-09:** The project label/prefix on task cards is **hidden** when inside the project workspace since all tasks belong to the same project.
- **D-10:** All 9 status columns are **always visible**, even when empty.

### Claude's Discretion
- How to pass project scope into the task board component (prop interface design)
- Whether to use a wrapper component or direct prop modification on the existing board
- Loading state and error handling for the embedded board
- Any CSS adjustments needed for the board to fit within the workspace layout (breadcrumb + tabs above)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TASK-01 | Project workspace shows task list filtered to only that project's tasks | `GET /api/tasks?project_id=X` already exists (route.ts:78,108-111); `TaskBoardPanel` already seeds `projectFilter` from `activeProject` which Phase 1/2 set via `project-context.tsx:44`. Adding `scope.lockedProjectId` guarantees it stays locked even if `activeProject` is cleared mid-session. |
| TASK-02 | User can create new tasks pre-scoped to the current project | `CreateTaskModal` (line 2052) currently defaults `project_id` to `projects[0]?.id`. Adding an optional `defaultProjectId` prop and threading it through via `scope.defaultCreateProjectId` satisfies D-05/D-06. |
| TASK-03 | User can reassign existing tasks into or out of the current project | `EditTaskModal` (line 2316) already has the project dropdown and uses `task.project_id`. `PUT /api/tasks/[id]` already handles reassignment with ticket counter allocation (route.ts:186-215). No component changes needed — only verify the dropdown remains visible in workspace mode. |
| TASK-04 | Task list supports existing task board functionality (status changes, editing, etc.) | D-04 locks in full feature parity. Embedding the component (not forking) preserves all existing behavior by definition. |

## Standard Stack

**This is an integration phase — no new libraries are introduced.** The stack used by the existing task board is the stack Phase 4 uses.

### Already In Use (verified via source read)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.x | App Router, client components | Existing stack (CLAUDE.md) |
| React | 19.0.x | UI | Existing stack |
| next-intl | 4.8.x | i18n translations | FOUN-04 requires all user-facing strings go through message files |
| Zustand | 5.0.x | `useMissionControl` store (tasks, activeProject) | Task board already consumes it |
| better-sqlite3 | 12.6.x | Server-side SQLite (API layer only) | Existing |
| vitest | 2.1.x | Unit tests — wave-0 `it.todo()` scaffolds | Established Phase 1/2/3 pattern |
| @testing-library/react | 16.1.x | Component tests | Pre-existing |
| playwright | 1.51.x | E2E tests | Pre-existing; tests dir has `projects-crud.spec.ts`, `tasks-crud.spec.ts` |

**No new installs needed.** `pnpm install` is not part of this phase.

## Architecture Patterns

### Recommended Component Structure

```
src/components/project/tasks-view.tsx       # thin wrapper, builds scope, renders <TaskBoardPanel scope={...}/>
src/components/panels/task-board-panel.tsx  # existing — add optional scope prop
```

**No new subdirectory.** Everything goes through the scope prop threaded down to already-existing sub-components (`CreateTaskModal`, `EditTaskModal`, the card-rendering JSX at lines ~1003-1007 and ~1440).

### Pattern 1: Scope Prop (Single Optional Object)

**What:** One optional prop on `TaskBoardPanel` carrying all workspace-mode behavior. Default `undefined` preserves global-board behavior verbatim.

**When to use:** Every workspace-mode adaptation (D-01 through D-10) funnels through this one prop.

**Example:**
```typescript
// In task-board-panel.tsx, add above the component:
export interface TaskBoardScope {
  /** Lock the board to a single project_id; hides free selection. */
  lockedProjectId: number
  /** Hide the top-bar project filter dropdown. */
  hideProjectFilter?: boolean
  /** Hide the ticket_ref and project name on task cards. */
  hideProjectLabels?: boolean
  /** Default project_id in CreateTaskModal (user can still change). */
  defaultCreateProjectId?: number
}

export function TaskBoardPanel({ scope }: { scope?: TaskBoardScope } = {}) {
  // ...
  const [projectFilter, setProjectFilter] = useState<string>(
    scope?.lockedProjectId ? String(scope.lockedProjectId)
    : activeProject ? String(activeProject.id) : 'all'
  )

  // Suppress the activeProject sync effect when scope is locked:
  useEffect(() => {
    if (scope?.lockedProjectId) {
      setProjectFilter(String(scope.lockedProjectId))
      return
    }
    const newFilter = activeProject ? String(activeProject.id) : 'all'
    setProjectFilter(newFilter)
  }, [activeProject, scope?.lockedProjectId])

  // In the top-bar JSX (around line 801-817): conditionally render the <select>.
  // In CreateTaskModal call (line 1168): pass defaultProjectId={scope?.defaultCreateProjectId}
  // In the card render (lines 1003-1007, 1440): hide the ticket_ref span when scope?.hideProjectLabels
}
```

Then in `tasks-view.tsx`:
```typescript
'use client'
import { useProjectWorkspace } from '@/components/project/project-context'
import { TaskBoardPanel } from '@/components/panels/task-board-panel'

export function TasksView() {
  const { project } = useProjectWorkspace()
  if (!project) return null  // parent workspace shell handles loading/not-found
  return (
    <TaskBoardPanel
      scope={{
        lockedProjectId: project.id,
        hideProjectFilter: true,
        hideProjectLabels: true,
        defaultCreateProjectId: project.id,
      }}
    />
  )
}
```

### Pattern 2: Minimum Surface-Area Changes

**What:** Identify the exact line ranges in `task-board-panel.tsx` that need conditional rendering and change only those. Do not refactor surrounding code.

**Mapped change sites (verified by Grep/Read):**

| Concern | File | Lines | Change |
|---------|------|-------|--------|
| Accept prop | `task-board-panel.tsx` | 391 | Add `{ scope }: { scope?: TaskBoardScope } = {}` param |
| Seed filter | `task-board-panel.tsx` | 400-402 | Prefer `scope.lockedProjectId` |
| Activate-project sync effect | `task-board-panel.tsx` | 529-533 | Early-return when scope locked |
| Render filter dropdown | `task-board-panel.tsx` | 801-817 (the `<div className="relative">` + `<select>` + chevron) | Wrap in `{!scope?.hideProjectFilter && (…)}` |
| Card ticket_ref (column view) | `task-board-panel.tsx` | 1003-1007 | Wrap in `{!scope?.hideProjectLabels && task.ticket_ref && (…)}` |
| Card ticket_ref (detail modal) | `task-board-panel.tsx` | 1439-1441 | Keep visible in detail modal — decision call; recommend keeping for unambiguous identity. Confirm with planner. |
| Pass default to CreateTaskModal | `task-board-panel.tsx` | 1168-1174 | Add `defaultProjectId={scope?.defaultCreateProjectId}` |
| CreateTaskModal signature | `task-board-panel.tsx` | 2052-2072 | Accept `defaultProjectId?: number`; use in `useState` initial `project_id` |

### Anti-Patterns to Avoid

- **Forking the component:** Copy-pasting `task-board-panel.tsx` into a `project-task-board.tsx` is tempting for isolation but violates D-01 (reuse) and doubles maintenance. Reject.
- **Extracting sub-components:** "Let's pull `CreateTaskModal` out into its own file first" — this is a valid refactor but OUT OF SCOPE for Phase 4 and inflates risk. Defer.
- **Prop drilling primitives:** Passing `projectId` + `hideFilter` + `hideLabels` + `defaultProjectId` as four separate props bloats the call site and makes every future workspace-mode feature another prop. One `scope` object is cleaner.
- **Stripping features conditionally for workspace mode:** D-04 forbids this. The Projects button (line 820), GNAP sync badge (line 783), spawn form (line 823), ProjectManagerModal (line 1187) all stay visible.
- **New API endpoint:** The existing `/api/tasks?project_id=X` and `PUT /api/tasks/[id]` cover all four requirements. Do not propose a new endpoint.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Project-scoped task fetch | New `/api/projects/[id]/tasks` filter client | Existing `/api/tasks?project_id=X` | API already filters (route.ts:108-111); adding a parallel path duplicates validation, auth, mapping. |
| Task reassignment logic | New "reassign project" modal | Existing `EditTaskModal` project `<select>` | D-07 locks this in; API (route.ts:186-215) already allocates new ticket number on reassignment. |
| Kanban / drag-and-drop | New implementation | Existing board | 2500 lines of battle-tested logic including `detectAwaitingOwner` heuristic, Aegis gate, SSE dispatch. |
| SSE re-fetch on task events | New workspace-level subscription | Existing Zustand `tasks` array + `use-server-events.ts` dispatch (lines 102-122) | Store is auto-synced; `TaskBoardPanel` reads `storeTasks` which is already live. |
| Loading / error UI | New skeleton | Existing `loading` / `error` states in `TaskBoardPanel` | Already handles both; workspace shell (`project-workspace.tsx`) additionally shows project-level loading. |
| Ticket-number allocation | New counter logic | API PUT handler `nextProjectTicketNo` (route.ts:195-214) | Transactional, serverside — never replicate on client. |

**Key insight:** Phase 4's surface area is ~30 lines of code changes across two files plus test scaffolds and i18n stubs. The biggest risk is *scope creep* (refactoring the 2500-line component "while we're in there"). Resist.

## Runtime State Inventory

*(Not a rename/refactor/migration phase — no stored-state invalidation risk. Only a new prop plumbed through an existing component.)*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no schema change, no string-keyed identifiers being renamed. | None — verified by inspecting migrations and API routes. |
| Live service config | None — no external service names change. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None. | None. |
| Build artifacts | None — pure source edit. | None. |

## Common Pitfalls

### Pitfall 1: API uses PUT not PATCH
**What goes wrong:** Planner writes task referencing `PATCH /api/tasks/[id]` (phase description says "PATCH"); runtime returns 405.
**Why it happens:** The phase description (and many README references) say PATCH but the route only exports `GET`, `PUT`, `DELETE` (verified — `/src/app/api/tasks/[id]/route.ts` lines 45, 87, 412).
**How to avoid:** Plans and task actions must say **PUT /api/tasks/[id]**. `EditTaskModal` already calls PUT (line ~2360 in `handleSubmit`). The planner must not introduce a new PATCH call.
**Warning signs:** Any plan text or test code mentioning `fetch('/api/tasks/...', { method: 'PATCH' })`.

### Pitfall 2: `activeProject` race at workspace unmount
**What goes wrong:** `project-context.tsx:83` clears `activeProject` on unmount. If `TaskBoardPanel` still renders during unmount, its line 529-533 effect resets `projectFilter` to `'all'` and flashes all tasks.
**Why it happens:** Render order of unmount is not guaranteed; board's effect can fire after context's cleanup.
**How to avoid:** `scope.lockedProjectId` bypasses the `activeProject` sync (per the Pattern 1 example effect). The board never falls back to `'all'` while scoped.
**Warning signs:** E2E test sees "all tasks" flash when clicking away from the workspace; unit test failing because filter resets.

### Pitfall 3: CreateTaskModal clobbers default when `projects` fetch is slow
**What goes wrong:** Modal opens before `projects` array is populated (fetch in parent still in-flight); `useState` initializer evaluates `projects[0]?.id` as `''`, ignoring the `defaultProjectId` intended for workspace mode.
**Why it happens:** `useState` only runs the initializer once. If `defaultProjectId` arrives via prop after first render, the form doesn't update.
**How to avoid:** In `CreateTaskModal` init, write `defaultProjectId ? String(defaultProjectId) : (projects[0]?.id ? String(projects[0].id) : '')`. Do NOT add a `useEffect` that resets on `defaultProjectId` change (would overwrite user edits).
**Warning signs:** Unit test: "creating task from workspace assigns to current project" fails intermittently.

### Pitfall 4: `ticket_ref` in detail modal also hidden
**What goes wrong:** A single `hideProjectLabels` that also hides the detail modal's ticket ref (line 1440) removes task identity ("what ticket am I looking at?").
**Why it happens:** Over-eager boolean. The card label and the detail header serve different purposes.
**How to avoid:** `hideProjectLabels` should apply to the card (line 1003-1007) only. Keep the detail modal ticket_ref visible. Surface this distinction in the plan so both sites are explicitly addressed.
**Warning signs:** User opens a task in the workspace and can't tell which ticket number it is.

### Pitfall 5: E2E/Playwright timing — task disappears on reassign-out
**What goes wrong:** D-08 says task "disappears on next re-fetch" — but re-fetch is debounced by `useSmartPoll` (30s) and SSE carries `task.updated`, not `task.project_changed`. The store updates the task in-place, but the board filter doesn't re-evaluate until a re-render.
**Why it happens:** `tasks` derived from store updates on SSE, but `tasksByStatus` recomputes each render from `tasks`. Since the `project_id` field updates on the task, the filtered fetch on next call will exclude it — but the SSE-updated task is still in `storeTasks` with the new `project_id`.
**How to avoid:** When scope is locked, derive displayed tasks locally: `tasks.filter(t => t.project_id === scope.lockedProjectId)`. This guarantees reassign-out hides immediately.
**Warning signs:** Task reassigned to another project remains visible on the workspace board until refresh.

### Pitfall 6: i18n across 10 locales
**What goes wrong:** New `project.tasks.*` keys added only in `en.json`; next-intl throws `MISSING_MESSAGE` in other locales.
**Why it happens:** FOUN-04 and Phase 1/2/3 precedent require all 10 locale files updated in lockstep.
**How to avoid:** Every new key gets added to `messages/{ar,de,en,es,fr,ja,ko,pt,ru,zh}.json`. Phase 1 added placeholder English text in non-English files — follow that precedent.
**Warning signs:** `i18n-coverage.test.tsx` test (already exists in `src/components/project/__tests__/`) fails.

## Code Examples

### Example: Conditional render of filter dropdown
```typescript
// Source: /src/components/panels/task-board-panel.tsx lines 801-817 (current)
// Change: wrap in conditional
{!scope?.hideProjectFilter && (
  <div className="relative">
    <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} ...>
      <option value="all">{t('allProjects')}</option>
      {projects.map(project => (
        <option key={project.id} value={String(project.id)}>
          {project.name} ({project.ticket_prefix})
        </option>
      ))}
    </select>
    <svg .../>
  </div>
)}
```

### Example: Scoped task filter (pitfall 5 defense)
```typescript
// Source: /src/components/panels/task-board-panel.tsx around line 441
const tasks: Task[] = storeTasks
  .filter(t => !scope?.lockedProjectId || t.project_id === scope.lockedProjectId)
  .map(t => ({ ...t, aegisApproved: Boolean(aegisMap[t.id]) }))
```

### Example: CreateTaskModal default
```typescript
// Source: /src/components/panels/task-board-panel.tsx line 2052-2072 (current signature + useState)
function CreateTaskModal({
  agents, projects, onClose, onCreated,
  defaultProjectId,   // NEW
}: {
  agents: Agent[]; projects: Project[];
  onClose: () => void; onCreated: () => void;
  defaultProjectId?: number;   // NEW
}) {
  const [formData, setFormData] = useState({
    // ...
    project_id:
      defaultProjectId ? String(defaultProjectId)
      : (projects[0]?.id ? String(projects[0].id) : ''),
    // ...
  })
```

### Example: tasks-view.tsx replacement
```typescript
// Source: replaces current 16-line stub at /src/components/project/tasks-view.tsx
'use client'

import { useProjectWorkspace } from '@/components/project/project-context'
import { TaskBoardPanel } from '@/components/panels/task-board-panel'

export function TasksView() {
  const { project } = useProjectWorkspace()
  if (!project) return null
  return (
    <TaskBoardPanel
      scope={{
        lockedProjectId: project.id,
        hideProjectFilter: true,
        hideProjectLabels: true,
        defaultCreateProjectId: project.id,
      }}
    />
  )
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TasksView stub placeholder | Embedded TaskBoardPanel with scope prop | Phase 4 (this) | Replaces 16-line stub with ~15-line wrapper. |
| Global-board-only rendering | Scoped mode via optional prop | Phase 4 | Additive change; no regression risk to global board when prop omitted. |
| Separate `project_filter` dropdown as the only scoping mechanism | Scope prop takes precedence when present | Phase 4 | Existing UX (global board dropdown) unchanged. |

## Open Questions

1. **Detail modal ticket_ref in workspace mode — hide or show?**
   - What we know: D-09 says "project label/prefix on task cards" is hidden; the card context is lines 1003-1007. Detail modal at line 1440 shows the same ticket_ref in a different context.
   - What's unclear: Whether "cards" in D-09 includes the detail modal.
   - Recommendation: **Keep visible in detail modal.** The ticket_ref is the unambiguous task identifier; removing it from the detail view loses identity. Surface to planner as an explicit choice; one-line change either way.

2. **Should `TasksView` wait for `project` via loading gate?**
   - What we know: `project-workspace.tsx` already has a top-level loading gate (lines 16-28) and a not-found gate (lines 30-43). By the time `TasksView` renders, `project` is guaranteed non-null.
   - What's unclear: Nothing — the null-check in the example is defensive but can be an assertion.
   - Recommendation: Use `if (!project) return null` as a defensive no-op. No spinner needed.

3. **Does `useSmartPoll` need to re-key on scope change?**
   - What we know: `fetchData` is keyed to `projectFilter`; changing projects within workspace is not a valid UX (you'd navigate to a different project URL, which unmounts this tree).
   - What's unclear: Nothing — URL change triggers unmount/remount.
   - Recommendation: No change. Existing `useCallback` dependency on `projectFilter` handles the only scenario.

## Environment Availability

*(Skipped — no new external dependencies. All existing: Node 22+, pnpm, vitest, playwright, better-sqlite3 — all verified in use by Phases 1-3.)*

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.1.x (unit) + Playwright 1.51.x (E2E) |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `pnpm vitest run src/components/project/__tests__/tasks-view.test.tsx` |
| Full suite command | `pnpm test` (vitest) + `pnpm test:e2e` (playwright) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TASK-01 | Tasks filtered to current project | unit (component) | `pnpm vitest run src/components/project/__tests__/tasks-view.test.tsx -t "TASK-01"` | ❌ Wave 0 creates |
| TASK-01 | Board hides project filter dropdown in workspace mode | unit | same file, `-t "hides filter"` | ❌ Wave 0 creates |
| TASK-01 | Card project label hidden in workspace mode | unit | same file, `-t "hides ticket_ref on card"` | ❌ Wave 0 creates |
| TASK-02 | CreateTaskModal defaults project to workspace project | unit (modal) | `pnpm vitest run src/components/panels/__tests__/task-board-panel.test.tsx -t "TASK-02"` | ❌ Wave 0 creates |
| TASK-02 | Submit calls `POST /api/tasks` with project_id | unit (fetch mock) | same | ❌ Wave 0 creates |
| TASK-03 | EditTaskModal project dropdown present and functional | unit | same file, `-t "TASK-03"` | ❌ Wave 0 creates |
| TASK-03 | PUT /api/tasks/[id] with project_id change reallocates ticket number | integration | existing `tests/tasks-crud.spec.ts` — verify coverage, extend if missing | ✅ partial (tests/tasks-crud.spec.ts) |
| TASK-03 | Reassigned-out task disappears from workspace board | unit | same file, `-t "reassigns out disappears"` | ❌ Wave 0 creates |
| TASK-04 | Status drag-and-drop still works | manual + E2E smoke | `pnpm test:e2e tests/project-tasks.spec.ts` | ❌ Wave 0 creates scaffold |
| TASK-04 | Edit, Delete, Aegis approval paths intact | E2E | same | ❌ Wave 0 creates scaffold |
| TASK-04 | Full feature parity — Projects button, Spawn, GNAP badge all render | unit | `-t "TASK-04 feature parity"` | ❌ Wave 0 creates |

### Sampling Rate
- **Per task commit:** `pnpm vitest run src/components/project/__tests__/tasks-view.test.tsx src/components/panels/__tests__/task-board-panel.test.tsx`
- **Per wave merge:** `pnpm test` (full vitest) + typecheck (`pnpm typecheck`) + lint (`pnpm lint`)
- **Phase gate:** Full `pnpm test:all` (lint + typecheck + test + build + e2e) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/components/project/__tests__/tasks-view.test.tsx` — covers TASK-01, TASK-03 (filter, reassign-out), TASK-04 parity at integration level. Follow Phase 1/2/3 `it.todo()` scaffold pattern verified in `src/components/project/__tests__/dashboard-view.test.tsx`.
- [ ] `src/components/panels/__tests__/task-board-panel.test.tsx` — NEW file covering scope prop behavior. `it.todo()` stubs for: scope default undefined = current behavior; scope.lockedProjectId filters; scope.hideProjectFilter removes dropdown; scope.defaultCreateProjectId pre-fills create modal; scope.hideProjectLabels hides card ticket_ref.
- [ ] `tests/project-tasks.spec.ts` — Playwright E2E smoke covering TASK-02 (create task in workspace → appears in list with correct project) and TASK-03 (reassign via edit modal → disappears). Pattern: existing `tests/tasks-crud.spec.ts`, `tests/projects-crud.spec.ts`.

*(Follow the established pattern: `it.todo()` only in wave-0; actual test bodies filled in the implementation wave.)*

## Project Constraints (from CLAUDE.md)

- **Package manager:** pnpm only (no npm/yarn). Any plan that emits `npm install` is invalid.
- **Icons:** No icon libraries — text/emoji only. Task board already complies (inline SVG where needed, no icon lib).
- **i18n:** All user-facing strings via next-intl message files — applies to any new keys added (e.g., `project.tasks.title` already exists; no workspace-specific task board keys appear needed since the board uses its own `taskBoard` namespace which already has all strings).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, etc.). **No AI attribution** (no `Co-Authored-By`) — overrides the GSD default footer.
- **Stack:** Must use existing Next.js 16 / React 19 / TS / Tailwind / Zustand stack — satisfied (no new deps).
- **Database:** SQLite via better-sqlite3 — no ORM, prepared statements only. (Not applicable: no schema change.)
- **GSD workflow enforcement:** Edits go through GSD commands. Phase 4 is already inside `/gsd:plan-phase`.

## Sources

### Primary (HIGH confidence)
- `/src/components/panels/task-board-panel.tsx` lines 1-100, 380-580, 780-840, 990-1020, 1140-1200, 1400-1460, 2050-2470 — direct read of existing implementation
- `/src/app/api/tasks/route.ts` lines 1-425 — GET filter, POST create, PUT bulk (verified PUT for `/api/tasks/[id]`)
- `/src/app/api/tasks/[id]/route.ts` lines 1-475 — GET, **PUT**, DELETE (confirmed no PATCH); lines 186-215 verify project_id change triggers ticket_counter reallocation
- `/src/components/project/project-context.tsx` lines 1-105 — `useProjectWorkspace`, `activeProject` management, unmount cleanup
- `/src/components/project/project-workspace.tsx` lines 1-65 — loading and not-found gates already present
- `/src/components/project/project-view-router.tsx` — confirms `TasksView` is the render target
- `/src/components/project/tasks-view.tsx` lines 1-16 — current stub
- `/src/lib/use-server-events.ts` lines 80-160 — SSE dispatch table; task events already update Zustand store
- `/src/lib/validation.ts` lines 34-56 — `createTaskSchema`, `updateTaskSchema` (partial); `project_id` accepted as optional int
- `/messages/en.json` lines 742-830, 2200-2256 — existing `taskBoard` and `project` namespaces; no new `project.tasks.*` keys needed beyond current
- `/.planning/phases/03-project-dashboard/03-00-PLAN.md` — Wave 0 `it.todo()` scaffold pattern
- `/src/components/project/__tests__/dashboard-view.test.tsx` — concrete example of Wave 0 scaffold format
- `/tests/` directory listing — `tasks-crud.spec.ts`, `projects-crud.spec.ts`, `task-regression.spec.ts` already exist
- `/.planning/config.json` — `workflow.nyquist_validation: true` → Validation Architecture section required
- `/package.json` — confirmed commands: `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`

### Secondary (MEDIUM confidence)
- CLAUDE.md project instructions (loaded via context reminder) — explicit pnpm, no icon libraries, no AI attribution

### Tertiary (LOW confidence)
- None — all findings are source-code verified.

## Metadata

**Confidence breakdown:**
- Prop interface design: HIGH — validated against actual code-read of every mentioned line range.
- API contracts: HIGH — routes directly read; PUT vs PATCH confirmed.
- Pitfalls: HIGH — each pitfall references an exact file/line pair.
- Wave 0 test pattern: HIGH — matches existing `dashboard-view.test.tsx` precedent.
- i18n key needs: HIGH — the task board uses its own `taskBoard` namespace already; the workspace-tab `project.tasks.title` already exists and is reusable. No new i18n keys strictly required; the planner may opt to add a workspace-specific title override, which would be 10 lines × 10 locales = 10 trivial edits.

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (30 days — stack is stable; external libraries not changing)
