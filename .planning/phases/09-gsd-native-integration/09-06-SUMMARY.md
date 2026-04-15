---
phase: 09-gsd-native-integration
plan: 06
subsystem: api
tags: [api, tasks, gate, status, enforcement, gsd, pitfall-ordering]

requires:
  - phase: 09-gsd-native-integration
    plan: 01
    provides: migration 052 gate_required + gate_status columns, Task type extension
  - phase: 09-gsd-native-integration
    plan: 05
    provides: PATCH /api/tasks/:id/gate endpoint (the unblock path the UI will use after GATE_BLOCKED)
provides:
  - Gate-enforcement hook inserted in PUT /api/tasks/:id at line 172
  - 403 response body shape { error, code: 'GATE_BLOCKED', gate_status, gate_required } for UI error handling
  - 9 real assertions replacing 7 it.todo stubs in status-gate-block.test.ts
affects: [09-07, 09-08, 09-09, 09-10]

tech-stack:
  added: []
  patterns:
    - Pitfall ordering — gate-block check runs BEFORE the existing Aegis approval check because gate failure is cheaper (pure row-read) and semantically prior (gate gates even the in_progress transition, while Aegis only gates done)
    - Forward-motion scope — only `normalizedStatus === 'in_progress' || normalizedStatus === 'done'` trigger the gate; all other statuses (backlog, inbox, assigned, awaiting_owner, review, quality_review, failed) bypass per D-31
    - Unblock semantics — `gate_status === 'approved'` is the ONLY unblock state; 'pending', 'rejected', 'not_required' all block forward motion identically (D-32)
    - Test harness — vi.mock over 10 modules with regex-dispatched prepare() stub (SELECT/UPDATE/LEFT JOIN/quality_reviews branches) — single mock serves all nine branches with no per-test statement builder

key-files:
  created: []
  modified:
    - src/app/api/tasks/[id]/route.ts
    - src/app/api/tasks/__tests__/status-gate-block.test.ts
    - .planning/phases/09-gsd-native-integration/deferred-items.md

key-decisions:
  - "Gate-enforcement block placed as the FIRST statement inside `if (normalizedStatus !== undefined)` at src/app/api/tasks/[id]/route.ts line 172 — GATE_BLOCKED at line 184, Aegis at line 192 (gate precedes Aegis in source order per Pitfall ordering intent)"
  - "403 body exposes `gate_status` (string) and `gate_required` (number 1) so clients can render the same error consistently whether gate is 'pending' or 'rejected' — UI can branch on `code === 'GATE_BLOCKED'` for a single error surface"
  - "D-31 verified by THREE dedicated tests (backlog, review, awaiting_owner) covering backward, lateral, and sideways motion — NOT the plan's originally-named 'blocked'/'in_review' which don't exist in the actual schema enum ['backlog','inbox','assigned','awaiting_owner','in_progress','review','quality_review','done','failed']"
  - "Non-gated bypass (gate_required=0) tested with gate_status='not_required' to mirror the default migration-052 row shape — regression proof that additive migration changes nothing for pre-GSD tasks"
  - "Test mock returns quality_reviews.status='approved' so the Aegis check never fires during the 'allows in_progress once approved' test — isolates the gate-block test from Aegis approval coupling"

requirements-completed: [GSD-15, GSD-16]

duration: ~6min
completed: 2026-04-15
---

# Phase 09 Plan 06: Gate Enforcement Hook in PUT Task Handler Summary

**15-line gate-enforcement block inserted at src/app/api/tasks/[id]/route.ts line 172; blocks forward motion (in_progress/done) on gate_required=1 tasks whose gate_status != 'approved' with 403 GATE_BLOCKED; 9/9 tests green.**

## Performance

- **Duration:** ~6 min
- **Tasks:** 1 (TDD: RED → GREEN, no REFACTOR needed)
- **Files modified:** 2 (1 source + 1 test) + 1 deferred-items log entry

## Accomplishments

- Inserted gate-enforcement hook in `src/app/api/tasks/[id]/route.ts` as the first statement inside `if (normalizedStatus !== undefined) {` block; GATE_BLOCKED at line 184 runs BEFORE the existing Aegis approval check at line 192 (Pitfall ordering preserved)
- Replaced 7 `it.todo` stubs in `src/app/api/tasks/__tests__/status-gate-block.test.ts` with 9 real assertions (24 total `expect(...)` calls) covering GSD-15, GSD-16, D-30, D-31, D-32
- 9/9 tests green; `pnpm typecheck` clean for this plan's files (2 pre-existing unrelated TS errors from Plan 09-08 RED scaffolds logged to `deferred-items.md`)
- Zero edits to the Aegis block, status field update, or any other logic in the PUT handler — single-purpose insertion

## Task Commits

1. **Task 1 RED: failing tests for PUT gate enforcement** — `fb4a8e8` (test)
2. **Task 1 GREEN: gate-enforcement hook + deferred items log** — `a064571` (feat)

_Plan metadata commit follows (docs: complete plan)._

## Files Modified

### `src/app/api/tasks/[id]/route.ts` (lines 172-194, +15 lines)

Verbatim insertion from RESEARCH.md lines 757-768, adapted to the existing `currentTask` variable name:

```ts
if (normalizedStatus !== undefined) {
  // Phase 09 — GSD-15, D-30, D-31, D-32: gate enforcement on forward motion
  //   D-31: only 'in_progress' and 'done' are gated; backward/sideways motion
  //         (backlog, review, awaiting_owner, inbox, assigned, etc.) bypasses.
  //   D-32: 'rejected' blocks identically to 'pending' / 'not_required' — only
  //         'approved' unblocks. Ordering: runs BEFORE the Aegis check because
  //         gate failure is cheaper + semantically prior (Pitfall ordering).
  if ((normalizedStatus === 'in_progress' || normalizedStatus === 'done')
      && currentTask.gate_required === 1
      && currentTask.gate_status !== 'approved') {
    return NextResponse.json({
      error: 'This task requires gate approval before it can move forward.',
      code: 'GATE_BLOCKED',
      gate_status: currentTask.gate_status,
      gate_required: 1,
    }, { status: 403 })
  }

  if (normalizedStatus === 'done' && !hasAegisApproval(db, taskId, workspaceId)) {
    return NextResponse.json(
      { error: 'Aegis approval is required to move task to done.' },
      { status: 403 }
    )
  }
  fieldsToUpdate.push('status = ?');
  updateParams.push(normalizedStatus);
}
```

**Source-order invariant:**

| Concern                 | Line |
|-------------------------|------|
| `code: 'GATE_BLOCKED'`  | 184  |
| `Aegis approval is required` | 192 |

Gate check precedes Aegis check. The existing Aegis block is unchanged; the status field update at the bottom of the `if` block is unchanged.

### `src/app/api/tasks/__tests__/status-gate-block.test.ts` (9 real tests, 0 todos)

| # | Scenario | Asserts |
|---|----------|---------|
| 1 | in_progress + gate_required=1 gate_status=pending | 403 + code='GATE_BLOCKED' + body.gate_status='pending' + body.gate_required=1 |
| 2 | done + gate_required=1 gate_status=pending | 403 + code='GATE_BLOCKED' |
| 3 | in_progress + gate_required=1 gate_status=approved | 200 (not 403) — unblock path |
| 4 | backlog + gate_required=1 gate_status=pending | 200 — D-31 backward motion |
| 5 | review + gate_required=1 gate_status=pending | 200 — D-31 lateral motion |
| 6 | awaiting_owner + gate_required=1 gate_status=pending | 200 — D-31 sideways motion |
| 7 | in_progress + gate_required=1 gate_status=rejected | 403 + code='GATE_BLOCKED' + body.gate_status='rejected' — D-32 |
| 8 | in_progress + gate_required=0 gate_status=not_required | 200 — non-gated bypass |
| 9 | 403 body shape | contains gate_status, gate_required=1, error is string |

Test harness: 10 `vi.mock` calls over @/lib/db, @/lib/auth, @/lib/rate-limit, @/lib/validation, @/lib/mentions, @/lib/event-bus, @/lib/logger, @/lib/github-sync-engine, @/lib/gnap-sync, @/lib/config. Single `prepareImpl(sql)` regex-dispatches to the four SQL branches the route touches (SELECT * FROM tasks, SELECT status FROM quality_reviews, UPDATE tasks, SELECT t.* LEFT JOIN projects). Mock returns `{ status: 'approved' }` for quality_reviews so the Aegis check never blocks test 3.

### `.planning/phases/09-gsd-native-integration/deferred-items.md`

Appended 09-06 section logging two pre-existing TS errors introduced by Plan 09-08 RED scaffolds:
- `src/components/panels/task-card/__tests__/gate-badge.test.ts` — TS2307 missing `../gate-badge` + TS2769 NextIntlClientProvider (09-08 will land the component)
- `src/components/project/lifecycle/__tests__/phase-timeline.test.tsx` — TS2307 missing `phase-timeline` module (09-08 will land the component)

Both clear when Plan 09-08 completes. Out of scope for 09-06.

## Decisions Made

See frontmatter `key-decisions` — five logged for STATE.md.

## Deviations from Plan

**None — plan executed exactly as written**, with one minor test-naming adaptation:

- The plan listed D-31 backward-motion test cases as `blocked`, `backlog`, `in_review`. The actual task-status enum in `createTaskSchema` is `['backlog','inbox','assigned','awaiting_owner','in_progress','review','quality_review','done','failed']` — `blocked` and `in_review` don't exist. I substituted `review` (canonical name for the review state), `backlog`, and `awaiting_owner` (the closest sideways motion to `blocked`). All three tests verify the same D-31 invariant: non-forward statuses bypass the gate.

No Rule 1/2/3/4 deviations were required. Not an architectural change — same semantic coverage.

## Issues Encountered

None. RED step produced exactly the expected 4 failures (the 4 gate-block-forward-motion cases); the 5 non-gated cases passed RED because the current code has no gate check and non-gated behavior matches the intended outcome. GREEN step made all 9 pass on first try.

## Out-of-Scope Deferred

Logged to `deferred-items.md` — two pre-existing TS errors in Plan 09-08 RED test scaffolds (not 09-06 files):
- `src/components/panels/task-card/__tests__/gate-badge.test.ts`
- `src/components/project/lifecycle/__tests__/phase-timeline.test.tsx`

Both owned by 09-08. Not touched here.

## User Setup Required

None — enforcement is additive behavior on existing endpoint. Clients that don't set `gate_required=1` see zero change. Clients that do now get a typed 403 with `code: 'GATE_BLOCKED'` to handle.

## Next Phase Readiness

- **Plan 09-07 (task-card UI)** can render the GATE_BLOCKED error by switching on `response.code === 'GATE_BLOCKED'` and displaying a gate-badge action
- **Plan 09-08 (lifecycle panel)** can show gate-required tasks in a "blocked pending approval" list by querying `gate_required=1 AND gate_status IN ('pending','rejected')`
- **Plan 09-05 unblock path is wired:** operator PATCH /api/tasks/:id/gate with `{gate_status:'approved'}` now directly unblocks the next PUT {status:'in_progress'} call (see test 3)
- **Full-stack gate contract locked:** schema (09-01) → PATCH endpoint (09-05) → PUT enforcement (09-06) — ready for UI consumption

## Self-Check: PASSED

- [x] FOUND: src/app/api/tasks/[id]/route.ts (modified — gate block at line 184, Aegis at line 192)
- [x] FOUND: src/app/api/tasks/__tests__/status-gate-block.test.ts (modified — 0 it.todo, 24 expect)
- [x] FOUND: .planning/phases/09-gsd-native-integration/deferred-items.md (modified)
- [x] FOUND commit: fb4a8e8 (RED test)
- [x] FOUND commit: a064571 (GREEN feat + deferred log)
- [x] `pnpm vitest run src/app/api/tasks/__tests__/status-gate-block.test.ts` → 9/9 passed
- [x] Acceptance criteria:
  - [x] grep `code: 'GATE_BLOCKED'` → present
  - [x] grep `.gate_required === 1` → present
  - [x] grep `.gate_status !== 'approved'` → present
  - [x] grep `normalizedStatus === 'in_progress' || normalizedStatus === 'done'` → present
  - [x] grep `Aegis approval is required` → present (preserved)
  - [x] GATE_BLOCKED line (184) < Aegis line (192) — gate precedes Aegis
  - [x] grep -c "it.todo" status-gate-block.test.ts = 0
  - [x] grep -c "expect(" status-gate-block.test.ts = 24 (≥ 8)

---
*Phase: 09-gsd-native-integration*
*Completed: 2026-04-15*
