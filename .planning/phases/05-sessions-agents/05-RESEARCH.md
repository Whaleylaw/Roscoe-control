# Phase 5: Sessions & Agents - Research

**Researched:** 2026-04-13
**Domain:** Scoped views inside the project workspace — embedding the global agent squad + building a new sessions list component with a new project-agent chat-thread concept persisted in the existing `messages` table.
**Confidence:** HIGH (for API/schema findings and embed pattern). MEDIUM on one CONTEXT claim about session→project linkage (CONTEXT assumes `task_id` exists on sessions; it does not — see Pitfall 1 and Open Question 1).

## Summary

Phase 5 reuses two existing panels (`agent-squad-panel.tsx`, `session-details-panel.tsx`) through the same optional `scope` prop pattern Phase 4 established on `task-board-panel.tsx`. The Agents view is mechanically identical to Phase 4 (embed global panel + server-side `?project_id=` filter + hide redundant affordances). The Sessions view is **not** just an embed — the Sessions tab needs a brand-new list component because there is no existing "sessions list" panel (the 741-line `session-details-panel.tsx` is *list + detail + control UI* all in one, with its own page header — it fits the `/sessions` global panel use case, not an embedded scoped list section). For session detail, the existing panel is embedded as a detail renderer.

The CONTEXT's most important assumption — "external runtime sessions link to this project via `task_id → tasks.project_id`" — is **incorrect against the current schema**. No session source (gateway, `claude_sessions`, Codex, Hermes) stores a `task_id` or `project_id`. `claude_sessions.project_slug` and Codex `projectSlug` come from a **filesystem path basename**, not from `projects.slug` — matching is by coincidence when the repo folder name equals the project slug. This is a real risk for SESS-01 semantics: "sessions scoped to the project" needs a concrete linkage rule. The planner must pick one (see Open Question 1) before implementation.

Project-agent chat threads (D-04) fit naturally on the **existing `messages` + `conversations` infrastructure** — no new table needed. A thread is a conversation with a deterministic `conversation_id` of the form `project:<project_id>:agent:<agent_name>`. `messages` already has `conversation_id`, `from_agent`, `to_agent`, `content`, `workspace_id`, timestamps, and SSE broadcast via `eventBus.broadcast('chat.message', …)`. The `/api/chat/conversations` and `/api/chat/messages` routes already list and send messages. This reuses a mature, battle-tested chat stack and keeps Phase 5 to a thin scope-layer change.

**Primary recommendation:**
1. Add `AgentSquadScope` (optional prop) to `agent-squad-panel.tsx`, mirroring `TaskBoardScope`. Fields: `lockedProjectId`, `hideCreateButton?`, `hideProjectLabels?`, `taskScopeProjectId?` (so "active task count" is filtered to this project).
2. Extend `GET /api/agents?project_id=<id>` to return the **union** of explicit `project_agent_assignments` rows + agents whose name appears as `tasks.assigned_to` on any task with `project_id=<id>`, deduplicated by name, with an `assignmentSource: 'assigned' | 'task'` field so the UI can render the "assigned" badge.
3. Build a new `src/components/project/sessions-view.tsx` as a two-section list. Use a new endpoint `GET /api/projects/[id]/sessions` that returns `{ threads: [...], runtimeSessions: [...] }`. Chat threads are derived from the existing `messages` table (one per `(agent, project)` pair). Runtime sessions are filtered from the existing `/api/sessions` aggregator. No schema migration needed for threads; a composite index helps lookups (optional — the existing `idx_messages_conversation` already covers it).
4. Add nested route `/project/<slug>/sessions/<sessionId>` by extending the view router to read a fourth URL segment; the existing `session-details-panel.tsx` is embedded in detail mode with a `SessionDetailScope` prop that hides its filters/header and scopes the list to one session.
5. Auto-create-on-first-access (D-06): the new sessions endpoint lazily creates a thread marker on first load for each assigned agent that has no thread yet. "Creating a thread" in this model is just inserting a greeting-kickoff message (or a zero-content placeholder) so the conversation surfaces in `/api/chat/conversations` — no separate "threads" table.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Scoping Source**

*Agents (SESS-02)*
- **D-01:** Agents list for the workspace = **union of (explicit `project_agent_assignments` for this project.id) + (agents whose name appears as `assigned_to` on any task with `project_id` = this project)**.
- **D-02:** Show both explicit-assigned and task-derived agents in a single list, with a subtle "assigned" chip/badge on explicit assignments.
- **D-03:** Deduplicate by agent name — an agent that is both explicitly assigned and working on tasks appears once (the "assigned" badge takes precedence).

*Sessions (SESS-01)*
- **D-04:** Introduce **project-agent chat threads** — one persistent session per `(agent_id, project_id)` pair. Every agent explicitly assigned to the project has (or auto-gets) exactly one chat thread.
- **D-05:** Sessions tab keeps external runtime sessions visible (Claude/Codex/Hermes/gateway), filtered to the current project via the owning task's `project_id`.
- **D-06:** Auto-create-on-first-access — no manual "Start session" button.

**Filter Location**
- **D-07:** Server-side filtering. Add `?project_id=` to `GET /api/sessions` and `GET /api/agents`.
- **D-08:** A new endpoint (or extension of `/api/sessions`) returns project-agent chat threads. Route shape is Claude's discretion.

**Session Detail UX (SESS-03)**
- **D-09:** Nested route `/project/{slug}/sessions/{sessionId}`. Workspace shell stays mounted; only the Sessions content area swaps.
- **D-10:** Reuse `src/components/panels/session-details-panel.tsx` via a `scope`-style prop.
- **D-11:** Project-agent chat threads use the SAME `session-details-panel` component.

**View Composition**
- **D-12:** Embed existing `src/components/panels/agent-squad-panel.tsx` inside `src/components/project/agents-view.tsx` via a `scope` prop.
- **D-13:** Each agent card in scope mode must show: name + role + status + assignment badge + active task count for this project.
- **D-14:** Build a NEW scoped list component in `src/components/project/sessions-view.tsx`. Layout is a two-section list (chat threads then external runtime sessions).

**List Content**
- **D-15:** Chat thread row shows: agent name, status dot, one-line last message preview, relative timestamp. Click → `/project/{slug}/sessions/{threadId}`.
- **D-16:** External runtime session row shows: runtime-type badge, linked task ticket_ref, started-at timestamp, running/finished status. Click → `/project/{slug}/sessions/{sessionId}`.
- **D-17:** Agent card fields: name, role, status, assignment badge, active task count for this project. Click opens existing agent detail flow.

**Empty States**
- **D-18:** Sessions empty: "No sessions yet — assign an agent to start." with link to Agents tab.
- **D-19:** Agents empty: "No agents assigned — assign one from the main Agents view." with link back to `/agents`. Tab stays visible.

**Real-time Updates**
- **D-20:** Follow Phase 3/4 SSE pattern via `useServerEvents` / Zustand.

### Claude's Discretion
- Exact schema for project-agent chat threads (new table vs. extension of existing chat/messages)
- Route shape for the thread detail endpoint
- Prop interface for `AgentSquadPanel` scope — follow Phase 4 `TaskBoardScope` single-object shape
- CSS adjustments for embedded panels to fit inside the workspace
- Loading and error states for scoped views
- Which SSE event types to subscribe to

### Deferred Ideas (OUT OF SCOPE)
- Cross-project agent access from a project session
- Manual "Start session" / "New thread" control
- Merging chat threads and external runtime sessions into a unified type
- Agent search/filter within scoped Agents view
- Session archive / soft delete
- Cost/token display per thread (AI-03, v2)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-01 | Project workspace shows agent sessions scoped to the project | Two session kinds must be produced: (1) **Chat threads** derived from the existing `messages` table by filtering `conversation_id LIKE 'project:<id>:agent:%'` (new deterministic naming convention); (2) **Runtime sessions** — because no `task_id`/`project_id` column exists on sessions (see Pitfall 1), server-side filter must use a **derived linkage rule** the planner chooses from Open Question 1. Default recommendation: match `claude_sessions.project_slug = projects.slug` AND allow explicit override via an `agents`-mediated join (sessions authored by agents assigned to this project). |
| SESS-02 | Project workspace shows agents assigned to or working on the project | Extend `GET /api/agents` to accept `project_id` and return `SELECT a.* FROM agents a WHERE a.name IN (SELECT agent_name FROM project_agent_assignments WHERE project_id=?) OR a.name IN (SELECT DISTINCT assigned_to FROM tasks WHERE project_id=? AND assigned_to IS NOT NULL)` — plus a computed `assignmentSource` column derived from whether the row is in the assignments CTE. For the card's "active task count for this project", extend the existing task-stats subquery to accept a `project_id` filter (it already groups by `assigned_to` at route.ts:72-90). |
| SESS-03 | User can view session details from within the project context | Extend `project-context.tsx` URL parser to read a fourth segment (`segments[3]` = sessionId). Add `SessionDetailScope` prop to `session-details-panel.tsx`: `{ sessionId: string, hideFilters?: boolean, hideHeader?: boolean, threadMode?: boolean }`. When present, panel renders a single-session detail view (reusing its existing "expanded" branch at ~line 392). Add "back to sessions" breadcrumb segment in workspace shell. |

## Project Constraints (from CLAUDE.md)

- **Package manager:** pnpm only (no `npm install` in any plan)
- **Icons:** No icon libraries — raw text/emoji only (agent-squad-panel already complies; sessions-view must too)
- **i18n:** All new user-facing strings via `next-intl` message files; update all 10 locales (`ar,de,en,es,fr,ja,ko,pt,ru,zh`) per FOUN-04
- **Commits:** Conventional Commits (`feat(05-XX)`, `test(05-XX)`, `docs(05-XX)`, etc.). **No `Co-Authored-By` trailers** (CLAUDE.md override of GSD default)
- **Stack:** Next.js 16 / React 19 / TS 5 / Tailwind 3 / Zustand 5 — no new deps
- **Database:** SQLite via better-sqlite3 — no ORM, prepared statements only
- **Path alias:** `@/*` → `./src/*`
- **GSD workflow enforcement:** edits go through GSD commands; this phase is already inside `/gsd:plan-phase`

## Standard Stack

**This is an integration phase. No new libraries.** All dependencies already in use.

### Already In Use (verified by source read)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.x | App Router, dynamic segment via usePathname split | Existing |
| React | 19.0.x | UI | Existing |
| next-intl | 4.8.x | i18n | FOUN-04 |
| Zustand | 5.0.x | `useMissionControl` store: `sessions`, `selectedSession`, `setSessions` | `session-details-panel.tsx:22-28` already consumes |
| better-sqlite3 | 12.6.x | `messages` reads/writes (existing), `agents` joins (existing) | No schema change required (confirmed) |
| vitest | 2.1.x | Unit tests — Wave 0 `it.todo()` scaffolds | Phase 1-4 precedent |
| @testing-library/react | 16.1.x | Component tests | Pre-existing |
| Playwright | 1.51.x | E2E smoke | Pre-existing; `tests/projects-crud.spec.ts`, `tests/tasks-crud.spec.ts` |

**No `pnpm install` step in this phase.**

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing existing `messages` table for chat threads | New `project_agent_threads` table | New table adds schema migration, writes, and SSE plumbing. Messages table already has `conversation_id` + workspace_id scoping + SSE on `chat.message`. **Rejected** — higher cost, zero added value. |
| Deriving runtime-session-to-project from `claude_sessions.project_slug == projects.slug` | Adding nullable `project_id` column to sessions sources | Adding a column touches gateway file parsers and migrations; current coincidental match via slug is brittle but already working for most existing users. The correct long-term fix (add an explicit column) is larger than Phase 5 scope — surface as Open Question 1. |
| Adding a new `/api/projects/[id]/sessions` endpoint | Extending `GET /api/sessions?project_id=…` | Threads and runtime sessions have different shapes (threads come from `messages`; runtime sessions from the aggregator). A project-scoped endpoint that returns `{ threads, runtimeSessions }` as two labeled arrays matches the two-section UI (D-14). **Recommended.** |

## Architecture Patterns

### Recommended Component Structure
```
src/components/project/
├── agents-view.tsx           # replaces stub — embeds <AgentSquadPanel scope={…}/>
├── sessions-view.tsx         # replaces stub — NEW two-section list; reads /api/projects/[id]/sessions
└── session-detail-view.tsx   # NEW — embeds <SessionDetailsPanel scope={{ sessionId, threadMode, … }}/>
src/components/panels/
├── agent-squad-panel.tsx     # add AgentSquadScope prop + render tweaks
└── session-details-panel.tsx # add SessionDetailScope prop + single-session branch
src/app/api/
├── agents/route.ts           # extend GET with project_id union filter
├── sessions/route.ts         # (optional) accept project_id to align with D-07, though the new /api/projects/[id]/sessions covers primary use
└── projects/[id]/sessions/route.ts  # NEW — returns { threads, runtimeSessions }
```

### Pattern 1: Scope Prop (Phase 4 reuse)

Apply the exact playbook that worked for `TaskBoardPanel`:

```typescript
// AgentSquadPanel
export interface AgentSquadScope {
  /** Filter agents to those assigned to or working on this project. */
  lockedProjectId: number
  /** Hide "Add Agent" button (workspace isn't for creating agents). */
  hideCreateAgent?: boolean
  /** Use this project_id for "active task count" computation per card. */
  taskScopeProjectId?: number
  /** Show an "assigned" chip on agents from project_agent_assignments. */
  showAssignmentBadge?: boolean
}
export function AgentSquadPanel({ scope }: { scope?: AgentSquadScope } = {}) { … }
```

```typescript
// SessionDetailsPanel
export interface SessionDetailScope {
  /** When set, panel shows only this session's detail (no list). */
  sessionId: string
  /** Hide filters/sort/time-window controls — workspace breadcrumb carries context. */
  hideFilters?: boolean
  /** Hide the top page header / title (embedded contexts have their own header). */
  hideHeader?: boolean
  /** Render the session as a chat thread (messages from `messages` table) instead of runtime transcript. */
  threadMode?: boolean
  /** Back link target (e.g. `/project/{slug}/sessions`). */
  backHref?: string
}
export function SessionDetailsPanel({ scope }: { scope?: SessionDetailScope } = {}) { … }
```

Default behavior (`scope` undefined) is identical to today — zero regression risk to global panels.

### Pattern 2: New View Components

```typescript
// src/components/project/agents-view.tsx (replaces 16-line stub)
'use client'
import { useProjectWorkspace } from '@/components/project/project-context'
import { AgentSquadPanel } from '@/components/panels/agent-squad-panel'

export function AgentsView() {
  const { project } = useProjectWorkspace()
  if (!project) return null
  return (
    <AgentSquadPanel
      scope={{
        lockedProjectId: project.id,
        taskScopeProjectId: project.id,
        hideCreateAgent: true,
        showAssignmentBadge: true,
      }}
    />
  )
}
```

```typescript
// src/components/project/sessions-view.tsx (replaces 16-line stub)
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useProjectWorkspace } from '@/components/project/project-context'

type Thread = { id: string; agentName: string; agentStatus: string; lastMessage: string | null; lastActivity: number }
type RuntimeSession = { id: string; kind: string; ticketRef: string | null; startedAt: number; active: boolean }

export function SessionsView() {
  const t = useTranslations('project.sessions')
  const { project, slug } = useProjectWorkspace()
  const [data, setData] = useState<{ threads: Thread[]; runtimeSessions: RuntimeSession[] } | null>(null)
  useEffect(() => {
    if (!project) return
    const ctrl = new AbortController()
    fetch(`/api/projects/${project.id}/sessions`, { signal: ctrl.signal })
      .then(r => r.json()).then(setData).catch(() => { /* handled by empty state */ })
    return () => ctrl.abort()
  }, [project?.id])
  if (!project) return null
  // Render two labeled sections, or empty state per D-18.
  // Each row is a <Link href={`/project/${slug}/sessions/${id}`}>…</Link>
}
```

```typescript
// src/components/project/session-detail-view.tsx (NEW)
'use client'
import { useProjectWorkspace } from '@/components/project/project-context'
import { SessionDetailsPanel } from '@/components/panels/session-details-panel'

export function SessionDetailView({ sessionId }: { sessionId: string }) {
  const { slug } = useProjectWorkspace()
  // Decide threadMode by inspecting sessionId prefix:
  const threadMode = sessionId.startsWith('thread:')
  return (
    <SessionDetailsPanel
      scope={{
        sessionId,
        hideFilters: true,
        hideHeader: true,
        threadMode,
        backHref: `/project/${slug}/sessions`,
      }}
    />
  )
}
```

### Pattern 3: Nested URL Segment

Extend `project-context.tsx:25-33` to parse a fourth segment:

```typescript
// Current: pathname: /project/:slug/:view?
// Phase 5: pathname: /project/:slug/:view/:detailId?
const parsed = useMemo(() => {
  const segments = pathname.split('/').filter(Boolean)
  return {
    slug: segments[1] || '',
    view: segments[2] || 'dashboard',
    detailId: segments[3] || null,  // NEW
  }
}, [pathname])
```

Then `project-view-router.tsx` dispatches `SessionsView` vs `SessionDetailView` based on `detailId` presence.

### Pattern 4: Deterministic Thread IDs

Chat thread IDs are derived, not stored:
```
conversation_id = `project:<project_id>:agent:<agent_name_lowercased>`
thread route id = `thread:<project_id>:<agent_name_lowercased>`  // URL-safe, lets router distinguish from runtime session ids
```

This gives us:
- Idempotent "create on first access" — upsert a seed message with this `conversation_id` the first time the Sessions tab is loaded with no existing thread.
- Free listing via existing `GET /api/chat/conversations?agent=<name>` filtered by `conversation_id LIKE 'project:<id>:agent:%'`.
- Free messaging via existing `POST /api/chat/messages` with the fixed `conversation_id`.
- Free SSE via existing `chat.message` broadcasts (use-server-events.ts:136-150).

### Anti-Patterns to Avoid

- **Forking `agent-squad-panel.tsx` or `session-details-panel.tsx`** — defeats D-10/D-12 reuse intent; doubles maintenance for 1400+ combined lines.
- **New table for chat threads** — existing `messages` table is sufficient; `conversation_id` convention + workspace_id already scopes.
- **Adding `project_id` column to sessions sources** — touches gateway file parser + all three session scanners; larger than Phase 5. Surface as future work (Open Question 1). Today, use slug/agent-derived filtering with documented limitations.
- **New SSE event types** — the existing `chat.message`, `agent.*`, `task.*` events (use-server-events.ts:102-150) cover all state changes Phase 5 cares about. Add new events only if an unambiguous need surfaces during implementation.
- **Parallel data fetch path** — don't fetch sessions and agents again in new components when the store already holds them. However: the current store pulls ALL sessions/agents globally; server-side `project_id` filtering is cleaner per D-07. Use direct fetches in view components and let SSE events re-trigger fetch.
- **Conditional rendering of the tab** — D-19 explicitly forbids hiding Agents/Sessions tabs when empty.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chat thread storage | New `project_agent_threads` table | Existing `messages` table with deterministic `conversation_id` convention | Messages table is fully featured: FTS via metadata JSON, workspace scoping, SSE broadcast, pagination, unread-count query. `idx_messages_conversation` already makes the lookup fast. |
| Sending messages in a thread | New endpoint | `POST /api/chat/messages` (existing, has gateway forwarding + injection guard + coordinator routing — all 700+ lines of `src/app/api/chat/messages/route.ts`) | Battle-tested. Just pass `conversation_id=project:<id>:agent:<name>`. |
| Listing threads for a project | New query builder | `GET /api/chat/conversations` (existing) with a WHERE clause filter | Returns last_message, message_count, unread_count already. |
| Real-time thread updates | New Zustand action | Existing `addChatMessage` dispatcher (use-server-events.ts:136-150) | Already wired for SSE. |
| Session list pane with transcript | New panel | `session-details-panel.tsx` with `scope.sessionId` | 741 lines of session detail UI — transcript, controls, model info, token bars, label edit, delete confirmation. |
| Agent status polling | New interval | `session-details-panel.tsx` uses `useSmartPoll` (60s, visibility-aware, pauseWhenConnected) | Already wired. |
| URL segment parsing | `useParams`/route.tsx refactor | Extend `project-context.tsx:25-33` `useMemo` by one more segment | Phase 2 pattern, minimum churn. |
| Agent union query | Two separate queries + JS dedupe | Single SQL `UNION` or `IN (…) OR name IN (…)` | Dedupe in SQL; mark `assignmentSource` via `CASE WHEN EXISTS…THEN 'assigned' ELSE 'task' END`. |
| Per-project task counts per agent | New SQL | Adapt existing grouped-stats query (`route.ts:72-90`) with added `AND project_id=?` | Already N+1-safe. |

**Key insight:** The heavy lifting is already built. Phase 5 is ~150-250 lines of new code across ~6 files, plus i18n keys in 10 locales and a handful of test scaffolds. The biggest risk is **deciding the session→project linkage rule** (Open Question 1) — everything else is wiring.

## Runtime State Inventory

*(Not a rename/refactor/migration phase. Phase 5 adds new entities — chat threads — but they live in an existing table with a deterministic naming convention, so there is no stored-state to invalidate.)*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no rename. The new `conversation_id` scheme `project:<id>:agent:<name>` is additive; existing conversation_ids (`coord:*`, `conv_*` timestamps) are untouched. | None — verified by `grep conversation_id` across `src/` showing no collision with the new prefix. |
| Live service config | None — no gateway config change, no agent config change. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None — no new env vars. `MC_COORDINATOR_AGENT` unaffected. | None. |
| Build artifacts | None — pure source edit + i18n JSON edits. | None. |

## Environment Availability

*(Skipped — no new external dependencies. Uses existing Node 22+, pnpm, vitest, Playwright, better-sqlite3, all verified by Phase 1-4 completion.)*

## Common Pitfalls

### Pitfall 1: CONTEXT's session→project linkage assumption is unverified by schema
**What goes wrong:** CONTEXT D-05 says external runtime sessions "filtered to the current project via the owning task's `project_id`", implying sessions carry a `task_id`. They do not. Implementing a literal `sessions.task_id → tasks.project_id` join will return **zero rows for every project** because no such column exists anywhere in gateway sessions, `claude_sessions`, Codex, or Hermes tables/files.
**Why it happens:** Confusing `token_usage.task_id` and `runs.task_id` (which do exist) with per-session linkage. Sessions are file-system-scanned and gateway-tracked; they were never tied to MC tasks.
**How to avoid:** Pick a concrete rule during planning (see Open Question 1). Recommended pragmatic rule: **Session is "in this project" IF**
  - (a) `session.agent` matches any agent in the project's assigned/task-derived agent list (what SESS-02 returns), **OR**
  - (b) `claude_sessions.project_slug` matches `projects.slug` (exact string equality), **OR**
  - (c) Codex `projectSlug` matches `projects.slug`.
  This is a heuristic that will miss some correlations and catch some false positives. Document the rule in the response payload so the UI can show "showing sessions with agent X assigned to this project" tooltip.
**Warning signs:** Test "project with an assigned agent shows its runtime sessions" fails because runtime sessions list is empty even though the agent has active sessions.

### Pitfall 2: `project_slug` ≠ `projects.slug` guaranteed
**What goes wrong:** Assumption that `claude_sessions.project_slug` reliably equals `projects.slug`. `project_slug` comes from the filesystem directory basename (claude-sessions.ts scans `~/.claude/projects/<dir>`). The project's slug in MC is derived from the project name (see migrations.ts:691-719). They match only when the repo directory name coincidentally equals the derived slug.
**Why it happens:** Two different slug-derivation paths (OS path vs. `slugify(project.name)`).
**How to avoid:** Treat the match as a **heuristic**, not a source of truth. When linkage is weak, prefer the agent-derived path (Pitfall 1 rule a) which is deterministic because `agent_name` is the same string on both sides.
**Warning signs:** User opens a project whose repo dir has a different name than the slug; sessions list is empty even though sessions exist.

### Pitfall 3: Auto-create-on-first-access causes write on GET
**What goes wrong:** The new `/api/projects/[id]/sessions` endpoint lazily inserts seed messages for missing threads — but GET handlers shouldn't mutate state at the HTTP-semantics level. A read from any client (including MCP tools, tests, CLI) will spawn placeholder messages for every assigned agent.
**Why it happens:** D-06 says auto-create-on-first-access; the natural place is the GET endpoint.
**How to avoid:** Two options — (A) Make the endpoint POST or `GET ?ensure=1` with explicit opt-in; (B) Don't insert a placeholder message at all — instead, surface threads as derived-from-assignments regardless of whether any message exists yet. Option B is cleaner: the thread list query becomes "for each assigned agent, return `{ threadId, agentName, lastMessage: null OR (SELECT … FROM messages WHERE conversation_id=…) }`". The thread exists conceptually the moment the agent is assigned. **Recommend Option B.**
**Warning signs:** Read-only tests that simply call `GET /api/projects/1/sessions` cause side-effect message inserts visible in other tests.

### Pitfall 4: Project slug change breaks old thread IDs (if we key on slug)
**What goes wrong:** If thread IDs encoded `slug` instead of numeric `id`, renaming the project (Phase 6 settings work) would orphan all existing threads.
**Why it happens:** Slugs are mutable; numeric IDs are immutable.
**How to avoid:** Use `project.id` (INTEGER PK) in `conversation_id`, not slug. Pattern given in Pattern 4 (`project:<project_id>:agent:<name>`) already uses numeric id — confirm the planner preserves this.
**Warning signs:** Post-Phase-6 regression — renaming a project makes its chat threads disappear.

### Pitfall 5: SSE re-fetch of sessions list is not wired
**What goes wrong:** `use-server-events.ts` has no `session.*` dispatch handler. Runtime-session state changes (via gateway) don't trigger any Zustand update today (`session-details-panel.tsx` uses `useSmartPoll` 60s instead). Relying on SSE for live session list updates in the scoped view will not work out-of-the-box.
**Why it happens:** The global sessions pane uses polling; SSE was never required there.
**How to avoid:** Keep `useSmartPoll(60_000)` for the runtime-sessions section and rely on `chat.message` SSE for thread-section updates. Planner must explicitly decide: either add `session.*` events (larger scope, emit from gateway + scheduler; out of Phase 5 per discretion) or accept 60s polling for runtime sessions. Recommend accept polling — D-20 allows discretion on SSE event types.
**Warning signs:** New session appears in global `/sessions` page but doesn't show in the project workspace's Sessions tab until next poll tick.

### Pitfall 6: Agent-name-based dedupe is case-sensitive
**What goes wrong:** `project_agent_assignments.agent_name` and `tasks.assigned_to` can drift in case. Deduplicating with a naive `DISTINCT` by name means an agent named "Aegis" in assignments and "aegis" in a task appears twice.
**Why it happens:** No CHECK constraint enforces case-normalization. Existing code at `src/app/api/chat/messages/route.ts:416` already uses `lower(name)` comparisons — follow this convention.
**How to avoid:** Use `LOWER(agent_name)` in the UNION/dedupe query. Return the canonical casing from the `agents` table record (which is authoritative via `agents.name` UNIQUE constraint per workspace).
**Warning signs:** Agent card appears twice in the workspace Agents grid.

### Pitfall 7: Nested URL parse order — `view=sessions, detailId=<id>` not `view=<id>`
**What goes wrong:** A segment parser that falls through on 3-segment paths could interpret `/project/foo/sessions/abc` as `view='sessions/abc'` or as `view='abc'`, losing the distinction.
**Why it happens:** Current `project-context.tsx:27-32` only reads 3 segments.
**How to avoid:** Add `segments[3]` read as shown in Pattern 3. `view` still uses `segments[2]`. `project-view-router.tsx` dispatches: `view === 'sessions' && detailId` → `<SessionDetailView sessionId={detailId}/>` else → `<SessionsView/>`.
**Warning signs:** Visiting `/project/foo/sessions/abc` renders empty or goes to a 404.

### Pitfall 8: i18n coverage test across 10 locales
**What goes wrong:** Adding new keys only in `en.json`; `messages/{ar,de,en,es,fr,ja,ko,pt,ru,zh}.json` drift; `i18n-coverage.test.tsx` fails (exists in `src/components/project/__tests__/` from Phase 1).
**Why it happens:** FOUN-04 + Phase 1-4 precedent require lockstep updates.
**How to avoid:** Every new key added to all 10 files. Match existing nested structure under `project.sessions.*` and `project.agents.*` (`en.json:2244-2251` shows current shape).
**Warning signs:** `i18n-coverage.test.tsx` failure; runtime `MISSING_MESSAGE` console errors in non-English locales.

### Pitfall 9: `session-details-panel.tsx` `useMissionControl` side-effects when embedded in detail mode
**What goes wrong:** The panel calls `setSelectedSession`, `setSessions`, etc. on the global Zustand store. When embedded in scoped mode for a single session, those writes may clobber state the global sessions pane relies on when the user navigates back.
**Why it happens:** Panel assumes it owns the store's `sessions` array.
**How to avoid:** When `scope.sessionId` is set, **skip the `useSmartPoll(loadSessions)` call** and don't call `setSessions`. Feed the detail from a direct fetch keyed on `sessionId`, or from a narrowed selector. Planner must explicitly design this — the existing panel at line 41 calls `useSmartPoll(loadSessions, 60000, { pauseWhenConnected: true })` unconditionally.
**Warning signs:** Navigating back to `/sessions` (global) after viewing a project-session detail shows only one session instead of the full list; or the list is briefly empty before the next poll.

## Code Examples

### Example: Agent union query (extend `GET /api/agents`)
```typescript
// Source: new logic inside /src/app/api/agents/route.ts GET handler
// Addition: when project_id is present, replace the SELECT
const projectIdParam = Number.parseInt(searchParams.get('project_id') || '', 10)
if (Number.isFinite(projectIdParam)) {
  query = `
    SELECT a.*,
      CASE WHEN paa.agent_name IS NOT NULL THEN 'assigned' ELSE 'task' END AS assignment_source
    FROM agents a
    LEFT JOIN project_agent_assignments paa
      ON LOWER(paa.agent_name) = LOWER(a.name)
     AND paa.project_id = ?
    WHERE a.workspace_id = ?
      AND (
        paa.agent_name IS NOT NULL
        OR LOWER(a.name) IN (
          SELECT DISTINCT LOWER(assigned_to) FROM tasks
          WHERE project_id = ? AND assigned_to IS NOT NULL
        )
      )
  `
  params.push(projectIdParam, workspaceId, projectIdParam)
}
```

### Example: Thread listing from existing `messages` table
```typescript
// Source: new /src/app/api/projects/[id]/sessions/route.ts
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await params
  const projectId = Number.parseInt(id, 10)
  if (!Number.isFinite(projectId)) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  // 1) Gather assigned-or-task-derived agents (same union as /api/agents?project_id=)
  const assignedAgents = db.prepare(`
    SELECT DISTINCT agent_name FROM (
      SELECT agent_name FROM project_agent_assignments WHERE project_id = ?
      UNION
      SELECT DISTINCT assigned_to AS agent_name FROM tasks
        WHERE project_id = ? AND assigned_to IS NOT NULL
    )
  `).all(projectId, projectId) as Array<{ agent_name: string }>

  // 2) Build thread rows — Option B (Pitfall 3): don't insert placeholder messages.
  const threadPrefix = `project:${projectId}:agent:`
  const threads = assignedAgents.map(({ agent_name }) => {
    const conversationId = `${threadPrefix}${agent_name.toLowerCase()}`
    const lastMsg = db.prepare(`
      SELECT content, created_at FROM messages
      WHERE conversation_id = ? AND workspace_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(conversationId, workspaceId) as { content: string; created_at: number } | undefined
    return {
      id: `thread:${projectId}:${agent_name.toLowerCase()}`,
      conversationId,
      agentName: agent_name,
      lastMessage: lastMsg?.content ?? null,
      lastActivity: lastMsg?.created_at ?? 0,
    }
  })

  // 3) Runtime sessions — derive project membership via (a) agent-in-project or (b) slug match.
  //    See Open Question 1 for the rule.
  // … reuse getAllGatewaySessions/getLocalClaudeSessions/etc. then filter …

  return NextResponse.json({ threads, runtimeSessions })
}
```

### Example: Active-task-count per agent scoped to project
```typescript
// Extension of existing N+1-safe grouped stats at /src/app/api/agents/route.ts:72-90
const groupedTaskStats = db.prepare(`
  SELECT assigned_to,
    COUNT(*) AS total,
    SUM(CASE WHEN status IN ('assigned','in_progress') THEN 1 ELSE 0 END) AS active
  FROM tasks
  WHERE workspace_id = ? AND assigned_to IN (${placeholders})
    ${Number.isFinite(projectIdParam) ? 'AND project_id = ?' : ''}
  GROUP BY assigned_to
`).all(workspaceId, ...agentNames, ...(Number.isFinite(projectIdParam) ? [projectIdParam] : []))
```

### Example: Workspace SessionsView skeleton
```typescript
// Source: src/components/project/sessions-view.tsx (replaces current 16-line stub)
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useProjectWorkspace } from '@/components/project/project-context'

export function SessionsView() {
  const t = useTranslations('project.sessions')
  const { project, slug } = useProjectWorkspace()
  const [data, setData] = useState<{ threads: any[]; runtimeSessions: any[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return
    const ctrl = new AbortController()
    fetch(`/api/projects/${project.id}/sessions`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setData)
      .catch(err => { if (err?.name !== 'AbortError') setError(String(err)) })
    return () => ctrl.abort()
  }, [project?.id])

  if (!project) return null
  if (error) return <div className="p-6 text-destructive">{t('error')}</div>
  if (!data) return <div className="p-6">{t('loading')}</div>

  const empty = data.threads.length === 0 && data.runtimeSessions.length === 0
  if (empty) return (
    <div className="p-6 text-center">
      <p className="mb-2">{t('empty.message')}</p>
      <Link href={`/project/${slug}/agents`} className="underline">{t('empty.cta')}</Link>
    </div>
  )

  return (
    <div className="p-6 space-y-6">
      <section>
        <h3 className="text-sm font-semibold mb-2">{t('threads.title')}</h3>
        <ul className="space-y-2">
          {data.threads.map(thread => (
            <li key={thread.id}>
              <Link href={`/project/${slug}/sessions/${thread.id}`}
                    className="block p-3 rounded border border-border hover:bg-surface-1">
                <div className="font-medium">{thread.agentName}</div>
                <div className="text-sm text-muted-foreground truncate">
                  {thread.lastMessage ?? t('threads.noMessages')}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-sm font-semibold mb-2">{t('runtime.title')}</h3>
        <ul className="space-y-2">
          {data.runtimeSessions.map(s => (
            <li key={s.id}>
              <Link href={`/project/${slug}/sessions/${s.id}`}
                    className="block p-3 rounded border border-border hover:bg-surface-1">
                <span className="text-xs px-1.5 py-0.5 rounded bg-surface-1 border">{s.kind}</span>
                <span className="ml-2 text-sm">{s.ticketRef ?? t('runtime.unlinked')}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

### Example: project-view-router extension
```typescript
// Source: src/components/project/project-view-router.tsx — add detail dispatch
const { view, detailId } = useProjectWorkspace()
// …
case 'sessions':
  return detailId ? <SessionDetailView sessionId={detailId}/> : <SessionsView/>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sessions stub placeholder | Two-section scoped list (threads + runtime) with new `/api/projects/[id]/sessions` endpoint | Phase 5 (this) | Replaces 16-line stub with ~80-line view + ~60-line endpoint + reuse of 741-line detail panel. |
| Agents stub placeholder | Embedded `AgentSquadPanel` with scope prop and union-filtered `/api/agents?project_id=` | Phase 5 (this) | Replaces 16-line stub with ~15-line wrapper and ~40 lines of SQL in the existing GET handler. |
| Chat threads spawned ad-hoc with timestamped conversation_ids | Deterministic `project:<id>:agent:<name>` conversation_id convention | Phase 5 (this) | Zero schema change; makes threads idempotent and discoverable. Pre-existing conversation_ids (`coord:*`, `conv_*`) untouched. |
| Session→project association undefined | Documented heuristic rule (agent membership OR slug match) | Phase 5 (this) | Explicit limitation documented; an explicit `project_id` column on sessions is deferred. |

## Open Questions

1. **Session→project linkage rule (CRITICAL — blocks Plan):**
   - What we know: No session source has a `task_id` or `project_id` column. CONTEXT D-05 assumes they do.
   - What's unclear: Which heuristic is the MVP — (a) agent-membership-based (session's agent is in this project), (b) slug match (`claude_sessions.project_slug == projects.slug`), or (c) union of both.
   - Recommendation: **Union (a) OR (b).** Agent-membership is deterministic but misses agent-less local sessions (Claude Code sessions started manually without an MC-registered agent). Slug match catches those but is brittle across rename/mkdir differences. The union is the smallest rule that satisfies SESS-01 acceptance without a schema migration.

2. **`session-details-panel` embedded-mode side effects on Zustand store (BLOCKING if ignored):**
   - What we know: Panel unconditionally calls `setSessions`, `useSmartPoll(loadSessions)`.
   - What's unclear: Does Phase 5 need to refactor to avoid store clobber, or can we accept that navigating between `/project/<slug>/sessions/<id>` and `/sessions` briefly shows a narrowed list?
   - Recommendation: Add `if (scope?.sessionId) return` guards around the polling and `setSessions` calls. Panel then renders detail from the existing `sessions` array (which includes the single fetched session) or a locally-fetched session by id. This is ~10 lines of diff.

3. **Thread auto-creation semantics (D-06):**
   - What we know: "Auto-create on first access" suggests a write.
   - What's unclear: Should the list endpoint write a seed message, or simply surface empty-thread placeholders (Pitfall 3 Option B)?
   - Recommendation: **Option B — no write.** Threads are *derived* from assignments. A thread exists conceptually as soon as an agent is assigned. `lastMessage` is `null` until the user actually sends something. This keeps GET pure, simplifies testing, and defers seed-content decisions (which agent greets first, what to say) to a future polish pass.

4. **Badge phrasing & absence ("assigned" vs task-derived):**
   - What we know: CONTEXT specifies "assigned" for explicit; task-derived gets no chip (cleaner).
   - What's unclear: Confirming no other wording ("member", "collaborator"). CONTEXT D-02 is explicit — recommend accept as-is.

5. **SSE coverage for runtime sessions:**
   - What we know: No `session.*` events exist in `use-server-events.ts` dispatch table.
   - What's unclear: Accept 60s polling or emit new SSE events from gateway/scheduler.
   - Recommendation: **Accept polling.** Emitting new SSE events is a larger cross-cutting change (gateway bridge + scheduler + store) and violates D-20 discretion which allows choosing subset. Thread updates come through existing `chat.message` SSE, which IS wired.

6. **Test framework for API route tests:**
   - What we know: Existing API route tests use vitest + a mock `db_helpers` pattern (`src/lib/__tests__/`).
   - What's unclear: Are there established integration test patterns for new `/api/projects/[id]/sessions` with a real SQLite in-memory DB?
   - Recommendation: Look at `src/lib/__tests__/project-indexes.test.ts` (Phase 1) — it uses `new Database(':memory:')` and runs migrations. Reuse this pattern for the endpoint test.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.1.x (unit + integration), Playwright 1.51.x (E2E) |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `pnpm vitest run src/components/project/__tests__/sessions-view.test.tsx src/components/project/__tests__/agents-view.test.tsx` |
| Full suite command | `pnpm test` (vitest) + `pnpm test:e2e` (Playwright) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SESS-01 | `/api/projects/[id]/sessions` returns threads for assigned agents | unit (api route) | `pnpm vitest run src/app/api/projects/__tests__/project-sessions.test.ts -t "SESS-01 threads"` | ❌ Wave 0 creates |
| SESS-01 | `/api/projects/[id]/sessions` returns runtime sessions scoped by linkage rule | unit (api route) | same file, `-t "SESS-01 runtime"` | ❌ Wave 0 creates |
| SESS-01 | `SessionsView` renders two sections with labeled headers | unit (component) | `pnpm vitest run src/components/project/__tests__/sessions-view.test.tsx -t "SESS-01"` | ❌ Wave 0 creates |
| SESS-01 | Empty state CTA links to Agents tab (D-18) | unit | same file, `-t "empty state"` | ❌ Wave 0 creates |
| SESS-02 | `/api/agents?project_id=N` returns union (assigned ∪ task-derived) | unit (api route) | `pnpm vitest run src/app/api/agents/__tests__/agents-route.test.ts -t "SESS-02 union"` | ❌ Wave 0 creates |
| SESS-02 | Dedupe by lowercased agent name | unit | same, `-t "SESS-02 dedupe"` | ❌ Wave 0 creates |
| SESS-02 | Each agent carries `assignment_source` field | unit | same, `-t "SESS-02 source"` | ❌ Wave 0 creates |
| SESS-02 | `AgentsView` renders embedded `AgentSquadPanel` with scope | unit (component) | `pnpm vitest run src/components/project/__tests__/agents-view.test.tsx -t "SESS-02"` | ❌ Wave 0 creates |
| SESS-02 | "Add Agent" button hidden in workspace mode | unit | same, `-t "hides add"` | ❌ Wave 0 creates |
| SESS-02 | Assignment badge visible for explicit assignments | unit | same, `-t "badge"` | ❌ Wave 0 creates |
| SESS-02 | Active task count scoped to current project | unit | same, `-t "task count"` | ❌ Wave 0 creates |
| SESS-03 | URL segment parser reads `detailId` | unit | `pnpm vitest run src/components/project/__tests__/project-context.test.tsx -t "detailId"` | ❌ Wave 0 creates |
| SESS-03 | `/project/<slug>/sessions/<id>` renders `SessionDetailView` | unit (router) | `pnpm vitest run src/components/project/__tests__/project-view-router.test.tsx -t "SESS-03"` | ❌ Wave 0 creates |
| SESS-03 | Scoped panel hides filters/header | unit | `pnpm vitest run src/components/panels/__tests__/session-details-panel.test.tsx -t "SESS-03 scope"` | ❌ Wave 0 creates |
| SESS-03 | End-to-end: click session in list → detail view → back preserves workspace | E2E | `pnpm test:e2e tests/project-sessions.spec.ts` | ❌ Wave 0 creates |

### Sampling Rate
- **Per task commit:** `pnpm vitest run src/components/project/__tests__/ src/components/panels/__tests__/session-details-panel.test.tsx src/components/panels/__tests__/agent-squad-panel.test.tsx src/app/api/projects/__tests__/project-sessions.test.ts src/app/api/agents/__tests__/agents-route.test.ts`
- **Per wave merge:** `pnpm test` (full vitest) + `pnpm typecheck` + `pnpm lint`
- **Phase gate:** `pnpm test:all` (lint + typecheck + test + build + e2e) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/app/api/projects/__tests__/project-sessions.test.ts` — NEW file. Covers SESS-01 endpoint shape, thread derivation, runtime session filter rule. Pattern: in-memory `better-sqlite3`, run migrations, seed projects/agents/tasks/messages, call GET handler, assert shape. Reference existing `src/lib/__tests__/project-indexes.test.ts`.
- [ ] `src/app/api/agents/__tests__/agents-route.test.ts` — NEW file. Covers SESS-02 union query, dedupe, assignment_source, scoped task count.
- [ ] `src/components/project/__tests__/sessions-view.test.tsx` — NEW file. Covers loading/empty/error/populated states; link hrefs; empty-state CTA.
- [ ] `src/components/project/__tests__/agents-view.test.tsx` — NEW file. Covers embed, scope prop wiring, badge rendering.
- [ ] `src/components/project/__tests__/project-context.test.tsx` — may exist from Phase 1/2; add `detailId` parsing test cases, or create if missing.
- [ ] `src/components/project/__tests__/project-view-router.test.tsx` — same pattern; add session-detail dispatch tests.
- [ ] `src/components/panels/__tests__/session-details-panel.test.tsx` — NEW file. Covers scope prop: hideFilters, hideHeader, threadMode, sessionId (single-session render), no Zustand clobber.
- [ ] `src/components/panels/__tests__/agent-squad-panel.test.tsx` — may be introduced here; covers AgentSquadScope prop.
- [ ] `tests/project-sessions.spec.ts` — NEW Playwright spec. E2E: navigate into project, click Sessions tab, see two sections, click a thread, land on detail URL, click back breadcrumb, return to Sessions list. Reference: `tests/projects-crud.spec.ts`, `tests/tasks-crud.spec.ts`.

*(Follow the established Phase 1-4 pattern: `it.todo()` only in wave-0; actual test bodies filled in the implementation wave.)*

## Sources

### Primary (HIGH confidence)
- `/src/app/api/sessions/route.ts` (read lines 1-365) — sessions aggregator; confirmed **no** `project_id` or `task_id` parameter/column; deduping and merging logic; session shape returned to clients.
- `/src/app/api/agents/route.ts` (read lines 1-475) — GET with status/role/show_hidden filters; N+1-safe grouped task stats at 72-90; no `project_id` param yet.
- `/src/app/api/chat/conversations/route.ts` (read full) — confirms listing-by-conversation_id infrastructure exists; unread-count + last_message queries.
- `/src/app/api/chat/messages/route.ts` (read lines 1-450) — confirms POST with `conversation_id`, SSE via `eventBus.broadcast('chat.message', …)`, workspace scoping, gateway forwarding, idempotency.
- `/src/app/api/sessions/send/route.ts` (read full) — confirms session message-injection RPC; not needed for threads but relevant to runtime-session send UX.
- `/src/components/panels/agent-squad-panel.tsx` (read lines 1-405) — embed target (652 lines total); confirmed no `scope` prop; confirmed `fetch('/api/agents')` at line 61; confirmed Add Agent button at 174-177; confirmed grid layout at 211; confirmed agent detail modal at 337.
- `/src/components/panels/session-details-panel.tsx` (read lines 1-469) — embed target; Zustand consumption at 22-28; `useSmartPoll` at 41; filters at 226-302; expanded-session branch at 391.
- `/src/components/project/project-context.tsx` (read full) — URL segment parser at 25-33; `useProjectWorkspace` hook contract.
- `/src/components/project/project-view-router.tsx` (read full) — current 5-way switch; easy to extend.
- `/src/components/project/sessions-view.tsx` and `/src/components/project/agents-view.tsx` (read full) — 16-line stubs confirmed.
- `/src/components/project/tasks-view.tsx` (read full) — Phase 4 reference implementation of the scope-prop wrapper pattern.
- `/src/lib/migrations.ts` — migration 007 (messages, lines 64-81), 020 (claude_sessions, 529-556), 027 (project_agent_assignments, 824-836), 051 (workspace indexes, 1432-1440). No migration grants sessions a `task_id` or `project_id` column.
- `/src/lib/sessions.ts` (read lines 1-80) — `GatewaySession` interface; no `project_id`/`task_id`/`projectSlug` fields.
- `/src/lib/claude-sessions.ts` (read lines 1-55, 280-330) — `ClaudeSession.projectSlug` is filesystem-derived (path basename); no task linkage.
- `/src/lib/codex-sessions.ts` (read line 185) — `projectSlug = basename(projectPath)`; same story.
- `/src/lib/use-server-events.ts` (read lines 100-180) — SSE dispatch table; confirmed `chat.message`, `agent.*`, `task.*` handlers; confirmed **no** `session.*` dispatcher exists.
- `/messages/en.json` (read lines 2200-2256) — current `project.sessions.*` + `project.agents.*` keys; nested structure to extend.
- `/.planning/phases/04-project-tasks/04-RESEARCH.md` — scope-prop pattern reference; minimum-surface-area playbook.
- `/.planning/phases/05-sessions-agents/05-CONTEXT.md` — user decisions D-01 through D-20; deferred list; canonical refs.
- `/.planning/REQUIREMENTS.md` — SESS-01, SESS-02, SESS-03 acceptance criteria.
- `/.planning/ROADMAP.md` — Phase 5 goal and success criteria.
- `/.planning/config.json` — `workflow.nyquist_validation: true` → Validation Architecture required; `commit_docs: true` → commit RESEARCH.md.

### Secondary (MEDIUM confidence)
- CLAUDE.md (project instructions) — pnpm-only, no icon libs, no AI attribution, all i18n via next-intl, stack constraints.
- STATE.md — confirms Phases 1-4 complete; consistent Wave-0 `it.todo()` pattern to follow.

### Tertiary (LOW confidence)
- None — all findings are source-verified.

## Metadata

**Confidence breakdown:**
- Embed pattern (AgentSquadScope, SessionDetailScope): HIGH — direct analogy to validated Phase 4 pattern, exact line ranges identified.
- `/api/agents` union filter: HIGH — existing query structure accommodates the addition cleanly; pitfalls documented.
- Chat threads via messages table: HIGH — all infrastructure in place; conversation_id convention is additive.
- Runtime-session linkage rule: **MEDIUM** — pitfall explicitly called out; planner must pick the rule before coding. Recommendation is pragmatic but is a heuristic by design.
- SSE coverage: HIGH — use-server-events.ts read confirms `session.*` absence; polling fallback is deliberate and documented.
- i18n structure: HIGH — `en.json` inspected; existing keys already scaffold the needed nesting.
- Nested route segment: HIGH — project-context.tsx parser is small; one-line extension.
- Tests: MEDIUM — files don't exist yet (expected for Wave 0); patterns are well established from Phases 1-4.

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (30 days — stack is stable; the only schema-level change that could invalidate this research is a decision to add `project_id` to session sources, which would be its own phase)
