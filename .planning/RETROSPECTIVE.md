# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.2 — Recipe-Based Ephemeral Agent Runtime

**Shipped:** 2026-04-21
**Phases:** 9 (11–18.1) | **Plans:** 53 | **Commits in range:** 202 | **Timeline:** 3 days elapsed (2026-04-18 → 2026-04-21)

### What Was Built
- Filesystem-first recipe card system at `recipes/<slug>/` with chokidar indexer, Zod schema validation, recipe CRUD + search API, and admin resync
- SQLite migrations (recipes, task_runner_tokens, task_checkpoints, 11 new task columns), model registry, and `runner` + `runner-token` auth principals as pure additive substrate (Phase 11)
- `scripts/mc-runner.mjs` standalone daemon: claim-based dispatch, `docker run` with allowlisted mounts, heartbeat, crash-recovery with `.mc/` worktree seeding and resume preamble
- Dual-write checkpoint system (DB + `.mc/checkpoints.jsonl`) with blocked → awaiting_owner flow and scheduler hooks (`autoRouteInboxTasks`, `requeueStaleTasks`, `reconcileRunnerHeartbeat`)
- Runtime UI surfaces — RecipeBadge, RunnerStatusBanner, Progress tab with per-attempt checkpoint timeline, RecipeCombobox + Advanced section on task form, Recipes panel, 10-locale i18n
- End-to-end integration proof — unit tests + direct-helper integration + daemon-subprocess integration + crash-recovery + Playwright E2E spec
- Reference `mc-hello-world-agent` image (Node 22 alpine, 249 MB) exercising the full pipeline
- 6 operator-facing docs under `docs/runtime/` + INDEX + README surfacing + `scripts/verify-runtime-docs.mjs` drift-detection harness (10 checks, 37 vitest tests) — Phase 18.1

### What Worked
- **Scoping Phase 11 as pure substrate** (migrations + registry + auth, no runtime code) made every subsequent phase trivially composable; zero rollbacks needed across 9 phases.
- **Bundling the runner daemon + container + worktree + reference image in Phase 14** avoided the "daemon without a workspace" and "workspace without a container" half-complete failure modes.
- **Dual-write checkpoints** (DB + JSONL) — the DB powers UI, the JSONL powers crash recovery; neither duplicated the other's job.
- **Submit → review two-hop lifecycle** (locked in Phase 17-01 RTEST-02) decoupled the agent's "done" claim from the reviewer's approval, preserving the existing Aegis loop without grafting on another state machine.
- **Splitting Phase 18 (tech-debt closure) from Phase 17 (integration testing)** kept the integration phase shippable and let closure happen in a dedicated <1-day pass.
- **Phase 18.1 as an inserted urgent phase** for operator docs — kept doc work from derailing Phase 18 tech-debt but still delivered the manual before `/gsd:complete-milestone`.
- **Tool-agnostic agent contract** — documenting the contract in terms of HTTP endpoints + filesystem layout + exit codes (not "how Claude Code runs") kept the runtime reusable for any future agent.

### What Was Inefficient
- **Design-era spec drift** — the Phase 14 plans and the `2026-04-18-recipe-agent-system-design.md` spec said `submit → done` but the shipped code did `submit → review`. Seven Phase 14 markdown files had to be retroactively corrected in Phase 18-03. Root cause: the design spec was authored before Phase 17-01 locked the reviewer flow; none of the intermediate phases flagged the contradiction.
- **Phase 13 VERIFICATION.md was never written** during Phase 13 execution — had to be backfilled in Phase 18-01 after the milestone audit caught the gap.
- **RecipeBadge shipped without `data-testid`** — Phase 17-06 Playwright spec used a brittle text regex fallback (`text=/hello.world/i`) until Phase 18-02 added the testid. Cost ≈1 extra plan's worth of cleanup.
- **`indexed_error` → `error` column rename** drifted into Plan 17-02 frontmatter — documented-only drift, no functional issue, but caught late.
- **Plan 18.1-07's `files_modified` declared 3 files** but the harness needed a 4th (`vitest.docs.config.mjs`) because vitest 2.1 has no `--include` CLI flag. Deviation was documented but a correct plan would have accounted for it.

### Patterns Established
- **Drift-guard greps live in plan `<verify>` blocks** — negative greps (`! grep -q "submit → done"`) catch regressions at execute-phase time, not at audit time.
- **"Harness is authority" directive** — when a drift-detection harness surfaces a gap, fix the drift, don't loosen the assertion. Plan 18.1-07 followed this and fixed 3 real drifts inline.
- **Doc bundle co-planning** — runner-daemon + admin-config were co-planned in Phase 18.1-02 because ~80% of admin config IS runner config. Splitting would have risked contradictory statements.
- **Source-of-truth citations** — every concrete doc claim cites a file:line range. Makes audits grep-able and prevents "the doc says X but the code says Y" drift.
- **Dedicated tech-debt phase (N) + dedicated doc phase (N.1)** after main milestone phases — keeps the main phases focused on behavior and lets closure work batch without derailing flow.

### Key Lessons
1. **Lock lifecycle semantics in an integration phase, not a design phase.** The `submit → review` two-hop was locked in Phase 17-01 RTEST-02 after integration testing; the earlier spec was wrong. Future milestones should treat integration-phase decisions as authoritative and audit earlier phases for drift before declaring victory.
2. **Write VERIFICATION.md as you execute the phase, not retroactively.** Phase 13's missing VERIFICATION.md cost a backfill pass in Phase 18-01. `gsd-executor` should gate SUMMARY.md on VERIFICATION.md existence for phase-level verifications.
3. **`data-testid` attributes are cheap; Playwright locator brittleness is expensive.** Add testids during Phase 16 (UI), not Phase 18 (cleanup). Future UI phases should include testid-naming as a must_have.
4. **Every documented public surface needs a drift harness.** The 10 checks in `scripts/verify-runtime-docs.mjs` will pay for themselves the moment v1.3 lands and someone renames a config key. Future milestones should include drift-harness scope as a default.
5. **Inserting urgent work as X.1 decimal phases works.** Phase 18.1 inserted cleanly between Phase 18 and milestone close. Keeps the numbering stable and the scope focused.
6. **Make the agent contract tool-agnostic from day one.** Avoided coupling the runtime to Claude-Code-specific assumptions; the contract is pure HTTP + filesystem + exit codes. Any agent image works.

### Cost Observations
- Wave-based parallel execution in Phase 18.1: 4 executors in Wave 1 + 1 + 1 + 1 = 7 total executor spawns for 7 plans. Total elapsed time ~35 min (including verify + audit).
- Sessions: primarily Opus 4.7 for the orchestrator; executors mostly inherited (sonnet-class for most plans). No explicit model-mix tracking was enabled for v1.2.
- Notable: the drift harness (Plan 18.1-07) caught 3 real doc-drift hits on its first run against the completed Wave 1/2 output — the harness immediately paid back its own development cost.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Key Change |
|-----------|--------|------------|
| v1.0 | 8 | Established GSD workflow — discuss → plan → execute → verify → done |
| v1.1 | 2 | Native GSD lifecycle tracking inside MC itself; recursive use of the tool on its own codebase |
| v1.2 | 9 | Wave-based parallel plan execution; dedicated tech-debt closure phase; inserted decimal phase for urgent docs; source-of-truth citation pattern in plans |

### Cumulative Quality

| Milestone | Tests | Notable |
|-----------|-------|---------|
| v1.0 | Baseline Vitest + Playwright | First milestone; no drift harness |
| v1.1 | Added GSD-specific integration tests | First use of MC against its own lifecycle |
| v1.2 | Added drift-detection harness pattern | First milestone with grep-based anti-drift invariants in plans |

### Top Lessons (Verified Across Milestones)

1. **Keep substrate phases pure** — v1.0 Phase 1 (Foundation) and v1.2 Phase 11 (Runtime Foundation) both shipped as pure additive migrations; both enabled the downstream phases to ship cleanly. Establish the pattern: the first phase of a milestone is allowed to be "just scaffolding."
2. **Dedicated closure phases work.** v1.0 Phase 7 (Post-Audit Gap Closure) and v1.2 Phase 18 (Tech-Debt Cleanup) both proved it's better to batch small cleanup items into a dedicated phase than to defer them indefinitely.
3. **Document contracts where they are implemented, not where they are designed.** v1.2's biggest drift cost came from letting a Phase 14-era design doc diverge from Phase 17-era shipped code. Move authoritative contract language to operator docs close to ship.
