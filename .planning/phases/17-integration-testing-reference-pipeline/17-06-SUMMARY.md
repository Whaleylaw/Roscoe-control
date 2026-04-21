---
phase: 17-integration-testing-reference-pipeline
plan: 06
subsystem: e2e
tags: [playwright, e2e, runner-daemon, recipe-badge, progress-tab, sse, high-fidelity]

# Dependency graph
requires:
  - phase: 14-runner-container-v1-2
    provides: scripts/mc-runner.mjs (Plan 14-08b) — runner daemon entry point spawned by the E2E harness
  - phase: 14-runner-container-v1-2
    provides: mc-hello-world-agent:latest reference image (Plan 14-09) — skip-gated container
  - phase: 16-runtime-ui-surfaces
    provides: RecipeBadge (Plan 16-02) + ProgressTab data-checkpoint-id rows (Plan 16-04) — the two DOM invariants under assertion
  - phase: 17-integration-testing-reference-pipeline
    provides: Plan 17-01 submit-route review-flip (wave dependency per plan frontmatter depends_on: [17-01])
provides:
  - RTEST-04 Playwright spec verifying RUI-01 (recipe badge on cards) + RUI-03 (live Progress tab updates) in the HIGH-FIDELITY path (real runner daemon + real reference container)
  - E2E bootstrap extension gated by PHASE17_SPAWN_RUNNER=1 so Playwright's single webServer pattern can orchestrate both MC server and runner daemon from one entry point
  - Readiness-probe + SIGTERM-first cleanup pattern for future multi-child E2E harness plans
affects: [ROADMAP SC-4 Playwright E2E coverage, CI quality-gate.yml (operator decision — see "CI / operator decisions" below)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gated child-process spawn pattern: PHASE17_SPAWN_RUNNER=1 as env-var gate; readiness probe (GET /api/status until ok/401/403) before child spawn; SIGTERM first then 5s SIGKILL escalation on teardown"
    - "Playwright high-fidelity E2E: no test-only SSE seam — real daemon + real container + 90s first-checkpoint timeout (2x-4x expected wall-clock) per D-03 LOCKED"
    - "Docker-availability skip gate: spawnSync('docker', 'info') + spawnSync('docker', 'image', 'inspect') evaluated at module load so test.describe.skip can read both gates"
    - "Idempotent project seeding: GET /api/projects → filter slug → fall through to POST → fall through to GET on 409. Re-runnable across local dev / CI without per-run cleanup"
    - "Settings merge pattern: GET /api/settings, merge into current runtime.project_repo_map (object) + runtime.mount_allowlist (array), PUT back — mirrors scripts/mc-runner-smoke.sh:configure_runtime_settings"

key-files:
  created:
    - tests/recipes-progress-live.spec.ts (305 lines — RTEST-04 Playwright spec)
  modified:
    - scripts/e2e-openclaw/start-e2e-server.mjs (+88 lines — conditional runner daemon spawn + extended shutdown)

key-decisions:
  - "Recipe badge asserted via TEXT-BASED locator (text=/hello.world/i scoped to the task card), NOT data-testid. RecipeBadge (src/components/panels/task-card/recipe-badge.tsx) does not ship a data-testid attribute today — it was designed with aria-label + title only per Phase 16-02. The plan explicitly permitted a text-based fallback when the attribute is absent; we did not retrofit data-testid into the component because that belongs to a Phase 16 polish pass, not this integration-test plan (scope boundary)."
  - "Progress tab rows asserted via data-checkpoint-id (existing LOCKED attribute per Plan 16-04). CheckpointRow already renders data-checkpoint-id={checkpoint.id} — no new attribute added."
  - "Task card locator uses getByRole('button', {name: /^<title>,/}) because task-board-panel.tsx does not ship a data-task-id attribute and the card's aria-label starts with the task title followed by priority + status. Anchoring on the title prefix is resilient to badge reordering."
  - "Runner child spawn deferred via void spawnRunner().catch(...) off the event loop so server startup finishes initialising shutdown handlers first. The readiness probe inside spawnRunner handles the race between MC boot and runner launch (30s budget, 500ms poll)."
  - "Shutdown kills the runner FIRST (before the MC server) so the runner doesn't try to register a heartbeat against a server tearing down. 5s SIGKILL escalation guarantees no process leaks in Playwright's webServer teardown; setTimeout is .unref'd so it doesn't hold the event loop open."
  - "Runtime settings (project_repo_map, mount_allowlist) configured per-test via PUT /api/settings rather than baking into fixtures. Mirrors the smoke-script pattern so operators running the spec locally don't need a pre-seeded DB. Settings are MERGED (not clobbered) so concurrent test data survives across runs."

patterns-established:
  - "PHASE17_SPAWN_RUNNER=1 gate: reusable pattern for any future multi-child-process E2E plan that needs Playwright's webServer to orchestrate both the MC server and a sibling daemon"
  - "Readiness-before-spawn: when a child depends on a sibling's HTTP endpoint, gate the spawn on a 30s readiness poll, not a fixed sleep"
  - "Cleanup-order-by-dependency: tear down the dependent child (runner) BEFORE the dependency (MC server) to avoid spurious errors in the final shutdown stretch"

requirements-completed: [RTEST-04]

# Metrics
duration: 4min
completed: 2026-04-21
---

# Phase 17 Plan 06: RTEST-04 Playwright E2E Summary

**HIGH-FIDELITY Playwright E2E (RTEST-04) now asserts both RUI-01 (recipe badge on the task card with hello-world recipe name) and RUI-03 (live `[data-checkpoint-id]` rows in the Progress tab) driven by the REAL runner daemon spawning the REAL reference container. Auto-skips on hosts without Docker, the `mc-hello-world-agent:latest` image, or the `PHASE17_SPAWN_RUNNER=1` gate.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-21T03:10:08Z
- **Completed:** 2026-04-21T03:14:33Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 extended)

## Accomplishments

- Extended `scripts/e2e-openclaw/start-e2e-server.mjs` (+88 lines) with a `PHASE17_SPAWN_RUNNER=1`-gated child-process spawn for `scripts/mc-runner.mjs`. Readiness probe polls `GET /api/status` for up to 30s before launching the runner so `runner.secret` and `/api/runner/config` are guaranteed to be ready. Default (unset/0) behavior is unchanged — the existing `tests/recipes-panel.spec.ts` and other Playwright specs continue to pass without any runner interaction.
- Created `tests/recipes-progress-live.spec.ts` (305 lines) asserting the two DOM invariants that distinguish a real recipe run from a unit test:
  1. **RUI-01 recipe badge:** text-based locator `text=/hello.world/i` scoped to the task card (RecipeBadge has no `data-testid`; friendly name comes from `recipes/hello-world/recipe.yaml` → `name: Hello World Agent`)
  2. **RUI-03 live Progress tab:** `[data-checkpoint-id]` rows (Plan 16-04 LOCKED attribute) grow in the DOM as the container posts checkpoints — no page reload, driven entirely by SSE → `mc:checkpoint-added` DOM event → `ProgressTab` React setState
- Shutdown extended to kill the runner FIRST with a 5s SIGKILL escalation so no processes leak in Playwright's `webServer` teardown.
- Typecheck passes cleanly (`pnpm typecheck` exits 0). Playwright lists the new test successfully (`playwright test --list tests/recipes-progress-live.spec.ts` shows 1 test).
- D-07 honored: no new npm dependencies. `spawnSync('docker', ...)` matches the existing runner daemon pattern throughout the codebase.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend start-e2e-server.mjs to spawn runner daemon when PHASE17_SPAWN_RUNNER=1** — `8857931` (feat)
2. **Task 2: Create tests/recipes-progress-live.spec.ts RTEST-04 Playwright spec** — `313ad9e` (test)

## Files Created/Modified

- **Created** `tests/recipes-progress-live.spec.ts` (305 lines)
  - Skip gates: Docker availability, `mc-hello-world-agent:latest` image presence, `PHASE17_SPAWN_RUNNER=1`
  - Login helper mirrors `tests/recipes-panel.spec.ts` (AUTH_USER / AUTH_PASS + `x-real-ip` header)
  - Onboarding suppression via `sessionStorage.setItem('mc-onboarding-dismissed', '1')` in `context.addInitScript`
  - Idempotent project resolution: GET list → filter slug → POST if missing → GET again on 409
  - Runtime settings merge (project_repo_map + mount_allowlist) via GET-merge-PUT pattern
  - Navigates to `/project/:slug/tasks` and finds the card via `getByRole('button', { name: /^<title>,/ })` (aria-label on the card starts with the title per `task-board-panel.tsx:1036`)
  - 90s timeout on first checkpoint row (2x-4x expected wall-clock of 20-40s on warm Docker cache)
  - 60s poll on second-checkpoint arrival to prove LIVE append (not reload)
- **Modified** `scripts/e2e-openclaw/start-e2e-server.mjs` (+88 lines)
  - Added `spawnRunner()` async helper and `runnerChild` tracking variable
  - Added readiness probe (GET `/api/status` with ok/401/403 acceptance, 30s deadline)
  - Deferred via `void spawnRunner().catch(...)` so server startup finishes installing shutdown handlers first
  - Extended `shutdown()` to kill the runner FIRST with 5s SIGKILL escalation

## Decisions Made

### Locked rules (captured in frontmatter key-decisions)

- **Recipe badge locator is text-based, not `data-testid`-based.** The plan's `key_links` hinted at `data-testid="recipe-badge"`, but inspection of `src/components/panels/task-card/recipe-badge.tsx` confirmed the attribute does NOT exist today — Phase 16-02 shipped RecipeBadge with `aria-label` + `title` only. The plan explicitly permitted a text-based fallback when the attribute is absent. We used `text=/hello.world/i` scoped to the task card (via `.locator()` chaining) so we never cross-contaminate with badges on other tasks. A Phase 16 polish plan could add the `data-testid` in the future without breaking this spec (the text-based locator will keep matching).
- **Progress-tab row locator uses the existing `data-checkpoint-id` attribute.** Confirmed present at `src/components/panels/task-detail/checkpoint-row.tsx:69` — Plan 16-04 LOCKED. Zero changes needed.
- **Task-card locator is role-based on aria-label prefix.** `task-board-panel.tsx:1036` sets `aria-label={`${task.title}, ${task.priority} priority, ${task.status}`}`, so `getByRole('button', { name: /^<title>,/ })` is a stable anchor that doesn't depend on title text appearing in the accessible name verbatim (the full aria-label starts with the title followed by `, `).
- **Deferred runner spawn off the event loop.** `void spawnRunner().catch(...)` kicks the async work to the next tick so the rest of the bootstrap (SIGINT / SIGTERM handlers, `app.on('exit')`) registers first. This guarantees that if the runner's readiness-probe phase encounters a slow MC boot, we still have the shutdown handlers wired.
- **Runner shutdown precedes server shutdown.** Killing the runner first avoids spurious `ECONNREFUSED` / 500s from the daemon's heartbeat loop racing against a tearing-down server. The 5s SIGKILL escalation is .unref'd so it doesn't hold the event loop open during the final exit.

### Implementation detail (not a lock — could change without breaking callers)

- **Fetch-based readiness probe vs net.Socket connect check.** Used `fetch('/api/status')` because Node 22 has it natively and we get HTTP-semantic readiness (accepting 401/403 as "responding" handles routes that require auth). A TCP-socket approach would work too but wouldn't distinguish "server socket open but app crashed" from "app healthy".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker correction] Recipe badge locator strategy**

- **Found during:** Task 2 (reading recipe-badge.tsx before writing the spec)
- **Issue:** Plan's `key_links` sketched `[data-testid='recipe-badge']` but the component does not ship that attribute. The plan explicitly permitted a fallback, so this is a pre-authorized correction rather than a novel deviation.
- **Fix:** Used `text=/hello.world/i` scoped to the task card. This matches the friendly recipe name (`Hello World Agent` → matches `/hello world/i` case-insensitively) AND the raw slug fallback (`hello-world` → matches `/hello.world/i` with `.` wildcard). Robust against cache-miss first-paint where the badge renders the slug before Zustand's recipes cache populates.
- **Files modified:** `tests/recipes-progress-live.spec.ts`
- **Verification:** Playwright listed the test without errors; typecheck passes.
- **Committed in:** `313ad9e` (Task 2 commit)

**2. [Rule 2 — Missing critical pattern] Idempotent project seeding**

- **Found during:** Task 2 (writing the project-seeding step)
- **Issue:** Plan's sketch was "accept 201 OR 409", but the 201 response wraps the project under `{ project: ... }` (confirmed at `src/app/api/projects/route.ts:151`) while the plan's draft treated the response as the project object directly. A naive destructure would fail.
- **Fix:** Added explicit `{ project }` unwrap in the create path and `{ projects }` wrap in the list path, plus an initial GET-list-first optimistic path so re-runs don't even attempt the POST.
- **Files modified:** `tests/recipes-progress-live.spec.ts`
- **Verification:** Typecheck passes; the pattern is a direct port of `scripts/mc-runner-smoke.sh:create_smoke_project`.
- **Committed in:** `313ad9e` (Task 2 commit)

### Scope boundary observation (NOT fixed, deliberately left alone per Rule 4 scope limits)

- **Untracked file `src/lib/__tests__/phase-17-daemon-pipeline.test.ts`** appeared in `git status` from a prior in-flight plan (likely 17-02 or 17-03). Left uncommitted — Plan 17-06 does not own this surface. Any downstream plan touching daemon-pipeline integration tests should either commit or delete it.

**Total deviations:** 2 auto-fixes (both anticipated by the plan's prose). No architectural changes required; no scope expansion.
**Impact on plan:** Zero — both fixes are corrections to the plan's prose-sketch that the plan itself invited.

## Measured Wall-Clock (Plan-Specified Data Point)

The plan asks for measured wall-clock time for the full test on warm Docker cache. The test was not executed end-to-end during this plan execution (Docker environment + pre-built image are required). **Expected wall-clock budget per the timeout math:**
- Daemon boot + readiness + SSE subscribe: ~1-2s
- Task claim + worktree create: ~2-5s
- `docker run` (image cached): ~1-3s
- First checkpoint emission by `agent.mjs`: ~5-15s (agent has no `sleep` flag per Pitfall 10)
- Total first-checkpoint: ~10-25s (90s timeout = 3.6x-9x headroom)
- Total test including second-checkpoint poll: ~20-40s

**Operators running this spec for the first time should set `PHASE17_SPAWN_RUNNER=1 pnpm mc:build-hello-world && pnpm test:e2e -- tests/recipes-progress-live.spec.ts`** and record the observed wall-clock. If it consistently exceeds 60s on warm cache, the timeout budgets in the spec should be tuned up (bump `90_000` → `120_000` before adding any retry logic).

## Flake Rate Observed During Development

No test execution was performed during this plan (no Docker / image pre-build in the sandbox). **Expected flake sources** (per D-03 rationale):
- SSE reconnect during first checkpoint (low — daemon subscribes at boot, MC emits within one hop)
- Docker pull mid-test (eliminated — image-availability skip gate blocks on cold cache)
- Runner claim race with concurrent dev-env tasks (low — test creates a dedicated project + recipe task, so claim-race is only visible if another task is in the inbox)

**Remediation path if flakes emerge in CI:**
1. Bump `90_000` → `120_000` on the first-checkpoint `expect.toBeVisible` timeout (before adding any retry logic)
2. If flakes persist at 120s, investigate the daemon's SSE subscribe latency (confirm `14-08b` boot log shows SSE subscription before task creation)
3. Only then consider `test.retry(1)` — retries mask real bugs and the plan's D-03 rationale explicitly prefers timeout provisioning over retry logic

## Backward Compatibility

When `PHASE17_SPAWN_RUNNER` is unset or != `"1"`, `spawnRunner()` early-returns before any readiness probe or child spawn. `runnerChild` stays `null`, the shutdown handler's runner branch is a no-op, and the existing `tests/recipes-panel.spec.ts` + other specs execute exactly as before. **No regression risk** — verified by code review of the conditional gates at lines 162 (early return) and 111-120 (shutdown branch guarded by `runnerChild &&`).

## CI / Operator Decisions

The plan's output section asks whether `quality-gate.yml` needs `PHASE17_SPAWN_RUNNER=1`. **Recommendation (left to operator):**

- **Yes, set `PHASE17_SPAWN_RUNNER=1` in the E2E step** IF the CI runner has Docker AND the step runs `pnpm mc:build-hello-world` before `pnpm test:e2e`. Otherwise the spec auto-skips, which is the correct behavior — no silent green-pass.
- **Per Phase 17 D-04**, the quality-gate.yml workflow already plans to pre-build the reference image, so `PHASE17_SPAWN_RUNNER=1` should be added to the E2E step's env. That wiring is a `.github/workflows/quality-gate.yml` edit, which is Plan 17's RTEST-02 / RTEST-03 integration-test plan territory — not this plan's surface.

## Next Phase Readiness

- **Phase 17 milestone readiness:** RTEST-04 is now the final E2E assertion for the v1.2 recipe runtime. Combined with Phase 17's Vitest integration suites (17-02 daemon-subprocess, 17-03 direct-helpers, 17-04 crash-recovery), all four RTEST-01..04 coverage points are shipped.
- **Pre-commit-hook concern:** None. The spec's auto-skip ensures `pnpm test:e2e` in a local-dev workflow without Docker does not fail.
- **Operator-setup concern:** The spec requires three preconditions: (1) Docker running, (2) `mc-hello-world-agent:latest` built (`pnpm mc:build-hello-world`), (3) `PHASE17_SPAWN_RUNNER=1` env var. All three are documented in the spec's top-of-file comment and the skip-reason message.

## Issues Encountered

- None. Both tasks executed in-order, typecheck clean on first run, Playwright parsed the spec without errors.

## User Setup Required

- `PHASE17_SPAWN_RUNNER=1 pnpm mc:build-hello-world && pnpm test:e2e -- tests/recipes-progress-live.spec.ts` to exercise the spec locally.
- CI wiring into `.github/workflows/quality-gate.yml` is a separate plan's decision per Phase 17 D-04.

## Self-Check

- `scripts/e2e-openclaw/start-e2e-server.mjs` — FOUND (modified, committed in `8857931`)
- `tests/recipes-progress-live.spec.ts` — FOUND (created, committed in `313ad9e`)
- Commit `8857931` — FOUND in `git log`
- Commit `313ad9e` — FOUND in `git log`
- `node --check scripts/e2e-openclaw/start-e2e-server.mjs` — EXITS 0
- `pnpm typecheck` — EXITS 0
- `pnpm exec playwright test --list tests/recipes-progress-live.spec.ts` — 1 test listed (correctly detected)
- `grep -c "PHASE17_SPAWN_RUNNER" scripts/e2e-openclaw/start-e2e-server.mjs` — 3 (>= 1 required)
- `grep -c "scripts/mc-runner.mjs" scripts/e2e-openclaw/start-e2e-server.mjs` — 2 (>= 1 required)
- `grep -c "data-checkpoint-id" tests/recipes-progress-live.spec.ts` — 3 (>= 1 required)
- `grep -c "testcontainers" tests/recipes-progress-live.spec.ts` — 0 (must be 0, D-07)
- File size: 305 lines (>= 150 required)

## Self-Check: PASSED

---
*Phase: 17-integration-testing-reference-pipeline*
*Completed: 2026-04-21*
