---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: — Project Workspace & Dashboard
status: unknown
last_updated: "2026-04-20T18:23:51.517Z"
progress:
  total_phases: 14
  completed_phases: 10
  total_plans: 52
  completed_plans: 53
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18 — Milestone v1.2 initialized)

**Core value:** When I click into a project, I see everything about that project and can manage all its work from one place, including driving it through its GSD lifecycle, and autonomous agents pick up assigned work, execute it in isolated containers, and move it through the Kanban.
**Current focus:** v1.2 milestone — recipe-based ephemeral agent runtime. Design spec committed at `docs/superpowers/specs/2026-04-18-recipe-agent-system-design.md`. Roadmap drafted (Phases 11–17). Next: `/gsd:plan-phase 11` for Runtime Foundation (DB migrations + model registry + auth principals).

## Current Position

Phase: 14 (Runner & Container v1.2) — IN PROGRESS (5/12 plans shipped: 14-01 migrations, 14-02 runtime settings + recipe max_attempts, 14-03 test scaffolds, 14-08a runner daemon primitives, 14-11 submit+container-started+config endpoints)
Plans: 14-01 ✓ (migrations 060/061), 14-02 ✓ (5 runtime.* settings + 5 getters + recipe.max_attempts + 17 tests), 14-03 ✓ (Wave-0 test scaffolds — 11 files / 60 it.todos), 14-08a ✓ (runner-gc + runner-reconcile + runner-timeout + runner-log-layout — 4 pure-logic helpers + 26 unit tests), 14-11 ✓ (POST /api/runner/tasks/:id/submit + POST /api/runner/tasks/:id/container-started + GET /api/runner/config — 3 routes + 17 tests), 14-04..14-07, 14-08b, 14-09..14-10 ⏳
Status: Plan 14-11 shipped three runner-facing HTTP endpoints missing from the v1 Phase 14 plan. POST /api/runner/tasks/:id/submit is runner-token scoped (-2000); the agent container uses it for its terminal-flip to 'done' with atomic revokeTokensForTask. POST /api/runner/tasks/:id/container-started is runner-secret scoped (-1000); the daemon calls it right after `docker run` returns to swap the 'pending:<task>:<attempt>' placeholder for the real container_id. GET /api/runner/config is runner-secret scoped; returns the five runtime.* settings (max_concurrent_containers, project_repo_map, max_memory_per_container, max_cpu_per_container, failed_gc_window_days) in one payload for daemon startup + SIGHUP reload. 17 tests (7 + 6 + 4); lint 0 errors; typecheck unchanged (pre-existing heartbeat TS2345 from 14-04 still tracked in deferred-items.md).
Last activity: 2026-04-20 — Plan 14-11 executed. Task 1 commit 3daf4e4 (submit route + 7 tests). Task 2 commit 547e902 (container-started route + 6 tests). Task 3 commit f10f386 (config route + 4 tests). Decisions: resolution body field is advisory with pragma_table_info probe; placeholder-swap is a three-way fork (idempotent retry / swap / conflict) not two; runner-secret vs runner-token dispatch is explicit via id-sentinel check, never inferred from role; /api/runner/config has no rate limit (read-only, matches other runner-secret GETs).
Next: Plan 14-08b (runner daemon `scripts/mc-runner.mjs`) — wires Plan 14-08a primitives together with `docker run`/`docker ps`/`docker kill`/`docker logs -f` + HTTP. Can now call: GET /api/runner/config at startup (Plan 14-11), POST /api/runner/tasks/:id/container-started after docker run (Plan 14-11), and rely on revokeTokensForTask firing transactionally when the agent /submits (Plan 14-11 + Plan 11-04).

## Performance Metrics

**Velocity:**

- Total plans completed: 35
- Average duration: 7.2 min
- Total execution time: 4.2 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 3 | 7 min | 2.3 min |
| 02-navigation-workspace-shell | 2 | 4 min | 2.0 min |
| 03-project-dashboard | 3 | 5 min | 1.7 min |
| 04-project-tasks | 2 | 14 min | 7.0 min |
| 05-sessions-agents | 4 | 23 min | 5.8 min |
| 06-settings | 2 | 17 min | 8.5 min |
| 07-post-audit-gap-closure | 2 | 10 min | 5.0 min |
| 08-projects-entry-point | 6 | 46 min | 7.7 min |
| 09-gsd-native-integration | 11 | 126 min | 11.5 min |

**Recent Trend:**

- Last 5 plans: 09-06 (6 min), 09-09 (7 min), 09-08 (5 min), 09-07 (10 min), 09-10 (59 min)
- Trend: Elevated by final Wave 4 verification sweep (09-10)

*Updated after each plan completion*
| Phase 01-foundation P00 | 1min | 3 tasks | 3 files |
| Phase 01-foundation P01 | 4min | 2 tasks | 12 files |
| Phase 01-foundation P02 | 2min | 2 tasks | 12 files |
| Phase 02 P00 | 1min | 2 tasks | 4 files |
| Phase 02 P01 | 3min | 2 tasks | 14 files |
| Phase 03 P00 | 1min | 1 tasks | 1 files |
| Phase 03 P01 | 3min | 2 tasks | 6 files |
| Phase 03 P02 | 1min | 2 tasks | 1 files |
| Phase 04-project-tasks P00 | 2min | 3 tasks | 3 files |
| Phase 04-project-tasks P01 | 12min | 5 tasks | 5 files |
| Phase 05-sessions-agents P00 | 4min | 7 tasks | 18 files |
| Phase 05-sessions-agents P02 | 4min | 3 tasks | 8 files |
| Phase 05-sessions-agents P01 | 6min | 3 tasks | 6 files |
| Phase 05-sessions-agents P03 | 9min | 3 tasks | 7 files |
| Phase 06-settings P00 | 7min | 2 tasks tasks | 12 files files |
| Phase 06-settings P01 | 10min | 2 tasks | 2 files |
| Phase 07-post-audit-gap-closure P00 | 3min | 2 tasks | 12 files |
| Phase 07-post-audit-gap-closure P01 | 7min | 2 tasks | 5 files |
| Phase 08-projects-entry-point P00 | 2min | 2 tasks | 3 files |
| Phase 08-projects-entry-point P02 | 6min | 3 tasks | 5 files |
| Phase 08-projects-entry-point P01 | 8min | 3 tasks | 14 files |
| Phase 08-projects-entry-point P03 | 10min | 1 tasks | 1 files |
| Phase 08-projects-entry-point P04 | 8min | 1 tasks | 12 files |
| Phase 08-projects-entry-point P05 | ~12min | 2 tasks | 12 files |
| Phase 09-gsd-native-integration P00 | 6min | 2 tasks | 27 files |
| Phase 09-gsd-native-integration P01 | 5min | 2 tasks | 6 files |
| Phase 09-gsd-native-integration P04 | 7min | 1 tasks | 2 files |
| Phase 09-gsd-native-integration P05 | 6min | 2 tasks | 3 files |
| Phase 09-gsd-native-integration P02 | 7min | 2 tasks | 5 files |
| Phase 09-gsd-native-integration P03 | 8min | 2 tasks | 4 files |
| Phase 09-gsd-native-integration P06 | 6min | 1 tasks | 3 files |
| Phase 09-gsd-native-integration P09 | 7min | 1 tasks | 3 files |
| Phase 09-gsd-native-integration P08 | 5min | 2 tasks | 6 files |
| Phase 09-gsd-native-integration P07 | 10min | 2 tasks tasks | 14 files files |
| Phase 09-gsd-native-integration P10 | 59min | 3 tasks | 7 files |
| Phase 11 P03 | 8min | 2 tasks | 2 files |
| Phase 11-runtime-foundation-v1-2 P01 | 7min | 2 tasks | 4 files |
| Phase 11-runtime-foundation-v1-2 P02 | 10min | 2 tasks | 6 files |
| Phase 11-runtime-foundation-v1-2 P04 | 10min | 3 tasks | 7 files |
| Phase 12-recipe-system-v1-2 P01 | 7 | 2 tasks | 6 files |
| Phase 12-recipe-system-v1-2 P02 | 9min | 2 tasks | 4 files |
| Phase 12-recipe-system-v1-2 P03 | 5min | 2 tasks | 4 files |
| Phase 12-recipe-system-v1-2 P04 | 13min | 3 tasks | 9 files |
| Phase 13-task-runtime-context-v1-2 P01 | 10min | 3 tasks | 7 files |
| Phase 13-task-runtime-context-v1-2 P02 | 7min | 2 tasks | 2 files |
| Phase 13-task-runtime-context-v1-2 P03 | 10min | 2 tasks | 5 files |
| Phase 14-runner-container-v1-2 P03 | 4min | 2 tasks | 11 files |
| Phase 14-runner-container-v1-2 P02 | 4min | 3 tasks tasks | 4 files files |
| Phase 14-runner-container-v1-2 P01 | 7 | 2 tasks | 2 files |
| Phase 14-runner-container-v1-2 P08a | 4 | 2 tasks | 8 files |
| Phase 14-runner-container-v1-2 P11 | 5min | 3 tasks | 6 files |
| Phase 14-runner-container-v1-2 P04 | 9min | 3 tasks | 8 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.2 roadmap]: Derived 7 phases (11–17) from 72 v1.2 REQ-IDs using dependency boundaries — Foundation (schema + registry + auth) → Recipe System → Task Runtime Context → Runner & Container → Checkpoints & Scheduler → UI Surfaces → Integration Testing
- [v1.2 roadmap]: Phase 11 deliberately scoped to substrate only (migrations + model registry + auth principals) because every later phase depends on it; no runtime code in Phase 11 to keep the foundation shippable as a pure additive migration
- [v1.2 roadmap]: Model-registry validation split across three phases — registry module + task-override validation land in Phase 11 (MODEL-01, MODEL-03), recipe-index-time validation in Phase 12 (MODEL-02), claim-time model resolution (`task.model_override ?? recipe.model.primary`) in Phase 14 (MODEL-04) — each lands where its consumer code lives
- [v1.2 roadmap]: Runner daemon + container execution + worktree lifecycle + `.mc/` seeding + reference image all ship together in Phase 14 because they are mutually dependent — the daemon is not useful without the worktree layout, and the worktree layout is not observable without a container
- [v1.2 roadmap]: Checkpoints and scheduler hooks grouped into Phase 15 because the checkpoint API needs runner-tokens (Phase 11), the runner code path emitting checkpoints (Phase 14), and the scheduler emits the same `task.runner_requested` events that drive claim — the three surfaces are the glue that makes the system reactive
- [v1.2 roadmap]: UI isolated to Phase 16 (and all UI REQs — RUI-01..06 — land there) so the runtime can be shipped and exercised via CLI/MCP/curl before the visual layer is built; matches v1.0/v1.1 precedent of UI-phase separation
- [v1.2 roadmap]: Integration testing capped the milestone in Phase 17 to avoid scope pollution — unit tests for sharp-edge pieces live with each phase during execution, but the reference-image pipeline test, crash-recovery test, and Playwright E2E all depend on Phases 11–16 being fully wired
- Recent phases (09/10) already logged in PROJECT.md Key Decisions table; not duplicated here
- [Phase 11]: Migration IDs renumbered 054-057 (not 036-039 as plan specified) because migrations[] already extends through 053_gsd_hierarchy_foundation; downstream plans must reference the actual applied IDs
- [Phase 11]: task_runner_tokens and task_checkpoints do NOT carry workspace_id/tenant_id columns — scoping flows through the parent tasks row and FK CASCADE handles cleanup; Plan 11-04 enforces task-to-workspace scoping at the auth layer
- [Phase 11]: runner_attempts is the only new tasks column with a non-null default (INTEGER NOT NULL DEFAULT 0); all other runtime fields (recipe_slug, model_override, container_id, runner_started_at, runner_exit_code, worktree_path, runner_max_attempts, runner_last_failure_reason, workspace_source, read_only_mounts, extra_skills) are nullable — downstream code must handle NULL
- [Phase 11-runtime-foundation-v1-2]: Model registry is code-seeded immutable const — no override file, no alias map, adding a model = a PR
- [Phase 11-runtime-foundation-v1-2]: Zod v4 uses { error: (issue) => ... } for dynamic refine messages — the v3 function-form was removed
- [Phase 11-02 / RAUTH-01]: Runner principal uses id=-1000 sentinel — outside both 1..N user range AND -agent_id range (agent API keys); Phase 14 claim-route code can dispatch on `user.id === -1000` without string-comparing username
- [Phase 11-02 / RAUTH-01]: Runner role = 'operator' not 'admin' — write access for checkpoints/claim (Phase 14/15) but NOT superuser; matches RAUTH-01 principle of least privilege
- [Phase 11-02 / RAUTH-01]: Path-scope gate (url.pathname.startsWith('/api/runner/')) is the SOLE check that ever compares a bearer against the runner secret; falls through on mismatch so session cookies and (Plan 11-04) runner-tokens can still resolve on runner paths
- [Phase 11-02 / RAUTH-01]: extractApiKeyFromHeaders is the shared bearer extractor — Plan 11-04 must reuse, do not fork
- [Phase 11-04]: Cross-task 403 enforced in requireRunnerToken wrapper, NOT in getUserFromRequest — concentrates 401-vs-403 decision in one place; route handlers MUST use wrapper
- [Phase 11-04]: Runner-token principal uses id=-2000 sentinel — distinct from -1000 (runner-secret) and -agent_id (agent keys); Phase 14/15 can dispatch on user.id === -2000
- [Phase 11-04]: Atomic revocation on terminal task transitions (done/failed/cancelled) wrapped in SAME db.transaction as status UPDATE — no sweeper, no lazy-on-reuse; crash rolls BOTH back
- [Phase 11-04]: runner_token_task_id populated in BOTH getUserFromRequest branch AND requireRunnerToken wrapper — downstream handlers cross-check as defense-in-depth
- [Phase 11-04]: Strict <= expiry rejection in verifyRunnerToken so a token cannot be used AT its exact expiry moment — guards against clock-skew
- [Phase 12-recipe-system-v1-2]: [Phase 12-01]: FTS5 table is standalone (contentful), not external-content — content='recipes' requires FTS5 column names to match content-table columns, and 'tags' vs 'tags_json' mismatch blocked external-content; triggers give equivalent sync semantics
- [Phase 12-recipe-system-v1-2]: [Phase 12-01]: bm25 column weights (tags 2x) applied at QUERY time (Plan 12-04), not in the FTS5 schema — keeps virtual table neutral and lets callers tune ranking without re-migrating
- [Phase 12-recipe-system-v1-2]: [Phase 12-01]: parseRecipeYaml returns discriminated ParseResult ({ok,value}|{ok,error}) — never throws; aligns with error_message column flow so indexer/API uniformly write messages without try/catch
- [Phase 12-recipe-system-v1-2]: [Phase 12-02]: Error rows carry computed dir_sha (not empty string) so future joins on dir_sha stay consistent; fast-path dedup blocked by error_message IS NOT NULL so a fix re-parses even with no other file changes
- [Phase 12-recipe-system-v1-2]: [Phase 12-02]: Slug-mismatch between directory basename and recipe.yaml slug is a hard-fail error-row path — prevents watcher/API disagreement on which row to target
- [Phase 12-recipe-system-v1-2]: [Phase 12-02]: getIndexedRecipeBySlug owns JSON column deserialisation (env_json → env, etc.); API routes in 12-04 never call JSON.parse directly — one place to change if JSON encoding evolves
- [Phase 12-recipe-system-v1-2]: [Phase 12-03]: Recipes root defaults to <cwd>/recipes via MISSION_CONTROL_RECIPES_DIR, NOT MISSION_CONTROL_DATA_DIR — recipe directories are authored code living alongside src/ and scripts/, not runtime state
- [Phase 12-recipe-system-v1-2]: [Phase 12-03]: Boot scan is BLOCKING — startRecipeWatcher awaits scanRecipesDir before the chokidar watcher is created and before the function returns; 12-04's boot hook must await startRecipeWatcher BEFORE server.listen() so DB matches disk when traffic opens
- [Phase 12-recipe-system-v1-2]: [Phase 12-03]: chokidar 'ignored' is a basename-function filter (not a glob) — version-stable across chokidar majors and identical behaviour across fsevents/inotify/polling backends; rejects .DS_Store, *.swp, *~, *.tmp
- [Phase 12-recipe-system-v1-2]: [Phase 12-03]: Partial-unlink events call indexRecipe (not removeRecipe directly); indexRecipe's 'skipped_missing' IndexResult tells the handler when to drop the row — one code path covers 'deleted sentinel recipe.yaml' and 'deleted side file' cases consistently
- [Phase 12-recipe-system-v1-2]: [Phase 12-03]: startRecipeWatcher awaits chokidar 'ready' event before returning — avoids race between function-return and macOS fsevents registration that would drop writes issued immediately after boot
- [Phase 12-recipe-system-v1-2]: [Phase 12-04]: `mutationLimiter` is a direct function — called `mutationLimiter(request)`, NOT `mutationLimiter.check(request, key)`; the plan's sketch used a non-existent `.check` API and had to be fixed. Every API route (alerts, webhooks, integrations) uses the direct form — any new mutation endpoint must match.
- [Phase 12-recipe-system-v1-2]: [Phase 12-04]: `getRecipesRoot` cannot be intercepted via `vi.mock('@/lib/recipe-watcher')` for tests that exercise `resyncRecipes → scanRecipesDir` because the internal call is closure-bound, not an export-binding lookup; resync tests must set `MISSION_CONTROL_RECIPES_DIR` in `beforeEach` instead. Route-file tests (POST, etc.) CAN use vi.mock because route.ts imports `getRecipesRoot` at the top.
- [Phase 12-recipe-system-v1-2]: [Phase 12-04]: POST /api/recipes rollback deletes BOTH the disk directory AND the error row `indexRecipe` wrote on failure — keeps retry semantics idempotent (otherwise the error row would be read by the 409 conflict check on a subsequent POST)
- [Phase 12-recipe-system-v1-2]: [Phase 12-04]: Recipe watcher boot-wire lives INSIDE the scheduler's `if (!isBuildPhase && !isTestMode)` branch in `initializeSchema`, not in a parallel branch — both subsystems share the runtime-only gate so build/test behavior stays congruent
- [Phase 12-recipe-system-v1-2]: [Phase 12-04]: `?include_broken=1` requires admin — error rows contain parser detail and path fragments that could leak filesystem structure; viewer tier sees only healthy recipes
- [Phase 12-recipe-system-v1-2]: [Phase 12-04]: Phase 13 discrimination rule: task-creation handlers with `recipe_slug` MUST call `getIndexedRecipeBySlug(slug)` and reject when return is `null` OR `error_message !== null`; only dispatch when the returned row is a `RecipeRow` — documented in 12-04-SUMMARY "Phase 13 Entry Point"
- [Phase 13-01]: [Phase 13-01]: Moved createTaskSchema extension from Plan 13-02 into 13-01 so Plans 13-02 (POST handler) and 13-03 (PATCH handler) are file-disjoint for src/lib/validation.ts and can run in parallel in wave 2
- [Phase 13-01]: [Phase 13-01]: validateHostPathAgainstAllowlist walks parent directories on ENOENT (re-attaches unresolved tail to realpath of nearest existing ancestor); lets not-yet-existing paths like worktree targets validate while preserving symlink semantics for whatever does exist. CONTEXT.md: existence NOT enforced at task creation
- [Phase 13-01]: [Phase 13-01]: Allowlist entries that fail to realpath are silently skipped (not logged per-call) — a misconfigured entry must not bypass checks and must not spam logs; skipping means validation falls to OUT_OF_ALLOWLIST
- [Phase 13-01]: [Phase 13-01]: TASK_RUNTIME_ERROR_CODES locked as SCREAMING_SNAKE const assertion — shared vocabulary for API validation (13-02/13-03), runner claim-time re-validation (Phase 14), and future UI error mapping (Phase 16). Phase 14 runner MUST import validateHostPathAgainstAllowlist and emit codes from the same enum
- [Phase 13-01]: [Phase 13-01]: Caps (getMountsCap/getExtraSkillsCap) enforced in route handlers, not in Zod refinements — caps are admin-mutable via PUT /api/settings, and Zod closures would freeze the value at module-eval; route handlers call the getter per request
- [Phase 14-03]: Wave-0 scaffold pattern (precedent 11-00/12-00/13-00) applied: 11 test files with 60 it.todo stubs written BEFORE any route.ts or runner-*.ts implementation exists. Every stub message is prefixed with its primary requirement ID (e.g. 'RUNNER-06:', 'CONTAINER-01:') so `pnpm test --reporter=verbose` prints requirement-by-requirement. Wave 1/2 plans replace each .todo in-place — they do NOT create parallel test files.
- [Phase 14-03]: Claim-route scaffold placed at src/app/api/runner/claim/[task_id]/__tests__/route.test.ts — dynamic [task_id] segment is part of the directory path (Next.js App Router convention, matches src/app/api/tasks/[id]/__tests__/).
- [Phase 14-03]: runner-recipe-stage scaffold encodes Pitfall 10 (stage path must resolve OUTSIDE MISSION_CONTROL_RECIPES_DIR or chokidar re-indexes the staged copy); runner-docker-args scaffold encodes CONTAINER-01 invariant (no --env flag on argv carries MC_API_TOKEN value — secrets pass via --env-file only).
- [Phase 14-03]: Did NOT scaffold runner-worktree-git.test.ts (child_process against real git). Reason: git worktree operations are integration-heavy and belong to Plan 14-08b, which owns its own test file on top of this Wave-0 set.
- [Phase 14-02]: max_attempts NOT persisted to recipes DB row; Plan 14-05 / 14-06 re-parse recipe.yaml from disk. Resolution rule: task.runner_max_attempts ?? recipe.max_attempts ?? 3
- [Phase 14-02]: Five Phase 14 runtime.* getters use Phase 13 defensive-default pattern; missing row / junk value falls back to documented default — corrupt settings row cannot brick claim or GC
- [Phase 14-02]: getProjectRepoMap filters non-string / empty values at read time so claim code gets a guaranteed Record<string,string> and dispatches MISSING_PROJECT_REPO purely on key membership
- [Phase 14-01]: Migration target was main migrations[] array, not extraMigrations[] — precedent pattern from 054-059. extraMigrations[] is plugin-hook-populated only.
- [Phase 14-01]: runner_heartbeats UPSERT preserves registered_at by omitting it from the SET clause — first-registration timestamp is never overwritten across heartbeats.
- [Phase 14-01]: task_runner_attempts UNIQUE(task_id, attempt) enables Plan 14-05 claim route INSERT ON CONFLICT DO NOTHING without SELECT-then-INSERT round-trip; FK CASCADE matches task_runner_tokens (migration 055) precedent.
- [Phase 14-08a]: Pure-logic runner helpers (gc/reconcile/timeout/log-layout) live in src/lib/ as the canonical contract + test surface; Plan 14-08b daemon either imports or inline-duplicates but these modules are source of truth (26 unit tests)
- [Phase 14-08a]: latest symlink target is RELATIVE (attempt-<n>, not absolute) so .data/runner/logs/ stays portable if moved; readlinkSync(latest) === 'attempt-<n>'
- [Phase 14-08a]: reconcileContainers ignores exited containers entirely — docker --rm removes them, treating transient exited rows as kill targets would docker-kill an already-removed container
- [Phase 14-08a]: computeRemainingTimeoutMs is resync-safe: daemon re-derives remaining time from mc.runner_started_at label on every tick, never starts local timer — restart does NOT extend deadline (Pitfall 9)
- [Phase 14-11]: /submit resolution field is advisory and guarded by pragma_table_info probe — migration 061 does NOT include resolution_notes on task_runner_attempts; handler writes only when the column exists (forward-compat hook for a later migration)
- [Phase 14-11]: /container-started is a three-way fork (same id → 204 idempotent / placeholder or NULL → swap → 204 / different real id → 409 conflict); two-way fork would break idempotent retries from network timeouts
- [Phase 14-11]: Runner-secret (-1000) vs runner-token (-2000) dispatch is explicit at route layer via `if (auth.user.id !== EXPECTED_SENTINEL) return 403` — never relies on role='operator' (both principals share the role)
- [Phase 14-11]: GET /api/runner/config has no rate limit — read-only endpoint matches precedent for other runner-secret GETs; daemon polls on SIGHUP, not per-request

### Pending Todos

- Run `/gsd:plan-phase 11` to produce the Runtime Foundation plan (DB migrations + model registry + auth principals).
- Decide disposition of untracked session-send API experiments before Phase 14 runner work begins (`src/app/api/sessions/send/route.ts`, `src/app/api/sessions/hermes/send/route.ts`).
- Confirm the runner-token expiry calculation (`runner_started_at + recipe.timeout_seconds + 60s`) against the spec during Phase 11 planning so the column types in migration and the auth-layer arithmetic stay in sync.

### Blockers/Concerns

- No active blockers for v1.2 foundation planning.
- Reference image (`mc-hello-world-agent`) must be built and available in the local Docker daemon by Phase 14 — if the image author hasn't landed it by then, Phase 14 will block on its arrival.
- Docker is a hard runtime dependency for Phase 14; no substitute path is planned. Any operator environments without Docker will be unable to exercise the runner and will need to wait for v2 alternatives.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260415-eev | Add GSD CLI subcommands (projects create/list/get/bootstrap/transition, tasks gate, tasks list filters) | 2026-04-15 | 2ef0ef8 | [260415-eev-add-gsd-cli-subcommands-projects-create-](./quick/260415-eev-add-gsd-cli-subcommands-projects-create-/) |
| 260416-hna | Refactor Hermes send route (drop any-casts, route default URL through config, document intentional inlinings) | 2026-04-16 | c35839c | [260416-hna-refactor-api-sessions-hermes-send-remove](./quick/260416-hna-refactor-api-sessions-hermes-send-remove/) |

## Session Continuity

Last session: 2026-04-20T18:22:00Z
Stopped at: Plan 14-11 complete. Three runner-facing HTTP endpoints: POST /api/runner/tasks/:task_id/submit (runner-token; agent terminal-flip to 'done' + atomic revokeTokensForTask), POST /api/runner/tasks/:task_id/container-started (runner-secret; placeholder-swap from pending:* to real docker container_id, three-way fork for idempotency/conflict), GET /api/runner/config (runner-secret; five runtime.* settings in one payload). 17 Vitest cases (7 + 6 + 4) all pass; lint 0 errors; typecheck unchanged. Commits 3daf4e4 (Task 1 submit) / 547e902 (Task 2 container-started) / f10f386 (Task 3 config). Plan 14-09's hello-world agent can now submit via the supported path (not PUT /api/tasks/:id which fails the RUNNER_TOKEN_ALLOWLIST); Plan 14-08b's daemon can boot-config + swap placeholders.
Resume file: .planning/phases/14-runner-container-v1-2/14-11-SUMMARY.md
