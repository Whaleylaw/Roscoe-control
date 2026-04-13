# Phase 4: Project Tasks - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 04-project-tasks
**Areas discussed:** Task board reuse strategy, Task creation flow, Reassignment UX, View presentation

---

## Task Board Reuse Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Embed the full board | Render existing task-board-panel inside workspace, pre-filtered to current project. Reuses all functionality with zero duplication. | ✓ |
| Extract shared components | Refactor task-board-panel into smaller pieces that both global and project views import. More work upfront. | |
| Build simpler scoped view | New lighter task list for project workspace. Simpler but duplicates logic. | |

**User's choice:** Embed the full board
**Notes:** Full feature parity — Aegis approval, agent spawning, GitHub links, project manager modal all work identically.

### Follow-up: Filter UI

| Option | Description | Selected |
|--------|-------------|----------|
| Hidden | Remove project filter entirely — context is obvious from workspace breadcrumb. | ✓ |
| Visible but locked | Show project name in filter dropdown but non-interactive. | |
| You decide | Claude picks based on component structure. | |

**User's choice:** Hidden

### Follow-up: Feature Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Keep everything | All features work identically — full parity with global board. | ✓ |
| Strip agent spawning | Remove spawn sub-agent form from project view. | |
| Strip extras | Only keep core task management. Remove Aegis, agent spawning, project manager. | |

**User's choice:** Keep everything

---

## Task Creation Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-filled, editable | Project defaults to current but user can change it. | ✓ |
| Pre-filled, locked | Project shown but cannot be changed. | |
| Hidden, auto-assigned | Project field hidden, silently assigned. | |

**User's choice:** Pre-filled, editable
**Notes:** Convenient default without being restrictive — sometimes you're in one project and want to quickly create a task for another.

---

## Reassignment UX

| Option | Description | Selected |
|--------|-------------|----------|
| Edit modal only | Reassignment through existing edit modal's project dropdown. No new UI. | ✓ |
| Quick-action on task card | Small "Move to project..." action on each card or context menu. | |
| Bulk reassign toolbar | Select multiple tasks and reassign via toolbar action. | |

**User's choice:** Edit modal only

### Follow-up: Disappearance Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Disappear immediately | Task vanishes from board on save. Clean and consistent. | ✓ |
| Toast notification | Task disappears with brief toast "Task moved to [Project Name]". | |
| You decide | Claude picks based on existing board behavior. | |

**User's choice:** Disappear immediately

---

## View Presentation

### Card Labels

| Option | Description | Selected |
|--------|-------------|----------|
| Hide project label | Remove project name/prefix from task cards in workspace. Reduces noise. | ✓ |
| Keep project label | Show project label on every card as-is. Consistent but redundant. | |
| You decide | Claude picks based on card layout. | |

**User's choice:** Hide project label

### Empty Columns

| Option | Description | Selected |
|--------|-------------|----------|
| Show all columns | All 9 status columns always visible, even if empty. | ✓ |
| Hide empty columns | Only show columns that have tasks. | |
| You decide | Claude picks based on existing board behavior. | |

**User's choice:** Show all columns

---

## Claude's Discretion

- Prop interface design for passing project scope into the task board component
- Wrapper component vs. direct prop modification approach
- Loading state and error handling for embedded board
- CSS adjustments for board within workspace layout
- Whether to use a wrapper component or direct prop modification

## Deferred Ideas

None — discussion stayed within phase scope.
