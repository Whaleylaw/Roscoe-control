# Project Workspace & Dashboard

## What This Is

A full-takeover project workspace for Mission Control that elevates projects from a task-grouping label into a first-class destination. Users navigate into a project and get a dedicated dashboard with status overview, activity feed, and project brief — plus scoped views for tasks, agent sessions, agents, and settings. Breadcrumb navigation moves between projects and back to the main view.

v1.1 extends this workspace with native GSD lifecycle support: projects can be flagged `gsd_enabled`, move through Discuss → Plan → Execute → Verify → Done phases, and gate critical tasks behind operator/admin approval — eliminating the need to reach for the CLI to track phase state.

## Core Value

When I click into a project, I see everything about that project — what it is, what's happening, what's next — and I can manage all its work from one place, including driving it through its GSD lifecycle.

## Current Milestone: v1.1 Native GSD Integration

**Goal:** Build first-class GSD lifecycle support (Discuss → Plan → Execute → Verify → Done) directly into Mission Control so every project can be created, tracked, and executed through phases in one system.

**Target features:**
- GSD-aware project schema (`gsd_enabled`, `gsd_phase`, `gsd_track`, `gsd_gate_mode`) with lifecycle transitions
- Gate-required tasks that block in_progress/done without operator/admin approval
- Dedicated "Lifecycle" tab in the project workspace + phase badges on tasks in the task board
- External JSON template system for bootstrap task packs (`<DATA_DIR>/gsd-templates/*.json` with bundled default fallback)
- Three new API endpoints: bootstrap, transition, gate approval
- i18n coverage across all 10 locales for new UI strings

**Starting point:** Phase 09-CONTEXT.md already captures 38 locked implementation decisions (D-01..38) from `/gsd:discuss-phase 09`.

## Requirements

### Validated

- ✓ Projects exist as an entity with name, description, status — existing
- ✓ Tasks can be assigned to projects — existing
- ✓ Task board and task management UI — existing
- ✓ Agent and session management — existing
- ✓ Chat interface for agent sessions — existing
- ✓ Panel-based navigation with Zustand state — existing
- ✓ SSE real-time updates for data changes — existing
- ✓ REST API for all CRUD operations — existing

### Active

- [x] URL-driven project workspace routing (no Zustand dependency) — Validated in Phase 1: Foundation
- [x] Component architecture for project workspace (dedicated directory, multi-file) — Validated in Phase 1: Foundation
- [x] Database composite indexes for project-scoped queries — Validated in Phase 1: Foundation
- [x] i18n namespace for project workspace UI strings — Validated in Phase 1: Foundation
- [x] Full-takeover project workspace view when navigating into a project — Validated in Phase 2: Navigation
- [x] Breadcrumb navigation (Projects > Project Name > Sub-view) — Validated in Phase 2: Navigation
- [x] Project dashboard with status overview (active tasks, blocked items, progress) — Validated in Phase 3: Dashboard
- [x] Project dashboard with project brief (description, goals, key info) — Validated in Phase 3: Dashboard
- [x] Project dashboard with activity feed (recent task updates, agent activity) — Validated in Phase 3: Dashboard
- [x] Project-scoped task list showing only that project's tasks — Validated in Phase 4: Project Tasks
- [x] Create new tasks pre-scoped to the current project — Validated in Phase 4: Project Tasks
- [x] Reassign existing tasks into/out of the current project — Validated in Phase 4: Project Tasks
- [x] Project-scoped agent sessions view — Validated in Phase 5: Sessions & Agents
- [x] Project-scoped agents view — Validated in Phase 5: Sessions & Agents
- [x] Project settings (name, description, status, configuration) — Validated in Phase 6: Settings
- [ ] Project-level progress/completion indicators
- [x] Projects can be flagged for GSD-native tracking (`gsd_enabled`) — Validated in Phase 9: GSD Native Integration
- [x] Projects advance through Discuss → Plan → Execute → Verify → Done phases via in-app controls — Validated in Phase 9: GSD Native Integration
- [x] Tasks can be marked gate-required, blocking in_progress/done without operator approval — Validated in Phase 9: GSD Native Integration
- [x] Operators and admins can approve or reject gates from the UI and API — Validated in Phase 9: GSD Native Integration
- [x] Bootstrap endpoint creates default phase task packs idempotently — Validated in Phase 9: GSD Native Integration
- [x] Phase state is visible on the task board as per-task badges — Validated in Phase 9: GSD Native Integration
- [x] Project workspace exposes a dedicated Lifecycle tab — Validated in Phase 9: GSD Native Integration
- [x] Bootstrap templates loadable from external JSON files with bundled fallback — Validated in Phase 9: GSD Native Integration

### Out of Scope

- Project templates or cloning — complexity not needed for v1
- Project-level permissions/roles — existing auth roles are sufficient
- Gantt charts or timeline views — status overview is enough
- Cross-project dependency tracking — projects are independent for now
- Project archiving/deletion workflows — can use existing status changes

## Context

- Mission Control uses a single catch-all route (`src/app/[[...panel]]/page.tsx`) with Zustand state driving which panel renders. The project workspace will need to integrate with this routing pattern or extend it.
- Projects already exist in the database with basic fields. The data model may need expansion for dashboard metadata (progress tracking, activity aggregation).
- The existing panel system (`src/components/panels/`) has 35+ panels. The project workspace is a new panel that itself contains sub-views (dashboard, tasks, sessions, agents, settings).
- Real-time updates via SSE (`eventBus`) already push task and agent changes — the project dashboard can subscribe to project-scoped events.
- i18n support via `next-intl` means new UI strings need message file entries.

## Constraints

- **Stack**: Must use existing Next.js 16 / React 19 / TypeScript / Tailwind / Zustand stack
- **Routing**: Must work within the existing catch-all route and panel system
- **Database**: SQLite via better-sqlite3 — no ORM, prepared statements only
- **Icons**: No icon libraries — raw text/emoji per project conventions
- **i18n**: All user-facing strings must go through next-intl message files

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Full takeover view (not drawer/sidebar) | User wants project to feel like its own workspace, not a detail panel | — Pending |
| Breadcrumb navigation | Natural way to move between project context and main view | — Pending |
| All sub-views in v1 (tasks, sessions, agents, settings) | User wants the complete workspace experience, not incremental | — Pending |
| v1.1: GSD state stored in-DB only (no `.planning/` sync) | Avoids filesystem sync bugs; CLI stays the authoring surface, MC tracks approvals | Landed in Phase 9 (migration 052 adds `gsd_*` columns on projects/tasks; no FS sync) |
| v1.1: Operator+admin required for all GSD endpoints | Reuses existing MC role model; no new per-project approver table | Landed in Phase 9 (`requireRole(request, 'operator')` on bootstrap/transition/gate routes) |
| v1.1: External JSON templates with bundled default fallback | Flexibility for users without forcing code changes | Landed in Phase 9 (`loadGsdTemplate` resolves `<DATA_DIR>/gsd-templates/*.json` → `DEFAULT_TEMPLATE`) |
| v1.1: Dedicated Lifecycle tab (not just settings) + task badges | Discoverable where work happens; matches existing workspace tab pattern | Landed in Phase 9 (lifecycle-view + phase/gate badges on task cards) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-14 — Milestone v1.1 (Native GSD Integration) opened*
