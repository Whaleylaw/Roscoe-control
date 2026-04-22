---
phase: 19-project-scoped-queue-plan-activation
verified: 2026-04-21T21:35:00Z
status: passed
score: 5/5 Success Criteria verified (plus 3/3 REQ-IDs, 24/24 must-have truths)
---

# Phase 19: Project-Scoped Queue & Plan Activation Verification Report

**Phase Goal:** Operators can poll a queue scoped to a single project/plan/wave, and flipping a plan to `in_progress` deterministically activates its linked execution tasks into claimable queue state.

**Verified:** 2026-04-21T21:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Success Criteria (from ROADMAP.md)

| #   | Success Criterion                                                                                                                                                                         | Status     | Evidence                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /api/tasks/queue?project_id=<id>` (and/or `gsd_plan_id`, `wave`) scopes reads + atomic claim; per-scope capacity checks.                                                             | ✓ VERIFIED | `src/app/api/tasks/queue/route.ts:88-134` parses all three params + cross-filter 400; lines 138-225 apply scope to current-task SELECT, capacity COUNT, and atomic UPDATE subquery via the `(? IS NULL OR …)` idiom (no capacity leak).  |
| 2   | `GET /api/tasks/queue` with no scoping params returns same result set and capacity semantics as v1.2 (workspace-level preserved).                                                         | ✓ VERIFIED | `(? IS NULL OR …)` reduces to TRUE for every clause when params absent. Unit test `preserves unscoped v1.2 behavior when no scoping params are provided (COMPAT-01)` + E2E test `preserves v1.2 behavior when no scoping params` pass.   |
| 3   | Plan transition to `in_progress` activates linked tasks, returns `queue_activation` with counts, emits `gsd.plan.tasks_activated`.                                                        | ✓ VERIFIED | `src/app/api/gsd/plans/[plan_id]/transition/route.ts:151-278` defines `QueueActivation` type with all 6 fields, wraps in `db.transaction()`, broadcasts `gsd.plan.tasks_activated` after commit. 7 vitest cases cover every bucket path. |
| 4   | Plan activation respects dependency, gate, and same-wave conflict checks — a blocked transition does not activate.                                                                        | ✓ VERIFIED | Transition route lines 74-148 perform gate/dependency/wave-conflict checks BEFORE the activation block (lines 162+). Vitest `gate-blocked transition performs NO activation` (line 707) asserts DB state unchanged on 409.               |
| 5   | `openapi.json`, `scripts/mc-cli.cjs`, `scripts/mc-mcp-server.cjs` reflect new scoping params.                                                                                             | ✓ VERIFIED | openapi.json:8564-8592 documents `project_id`/`gsd_plan_id`/`wave` query params + inline 400; openapi.json:6742-6807 documents `queue_activation` oneOf [object, null]. mc-cli.cjs:678 + mc-mcp-server.cjs:380,393-395 forward `wave`.   |

**Score:** 5/5 Success Criteria verified

### Observable Truths (aggregated from all three plans' `must_haves`)

| #   | Truth                                                                                                                                    | Plan  | Status     | Evidence                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Unscoped poll returns identical v1.2 results and capacity semantics (COMPAT-01).                                                          | 19-01 | ✓ VERIFIED | vitest `preserves unscoped v1.2 behavior …` passes. E2E `preserves v1.2 behavior when no scoping params are provided (COMPAT-01)` passes.                  |
| 2   | `?project_id` scopes returned/claimed tasks to that project.                                                                              | 19-01 | ✓ VERIFIED | Route lines 144, 175, 207 apply `(? IS NULL OR project_id = ?)`. E2E `respects project_id queue scoping filter` passes.                                    |
| 3   | `?gsd_plan_id` scopes returned/claimed tasks to that plan.                                                                                | 19-01 | ✓ VERIFIED | Route lines 145, 176, 208 apply `(? IS NULL OR gsd_plan_id = ?)`. Covered by vitest cross-filter test (`resMatching` path with matching project_id).       |
| 4   | `?wave=<n>` scopes returned/claimed tasks via `gsd_plans.wave`.                                                                           | 19-01 | ✓ VERIFIED | Route lines 146, 177, 209 apply `(? IS NULL OR gsd_plan_id IN (SELECT id FROM gsd_plans WHERE wave = ?))`. vitest `applies wave filter against gsd_plans.wave` passes. |
| 5   | project_id + gsd_plan_id + wave compose with AND semantics.                                                                                | 19-01 | ✓ VERIFIED | All three clauses appended to the same WHERE/ORDER-preserved SQL; each added param strictly narrows.                                                      |
| 6   | Cross-filter mismatch returns 400 naming plan_id + both projects.                                                                         | 19-01 | ✓ VERIFIED | Route lines 110-134 look up plan's project; 400 with message containing plan_id, plan.project_id, requested project_id. vitest cross-filter test asserts all three numeric substrings. |
| 7   | Capacity check uses same scoping filters as claim query (no scope leak).                                                                  | 19-01 | ✓ VERIFIED | Lines 169-187 apply identical `(? IS NULL OR …)` trio as claim query. E2E `capacity check is scoped per filter set` passes.                                |
| 8   | Atomic claim subquery respects all scoping filters.                                                                                       | 19-01 | ✓ VERIFIED | Lines 199-225 apply identical scoping bindings inside the UPDATE subquery. No SELECT-then-UPDATE race.                                                   |
| 9   | Plan `in_progress` activates linked execution tasks (`gsd_plan_id = planId`).                                                             | 19-02 | ✓ VERIFIED | Transition route lines 173-180 SELECT all linked tasks for the plan; lines 210-256 bucket and UPDATE activatable rows.                                   |
| 10  | Only `{backlog, todo}` source states activate; `{awaiting_owner, failed, review, in_progress}` never auto-activate.                       | 19-02 | ✓ VERIFIED | Lines 212, 244-256 strict source set; UPDATE WHERE `status IN ('backlog','todo')` guards. vitest case #1 asserts exact counts.                          |
| 11  | Tasks with `assigned_to != NULL` OR `recipe_slug != NULL` → `assigned`; otherwise → `inbox`.                                              | 19-02 | ✓ VERIFIED | Lines 217-224 predicate. vitest case #2 (`routes assigned_to tasks to 'assigned', recipe-tagged tasks to 'assigned', unassigned to 'inbox'`) asserts each branch. |
| 12  | Recipe-tagged task routes to `assigned` WITHOUT synthesizing assignee (`assigned_to` stays NULL).                                         | 19-02 | ✓ VERIFIED | Lines 239-242 explicit null-preservation branch.                                                                                                         |
| 13  | Dead assignee (agent `status='error'` or missing row) → clear `assigned_to`, route to `inbox`, count as `reassigned`.                     | 19-02 | ✓ VERIFIED | Lines 226-237 agent lookup; SUMMARY 19-02 documents the `error`-vs-`disabled` schema mapping decision.                                                   |
| 14  | Tasks already in `{inbox, assigned}` counted as `already_active`, NOT re-updated (idempotent).                                            | 19-02 | ✓ VERIFIED | Lines 251-252. vitest case `counts already-inbox/assigned tasks as already_active without re-updating` asserts `updated_at` unchanged.                   |
| 15  | Tasks in out-of-set states counted as `skipped_by_state`, never auto-activated.                                                           | 19-02 | ✓ VERIFIED | Lines 253-255. vitest case #1 asserts `skipped_by_state === 4` for seeded awaiting_owner+review+in_progress+failed.                                      |
| 16  | Response body carries full `queue_activation` payload shape.                                                                              | 19-02 | ✓ VERIFIED | Lines 290-295 return `queue_activation: queueActivation` (type QueueActivation with all 6 fields at lines 151-158).                                      |
| 17  | `gsd.plan.tasks_activated` event emits with same payload shape as response.                                                               | 19-02 | ✓ VERIFIED | Lines 270-279 broadcast with `queue_activation: queueActivation`. vitest case `emits gsd.plan.tasks_activated event with full queue_activation payload`. |
| 18  | Gate/dependency/wave-conflict blocked transitions do NOT activate (pre-write guards still win).                                           | 19-02 | ✓ VERIFIED | Lines 74-148 return early with 409 before activation. vitest `gate-blocked transition performs NO activation` asserts DB state unchanged.                |
| 19  | Plan UPDATE + task activations wrapped in single `db.transaction()` — errors roll back.                                                   | 19-02 | ✓ VERIFIED | Lines 166-259 define `runActivation = db.transaction(…)`; lines 168-170 plan UPDATE inside the txn; line 261 invokes.                                    |
| 20  | `openapi.json` documents scoping params on GET /api/tasks/queue.                                                                          | 19-03 | ✓ VERIFIED | openapi.json lines 8564-8592 (three new parameter entries) + lines 8641-8654 inline 400 response.                                                       |
| 21  | `openapi.json` documents `queue_activation` response on transition endpoint with full shape.                                              | 19-03 | ✓ VERIFIED | openapi.json lines 6742-6807 with `oneOf: [object, null]` and all 6 fields + `by_status{inbox, assigned}`.                                               |
| 22  | CLI `pnpm mc tasks queue` accepts `--project`, `--plan`, `--wave`.                                                                        | 19-03 | ✓ VERIFIED | scripts/mc-cli.cjs:676-678 composes all three into query string. Help text line 92 shows `--project 42 --plan 27 --wave 1`.                              |
| 23  | MCP `mc_poll_task_queue` accepts `project_id`, `gsd_plan_id`, `wave` input properties.                                                    | 19-03 | ✓ VERIFIED | scripts/mc-mcp-server.cjs:378-380 inputSchema properties; lines 387-395 handler forwarding.                                                              |
| 24  | Legacy MCP callers omitting `wave` continue to function identically.                                                                      | 19-03 | ✓ VERIFIED | undefined/null/empty-string guard at line 393 preserves bare `?agent=` URL; symmetrical with existing project_id/gsd_plan_id pattern.                    |

**Score:** 24/24 truths verified

### Required Artifacts

| Artifact                                                        | Expected                                                                                                         | Exists | Substantive | Wired | Status     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ | ----------- | ----- | ---------- |
| `src/app/api/tasks/queue/route.ts`                              | Scoped GET endpoint with project_id/gsd_plan_id/wave + cross-filter 400                                          | ✓      | ✓ (246 lines, all three filters applied in 3 queries) | ✓ (called from CLI, MCP, E2E, unit tests) | ✓ VERIFIED |
| `src/app/api/gsd/plans/[plan_id]/transition/route.ts`           | Plan transition with spec-compliant activation, event, full response payload                                     | ✓      | ✓ (303 lines, db.transaction, QueueActivation type, 4-counter buckets) | ✓ (consumed by GSD plans routes, vitest suite) | ✓ VERIFIED |
| `src/lib/event-bus.ts`                                          | EventType union extended with `gsd.plan.tasks_activated`                                                         | ✓      | ✓ (line 62 literal present)                             | ✓ (used by transition route broadcast)        | ✓ VERIFIED |
| `src/app/api/tasks/__tests__/queue-route.test.ts`               | Mandatory route-handler vitest: wave filter, cross-filter 400, missing-plan 400, COMPAT-01                       | ✓      | ✓ (4 tests, 229 lines)                                  | ✓ (vitest auto-discovers via `__tests__` dir) | ✓ VERIFIED |
| `src/app/api/gsd/__tests__/phase-plan-routes.test.ts`           | 7+ vitest cases covering counters, routing, idempotence, gate guard, event emission, non-in_progress null-return | ✓      | ✓ (21 tests including 7 new activation cases)           | ✓ (vitest auto-discovers)                      | ✓ VERIFIED |
| `tests/task-queue.spec.ts`                                      | E2E COMPAT-01, project_id scoping, capacity-per-scope (+ 2 skipped with TODO pointers)                           | ✓      | ✓ (5 test blocks; 2 intentionally `test.skip` with TODO pointers to vitest file, per plan 19-01) | ✓ (Playwright auto-discovers `tests/*.spec.ts`) | ✓ VERIFIED |
| `scripts/mc-cli.cjs`                                            | `tasks queue --wave <n>` flag support                                                                            | ✓      | ✓ (line 678 + help text line 92)                        | ✓ (invoked via `pnpm mc`)                     | ✓ VERIFIED |
| `scripts/mc-mcp-server.cjs`                                     | `mc_poll_task_queue` tool with wave input                                                                        | ✓      | ✓ (line 380 schema + line 393-395 handler)              | ✓ (registered in tools array)                 | ✓ VERIFIED |
| `openapi.json`                                                  | Queue scoping params + queue_activation response + inline 400                                                    | ✓      | ✓ (three param entries + 6-field queue_activation with oneOf null + inline 400) | ✓ (valid JSON, served at `/docs`)             | ✓ VERIFIED |

### Key Link Verification

| From                                                        | To                                    | Via                                                    | Status    | Details                                                                                 |
| ----------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------- |
| queue route (claim UPDATE)                                  | `gsd_plans` table (wave column)        | correlated subquery                                    | ✓ WIRED   | `gsd_plan_id IN (SELECT id FROM gsd_plans WHERE wave = ?)` at route line 209            |
| queue route (cross-filter validation)                       | `gsd_plans.project_id` resolution      | JOIN gsd_plans→gsd_phases→gsd_milestones→projects     | ✓ WIRED   | Route lines 110-134 — uses `p.id AS project_id` (post Rule 1 fix `0e2e072`)             |
| queue route unit test                                       | GET handler                            | `NextRequest` stub + `db.prepare()` seeding           | ✓ WIRED   | queue-route.test.ts lines 141-227 — 4 tests, all pass                                   |
| plan-transition route                                       | `tasks` UPDATE                         | `db.transaction()` wrapping plan UPDATE + task UPDATEs | ✓ WIRED   | Lines 166-259 of transition route                                                       |
| plan-transition route                                       | `gsd.plan.tasks_activated` broadcast   | direct emit after transaction commits                 | ✓ WIRED   | Lines 270-279 (post-commit) with full `queue_activation` payload                        |
| plan-transition response body                               | `queue_activation` payload             | `NextResponse.json({ plan, …, queue_activation })`    | ✓ WIRED   | Lines 290-295                                                                           |
| `EventType` union                                           | broadcast call site                    | TypeScript literal-union membership                    | ✓ WIRED   | `event-bus.ts:62` contains the literal; `pnpm typecheck` passes cleanly                 |
| CLI `tasks queue` handler                                   | GET /api/tasks/queue                   | URLSearchParams composition with --project/--plan/--wave | ✓ WIRED | mc-cli.cjs lines 676-678                                                                |
| MCP `mc_poll_task_queue`                                    | GET /api/tasks/queue                   | inputSchema + handler forwarding                      | ✓ WIRED   | mc-mcp-server.cjs lines 378-395                                                         |
| openapi.json transition response                            | `queue_activation` schema              | inline `oneOf [object, null]` with 6 required fields  | ✓ WIRED   | openapi.json lines 6742-6807                                                            |

### Requirements Coverage

| Requirement  | Source Plans       | Description                                                                                         | REQUIREMENTS.md row | Status       | Evidence                                                                                       |
| ------------ | ------------------ | --------------------------------------------------------------------------------------------------- | ------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| **QUEUE-01** | 19-01, 19-03       | GET /api/tasks/queue scoped polling + CLI/MCP/OpenAPI reflection                                    | `[x]` line 22       | ✓ SATISFIED  | Truths #1-8, #20, #22-23 all VERIFIED. REQUIREMENTS.md line 101 `Complete`.                   |
| **QUEUE-02** | 19-02, 19-03       | Plan in_progress transition activates linked tasks + queue_activation payload + event emission      | `[x]` line 23       | ✓ SATISFIED  | Truths #9-19, #21 all VERIFIED. 21/21 vitest tests pass. REQUIREMENTS.md line 102 `Complete`.  |
| **COMPAT-01**| 19-01, 19-03       | Workspace-level queue polling preserved when no scoping params provided                             | `[x]` line 53       | ✓ SATISFIED  | Truth #1 VERIFIED via both vitest (COMPAT-01 test) and Playwright E2E. REQUIREMENTS.md line 114 `Complete`. |

No orphaned requirements — all IDs mapped to this phase in REQUIREMENTS.md (line 125) appear in at least one PLAN's `requirements` frontmatter.

### Anti-Patterns Found

| File                                                         | Line | Pattern                                    | Severity | Impact                                                                                                                      |
| ------------------------------------------------------------ | ---- | ------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `tests/task-queue.spec.ts`                                   | 146  | `test.skip('respects wave filter …')`      | ℹ️ Info   | Intentional per Plan 19-01 Part B direction — mandatory coverage lives in `src/app/api/tasks/__tests__/queue-route.test.ts` (4 tests passing). Not a blocker. |
| `tests/task-queue.spec.ts`                                   | 157  | `test.skip('400 on cross-filter …')`       | ℹ️ Info   | Intentional per Plan 19-01 Part B direction — mandatory coverage lives in the vitest route-handler file. Both TODO-documented.                                |

No TODO/FIXME/placeholder markers found in any of the four live source files touched by Phase 19 (`queue/route.ts`, `transition/route.ts`, `event-bus.ts`, or test files). No `console.log` leftovers. No empty return-stubs.

### Human Verification Required

None. All Success Criteria were verifiable programmatically via:
- Direct code inspection of route handlers
- Passing vitest suites (4/4 queue-route + 21/21 phase-plan-routes)
- `pnpm typecheck` exits 0
- `node scripts/verify-runtime-docs.mjs` → 10/10 checks passed
- openapi.json parses as valid JSON
- CLI + MCP scripts load as valid CommonJS
- All 3 REQ-IDs ticked in REQUIREMENTS.md line 22/23/53 + status `Complete` in lines 101/102/114
- E2E behavior directly covered by route-handler vitest tests with in-memory SQLite seeding

A future full end-to-end acceptance run (Phase 23 / ACCEPT-01) will exercise the full activation → claim → blocker → resume loop through the documented contract. That is out of scope for Phase 19 per ROADMAP.md.

### Gaps Summary

No gaps. The phase delivered:

- A scoped queue endpoint (`GET /api/tasks/queue`) supporting `project_id`, `gsd_plan_id`, and `wave` query params — applied consistently to the current-in-progress lookup, capacity count, and atomic claim subquery — with loud 400 on cross-filter project/plan mismatch and byte-equivalent v1.2 behavior when unscoped.
- A spec-compliant plan-transition activation side effect (`POST /api/gsd/plans/:id/transition` → `in_progress`) that moves linked backlog/todo tasks into inbox/assigned with a full 6-field `queue_activation` payload, single-transaction atomicity, dead-assignee recovery, and a `gsd.plan.tasks_activated` event mirroring the response shape.
- CLI, MCP, and OpenAPI surfaces documenting and forwarding the new scoping params and response shape — all backward-compatible when params are omitted.
- Mandatory non-skippable vitest coverage at the route-handler layer for both QUEUE-01 (wave filter + cross-filter 400 + COMPAT-01 unscoped path) and QUEUE-02 (7 activation-semantics test cases), closing the coverage gap that the Playwright harness cannot reach (no REST helper for seeding `gsd_plans` rows).

All SUMMARY.md commit hashes (`5523158`, `0e2e072`, `d9bf040`, `439905a`, `077bb07`, `02c2ab2`, `a2f9d85`) were verified in the repository history. The known deferred-item (`deferred-items.md`) was a WIP typecheck error in 19-02's scope that 19-02 subsequently resolved — current `pnpm typecheck` exits 0.

---

_Verified: 2026-04-21T21:35:00Z_
_Verifier: Claude (gsd-verifier)_
