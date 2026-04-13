# Phase 2: Navigation & Workspace Shell - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 02-navigation-workspace-shell
**Areas discussed:** Workspace entry point, Breadcrumb design, Sub-view tab navigation, Workspace chrome behavior
**Mode:** Auto (all areas auto-selected, recommended defaults chosen)

---

## Workspace Entry Point

| Option | Description | Selected |
|--------|-------------|----------|
| Click project row in existing list | Navigate via router.push('/project/{slug}') following useNavigateToPanel pattern | ✓ |
| Add dedicated "Projects" nav rail item | New nav rail entry that opens project list | |
| Project cards in overview dashboard | Show project cards on the overview page for quick access | |

**User's choice:** [auto] Click project row in existing list (recommended default)
**Notes:** Follows existing navigation patterns. activeProject in Zustand set on entry for global components.

---

## Breadcrumb Design

| Option | Description | Selected |
|--------|-------------|----------|
| Horizontal text breadcrumb with > separator | "Projects > Name > View" at top of workspace, all segments clickable | ✓ |
| Slash-separated path | "/projects/name/view" style matching URL | |
| Back arrow + title | Single back button with current context title | |

**User's choice:** [auto] Horizontal text breadcrumb with > separator (recommended default)
**Notes:** Text-only per no icon libraries constraint. Each segment is a link.

---

## Sub-view Tab Navigation

| Option | Description | Selected |
|--------|-------------|----------|
| Horizontal tab bar below breadcrumb | 5 tabs (Dashboard, Tasks, Sessions, Agents, Settings), active tab highlighted | ✓ |
| Vertical sidebar navigation | Sidebar with view links inside the workspace | |
| Dropdown/select menu | Compact view selector for narrow layouts | |

**User's choice:** [auto] Horizontal tab bar below breadcrumb (recommended default)
**Notes:** Tabs use router.push for URL updates. Labels from project.nav i18n namespace.

---

## Workspace Chrome Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Nav rail + header stay, content area replaced | Workspace only takes over the main content area | ✓ |
| Full takeover (hide nav rail) | Workspace fills entire viewport, nav rail hidden | |
| Overlay/modal approach | Workspace as a full-screen overlay above the main UI | |

**User's choice:** [auto] Nav rail + header stay, content area replaced (recommended default)
**Notes:** Consistent with existing catch-all route integration from Phase 1.

---

## Claude's Discretion

- Loading state design while project data is being fetched
- Exact Tailwind styling for breadcrumb and tab bar
- Whether to add "Projects" to nav rail
- Tab bar responsive behavior

## Deferred Ideas

None — auto-mode stayed within phase scope.
