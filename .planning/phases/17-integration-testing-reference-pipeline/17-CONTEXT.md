# Phase 17: Integration Testing & Reference Pipeline — Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Source:** Inline answers to researcher's 4 open questions (no discuss-phase)

<domain>
## Phase Boundary

Phase 17 delivers end-to-end confidence for the v1.2 recipe runtime that shipped
across phases 11–16. It adds integration and E2E coverage on top of primitives
that already exist and have unit-test coverage. Phase 17 is **composition, not
invention**, with one scope expansion into production code (submit-route
`review` gate — see Decisions below).

**In scope:**
- Unit-test gap-fill on four modules (RTEST-01 sharp edges)
- A full-pipeline integration test driving the `mc-hello-world-agent` reference
  image end-to-end (RTEST-02)
- A crash-recovery integration test proving `.mc/` persistence (RTEST-03)
- A Playwright E2E verifying recipe badge + live Progress tab (RTEST-04)
- Extending the submit route to route tasks through `status: 'review'` + Aegis
  approval before `done` (deliberate scope expansion — see Decision D-01)
- Pre-building the `mc-hello-world-agent` image in `quality-gate.yml` so
  Docker-dependent tests run per-PR

**Out of scope:**
- New UI surfaces
- New runner features
- New recipe features
- Performance/load testing

</domain>

<decisions>
## Implementation Decisions

### D-01 — Submit-route review gate (SCOPE EXPANSION)
The shipped `src/app/api/runner/tasks/[task_id]/submit/route.ts` flips
`in_progress → done` directly. Phase 17 **extends** submit to route through
`status: 'review'` with an Aegis-approval hop before reaching `done`.

- RTEST-02 asserts the full `in_progress → review → done` flow
- This adds production code to Phase 17 (not test-only)
- Impacts: submit route, possibly Aegis auto-approval logic, status-transition
  validation, any downstream consumer of `status === 'review'`
- Risk: a dedicated "Submit through review" plan is required **before** the
  RTEST-02 integration test plan in wave order
- If the implementation surface grows beyond ~1 day of work, planner should
  split the review-gate work into its own plan and flag it to the operator

### D-02 — Integration driver strategy
RTEST-02 ships **both**:
1. One integration test that spawns `scripts/mc-runner.mjs` as a subprocess
   (production-fidelity — full daemon loop + Docker)
2. One integration test that direct-invokes `runner-claim.ts` +
   `runner-docker.ts` helpers (faster iteration + easier failure narrowing)

Both tests exercise the same reference-image pipeline. Direct-helper test can
live alongside unit tests; daemon subprocess test gets its own plan due to
startup-cost + flake-surface.

### D-03 — Playwright SSE seam (HIGH-FIDELITY)
RTEST-04 spawns the **real runner daemon** in the E2E harness — not a
test-only gated endpoint. Playwright boots:
1. Mission Control dev/prod server
2. Runner daemon (`scripts/mc-runner.mjs`)
3. Reference container (via the daemon claiming a seeded recipe task)

Assertions: recipe badge renders on cards, Progress tab appends checkpoint
rows live via `task.checkpoint_added` SSE.

- Highest fidelity; catches real integration regressions
- Highest flake surface — planner must include retry/timeout discipline and
  deterministic readiness probes (container health, daemon claim, first
  checkpoint arrival)
- Daemon + container startup dominates E2E wall-clock time; plan accordingly
  in `playwright.config.ts` timeouts and shard configuration

### D-04 — CI Docker strategy
Phase 17 modifies `.github/workflows/quality-gate.yml` to:
1. Pre-build the `mc-hello-world-agent` image (via existing
   `pnpm mc:build-hello-world` script)
2. Run Docker-dependent integration + E2E tests as part of `pnpm test:all`
   (or an equivalent composite target)

Acceptable CI-time cost: +2–3 min per run. Planner must verify ubuntu-latest
has Docker and that the build step caches layers to keep re-runs cheap.

### D-05 — Submit-review gate plan ordering (derived from D-01)
If the submit-review gate is carved into its own plan, it sits in Wave 1
before the RTEST-02 integration-test plans in Wave 2. The crash-recovery
(RTEST-03) and Playwright (RTEST-04) plans can run in Wave 2 or 3 alongside
RTEST-02 (they touch different files).

### D-06 — Boundary-mock pattern
All new integration tests (RTEST-02, RTEST-03) follow the Phase 15-07 LOCKED
boundary-mock pattern as precedent:
- `src/app/api/tasks/[id]/checkpoints/__tests__/integration.test.ts`
- `src/lib/__tests__/phase-15-blocker-flow-integration.test.ts`

Mock **only** event-bus / rate-limit / runner-secret / security-events / @lib/db
seams; let everything else run real. No mocking of the runner, recipe indexer,
checkpoint validation, or mount-allowlist resolver.

### D-07 — No new npm dependencies
Integration tests use `child_process.spawnSync('docker', …)` — matches the
existing runner daemon pattern. **No** `testcontainers` or equivalent.

### Claude's Discretion
- File layout for new integration tests (`src/lib/__tests__/` vs
  `tests/integration/` vs phase-tagged paths) — planner chooses based on
  existing precedent
- Specific unit-test gaps within RTEST-01 — planner audits existing suites
  and targets missing cases
- Whether crash-recovery test (RTEST-03) ships as a separate plan or merges
  with RTEST-02's daemon-subprocess test
- Retry/timeout tuning values for Playwright E2E in RTEST-04
- Whether CI quality-gate.yml changes become their own plan or merge with
  the RTEST-02 daemon-subprocess plan

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing integration-test precedents (Phase 15-07 LOCKED)
- `src/app/api/tasks/[id]/checkpoints/__tests__/integration.test.ts` — boundary-mock pattern
- `src/lib/__tests__/phase-15-scheduler-integration.test.ts` — scheduler orchestration precedent
- `src/lib/__tests__/phase-15-blocker-flow-integration.test.ts` — 5-phase end-to-end precedent

### Reference image + runner primitives
- `docker/hello-world-agent/` — reference image source
- `docker/hello-world-agent/agent.mjs` — reference agent (no sleep flag — Pitfall 10)
- `recipes/hello-world/` — recipe that pins the reference image
- `scripts/mc-runner-smoke.sh` — smoke harness (lines 542-544 reserve Phase 17 subcommands `preserve-on-stop` and `preserve-across-crash`)
- `scripts/mc-runner.mjs` — runner daemon entry point
- `src/lib/runner-claim.ts` — direct-invoke helper for D-02 direct-helper test
- `src/lib/runner-docker.ts` — direct-invoke helper for D-02 direct-helper test
- `src/app/api/runner/tasks/[task_id]/submit/route.ts` — submit route (D-01 extends this)

### CI
- `.github/workflows/quality-gate.yml` — existing CI gate (D-04 extends this)
- `package.json` scripts — `test:all`, `test`, `test:e2e`, `mc:build-hello-world`

### Research + roadmap
- `.planning/phases/17-integration-testing-reference-pipeline/17-RESEARCH.md` — 574-line research output
- `.planning/ROADMAP.md` (Phase 17 section) — goal, SC, RTEST-01..04 IDs
- `.planning/REQUIREMENTS.md` — RTEST-01..04 definitions

</canonical_refs>

<specifics>
## Specific Ideas

- **RTEST-01 unit-test targets:** recipe-indexer (malformed YAML, unknown-model rejection), mount-allowlist (symlink escape via fs.realpath parent-walk), runner-tokens (mint/verify/revoke + cross-task rejection + expiry — **note pre-existing deferred drift at `src/lib/__tests__/runner-tokens.test.ts:194`**), checkpoint validation (blocked-without-reason rejection).
- **RTEST-02 end-to-end script:** seed recipe task → runner claims → container starts → emits ≥1 checkpoint → submits → enters review → Aegis approves → reaches done. Assert DB state + `.mc/` file state at each hop.
- **RTEST-03 crash injection:** send SIGKILL to the container pid mid-task (after first checkpoint but before submit). Assert worktree and `.mc/progress.md` + `.mc/checkpoints.jsonl` are preserved on host. Retry the same task ID. Assert retry attempt **reads** the prior `.mc/` state (not regenerates) and completes without redoing prior checkpoints.
- **RTEST-04 Playwright selectors:** `[data-testid="recipe-badge"]` for card, `[data-checkpoint-id]` for timeline rows (per Plan 16-04 SUMMARY), `mc:checkpoint-added` DOM event or SSE network-tap for append detection.
- **Pre-existing flakes to acknowledge, not fix:**
  - `src/lib/__tests__/recipe-watcher-events.test.ts` (macOS fsevents) — documented in `.planning/phases/16-runtime-ui-surfaces/deferred-items.md`
  - `src/lib/__tests__/runner-tokens.test.ts:194` allowlist-length drift — deferred since 15-04
  - `progress-tab.test.tsx` fails only when run alongside `task-form` tests — documented in Phase 16 VERIFICATION.md

</specifics>

<deferred>
## Deferred Ideas

- Performance/load testing of the runtime pipeline
- Fuzz testing of recipe YAML parser
- Concurrent-runner claim-race integration test (Phase 15-07 suggested as v1.3 follow-up)
- Multi-recipe parallel-execution integration test
- Visual regression testing of recipe badge / Progress tab (Percy, Chromatic, etc.)

</deferred>

---

*Phase: 17-integration-testing-reference-pipeline*
*Context gathered: 2026-04-21 via inline Q&A (4 researcher open questions answered)*
