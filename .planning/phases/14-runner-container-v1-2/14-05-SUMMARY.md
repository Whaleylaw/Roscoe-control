---
phase: 14-runner-container-v1-2
plan: 05
subsystem: runner-claim
tags: [runner, claim, atomic-transaction, token-mint, dispatch-payload, phase-14]
requires:
  - Phase 11 migrations 054-057 (task_runner_tokens, tasks runtime columns)
  - Phase 11 runner-secret auth (user.id === -1000 sentinel)
  - Phase 11-04 issueRunnerToken (per-attempt bearer mint + expiry arithmetic)
  - Phase 12-02 getIndexedRecipeBySlug (single read path for recipe rows)
  - Phase 13-01 validateHostPathAgainstAllowlist + TASK_RUNTIME_ERROR_CODES
  - Phase 13-01 buildAggregatedValidationResponse (shared 400/409 error shape)
  - Phase 14-01 migration 061_task_runner_attempts (per-attempt history table)
  - Phase 14-02 getMaxConcurrentContainers / getMaxMemoryPerContainer / getMaxCpuPerContainer
  - Phase 14-03 claim-route Wave-0 scaffold (10 it.todos → 12 real its)
provides:
  - POST /api/runner/claim/:task_id handler
  - src/lib/runner-claim.ts full helper suite (9 exports)
  - 26 unit tests for runner-claim helpers + 14 route-integration tests
affects:
  - Plan 14-08b (runner daemon) — single fetch('POST /api/runner/claim/:id') consumes the dispatch payload shape defined here
  - Plan 14-11 (container-started placeholder swap) — replaces 'pending:<id>:<n>' with real Docker container_id post-`docker run`
  - Plan 14-06 (runner-exit) — shares resolveRecipeMaxAttempts via the runner-claim module
tech-stack:
  added: []
  patterns:
    - "Pure helpers in src/lib/<feature>.ts + thin HTTP wrapper in src/app/api/.../route.ts — mirrors Phase 13 separation. All claim logic is unit-testable without Next.js or a route."
    - "db.transaction(() => ...) wrapper encloses BOTH the atomic-UPDATE claim and the INSERT INTO task_runner_attempts + issueRunnerToken — any DB error rolls all three back together."
    - "Placeholder container_id = 'pending:<task_id>:<attempt>' at claim time so the concurrency caps counted inside the transaction include in-flight claims. Plan 14-11 swaps it for the real Docker ID."
    - "ON CONFLICT(task_id, attempt) DO NOTHING on the task_runner_attempts INSERT makes the transaction idempotent against a replayed claim (migration 061 UNIQUE constraint)."
    - "Aggregated validation response shape (buildAggregatedValidationResponse + TASK_RUNTIME_ERROR_CODES) reused verbatim from Phase 13 — 400 for allowlist failures, 409 for CAP_EXCEEDED."
key-files:
  created:
    - src/app/api/runner/claim/[task_id]/route.ts
    - src/lib/__tests__/runner-claim.test.ts
  modified:
    - src/lib/runner-claim.ts  (extended the minimal resolveRecipeMaxAttempts shipped in 14-06 precursor with 8 new helpers)
    - src/app/api/runner/claim/[task_id]/__tests__/route.test.ts  (10 it.todos replaced with 14 real its)
decisions:
  - "Response shape LOCKED for Plan 14-08b: { task: { id, recipe_slug, workspace_source, read_only_mounts, extra_skills, attempt, is_resuming, prior_attempts, runner_max_attempts }, recipe: <RecipeRow>, env: Record<string,string>, runner_token_expires_at: number, resource_limits: { memory: string, cpus: number }, container_name_prefix: 'mc-task-<id>-a<attempt>' }"
  - "runner_max_attempts precedence LOCKED: task.runner_max_attempts ?? resolveRecipeMaxAttempts(slug) ?? 3. resolveRecipeMaxAttempts re-parses recipe.yaml from getRecipesRoot() on EVERY claim — NOT a DB read. Confirmed by this plan's test #12 which seeds a real recipe.yaml on disk and asserts the filesystem path."
  - "Concurrency cap queries count every task with status='in_progress' AND container_id IS NOT NULL (includes 'pending:' placeholders). This guarantees a double-claim race at global-cap-minus-one cannot squeeze two containers past the cap."
  - "Runner-default resource limits (2g memory / 1.0 CPU) applied in the route because v1.2 recipe.yaml has no memory_limit / cpu_limit fields. Admin ceilings (runtime.max_memory_per_container / runtime.max_cpu_per_container) are ALWAYS consulted via resolveResourceLimits so Phase 15+ can add recipe-declared overrides without changing claim-route code."
  - "recipe.secrets is a list of ENV VAR NAMES only at the HTTP surface — values are resolved by the runner daemon from .data/runner/secrets/<NAME> in Plan 14-08b. Keeping value-resolution out of the server preserves the 'secrets never touch HTTP' property."
  - "MC_API_URL = 'http://host.docker.internal:${process.env.PORT || 3000}' — the claim route emits the URL the container will use, not the URL the browser uses (which goes through localhost)."
  - "Request body for POST /api/runner/claim is EMPTY — all inputs come from the URL param + the task row. Daemon never sends runner_id in the claim request; runner identity is carried by the runner-secret itself."
metrics:
  completed_date: 2026-04-20
  duration_minutes: 15
  task_count: 3
  files_changed: 3
  tests_added: 40
requirements: [RUNNER-06, RUNNER-07, RUNNER-08, MODEL-04]
---

# Phase 14 Plan 05: Runner Claim + Dispatch Summary

**One-liner:** `POST /api/runner/claim/:task_id` — the critical-section endpoint where runner-secret auth, Phase 12 recipe lookup, Phase 13 allowlist re-validation, Phase 14-02 concurrency caps, atomic status flip, Phase 11-04 runner-token mint, and per-attempt history all land inside a single `db.transaction`. Returns the full dispatch payload Plan 14-08b hands to `docker run`.

## What Shipped

### 1. `src/lib/runner-claim.ts` — pure helpers

Extended from the minimal `resolveRecipeMaxAttempts` that shipped earlier (for Plan 14-06) to the full claim-route helper suite. No HTTP imports. Every function is unit-testable against an in-memory SQLite.

| Export                          | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `resolveEffectiveModel`         | MODEL-04 precedence: `task.model_override ?? recipe.model.primary`.    |
| `composeEnvMap`                 | MC_* system vars → recipe.env → recipe.secrets merge (later wins).     |
| `resolveResourceLimits`         | Runner defaults → admin ceilings, returns INVALID_FIELD / CAP_EXCEEDED.|
| `parseMemoryBytes`              | Docker memory string parser (b/k/m/g, case-insensitive).               |
| `checkGlobalCap`                | Count tasks where status=in_progress AND container_id IS NOT NULL.     |
| `checkPerRecipeCap`             | Same filter + recipe_slug match; counts placeholder IDs too.           |
| `readPriorAttempts`             | task_runner_attempts rows ORDER BY attempt ASC.                        |
| `resolveRecipeMaxAttempts`      | Filesystem re-parse of `<recipesRoot>/<slug>/recipe.yaml` → max_attempts. |
| `buildDispatchPayload`          | Shape the `task` sub-object of the claim response. is_resuming = newAttempt > 1. |

Exported constants: `RUNNER_DEFAULT_MEMORY_LIMIT = '2g'`, `RUNNER_DEFAULT_CPU_LIMIT = 1.0`.

### 2. `src/app/api/runner/claim/[task_id]/route.ts` — POST handler

Flow (each step maps to a helper):

1. `requireRole('operator')` + `user.id === -1000` guard (403 otherwise).
2. Parse `task_id`; reject non-positive-integer as 400.
3. `SELECT * FROM tasks WHERE id = ?` → 404 on miss.
4. Guard `!task.recipe_slug` → 400.
5. `getIndexedRecipeBySlug(slug)` → 400 RECIPE_NOT_FOUND / RECIPE_BROKEN via `buildAggregatedValidationResponse`.
6. Loop `read_only_mounts` + `extra_skills`, calling `validateHostPathAgainstAllowlist` on each `host_path`. Collect issues, return aggregated 400.
7. `checkGlobalCap(db, getMaxConcurrentContainers())` → 409 CAP_EXCEEDED on field `'(global)'`.
8. `checkPerRecipeCap(db, slug, recipe.max_concurrent)` → 409 CAP_EXCEEDED on field `'recipe.max_concurrent'`.
9. `resolveResourceLimits(...)` → 409 CAP_EXCEEDED on admin-ceiling overshoot.
10. **Atomic `db.transaction`:**
    ```sql
    UPDATE tasks
    SET status='in_progress', container_id=?, runner_started_at=?,
        runner_attempts=runner_attempts+1, updated_at=?
    WHERE id=? AND status='assigned' AND container_id IS NULL AND recipe_slug IS NOT NULL
    ```
    `result.changes === 0` → `{ claimed: false }` → 409 `"already claimed or ineligible"`.
    Otherwise:
    - `INSERT INTO task_runner_attempts (task_id, attempt, started_at) VALUES (?, ?, ?) ON CONFLICT(task_id, attempt) DO NOTHING`.
    - `issueRunnerToken(db, taskId, nextAttempt, recipe.timeout_seconds, nowUnix)` → `{ token, expiresAt: nowUnix + timeout + 60 }`.
11. `readPriorAttempts(db, taskId).filter(r => r.attempt < nextAttempt)` — exclude the just-inserted row.
12. `runner_max_attempts = task.runner_max_attempts ?? resolveRecipeMaxAttempts(slug) ?? 3`.
13. `composeEnvMap(...)` — MC_API_URL = `http://host.docker.internal:${PORT || 3000}`, MC_MODEL_PROVIDER resolves from `recipe.model.provider || getModel(primary)?.provider || 'anthropic'`.
14. Return JSON response:
    ```json
    {
      "task": { "id", "recipe_slug", "workspace_source", "read_only_mounts",
                "extra_skills", "attempt", "is_resuming", "prior_attempts",
                "runner_max_attempts" },
      "recipe": <RecipeRow>,
      "env": { "MC_API_URL", "MC_TASK_ID", "MC_API_TOKEN", "MC_WORKSPACE",
               "MC_RECIPE_PATH", "MC_PREAMBLE_PATH", "MC_MODEL_PRIMARY",
               "MC_MODEL_FALLBACK?", "MC_MODEL_PROVIDER", "MC_MODEL_PARAMS_JSON",
               ...recipe.env },
      "runner_token_expires_at": <unix>,
      "resource_limits": { "memory": "2g", "cpus": 1.0 },
      "container_name_prefix": "mc-task-<id>-a<attempt>"
    }
    ```

### 3. Tests — 26 unit + 14 route-integration = 40 total

**Unit (`src/lib/__tests__/runner-claim.test.ts`, 26 cases):**

| Area                          | Cases | Coverage                                                                                        |
| ----------------------------- | ----: | ----------------------------------------------------------------------------------------------- |
| resolveEffectiveModel         | 2     | Override-wins, null/undefined/empty → recipe primary.                                           |
| composeEnvMap                 | 5     | All MC_* keys present, merge precedence (recipeEnv < recipeSecrets), MC_MODEL_FALLBACK omission, empty modelParams default. |
| resolveResourceLimits         | 6     | Recipe values passthrough, runner defaults (2g/1.0), CAP_EXCEEDED on memory/CPU overshoot, INVALID_FIELD for junk, parseMemoryBytes b/k/m/g suffixes. |
| checkGlobalCap + checkPerRecipeCap | 4 | OK below cap, current === max at cap, ignores null container_id + non-in_progress, per-recipe filter. |
| readPriorAttempts             | 2     | Empty array when no rows, ASC ordering respected.                                               |
| resolveRecipeMaxAttempts      | 5     | Missing file, declared value, missing field, malformed YAML, empty slug (defensive).            |
| buildDispatchPayload          | 2     | is_resuming false on attempt=1, true + preserves priorAttempts on attempt=2.                    |

**Route-integration (`.../__tests__/route.test.ts`, 14 cases):**

10 from the 14-03 Wave-0 scaffold (replaced in-place, per 14-03 lock) + 2 documented additions from the 14-05 plan (resume + filesystem max_attempts) + 2 extras (auth 403, 404).

| # | Requirement  | Assertion                                                             |
| - | ------------ | --------------------------------------------------------------------- |
| 1 | RUNNER-06    | Atomic claim happy path: status, container_id=`pending:<id>:1`, runner_attempts+=1, task_runner_attempts row, full response shape. |
| 2 | RUNNER-06    | Double-claim → 409 `"already claimed or ineligible"`.                 |
| 3 | RUNNER-06    | Wrong status (`backlog`) → 409 (same message).                        |
| 4 | RUNNER-07    | Mount outside allowlist → 400 OUT_OF_ALLOWLIST + task NOT mutated.    |
| 5 | RUNNER-07    | Extra skill outside allowlist → 400 OUT_OF_ALLOWLIST on `extra_skills.0`. |
| 6 | RUNNER-08    | Global cap of 2 reached → 409 CAP_EXCEEDED field `'(global)'`.        |
| 7 | RUNNER-08    | Per-recipe cap of 2 reached → 409 CAP_EXCEEDED field `'recipe.max_concurrent'`. |
| 8 | MODEL-04     | env.MC_MODEL_PRIMARY = task.model_override when set, else recipe.model.primary. |
| 9 | RUNNER-06    | runner_token_expires_at === runner_started_at + recipe.timeout_seconds + 60. |
| 10| RUNNER-06    | Full dispatch payload — recipe.env visible, secrets list, is_resuming=false, prior_attempts=[]. |
| 11| RUNNER-06    | Resume: attempt=2, is_resuming=true, prior_attempts=[{attempt:1, exit_code:1, failure_reason:'crash'}]. |
| 12| RUNNER-06    | runner_max_attempts=5 via filesystem re-parse of recipe.yaml on disk. |
| 13| (Auth)       | Non-runner principal (operator session) → 403.                        |
| 14| (Not found)  | Non-existent task_id → 404.                                           |

Combined run: `pnpm test src/app/api/runner/claim src/lib/__tests__/runner-claim.test.ts --run` → **40 passed, 0 failed, ~1.5s**.

## Key Links Realised

| Source → Target                                                    | Mechanism                                         |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| route.ts → validateHostPathAgainstAllowlist                        | `import from '@/lib/task-runtime-validation'`    |
| route.ts → getIndexedRecipeBySlug                                  | `import from '@/lib/recipe-indexer'`             |
| route.ts → issueRunnerToken                                        | `import from '@/lib/runner-tokens'`              |
| atomic UPDATE tasks + INSERT task_runner_attempts + issueRunnerToken | Single `db.transaction(() => { ... })()`         |
| resolveRecipeMaxAttempts → recipe.yaml filesystem                   | `getRecipesRoot() + join + readFileSync + parseRecipeYaml` |
| Global cap query includes 'pending:' placeholders                   | `status='in_progress' AND container_id IS NOT NULL` |

## Interactions Discovered

### Admin-ceiling parse (14-02 getters)

`getMaxMemoryPerContainer()` returns the stored string verbatim — e.g. `'8g'` or `'12g'`. The claim route calls `parseMemoryBytes` on both the recipe value and the ceiling before comparing. A malformed ceiling (`'eight gigs'` or `''`) would surface as 409 INVALID_FIELD with field `runtime.max_memory_per_container` — a failure mode operators can resolve by fixing the setting. This is stricter than a silent fallback and matches the 14-02 DEFAULT_* contract.

### Response shape stability for Plan 14-08b

The `resource_limits` and `container_name_prefix` fields are the two new surfaces Plan 14-08b reads that weren't in the original 14-03 scaffold. Both are populated unconditionally. `container_name_prefix` uses the claim-time `nextAttempt` so the daemon's `docker run --name "${prefix}"` produces a unique name per attempt — matches the CONTEXT.md "mc-task-<id>-a<attempt>" pattern.

### runner_max_attempts vs recipes DB schema

Confirmed during test #12: recipes DB row does NOT carry max_attempts. Writing a real recipe.yaml with `max_attempts: 5` then calling POST /api/runner/claim returned `body.task.runner_max_attempts === 5`. The claim-route code path that produced this result is `resolveRecipeMaxAttempts(slug)` which calls `getRecipesRoot() + readFileSync(<root>/<slug>/recipe.yaml) + parseRecipeYaml()` — entirely independent of the `getIndexedRecipeBySlug` projection. This LOCKS the Plan 14-02 decision.

## Deviations from Plan

### Auto-fixed issues

None — the plan executed as written.

### Intentional test-count addition (documented in plan)

Plan 14-05 specified 10 tests minimum (from the 14-03 scaffold) + 2 documented additions (resume + filesystem max_attempts) = 12 tests. I added 2 extras (auth 403 + task-not-found 404) because those code paths weren't otherwise exercised at the route layer. Total route-integration tests: **14**.

### Response-shape additions beyond the 14-03 scaffold

The 14-03 Wave-0 scaffold mentioned the response fields in prose; Plan 14-05 introduces two NEW fields not named in the 14-03 scaffold:

- `resource_limits: { memory, cpus }`
- `container_name_prefix: 'mc-task-<id>-a<attempt>'`

Both are consumed by Plan 14-08b per plan locked-decision text. Tests assert both. Documented here so Plan 14-08b does not treat these as surprises.

## Requirements Completed

| ID         | Landed at                                          |
| ---------- | -------------------------------------------------- |
| RUNNER-06  | Atomic claim transaction + token mint + prior_attempts |
| RUNNER-07  | Re-validation loop over mounts + skills via Phase 13 helper |
| RUNNER-08  | Global + per-recipe cap enforcement before the transaction |
| MODEL-04   | resolveEffectiveModel + MC_MODEL_PRIMARY in env map        |

## Verification Results

- `pnpm test src/app/api/runner/claim src/lib/__tests__/runner-claim.test.ts --run` → **40 / 40 pass**
- `pnpm typecheck` → **clean** (0 errors)
- `pnpm lint` → **0 errors, 76 warnings** (all pre-existing in panels/terminal components, unrelated to this plan)
- 409 responses conform to `buildAggregatedValidationResponse` shape — visible in tests #4-7 assertions on `body.errors[0].{field, code, message}`.

## Self-Check: PASSED

- src/lib/runner-claim.ts — FOUND (extended from minimal resolveRecipeMaxAttempts)
- src/lib/__tests__/runner-claim.test.ts — FOUND (26 cases)
- src/app/api/runner/claim/[task_id]/route.ts — FOUND (365 lines)
- src/app/api/runner/claim/[task_id]/__tests__/route.test.ts — FOUND (14 cases, 0 it.todo)
- Commit 1e549bb (Task 1 — runner-claim helpers + unit tests) — FOUND
- Commit 995e18b (Task 2 — claim route) — FOUND
- Commit da9b78f (Task 3 — route-integration tests) — FOUND
