# Phase 8: Projects Entry Point - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-14
**Phase:** 08-projects-entry-point
**Areas discussed:** Nav Slot, Card Info, Pickers, URL, Layout, Last-Activity Source, Click Target, Empty State

---

## Nav Slot

| Option | Description | Selected |
|--------|-------------|----------|
| Insert into 'core' group after Tasks (Recommended) | Treats ROADMAP 'OPERATE' as the unlabeled top group; add `projects` entry after `tasks`. No group rename. | |
| Insert into 'core' group before Tasks | Same group, Projects first — signals it's the primary entry for project-scoped work. | ✓ |
| Rename 'core' to 'OPERATE' and add Projects | Makes the group label visible and matches ROADMAP wording exactly. More invasive — touches 10 locale files. | |

**User's choice:** Insert into 'core' group before Tasks
**Notes:** ROADMAP said "near Tasks"; before-Tasks positioning treats Projects as the primary project-scoped entry. No locale churn.

---

## Card Info

| Option | Description | Selected |
|--------|-------------|----------|
| Deadline when present, else last-activity hint (Recommended) | Matches criterion #2 verbatim. Deadline preferred when set; fall back to derived last-activity. | ✓ |
| Always show both deadline and last-activity | More info per row; visual noise; requires last-activity even when deadline is set. | |
| Deadline only — omit last-activity | Simplest; projects without deadlines show nothing in that slot. | |

**User's choice:** Deadline when present, else last-activity hint
**Notes:** Matches ROADMAP wording exactly.

---

## Pickers

| Option | Description | Selected |
|--------|-------------|----------|
| Add small "↗ Open workspace" button next to each picker (Recommended) | Non-destructive — select keeps its filter role; sibling button routes to `/project/{slug}`. Disabled on 'All projects'. | ✓ |
| Make the picker's resolved project-name text clickable | Subtle; some users may not discover it. | |
| Both: clickable name AND explicit button | Maximum discoverability but more surface to maintain. | |

**User's choice:** "↗ Open workspace" button only
**Notes:** Single consistent affordance per picker.

---

## URL / Tab ID

| Option | Description | Selected |
|--------|-------------|----------|
| tab id 'projects', URL /projects (Recommended) | Plural, distinct from singular `/project/{slug}`. Matches convention of other panels. | ✓ |
| tab id 'project-list', URL /project-list | Extra-explicit, avoids perception of collision — but breaks one-word-per-panel convention. | |

**User's choice:** tab id `projects`, URL `/projects`
**Notes:** Convention over extra safety — `/project/{slug}` and `/projects` don't collide in the catch-all router.

---

## Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Vertical rows (Recommended) | One full-width row per project. Dense, scannable, matches task-board and agent-squad conventions. | ✓ |
| Grid of cards (2-3 columns responsive) | More visual. Wastes space for text-heavy info; less consistent with other panels. | |
| You decide | Claude picks. | |

**User's choice:** Vertical rows
**Notes:** Consistency with other panels.

---

## Last-Activity Source

| Option | Description | Selected |
|--------|-------------|----------|
| MAX(task.updated_at) grouped by project (Recommended) | Already queryable via tasks table. Simplest. Expose via new `last_activity_at` field on `GET /api/projects`. | ✓ |
| MAX across tasks, sessions, and comments | More accurate but requires joining multiple tables. Overkill for a list hint. | |
| project.updated_at if exists, else tasks | Depends on schema state; adds branching. | |

**User's choice:** MAX(task.updated_at)
**Notes:** MVP-appropriate; revisit if misleading in practice.

---

## Click Target

| Option | Description | Selected |
|--------|-------------|----------|
| Whole row navigates to /project/{slug} (Recommended) | Entire row is the affordance. Status badge + ticket prefix informational. Matches criterion #2 ("clicking an entry navigates"). | ✓ |
| Only an explicit "Open" button navigates | Clearer intent but adds visual weight; row stays inert. | |

**User's choice:** Whole row navigates
**Notes:** Keep ensure keyboard accessibility (enter/space, role=link).

---

## Empty State

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal message + link to create (Recommended) | "No active projects yet" + button that opens the existing project-manager modal (reuses task-board's Projects-button trigger). | ✓ |
| Message only — no action | Simplest; user has to find creation flow elsewhere. | |
| You decide | Claude picks. | |

**User's choice:** Minimal message + link to create
**Notes:** Reuse existing project-manager modal; do not duplicate creation flow.

---

## Claude's Discretion

- Tailwind class choices for row styling (match existing panels)
- ProjectsIcon glyph content (no icon libraries)
- Relative-time formatting helper (reuse existing)
- Status-badge visual (pill, tag, or `project.color`)
- Loading/skeleton UI while store hydrates
- Disabled-state styling for the picker button

## Deferred Ideas

- Archived/inactive projects view (v2)
- Search/filter on the list (deferred — list is short)
- Grid-of-cards alternate layout (rejected for v1)
- Last-activity aggregation from sessions/comments (MVP uses tasks only)
- Making picker option text directly clickable (rejected — single affordance preferred)
