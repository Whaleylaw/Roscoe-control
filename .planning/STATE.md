---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: — Project Workspace & Dashboard
status: "Plan 14-08b shipped the orchestration layer. scripts/mc-runner.mjs is a standalone Node ESM daemon that composes every Phase 14 endpoint (heartbeat, ready-tasks, pending-containers, terminal-tasks, claim, runner-exit, container-started, config) with every pure-logic primitive (runner-preamble, runner-worktree, runner-docker, runner-gc, runner-reconcile, runner-timeout, runner-log-layout) into one process. Inline-duplication pattern: each helper block prefixed with `// NOTE: mirrors src/lib/runner-<name>.ts. Keep in sync.` Boot LOCKED: secret→docker info→/api/runner/config→reconcile→heartbeat→SSE+poll→GC tick. com.missioncontrol.runner.plist uses KeepAlive+ThrottleInterval 30 for clean Docker-down backoff. README covers install, secrets, log tailing via latest symlink, troubleshooting keyed off daemon exit codes."
stopped_at: "Plan 14-09 complete. mc-hello-world-agent:latest reference image built (node:22-alpine, 249 MB, 4 files under docker/hello-world-agent/ + pnpm mc:build-hello-world script). agent.mjs implements the LOCKED 7-step contract: env snapshot → read PREAMBLE+SOUL → append progress.md → append checkpoints.jsonl → git-commit HELLO.md → POST /api/runner/tasks/:id/submit (Plan 14-11 route — NOT PUT /api/tasks/:id) → exit 0. 105 lines of ESM Node stdlib, no deps. Commits 2317323 / 18815c6. Image verified via live docker build. 11/12 of Phase 14 shipped; 14-10 (recipes/hello-world + smoke harness + end-to-end human-verify) is the final plan."
last_updated: "2026-04-20T18:57:22.995Z"
last_activity: "2026-04-20 — Plan 14-08b executed in ~7min. Task 1 commit 8a74425 (scripts/mc-runner.mjs with 7-step boot sequence, SSE Pattern 2 subscriber, drift-resistant heartbeat, 10-min GC tick, claim→run→exit flow posting to container-started + runner-exit). Task 2 commit 8cea6d4 (LaunchAgent plist template with __MC_ROOT__ sed placeholder + operator README with troubleshooting matrix). Decisions logged: project_repo_map is EXCLUSIVELY via /api/runner/config (no env-var fallback); recipe secrets loaded at claim from .data/runner/secrets/<NAME> and merged into --env-file (never argv); SIGINT/SIGTERM don't post runner-exit (next boot reconciles); adopted containers get conservative 3600s fallback timeout because pending-containers doesn't carry recipe.timeout_seconds; SSE subscriber logs explicit boot message flagging Phase 15 emission gap."
progress:
  total_phases: 14
  completed_phases: 10
  total_plans: 52
  completed_plans: 57
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18 — Milestone v1.2 initialized)

**Core value:** When I click into a project, I see everything about that project and can manage all its work from one place, including driving it through its GSD lifecycle, and autonomous agents pick up assigned work, execute it in isolated containers, and move it through the Kanban.
**Current focus:** v1.2 milestone — recipe-based ephemeral agent runtime. Design spec committed at `docs/superpowers/specs/2026-04-18-recipe-agent-system-design.md`. Roadmap drafted (Phases 11–17). Next: `/gsd:plan-phase 11` for Runtime Foundation (DB migrations + model registry + auth principals).

## Current Position

Phase: 14 (Runner & Container v1.2) — IN PROGRESS (11/12 plans shipped: 14-01 migrations, 14-02 runtime settings + recipe max_attempts, 14-03 test scaffolds, 14-04 read-side runner API, 14-05 claim route, 14-06 runner-exit, 14-07 pure-logic lib primitives, 14-08a runner daemon primitives, 14-08b runner daemon script + LaunchAgent + README, 14-09 mc-hello-world-agent reference image, 14-11 submit+container-started+config endpoints)
Plans: 14-01 ✓, 14-02 ✓, 14-03 ✓, 14-04 ✓, 14-05 ✓, 14-06 ✓, 14-07 ✓, 14-08a ✓, 14-08b ✓, 14-09 ✓ (docker/hello-world-agent/ Dockerfile + agent.mjs + build.sh + README + pnpm mc:build-hello-world script; mc-hello-world-agent:latest built at 249 MB), 14-11 ✓, 14-10 ⏳
Status: Plan 14-09 shipped the reference image layer. docker/hello-world-agent/ contains a 4-file bundle (Dockerfile node:22-alpine, 105-line agent.mjs ESM Node stdlib, build.sh bash wrapper, operator README with 7-step behavior + synthetic-mount debug recipe). agent.mjs exercises the full Phase-14 contract: env snapshot → preamble+SOUL read → progress.md append → checkpoints.jsonl append → git-commit HELLO.md → POST /api/runner/tasks/:id/submit (Plan 14-11 route; NOT PUT /api/tasks/:id — runner-token allowlist in src/lib/runner-tokens.ts only permits /api/runner/tasks/:id/* paths). No /api/runner/checkpoint HTTP call (Phase 15); file-append is the Phase-14 checkpoint surface. No MC_HELLO_MODE test-mode switch (Phase 17). Image builds via `pnpm mc:build-hello-world` with zero warnings.
Last activity: 2026-04-20 — Plan 14-09 executed in ~2min. Task 1 commit 2317323 (Dockerfile + agent.mjs — Alpine base + git + ENV git-identity defaults + ENTRYPOINT node /app/agent.mjs; 7-step ESM agent with no dependencies). Task 2 commit 18815c6 (build.sh executable + README with 7-step behavior + manual-run recipe with synthetic mounts + Phase-17 MC_HELLO_MODE TODO + package.json mc:build-hello-world script alphabetized between mc and mc:mcp). Live docker build verified (249 MB mc-hello-world-agent:latest; no warnings). Decisions logged: submit path LOCKED to Plan 14-11 route (not PUT /api/tasks/:id) to satisfy RAUTH-06 allowlist; /docker/<name>/ reserved as new top-level dir for bundled runtime images; exit codes 1/3/4 classify agent failure surface.
Next: Plan 14-10 (recipes/hello-world recipe + smoke harness + end-to-end human-verify checkpoint). 14-10 is the final plan in Phase 14; image and daemon are both ready for live smoke-testing.

## Performance Metrics

**Velocity:**

- Total plans completed: 36
- Average duration: 7.2 min
- Total execution time: 4.3 hours

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
| Phase 14-runner-container-v1-2 P07 | 10min | 3 tasks | 8 files |
| Phase 14-runner-container-v1-2 P06 | 9min | 2 tasks + 1 pre-req | 3 files |
| Phase 14-runner-container-v1-2 P05 | 15min | 3 tasks | 4 files |
| Phase 14-runner-container-v1-2 P08b | 7min | 2 tasks | 3 files |
| Phase 14-runner-container-v1-2 P09 | 2min | 2 tasks | 5 files |

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
- [Phase 14-04]: Heartbeat body uses Math.floor(ts / 1000) to convert client-supplied unix-ms to column's unix-seconds; runner daemon sends Date.now() for JS parity, DB column is seconds matching migration 060 shape
- [Phase 14-04]: POST /api/runner/heartbeat uses mutationLimiter (60/min default) rather than a runner-specific limiter — at 10s heartbeat rhythm (6/min) this leaves 10x headroom; multi-runner deployments sharing an IP may need a runner-specific limiter in Phase 16 (documented as a route-level comment)
- [Phase 14-04]: /terminal-tasks response's `terminal_at` field is projected from tasks.updated_at (no dedicated column) — filter already ensures rows are in terminal status; a dedicated terminal_at column is a Phase 15+ concern if ever needed
- [Phase 14-04]: /terminal-tasks returns 400 on missing or unparseable ?since= rather than silently defaulting — runner tracks cursor locally, a malformed value indicates a client bug that silent fallback would mask
- [Phase 14-04]: All four 14-04 routes share the identical runner-secret guard prefix (requireRole(operator) → error check → user.id === -1000 check). Plans 14-05/14-06 must use the same 3-line idiom, not reinvent it
- [Phase 14-07]: Plan 14-08b daemon strategy LOCKED — inline re-declaration. scripts/mc-runner.mjs duplicates a minimal subset of src/lib/runner-*.ts helpers with a pointer comment back to the .ts file as source of truth + test surface. Avoids runtime tsx and Phase-14 bundle step. Future cleanup plan may unify via esbuild — not blocking
- [Phase 14-07]: Preamble HTTP skeleton forward-references POST {apiBase}/api/runner/tasks/\$MC_TASK_ID/submit (RAUTH-06 allowlist-safe), NOT PUT /api/tasks/:id. Tests defensively assert 'PUT /api/tasks/' is absent from both variants — closes the blocker where hello-world agents would call the allowlist-reject path
- [Phase 14-07]: stageRecipe writes PREAMBLE.md AFTER deep-copy so runner owns /recipe/PREAMBLE.md; any recipe-authored PREAMBLE.md gets overwritten. Agent reading order: PREAMBLE.md (runner) → SOUL.md (recipe author) → /workspace/.mc/*
- [Phase 14-07]: seedMcDir preserves existing progress.md + checkpoints.jsonl on resume (is_resuming=true) but ALWAYS rewrites task.json with new attempt counter + prior_attempts; defensive fallback creates empty placeholders if operator wiped worktree so agent's append-only write doesn't ENOENT
- [Phase 14-07]: CONTAINER-01 invariant enforced — no --env flag on docker argv carries MC_API_TOKEN value. Secrets flow via --env-file ONLY. Test scans every argv element for 'MC_API_TOKEN=' substring; composer uses only --env-file <path>
- [Phase 14-07]: Image is LAST argv element (guards against flag-ordering bug that would treat post-image flags as container argv). Explicit test asserts argv[argv.length - 1] === image
- [Phase 14-07]: writeEnvFile sanitises embedded \\n/\\r\\n in values to single space (defensive — env-file format is newline-separated; stray \\n would corrupt next key=value line). Real secrets should never carry line breaks, but recipe.env forwarded verbatim could
- [Phase 14-06]: runner-exit is runner-SECRET authenticated (id=-1000), not runner-TOKEN — the per-attempt runner-token may have expired by the time the container exits (especially on timeouts), and the daemon holding the long-lived secret is the reliable reporter.
- [Phase 14-06]: Successful exit (exit_code=0 AND reason='exit') DOES NOT flip task.status. The attempt row is persisted but the terminal transition to 'done' belongs to POST /api/runner/tasks/:id/submit (Plan 14-11) — the agent inside the container makes the deliberate choice, not the runner-exit reporter.
- [Phase 14-06]: reason='worktree_create_failed' short-circuits to terminal fail regardless of runner_attempts. Rationale: worktree creation failures are infrastructure-level (missing project repo, fs perms) and won't succeed on retry within the same task's lifetime.
- [Phase 14-06]: formatFailureReason produces 'exit:0' for successful exits (preserves exit code in attempt history). Applied the plan's exact rule: `reason='exit' && exit_code !== null` → `exit:${exit_code}`; exit_code=0 is non-null, so 'exit:0' appears in the attempt row — UI can distinguish a recorded successful run from a missing row.
- [Phase 14-06]: Defensive warn-log on task_runner_attempts UPDATE affecting 0 rows — handler continues with status transition rather than hard-failing. Losing attempt metadata is strictly preferable to wedging the state machine; the warn-log is a breadcrumb for investigating a broken claim-route invariant.
- [Phase 14-06]: Idempotency 409 guard (task.status IN ('done','failed','cancelled')) runs BEFORE any write. Daemon retries after a previously-successful POST get clean 409s and never overwrite attempt rows.
- [Phase 14-06]: Atomic revokeTokensForTask wrapped in the SAME db.transaction as the terminal-fail UPDATE — mirrors the Phase 11-04 invariant on src/app/api/tasks/[id]/route.ts. A crash between the two MUST roll both back.
- [Phase 14-06]: Created src/lib/runner-claim.ts with resolveRecipeMaxAttempts ahead of Plan 14-05 (same wave) — the route cannot compile without the import target. Plan 14-05 will extend the module with its additional helpers (resolveEffectiveModel, composeEnvMap, resolveResourceLimits, checkGlobalCap, checkPerRecipeCap, readPriorAttempts, buildDispatchPayload); no conflict.
- [Phase 14-05]: Response shape LOCKED for Plan 14-08b runner daemon: { task: {id, recipe_slug, workspace_source, read_only_mounts, extra_skills, attempt, is_resuming, prior_attempts, runner_max_attempts}, recipe: <RecipeRow>, env: Record<string,string>, runner_token_expires_at: number, resource_limits: {memory: string, cpus: number}, container_name_prefix: 'mc-task-<id>-a<attempt>' }. Two fields (resource_limits + container_name_prefix) are NEW beyond the 14-03 Wave-0 scaffold prose.
- [Phase 14-05]: Placeholder container_id = 'pending:<task_id>:<attempt>' set at claim time inside the atomic transaction. Concurrency cap queries (checkGlobalCap / checkPerRecipeCap) count these placeholders because they filter on `status='in_progress' AND container_id IS NOT NULL` — this guarantees a double-claim race at global-cap-minus-one cannot squeeze two containers past the cap. Plan 14-11 POST /api/runner/tasks/:id/container-started replaces the placeholder with the real Docker container_id after `docker run`.
- [Phase 14-05]: runner_max_attempts precedence LOCKED: `task.runner_max_attempts ?? resolveRecipeMaxAttempts(slug) ?? 3`. resolveRecipeMaxAttempts re-parses the on-disk recipe.yaml via getRecipesRoot() + readFileSync + parseRecipeYaml on EVERY claim — NEVER from getIndexedRecipeBySlug (which does not round-trip max_attempts). Confirmed by route-integration test #12 which writes a real recipe.yaml with max_attempts:5 and asserts response.task.runner_max_attempts === 5.
- [Phase 14-05]: Resource-limits helper (resolveResourceLimits) always consults admin ceilings (getMaxMemoryPerContainer + getMaxCpuPerContainer) and calls parseMemoryBytes on both sides before comparing. v1.2 recipe.yaml has no memory_limit / cpu_limit fields — runner defaults 2g + 1.0 always applied. Helper is forward-compat for a later phase that adds recipe-declared overrides without changing claim-route code.
- [Phase 14-05]: recipe.secrets is a list of ENV VAR NAMES ONLY at the HTTP surface — values are resolved by the runner daemon from .data/runner/secrets/<NAME> (Plan 14-08b). Keeping value-resolution out of the server preserves the 'secrets never touch HTTP' property; the claim route's composeEnvMap receives recipeSecrets=undefined.
- [Phase 14-05]: MC_API_URL in composed env uses `http://host.docker.internal:${PORT || 3000}` — the URL the container will use (not the browser's localhost URL). Matches the CONTEXT.md Docker networking decision (`--add-host host.docker.internal:host-gateway`).
- [Phase 14-08b]: scripts/mc-runner.mjs inline-duplicates a minimal subset of src/lib/runner-*.ts primitives with `// NOTE: mirrors src/lib/runner-<name>.ts. Keep in sync.` pointer comments. Future bundle step may unify via esbuild; for now the .ts files are canonical contract + test surface, .mjs is thin runtime shim.
- [Phase 14-08b]: Boot sequence LOCKED per 14-CONTEXT.md 7-step order: runner.secret (exit 1) → docker info (exit 2) → /api/runner/config (exit 1) → reconcile → heartbeat → SSE+poll → GC tick. project_repo_map resolution is EXCLUSIVELY via /api/runner/config; SIGHUP re-fetches. No env-var fallback — a misconfigured /api/runner/config must fail loud at boot rather than silently ship wrong repo paths.
- [Phase 14-08b]: Recipe-declared secrets (recipe.secrets is ENV NAMES only) are read from .data/runner/secrets/<NAME> at claim time and merged into the docker `--env-file`. Missing files log a warning and are omitted — intentional graceful degradation. Never passed on argv (CONTAINER-01 invariant).
- [Phase 14-08b]: SIGINT/SIGTERM don't post runner-exit for active tasks. Next boot reconciles orphaned containers and posts runner-exit reason='crash'. Intentional tradeoff — the daemon can crash unexpectedly anyway, so the graceful path reuses the same recovery mechanism via reconcile. Simpler + tested-once-covers-both.
- [Phase 14-08b]: Adopted containers use 3600s conservative fallback timeout because pending-containers doesn't return recipe.timeout_seconds. Refetching the recipe per adopted task is a Phase 17+ refinement. In practice containers exit naturally or the watchdog stops them; only matters for "daemon died mid-run, container still alive past its original timeout" window.
- [Phase 14-08b]: SSE subscriber is already wired via Pattern 2 (fetch + ReadableStream + newline splitter) + exponential backoff reconnect, but emits an explicit info log at boot: 'SSE subscribed; task.runner_requested emission starts in Phase 15 — relying on 15s poll until then'. Operator diagnostic so the absence of SSE frames in Phase 14 isn't alarming.
- [Phase 14-08b]: LaunchAgent KeepAlive + ThrottleInterval 30 → Docker-down backoff is clean (runner exits 2, launchd restarts after 30s — MC sees clean offline window rather than degraded state). No "up but Docker unavailable" signalling per CONTEXT.md "degraded runner state" deferred item.
- [Phase 14-runner-container-v1-2]: [Phase 14-09]: agent.mjs POSTs /api/runner/tasks/:id/submit (Plan 14-11 route), NOT PUT /api/tasks/:id — runner-token allowlist only permits /api/runner/tasks/:id/* paths; a PUT would 401 at the RAUTH-06 guard. LOCKED change from CONTEXT.md prose.
- [Phase 14-runner-container-v1-2]: [Phase 14-09]: Reference images live under /docker/<name>/ — new top-level dir reserved for bundled runtime Docker images. mc-hello-world-agent:latest builds to 249 MB (node:22-alpine + apk git + single-file agent.mjs). No registry push; operators build locally via `pnpm mc:build-hello-world`.
- [Phase 14-runner-container-v1-2]: [Phase 14-09]: agent.mjs has NO /api/runner/checkpoint HTTP call — only local file-append to /workspace/.mc/checkpoints.jsonl. Phase 15 will insert the HTTP POST between steps 4 and 5 without changing any other step. File-append remains a permanent local audit trail.
- [Phase 14-runner-container-v1-2]: [Phase 14-09]: Agent exit codes classify failure surface — 1=main() throw, 3=POST submit non-2xx response, 4=POST submit fetch threw (network). Runner's runner-exit handler (Plan 14-06) classifies via reason='exit' + exit_code.

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

Last session: 2026-04-20T18:57:22.985Z
Stopped at: Plan 14-09 complete. mc-hello-world-agent:latest reference image built (node:22-alpine, 249 MB, 4 files under docker/hello-world-agent/ + pnpm mc:build-hello-world script). agent.mjs implements the LOCKED 7-step contract: env snapshot → read PREAMBLE+SOUL → append progress.md → append checkpoints.jsonl → git-commit HELLO.md → POST /api/runner/tasks/:id/submit (Plan 14-11 route — NOT PUT /api/tasks/:id) → exit 0. 105 lines of ESM Node stdlib, no deps. Commits 2317323 / 18815c6. Image verified via live docker build. 11/12 of Phase 14 shipped; 14-10 (recipes/hello-world + smoke harness + end-to-end human-verify) is the final plan.
Resume file: None
