---
phase: 15-checkpoints-scheduler-v1-2
plan: 01
subsystem: auth
tags: [event-bus, runner-tokens, auth, allowlist, sse, typescript]

# Dependency graph
requires:
  - phase: 11-runtime-foundation-v1-2
    provides: RUNNER_TOKEN_ALLOWLIST shape + runner-token principal (id=-2000) + auth.ts runner-token branch
  - phase: 14-runner-container-v1-2
    provides: runner-token mint/verify/revoke wiring + runner daemon claim path
provides:
  - 6 new EventType union members ready for broadcast from Wave 2 consumers (task.runner_requested, task.container_started, task.container_exited, task.checkpoint_added, recipe.indexed, recipe.removed)
  - 7th RUNNER_TOKEN_ALLOWLIST entry permitting runner-token bearer on POST /api/tasks/:id/checkpoints
  - Extended auth.ts prefix filter allowing the runner-token branch to reach the new allowlist entry (runner-SECRET gate untouched)
  - Test coverage for both additions (28 new unit tests, 2 new test files)
affects: [15-04, 15-05, 15-06, 15-07, 16-progress-tab, 16-runner-status-banner]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase 15 event additions: additive-only union extension (no renames, no removals)"
    - "Runner-token path scope widens via narrow OR filter, not by broadening startsWith prefix"
    - "Allowlist is single source of truth for method+path pairs — auth.ts gate is a cheap prefix filter only"

key-files:
  created:
    - src/lib/__tests__/event-bus.test.ts
    - src/lib/__tests__/runner-tokens-allowlist.test.ts
  modified:
    - src/lib/event-bus.ts
    - src/lib/runner-tokens.ts
    - src/lib/auth.ts

key-decisions:
  - "Phase 15 event additions appended at tail of EventType union (after gsd.conflict.detected) — preserves source diff minimal and matches precedent of grouping by functional area"
  - "runner-tokens.ts preamble comment rewritten to document the CP-01 exception explicitly; the original 'DO NOT add entries' lock language was Phase 11 era — Phase 15 CONTEXT.md formally revokes that lock for exactly one new entry"
  - "auth.ts prefix filter uses narrow OR (isRunnerPath || isCheckpointsTaskPath) rather than broadening /api/runner/ scope — keeps the runner-SECRET gate at line 472 UNCHANGED since runner-secret is not valid on /api/tasks/:id/checkpoints"
  - "Ran test coverage against auth-runner-token-principal.test.ts + auth-runner-principal.test.ts + auth.test.ts to confirm no regressions to the Phase 11-04 / Phase 14 runner-token invariants (50 existing tests still pass after the gate extension)"

patterns-established:
  - "Phase-scoped EventType extensions: append at union tail with inline SCHED-/CP- requirement ID comments"
  - "Allowlist amendment pattern: preamble comment documents each phase's addition with a rationale pointer back to the phase CONTEXT.md § lock — prevents future edits from wondering why the scope grew"
  - "Prefix-filter extensions in auth.ts: narrow regex OR condition + inline rationale comment referencing the CONTEXT.md lock — avoids the temptation to broaden startsWith()"

requirements-completed:
  - CP-01
  - SCHED-06

# Metrics
duration: 4min
completed: 2026-04-20
---

# Phase 15 Plan 01: EventType + Runner-Token Allowlist Foundations Summary

**EventType union extended by 6 additive entries (task.runner_requested, task.container_started, task.container_exited, task.checkpoint_added, recipe.indexed, recipe.removed) and RUNNER_TOKEN_ALLOWLIST + auth.ts runner-token prefix filter extended to accept POST /api/tasks/:id/checkpoints — Wave 2 plans can now compile and authenticate.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-20T22:26:10Z
- **Completed:** 2026-04-20T22:30:47Z
- **Tasks:** 2
- **Files modified:** 3 source files + 2 new test files

## Accomplishments

- Six new EventType union members wired with zero structural change (ServerEvent shape + broadcast signature + eventBus singleton all untouched).
- Seventh RUNNER_TOKEN_ALLOWLIST entry appended with a digit-only id pattern (`/^\/api\/tasks\/(\d+)\/checkpoints\/?$/`) — the original six entries preserved verbatim at positions 0-5.
- auth.ts runner-TOKEN branch (line 526) extended to accept `/api/tasks/:id/checkpoints` in addition to `/api/runner/*`, while runner-SECRET branch (line 472) stays untouched.
- 28 new unit tests (8 for event-bus, 20 for allowlist) exercising both compile-time typing (`satisfies EventType`) and runtime behavior (broadcast fan-out, positive/negative regex matches, method+path combination matrix).
- Zero regressions: 50 existing auth tests (auth-runner-token-principal, auth-runner-principal, auth) still pass.

## Task Commits

Each task committed atomically:

1. **Task 1: Extend EventType union with 6 Phase 15 additions** — `765aace` (feat)
2. **Task 2: Extend RUNNER_TOKEN_ALLOWLIST and auth.ts runner-token gate** — `e0e30e8` (feat)

## Files Created/Modified

### Modified

- `src/lib/event-bus.ts` — Appended 6 new union members to `EventType` after `gsd.conflict.detected` (lines 56–61). Broadcast signature, ServerEvent interface, and singleton bootstrap untouched.
- `src/lib/runner-tokens.ts` — Updated preamble comment (lines 4–17) to document the Phase 15 CP-01 exception; appended 7th allowlist entry `{ method: 'POST', pathPattern: /^\/api\/tasks\/(\d+)\/checkpoints\/?$/ }` at line 26. Functions (hashRunnerToken, issueRunnerToken, verifyRunnerToken, revokeTokensForTask) unchanged.
- `src/lib/auth.ts` — Extended the runner-TOKEN prefix filter at line 526 from a single `startsWith('/api/runner/')` call into `isRunnerPath || isCheckpointsTaskPath`; inline rationale comment references 15-CONTEXT.md lock. Runner-SECRET gate (line 472) untouched. Updated two internal comments ("one of the six" → "one of the" ; "/api/runner/ but NOT" → "matched the prefix filter but NOT the allowlist").

### Created

- `src/lib/__tests__/event-bus.test.ts` — 8 tests: per-type broadcast fan-out (6 × `it.each`), compile-time `satisfies EventType` coverage, regression guard for pre-existing event types.
- `src/lib/__tests__/runner-tokens-allowlist.test.ts` — 20 tests: array length invariant, preservation of original 6 entries, new entry shape, positive regex matches (4 cases), negative regex matches (8 cases), method+path acceptance matrix (10 cases) mirroring the auth.ts consumer.

## Exact Additions (verbatim)

### EventType union — 6 new string literals

```ts
  | 'task.runner_requested'     // SCHED-05 — MC tells runner a recipe-tagged task is ready for claim
  | 'task.container_started'    // SCHED-06 — emitted from POST /api/runner/tasks/:id/container-started
  | 'task.container_exited'     // SCHED-06 — emitted from POST /api/runner/tasks/:id/runner-exit
  | 'task.checkpoint_added'     // SCHED-06 — emitted from POST /api/tasks/:id/checkpoints
  | 'recipe.indexed'            // SCHED-06 — emitted from recipe-watcher scheduleReindex
  | 'recipe.removed'            // SCHED-06 — emitted from recipe-watcher scheduleReindex
```

### RUNNER_TOKEN_ALLOWLIST — new 7th entry

```ts
  // Phase 15 CP-01: literal roadmap path for agent-authored checkpoints.
  { method: 'POST', pathPattern: /^\/api\/tasks\/(\d+)\/checkpoints\/?$/ },
```

### auth.ts gate — before/after

Before:

```ts
if (url.pathname.startsWith('/api/runner/')) {
  const bearer = extractApiKeyFromHeaders(request.headers)
  // ... runner-token matcher ...
}
```

After:

```ts
// Phase 15 (CP-01): runner-token principals MAY authenticate on
//   POST /api/tasks/:id/checkpoints
// in addition to the standard /api/runner/* scope. The allowlist in
// runner-tokens.ts is the single source of truth for method+path pairs;
// this gate is just the cheap prefix filter that decides whether to run
// the allowlist matcher at all. DO NOT broaden — see 15-CONTEXT.md § post-research lock.
const isRunnerPath = url.pathname.startsWith('/api/runner/')
const isCheckpointsTaskPath = /^\/api\/tasks\/\d+\/checkpoints\/?$/.test(url.pathname)
if (isRunnerPath || isCheckpointsTaskPath) {
  const bearer = extractApiKeyFromHeaders(request.headers)
  // ... runner-token matcher (unchanged) ...
}
```

## Decisions Made

- **Tail-append EventType additions** (not grouped with other `task.*` members) — keeps the diff surgical and lets future readers see all Phase 15 additions as one contiguous block.
- **Preamble rewrite on runner-tokens.ts** — the original Phase 11 lock language ("DO NOT add entries in this phase") made the legitimate Phase 15 addition look like a violation. The rewrite preserves the scope-lock intent while documenting the one sanctioned exception with a pointer to 15-CONTEXT.md.
- **Narrow OR in auth.ts (not broadening startsWith)** — preserves runner-SECRET gate at line 472 unchanged, matching the CP-01 constraint that runner-secret is NOT valid on `/api/tasks/:id/checkpoints` (only runner-token is).
- **Digit-only id regex** (`(\d+)` not `(.+)`) — keeps the new entry consistent with the six existing entries and rejects `/api/tasks/abc/checkpoints` at the auth layer before the route handler's id-parsing runs.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- **Pre-existing uncommitted changes in working tree:** At plan start, `src/lib/scheduler.ts` and `src/lib/task-dispatch.ts` had modifications, and two untracked test files (`runner-worktree-resume-marker.test.ts`, `scheduler-reconcile.test.ts`) were present. These belong to later Phase 15 plans (15-02 Task 1 and 15-04/05 respectively, per their file-header comments). Per the scope boundary rule, the 15-01 executor left them untouched and logged them to `.planning/phases/15-checkpoints-scheduler-v1-2/deferred-items.md` for visibility.
- **Transient system-reminder flagging runner-tokens.ts as "reverted"** appeared mid-edit but a re-read confirmed the file was in the expected post-edit state. No corrective action needed.

## Next Phase Readiness

- **Wave 2 plans (15-04, 15-05, 15-06, 15-07)** can now proceed — any `eventBus.broadcast('task.runner_requested', ...)` / `.broadcast('task.container_started', ...)` / etc. call compiles without a TS error, and a runner-token bearer presented to `POST /api/tasks/:id/checkpoints` is now eligible to pass through the auth layer and reach the route handler (handler itself lands in Wave 2 plan 15-04 per the phase manifest).
- **No blockers.** `pnpm typecheck` and the two new test files exit 0; 50 adjacent auth tests still pass.

## Self-Check: PASSED

Verified 2026-04-20T22:30:47Z:

- FOUND: src/lib/event-bus.ts
- FOUND: src/lib/runner-tokens.ts
- FOUND: src/lib/auth.ts
- FOUND: src/lib/__tests__/event-bus.test.ts
- FOUND: src/lib/__tests__/runner-tokens-allowlist.test.ts
- FOUND: .planning/phases/15-checkpoints-scheduler-v1-2/15-01-SUMMARY.md
- FOUND: .planning/phases/15-checkpoints-scheduler-v1-2/deferred-items.md
- FOUND: commit 765aace (Task 1: EventType union)
- FOUND: commit e0e30e8 (Task 2: RUNNER_TOKEN_ALLOWLIST + auth.ts gate)

Test run: 28/28 new tests pass (8 event-bus + 20 allowlist). 50 adjacent
auth tests (auth-runner-token-principal, auth-runner-principal, auth) also
pass with zero regressions. `pnpm typecheck` exits 0.

---
*Phase: 15-checkpoints-scheduler-v1-2*
*Completed: 2026-04-20*
