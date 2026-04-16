# Project Workspace & Dashboard

## What This Is

A full-takeover project workspace for Mission Control that elevates projects from a task-grouping label into a first-class destination. Users navigate into a project and get a dedicated dashboard with status overview, activity feed, and project brief — plus scoped views for tasks, agent sessions, agents, and settings. Breadcrumb navigation moves between projects and back to the main view.

v1.1 extends this workspace with native GSD lifecycle support: projects can be flagged `gsd_enabled`, move through Discuss → Plan → Execute → Verify → Done phases, and gate critical tasks behind operator/admin approval.

Phase 10 extends that model again: a single project can now host multiple workstreams, milestones, phases, and plans concurrently, with the Lifecycle tab acting as the primary operator surface over the hierarchical graph.

## Core Value

When I click into a project, I see everything about that project — what it is, what's happening, what's next — and I can manage all its work from one place, including driving it through its GSD lifecycle.

## Current Milestone: v1.1 Native GSD Integration + Phase 10 Extension

**Goal:** Keep the native GSD lifecycle from v1.1, while removing the single-lifecycle-per-project bottleneck by adding first-class workstreams, milestones, phases, and plans inside one project.

**Target features:**
- GSD-aware project schema (`gsd_enabled`, `gsd_phase`, `gsd_track`, `gsd_gate_mode`) with lifecycle transitions
- Gate-required tasks that block in_progress/done without operator/admin approval
- Dedicated "Lifecycle" tab in the project workspace + phase badges on tasks in the task board
- External JSON template system for bootstrap task packs (`<DATA_DIR>/gsd-templates/*.json` with bundled default fallback)
- Three new API endpoints: bootstrap, transition, gate approval
- i18n coverage across all 10 locales for new UI strings
- Hierarchical GSD model inside one project: workstreams, milestones, phases, plans
- Graph-backed Lifecycle tab with inline create/edit/transition flows
- SSE-driven live refresh and readable conflict surfacing for hierarchy mutations
- First-class CLI wrappers for hierarchy CRUD, transitions, and lifecycle-graph reads
- Same-wave conflict analysis backed by task resource hints and plan transition blocking

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
- [x] One project can host multiple GSD workstreams concurrently — Implemented in Phase 10
- [x] One project can host multiple active milestones concurrently — Implemented in Phase 10
- [x] Milestones can contain ordered phases with dependency checks — Implemented in Phase 10
- [x] Phases can contain plan waves with plan dependency checks — Implemented in Phase 10
- [x] Lifecycle tab reads a hierarchical lifecycle graph with legacy fallback — Implemented in Phase 10
- [x] Lifecycle tab supports inline create/edit/complete/transition for hierarchy entities — Implemented in Phase 10
- [x] Lifecycle tab live-refreshes from project-scoped `gsd.*` SSE events — Implemented in Phase 10
- [x] OpenAPI and focused E2E/regression coverage for Phase 10 hierarchy — Implemented in Phase 10
- [x] CLI wrappers exist for Phase 10 workstreams, milestones, phases, plans, and lifecycle-graph reads — Implemented in Phase 10
- [x] Same-wave conflicts are counted in `rollups.wave_conflicts` and can block `plan -> in_progress` transitions — Implemented in Phase 10

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
| Phase 10: Keep project-level `gsd_phase` as legacy shell while hierarchy becomes primary model | Preserves backward compatibility and avoids forced migration of Phase 9 projects | Landed in Phase 10 (`/api/projects/:id/gsd/lifecycle-graph` returns both graph + legacy fallback metadata) |
| Phase 10: REST-first hierarchy surface before CLI parity | Keeps delivery moving while contracts stabilize; UI can ship immediately on top of canonical routes | Landed in Phase 10 (hierarchy routes + Lifecycle tab shipped first; CLI wrappers followed once contracts settled) |
| Phase 10: Optimistic locking on hierarchy mutations | Prevents silent overwrite races in the interactive Lifecycle tab | Landed in Phase 10 (`expected_updated_at` on PATCH/complete/transition routes) |
| Phase 10: No MCP parity in this phase | Operator explicitly chose CLI + REST plus conflict analysis, not a matching MCP tool surface | Landed in Phase 10 (CLI wrappers shipped; MCP parity intentionally deferred) |

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
*Last updated: 2026-04-16 — Phase 10 complete; hierarchy model/UI/OpenAPI/E2E/CLI/conflict analysis landed and verified*
