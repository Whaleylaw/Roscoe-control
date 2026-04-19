---
phase: 11-runtime-foundation-v1-2
plan: 01
subsystem: database
tags: [typescript, zod, model-registry, validation, anthropic-claude]

# Dependency graph
requires: []
provides:
  - "Typed model registry at src/lib/model-registry.ts (MODEL-01)"
  - "model_override schema refinement on createTaskSchema/updateTaskSchema (MODEL-03)"
  - "Canonical identifier list for claude-opus-4-7 / claude-sonnet-4-6 / claude-haiku-4-5-20251001"
affects: [12-recipe-system, 13-task-runtime-context, 14-runner-container, 16-runtime-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Code-seeded const `as const satisfies Record<string, Model>` locks literal keys while type-checking values"
    - "Lookup returns `null` (never throws, never returns undefined) — callers produce their own error"
    - "Zod v4 refinement uses `{ error: (issue) => ... }` dynamic-message form (not the removed v3 `(val) => ({ message })` form)"

key-files:
  created:
    - src/lib/model-registry.ts
    - src/lib/__tests__/model-registry.test.ts
    - src/lib/__tests__/validation-model-override.test.ts
  modified:
    - src/lib/validation.ts

key-decisions:
  - "Registry is a code-seeded immutable const — no runtime override file, no alias map, no Proxy wrapper"
  - "Model metadata locked to {provider, context_window, output_tokens_max, supports_tools, supports_thinking} — pricing/display_name/doc_url deferred to phases that render or bill"
  - "Error copy for unknown model_override echoes the offending input AND enumerates known identifiers so 400 responses are actionable"
  - "Zod refinement uses v4 `.refine(fn, { error: (issue) => ... })` — the v3 function-form message signature was removed"

patterns-established:
  - "Registry lookup: `import { getModel, isKnownModel, MODEL_IDS } from '@/lib/model-registry'` — phases 12 (recipe indexer) and 14 (claim-time resolution) reuse this import path verbatim"
  - "Schema-layer allowlist: Zod `.refine(isKnownModel, { error: ... })` pattern — reusable for future registry-backed enums (e.g., Phase 13 mount allowlist)"

requirements-completed: [MODEL-01, MODEL-03]

# Metrics
duration: 7min
completed: 2026-04-19
---

# Phase 11 Plan 01: Model Registry & Task-Override Validation Summary

**Typed code-seeded model registry with `getModel()` lookup plus `createTaskSchema.model_override` refinement that rejects unknown models at the Zod layer with a registry-referencing error.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-19T01:49:57Z
- **Completed:** 2026-04-19T01:57:00Z
- **Tasks:** 2
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `src/lib/model-registry.ts` exports `Model`, `ModelId`, `MODELS`, `MODEL_IDS`, `getModel`, `isKnownModel` — the milestone-wide contract Phases 12 & 14 import from.
- Three Claude models seeded with exact v1.2 identifiers: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`.
- `createTaskSchema.model_override` is now an optional string validated via `.refine(isKnownModel)`; `updateTaskSchema.partial()` inherits the rule automatically — POST `/api/tasks` and PATCH `/api/tasks/:id` reject unknown models at `validateBody()`.
- 23 new Vitest assertions (14 registry + 9 validation) covering positive/negative lookup, literal-union narrowing via `@ts-expect-error`, and error-message shape guarantees.

## Task Commits

1. **Task 1: Create model-registry module with typed const map and getModel lookup** — `5a3e166` (feat)
2. **Task 2: Wire model_override validation into createTaskSchema / updateTaskSchema** — `d6b53ca` (feat)

_Concurrent Wave-1 commits from plans 11-02 and 11-03 landed between my commits (f95b72e, e8594e7, 53e4809) — those belong to the sibling plans, not this one._

## Files Created/Modified

- `src/lib/model-registry.ts` (created) — Typed const map + `getModel` / `isKnownModel` / `MODEL_IDS` exports.
- `src/lib/__tests__/model-registry.test.ts` (created) — 14 Vitest assertions including compile-time `@ts-expect-error` for the literal-union guard.
- `src/lib/validation.ts` (modified) — Added `import { isKnownModel, MODEL_IDS } from './model-registry'` and a `model_override` field with `.refine(isKnownModel, { error: ... })` on `createTaskSchema`.
- `src/lib/__tests__/validation-model-override.test.ts` (created) — 9 Vitest assertions covering positive/negative parse, error-message contents, and `updateTaskSchema` partial inheritance.

## Decisions Made

- **Zod v4 refinement signature** — the plan's suggested `.refine(isKnownModel, (val) => ({ message: ... }))` form does not compile under the project's Zod v4 (`error TS2345`). Adopted Zod v4's dynamic-message form: `.refine(isKnownModel, { error: (issue) => \`...${String(issue.input)}...\` })`. Error copy still satisfies the plan's requirements (mentions "model registry", lists known IDs, echoes offending input).
- **Value export of `MODELS`** — not listed explicitly in the plan's "exports" checklist but required by the test assertions (`MODELS['claude-opus-4-7']` used for direct metadata equality checks). Added because it's zero-risk and enables clearer tests than going through `getModel`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated `.refine()` signature for Zod v4 compatibility**
- **Found during:** Task 2 (validation wire-up)
- **Issue:** The plan specified `.refine(isKnownModel, (val) => ({ message: ... }))` — Zod v4 removed that function-form signature. `pnpm typecheck` reported `TS2345: Argument of type '(val: any) => { message: string; }' is not assignable to ...` and `TS7006: Parameter 'val' implicitly has an 'any' type`.
- **Fix:** Switched to Zod v4's error-function form: `.refine(isKnownModel, { error: (issue) => \`model_override '${String(issue.input)}' is not in the model registry. Known models: ${MODEL_IDS.join(', ')}\` })`. Error copy still mentions "model registry", enumerates known IDs, and echoes the offending input — all three plan requirements preserved.
- **Files modified:** `src/lib/validation.ts`
- **Verification:** `pnpm typecheck` clean, all 9 validation tests pass (incl. the `/model registry/i` regex match and `claude-opus-4-7` substring check).
- **Committed in:** `d6b53ca` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking API-version mismatch)
**Impact on plan:** Zero scope drift. The fix preserves every observable property the plan required (error message content, optional-field behavior, schema composition via `.partial()`).

## Issues Encountered

- **Parallel Wave-1 commits:** Plans 11-02 and 11-03 ran concurrently and committed during my execution window. `git log` shows their commits (`f95b72e`, `e8594e7`, `53e4809`) interleaved with mine. No merge conflicts because the plans touch disjoint files (this plan: `model-registry.ts` + `validation.ts`; 11-02: runner-secret module; 11-03: migrations). Verified with `git show --stat` that my two commits contain exactly the four files in the plan's `files_modified` field.
- **Pre-existing test failures in unrelated components** (`src/components/project/lifecycle/__tests__/gate-task-row.test.tsx`) were present before this plan started (see initial `git status` showing `M` on those files) and are out of scope per the deviation rules' SCOPE BOUNDARY — logged here for visibility, not fixed.

## User Setup Required

None — this plan is pure substrate. No env vars, no external services, no dashboards.

## Next Phase Readiness

- **Phase 12 (Recipe System) can now import `getModel` / `isKnownModel` / `MODEL_IDS`** from `@/lib/model-registry` to validate `recipe.model.primary` at index time (MODEL-02). The error-message format established here (registry-reference + identifier enumeration) gives Phase 12 a template for its own recipe-indexer error surface.
- **Phase 14 (Runner Claim) will call `getModel(task.model_override ?? recipe.model.primary)`** at claim time to resolve the effective model (MODEL-04). The `null` return contract means Phase 14 can use `if (!model) throw ...` without a try/catch.
- **Phase 13 (Task Runtime Context)** adds more task-level fields (`recipe_slug`, `workspace_source`, `read_only_mounts`, `extra_skills`). Those will extend the same `createTaskSchema` this plan opened — the allowlist-refinement pattern (`.refine(isMember, { error: ... })`) is the blueprint.
- **No blockers.** Wave-1 plans 11-02 (runner-secret) and 11-03 (migrations) are already committed on main; Plan 11-04 (runner-token auth) unblocks once those three land.

### Canonical Import Patterns (for Phases 12 & 14)

```typescript
// Phase 12 — recipe indexer, MODEL-02
import { isKnownModel, MODEL_IDS } from '@/lib/model-registry'

if (!isKnownModel(recipe.model.primary)) {
  throw new Error(
    `Recipe ${slug}: model.primary '${recipe.model.primary}' is not in the model registry. ` +
    `Known models: ${MODEL_IDS.join(', ')}`
  )
}
```

```typescript
// Phase 14 — claim-time resolution, MODEL-04
import { getModel } from '@/lib/model-registry'

const chosenId = task.model_override ?? recipe.model.primary
const model = getModel(chosenId)
if (!model) {
  // Should be unreachable because Phase 11 (task-override) + Phase 12 (recipe-index)
  // already rejected unknown ids, but defend anyway for forward compat.
  throw new Error(`No metadata for model '${chosenId}' at claim time`)
}
```

### Validation Error Format (for Phase 12 MODEL-02)

When `POST /api/tasks` receives `{ model_override: 'gpt-4' }`, the response body is:

```json
{
  "error": "Validation failed",
  "details": [
    "model_override: model_override 'gpt-4' is not in the model registry. Known models: claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5-20251001"
  ]
}
```

Phase 12's recipe-indexer error surface should mirror this three-part shape: **mention "model registry" + echo offending id + enumerate known identifiers**.

## Self-Check: PASSED

- `src/lib/model-registry.ts`: FOUND
- `src/lib/__tests__/model-registry.test.ts`: FOUND
- `src/lib/__tests__/validation-model-override.test.ts`: FOUND
- `src/lib/validation.ts`: FOUND (modified; contains `isKnownModel` import and `model_override` field)
- Commit `5a3e166`: FOUND
- Commit `d6b53ca`: FOUND
- `pnpm vitest run` on both test files: 23/23 passed
- `pnpm typecheck`: clean

---
*Phase: 11-runtime-foundation-v1-2*
*Completed: 2026-04-19*
