# Phase 11 — Deferred Items

Out-of-scope issues discovered during plan execution. Not caused by this phase's changes — logged here per GSD scope boundary rules.

## Pre-existing typecheck error (Phase 10 origin)

**File:** `src/lib/validation.ts:58`
**Error:**
```
error TS2345: Argument of type '(val: any) => { message: string; }' is not assignable to parameter of type '{ message?: string; ... }'
error TS7006: Parameter 'val' implicitly has an 'any' type
```
**Root cause:** Zod v4 API change — custom error `message: (val) => ...` no longer accepts a closure here.
**First observed:** Introduced by commit `3567675` (feat(gsd10): add hierarchy data model, validation, and conflict detection) during Phase 10 execution.
**Why deferred:** Not caused by Plan 11-03 migrations work; fixing requires a Zod v4 migration review.
**Suggested follow-up:** Open a Beads issue to audit all `z.custom((...) => ({ message }))` call sites and convert to Zod v4's `refine` / `check` API.

## Pre-existing lint warnings

**Scope:** 76 warnings (0 errors) — mostly `react-hooks/exhaustive-deps` false positives against `t` (next-intl translator) and memoisation chains.
**Why deferred:** Not introduced by Plan 11-03. The React 19 + next-intl combination produces noise that predates this phase.
