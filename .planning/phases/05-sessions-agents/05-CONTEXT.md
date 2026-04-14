# Phase 5: Sessions & Agents - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Scoped views inside the project workspace that show (a) the agent sessions associated with the current project and (b) the agents assigned to or currently working on it, plus the ability to open a session's detail view without leaving the project workspace.

Two concepts live in the Sessions view:
1. **Project-agent chat threads** — one persistent conversation per (assigned agent, project). Auto-created on first access so users can always "talk to the agent in the context of this project."
2. **External runtime sessions** — Claude/Codex/Hermes/gateway sessions that link to this project via `task_id → tasks.project_id`. Displayed alongside the chat threads so the user sees everything relevant.

The Agents view lists agents explicitly assigned to this project PLUS agents currently working on tasks in this project (task-derived), with both kinds shown together and a subtle badge distinguishing them.

</domain>

<decisions>
## Implementation Decisions

### Scoping Source

**Agents (SESS-02)**
- **D-01:** Agents list for the workspace = **union of (explicit `project_agent_assignments` for this project.id) + (agents whose name appears as `agent` on any task with `project_id` = this project)**. This matches SESS-02 "assigned to or currently working on."
- **D-02:** Show both explicit-assigned and task-derived agents in a single list, with a subtle "assigned" chip/badge on explicit assignments so the distinction is visible without two separate sections.
- **D-03:** Deduplicate by agent name — an agent that is both explicitly assigned and working on tasks appears once (the "assigned" badge takes precedence).

**Sessions (SESS-01)**
- **D-04:** Introduce a new concept: **project-agent chat threads** — one persistent session per `(agent_id, project_id)` pair. Every agent explicitly assigned to the project has (or auto-gets) exactly one chat thread for that project. Opening an assigned agent's session always returns to the same conversation.
- **D-05:** Sessions tab ALSO keeps external runtime sessions visible (Claude/Codex/Hermes/gateway sessions), filtered to the current project via the owning task's `project_id`. These are displayed as a second section below the chat threads.
- **D-06:** Auto-create-on-first-access: the first time a user opens the Sessions tab, any assigned agent missing a project-agent chat thread gets one lazily created. No manual "Start session" button in Phase 5.

### Filter Location
- **D-07:** Server-side filtering. Add `?project_id=` query param to `GET /api/sessions` and `GET /api/agents`. Matches the Phase 4 precedent (`GET /api/tasks?project_id=X`). The existing `/api/sessions` aggregates gateway + local runtime sessions and currently has no project filter — this phase adds it.
- **D-08:** A new endpoint (or extension of `/api/sessions`) returns project-agent chat threads. Naming and route shape are Claude's discretion; the planner + researcher decide based on existing session chat/message schema.

### Session Detail UX (SESS-03)
- **D-09:** Nested route: `/project/{slug}/sessions/{sessionId}`. The workspace shell (breadcrumb + tabs) stays mounted; only the Sessions content area swaps from list view to detail view. Deep-linkable and consistent with Phase 2 URL-driven routing.
- **D-10:** Reuse the existing `src/components/panels/session-details-panel.tsx` (741 lines) for the detail view via a `scope`-style prop (Phase 4 pattern). The panel already renders transcript + metadata — no new detail component.
- **D-11:** Project-agent chat threads use the SAME `session-details-panel` component. Treat a project-agent thread as a session variant the panel can render. Don't fork a separate chat UI for Phase 5.

### View Composition

**Agents View**
- **D-12:** Embed the existing `src/components/panels/agent-squad-panel.tsx` (652 lines) inside `src/components/project/agents-view.tsx` via a `scope` prop (Phase 4 pattern). Pass `{ projectId, hideProjectFilter: true, /* any other workspace-mode flags */ }`. Full feature parity with the global agent squad.
- **D-13:** Inside the embedded squad panel (in scope mode), each agent card must show: **name + role + status + assignment badge ("assigned" vs task-derived) + active task count for this project**. Click-through to the existing agent detail flow is preserved.

**Sessions View**
- **D-14:** Build a NEW scoped list component in `src/components/project/sessions-view.tsx` (replacing the stub) — no existing panel fits a "sessions list." Layout is a two-section list:
  - **Section 1: Chat threads** — one row per assigned agent's project-agent chat thread.
  - **Section 2: External runtime sessions** — rows for Claude/Codex/Hermes/gateway sessions linked to this project via `task_id → project_id`.

### List Content

**Chat thread row (Section 1)**
- **D-15:** Each row shows: agent name, status dot (idle/busy/offline), one-line last message preview, relative timestamp ("3m ago"). Row click → navigate to `/project/{slug}/sessions/{threadId}`.

**External runtime session row (Section 2)**
- **D-16:** Each row shows: runtime-type badge (`Claude` / `Codex` / `Hermes` / `Gateway`), linked task ticket_ref, started-at timestamp, running/finished status. Row click → navigate to `/project/{slug}/sessions/{sessionId}` (reuses the same detail route).

**Agent card (Agents tab)**
- **D-17:** Agent card fields: name, role, status, assignment badge ("assigned" chip for explicit assignments), active task count for this project. Clicking the card opens the existing agent detail flow (no workspace-specific adaptation required).

### Empty States
- **D-18:** Sessions empty: friendly message + CTA — "No sessions yet — assign an agent to start." with a link/tab-switch to the Agents tab.
- **D-19:** Agents empty: friendly message + CTA — "No agents assigned — assign one from the main Agents view." with a link back to the main `/agents` panel. Do NOT hide the tab when empty — keep the workspace shell consistent.

### Real-time Updates
- **D-20:** Follow the Phase 3/4 SSE pattern. Both views subscribe via the existing `useServerEvents` / Zustand store. Events that change project-agent assignment, session state, or task-agent linkage trigger re-fetch/re-derive of the scoped lists. Specific event types are Claude's discretion based on the existing event bus.

### Claude's Discretion
- Exact schema for project-agent chat threads (new table, extension of existing messages/sessions table, etc.) — researcher will survey existing chat/message storage first
- Route shape for the thread detail endpoint (`/api/sessions/[id]` extension vs new route)
- Prop interface for `AgentSquadPanel` scope — follow the Phase 4 `TaskBoardScope` single-object shape
- CSS adjustments for embedded panels to fit inside the workspace (breadcrumb + tabs above)
- Loading and error states for scoped views
- Which SSE event types to subscribe to (likely `agent.*`, `session.*`, `task.*` subset)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning
- `.planning/PROJECT.md` — Core value statement, constraints, evolution log
- `.planning/REQUIREMENTS.md` — SESS-01, SESS-02, SESS-03 with acceptance criteria
- `.planning/ROADMAP.md` — Phase 5 goal, success criteria

### Prior Phase Context (establish patterns reused here)
- `.planning/phases/01-foundation/01-CONTEXT.md` — URL routing decisions, component directory layout, i18n namespace
- `.planning/phases/02-navigation-workspace-shell/02-CONTEXT.md` — Workspace shell, breadcrumb, tabs, data fetching
- `.planning/phases/03-project-dashboard/03-CONTEXT.md` — SSE real-time update patterns
- `.planning/phases/04-project-tasks/04-CONTEXT.md` — **Key pattern: scope-prop embed of a global panel (TaskBoardScope) — this phase applies the same approach to agent-squad-panel and session-details-panel**
- `.planning/phases/04-project-tasks/04-RESEARCH.md` — Research template for the scope-prop pattern and minimum-surface-area edits

### Key Source Files (Views to Build/Replace)
- `src/components/project/sessions-view.tsx` — 16-line stub to replace with two-section scoped list
- `src/components/project/agents-view.tsx` — 16-line stub to replace with embedded agent-squad
- `src/components/project/project-context.tsx` — `useProjectWorkspace()` context hook providing `project` (id, slug, name)
- `src/components/project/project-view-router.tsx` — routes tab → view components
- `src/components/project/project-workspace.tsx` — workspace shell with breadcrumb + tabs

### Key Source Files (Panels to Embed)
- `src/components/panels/agent-squad-panel.tsx` — 652-line global agent grid; target for `scope`-prop embed (per D-12/D-13)
- `src/components/panels/session-details-panel.tsx` — 741-line session detail; target for `scope`-prop embed for detail view (per D-10/D-11)
- `src/components/panels/agent-detail-tabs.tsx` — 2951-line agent detail flow; reached via click-through from agents-view (per D-17)

### API & Data
- `src/app/api/sessions/route.ts` — GET aggregates gateway + local (Claude/Codex/Hermes); needs `?project_id=` (D-07)
- `src/app/api/agents/route.ts` — GET agents; needs `?project_id=` with the assignments-OR-task-derived union (D-01, D-07)
- `src/lib/sessions.ts` — gateway session logic
- `src/lib/claude-sessions.ts`, `src/lib/codex-sessions.ts`, `src/lib/hermes-sessions.ts` — local runtime session scanners
- `src/lib/schema.sql` line 22 (`agents` table) — no project_id column; association is via `project_agent_assignments`
- `src/lib/migrations.ts` line 824 (`project_agent_assignments` table definition + indexes) — explicit agent-to-project assignment source
- `src/lib/migrations.ts` line 707 (`tasks.project_id` column + index) — task-derived scoping source

### Codebase Architecture
- `.planning/codebase/ARCHITECTURE.md` — data flow, SSE patterns, panel system
- `.planning/codebase/CONVENTIONS.md` — naming, imports, component patterns

### Project Instructions
- `./CLAUDE.md` — pnpm only, no icon libraries, next-intl for all user-facing strings, Conventional Commits **without** AI attribution, path alias `@/*` → `./src/*`, SQLite via better-sqlite3 (no ORM; prepared statements only)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `agent-squad-panel.tsx` (652 lines) — full agent grid with status, activity, click-through. Embed target for Agents view (D-12).
- `session-details-panel.tsx` (741 lines) — session detail with transcript, metadata, actions. Embed target for session detail route (D-10, D-11).
- `agent-detail-tabs.tsx` (2951 lines) — agent detail landing reached from agent cards.
- `project_agent_assignments` table — explicit many-to-many join (D-01).
- `project-context.tsx` `useProjectWorkspace()` — provides `project.id` and `slug` for scoping.
- `useSmartPoll` + SSE dispatch via Zustand store — already live for Tasks/Dashboard; reuse for Sessions/Agents (D-20).
- Phase 4 `TaskBoardScope` interface pattern — template for `AgentSquadScope` and `SessionDetailScope` prop shapes.

### Established Patterns
- Global panels get a `scope` prop (optional, default = current behavior) to adapt for workspace mode without forking.
- Server-side filtering via `?project_id=` query param on REST routes.
- Workspace-mode variants hide redundant affordances (project filter dropdowns, project labels) when context is already communicated by the breadcrumb.
- New views replace stubs at `src/components/project/*-view.tsx`.

### Integration Points
- `src/app/api/sessions/route.ts` — needs `?project_id=` parsing and filter logic for both gateway and local sessions.
- `src/app/api/agents/route.ts` — needs `?project_id=` parsing with the assignments-OR-task-derived union.
- Schema: **likely needs a new table OR extension** to persist project-agent chat threads (D-04). Researcher must survey existing chat/message storage (e.g., `src/app/api/sessions/send/`, `src/app/api/sessions/[id]/`) before proposing schema changes. Wave 0 should scaffold any new table via a migration in `src/lib/migrations.ts`.
- `project-view-router.tsx` — route config may need a nested `/sessions/{sessionId}` leaf.
- `messages/{ar,de,en,es,fr,ja,ko,pt,ru,zh}.json` — new i18n keys for empty-state CTAs, badges, and section headers must land in all 10 locales (FOUN-04).

</code_context>

<specifics>
## Specific Ideas

- Phase 4's embed-with-scope-prop pattern is the reference implementation. Follow its minimum-surface-area edit playbook (identify exact line ranges in the global panel, wrap only what's needed in `{!scope?.hide... && (...)}`).
- Use exactly the same commit style (`feat(05-XX)`, `test(05-XX)`, etc., **no `Co-Authored-By` trailers** per CLAUDE.md override).
- Badge wording — "assigned" for explicit `project_agent_assignments` rows; task-derived agents get no chip (cleaner than a "working" chip).
- Session list ordering — chat threads first, runtime sessions second. Within each section, sort by most-recent activity descending.

</specifics>

<deferred>
## Deferred Ideas

- **Cross-project agent access from a project session** — user mentioned wanting a future flag to "access the agent in that project from a different project context." Explicitly deferred past Phase 5. Today: one session per (agent, project), no cross-project linking.
- **Manual "Start session" / "New thread" control** — Phase 5 auto-creates on first access. An explicit create button belongs in a later polish phase.
- **Merging the chat threads and external runtime sessions into a unified type** — two-section layout for v1; a unified session data model is future work.
- **Agent search/filter within the scoped Agents view** — the embedded squad panel's filter is hidden in workspace mode (D-12). If users want filtering later, add a project-scoped search field.
- **Session archive / soft delete** — not scoped to Phase 5.
- **Cost/token display per thread** — AI-03 in REQUIREMENTS v2 (deferred past v1).

</deferred>

---

*Phase: 05-sessions-agents*
*Context gathered: 2026-04-13*
