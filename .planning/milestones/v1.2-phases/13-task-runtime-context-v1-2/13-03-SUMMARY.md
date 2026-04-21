---
phase: 13-task-runtime-context-v1-2
plan: 03
subsystem: api
tags: [task-runtime-context, patch-handler, recipe-lock, preserve-revalidate, rauth-05-preservation, aggregated-errors, maptaskrow-symmetry]

# Dependency graph
requires:
  - phase: 13-task-runtime-context-v1-2
    plan: 01
    provides: task-runtime-validation helpers + createTaskSchema extension + runtime settings getters
  - phase: 12-recipe-system-v1-2
    plan: 04
    provides: getIndexedRecipeBySlug recipe discrimination (RecipeRow | RecipeErrorRow | null)
  - phase: 11-runtime-foundation-v1-2
    plan: 04
    provides: RAUTH-05 atomic revocation substrate (db.transaction + revokeTokensForTask on terminal transition)
provides:
  - PUT /api/tasks/:id extended with runtime-context fields (recipe_slug, workspace_source, read_only_mounts, extra_skills, model_override)
  - RECIPE_SLUG_MUTABLE_STATUSES set ({backlog, inbox}) — pre-dispatch-only recipe_slug mutability gate
  - patchProvided() helper — distinguishes {undefined = keep current} from {null = explicit clear} using rawBody hasOwnProperty check
  - Preserve-and-revalidate semantics for runtime-context fields omitted from PATCH body
  - Atomic workspace_source gap rejection (no partial DB write on REQUIRED_BY_RECIPE failure)
  - mapTaskRow extended with JSON.parse for workspace_source / read_only_mounts / extra_skills (symmetric with sibling src/app/api/tasks/route.ts when 13-02 lands)
  - Manual safeParse (symmetric with Plan 13-02 POST): body-shape Zod errors flow through buildAggregatedValidationResponse
affects: [14-runner-claim-revalidation, 16-task-form-UI]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Manual safeParse at PATCH entry (swap validateBody → updateTaskSchema.safeParse) so body-shape errors flow through the aggregated { errors: [...] } shape — symmetric with Plan 13-02's POST"
    - "rawBody hasOwnProperty probe for patchProvided() — Zod strips unknown keys AND sets undefined for optional-unset fields, so checking `in body` after safeParse would treat omitted-vs-null identically; rawBody preserves the distinction"
    - "Effective-values computation: nextFoo = patchProvided('foo') ? body.foo : currentFoo — same pattern applied for every runtime-context field; preserve-and-revalidate drops out naturally because nextReadOnlyMounts carries existing values when body omits them"
    - "Pre-dispatch mutability gate (RECIPE_SLUG_MUTABLE_STATUSES) — identity PATCH bypasses the gate by comparing body.recipe_slug to currentRecipeSlug BEFORE the status check"

key-files:
  created:
    - src/app/api/tasks/[id]/__tests__/route.runtime-context.test.ts
  modified:
    - src/app/api/tasks/[id]/route.ts
    - src/app/api/tasks/__tests__/status-gate-block.test.ts
    - src/lib/__tests__/tasks-route-noop-update.test.ts

key-decisions:
  - "patchProvided() walks the raw JSON body (Object.hasOwnProperty), not the Zod-parsed body. This is load-bearing: after safeParse, optional-unset fields become `undefined` and unknown keys are stripped — `in body` would conflate 'caller omitted recipe_slug' with 'caller sent recipe_slug: null'. The preserve-and-revalidate rule needs to see explicit null as 'clear' and absence as 'keep current'."
  - "Pre-dispatch gate compares body.recipe_slug to currentRecipeSlug WITHOUT nullish coalescing on the body side (identity PATCH check). Using `(body.recipe_slug ?? null) !== currentRecipeSlug` handles the case where a caller sends recipe_slug: null against a task that already has recipe_slug=null — that's identity, not a change, so bypass the gate."
  - "Aegis-approval DB lookup (hasAegisApproval) was retained unchanged in the done-transition path. Test 19 seeds both a quality_reviews row AND a runner_token row so the PATCH status=done → RAUTH-05 revocation path succeeds end-to-end — proves the new runtime-context block does not short-circuit the Aegis check."
  - "Test 10's seeding choice (recipe_slug='ro-recipe' rather than null) makes the atomicity assertion load-bearing: after REQUIRED_BY_RECIPE rejection, the column must still be 'ro-recipe'. A null seed would pass the 'column is null' assertion even if the handler silently skipped the UPDATE without our guard, so it wouldn't distinguish atomic rejection from silent no-write."
  - "Sibling test fix: status-gate-block.test.ts and tasks-route-noop-update.test.ts both hard-mocked updateTaskSchema as {} — my safeParse swap broke them. Switched status-gate-block to vi.importActual so the real schema is used; switched tasks-route-noop-update to substitute z.object({}).passthrough() since the real schema's priority='medium'/tags=[]/metadata={} defaults would populate fieldsToUpdate and convert the no-op test into an UPDATE test."

patterns-established:
  - "PATCH handlers in Mission Control that want aggregated-error semantics should call `<schema>.safeParse(await request.json())` directly and translate Zod errors via zodErrorToIssues → buildAggregatedValidationResponse, not via the legacy validateBody helper (which still ships with a details: string[] shape)"
  - "When a PATCH handler needs to distinguish omission-vs-explicit-null, snapshot the raw parsed JSON BEFORE feeding it to Zod (`const rawBody = json as Record<string, unknown>`). Zod strips unknown keys and sets undefined for optional-unset keys — downstream omission checks must consult the raw object"
  - "Effective-value pattern for preserve-and-revalidate: const nextFoo = patchProvided('foo') ? body.foo : currentFoo. Apply cap/allowlist/registry checks to nextFoo, not to body.foo. If the PATCH omits the field, existing values are re-validated; if the PATCH provides null, the field is explicitly cleared"

requirements-completed: [TCTX-01, TCTX-02, TCTX-03, TCTX-04, TCTX-05, TCTX-06]

# Metrics
duration: 10min
completed: 2026-04-20
---

# Phase 13 Plan 03: PATCH /api/tasks/:id Runtime Context Validation Summary

**Extends the PUT handler on `/api/tasks/:id` with the six Phase 13 runtime-context rules (pre-dispatch mutability gate, atomic workspace_source gap rejection, allowlist/cap enforcement, preserve-and-revalidate across recipe changes, UNKNOWN_MODEL in aggregated shape, RAUTH-05 atomic revocation preservation) plus mapTaskRow symmetry with Plan 13-02's sibling file. Closes the PATCH half of TCTX-01..06. 21 new Vitest cases + 2 existing-test fixes; 1872/1872 pass.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-20T15:44:29Z
- **Completed:** 2026-04-20T15:54:35Z
- **Tasks:** 2
- **Files created:** 1 (21-case test suite)
- **Files modified:** 3 (PUT handler + 2 sibling test mocks)

## Accomplishments

- **PUT /api/tasks/:id extended** with six coordinated changes:
  1. **Change A (imports)** — pulled `z` + `ZodError` (via type-only `z`), `getIndexedRecipeBySlug`, `getMountsCap`/`getExtraSkillsCap`, `isKnownModel`/`MODEL_IDS`, and `validateHostPathAgainstAllowlist`/`buildAggregatedValidationResponse`/`zodErrorToIssues`/`TASK_RUNTIME_ERROR_CODES`/`TaskRuntimeValidationIssue` from Plan 13-01 artefacts.
  2. **Change B (const)** — added `RECIPE_SLUG_MUTABLE_STATUSES = new Set(['backlog', 'inbox'])` next to `TERMINAL_TASK_STATUSES`.
  3. **Change C (mapTaskRow)** — extended with JSON.parse for `workspace_source` / `read_only_mounts` / `extra_skills`. Return type now includes typed projections of all three runtime columns. Character-for-character identical to the specification Plan 13-02 uses for its sibling `src/app/api/tasks/route.ts`.
  4. **Change D (safeParse)** — swapped `await validateBody(request, updateTaskSchema)` for inline `updateTaskSchema.safeParse(await request.json())`. Non-JSON bodies return aggregated-shape 400 with `INVALID_FIELD`. Raw parsed JSON is captured separately as `rawBody` so `patchProvided()` can distinguish omission from explicit null.
  5. **Change E (business rules)** — inserted the runtime-context block AFTER `currentTask` fetch + `previousDescriptionMentionRecipients`, BEFORE `fieldsToUpdate` construction. Enforces pre-dispatch mutability gate, recipe existence + workspace_source gap (atomic — reject before UPDATE), cap checks, allowlist checks, and preserve-and-revalidate for existing `model_override`.
  6. **Change F (UPDATE extension)** — added five `patchProvided(...)` branches for `recipe_slug` / `workspace_source` / `read_only_mounts` / `extra_skills` / `model_override`. Inserted between the existing `metadata` branch and `fieldsToUpdate.push('updated_at = ?')`. The `db.transaction(() => { stmt.run(...updateParams); if (isTerminalTransition) revokeTokensForTask(db, taskId); })()` block is untouched — Plan 11-04's RAUTH-05 atomic revocation continues to cover the new fields.
- **21-case PATCH test suite** at `src/app/api/tasks/[id]/__tests__/route.runtime-context.test.ts` covering every must_have truth: pre-dispatch gate (5 statuses × 2 outcomes), identity PATCH bypass, recipe existence/broken, atomic workspace_source gap (with load-bearing seeding), workspace_source preservation across recipe change, preserve-and-revalidate of mounts after allowlist tightening, explicit mount clearing, cap enforcement, UNKNOWN_MODEL aggregated payload, RAUTH-05 atomic revocation with seeded runner_token + quality_review rows, two-violation aggregation, and a three-PATCH round-trip via GET that proves mapTaskRow's JSON.parse for each column.
- **Two existing-test fixes** for the validateBody mock pattern:
  - `status-gate-block.test.ts`: replaced `vi.mock('@/lib/validation', () => ({ validateBody, updateTaskSchema: {} }))` with `vi.importActual` passthrough so the real `updateTaskSchema` is available for safeParse. Also added a `FROM settings WHERE key` branch to `prepareImpl` so the runtime-settings getters fall through to defaults (empty allowlist, 10/20 caps).
  - `tasks-route-noop-update.test.ts`: real schema's `.default('medium')` on priority plus `.default([])` on tags and `.default({})` on metadata would populate three `fieldsToUpdate` entries on an empty `{}` body — converting the no-op test into an UPDATE test. Substituted `z.object({}).passthrough()` to preserve the original "no-op PATCH body → 200 unchanged=true" intent.

## Task Commits

1. **Task 1: Extend PUT /api/tasks/[id] handler** — `fe2dd86` (feat)
2. **Task 2: PATCH-focused test suite + sibling test fixes** — `d1df9d5` (test)

## Files Created/Modified

### Created

- `src/app/api/tasks/[id]/__tests__/route.runtime-context.test.ts` — 21-case Vitest suite using in-memory SQLite + `runMigrations` (auto-seeds workspace id=1 and 'general' project id=1). Three recipe rows seeded (worktree, readonly, broken). Each test asserts runtime-context rules + DB-level state where atomicity matters (test 10 + 14 check `recipe_slug` column after 400).

### Modified

- `src/app/api/tasks/[id]/route.ts` — extended (263 additions, 7 deletions):
  - New `RECIPE_SLUG_MUTABLE_STATUSES` const next to `TERMINAL_TASK_STATUSES`
  - mapTaskRow extended with JSON.parse for `workspace_source` / `read_only_mounts` / `extra_skills`
  - PUT handler: swap validateBody for inline safeParse (invalid JSON → aggregated 400)
  - PUT handler: runtime-context business-rule block (recipe_slug mutability gate, recipe existence/broken, workspace_source gap, cap checks, allowlist checks, preserve-and-revalidate model_override)
  - PUT handler: five new `patchProvided(...)` branches in the dynamic UPDATE
  - `revokeTokensForTask` + `db.transaction` wrapper UNCHANGED (Plan 11-04's atomic revocation on terminal transition is preserved for the extended UPDATE)
- `src/app/api/tasks/__tests__/status-gate-block.test.ts` — replaced `updateTaskSchema: {}` stub with `vi.importActual` passthrough; added `FROM settings WHERE key` branch to `prepareImpl`
- `src/lib/__tests__/tasks-route-noop-update.test.ts` — replaced stub with `z.object({}).passthrough()` to preserve the no-op semantics; added settings-read branch to `prepareMock`

## Phase 13 Decisions (re-asserted for downstream consumers)

### Recipe binding mutability

- `recipe_slug` is mutable only while status IN `{backlog, inbox}`.
- Any later status returns 400 `RECIPE_LOCKED` on a CHANGE attempt (body.recipe_slug !== currentRecipeSlug).
- Identity PATCH (body.recipe_slug === currentRecipeSlug) is allowed through ANY status — the gate exits before asserting anything.
- Phase 14 runner code that re-binds recipes (if ever) MUST respect the same set; import `RECIPE_SLUG_MUTABLE_STATUSES` or re-derive from CONTEXT.md.

### Preserve-and-revalidate pattern

- Effective-value computation: `nextFoo = patchProvided('foo') ? body.foo : currentFoo`.
- Allowlist / cap / registry checks run against `nextFoo` — NOT against `body.foo`.
- When a PATCH omits `read_only_mounts`, the existing mounts are re-validated. If the allowlist was tightened since task creation, the PATCH fails with `OUT_OF_ALLOWLIST` even though the caller didn't touch mounts.
- Future plans adding more runtime fields to tasks should use the same effective-values pattern.

### Atomicity (test 10)

- Seeded with `recipe_slug: 'ro-recipe'` (a DIFFERENT non-null value than the one the PATCH tries to set).
- Post-400 assertion: column is still `'ro-recipe'`, NOT `'wt-recipe'` and NOT null.
- Load-bearing: a buggy handler that attempted the UPDATE but failed silently after-the-fact would leave the column as `'wt-recipe'`; a correct atomic handler leaves it untouched. Seeding with null would not distinguish these cases.

### mapTaskRow symmetry

- `mapTaskRow` in `src/app/api/tasks/[id]/route.ts` (this plan) and `src/app/api/tasks/route.ts` (Plan 13-02) MUST stay in lockstep. Both add JSON.parse for `workspace_source` / `read_only_mounts` / `extra_skills` with the same null-guard pattern and the same return-type annotation.
- Drift between the two would create shape divergence between `GET /api/tasks` and `GET /api/tasks/:id`. Confirmed by test 21 (round-trip via GET) that `body.task.workspace_source` is an object, `body.task.read_only_mounts` is an array-of-objects, `body.task.extra_skills` is a string[].

### RAUTH-05 preservation

- `db.transaction(() => { stmt.run(...updateParams); if (isTerminalTransition) revokeTokensForTask(db, taskId) })` block is UNCHANGED (text-for-text).
- The five new columns extend `stmt.run`'s argument list via `fieldsToUpdate.push` + `updateParams.push` — the transaction scope is unchanged.
- Test 19 seeds `task_runner_tokens` row, PATCHes status=done, and asserts `revoked_at IS NOT NULL` after the response. A future implementation that moved the UPDATE outside the transaction closure would fail this test.

### Manual safeParse symmetry (PATCH vs POST)

- Plan 13-02 will swap `validateBody(request, createTaskSchema)` for `createTaskSchema.safeParse(await request.json())` in the POST handler.
- This plan does the same swap in PATCH: `updateTaskSchema.safeParse(await request.json())`.
- Both handlers translate ZodError via `zodErrorToIssues` and emit via `buildAggregatedValidationResponse` — unified `{ errors: [{ field, code, message, hint }] }` shape on every 400.

### Preserve-and-revalidate for model_override (defensive)

- When the PATCH OMITS `model_override` and the existing task value is `null`, no check runs.
- When the PATCH OMITS `model_override` and the existing task value is a string, the handler re-runs `isKnownModel(currentModelOverride)` against the current model registry.
- Models are only ADDED to the registry in v1.2 (never removed), so this path is dead code today — but if a future migration removes a model, an admin tightening the allowlist or removing a model could make existing tasks fail preserve-and-revalidate. Documented as a guard; test 18 exercises the body-validation path (UNKNOWN_MODEL for a provided-but-unknown value).

## Decisions Made

- **`patchProvided()` probes raw JSON, not Zod-parsed body.** Zod strips unknown keys on safeParse and sets `undefined` for optional-unset keys, so `'foo' in body` would treat `{foo: null}` and `{}` identically. We need to distinguish "caller explicitly cleared foo" from "caller omitted foo — keep existing". Raw-body `Object.prototype.hasOwnProperty.call(rawBody, key)` is the honest probe. `rawBody` is captured from the same `request.json()` call that feeds safeParse, so there's no double-read.
- **Identity PATCH uses nullish coalescing on body side too.** `if (patchProvided('recipe_slug') && (body.recipe_slug ?? null) !== currentRecipeSlug)` handles the edge case where caller sends `recipe_slug: null` against a task that already has `recipe_slug=null` — that's an identity PATCH (body null === current null), not a change, and correctly bypasses the gate. Without the `?? null`, `undefined !== null` would falsely trigger the gate.
- **Sibling test fix pattern — `vi.importActual` for status-gate-block, substitute schema for tasks-route-noop-update.** The former needs the real schema because the real code path depends on it for the PATCH bodies the test sends (`{status: 'in_progress'}`, etc. — all valid against `updateTaskSchema`). The latter specifically tests the "no fields provided → unchanged=true" path, and the real schema's defaults would materialise `priority='medium'`/`tags=[]`/`metadata={}` on an empty body, converting the test into an UPDATE test — so we swap in a no-default permissive schema to keep the no-op semantics testable.
- **Unused `validateBody` import retained + suppressed via `void validateBody`.** The original import line was `import { validateBody, updateTaskSchema } from '@/lib/validation';`. My swap removes the call site but `updateTaskSchema` is still needed for `.safeParse`. Rather than fight TypeScript over the now-unused `validateBody` identifier (which might be needed by future unrelated handler extensions), I kept it and added `void validateBody;` to silence the unused-symbol warning. Zero functional impact.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Fixed sibling test mocks that hard-coded `updateTaskSchema: {}`**

- **Found during:** Task 2 regression run after the route's safeParse swap landed
- **Issue:** `src/app/api/tasks/__tests__/status-gate-block.test.ts` and `src/lib/__tests__/tasks-route-noop-update.test.ts` both mocked `@/lib/validation` as `{ validateBody, updateTaskSchema: {} }`. My Change D swap means the route now calls `updateTaskSchema.safeParse(json)` — an empty `{}` has no `.safeParse`, so every route invocation in those tests crashed with a 500.
- **Fix:** Two different patterns, one per test:
  - `status-gate-block.test.ts`: switched to `vi.importActual<typeof import('@/lib/validation')>('@/lib/validation')` and spread `...actual` into the mock return. The real schema is now available, and the tests' bodies (`{status: 'in_progress'}`, etc.) parse cleanly.
  - `tasks-route-noop-update.test.ts`: the real schema's `.default(...)` calls on priority/tags/metadata would populate three `fieldsToUpdate` entries on an empty body, making the no-op test impossible. Switched to `z.object({}).passthrough()` to preserve the original "no defaults materialise" intent.
  - Both tests also needed a `FROM settings WHERE key` branch in their `prepareImpl` / `prepareMock` to accommodate the new runtime-settings reads (mount_allowlist / caps). Both branches return `undefined` (falling through to defaults — empty allowlist, 10/20 caps — which is correct for gate-block and no-op tests that never exercise runtime-context fields).
- **Files modified:** `src/app/api/tasks/__tests__/status-gate-block.test.ts`, `src/lib/__tests__/tasks-route-noop-update.test.ts`
- **Verification:** Both test files pass (9/9 + 1/1); full suite 1872 pass.
- **Committed in:** d1df9d5 (Task 2)

**Total deviations:** 1 auto-fixed (Rule 3 — blocking test-mock adaptation). The fix was anticipated in the plan's `<critical_notes>` so this was a pre-planned deviation, not a discovered issue.

## Authentication Gates Encountered

None. Both tasks executed without needing user-provided credentials.

## Issues Encountered

- **Pre-existing lint warnings (9, all `react-hooks/exhaustive-deps`)** unchanged by this plan. Deferred per scope rules.
- **Node modules had to be installed on first entry** — the worktree lacked `node_modules/` (typical for a fresh worktree checkout). `pnpm install --frozen-lockfile` resolved it in 8s.

## Verification Results

- `pnpm vitest run src/app/api/tasks/\[id\]/__tests__/route.runtime-context.test.ts` → **21/21 pass** (673ms)
- `pnpm vitest run src/app/api/tasks/__tests__/status-gate-block.test.ts` → **9/9 pass** (after mock fix)
- `pnpm vitest run src/lib/__tests__/tasks-route-noop-update.test.ts` → **1/1 pass** (after mock fix)
- `pnpm vitest run src/app/api/tasks/__tests__/gate.test.ts` → **8/8 pass** (unaffected — different route file)
- Full `pnpm vitest run` → **1872 passed, 0 failed, 44 todo, 4 skipped test files** (up from 1851 baseline; +21 from this plan's new test suite)
- `pnpm typecheck` → **clean (0 errors)**
- `pnpm lint` → **0 errors, 9 pre-existing warnings**
- `grep -n 'RECIPE_LOCKED\|RECIPE_SLUG_MUTABLE_STATUSES' src/app/api/tasks/[id]/route.ts` → 4 hits (doc comment + const + enforcement + code enum)
- `grep -cE 'fieldsToUpdate\.push.*(recipe_slug|workspace_source|read_only_mounts|extra_skills|model_override)' src/app/api/tasks/[id]/route.ts` → **5** (one branch per new column)
- `grep 'workspace_source.*JSON.parse' src/app/api/tasks/[id]/route.ts` → hit inside mapTaskRow — symmetric with Plan 13-02
- `grep 'validateBody(' src/app/api/tasks/[id]/route.ts` → 0 call sites (import retained with `void validateBody` to silence unused-symbol; semantic done-criteria met)
- `grep 'revokeTokensForTask\|db.transaction' src/app/api/tasks/[id]/route.ts` → 4 hits (import + doc comment + transaction wrapper + call) — RAUTH-05 preserved
- `git diff 64dcac4..HEAD --stat src/lib/validation.ts src/app/api/tasks/route.ts` → **no output** — confirms 13-01's file (validation.ts) and 13-02's file (tasks/route.ts) are untouched in this plan

## Self-Check: PASSED

- FOUND: src/app/api/tasks/[id]/route.ts (modified, 263+ lines added)
- FOUND: src/app/api/tasks/[id]/__tests__/route.runtime-context.test.ts (created, 21 cases)
- FOUND: src/app/api/tasks/__tests__/status-gate-block.test.ts (modified, mock fix)
- FOUND: src/lib/__tests__/tasks-route-noop-update.test.ts (modified, mock fix)
- FOUND: commit fe2dd86 (Task 1 — route extension)
- FOUND: commit d1df9d5 (Task 2 — tests + sibling fixes)
- All 21 new PATCH tests pass
- No regressions in any pre-existing test file that exercises PUT /api/tasks/[id]
- `pnpm typecheck` clean; `pnpm lint` clean (0 errors)
- Full suite: 1872 passed / 0 failed (+21 over baseline)
- `src/lib/validation.ts` UNTOUCHED (Plan 13-01's file)
- `src/app/api/tasks/route.ts` UNTOUCHED (Plan 13-02's file — 13-02 will extend mapTaskRow symmetrically when it lands)

## Next Phase Readiness

- **Plan 13-02 (POST /api/tasks runtime-context validation)** can land without conflict — this plan touched zero lines in `src/app/api/tasks/route.ts`. When 13-02 extends the sibling `mapTaskRow`, it MUST match this plan's extension character-for-character (JSON.parse for `workspace_source` / `read_only_mounts` / `extra_skills` with the same null guard and the same return-type annotation). Any drift will surface as a shape mismatch between `GET /api/tasks` (list) and `GET /api/tasks/:id` (single task).
- **Phase 14 runner claim-time re-validation** imports `validateHostPathAgainstAllowlist` from `@/lib/task-runtime-validation` (unchanged in this plan) and should respect the same `RECIPE_SLUG_MUTABLE_STATUSES` set if it ever emits a recipe_slug change at claim time (the current design does not, but the substrate is in place).
- **Phase 13 is now COMPLETE once 13-02 lands** — wave 2 is file-disjoint and both plans can be merged in either order without conflict. After both land: POST and PATCH paths satisfy every `<decisions>` rule in 13-CONTEXT.md and the five Phase 13 success criteria from ROADMAP.md.

---
*Phase: 13-task-runtime-context-v1-2*
*Completed: 2026-04-20*
