---
phase: 09-gsd-native-integration
plan: 05
subsystem: api
tags: [api, tasks, gate, approval, sse, event-bus, gsd, audit-log]

requires:
  - phase: 09-gsd-native-integration
    plan: 01
    provides: taskGatePatchSchema (Zod) + EventType union 'task.gate.changed' + migration 052 gate_* columns
provides:
  - PATCH /api/tasks/:id/gate endpoint (operator/admin only)
  - Task GET contract assertion — all three read paths surface gsd_phase + gate_* fields via SELECT t.*
  - Real assertions replacing 11 it.todo stubs across 2 test files
affects: [09-06, 09-07, 09-08, 09-09, 09-10]

tech-stack:
  added: []
  patterns:
    - Pitfall 6 double-broadcast — 'task.gate.changed' for GSD-specific listeners + 'task.updated' so existing task-board SSE listeners refresh without any client changes
    - Read-path audit confirms all task GET handlers use SELECT t.* (list, detail, project-scoped) — migration 052 columns flow through automatically, no SQL changes required
    - Test harness: vi.mock over @/lib/auth + @/lib/db + @/lib/validation with role-aware requireRoleMock implementation override per test

key-files:
  created:
    - src/app/api/tasks/[id]/gate/route.ts
  modified:
    - src/app/api/tasks/__tests__/gate.test.ts
    - src/app/api/tasks/__tests__/tasks-gsd-fields.test.ts

key-decisions:
  - "Pitfall 6 double-broadcast implemented verbatim per RESEARCH.md lines 704-746 — eventBus.broadcast('task.gate.changed', …) then eventBus.broadcast('task.updated', {...updated, workspace_id}) so the existing task-board SSE subscribers refresh with zero client-side changes"
  - "Read-path audit: all three task GET handlers (src/app/api/tasks/route.ts line 83-90, src/app/api/tasks/[id]/route.ts line 62-67, src/app/api/projects/[id]/tasks/route.ts line 55-61) already use SELECT t.* — no SQL edits required. Added SELECT t.* lock assertions in tests to guard against future refactors"
  - "Gate row lookup + update + re-fetch done in three prepared statements (SELECT / UPDATE / SELECT) mirroring the existing PUT /api/tasks/[id] pattern — single workspace_id scope on every query prevents cross-workspace gate flips"
  - "NO_GATE (gate_required=0) returns 400 before any state change; TASK_NOT_FOUND returns 404 — both include a `code` field on the response body for typed client-side error handling"
  - "db_helpers.logActivity called with type 'task_gate_changed', actor=auth.user.username, description=`Gate <status>[: note]`, detail={gate_status, note} — matches existing activity-log entry shape"

requirements-completed: [GSD-04, GSD-05, GSD-11, GSD-12, GSD-13, GSD-28]

duration: ~6min
completed: 2026-04-15
---

# Phase 09 Plan 05: Gate PATCH Endpoint + Task GET GSD Fields Summary

**PATCH /api/tasks/:id/gate lands with Pitfall 6 double-broadcast; task GET read-paths verified to surface gsd_phase + gate_* fields via SELECT t.* — 14/14 tests green.**

## Performance

- **Duration:** ~6 min
- **Tasks:** 2
- **Files created:** 1 (route)
- **Files modified:** 2 (test files)

## Accomplishments

- Created `src/app/api/tasks/[id]/gate/route.ts` — operator/admin-only PATCH handler that flips gate_status, records gate_approved_by + gate_approved_at atomically, emits both semantic and generic events (Pitfall 6)
- Replaced 8 it.todo stubs in `gate.test.ts` with real assertions covering viewer 403, operator approve/reject, Zod enum rejection, NO_GATE 400, TASK_NOT_FOUND 404, double-broadcast verification, and logActivity contract
- Replaced 3 it.todo stubs in `tasks-gsd-fields.test.ts` with 6 real tests — 3 field-presence tests + 3 `SELECT t.*` lock assertions across all three task GET handlers
- Read-path audit: confirmed all three task GET endpoints already use `SELECT t.*` — zero SQL changes required for GSD-04/GSD-13

## Task Commits

1. **Task 1 RED: failing test for gate PATCH** — `2b10520` (test)
2. **Task 1 GREEN: PATCH /api/tasks/:id/gate endpoint** — `544f66e` (feat)
3. **Task 2: task GET gsd field coverage tests** — `d93859b` (test)

_Plan metadata commit follows (docs: complete plan)._

## Files Created/Modified

### `src/app/api/tasks/[id]/gate/route.ts` (new, 112 lines)

PATCH handler:
- `requireRole(request, 'operator')` guard (D-09, GSD-12) — viewer → 403
- `mutationLimiter(request)` rate-limit check
- `ensureTenantWorkspaceAccess(db, tenantId, workspaceId, ...)` — cross-tenant defense
- `validateBody(request, taskGatePatchSchema)` → `{ gate_status: 'approved'|'rejected', note? }`
- SELECT `* FROM tasks WHERE id = ? AND workspace_id = ?` — 404 if missing, 400 NO_GATE if `gate_required=0`
- UPDATE `tasks SET gate_status, gate_approved_by, gate_approved_at, updated_at` with `Math.floor(Date.now() / 1000)` for unix seconds
- `db_helpers.logActivity('task_gate_changed', 'task', taskId, auth.user.username, `Gate <status>[: note]`, {gate_status, note}, workspaceId)`
- **Pitfall 6 double-broadcast:**
  - `eventBus.broadcast('task.gate.changed', { task_id, gate_status, actor, note, workspace_id })` — semantic event for GSD-aware listeners (GSD-28, D-34)
  - `eventBus.broadcast('task.updated', { ...updated, workspace_id })` — so existing task-board SSE listeners refresh without any client code changes
- Returns `{ task: updated }`
- Catches `ForbiddenError` → 403, generic error → 500

### `src/app/api/tasks/__tests__/gate.test.ts` (8 real tests, 0 todos)

| # | Test | Asserts |
|---|------|---------|
| 1 | viewer → 403 | requireRole override returns {error, status:403} |
| 2 | operator approve | row.gate_status='approved', gate_approved_by='opuser', gate_approved_at ∈ [before, after] |
| 3 | operator reject with note | row.gate_status='rejected'; logActivity call args include 'task_gate_changed' + 'incomplete' |
| 4 | gate_status='pending' | 400 (validateBody mock returns validation error) |
| 5 | gate_required=0 | 400 code:'NO_GATE' |
| 6 | missing task | 404 code:'TASK_NOT_FOUND' |
| 7 | success double-broadcast | broadcast called 2× with 'task.gate.changed' + 'task.updated' |
| 8 | success logActivity | first call arg[0] === 'task_gate_changed' |

### `src/app/api/tasks/__tests__/tasks-gsd-fields.test.ts` (6 real tests, 0 todos)

| # | Handler | Assertion |
|---|---------|-----------|
| 1 | GET /api/tasks | each task has gsd_phase, gate_required, gate_status, gate_approved_by, gate_approved_at; GSD task has phase='plan'/required=1/pending, non-GSD task has null/0/not_required |
| 2 | GET /api/tasks | SELECT captures `FROM tasks t` contains `SELECT t.*` (migration 052 columns flow through) |
| 3 | GET /api/tasks/:id | task object includes all 5 GSD fields with expected values |
| 4 | GET /api/tasks/:id | SELECT matches `SELECT t.*` |
| 5 | GET /api/projects/:id/tasks | each task in projects-scoped list has all 5 GSD fields |
| 6 | GET /api/projects/:id/tasks | SELECT matches `SELECT t.*` |

Read-path audit also captured inside test block comments so future refactors see the intent.

## Decisions Made

See frontmatter `key-decisions` — five logged for STATE.md.

## Deviations from Plan

None — plan executed exactly as written. Read-path audit confirmed the RESEARCH Pitfall 1 happy-path assumption (all three handlers use `SELECT t.*`), so no SQL edits were required.

## Issues Encountered

1. **`stmt.all is not a function` during list-endpoint test** — root cause: my first-pass `sql.includes('SELECT COUNT(*)')` matched the main `GET /api/tasks` query because it contains a `(SELECT COUNT(*) ...)` correlated subquery for comment_count. Fixed by tightening to `^\s*SELECT\s+COUNT\(\*\)\s+as\s+total` (anchored regex) so only the pagination COUNT query matches the `{get}` branch.
2. **TypeScript error on `mockImplementationOnce` returning `{error, status}`** — `vi.fn` inferred the return type from the default implementation. Fixed by declaring an explicit `AuthResult` union type and typing `requireRoleMock` as `vi.fn<(req, role) => AuthResult>`.

Both were fixed inline per Rule 1 (bugs in my own test scaffolding). No architectural changes.

## Out-of-Scope Deferred

Observed during full-suite test run, unrelated to this plan (parallel-wave plans own them):
- `src/app/api/projects/__tests__/projects-crud-gsd.test.ts` failures — owned by plan 09-02 (project PATCH validator errors)
- `src/lib/gsd-templates.ts` TS2352 — owned by plan 09-03 (template loader type)

Not fixed here — stays in their respective plans.

## User Setup Required

None — endpoint is additive.

## Next Phase Readiness

- **Wave 3 UI plans (09-07 task-card, 09-08 lifecycle-panel)** can now POST to `PATCH /api/tasks/:id/gate` with `{ gate_status, note? }` and rely on the double-broadcast to update the task board automatically
- **Wave 2e (09-06 status gate-block)** can reference gate_status='approved' as the unblock condition
- GSD field coverage on task GET is locked — any future switch to explicit column lists will fail two tests

## Self-Check: PASSED

- [x] FOUND: src/app/api/tasks/[id]/gate/route.ts
- [x] FOUND: src/app/api/tasks/__tests__/gate.test.ts (modified, 0 it.todo)
- [x] FOUND: src/app/api/tasks/__tests__/tasks-gsd-fields.test.ts (modified, 0 it.todo)
- [x] FOUND commit: 2b10520 (test RED)
- [x] FOUND commit: 544f66e (feat GREEN)
- [x] FOUND commit: d93859b (test task 2)
- [x] pnpm vitest run …gate.test.ts …tasks-gsd-fields.test.ts → 14/14 passed
- [x] pnpm typecheck clean for this plan's files
- [x] Acceptance criteria: PATCH export, operator role, gate_approved_by+gate_approved_at SET, NO_GATE/TASK_NOT_FOUND codes, 2 eventBus.broadcast, logActivity call, 0 it.todo in both test files

---
*Phase: 09-gsd-native-integration*
*Completed: 2026-04-15*
