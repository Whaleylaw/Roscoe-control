---
phase: 05-sessions-agents
plan: 02
subsystem: project-workspace
tags: [scope-prop, url-routing, zustand-guard, breadcrumb, session-detail, threads]

# Dependency graph
requires:
  - phase: 05-sessions-agents
    plan: 00
    provides: SessionDetailsPanel + project-context + project-view-router test scaffolds (it.todo placeholders), project.sessions.detailBackLink + threadEmptyPreview i18n keys (10 locales), workspace component layout
  - phase: 02-navigation-workspace-shell
    provides: useProjectWorkspace context hook, ProjectViewRouter switch, ProjectBreadcrumb chrome
  - phase: 04-project-tasks
    provides: scope-prop embed pattern (TaskBoardScope) — same playbook applied here
provides:
  - URL parser exposing detailId from segments[3] (Pitfall 7 colon-preserving)
  - SessionDetailView wrapper (project/session-detail-view.tsx)
  - SessionDetailScope prop on the existing 741-line SessionDetailsPanel — Pitfall 9 Zustand-clobber guards, conditional header/filters/back-link, thread-mode chat fetch
  - Breadcrumb fourth-segment + clickable third-segment when detailId is present
  - 14 SESS-03 url/router tests + 19 SessionDetailScope tests filled (33 it.todo → real assertions)
affects: [05-03 (sessions-view will navigate to /project/<slug>/sessions/<id>)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern: scope-prop on global panel that disables polling + writes via useSmartPoll({ enabled: !isScoped }) AND early-return inside the load callback — defense in depth against Zustand clobber"
    - "Pattern: pathname.split('/') is colon-safe; thread:N:agent ids round-trip verbatim from URL → context → render with no encode/decode"
    - "Pattern: detail breadcrumb segment derived from id format (regex strip + titlecase) — no extra i18n keys, no API call"

key-files:
  created:
    - src/components/project/session-detail-view.tsx
  modified:
    - src/components/project/project-context.tsx
    - src/components/project/project-view-router.tsx
    - src/components/project/project-breadcrumb.tsx
    - src/components/panels/session-details-panel.tsx
    - src/components/project/__tests__/project-context.test.tsx
    - src/components/project/__tests__/project-view-router.test.tsx
    - src/components/panels/__tests__/session-details-panel.test.tsx

key-decisions:
  - "Used useSmartPoll({ enabled: !isScoped }) per the executor critical_note — the callback parameter is non-nullable in the hook signature so disabling via the supported `enabled` option is the only typesafe path"
  - "Defense-in-depth Pitfall 9 guard: BOTH `enabled: false` on useSmartPoll AND an early-return inside loadSessions — guarantees no setSessions clobber even if a future caller invokes the returned manual-poll function"
  - "Created session-detail-view.tsx in Task 1 (not Task 2) so project-view-router.tsx import resolves immediately and pnpm typecheck stays green between Task 1 and Task 2 commits"
  - "Conversation id format `project:<numeric-id>:agent:<name>` derived inside the panel — Pitfall 4 (numeric project.id, never slug) enforced via regex `/^thread:(\\d+):(.+)$/` which only matches numeric ids"
  - "Breadcrumb third segment is rendered as a button (returns to list view) only when detailId is present; otherwise it stays a span, preserving today's visual rhythm for non-detail routes"
  - "Visible-session filter checks id || session_key || key — the runtime SessionType in the store is loose (multiple shapes from gateway/Claude/Codex aggregator) and matching against all three fields avoids 'session not found' bugs across runtimes"

# Metrics
duration: 4min
completed: 2026-04-14
---

# Phase 05 Plan 02: Session Detail Plumbing Summary

**Wired the SESS-03 nested route — `/project/<slug>/sessions/<sessionId>` now mounts a scoped session detail inside the workspace shell, reusing the 741-line SessionDetailsPanel via a SessionDetailScope prop with Pitfall-9 Zustand-clobber guards and an opt-in chat-thread fetch path**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-14T00:59:14Z
- **Completed:** 2026-04-14T01:04:11Z (approx)
- **Tasks:** 3 / 3
- **Files modified/created:** 8 (1 new + 7 modified)

## Accomplishments

- Extended `useProjectWorkspace()` to expose `detailId: string | null` parsed from `segments[3]` — colon-preserving (Pitfall 7), defaults to null when fewer than 4 path segments
- Added `SessionDetailView` wrapper component (project layer) that derives `threadMode` from the `thread:` prefix and assembles a `SessionDetailScope` for the panel
- Extended `SessionDetailsPanel` with optional `SessionDetailScope` prop — defense-in-depth Pitfall-9 guards (useSmartPoll disabled + loadSessions early-return), conditional header/filters/back-link rendering, and a thread-mode branch that fetches `/api/chat/messages` with a deterministic `project:<numeric-id>:agent:<name>` conversation_id
- Extended `ProjectBreadcrumb` to render a fourth segment when detailId is present and to make the third segment clickable (return-to-list affordance)
- Filled all 33 `it.todo()` stubs from Plan 05-00 (6 detailId parsing + 8 router dispatch + 19 SessionDetailScope) with real assertions — every test green

## Detailid Parser Diff

`src/components/project/project-context.tsx`:

```diff
 export interface ProjectWorkspaceState {
   slug: string
   view: string
+  detailId: string | null  // SESS-03 — segments[3] when present (e.g. session id)
   project: Project | null
   loading: boolean
   error: string | null
 }
 ...
 const parsed = useMemo(() => {
-  // pathname: /project/:slug/:view?
+  // pathname: /project/:slug/:view?/:detailId?
   const segments = pathname.split('/').filter(Boolean)
   return {
     slug: segments[1] || '',
     view: segments[2] || 'dashboard',
+    detailId: segments[3] || null,  // SESS-03 — Pitfall 7: colons preserved verbatim
   }
 }, [pathname])
-const { slug, view } = parsed
+const { slug, view, detailId } = parsed
 ...
 const state = useMemo<ProjectWorkspaceState>(() => ({
-  slug, view, project, loading, error,
-}), [slug, view, project, loading, error])
+  slug, view, detailId, project, loading, error,
+}), [slug, view, detailId, project, loading, error])
```

## SessionDetailScope Interface + Pitfall-9 Guard Choice

```typescript
export interface SessionDetailScope {
  sessionId: string        // when set, panel renders only this session's detail
  hideFilters?: boolean    // hide filter/sort/time-window controls
  hideHeader?: boolean     // hide the top page header/title
  threadMode?: boolean     // render as chat thread (messages from /api/chat/messages)
  backHref?: string        // target URL — renders a "Back to sessions" link
}
```

**Pitfall-9 implementation:** defense in depth.

1. **Hook-level disable** — `useSmartPoll(loadSessions, 60000, { pauseWhenConnected: true, enabled: !isScoped })`. The `enabled: false` option short-circuits both the initial fetch and the interval (verified against `src/lib/use-smart-poll.ts:101` initial guard and line 59 ongoing guard).
2. **Callback-level guard** — `loadSessions` itself early-returns when `isScoped` so `setSessions` is never invoked even if a future caller fires the manual-trigger function returned by `useSmartPoll`.

This matches the executor critical_note: `useSmartPoll(scope?.sessionId ? null : loadSessions, ...)` would NOT typecheck because the hook's `callback` parameter is `() => void | Promise<void>` (non-nullable). The `enabled` flag is the only typesafe disable path, and the inner guard makes the contract explicit.

**Conversation_id derivation (Pitfall 4):**

```typescript
function sessionIdToConversationId(id: string): string | null {
  const m = id.match(/^thread:(\d+):(.+)$/)
  return m ? `project:${m[1]}:agent:${m[2]}` : null
}
```

The `\d+` capture group enforces a numeric project id — slugs would not match, eliminating Pitfall 4 by construction.

## Breadcrumb Extension Diff

`src/components/project/project-breadcrumb.tsx`:

```diff
+function detailLabelFrom(id: string): string {
+  const threadMatch = id.match(/^thread:\d+:(.+)$/)
+  if (threadMatch) {
+    const name = threadMatch[1]
+    return name.charAt(0).toUpperCase() + name.slice(1)
+  }
+  return id
+}
 ...
-const { slug, view, project } = useProjectWorkspace()
+const { slug, view, detailId, project } = useProjectWorkspace()
 ...
 {view !== 'dashboard' && (
   <>
     <span className="text-muted-foreground/50">{'>'}</span>
-    <span className="text-foreground font-medium">{t(`nav.${view}`)}</span>
+    {detailId ? (
+      <button onClick={() => navigate(`/project/${slug}/${view}`)} ...>
+        {t(`nav.${view}`)}
+      </button>
+    ) : (
+      <span className="text-foreground font-medium">{t(`nav.${view}`)}</span>
+    )}
   </>
 )}
+{detailId && view !== 'dashboard' && (
+  <>
+    <span className="text-muted-foreground/50">{'>'}</span>
+    <span className="text-foreground font-medium truncate max-w-[240px]">
+      {detailLabelFrom(detailId)}
+    </span>
+  </>
+)}
```

## Lines of Code Per File

| File | Lines | Change |
|------|-------|--------|
| src/components/project/project-context.tsx | 108 | +6 |
| src/components/project/project-view-router.tsx | 35 | +4 |
| src/components/project/session-detail-view.tsx | 27 | NEW |
| src/components/project/project-breadcrumb.tsx | 77 | +33 |
| src/components/panels/session-details-panel.tsx | 842 | +101 |
| src/components/project/__tests__/project-context.test.tsx | 132 | +52 |
| src/components/project/__tests__/project-view-router.test.tsx | 100 | +77 |
| src/components/panels/__tests__/session-details-panel.test.tsx | 246 | +199 |

## Task Commits

1. **Task 1: Extend project-context to parse detailId + update router dispatch** — `18ec4bb` (feat) — 5 files, +180/-26
2. **Task 2: Add SessionDetailScope prop with Pitfall-9 Zustand guards** — `3d8e64d` (feat) — 2 files, +340/-40
3. **Task 3: Extend ProjectBreadcrumb with detail-segment fourth crumb** — `e0b34af` (feat) — 1 file, +36/-3

(`--no-verify` used per parallel-execution flag — pre-commit hooks will be re-run by orchestrator after both 05-01 and 05-02 land.)

## Decisions Made

- **Defense-in-depth Pitfall-9 guard** — `enabled: false` on the hook AND early-return inside the callback. Either alone would suffice for today's hook implementation, but the redundancy makes the no-clobber contract self-documenting.
- **Created `session-detail-view.tsx` in Task 1** rather than Task 2 — its presence is required for `project-view-router.tsx` to typecheck after the Task 1 dispatch edit. Task 1 ships a minimal skeleton; Task 2 enriches the panel it embeds.
- **`visibleSessions` matches against id || session_key || key** — the runtime session shape from the gateway/Claude/Codex aggregators varies; matching three fields avoids brittle "session not found" UX while a richer single-source Session schema is out of scope.
- **No new i18n keys added** — `project.sessions.detailBackLink` and `project.sessions.threadEmptyPreview` were already shipped in Plan 05-00 across all 10 locales (verified via grep). Locale files are FROZEN per the parallel-execution contract.
- **Breadcrumb third segment becomes a button only when `detailId` is set** — preserves today's static-label rhythm for the 95% of routes that have no detail.

## Deviations from Plan

**1. [Rule 3 - Implementation Quality] Used `enabled` option instead of null-callback for useSmartPoll**

The plan's Step C.3 suggested `useSmartPoll(scope?.sessionId ? null : loadSessions, ...)`. The executor critical_note (and a fresh read of `src/lib/use-smart-poll.ts:30-34`) confirmed the `callback` parameter is non-nullable (`() => void | Promise<void>`). I used the supported `enabled: false` option per the critical_note, plus an inner `if (isScoped) return` guard for defense in depth. This satisfies the test `useSmartPoll(loadSessions) is NOT invoked when scope.sessionId is set` because the hook never executes the callback when `enabled` is false.

**No other deviations.** The plan executed exactly as written; the architecture, file shape, interface surface, and dispatch logic match the plan body verbatim.

## Issues Encountered

**Pre-existing typecheck noise from sibling plan 05-01.** Running `pnpm typecheck` reports errors in `src/components/panels/__tests__/agent-squad-panel.test.tsx` (the AgentSquadScope prop hasn't been added to the global panel yet — that's owned by Plan 05-01). All files I touch (`session-details-panel.tsx`, `project-context.tsx`, `project-view-router.tsx`, `project-breadcrumb.tsx`, `session-detail-view.tsx`) typecheck cleanly. Filtered grep across my owned files returns zero typecheck errors. This will resolve when 05-01 lands.

## User Setup Required

None — no external service configuration, no env vars, no DB migrations.

## Next Phase Readiness

- Plan 05-03 (sessions list + chat-thread API + E2E) can now wire `<Link href={`/project/${slug}/sessions/${sessionId}`}>` rows knowing the URL parser, router dispatch, scope-prop panel, and breadcrumb are all live
- Thread mode is wired to fetch from `/api/chat/messages?conversation_id=project:<id>:agent:<name>` — when 05-03 ships the lazy auto-create-on-first-access logic for that conversation, the detail view will populate immediately
- Global `/sessions` panel behavior is preserved — verified via the regression-guard test bucket (`useSmartPoll IS invoked when scope is undefined`, `setSessions IS called`, `filters/header render`)

---
*Phase: 05-sessions-agents*
*Plan: 02*
*Completed: 2026-04-14*

## Self-Check: PASSED

Verified at 2026-04-14T01:04:30Z:

- All 8 modified/created code+test files exist on disk
- SUMMARY.md exists at .planning/phases/05-sessions-agents/05-02-SUMMARY.md
- All 3 task commits exist in `git log`:
  - 18ec4bb feat(05-02): add detailId URL segment + SessionDetailView dispatch (SESS-03)
  - 3d8e64d feat(05-02): add SessionDetailScope prop with Pitfall-9 Zustand guards
  - e0b34af feat(05-02): extend ProjectBreadcrumb with detail-segment fourth crumb
- `pnpm vitest run` (3 plan-relevant files): 40 passed, 5 todo (NAV-04, unrelated), 0 failed
- `pnpm typecheck` for owned files: zero errors (sibling 05-01 owns the agent-squad-panel.test.tsx errors)
