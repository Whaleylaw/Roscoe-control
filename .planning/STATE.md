---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: — Project Workspace & Dashboard
status: unknown
last_updated: "2026-04-19T03:24:57.380Z"
progress:
  total_phases: 12
  completed_phases: 8
  total_plans: 37
  completed_plans: 40
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18 — Milestone v1.2 initialized)

**Core value:** When I click into a project, I see everything about that project and can manage all its work from one place, including driving it through its GSD lifecycle, and autonomous agents pick up assigned work, execute it in isolated containers, and move it through the Kanban.
**Current focus:** v1.2 milestone — recipe-based ephemeral agent runtime. Design spec committed at `docs/superpowers/specs/2026-04-18-recipe-agent-system-design.md`. Roadmap drafted (Phases 11–17). Next: `/gsd:plan-phase 11` for Runtime Foundation (DB migrations + model registry + auth principals).

## Current Position

Phase: 12 (Recipe System) — Wave 1 IN PROGRESS
Plan: 12-01 complete (recipe substrate: migrations 058+059, parseRecipeYaml, types). Next: 12-02 (indexer), 12-03 (watcher), 12-04 (API).
Status: 1/4 plans committed (12-01 b8472c2/d764b05); RECIPE-02, RECIPE-04, RECIPE-08 shipped
Last activity: 2026-04-19 — Plan 12-01 complete (migrations 058_recipes_error_message + 059_recipes_fts5; parseRecipeYaml Zod schema with MODEL-02 registry refinement; RecipeRow/RecipeErrorRow/RecipeModel types; yaml@^2.8.3 dep; 13 new Vitest cases)
Next: Plan 12-02 (recipe indexer) — consumes parseRecipeYaml + RecipeRow from 12-01

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

Last session: 2026-04-19T03:23:20Z
Stopped at: Completed 12-01-PLAN.md — migrations 058+059 (recipes.error_message + recipes_fts5 with sync triggers), parseRecipeYaml Zod schema with MODEL-02 registry refinement, RecipeRow/RecipeErrorRow/RecipeModel types, yaml@^2.8.3 dep; 13 new Vitest cases; full suite 1743 pass; Phase 12 wave-1 substrate ready for 12-02/12-03/12-04
Resume file: None
