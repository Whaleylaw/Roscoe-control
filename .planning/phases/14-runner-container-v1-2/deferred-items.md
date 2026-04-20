# Phase 14 — Deferred Items

Log of issues discovered during plan execution that are out-of-scope for the current plan.

## Entries

### 1. TS error in src/app/api/runner/heartbeat/__tests__/route.test.ts line 197 (discovered during Plan 14-06)

- **Error:** `TS2345: Argument of type 'Response' is not assignable to parameter of type 'NextResponse<unknown>'. Type 'Response' is missing the following properties from type 'NextResponse<unknown>': cookies, [INTERNALS]`
- **Source:** Introduced by Plan 14-04 commit `60155f7` (test intentionally casts a plain `Response` to satisfy the mocked `mutationLimiter` return type).
- **Scope:** Belongs to Plan 14-04. Does not block Plan 14-06 tests (the runner-exit suite runs in isolation). Flagging so the fix lands where it originated.
- **Recommended fix:** Cast the mock return value to `NextResponse` via `NextResponse.json(...)` instead of a raw `Response`, OR adjust the mock signature to `vi.fn<() => NextResponse | null>()`.
- **Re-confirmed during Plan 14-05:** `pnpm typecheck` on pure main HEAD (with 14-05 work stashed) still emits this single error; no other typecheck errors exist in the tree.

### 2. TS errors in src/app/api/runner/tasks/[task_id]/runner-exit/__tests__/route.test.ts lines 378/401/422 (discovered during Plan 14-07)

- **Error:** `TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.` (three separate sites)
- **Source:** Pre-existing in the Wave-0 scaffold landed alongside Plan 14-01 migrations (commit `2c0fe32`). Unchanged by Plan 14-07.
- **Scope:** Belongs to Plan 14-06 (runner-exit retry/fail driver) which will rewrite these spread call-sites with real fixtures. Plan 14-07 only implements pure-logic lib modules under `src/lib/` — the runner-exit route tests are untouched by this plan.
- **Recommended fix:** In Plan 14-06, replace the `fn(...args)` spreads with typed fixture objects (or add an explicit tuple cast on the scaffold arrays).
- **Verification:** `pnpm test src/lib/__tests__/runner-preamble.test.ts src/lib/__tests__/runner-worktree-seed.test.ts src/lib/__tests__/runner-docker-args.test.ts src/lib/__tests__/runner-env-file.test.ts src/lib/__tests__/runner-recipe-stage.test.ts -- --run` passes 36/36 regardless. The runner-exit typecheck errors do not block the Plan 14-07 test surfaces.
