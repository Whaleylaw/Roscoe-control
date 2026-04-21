---
phase: 17-integration-testing-reference-pipeline
plan: 02
subsystem: testing
tags: [unit-tests, recipe-indexer, mount-allowlist, runner-tokens, auth, checkpoints, zod]

requires:
  - phase: 11-runtime-foundation-v1-2
    provides: runner-tokens, auth principals, model registry
  - phase: 12-recipe-system-v1-2
    provides: recipe-indexer, recipes FTS table, error_message row pattern
  - phase: 13-task-runtime-context-v1-2
    provides: validateHostPathAgainstAllowlist + fs.realpath parent-walk
  - phase: 15-checkpoints-scheduler-v1-2
    provides: CheckpointBodySchema, writeCheckpoint, readCheckpoints
provides:
  - RTEST-01 gap-fill audit + one new edge-case test (empty-string blocker_reason)
  - Top-of-file GAP AUDIT comments for five target test suites
  - Proof that five of six RTEST-01 candidate gaps are already covered
affects: [17-03, 17-04, 17-05, 17-06]

tech-stack:
  added: []
  patterns:
    - "Top-of-file GAP AUDIT comment block — maps RTEST-ID candidates to PRE-EXISTING test line numbers or NEWLY-ADDED entries"
    - "Zero-new-file gap-fill — extensions go INSIDE existing describe blocks, not parallel suites"

key-files:
  created: []
  modified:
    - src/lib/__tests__/recipe-indexer.test.ts
    - src/lib/__tests__/task-runtime-validation.test.ts
    - src/lib/__tests__/runner-tokens.test.ts
    - src/lib/__tests__/auth-runner-token-principal.test.ts
    - src/lib/__tests__/task-checkpoints.test.ts

key-decisions:
  - "Audit before extension: five of six RTEST-01 sharp-edge gap candidates are already covered by Phase 11-15 test suites — only the empty-string (not whitespace-only) blocker_reason case was genuinely missing"
  - "Pitfall 8 guard honored: runner-tokens.test.ts:194 (formerly allowlist-length drift, now 'exactly seven entries') was NOT modified — only top-of-file comment added"
  - "GAP AUDIT documented in-file, not just in SUMMARY: top-of-file comment blocks make every future reader see which RTEST-01 lines are pinned where — no need to cross-reference the planning docs"
  - "Plan text referenced recipe-indexer status='indexed_error'; actual shipped enum uses status='error'. Recorded as a plan-text drift, not a code bug — tests already exercise the real status string"

patterns-established:
  - "GAP AUDIT top-of-file comment: when a plan demands audit-first gap-fill, leave a comment block at the top of the target test file listing each RTEST candidate and its resolution (PRE-EXISTING line-NN / NEWLY-ADDED / SKIPPED out-of-scope). Prevents re-auditing on future plan revisits."
  - "Distinct empty-string vs whitespace-only test cases: z.string().max(N).optional() with a refine() that calls .trim().length > 0 behaves identically for '' and '   ' — but separate test cases pin both branches, since a future schema change (e.g. adding .min(1) to the string itself) would short-circuit the refine for empty strings and only one variant would catch it."

requirements-completed: [RTEST-01]

duration: 4 min
completed: 2026-04-21
---

# Phase 17 Plan 02: RTEST-01 Unit-Test Gap-Fill Summary

**RTEST-01 sharp-edge audit: 5 of 6 candidate gaps pre-existing, 1 newly added (empty-string blocker_reason), zero new test files, line-194 drift untouched per Pitfall 8.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-21T03:01:03Z
- **Completed:** 2026-04-21T03:05:05Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Audited 130 pre-existing tests across five target modules to map RTEST-01 sharp-edge invariants
- Added one new `it(...)` case in `task-checkpoints.test.ts` covering empty-string `blocker_reason` (distinct from the pre-existing whitespace-only variant)
- Annotated all five target files with top-of-file GAP AUDIT comment blocks that map each RTEST-01 candidate to PRE-EXISTING test line numbers
- Confirmed `runner-tokens.test.ts:194` (the historical allowlist-length drift point, now carrying the "seven entries" assertion) was NOT touched
- Verified 131 tests passing across all five files; `pnpm typecheck` clean; lint clean (no new warnings/errors on modified files)

## Task Commits

1. **Task 1 (recipe-indexer + task-runtime-validation + task-checkpoints audit + empty-string gap-fill)** — `8f6ae97` (test)
2. **Task 2 (runner-tokens + auth-runner-token-principal audit annotations)** — `8b0daf8` (test)

## RTEST-01 Coverage Matrix

| # | RTEST-01 Candidate | Module | Status | Location |
|---|---|---|---|---|
| 1 | Malformed YAML → error_message row | recipe-indexer | PRE-EXISTING | `recipe-indexer.test.ts:92-104` ("writes an error row when recipe.yaml has YAML syntax errors") |
| 2 | Unknown `model.primary` rejection (MODEL-02) | recipe-indexer | PRE-EXISTING | `recipe-indexer.test.ts:121-138` ("writes an error row when model.primary is unknown (MODEL-02)") |
| 3 | Symlink escape via `fs.realpath` | task-runtime-validation | PRE-EXISTING | `task-runtime-validation.test.ts:318-328` ("rejects a symlink pointing OUTSIDE the allowlist (defense against symlink escape)") |
| 4 | Exact-moment expiry rejection (`nowUnix === expires_at`) | runner-tokens | PRE-EXISTING | `runner-tokens.test.ts:145-149` (post-annotation line numbers; "returns null at exact expiry moment (strict <= rejection)") |
| 5 | Cross-task 403 via `requireRunnerToken` wrapper | auth-runner-token-principal | PRE-EXISTING | `auth-runner-token-principal.test.ts:265-277` (post-annotation; "cross-task 403 (path)") and `:279-289` ("cross-task 403 (caller param)") |
| 6 | `status=blocked` without `blocker_reason` | task-checkpoints | PRE-EXISTING | `task-checkpoints.test.ts:85-96` (post-annotation; "rejects status=blocked when blocker_reason is missing") |
| 6a | `status=blocked` with empty-string `blocker_reason` | task-checkpoints | **NEWLY ADDED** | `task-checkpoints.test.ts:107-120` (post-annotation; new test) |

**Net delta:** +1 test (empty-string variant), +79 lines of GAP AUDIT comment blocks. Zero new test files, zero new describe blocks.

## Files Created/Modified

- `src/lib/__tests__/recipe-indexer.test.ts` — Added 14-line GAP AUDIT comment block documenting PRE-EXISTING malformed-YAML + unknown-model coverage
- `src/lib/__tests__/task-runtime-validation.test.ts` — Added 12-line GAP AUDIT comment block documenting PRE-EXISTING symlink-escape + trailing-sep + ENOENT-walk coverage
- `src/lib/__tests__/runner-tokens.test.ts` — Added 16-line GAP AUDIT comment block (line 194 preserved — Pitfall 8 discipline)
- `src/lib/__tests__/auth-runner-token-principal.test.ts` — Added 18-line GAP AUDIT comment block documenting PRE-EXISTING 401-vs-403 discrimination coverage
- `src/lib/__tests__/task-checkpoints.test.ts` — Added GAP AUDIT comment + 1 new test case: "rejects status=blocked when blocker_reason is an empty string"

## Decisions Made

- **Audit-first, gap-fill-second:** Read all five target files cover-to-cover before writing any new test. The deviation from the plan's literal "add these cases" language is deliberate: the plan explicitly allowed `"or documented as pre-existing in SUMMARY"` for each acceptance criterion, and re-adding already-covered tests would bloat the suites without increasing coverage.
- **Empty-string as the one genuine gap:** The pre-existing `'   '` (three spaces) test exercises the `.trim().length > 0` branch of the refine clause. The literal `''` test exercises the raw-empty-string branch of the same refine. They compile to the same code path under `.trim()`, but a future schema change (e.g. adding `.min(1)` to the base string schema) would short-circuit one without the other — separate test cases pin both.
- **Plan-text drift left in place:** The plan frontmatter mentions `status='indexed_error'` for the recipe-indexer error row; the shipped code uses `status='error'`. No code change made — the pre-existing tests correctly assert `status === 'error'`, which is the real contract. Drift recorded as a deviation note rather than a code fix.
- **Line-194 untouched:** Per Pitfall 8 and the plan's explicit guard, the runner-tokens.test.ts line-194 allowlist-length assertion was not modified even though it passes cleanly (previous drift has evidently been resolved since 15-04). Preserving the hands-off discipline for future runs.

## Deviations from Plan

### Auto-fixed Issues

None — all plan tasks exercised already-covered invariants. Only one genuinely new test was written (empty-string blocker_reason), which is explicitly listed in the plan as gap-candidate F. No Rule 1-3 auto-fixes were needed; no Rule 4 architectural questions arose.

### Plan-text Deviations (documented, not fixed)

1. **[Plan-text drift] Plan references `status='indexed_error'`; actual enum is `status='error'`**
   - **Found during:** Task 1 (reading `recipe-indexer.ts` for the read_first gate)
   - **Issue:** Plan frontmatter `truths` field says "recipe-indexer rejects malformed YAML with a helpful error_message row (not a throw)" and includes `'indexed_error'` verbatim in the example test body
   - **Resolution:** Left the shipped code untouched; pre-existing tests correctly assert `status === 'error'`. This is a plan-authoring drift from Phase 12-02's `status` enum, not a code bug. Flagging in SUMMARY so a later reader sees the plan-text vs code disagreement
   - **Files modified:** None
   - **Verification:** All 11 recipe-indexer tests pass against the real enum

2. **[Plan acceptance-criteria satisfied via "or documented as pre-existing"]**
   - The plan's acceptance criteria for Task 1 and Task 2 each include the phrase `"or documented as pre-existing"` for every grep assertion. This SUMMARY documents pre-existing coverage verbatim per that escape hatch. No test-body additions were required for 5 of the 6 candidates.

---

**Total deviations:** 0 code-bugs auto-fixed; 2 plan-text drifts documented.
**Impact on plan:** Plan executed as designed. Audit discipline avoided adding ~6 duplicate test cases that would have bloated CI run time without strengthening coverage.

## Issues Encountered

None.

## User Setup Required

None — pure test-suite work.

## Next Phase Readiness

- RTEST-01 invariants all pinned by unit tests: recipe indexing error-row contract, mount-allowlist symlink defense, runner-token strict-expiry boundary, requireRunnerToken 401-vs-403 discrimination, checkpoint schema refine(). All five target files pass `pnpm test`, `pnpm typecheck`, and `pnpm lint` (no new warnings).
- **Plan 17-03 (Integration-test pipeline):** Unit-level contracts RTEST-01 asked for are proven to hold before the integration tests in 17-03/04/05 are written. The boundary-mock integration tests can rely on these invariants as preconditions rather than re-proving them.
- **No blockers** for 17-03 onward.

## Self-Check: PASSED

- All 5 modified test files exist on disk
- SUMMARY.md exists at expected path
- Both task commits (8f6ae97, 8b0daf8) present in git log
- All 131 tests across the 5 target files pass (`pnpm test --run ...`)
- `pnpm typecheck` exits 0
- `pnpm lint` on modified files reports 0 errors (pre-existing project warnings unrelated)
- `runner-tokens.test.ts:194` diff confirms no modification to the allowlist-length assertion line — only a 16-line top-of-file comment added

---
*Phase: 17-integration-testing-reference-pipeline*
*Completed: 2026-04-21*
