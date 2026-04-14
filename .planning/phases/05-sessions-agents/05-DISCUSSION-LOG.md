# Phase 5: Sessions & Agents - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 05-sessions-agents
**Areas discussed:** Scoping source (sessions + agents), Session detail UX, View composition (reuse vs light-build), List content & empty states

---

## Scoping Source

### Agent scope

| Option | Description | Selected |
|--------|-------------|----------|
| Assignments only (Recommended) | Agents list = rows from `project_agent_assignments` for this project.id. Explicit, table already exists, no fuzzy inference. | |
| Assignments + task-derived | Union of explicit assignments + agents appearing as assignee on any task in this project. Picks up "working on" agents. | ✓ |
| Task-derived only | Show only agents whose names appear on tasks in this project. | |

**User's choice:** Assignments + task-derived
**Notes:** SESS-02 explicitly says "assigned to OR currently working on" — matches.

### Session scope

| Option | Description | Selected |
|--------|-------------|----------|
| Via `session.task_id → tasks.project_id` (Recommended) | Session belongs to project if its linked task belongs to that project. | |
| Via session's agent → `project_agent_assignments` | Session belongs to project if its agent is assigned to that project. | |
| Union of both | Include sessions matching either rule. | |
| **Free-text answer** | "Could whatever agent is Assigned to the project. Can we have a session that is unique to the project? ... Whatever agent is assigned has a unique session for that project only." | ✓ |

**User's choice (free-text):** Introduce a new concept — one persistent chat session per (agent, project). Each assigned agent has exactly one thread for this project; opening it always returns to the same conversation. Later could add a cross-project access flag.
**Notes:** This reframes the scoping question. Claude confirmed interpretation in a follow-up; user selected "Yes, but keep external sessions visible too" (Claude/Codex/Hermes sessions linked via task_id → project_id also displayed).

### Filter location

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side — add `?project_id=` to API routes (Recommended) | Extend `/api/sessions` and `/api/agents` with `?project_id=` filter. Matches Phase 4 precedent. | ✓ |
| Client-side — fetch all, filter in view | Simpler (no API changes) but ships extra data and can't paginate server-side. | |

**User's choice:** Server-side
**Notes:** Consistent with Phase 4 (`GET /api/tasks?project_id=X`).

### Follow-up: Session model confirmation

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — one persistent project-agent chat thread | External gateway/Claude/Codex sessions out of scope for Phase 5. | |
| Yes, but keep external sessions visible too | Same thread concept PLUS runtime sessions linked via task_id appear in a second section. | ✓ |
| Different — let me explain | Free-text correction. | |

**User's choice:** Yes, but keep external sessions visible too

### Follow-up: Session creation scope

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-create on first access (Recommended) | Assigned agent without a session gets one created lazily when the Sessions tab opens. | ✓ |
| Explicit create button | User manually creates each project-agent thread. | |
| Out of scope for Phase 5 — list-only | Phase 5 only displays sessions; creation in a later phase. | |

**User's choice:** Auto-create on first access

### Follow-up: Agent list edge case (task-derived without explicit assignment)

| Option | Description | Selected |
|--------|-------------|----------|
| Show both, no visual distinction (Recommended) | Unified list. Simpler v1. | |
| Show both with a subtle badge/label | Assigned agents get a small "assigned" chip; task-derived agents show as-is. | ✓ |
| Only explicit assignments have a project session | Task-derived show as read-only rows. | |

**User's choice:** Show both with a subtle badge/label

---

## Session Detail UX

### Detail UX rendering

| Option | Description | Selected |
|--------|-------------|----------|
| Nested route replaces list view (Recommended) | `/project/{slug}/sessions/{sessionId}`. Workspace shell stays visible; deep-linkable. | ✓ |
| Inline master-detail split pane | List + detail side-by-side. No URL change. | |
| Modal overlay | Detail in modal/drawer. Not deep-linkable. | |

**User's choice:** Nested route replaces list view

### Reuse existing detail component?

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `session-details-panel.tsx` with a scope prop (Recommended) | Phase 4 pattern. 741 lines reused. | ✓ |
| Build a lighter project-scoped detail view | More work, tighter UX. | |

**User's choice:** Reuse `session-details-panel.tsx` with a scope prop

### Chat-thread detail UI?

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse the same panel (Recommended) | Treat project-agent threads as a session variant the same panel renders. | ✓ |
| Use a different chat-optimized component | Dedicated chat UI, new route. | |

**User's choice:** Reuse the same panel

---

## View Composition

### Agents view

| Option | Description | Selected |
|--------|-------------|----------|
| Embed `agent-squad-panel.tsx` with a scope prop (Recommended) | Phase 4 embed pattern. Full feature parity. | ✓ |
| Light custom list | Purpose-built grid/list. More work. | |
| Embed with `compact` variant flag | Embed + hide non-essential affordances. | |

**User's choice:** Embed `agent-squad-panel.tsx` with a scope prop

### Sessions view layout

| Option | Description | Selected |
|--------|-------------|----------|
| Two sections: Project-agent threads + External runtime sessions (Recommended) | Top: assigned-agent chat threads. Bottom: Claude/Codex/Hermes/gateway sessions linked via task_id. | ✓ |
| Single unified list with type badges | One flat list mixing both, type chips distinguish. | |
| Tabs inside Sessions view: 'Threads' / 'Runtime' | Subtabs inside the tab. | |

**User's choice:** Two sections

### Sessions list component

| Option | Description | Selected |
|--------|-------------|----------|
| Build a new scoped list component (Recommended) | Create `sessions-view.tsx` with the two-section layout. No global list panel exists. | ✓ |
| Try to adapt live-feed or session-details-panel | Higher risk of awkward fit. | |

**User's choice:** Build a new scoped list component

---

## List Content & Empty States

### Chat-thread row content

| Option | Description | Selected |
|--------|-------------|----------|
| Agent name + status dot + last message preview + timestamp (Recommended) | Row: name, status, one-line preview, relative time. | ✓ |
| Agent name + status + message count | Minimal. | |
| Agent name + status + assigned task count + last activity | Different signal. | |

**User's choice:** Agent name + status dot + last message preview + timestamp

### External-runtime-session row content

| Option | Description | Selected |
|--------|-------------|----------|
| Runtime type badge + linked task ref + started-at + status (Recommended) | Claude/Codex/Hermes/Gateway chip, ticket_ref, started time, running/finished. | ✓ |
| Runtime type + session ID + status only | Minimal. | |
| Same as project-agent threads (consistent schema) | Unified row shape. | |

**User's choice:** Runtime type badge + linked task ref + started-at + status

### Empty states

| Option | Description | Selected |
|--------|-------------|----------|
| Friendly message + CTA (Recommended) | Directive message with link/tab-switch to resolve. | ✓ |
| Plain "No results" message | Short, generic, no CTAs. | |
| Hide the tab entirely when empty | Tab bar drops empty tabs. | |

**User's choice:** Friendly message + CTA

### Agent card fields

| Option | Description | Selected |
|--------|-------------|----------|
| Name + role + status + assignment badge + active task count (Recommended) | Workspace-scoped enrichment. | ✓ |
| Same as global agent-squad-panel cards, no changes | Reuse verbatim. | |
| Compact list rows instead of cards | Denser, loses card visual. | |

**User's choice:** Name + role + status + assignment badge + active task count

---

## Claude's Discretion

- Exact schema for project-agent chat threads (new table vs extending existing messages/sessions table)
- Route shape for the thread detail endpoint
- Prop interface shape for `AgentSquadScope` and `SessionDetailScope` (follow `TaskBoardScope` precedent)
- CSS adjustments for embedded panels inside the workspace layout
- Loading and error states for scoped views
- Which SSE event types to subscribe to for live updates

## Deferred Ideas

- Cross-project access flag for an agent's project session (future)
- Manual "Start session" / "New thread" control (future polish phase)
- Merging chat threads and runtime sessions into a unified type (future)
- Agent search/filter within scoped Agents view (future)
- Session archive / soft delete (not Phase 5)
- Cost/token display per thread (AI-03 in v2 requirements)
