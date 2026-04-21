---
phase: 13-task-runtime-context-v1-2
plan: 02
subsystem: api
tags: [api, tasks, post, zod, validation, runtime-context, aggregated-errors, mount-allowlist]

# Dependency graph
requires:
  - phase: 13-task-runtime-context-v1-2
    provides: "task-runtime-validation helpers + task-runtime-settings getters + createTaskSchema extended with 4 new optional fields (recipe_slug, workspace_source, read_only_mounts, extra_skills). Plan 13-01 shipped at 244ba2b/3f66cc3/94863c6."
  - phase: 12-recipe-system-v1-2
    provides: "getIndexedRecipeBySlug discriminated lookup (null / error_message / RecipeRow)"
  - phase: 11-runtime-foundation-v1-2
    provides: "migration 057 tasks runtime columns (recipe_slug, workspace_source, read_only_mounts, extra_skills, model_override) + model-registry isKnownModel refine on createTaskSchema"
provides:
  - "POST /api/tasks accepts and validates all five runtime-context fields end-to-end"
  - "Manual createTaskSchema.safeParse + zodErrorToIssues pattern for aggregated-error compatibility — reusable by Plan 13-03 PATCH handler"
  - "mapTaskRow extended in src/app/api/tasks/route.ts to JSON.parse workspace_source / read_only_mounts / extra_skills on read"
  - "28-column INSERT INTO tasks with 28-placeholder/28-arg signature — future modifications must preserve order"
  - "Route-layer test fixtures (wt-recipe / ro-recipe / broken-recipe seeding + tmpRoot + runtime.* settings helper) — reusable by Plan 13-03 PATCH test suite"
affects: [13-03-PATCH-api-tasks, 14-runner-claim-revalidation, 16-task-form-UI]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Manual Zod safeParse replaces validateBody in a SINGLE endpoint so Phase-13 runtime-context body errors surface through buildAggregatedValidationResponse instead of validateBody's legacy details: string[] shape — leaves the other 60+ validateBody callers untouched"
    - "Invalid JSON body returns aggregated-error 400 with a synthetic INVALID_FIELD issue on field '(root)' — keeps error shape uniform whether the failure is JSON-parse or Zod-shape or business-rule"
    - "Runtime-context business-rule block collects issues into TaskRuntimeValidationIssue[] across recipe lookup, caps, and per-entry allowlist checks, then returns buildAggregatedValidationResponse once at the end — CONTEXT.md 'aggregated in a single 400 Bad Request' decision"
    - "Cap checks pull getMountsCap() / getExtraSkillsCap() at request time — caps are admin-mutable via PUT /api/settings, so closure-freezing them at module eval would mask live config changes"
    - "INSERT column list extended at the END (after workspace_id) — preserves the existing 23-column positional contract for any code reading via column-index, and makes the diff reviewable"

key-files:
  created:
    - "src/app/api/tasks/__tests__/route.runtime-context.test.ts"
  modified:
    - "src/app/api/tasks/route.ts"
  untouched:
    - "src/lib/validation.ts (owned by Plan 13-01)"
    - "src/app/api/tasks/[id]/route.ts (owned by Plan 13-03)"

key-decisions:
  - "Replaced validateBody(request, createTaskSchema) with manual createTaskSchema.safeParse(await request.json()) in the POST handler so all Phase-13 runtime-context body errors (including model_override's isKnownModel refine, base_ref refines, duplicate-label array refine, duplicate-basename array refine) flow through zodErrorToIssues into the aggregated { errors: [...] } shape alongside business-rule errors. Plan 13-03's PATCH handler MUST apply the same pattern (swap validateBody for updateTaskSchema.safeParse + zodErrorToIssues) so the error shape is consistent across both surfaces."
  - "INSERT column list extended from 23 to 28 columns — 28 placeholders, 28 arguments. Order: [existing 23] + recipe_slug, workspace_source, read_only_mounts, extra_skills, model_override. Off-by-one here silently corrupts every row — any future caller modifying POST /api/tasks must count carefully."
  - "mapTaskRow JSON.parses workspace_source / read_only_mounts / extra_skills on read (defaulting to null / [] / [] when the column is NULL for pre-Phase-13 rows). recipe_slug and model_override are TEXT and pass through via ...task spread. Plan 13-03's [id]/route.ts mapTaskRow MUST mirror this character-for-character or GET /api/tasks/:id will return a string where POST /api/tasks returns an object."
  - "Used body.X direct-access rather than extending the 15-deep destructure with five more names — the destructure already hurts more than it helps for frequently-changed code, and body.X reads identically to validated.data.X at the call site."
  - "Test suite uses the vi.mock-hoisted scaffold pattern from src/app/api/recipes/__tests__/post.test.ts. testDb is module-level let so the vi.mock factory closes over it; beforeEach reassigns to a fresh in-memory DB and runs runMigrations. tmpRoot is mkdtemp'd per-test with a 'refs' subpath and an optional /etc symlink-escape (some CI sandboxes deny symlink creation — test 12 no-ops if so)."
  - "Test 20 round-trip asserts via POST response AND the GET /api/tasks list endpoint (both handlers live in src/app/api/tasks/route.ts and share this file's mapTaskRow). Could NOT use GET /api/tasks/:id for this because that handler lives in [id]/route.ts — Plan 13-03's territory, not yet extended at the time this plan runs in parallel wave 2."

patterns-established:
  - "For any endpoint that mixes Zod body shape with Phase-13 runtime-context business rules, prefer manual schema.safeParse + zodErrorToIssues + buildAggregatedValidationResponse over validateBody so every failure class shares { errors: [{ field, code, message, hint }] }. Plan 13-03 PATCH handler is the direct reuse target."
  - "Route-layer integration test scaffold that drives route.POST/GET directly (no HTTP round-trip) via an in-memory better-sqlite3 + runMigrations — hoisted vi.mock for @/lib/db, @/lib/auth, @/lib/rate-limit, @/lib/event-bus, @/lib/mentions, @/lib/github-sync-engine, @/lib/gnap-sync, @/lib/config. Reusable for every future route test that needs a real schema with fabricated data."

requirements-completed: [TCTX-01, TCTX-02, TCTX-03, TCTX-04, TCTX-05, TCTX-06]

# Metrics
duration: 7min
completed: 2026-04-20
---

# Phase 13 Plan 02: POST /api/tasks Runtime Context Validation Summary

**POST /api/tasks extended to accept and validate `recipe_slug`, `workspace_source`, `read_only_mounts`, `extra_skills`, and `model_override`, with all validation errors aggregated into a single 400 `{ errors: [{ field, code, message, hint }] }` response. Persistence extended to 28 columns. Read-side `mapTaskRow` parses the three JSON columns so POST/GET responses round-trip typed objects. Zero changes to `src/lib/validation.ts` — Plan 13-01's territory.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-20T15:43:18Z
- **Completed:** 2026-04-20T15:51:17Z
- **Tasks:** 2
- **Files modified:** 1 (src/app/api/tasks/route.ts)
- **Files created:** 1 (src/app/api/tasks/__tests__/route.runtime-context.test.ts)
- **Files deliberately NOT touched:** src/lib/validation.ts (Plan 13-01), src/app/api/tasks/[id]/route.ts (Plan 13-03)

## Accomplishments

- POST /api/tasks now accepts and validates all five Phase-13 runtime-context fields (`recipe_slug`, `workspace_source`, `read_only_mounts`, `extra_skills`, `model_override`) with aggregated 400 responses across Zod body shape and business-rule layers.
- Swapped `validateBody(request, createTaskSchema)` for a manual `createTaskSchema.safeParse` so every Zod issue (model-registry refine on `model_override`, `base_ref` refines, duplicate-label refinement on `read_only_mounts`, duplicate-basename refinement on `extra_skills`, `recipe_slug` regex) flows through `zodErrorToIssues` into `buildAggregatedValidationResponse`. Invalid JSON body also returns the aggregated shape (synthetic `INVALID_FIELD` on field `(root)`).
- Business-rule pipeline: `getIndexedRecipeBySlug` → (null → RECIPE_NOT_FOUND, `error_message` → RECIPE_BROKEN, `workspace_mode === 'worktree'` without `workspace_source` → REQUIRED_BY_RECIPE); cap checks via `getMountsCap` / `getExtraSkillsCap` (CAP_EXCEEDED); per-entry `validateHostPathAgainstAllowlist` on every `read_only_mounts[].host_path` and every `extra_skills` entry. All issues collected into a single `TaskRuntimeValidationIssue[]`; response returned once.
- INSERT statement extended from 23 to 28 columns (recipe_slug TEXT, workspace_source / read_only_mounts / extra_skills JSON-stringified, model_override TEXT). 28 placeholders / 28 arguments — counted twice.
- `mapTaskRow` extended to JSON.parse the three object/array columns (workspace_source → `{project_id, base_ref} | null`, read_only_mounts → `{host_path, container_path, label}[]`, extra_skills → `string[]`) so POST response and GET /api/tasks list both return typed shapes. `recipe_slug` and `model_override` pass through via `...task` spread.
- 20-case route-level test suite at `src/app/api/tasks/__tests__/route.runtime-context.test.ts` covers every happy + sad path in the plan contract. Suite runs in ~530 ms wall time. Full-project test suite: 1871 pass / 0 fail (up from 1851 baseline — +20 new tests). Typecheck + lint clean.

## Task Commits

1. **Task 1: Extend POST handler with manual Zod parse + recipe lookup + allowlist + caps + aggregated errors + INSERT/mapTaskRow extension** — `b280e62` (feat)
2. **Task 2: Add 20-case route-level test suite** — `84471d5` (test)

**Plan metadata commit:** (final commit after SUMMARY is staged, per execute-plan workflow)

## Files Created/Modified

### Created

- `src/app/api/tasks/__tests__/route.runtime-context.test.ts` — 20-case Vitest suite (~530 ms). Seeds three recipes (wt-recipe worktree-mode, ro-recipe readonly-mode, broken-recipe with error_message); mkdtemp-backed tmpRoot with `refs/` subpath + `escape` symlink (→ /etc) + non-existent `not-yet/file.txt`; runtime.mount_allowlist seeded to `[tmpRoot]` by default; `seedSetting(key, value)` helper for per-test cap / allowlist overrides; drives the route's POST + GET functions directly (no HTTP round-trip).

### Modified

- `src/app/api/tasks/route.ts` — 5 coordinated changes:
  1. Added `z` + 8 new imports from `@/lib/recipe-indexer`, `@/lib/task-runtime-settings`, `@/lib/task-runtime-validation` (`validateHostPathAgainstAllowlist`, `buildAggregatedValidationResponse`, `zodErrorToIssues`, `TASK_RUNTIME_ERROR_CODES`, type `TaskRuntimeValidationIssue`).
  2. Extended `mapTaskRow` with JSON.parse for workspace_source / read_only_mounts / extra_skills (and widened return type).
  3. Replaced the `validateBody(request, createTaskSchema)` call in POST with a manual `createTaskSchema.safeParse` that routes Zod failures through `zodErrorToIssues` and JSON-parse failures through a synthetic `INVALID_FIELD` issue. PUT still uses validateBody with `bulkUpdateTaskStatusSchema` — UNCHANGED.
  4. Inserted the runtime-context business-rule block (recipe lookup, caps, per-entry allowlist) between body parse and `resolveProjectId`, aggregating into `runtimeIssues` and returning `buildAggregatedValidationResponse` once if non-empty.
  5. Extended the `INSERT INTO tasks` statement (23 → 28 columns, 28 placeholders / 28 args) with `recipe_slug`, `workspace_source` (JSON.stringified), `read_only_mounts` (JSON.stringified), `extra_skills` (JSON.stringified), `model_override`. The post-insert re-read SELECT uses `t.*` so the five new columns are picked up automatically.

### Untouched (deliberate)

- `src/lib/validation.ts` — Plan 13-01 owns this file; all four new optional fields (`recipe_slug`, `workspace_source`, `read_only_mounts`, `extra_skills`) are already on `createTaskSchema`. `git diff 64dcac4..HEAD src/lib/validation.ts` returns zero.
- `src/app/api/tasks/[id]/route.ts` — Plan 13-03 owns this file; PATCH handler extension (and the identical `mapTaskRow` mirror) runs in parallel wave 2. No merge conflict on this plan's diff.

## The Manual-safeParse Pattern (mandatory reuse for Plan 13-03)

Replace:
```typescript
const validated = await validateBody(request, createTaskSchema);
if ('error' in validated) return validated.error;
const body = validated.data;
```

With:
```typescript
let body: z.infer<typeof createTaskSchema>  // or updateTaskSchema for PATCH
try {
  const json = await request.json()
  const parsed = createTaskSchema.safeParse(json)
  if (!parsed.success) {
    return buildAggregatedValidationResponse(zodErrorToIssues(parsed.error))
  }
  body = parsed.data
} catch {
  return buildAggregatedValidationResponse([
    {
      field: '(root)',
      code: TASK_RUNTIME_ERROR_CODES.INVALID_FIELD,
      message: 'Request body is not valid JSON',
      hint: 'Send a JSON object with a Content-Type: application/json header.',
    },
  ])
}
```

Why the swap is required (and contained to these two handlers):
- Plan 13-01 locked the aggregated-error shape `{ errors: [{ field, code, message, hint }] }` for ALL Phase-13 runtime-context validation.
- `validateBody` returns `{ error: 'Validation failed', details: string[] }` — a shape used by 60+ other endpoints. Changing it would break them.
- The cleanest fix is to diverge here — and in the PATCH handler — only.
- Plan 13-03's PATCH handler MUST apply this pattern so every Phase-13 API surface returns identical error shapes for identical failure classes. Otherwise a UI could special-case POST responses and break on PATCH.

## INSERT Column Order (locked — 28 placeholders, 28 arguments)

```sql
INSERT INTO tasks (
  title, description, status, priority, project_id, project_ticket_no, assigned_to, created_by,
  created_at, updated_at, due_date, estimated_hours, actual_hours,
  outcome, error_message, resolution, feedback_rating, feedback_notes, retry_count, completed_at,
  tags, metadata, workspace_id,
  recipe_slug, workspace_source, read_only_mounts, extra_skills, model_override
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

Arguments in the same order — the five new values are:
- `body.recipe_slug ?? null`
- `body.workspace_source ? JSON.stringify(body.workspace_source) : null`
- `body.read_only_mounts ? JSON.stringify(body.read_only_mounts) : null`
- `body.extra_skills ? JSON.stringify(body.extra_skills) : null`
- `body.model_override ?? null`

Future plans modifying POST /api/tasks MUST preserve this order — an off-by-one silently corrupts every row. Any new column should be appended at the end, never inserted mid-list.

## mapTaskRow Extension (mandatory mirror for Plan 13-03 [id]/route.ts)

```typescript
function mapTaskRow(task: any): Task & {
  tags: string[]
  metadata: Record<string, unknown>
  workspace_source: { project_id: number; base_ref: string } | null
  read_only_mounts: Array<{ host_path: string; container_path: string; label: string }>
  extra_skills: string[]
} {
  return {
    ...task,
    tags: task.tags ? JSON.parse(task.tags) : [],
    metadata: task.metadata ? JSON.parse(task.metadata) : {},
    workspace_source: task.workspace_source ? JSON.parse(task.workspace_source) : null,
    read_only_mounts: task.read_only_mounts ? JSON.parse(task.read_only_mounts) : [],
    extra_skills: task.extra_skills ? JSON.parse(task.extra_skills) : [],
    ticket_ref: formatTicketRef(task.project_prefix, task.project_ticket_no),
  }
}
```

Plan 13-03's `src/app/api/tasks/[id]/route.ts` must mirror this character-for-character. If the two diverge, GET /api/tasks/:id returns `workspace_source` as a STRING while POST /api/tasks returns it as an OBJECT — a shape inconsistency that breaks every client typechecker.

## Test Fixtures (reusable by Plan 13-03 PATCH suite)

The scaffold in `src/app/api/tasks/__tests__/route.runtime-context.test.ts` is directly reusable by Plan 13-03. Specifically:

- **Three recipe seeds** (wt-recipe / ro-recipe / broken-recipe) covering the three discrimination branches of `getIndexedRecipeBySlug`. Plan 13-03 needs identical seeds to exercise PATCH-with-recipe-change (CONTEXT.md: "preserved across recipe changes and re-validated") and the RECIPE_LOCKED post-assigned branch.
- **tmpRoot scaffold** (`await mkdtemp(join(tmpdir(), 'mc13-'))` + `refs/` subdir + optional `/etc` symlink) used for inside-allowlist, outside-allowlist, symlink-escape, and non-existent-subpath cases. Plan 13-03 can import nothing from this test file but can copy the beforeEach block verbatim.
- **`seedSetting(key, value)` helper** for per-test cap / allowlist overrides with INSERT OR REPLACE semantics.
- **vi.mock hoisting for `@/lib/db`** via a module-level `let testDb` — the factory closes over the let, so `beforeEach` reassigning it feeds fresh state to the route handler's `getDatabase()` call. Use this pattern (not `vi.hoisted`) for route tests.

## Deviations from Plan

**Adjusted test 20 to use GET /api/tasks list instead of GET /api/tasks/:id.**

The plan sketch invoked `GET_BY_ID(request, { params: Promise.resolve({ id: String(taskId) }) })` for the round-trip assertion. That handler lives in `src/app/api/tasks/[id]/route.ts`, which is explicitly off-limits for this plan (Plan 13-03 owns it, parallel wave 2). Its `mapTaskRow` has NOT been extended to JSON.parse the three new JSON columns at the time 13-02 runs, so the test would read `workspace_source` as a string and fail the "is an object" assertion.

Fix: the round-trip uses the POST response (goes through this plan's extended `mapTaskRow`) AND re-fetches via `GET /api/tasks` (the list endpoint in the same `route.ts` file, which also goes through this plan's extended `mapTaskRow`). That proves the DB round-trip end-to-end without touching Plan 13-03's territory. Same TCTX-03 coverage, different handler path.

**Added an `untouched` section to SUMMARY.md frontmatter** (not in the template) to make the "do NOT modify validation.ts / [id]/route.ts" invariant explicit for the orchestrator's post-merge review.

No other deviations — plan executed exactly as written.

## Issues Encountered

**lint: unused eslint-disable directives.** First test-file draft included `// eslint-disable-next-line @typescript-eslint/no-explicit-any` over the `let testDb: any` declaration and the `readBody(res): Promise<any>` helper. eslint-config-next's default config does not flag `any` here, so the directives were flagged as "Unused eslint-disable directive". Removed the directives on `testDb` (retyped as `Database.Database`) and on `readBody` (left as `any` with a short rationale comment, no disable directive).

No other issues.

## Verification Results

- `pnpm exec vitest run src/app/api/tasks/__tests__/route.runtime-context.test.ts` — 20/20 pass, 528 ms
- `pnpm exec vitest run src/lib/__tests__/validation-runtime-fields.test.ts` — 12/12 pass (Plan 13-01 suite, unchanged by this plan)
- `pnpm test` — 1871 pass / 0 fail / 44 todo / 4 skipped (up from 1851 baseline, +20 for this plan)
- `pnpm typecheck` — clean
- `pnpm lint` — 0 errors on changed + new files (pre-existing warnings unrelated to this plan unchanged)
- `git diff 64dcac4..HEAD --stat` — exactly 2 files changed: `src/app/api/tasks/route.ts` (+148/-7) and `src/app/api/tasks/__tests__/route.runtime-context.test.ts` (new, +527)
- `git diff 64dcac4..HEAD -- src/lib/validation.ts` — empty (Plan 13-01 territory untouched)
- `grep 'recipe_slug.*workspace_source.*read_only_mounts' src/app/api/tasks/route.ts` — 1 hit (INSERT column list)
- `grep 'buildAggregatedValidationResponse\|validateHostPathAgainstAllowlist\|zodErrorToIssues' src/app/api/tasks/route.ts` — 8 hits (import + 7 call sites across Zod-body, JSON-parse, recipe, caps, allowlist iterations, and the final return)
- `grep 'getIndexedRecipeBySlug' src/app/api/tasks/route.ts` — 3 hits (import + usage + ReturnType<typeof> in the resolvedRecipe type)

## Self-Check: PASSED

- `src/app/api/tasks/route.ts` exists on disk (modified)
- `src/app/api/tasks/__tests__/route.runtime-context.test.ts` exists on disk (new, 527 lines)
- Both task commits present in git history: b280e62 (Task 1), 84471d5 (Task 2)
- SUMMARY.md created at `.planning/phases/13-task-runtime-context-v1-2/13-02-SUMMARY.md`
- 20 route-runtime-context tests pass
- 12 validation-runtime-fields tests pass (Plan 13-01)
- Full suite: 1871 pass / 0 fail
- `pnpm typecheck` clean
- `pnpm lint` clean on modified + new files
- `src/lib/validation.ts` has zero diff vs base
- `src/app/api/tasks/[id]/route.ts` has zero diff vs base

## Next Phase Readiness

- **Plan 13-03 (PATCH /api/tasks/[id])** is unblocked and genuinely file-disjoint from this plan. Its handler must apply the same manual-safeParse pattern, the same mapTaskRow extension, and (additionally) the recipe-slug mutability gate (CONTEXT.md: "mutable while pre-dispatch, immutable once assigned+" → RECIPE_LOCKED) and the preserve-and-revalidate semantics for existing `model_override` / `read_only_mounts` / `extra_skills` on recipe change.
- **Phase 14 runner re-validation (claim time)** MUST import `validateHostPathAgainstAllowlist` from `@/lib/task-runtime-validation` so create-time and claim-time allowlist resolution are identical. Any divergent resolver would mean a task that passes create-time validation could be rejected at claim — a bad UX and a Phase 13 → Phase 14 contract break.
- **Phase 16 UI** can now send the full runtime-context POST body and expect the aggregated `{ errors: [{ field, code, message, hint }] }` shape. The field paths established here (`read_only_mounts.<i>.host_path`, `extra_skills.<i>`, `workspace_source`, `recipe_slug`, `model_override`) are the exact anchors for per-input error rendering.
- **No blockers.** Wave 2 finishes when Plan 13-03 also ships; phase 13 completes at 3/3 plans.

---
*Phase: 13-task-runtime-context-v1-2*
*Completed: 2026-04-20*
