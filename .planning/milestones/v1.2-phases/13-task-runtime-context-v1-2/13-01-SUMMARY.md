---
phase: 13-task-runtime-context-v1-2
plan: 01
subsystem: api
tags: [zod, fs-realpath, settings, validation, task-runtime-context, mount-allowlist]

# Dependency graph
requires:
  - phase: 11-runtime-foundation-v1-2
    provides: model-registry (isKnownModel, MODEL_IDS) + createTaskSchema.model_override refine
  - phase: 10-gsd-hierarchical-model
    provides: settings table (migration 010)
provides:
  - getMountAllowlist / getMountsCap / getExtraSkillsCap typed settings getters
  - validateHostPathAgainstAllowlist — realpath + prefix-match with parent-walk on ENOENT
  - buildAggregatedValidationResponse — CONTEXT.md locked 400 error shape { errors: [{ field, code, message, hint }] }
  - zodErrorToIssues — ZodError → TaskRuntimeValidationIssue[] translator (maps model-registry refine → UNKNOWN_MODEL)
  - TASK_RUNTIME_ERROR_CODES enum
  - WorkspaceSourceSchema, ReadOnlyMountSchema, readOnlyMountsArraySchema, extraSkillsArraySchema
  - createTaskSchema extended with 4 new optional fields (recipe_slug, workspace_source, read_only_mounts, extra_skills)
  - updateTaskSchema inherits all 4 via .partial()
  - Three new runtime.* keys in /api/settings settingDefinitions
affects: [13-02-POST-api-tasks, 13-03-PATCH-api-tasks, 14-runner-claim-revalidation, 16-task-form-UI]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dynamic admin-mutable caps (settings table) instead of Zod-frozen constants — getMountsCap/getExtraSkillsCap read per call, so caps can be changed via PUT /api/settings without restart"
    - "Aggregated-error response shape for runtime-context validation — all issues collected into one 400 { errors: [...] }, divergent from validateBody's 'details: string[]' shape"
    - "Parent-directory-walk realpath for not-yet-existing paths — preserves symlink semantics while accepting future worktree targets (CONTEXT.md: existence NOT enforced at task creation)"

key-files:
  created:
    - src/lib/task-runtime-settings.ts
    - src/lib/task-runtime-validation.ts
    - src/lib/__tests__/task-runtime-settings.test.ts
    - src/lib/__tests__/task-runtime-validation.test.ts
    - src/lib/__tests__/validation-runtime-fields.test.ts
  modified:
    - src/app/api/settings/route.ts
    - src/lib/validation.ts

key-decisions:
  - "Moved createTaskSchema extension from Plan 13-02 into 13-01 so Plans 13-02 (POST handler) and 13-03 (PATCH handler) are genuinely file-disjoint and can run in parallel in wave 2 — neither needs to touch src/lib/validation.ts"
  - "Plan's grep pattern in done-criteria missed that validateHostPathAgainstAllowlist is declared `async function` — all 8 expected exports are present; the 7-hit count from the grep is harmless (async prefix not in pattern)"
  - "Allowlist entries that fail to realpath are silently skipped (not logged per-call) — a misconfigured entry should not spam logs on every validation and should not bypass allowlist checks; it simply doesn't admit anything"

patterns-established:
  - "TaskRuntimeValidationIssue interface: { field, code, message, hint? } — locked shape for Phase 14 runner re-validation to emit identical payloads"
  - "TASK_RUNTIME_ERROR_CODES enum as SCREAMING_SNAKE const assertion — shared vocabulary between API validation (13-02/13-03), runner claim (14), and future UI error mapping (16)"
  - "Hoisted vi.hoisted() + const vi.fn() spies for tests mocking @/lib/logger + @/lib/db — pattern replicated in task-runtime-settings.test.ts, works around Vitest's vi.mock hoisting + top-level-const timing"
  - "seedSetting helper: INSERT OR REPLACE INTO settings (key, value, category, updated_at) VALUES (?, ?, 'runtime', unixepoch()) — pattern for downstream test files that need to seed runtime settings"

requirements-completed: [TCTX-01, TCTX-02, TCTX-03, TCTX-04, TCTX-05, TCTX-06]

# Metrics
duration: 10min
completed: 2026-04-19
---

# Phase 13 Plan 01: Task Runtime Context Validation Substrate Summary

**Zod schemas + allowlist resolver + aggregated-error helper for task runtime-context validation, with createTaskSchema extended so Plans 13-02/13-03 can run in parallel without touching src/lib/validation.ts**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-19T15:39:26Z
- **Completed:** 2026-04-19T15:49:50Z
- **Tasks:** 3
- **Files modified:** 2 (settings route + validation.ts)
- **Files created:** 5 (2 lib modules + 3 test files)

## Accomplishments

- Three new admin-mutable runtime settings landed in /api/settings (`runtime.mount_allowlist`, `runtime.read_only_mounts_cap`, `runtime.extra_skills_cap`) with JSON-array and numeric defaults, category `'runtime'`, surfaced by existing GET/PUT handlers with zero migration work.
- Typed settings getters (`getMountAllowlist`, `getMountsCap`, `getExtraSkillsCap`) read via the same prepared-statement pattern used by scheduler.ts / hook-profiles.ts; malformed JSON or non-numeric caps log warnings and fall back to defaults so a corrupted settings row can't brick task creation.
- `validateHostPathAgainstAllowlist` resolves via `fs.realpath` with parent-directory walk on ENOENT, then prefix-matches against the allowlist with trailing-sep subtree-of semantics (so `/foo` does not admit `/foo-other`). Symlink-escape defense: a symlink pointing outside the allowlist resolves to its target's realpath and is rejected.
- `buildAggregatedValidationResponse` returns the CONTEXT.md-locked shape `{ errors: [{ field, code, message, hint }] }` at HTTP 400. `zodErrorToIssues` translates ZodError arrays and maps the Phase-11 model-registry refine message to `UNKNOWN_MODEL`.
- `createTaskSchema` extended with four new optional fields (`recipe_slug`, `workspace_source`, `read_only_mounts`, `extra_skills`) composing the schemas exported from task-runtime-validation. `updateTaskSchema = createTaskSchema.partial()` inherits them automatically.
- 57 new Vitest cases total (12 settings + 33 validation helpers + 12 schema shape), all passing. Full suite 1851 pass / 0 fail (up from 1794). Typecheck clean. Lint clean on all new files.

## Task Commits

1. **Task 1: Register runtime settings + typed getter module** - `244ba2b` (feat)
2. **Task 2: Create task-runtime-validation helpers + aggregated-error response** - `3f66cc3` (feat)
3. **Task 3: Extend createTaskSchema with 4 new runtime fields** - `94863c6` (feat)

**Plan metadata commit:** TBD (final commit after SUMMARY + STATE + ROADMAP updates)

## Files Created/Modified

### Created

- `src/lib/task-runtime-settings.ts` — typed getters for the three runtime.* settings rows (admin-mutable via PUT /api/settings); defaults 10 / 20 / `[]`; malformed values log `logger.warn` and fall back.
- `src/lib/task-runtime-validation.ts` — Zod schemas (WorkspaceSourceSchema, ReadOnlyMountSchema, readOnlyMountsArraySchema, extraSkillsArraySchema), `validateHostPathAgainstAllowlist`, `buildAggregatedValidationResponse`, `zodErrorToIssues`, `TASK_RUNTIME_ERROR_CODES`, `type TaskRuntimeValidationIssue`, `type AllowlistResult`.
- `src/lib/__tests__/task-runtime-settings.test.ts` — 12 cases covering default / hit / malformed paths for all three getters, with `vi.hoisted` + vi.fn() spies for logger mock.
- `src/lib/__tests__/task-runtime-validation.test.ts` — 33 cases covering every Zod schema, allowlist resolver (symlink + parent-walk + trailing-sep + OUT_OF_ALLOWLIST + ALLOWLIST_EMPTY), aggregated-error response, and ZodError translation.
- `src/lib/__tests__/validation-runtime-fields.test.ts` — 12 cases covering createTaskSchema / updateTaskSchema with the four new runtime fields.

### Modified

- `src/app/api/settings/route.ts` — added three entries to `settingDefinitions` under the new `// Runtime (task-runtime-context, Phase 13 — TCTX-04, TCTX-06)` comment block. No changes to GET / PUT / DELETE handlers.
- `src/lib/validation.ts` — added relative import of WorkspaceSourceSchema / readOnlyMountsArraySchema / extraSkillsArraySchema from `./task-runtime-validation`; added 4 optional fields to `createTaskSchema` immediately before `metadata`. `model_override` (Phase 11) unchanged; `updateTaskSchema = createTaskSchema.partial()` unchanged — inherits via partial().

## Import Paths for Plans 13-02 / 13-03

Plans 13-02 (POST /api/tasks) and 13-03 (PATCH /api/tasks/[id]) will use:

```typescript
import {
  validateHostPathAgainstAllowlist,
  buildAggregatedValidationResponse,
  readOnlyMountsArraySchema,
  extraSkillsArraySchema,
  WorkspaceSourceSchema,
  zodErrorToIssues,
  TASK_RUNTIME_ERROR_CODES,
  type TaskRuntimeValidationIssue,
} from '@/lib/task-runtime-validation'

import {
  getMountAllowlist,
  getMountsCap,
  getExtraSkillsCap,
} from '@/lib/task-runtime-settings'

import { createTaskSchema, updateTaskSchema } from '@/lib/validation'
// createTaskSchema / updateTaskSchema already carry recipe_slug, workspace_source,
// read_only_mounts, extra_skills as optional fields — 13-02/13-03 call .safeParse(body)
// directly and translate any body-shape errors via zodErrorToIssues.
```

Plan 13-03 additionally imports `isKnownModel`, `MODEL_IDS` from `@/lib/model-registry` for preserve-and-revalidate of an existing `model_override` on recipe change (CONTEXT.md: "Existing `model_override` / `read_only_mounts` / `extra_skills` are preserved across recipe changes and re-validated").

## TASK_RUNTIME_ERROR_CODES Vocabulary (locked)

The full enum — downstream plans cite these codes verbatim:

```typescript
export const TASK_RUNTIME_ERROR_CODES = {
  RECIPE_NOT_FOUND: 'RECIPE_NOT_FOUND',            // recipe_slug references non-existent recipe
  RECIPE_BROKEN: 'RECIPE_BROKEN',                  // recipe row exists but error_message !== null
  REQUIRED_BY_RECIPE: 'REQUIRED_BY_RECIPE',        // workspace_source missing for workspace:worktree recipe
  RECIPE_LOCKED: 'RECIPE_LOCKED',                  // recipe_slug PATCH attempted post-assigned
  ALLOWLIST_EMPTY: 'ALLOWLIST_EMPTY',              // mounts sent but runtime.mount_allowlist is []
  OUT_OF_ALLOWLIST: 'OUT_OF_ALLOWLIST',            // realpath resolved but outside every prefix
  INVALID_PATH: 'INVALID_PATH',                    // realpath failed with non-ENOENT error
  DUPLICATE_LABEL: 'DUPLICATE_LABEL',              // duplicate read_only_mounts[].label
  DUPLICATE_SKILL_BASENAME: 'DUPLICATE_SKILL_BASENAME', // duplicate basename in extra_skills
  CAP_EXCEEDED: 'CAP_EXCEEDED',                    // read_only_mounts or extra_skills over cap
  UNKNOWN_MODEL: 'UNKNOWN_MODEL',                  // model_override not in model registry
  INVALID_BASE_REF: 'INVALID_BASE_REF',            // workspace_source.base_ref fails light syntactic check
  INVALID_FIELD: 'INVALID_FIELD',                  // default ZodError-derived code
} as const
```

Phase 14 runner re-validation must use these SAME codes so the aggregated error shape is identical whether rejection happens at create-time or claim-time.

## Parent-Directory-Walk Semantics (locked for Phase 14)

`validateHostPathAgainstAllowlist` handles `ENOENT` / `ENOTDIR` by walking up parent directories until an existing ancestor is found, then re-attaching the unresolved tail via `ancestorReal + sep + tail.join(sep)`. This means:

- A path like `/Users/me/repos/not-yet-created/file.txt` resolves to `<realpath of /Users/me/repos>/not-yet-created/file.txt` and is admitted if `/Users/me/repos` is under the allowlist.
- A symlink whose target does not exist still falls into the ENOENT path — `realpath` throws ENOENT for the whole call, parent-walk kicks in.
- If NO ancestor resolves (the path has no existing segment back to the filesystem root), the resolver logs a warning and returns `{ ok: false, code: 'INVALID_PATH' }`.

Phase 14 runner MUST use the same resolver (`validateHostPathAgainstAllowlist` imported from `@/lib/task-runtime-validation`). CONTEXT.md: "both API validation and runner re-validation read from the same place." Any divergent resolution logic would mean a task that validated at creation could be rejected at claim — a bad UX.

## Settings Migration Note

**NO new migration was added.** The `settings` table already exists (migration 010). The plan extended only `settingDefinitions` in `src/app/api/settings/route.ts`. GET merges definitions with stored rows by key; PUT upserts by key; DELETE resets to default. The three new keys plug into this existing machinery.

## Decisions Made

- **Schema extension lands in 13-01, not 13-02.** Rationale: Plans 13-02 (POST handler) and 13-03 (PATCH handler) both need `createTaskSchema.safeParse(body)` to accept the four new fields. If 13-02 owns the extension, 13-03 has a hidden dependency on 13-02 shipping first. Moving the extension to 13-01 makes both downstream plans genuinely file-disjoint for `src/lib/validation.ts`.
- **Allowlist entries that fail to realpath are silently skipped.** A misconfigured allowlist entry (e.g., typo pointing at a non-existent prefix) must not bypass the check, and must not spam logs on every validation call. Skipping silently means no admitted paths match and validation falls to `OUT_OF_ALLOWLIST`, which correctly surfaces the misconfiguration via the user-facing error path.
- **Caps (`getMountsCap`, `getExtraSkillsCap`) enforced in route handlers, not in Zod.** Zod refinements close over their parameters at module-eval time, which would freeze the cap value at boot. Since caps are admin-mutable via PUT /api/settings, enforcement lives in the route handlers where `getMountsCap()` is called fresh on every request.

## Deviations from Plan

None - plan executed exactly as written.

Minor note: The plan's done-criteria grep pattern expected 8 hits but matched only 7 because `validateHostPathAgainstAllowlist` is an `async function` and the pattern did not include the `async` modifier. All 8 exports are present (verified by an adjusted grep).

## Issues Encountered

- **Initial vitest mock hoisting failure.** First attempt at `task-runtime-settings.test.ts` used `const logSpy = { warn: vi.fn(), ... }` at module top-level and referenced it inside `vi.mock('@/lib/logger', ...)`. Vitest hoists `vi.mock` calls above top-level declarations, so the factory ran before `logSpy` was initialized — `ReferenceError: Cannot access 'logSpy' before initialization`. Fixed by moving spies into `vi.hoisted(() => ({ warnSpy: vi.fn(), ... }))` and referencing `hoisted.warnSpy` in the mock factory. Pattern documented in the test file comments so the 2-3 other tests in the repo using the same pattern (runner-secret, db-helpers) can cross-reference.

## Self-Check: PASSED

- All 5 created files exist on disk
- All 2 modified files still exist on disk
- SUMMARY.md created at `.planning/phases/13-task-runtime-context-v1-2/13-01-SUMMARY.md`
- All 3 task commits present in git history (244ba2b, 3f66cc3, 94863c6)
- 12 task-runtime-settings tests pass (`pnpm test task-runtime-settings`)
- 33 task-runtime-validation tests pass (`pnpm test task-runtime-validation`)
- 12 validation-runtime-fields tests pass (`pnpm test validation-runtime-fields`)
- Full suite: 1851 pass / 0 fail (up from 1794 baseline — +57 new tests)
- `pnpm typecheck` clean
- `pnpm lint` clean (0 errors; pre-existing warnings unrelated to this plan)

## Next Phase Readiness

- **Plan 13-02** (POST /api/tasks runtime-context validation) can now import from `@/lib/task-runtime-validation` + `@/lib/task-runtime-settings` + `@/lib/validation` and build the validation pipeline. The schema is already extended; 13-02 calls `.safeParse(body)`, translates ZodError via `zodErrorToIssues`, and layers on recipe-existence + workspace-source-gap + allowlist + cap checks — all appending to a single `TaskRuntimeValidationIssue[]` and returning via `buildAggregatedValidationResponse`.
- **Plan 13-03** (PATCH /api/tasks/[id] runtime-context validation) uses the same imports plus `isKnownModel`/`MODEL_IDS` for preserve-and-revalidate of existing `model_override` on recipe change. It must additionally guard recipe-slug mutability by task status (CONTEXT.md: "mutable while pre-dispatch, immutable once assigned+").
- **Phase 14 runner** imports `getMountAllowlist` + `validateHostPathAgainstAllowlist` directly for claim-time re-validation. Because both API and runner share the same resolver, a task that passes create-time validation cannot fail claim-time validation due to allowlist divergence (only due to the allowlist actually changing between create and claim — which is intentional defense-in-depth).
- **No blockers.** Wave 2 (13-02 + 13-03) is unblocked and genuinely file-disjoint on `src/lib/validation.ts`.

---
*Phase: 13-task-runtime-context-v1-2*
*Completed: 2026-04-19*
