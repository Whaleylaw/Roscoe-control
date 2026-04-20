---
phase: 15-checkpoints-scheduler-v1-2
plan: 03
subsystem: runner
tags: [runner-worktree, checkpoints, blocker-resume, filesystem, vitest]

requires:
  - phase: 14-runner-container-v1-2
    provides: seedMcDir + resume-preservation semantics (Plan 14-07)
provides:
  - SeedMcDirInput interface with optional resume_marker field
  - seedMcDir appends LOCKED-format marker line to progress.md on resume-after-blocker
  - 8-case unit test file covering all (is_resuming × resume_marker × pre-existing progress.md × defensive fallback) combinations
affects: [15-05, 15-07]

tech-stack:
  added: []
  patterns:
    - "Optional parameter extension that cannot regress Phase 14 callers — omitting resume_marker preserves exact prior behavior"
    - "Marker APPENDED (fs.appendFileSync) to progress.md — never overwrites, never touches checkpoints.jsonl"

key-files:
  created:
    - src/lib/__tests__/runner-worktree-resume-marker.test.ts
  modified:
    - src/lib/runner-worktree.ts

key-decisions:
  - "resume_marker on first attempts (is_resuming=false) is IGNORED, not rejected — first attempts are NEVER marker-prefixed regardless of input"
  - "Marker format emitted VERBATIM with no escaping/sanitisation — blocker_reason is agent-authored, trusted principal per 15-CONTEXT.md"
  - "Marker append happens AFTER the defensive-fallback header write so wiped-worktree + marker stacks correctly (header, then marker line)"
  - "Signature change kept source-compatible — `{ task }` assignable to `{ task, resume_marker? }`, so Phase 14 call sites compile without modification"

patterns-established:
  - "Phase 15 optional-field extensions to Phase 14 primitives: extend the Input type, keep all prior fields required-unchanged, add new field as optional-nullable"

requirements-completed:
  - CP-02
  - CP-04

duration: 4min
completed: 2026-04-20
---

# Phase 15 Plan 03: seedMcDir resume_marker Extension Summary

**Phase 14's seedMcDir gains an optional resume_marker field that appends the LOCKED `<iso> | <<< RESUMED AFTER BLOCKER: <reason> >>>` format line to progress.md on blocker-resume attempts — Phase 14 regression-free.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-20T22:25:54Z
- **Completed:** 2026-04-20T22:30:10Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- Exported new `SeedMcDirInput` interface with `resume_marker?: { blocker_reason, at_iso } | null` field.
- Modified `seedMcDir` to append the LOCKED marker line to progress.md on resume attempts when the marker is present, stacking cleanly on top of both the preserved-existing-content path and the defensive-fallback path.
- 8 new unit tests in `runner-worktree-resume-marker.test.ts` prove every combination of `(is_resuming × resume_marker × pre-existing progress.md × defensive fallback)` — including a byte-for-byte equality assertion on the appended marker line.
- Phase 14 regression suite (`runner-worktree-seed.test.ts`, 10/10 tests) re-run and still passes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend seedMcDir signature with resume_marker + append-on-resume logic** — `2409141` (feat)
2. **Task 2: runner-worktree-resume-marker test file** — `85af186` (test)

**Plan metadata commit:** pending (this SUMMARY.md + STATE.md + ROADMAP.md update)

## Signature Change (before / after)

### Before (Phase 14)

```ts
export function seedMcDir(worktreePath: string, input: { task: McTaskJson }): void
```

### After (Phase 15 Plan 03)

```ts
export interface SeedMcDirInput {
  task: McTaskJson
  /**
   * Phase 15 CP-04: when the task resumes AFTER a blocker, the marker
   * is appended as a single visible line to progress.md. Ignored on
   * first attempts (is_resuming=false). Null / undefined means no marker.
   */
  resume_marker?: { blocker_reason: string; at_iso: string } | null
}

export function seedMcDir(worktreePath: string, input: SeedMcDirInput): void
```

**Source compatibility:** `{ task }` is assignable to `SeedMcDirInput` because `resume_marker` is optional — every Phase 14 caller (Plan 14-07's stage pipeline) compiles unchanged.

## Marker Format (LOCKED)

```
<at_iso> | <<< RESUMED AFTER BLOCKER: <blocker_reason> >>>
```

Concrete example as rendered in progress.md after append:

```
2026-04-21T12:00:00Z | <<< RESUMED AFTER BLOCKER: API key rotation pending >>>
```

Line terminator is a single `\n`. No leading newline is added — the caller is responsible for ensuring the prior content in progress.md already ends with `\n` (Phase 14 header is `"# Progress — Task <id>\n\n"` which satisfies this).

## Phase 14 Regression Confirmation

`pnpm test src/lib/__tests__/runner-worktree-seed.test.ts --run` exits 0 with 10/10 passing. No Phase 14 test required modification — every assertion remained valid because the signature is source-compatible and the default behavior (no `resume_marker`) is identical to Phase 14.

Independently, `pnpm test src/lib/__tests__/runner-worktree-resume-marker.test.ts --run` exits 0 with 8/8 passing.

## Where resume_marker Will Originate in Plan 15-05

Plan 15-05 (Wave 2 — blocker flow) wires this filesystem contract to the HTTP dispatch pipeline:

1. When an agent POSTs a `status: blocked` checkpoint (Plan 15-02), the `task_checkpoints` row persists `blocker_reason` alongside the `blocked` status.
2. When the owner moves the task back to `assigned`, the scheduler's existing SCHED-05 emission path re-emits `task.runner_requested`.
3. The daemon claims the resumed task via `POST /api/runner/claim/:task_id`. Inside the claim handler, the dispatch-payload builder queries:
   ```sql
   SELECT blocker_reason, ts
   FROM task_checkpoints
   WHERE task_id = ? AND status = 'blocked'
   ORDER BY id DESC
   LIMIT 1
   ```
   and attaches the result to the dispatch payload as `resume_marker: { blocker_reason, at_iso: <ISO of the ts> }`.
4. The runner daemon, upon receiving the claim response with `is_resuming=true`, passes the entire `resume_marker` object verbatim into `seedMcDir({ task, resume_marker })`.
5. On first attempts and resumes-without-blocker-history, the `resume_marker` field is simply absent (or `null`) and seedMcDir falls through to the existing Phase 14 paths.

This plan's contract ensures Plan 15-05 can focus solely on the blocker state machine and the SQL query — no further runner-worktree changes are needed for CP-04 compliance.

## Files Created/Modified

- **Created** `src/lib/__tests__/runner-worktree-resume-marker.test.ts` — 8-case vitest suite asserting marker format and all 8 state combinations byte-for-byte.
- **Modified** `src/lib/runner-worktree.ts` — added `SeedMcDirInput` interface and extended `seedMcDir` with marker-append logic; preserved every Phase 14 semantic (first-attempt header, resume-preservation, defensive fallback, .gitignore rewrite).

## Decisions Made

- **resume_marker ignored on first attempts.** Chose silent no-op rather than throw. First-attempt callers may legitimately pass the field (Plan 15-05 may carry the same payload across both code paths to keep dispatch uniform); a throw would force callers to gate on `is_resuming`. A silent no-op keeps the filesystem contract narrow.
- **Marker emitted verbatim — no escaping.** 15-CONTEXT.md defers content-sanitisation to a future phase, accepting the agent as a trusted principal. A `\n` embedded inside `blocker_reason` would split the marker across two lines, but the agent posts via a JSON body where newlines are valid JSON string contents — a later phase may add a normalisation step without changing this filesystem contract.
- **fs.appendFileSync used (not `writeFileSync` with prior-read + concat).** Simpler, atomic on POSIX, never exceeds memory for large progress.md files.

## Deviations from Plan

None - plan executed exactly as written.

The plan's `<interfaces>` block had a minor inaccuracy (claimed `mcDir/progressPath/checkpointsPath/gitignorePath` were already-exported helpers; they are in fact internal to `runner-worktree.ts`). This did not require any code change — `seedMcDir` already reuses them internally, which is the behavior the plan intended.

The plan's example showed `McTaskJson.task_id: number`; the actual type is `string`. The test file uses the correct `string` type (`'42'` not `42`). This does not constitute a deviation — the plan explicitly deferred exact type details to the file's actual definition.

## Issues Encountered

- `pnpm typecheck` fails globally with a pre-existing error in `src/lib/scheduler.ts:13` (`reconcileRunnerHeartbeat` not exported from `task-dispatch`). This error is OUT OF SCOPE for Plan 15-03 — it originates from concurrent Wave 1 plan work on scheduler/task-dispatch modules that Plan 15-03 does not touch. A per-file typecheck of `src/lib/runner-worktree.ts` alone passes (aside from two false-positive ESM-interop warnings from standalone `tsc` invocation — the project-configured `tsc --noEmit` with `esModuleInterop: true` resolves them). The affected files (`scheduler.ts`, `task-dispatch.ts`, `auth.ts`, `runner-tokens.ts`) will reach a coherent type state once all Wave 1 plans land.

## Next Phase Readiness

- **Plan 15-05 (Wave 2, blocker flow)** has the full filesystem contract it needs. The claim-route daemon dispatch payload build is the sole remaining integration point.
- **Plan 15-07 (Wave 4, integration tests)** can consume this contract directly via end-to-end scenarios that post a `blocked` checkpoint, move the task to `assigned`, and assert the progress.md marker line appears after the container resumes.

---

## Self-Check: PASSED

Verified 2026-04-20:

- `src/lib/runner-worktree.ts` — FOUND (modified, includes `SeedMcDirInput` interface and `RESUMED AFTER BLOCKER` marker literal)
- `src/lib/__tests__/runner-worktree-resume-marker.test.ts` — FOUND (created, 8 `it(...)` cases)
- Commit `2409141` (Task 1) — FOUND in `git log --oneline`
- Commit `85af186` (Task 2) — FOUND in `git log --oneline`
- `pnpm test src/lib/__tests__/runner-worktree-resume-marker.test.ts --run` — 8/8 PASS
- `pnpm test src/lib/__tests__/runner-worktree-seed.test.ts --run` — 10/10 PASS (Phase 14 regression-free)

---
*Phase: 15-checkpoints-scheduler-v1-2*
*Completed: 2026-04-20*
