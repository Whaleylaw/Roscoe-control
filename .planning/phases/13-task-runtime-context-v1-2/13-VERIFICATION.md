---
phase: 13-task-runtime-context-v1-2
verified: 2026-02-14
status: passed
score: 6/6 must-haves verified (retroactive backfill — Phase 13 shipped 2026-04-20)
backfilled: true
backfill_reason: "Phase 13 shipped without a VERIFICATION.md artifact; v1.2 milestone audit (2026-04-21) flagged the absence as tech-debt item #1. All six TCTX-01..06 requirements were satisfied at ship time per the three 13-0N-SUMMARY.md requirements_completed frontmatter arrays and are exercised end-to-end by Phase 17 integration tests."
must_haves:
  truths:
    - "Creating/updating a task with recipe_slug pointing at an indexed recipe succeeds; a missing recipe is rejected via RECIPE_NOT_FOUND in the aggregated 400 shape (TCTX-01)"
    - "When the referenced recipe declares workspace: worktree, the task must carry workspace_source = { project_id, base_ref }; missing value is rejected via REQUIRED_BY_RECIPE (TCTX-02)"
    - "Task carries zero or more read_only_mounts, extra_skills, and an optional model_override that round-trip through read API (POST response + GET list + GET :id) as typed JSON (TCTX-03)"
    - "Any host_path outside the runner mount_allowlist (after fs.realpath resolution, symlink-escape included) is rejected at task creation with an actionable OUT_OF_ALLOWLIST / ALLOWLIST_EMPTY error (TCTX-04)"
    - "model_override not in the model registry is rejected with a clear UNKNOWN_MODEL error that names the registry and enumerates known IDs (TCTX-05)"
    - "Per-task caps (mounts_cap, extra_skills_cap) are enforced at request time and are admin-mutable via the runtime.* settings keys through PUT /api/settings without requiring a restart (TCTX-06)"
  artifacts:
    - path: "src/lib/task-runtime-settings.ts"
      provides: "Typed getters getMountAllowlist / getMountsCap / getExtraSkillsCap — read the three runtime.* settings rows with warn-and-fallback on malformed JSON or non-numeric caps"
    - path: "src/lib/task-runtime-validation.ts"
      provides: "Zod schemas (WorkspaceSourceSchema, ReadOnlyMountSchema, readOnlyMountsArraySchema, extraSkillsArraySchema), validateHostPathAgainstAllowlist (realpath + parent-walk + subtree prefix match), buildAggregatedValidationResponse, zodErrorToIssues, TASK_RUNTIME_ERROR_CODES"
    - path: "src/lib/validation.ts"
      provides: "createTaskSchema extended with 4 new optional runtime fields (recipe_slug, workspace_source, read_only_mounts, extra_skills); updateTaskSchema inherits all 4 via .partial(); model_override Phase 11 refine unchanged"
    - path: "src/app/api/tasks/route.ts"
      provides: "POST handler with manual safeParse + runtime-context business-rule block + 28-column INSERT; mapTaskRow JSON.parses workspace_source / read_only_mounts / extra_skills for POST response and GET list"
    - path: "src/app/api/tasks/[id]/route.ts"
      provides: "PUT handler with manual safeParse, RECIPE_SLUG_MUTABLE_STATUSES pre-dispatch gate, atomic workspace_source gap rejection, preserve-and-revalidate for existing runtime fields, five new patchProvided branches on the dynamic UPDATE; RAUTH-05 atomic token revocation preserved on terminal transition"
    - path: "src/app/api/settings/route.ts"
      provides: "Three new runtime.* keys (runtime.mount_allowlist, runtime.read_only_mounts_cap, runtime.extra_skills_cap) added to settingDefinitions with category 'runtime'; no migration required"
  key_links:
    - from: ".planning/phases/13-task-runtime-context-v1-2/13-VERIFICATION.md"
      to: "src/lib/__tests__/phase-17-pipeline-integration.test.ts"
      via: "end-to-end TCTX-01..06 evidence — full-pipeline integration test (create task with recipe_slug + workspace_source + mounts, runner claim, container run, checkpoint, submit → review)"
      pattern: "phase-17-pipeline-integration"
    - from: ".planning/phases/13-task-runtime-context-v1-2/13-VERIFICATION.md"
      to: "src/lib/__tests__/phase-17-daemon-pipeline.test.ts"
      via: "end-to-end TCTX-01..06 evidence through a spawned mc-runner.mjs subprocess (daemon-level pipeline)"
      pattern: "phase-17-daemon-pipeline"
    - from: ".planning/phases/13-task-runtime-context-v1-2/13-VERIFICATION.md"
      to: ".planning/phases/13-task-runtime-context-v1-2/13-01-SUMMARY.md"
      via: "requirements_completed: [TCTX-01..06] frontmatter + Plan 13-01 artifacts (task-runtime-settings.ts, task-runtime-validation.ts, validation.ts extension)"
      pattern: "13-01-SUMMARY|requirements_completed"
    - from: ".planning/phases/13-task-runtime-context-v1-2/13-VERIFICATION.md"
      to: ".planning/phases/13-task-runtime-context-v1-2/13-02-SUMMARY.md"
      via: "requirements_completed: [TCTX-01..06] frontmatter + Plan 13-02 artifacts (POST /api/tasks extension + mapTaskRow)"
      pattern: "13-02-SUMMARY|requirements_completed"
    - from: ".planning/phases/13-task-runtime-context-v1-2/13-VERIFICATION.md"
      to: ".planning/phases/13-task-runtime-context-v1-2/13-03-SUMMARY.md"
      via: "requirements_completed: [TCTX-01..06] frontmatter + Plan 13-03 artifacts (PATCH /api/tasks/[id] extension, RECIPE_SLUG_MUTABLE_STATUSES, preserve-and-revalidate)"
      pattern: "13-03-SUMMARY|requirements_completed"
    - from: "src/lib/validation.ts"
      to: "src/lib/model-registry.ts"
      via: "createTaskSchema.model_override .refine(isKnownModel, ...) produces the UNKNOWN_MODEL-mapped error (TCTX-05)"
      pattern: "isKnownModel|MODEL_IDS"
    - from: "src/lib/task-runtime-validation.ts"
      to: "node:fs (realpath)"
      via: "validateHostPathAgainstAllowlist calls fs.realpath with parent-directory walk on ENOENT and subtree-prefix match against the allowlist (TCTX-04)"
      pattern: "realpath|validateHostPathAgainstAllowlist"
    - from: "src/app/api/tasks/route.ts"
      to: "src/lib/recipe-indexer.ts"
      via: "POST handler calls getIndexedRecipeBySlug(body.recipe_slug) to discriminate null / error_message / RecipeRow for TCTX-01 + TCTX-02"
      pattern: "getIndexedRecipeBySlug"
    - from: "src/app/api/tasks/[id]/route.ts"
      to: "src/lib/recipe-indexer.ts"
      via: "PUT handler calls getIndexedRecipeBySlug for recipe-change validation + workspace_source gap check (TCTX-01 + TCTX-02 on PATCH)"
      pattern: "getIndexedRecipeBySlug"
---

# Phase 13: Task Runtime Context (v1.2) Verification Report

**Phase Goal:** A task can reference a recipe and declare the runtime specifics the runner will need — workspace source, read-only mounts, extra skills, model override — with mount-allowlist validation enforced at task creation.
**Verified:** 2026-02-14 (retroactive backfill; Phase 13 shipped 2026-04-20)
**Re-verification:** Retroactive backfill — Phase 13 shipped without a VERIFICATION.md; this file closes v1.2 milestone audit tech-debt item #1 (see `.planning/v1.2-MILESTONE-AUDIT.md`).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Creating/updating a task with `recipe_slug` pointing at an indexed recipe succeeds; a missing recipe is rejected with `RECIPE_NOT_FOUND` in the aggregated 400 shape (**TCTX-01**) | ✓ VERIFIED | Plans 13-01/13-02/13-03 list TCTX-01 in `requirements_completed` frontmatter of `.planning/phases/13-task-runtime-context-v1-2/13-01-SUMMARY.md`, `13-02-SUMMARY.md`, `13-03-SUMMARY.md`. POST handler in `src/app/api/tasks/route.ts` calls `getIndexedRecipeBySlug` and emits `RECIPE_NOT_FOUND` / `RECIPE_BROKEN` issues into `buildAggregatedValidationResponse`. PATCH handler in `src/app/api/tasks/[id]/route.ts` mirrors the lookup and adds `RECIPE_LOCKED` via `RECIPE_SLUG_MUTABLE_STATUSES` for post-dispatch change attempts. End-to-end exercise in `src/lib/__tests__/phase-17-pipeline-integration.test.ts` (task created with a valid `recipe_slug`, runner claims, container runs) and `src/lib/__tests__/phase-17-daemon-pipeline.test.ts` (same pipeline through a spawned mc-runner.mjs subprocess). |
| 2 | When the referenced recipe declares `workspace: worktree`, the task must carry `workspace_source = { project_id, base_ref }`; missing value is rejected with `REQUIRED_BY_RECIPE` (**TCTX-02**) | ✓ VERIFIED | Plans 13-01/13-02/13-03 list TCTX-02 in `requirements_completed` frontmatter of the three 13-0N-SUMMARY.md files. `WorkspaceSourceSchema` defined in `src/lib/task-runtime-validation.ts`; POST handler (13-02-SUMMARY.md "Business-rule pipeline") checks `workspace_mode === 'worktree'` without `workspace_source` → `REQUIRED_BY_RECIPE`; PATCH handler (13-03-SUMMARY.md "Atomicity (test 10)") rejects atomically before any UPDATE when a recipe change creates a workspace_source gap. Full-pipeline exercise in `src/lib/__tests__/phase-17-pipeline-integration.test.ts` (task created with `workspace_source` supplied against a worktree-mode recipe, runner materialises the git worktree) and `src/lib/__tests__/phase-17-daemon-pipeline.test.ts`. |
| 3 | Task carries zero or more `read_only_mounts`, `extra_skills`, and optional `model_override` that round-trip through the read API (POST response + GET list + GET :id) as typed JSON (**TCTX-03**) | ✓ VERIFIED | Plans 13-01/13-02/13-03 list TCTX-03 in `requirements_completed` frontmatter. `mapTaskRow` JSON.parses the three JSON columns in both `src/app/api/tasks/route.ts` and `src/app/api/tasks/[id]/route.ts` (symmetric — called out in `.planning/phases/13-task-runtime-context-v1-2/13-02-SUMMARY.md` "mapTaskRow Extension" and `13-03-SUMMARY.md` "mapTaskRow symmetry"). INSERT extended to 28 columns (13-02-SUMMARY.md "INSERT Column Order (locked)"). End-to-end round-trip exercised by `src/lib/__tests__/phase-17-pipeline-integration.test.ts` (task created → runner reads task with `read_only_mounts` + `extra_skills` populated → mounts bound into container) and `src/lib/__tests__/phase-17-daemon-pipeline.test.ts`. |
| 4 | Any `host_path` outside the runner `mount_allowlist` (after fs.realpath resolution, symlink-escape included) is rejected at task creation with `OUT_OF_ALLOWLIST` / `ALLOWLIST_EMPTY` (**TCTX-04**) | ✓ VERIFIED | Plans 13-01/13-02/13-03 list TCTX-04 in `requirements_completed` frontmatter. `validateHostPathAgainstAllowlist` in `src/lib/task-runtime-validation.ts` calls `fs.realpath` with parent-directory walk on ENOENT and subtree-prefix match against the allowlist (13-01-SUMMARY.md "Parent-Directory-Walk Semantics (locked for Phase 14)"). POST + PATCH handlers iterate every `read_only_mounts[].host_path` and every `extra_skills` entry through the resolver and append issues into the aggregated error array. End-to-end defense-in-depth exercise in `src/lib/__tests__/phase-17-pipeline-integration.test.ts` (runner re-validates mounts at claim using the same resolver) and `src/lib/__tests__/phase-17-daemon-pipeline.test.ts`. |
| 5 | `model_override` not in the model registry is rejected with a clear `UNKNOWN_MODEL` error that names the registry and enumerates known IDs (**TCTX-05**) | ✓ VERIFIED | Plans 13-01/13-02/13-03 list TCTX-05 in `requirements_completed` frontmatter. Refine on `createTaskSchema.model_override` in `src/lib/validation.ts` invokes `isKnownModel` from `src/lib/model-registry.ts` (Phase 11 substrate). `zodErrorToIssues` in `src/lib/task-runtime-validation.ts` maps the model-registry refine message onto `TASK_RUNTIME_ERROR_CODES.UNKNOWN_MODEL` so the aggregated shape carries `{ field: 'model_override', code: 'UNKNOWN_MODEL', ... }`. PATCH handler adds preserve-and-revalidate (13-03-SUMMARY.md "Preserve-and-revalidate for model_override"). End-to-end exercise in `src/lib/__tests__/phase-17-pipeline-integration.test.ts` (task created with recipe-supplied `model_override` flows through create-time refine into runner claim) and `src/lib/__tests__/phase-17-daemon-pipeline.test.ts`. |
| 6 | Per-task caps (`mounts_cap`, `extra_skills_cap`) are enforced at request time and admin-mutable via `runtime.*` settings through PUT /api/settings without restart (**TCTX-06**) | ✓ VERIFIED | Plans 13-01/13-02/13-03 list TCTX-06 in `requirements_completed` frontmatter. Three new keys (`runtime.mount_allowlist`, `runtime.read_only_mounts_cap`, `runtime.extra_skills_cap`) added to `settingDefinitions` in `src/app/api/settings/route.ts` with category `'runtime'` (13-01-SUMMARY.md "Settings Migration Note"). Typed getters in `src/lib/task-runtime-settings.ts` (`getMountsCap`, `getExtraSkillsCap`, `getMountAllowlist`) called fresh per request so closure-freezing at module eval is avoided (13-01-SUMMARY.md "Decisions Made: Caps enforced in route handlers, not in Zod"). POST + PATCH handlers emit `CAP_EXCEEDED` issues when `nextReadOnlyMounts.length` or `nextExtraSkills.length` exceeds the admin-configured cap. End-to-end exercise in `src/lib/__tests__/phase-17-pipeline-integration.test.ts` (runner claim reads the same allowlist) and `src/lib/__tests__/phase-17-daemon-pipeline.test.ts`. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/task-runtime-settings.ts` | Typed getters for the three runtime.* settings rows; warn-and-fallback on malformed values | ✓ VERIFIED | Created in Plan 13-01 (commit `244ba2b`). Exports `getMountAllowlist`, `getMountsCap`, `getExtraSkillsCap`. Defaults: 10 / 20 / `[]`. Pattern: same prepared-statement read used by `scheduler.ts` / `hook-profiles.ts`. Listed in `.planning/phases/13-task-runtime-context-v1-2/13-01-SUMMARY.md` key-files.created. |
| `src/lib/task-runtime-validation.ts` | Zod schemas + `validateHostPathAgainstAllowlist` + `buildAggregatedValidationResponse` + `zodErrorToIssues` + `TASK_RUNTIME_ERROR_CODES` | ✓ VERIFIED | Created in Plan 13-01 (commit `3f66cc3`). All exports present per 13-01-SUMMARY.md key-files.created and the enumerated vocabulary section ("TASK_RUNTIME_ERROR_CODES Vocabulary (locked)"). Parent-walk realpath semantics documented in "Parent-Directory-Walk Semantics (locked for Phase 14)". |
| `src/lib/validation.ts` | `createTaskSchema` extended with 4 new optional runtime fields; `updateTaskSchema` inherits via `.partial()` | ✓ VERIFIED | Modified in Plan 13-01 (commit `94863c6`). 13-01-SUMMARY.md "key-files.modified" lists this file. Four new optional fields (`recipe_slug`, `workspace_source`, `read_only_mounts`, `extra_skills`) composed from `./task-runtime-validation`; `model_override` Phase 11 refine unchanged. Plan 13-02 + 13-03 intentionally DID NOT touch this file (see 13-02-SUMMARY.md "Files Untouched" and 13-03-SUMMARY.md verification `git diff` evidence). |
| `src/app/api/tasks/route.ts` | POST handler with manual safeParse + runtime-context business-rule block + 28-column INSERT; mapTaskRow JSON.parses the three JSON columns | ✓ VERIFIED | Modified in Plan 13-02 (commits `b280e62` + `84471d5`). 13-02-SUMMARY.md "Files Modified" + "INSERT Column Order (locked — 28 placeholders, 28 arguments)" + "mapTaskRow Extension (mandatory mirror for Plan 13-03 [id]/route.ts)". 20-case route-level test suite at `src/app/api/tasks/__tests__/route.runtime-context.test.ts`. |
| `src/app/api/tasks/[id]/route.ts` | PUT handler with manual safeParse + RECIPE_SLUG_MUTABLE_STATUSES gate + atomic workspace_source gap rejection + preserve-and-revalidate + RAUTH-05 preserved | ✓ VERIFIED | Modified in Plan 13-03 (commits `fe2dd86` + `d1df9d5`). 13-03-SUMMARY.md "Change A–F" decomposition + "RAUTH-05 preservation" section confirms `db.transaction(() => { stmt.run(...); if (isTerminalTransition) revokeTokensForTask(db, taskId) })` is unchanged text-for-text. 21-case test suite at `src/app/api/tasks/[id]/__tests__/route.runtime-context.test.ts`. |
| `src/app/api/settings/route.ts` | Three new `runtime.*` keys added to `settingDefinitions`; no new migration | ✓ VERIFIED | Modified in Plan 13-01 (commit `244ba2b`). 13-01-SUMMARY.md "Settings Migration Note" explicitly confirms no new migration — the three keys plug into the existing GET/PUT/DELETE machinery from migration 010. Category `'runtime'`. |

### Key Links

| From | To | Via | Status | Evidence |
|------|----|----|--------|----------|
| `src/lib/validation.ts` | `src/lib/model-registry.ts` | `createTaskSchema.model_override` refine uses `isKnownModel` | ✓ WIRED | Phase 11's 11-VERIFICATION.md key-links row confirms the import + refine is live; Phase 13 Plan 13-01 did not modify the refine. `zodErrorToIssues` in `src/lib/task-runtime-validation.ts` maps the refine message onto `UNKNOWN_MODEL` for the aggregated error shape (TCTX-05). |
| `src/lib/task-runtime-validation.ts` | `node:fs` (`realpath`) | `validateHostPathAgainstAllowlist` calls `fs.realpath` with parent-directory walk on ENOENT and subtree-prefix match against the allowlist | ✓ WIRED | Per 13-01-SUMMARY.md "Parent-Directory-Walk Semantics (locked for Phase 14)": realpath + parent walk + `ancestorReal + sep + tail.join(sep)` reassembly. Symlink-escape defense: a symlink outside the allowlist resolves to its target's realpath and is rejected via `OUT_OF_ALLOWLIST`. 33 validation tests in `src/lib/__tests__/task-runtime-validation.test.ts` cover symlink + parent-walk + trailing-sep + `OUT_OF_ALLOWLIST` + `ALLOWLIST_EMPTY` (TCTX-04). |
| `src/app/api/tasks/route.ts` | `src/lib/recipe-indexer.ts` (`getIndexedRecipeBySlug`) | POST handler discriminates `null` / `error_message` / `RecipeRow` to emit `RECIPE_NOT_FOUND` / `RECIPE_BROKEN` / `REQUIRED_BY_RECIPE` issues (TCTX-01 + TCTX-02) | ✓ WIRED | Per 13-02-SUMMARY.md "Business-rule pipeline" + verification-results grep line showing 3 hits of `getIndexedRecipeBySlug` in the file (import + usage + `ReturnType<typeof>`). |
| `src/app/api/tasks/[id]/route.ts` | `src/lib/recipe-indexer.ts` (`getIndexedRecipeBySlug`) | PUT handler mirrors the discrimination for recipe-change validation and the pre-dispatch `RECIPE_LOCKED` gate (TCTX-01 on PATCH) | ✓ WIRED | Per 13-03-SUMMARY.md "Change E (business rules)" + "recipe binding mutability" section. `RECIPE_SLUG_MUTABLE_STATUSES = new Set(['backlog', 'inbox'])`; identity PATCH bypasses the gate by comparing `body.recipe_slug ?? null` to `currentRecipeSlug`. |
| `.planning/phases/13-task-runtime-context-v1-2/13-VERIFICATION.md` | `src/lib/__tests__/phase-17-pipeline-integration.test.ts` | End-to-end exercise of TCTX-01..06 via the full reference pipeline (create task with runtime context → runner claim → container run → checkpoint → submit → review) | ✓ WIRED | Phase 17 Plan 17-02 integration test (884 lines) uses real helpers — `mc-hello-world-agent:latest` image, real runner claim, real checkpoint insert, real status flip — driving every TCTX-01..06 code path. Referenced as the primary end-to-end evidence in the v1.2 milestone audit (`.planning/v1.2-MILESTONE-AUDIT.md` line 15). |
| `.planning/phases/13-task-runtime-context-v1-2/13-VERIFICATION.md` | `src/lib/__tests__/phase-17-daemon-pipeline.test.ts` | End-to-end exercise of TCTX-01..06 through a spawned mc-runner.mjs subprocess (daemon-level) | ✓ WIRED | Phase 17 Plan 17-03 daemon integration test (649 lines) exercises the same pipeline through an actual child-process-spawned runner daemon — additional defense-in-depth on the same TCTX paths as 17-02. Referenced in `.planning/v1.2-MILESTONE-AUDIT.md` line 15 as the second end-to-end evidence path. |

## Gaps

No gaps. All six TCTX-01..06 success criteria verified retroactively via:

1. `requirements_completed: [TCTX-01, TCTX-02, TCTX-03, TCTX-04, TCTX-05, TCTX-06]` frontmatter arrays in `.planning/phases/13-task-runtime-context-v1-2/13-01-SUMMARY.md`, `13-02-SUMMARY.md`, and `13-03-SUMMARY.md` — three independent executors confirmed the requirement set satisfied at ship time (2026-04-19 / 2026-04-20 / 2026-04-20).
2. Phase 17 end-to-end integration-test evidence in `src/lib/__tests__/phase-17-pipeline-integration.test.ts` (full-pipeline via direct helpers) and `src/lib/__tests__/phase-17-daemon-pipeline.test.ts` (same pipeline through a spawned mc-runner.mjs subprocess) — TCTX-01..06 exercised under real-recipe + real-runner + real-container conditions.
3. REQUIREMENTS.md traceability table (v1.2 milestone audit, 2026-04-21) shows all six TCTX-01..06 rows checked `[x]` and linked to Phase 13 plans.

| Gap | Status |
|-----|--------|
| (none) | — |

## Re-verification

No — this is the initial (retroactive) verification for Phase 13.

---

*Verified: 2026-02-14 (retroactive backfill)*
*Closes v1.2 milestone audit tech-debt item #1 — see `.planning/v1.2-MILESTONE-AUDIT.md`*
