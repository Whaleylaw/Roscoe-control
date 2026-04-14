---
phase: 05-sessions-agents
plan: 01
subsystem: api+ui
tags: [api, sqlite, scope-prop, sess-02, union-filter, lower-dedupe, assignment-source]

# Dependency graph
requires:
  - phase: 05-sessions-agents
    plan: 00
    provides: it.todo() scaffolds for agents-route, agent-squad-panel, agents-view; project.agents.assignedChip i18n key in all 10 locales
  - phase: 04-project-tasks
    plan: 01
    provides: scope-prop pattern (TaskBoardScope) — template applied here as AgentSquadScope
  - phase: 02-navigation-workspace-shell
    plan: 01
    provides: useProjectWorkspace() context with project.id
provides:
  - GET /api/agents?project_id=<id> — union-filtered, LOWER()-deduped agents with assignment_source field and project-scoped taskStats
  - AgentSquadScope interface (lockedProjectId, hideCreateAgent, taskScopeProjectId, showAssignmentBadge) on AgentSquadPanel
  - agents-view.tsx wrapper that embeds AgentSquadPanel in scope mode for the project workspace
affects: [05-VERIFICATION, 05-03 (sessions empty-state CTA can link to /project/<slug>/agents)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scope-prop embed (Phase 4 TaskBoardScope template) extended to AgentSquadPanel — single optional scope prop, undefined = unchanged behavior"
    - "Server-side union filter via SQL with LOWER() dedupe (Pitfall 6) — single query, no client-side merging"
    - "assignment_source via SQL CASE WHEN — derived in the same JOIN, no second query"
    - "Conditional 'AND project_id = ?' in grouped task-stats subquery — re-uses the existing N+1-avoidance shape"

key-files:
  created: []
  modified:
    - src/app/api/agents/route.ts
    - src/components/panels/agent-squad-panel.tsx
    - src/components/project/agents-view.tsx
    - src/app/api/agents/__tests__/agents-route.test.ts
    - src/components/panels/__tests__/agent-squad-panel.test.tsx
    - src/components/project/__tests__/agents-view.test.tsx

key-decisions:
  - "Reused exact LOWER() dedupe SQL from RESEARCH.md Pitfall 6 — no alternative considered (canonical pattern)"
  - "assignment_source 'assigned' precedence implemented via LEFT JOIN + CASE WHEN — no extra query needed"
  - "Scoped taskStats reuse the existing grouped query with a conditional clause — preserves N+1 avoidance"
  - "taskScopeProjectId field kept in AgentSquadScope for API symmetry but not separately wired — current behavior derives task scoping from project_id (which equals lockedProjectId in the workspace flow)"
  - "Tightened invalid-project_id guard: rejects values that parseInt accepts but aren't pure integers (e.g. '12abc') by comparing String(parsed) === raw.trim()"

requirements-completed: [SESS-02]

# Metrics
duration: 6min
completed: 2026-04-14
---

# Phase 05 Plan 01: Project-Scoped Agents View Summary

**SESS-02 implemented end to end: GET /api/agents now accepts project_id and returns the union of project_agent_assignments ∪ tasks.assigned_to (LOWER()-deduped) with an assignment_source field; AgentSquadPanel accepts an AgentSquadScope prop; agents-view.tsx is a thin wrapper embedding the panel in scope mode.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-14T00:58:57Z
- **Completed:** 2026-04-14T01:05:23Z (approx)
- **Tasks:** 3 / 3
- **Files modified:** 6 (3 source + 3 test)

## SQL Query Added

```sql
SELECT a.*,
  CASE WHEN paa.agent_name IS NOT NULL THEN 'assigned' ELSE 'task' END AS assignment_source
FROM agents a
LEFT JOIN project_agent_assignments paa
  ON LOWER(paa.agent_name) = LOWER(a.name)
 AND paa.project_id = ?
WHERE a.workspace_id = ?
  [+ optional AND a.hidden = 0]
  [+ optional AND a.status = ?]
  [+ optional AND a.role = ?]
  AND (
    paa.agent_name IS NOT NULL
    OR LOWER(a.name) IN (
      SELECT DISTINCT LOWER(assigned_to)
      FROM tasks
      WHERE project_id = ? AND assigned_to IS NOT NULL AND workspace_id = ?
    )
  )
ORDER BY a.created_at DESC
LIMIT ? OFFSET ?
```

Plus the grouped task-stats query gains a conditional `AND project_id = ?` when scoped:

```sql
SELECT assigned_to, COUNT(*) AS total, ...
FROM tasks
WHERE workspace_id = ? AND assigned_to IN (?, ?, ...)
  AND project_id = ?  -- only when projectIdFilter !== null
GROUP BY assigned_to
```

## Test Fixtures (Reused Across All 9 SESS-02 Tests)

In-memory schema with workspace_id columns + project_agent_assignments + tasks(project_id, assigned_to). Seeded:

| Agent | Source for project=10 | Tasks (project_id) |
|-------|----------------------|---------------------|
| Aegis (id=1, casing canonical) | assignments['aegis' lowercase] + tasks T-2/T-3 | T-2 (10, assigned), T-3 (10, done), T-4 (20, in_progress), T-6 (NULL, in_progress) |
| Hermes (id=2) | tasks only | T-1 (10, in_progress) |
| Codex (id=3) | none for project 10 | T-5 (20, in_progress) |
| Orphan (id=4) | none | none |
| Hidden (id=5, hidden=1) | none | none |

These fixtures simultaneously exercise: union behavior, Pitfall 6 dedupe (lowercase 'aegis' assignment → canonical 'Aegis' returned), assignment_source precedence (D-03), task-stat scoping, and exclusion of NULL-project tasks.

## AgentSquadScope Interface Shape

```typescript
export interface AgentSquadScope {
  lockedProjectId: number          // required — the project this view is scoped to
  hideCreateAgent?: boolean        // hide "Add Agent" button
  taskScopeProjectId?: number      // documented for symmetry; current behavior derives from project_id
  showAssignmentBadge?: boolean    // render "Assigned" chip on assignment_source==='assigned' cards
}
```

When omitted entirely, the panel behaves identically to today's global Agents view (regression preserved).

## Lines-of-Code Diff Per File

| File | Insertions | Deletions | Net |
|------|-----------:|----------:|----:|
| src/app/api/agents/route.ts | +85 | -22 | +63 |
| src/components/panels/agent-squad-panel.tsx | +37 | -9 | +28 |
| src/components/project/agents-view.tsx | +12 | -8 | +4 |
| src/app/api/agents/__tests__/agents-route.test.ts | +298 | -24 | +274 |
| src/components/panels/__tests__/agent-squad-panel.test.tsx | +207 | -22 | +185 |
| src/components/project/__tests__/agents-view.test.tsx | +105 | -13 | +92 |
| **Total** | **+744** | **-98** | **+646** |

## Task Commits

Each task committed atomically with --no-verify (parallel execution flag, no AI attribution per CLAUDE.md):

1. **Task 1 RED** — `ccafb9d` test(05-01): fill agents-route stubs with real bodies
2. **Task 1 GREEN** — `1a91f93` feat(05-01): extend GET /api/agents with project_id union filter
3. **Task 2 RED** — `e26869a` test(05-01): fill agent-squad-panel stubs with real bodies
4. **Task 2 GREEN** — `9d401c1` feat(05-01): add AgentSquadScope prop to AgentSquadPanel
5. **Task 3 RED** — `ab4a04a` test(05-01): fill agents-view stubs with real bodies
6. **Task 3 GREEN** — `ceb3ed1` feat(05-01): replace agents-view stub with scope-mode wrapper

**Plan metadata commit:** pending after this SUMMARY.

## Test Counts Per File (Post-Implementation)

| File | Tests | Status |
|------|-------|--------|
| src/app/api/agents/__tests__/agents-route.test.ts | 17 | all passing |
| src/components/panels/__tests__/agent-squad-panel.test.tsx | 16 | all passing |
| src/components/project/__tests__/agents-view.test.tsx | 7 | all passing |
| **Total** | **40** | **40 passing, 0 todo, 0 failed** |

## Decisions Made

- **LEFT JOIN + CASE WHEN for assignment_source** — avoids a second round-trip; the JOIN runs once and provides both the membership filter (via the `paa.agent_name IS NOT NULL` predicate in the OR clause) and the source label.
- **LOWER() comparison on both sides of the JOIN and the IN clause** — the only correct way to dedupe across the two case-drift surfaces (assignment table casing vs task `assigned_to` casing vs canonical `agents.name` casing).
- **Tightened project_id parsing** — `Number.parseInt('12abc', 10)` returns 12 (truthy), so we additionally compare `String(parsed) === raw.trim()` to reject mixed-numeric-junk inputs as 400. Otherwise `?project_id=12abc` would silently scope to project 12.
- **Scoped query path is a sibling branch, not a wrapper** — the unscoped query path is byte-identical to the previous implementation; scope-mode lives in its own `if (projectIdFilter !== null)` block. This keeps the regression guard trivially obvious.
- **Test mocks for the API route** — the route imports many lib modules (templates, sync, validation, command, paths, config); we mock the surface area used by GET only (db, auth, rate-limit, agent-sync.enrichAgentConfigFromWorkspace as identity). POST/PUT paths are not exercised here.
- **Assigned-chip slot** — placed inline inside the existing card-header `flex items-center gap-2` row next to runtime_type. Minimum-surface-area edit; no new layout container introduced.

## Deviations from Plan

**One minor adjustment** — the plan's Step B for the route showed an inline `if (projectIdFilter !== null) { query = ...; ... }` pattern that would still call the `db.prepare(query).all(...params)` line below it. To keep both code paths cleanly separated and type-safe, I introduced an explicit `if/else` with each branch building its own `agents` array and parameter list. The behavioral contract is unchanged; the implementation just maps to the plan's intent more directly.

**One test refinement** — Plan 05-00's stub for `taskScopeProjectId` said: `it.todo('fetch URL includes task_project_id=<id> param when scope.taskScopeProjectId is set')`. The plan's actual implementation Step B never adds a `task_project_id` URL param (the API derives task scoping from `project_id`). I rewrote those two tests to assert the actual behavior (project-scoped fetch URL + scoped taskStats from the API response). The `taskScopeProjectId` field stays in the interface for API symmetry — when downstream code wants distinct scoping, the route can be extended without a breaking interface change.

## Verification Performed

- `pnpm vitest run src/app/api/agents/__tests__/agents-route.test.ts src/components/panels/__tests__/agent-squad-panel.test.tsx src/components/project/__tests__/agents-view.test.tsx` → 3 files, 40 tests, all passing.
- `pnpm typecheck` → exit 1 because of an unrelated TS error in `src/components/project/session-detail-view.tsx` owned by Plan 05-02 (running in parallel). My modified files have zero TS errors. (Confirmed via single-file tsc and by inspecting the error path.)
- `pnpm lint src/app/api/agents src/components/panels/agent-squad-panel.tsx src/components/project/agents-view.tsx` → 0 errors. One pre-existing `react-hooks/exhaustive-deps` warning on the `t` function in `useCallback` — same shape as `audit-trail-panel.tsx` and `user-management-panel.tsx`; not introduced by this plan.

## Issues Encountered

None.

## User Setup Required

None.

## Known Stubs

None — all SESS-02 functionality is fully wired. The Agents tab in a project workspace now renders real, project-scoped agent data from the live API.

## Next Phase Readiness

- Plan 05-02 (parallel) — owns its own files (session-detail-view.tsx, project-context detailId, breadcrumb crumb). No collision.
- Plan 05-03 — Sessions view can now confidently link from its empty-state CTA to `/project/<slug>/agents` knowing the destination is a fully functional scoped Agents view.
- Verifier (Phase 5) can validate SESS-02 end-to-end against the running app once 05-02 and 05-03 land.

---
*Phase: 05-sessions-agents*
*Completed: 2026-04-14*

## Self-Check: PASSED

Verified at 2026-04-14T01:05:23Z:

- All 6 modified source/test files exist on disk
- SUMMARY.md exists at .planning/phases/05-sessions-agents/05-01-SUMMARY.md
- All 6 task commits exist in `git log`:
  - ccafb9d test(05-01): agents-route stubs filled
  - 1a91f93 feat(05-01): GET /api/agents project_id union filter
  - e26869a test(05-01): agent-squad-panel stubs filled
  - 9d401c1 feat(05-01): AgentSquadScope prop on AgentSquadPanel
  - ab4a04a test(05-01): agents-view stubs filled
  - ceb3ed1 feat(05-01): agents-view scope-mode wrapper
- Combined vitest run on 3 plan files: 40 passed, 0 todo, 0 failed
