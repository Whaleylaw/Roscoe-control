# Milestones

## v1.2 Recipe-Based Ephemeral Agent Runtime (Shipped: 2026-04-21)

**Phases completed:** 9 phases (11–18.1), 53 plans, ~202 commits
**Audit:** passed — 72/72 v1.2 REQ-IDs satisfied + 7/7 DOC-* pseudo-requirements (Phase 18.1); 47/47 integration connections wired; 5/5 E2E flows verified
**Timeline:** 2026-04-18 → 2026-04-21 (3 days elapsed)
**Git range:** `adebdcc` → `a11ba8b`
**Diff:** 297 files changed, +71,170 insertions, −335 deletions
**Tag:** `v1.2`

**Key accomplishments:**
- **Runtime foundation (Phase 11)** — SQLite migrations, model registry, and `runner`/`runner-token` auth principals as pure additive substrate
- **Recipe system (Phase 12)** — filesystem-authored `recipes/<slug>/` cards with chokidar indexer, admin resync, and recipe search/CRUD API
- **Task runtime context (Phase 13)** — `recipe_slug`, `workspace_source`, `read_only_mounts`, `extra_skills`, `model_override` + mount-allowlist enforcement
- **Runner daemon & containers (Phase 14)** — `scripts/mc-runner.mjs` daemon with docker run lifecycle, worktree seeding, and reference `mc-hello-world-agent` image
- **Checkpoints + scheduler integration (Phase 15)** — dual-write DB + JSONL checkpoints, blocked → awaiting_owner flow, scheduler hooks, runtime SSE events
- **Runtime UI surfaces (Phase 16)** — RecipeBadge, RunnerStatusBanner, Progress tab, RecipeCombobox + Advanced section, Recipes panel, 10-locale i18n
- **Integration testing + reference pipeline (Phase 17)** — unit gap-fill + direct-helper integration + daemon-subprocess integration + crash-recovery + Playwright E2E
- **Tech-debt cleanup (Phase 18)** — closed all 4 items from the initial v1.2 audit (Phase 13 VERIFICATION backfill, RecipeBadge data-testid, Phase 14 submit→review narrative, Plan 17-02 `indexed_error`→`error`)
- **Operator manual + drift harness (Phase 18.1)** — 6 operator-facing docs under `docs/runtime/` (recipes, runner-daemon, admin-config, agent-contract, task-board-surfaces, getting-started) + INDEX + README surfacing + `scripts/verify-runtime-docs.mjs` drift-detection harness (10 checks) + 37 vitest tests

**Archived:**
- `.planning/milestones/v1.2-ROADMAP.md` (full phase details)
- `.planning/milestones/v1.2-REQUIREMENTS.md` (all 72 REQ-IDs marked complete)
- `.planning/milestones/v1.2-MILESTONE-AUDIT.md` (passing audit report)

---
