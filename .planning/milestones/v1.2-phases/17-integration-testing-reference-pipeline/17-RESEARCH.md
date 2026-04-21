# Phase 17: Integration Testing & Reference Pipeline - Research

**Researched:** 2026-04-21
**Domain:** End-to-end test architecture for container-driven agent runtime (Vitest integration + Playwright E2E + crash-recovery)
**Confidence:** HIGH

## Summary

Phase 17 is a test-only phase. No production code ships — only unit, integration, and E2E tests that prove Phases 11–16 compose correctly. The four requirements (RTEST-01..04) split cleanly into four test surfaces:

1. **Sharp-edge unit tests** — targeted gaps against the four "security and correctness" modules (recipe indexer, mount allowlist, runner-tokens, checkpoints). Existing coverage is already dense; Phase 17 fills specific gaps.
2. **Reference-image pipeline integration test** — a Vitest test that drives the full `mc-hello-world-agent` image through claim → checkpoint → submit using a real Docker daemon.
3. **Crash-recovery integration test** — a Vitest test that kills a running container mid-task, asserts `.mc/` preservation, relaunches the runner, and verifies it resumes via `progress.md`/`checkpoints.jsonl` without redoing work.
4. **Playwright E2E** — extends the existing `tests/recipes-panel.spec.ts` pattern to assert recipe badge rendering on task cards and live Progress tab updates on checkpoint SSE.

**Primary recommendation:** Split Phase 17 into two test-framework lanes — Vitest (in-process API + in-process Docker via child_process or `testcontainers`) for RTEST-01..03 and Playwright (browser E2E against a running Next.js server) for RTEST-04. Reuse the Phase 15-07 integration-test harness pattern (boundary-mock only, real modules under test, in-memory SQLite, `vi.mock` the narrow seam of runner-secret/event-bus/rate-limit) for RTEST-02/03. For the Docker-spawning pieces, use `child_process.spawnSync('docker', …)` rather than pulling in the `testcontainers` dependency — the project already uses raw docker subprocess in `scripts/mc-runner.mjs` and `scripts/mc-runner-smoke.sh`, and the reference image is built locally (never registry-pulled), which removes the main reason to adopt testcontainers.

<user_constraints>
## User Constraints (from CONTEXT.md)

**No CONTEXT.md exists for this phase** — the `/gsd:discuss-phase` step was not run before research. The constraints below are derived from ROADMAP/REQUIREMENTS and existing project conventions (CLAUDE.md, prior-phase locks). The planner SHOULD confirm these with the operator before drafting plans, or run `/gsd:discuss-phase 17` first.

### Locked Decisions (from project conventions and prior-phase locks)

- **Stack:** Vitest 2.1 (unit + integration) and Playwright 1.51 (E2E). No alternative test runners.
- **Package manager:** pnpm only (per CLAUDE.md).
- **Database:** in-memory SQLite via `better-sqlite3` for Vitest tests; runs migrations via `runMigrations(db)`.
- **Test file locations:** unit tests under `src/lib/__tests__/` and `src/app/api/**/__tests__/`; Playwright specs under `tests/`.
- **Reference image:** `mc-hello-world-agent:latest` — already built by `pnpm mc:build-hello-world` (Phase 14-09), lives at `docker/hello-world-agent/`. Phase 17 does NOT build a new image; it exercises the existing one.
- **Docker subprocess pattern:** raw `child_process.spawn/spawnSync('docker', …)` — matches existing runner daemon at `scripts/mc-runner.mjs` and smoke harness at `scripts/mc-runner-smoke.sh`. No new testcontainers dependency unless the planner explicitly decides to adopt it in discussion.
- **Integration-test harness pattern:** boundary-mock-only, per Phase 15-07 LOCKED pattern — mock ONLY `event-bus`, `rate-limit`, `runner-secret`, `security-events`, `@/lib/db`; real production modules under test (see `src/app/api/tasks/[id]/checkpoints/__tests__/integration.test.ts` and `src/lib/__tests__/phase-15-blocker-flow-integration.test.ts` as precedents).
- **CI policy:** `pnpm test:all` currently runs in GitHub Actions `ubuntu-latest` — Docker engine IS available on Ubuntu runners but is not currently required by quality-gate.yml. Docker-dependent integration tests MUST either (a) gate themselves behind an env guard that skips on hosts without a Docker daemon, or (b) be added to `test:all` with the CI workflow updated to include a `docker info` preflight.
- **Commits:** Conventional Commits, no AI attribution (per CLAUDE.md).
- **i18n:** no new user-facing strings expected — Phase 17 is test-only.

### Claude's Discretion

- Whether to add a new npm dev-dependency (`testcontainers`) or stay with raw `docker` subprocess — trade-off analysis in § Architecture Patterns.
- Whether to put the Docker-dependent integration tests in a new `tests-docker/` dir with its own vitest include-glob, or inline them under `src/lib/__tests__/` with an env-gated `skipIf`. Recommendation: env-gated inline is simpler and mirrors Phase 15-07.
- How to deterministically trigger "container crash mid-task" — `docker kill --signal=SIGKILL` is the simplest; `docker stop --time=0` also works. Either should be stable. Plan SHOULD pick ONE and lock it.
- Whether to extend the `mc-hello-world-agent` image to optionally support a "sleep-then-exit" mode for the crash-recovery test, or to script the container's blocker via a second image/variant. Recommendation: reuse the existing image with a CMD override flag (no image rebuild). See § Open Questions.
- Whether to touch the Aegis → review path (the current submit route flips `in_progress → done` directly, bypassing the `review` status — see § Open Questions #1).

### Deferred Ideas (OUT OF SCOPE per ROADMAP)

- Performance/load tests on the runner (N containers in parallel).
- Testing against alternative container runtimes (podman, containerd).
- Test helpers for alternative reference agents beyond `mc-hello-world-agent`.
- Benchmarking/regression tracking for runner claim latency or container startup time.
- Multi-runner-daemon coordination tests (current codebase assumes single runner daemon).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RTEST-01 | Unit tests cover recipe indexer parsing, mount-allowlist resolution, runner-token mint/verify/revoke, and checkpoint validation | § "Existing Test Coverage Audit" enumerates 4 dense test files already shipped; plan should add specific gap-filling tests only (malformed YAML, symlink escape, cross-task token rejection, blocked-without-reason). See § Code Examples for the exact missing cases. |
| RTEST-02 | Integration test drives the full pipeline end-to-end: task created → runner claims → container emits checkpoints → submits → task done | § Architecture Patterns "In-Process Docker Integration Test" pattern; reuses `mc-hello-world-agent:latest` image via raw `docker run`. Submit currently flips `in_progress → done` directly (see Open Question #1 — the "enters review, Aegis approves" language in ROADMAP is aspirational). |
| RTEST-03 | Crash-recovery test — kill container mid-task, assert `.mc/` preserved, retry reads progress.md/checkpoints.jsonl, completes without redoing work | § Architecture Patterns "Crash-Recovery Test Pattern"; preserves worktree through a `docker kill` signal; relies on existing Plan 14-07 resume preamble + Plan 15-03 resume_marker seeding already shipped. |
| RTEST-04 | Playwright E2E verifies recipe badge renders on cards and Progress tab updates live on checkpoint event | § Code Examples "Playwright SSE Assertion Pattern" + existing `tests/recipes-panel.spec.ts` precedent. Needs to seed a recipe-tagged task and emit a checkpoint during the test. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 2.1.x | Unit + integration test runner | Already the project runner (`pnpm test`). Jsdom env; integrates with `@/` alias via `vite-tsconfig-paths`. |
| @playwright/test | 1.51.x | Browser E2E test runner | Already the project E2E runner (`pnpm test:e2e`). Boots Next.js server via `webServer` block in `playwright.config.ts`. |
| better-sqlite3 | 12.6.x | In-memory DB for integration tests | `new Database(':memory:')` + `runMigrations(db)` is the locked Phase 15-07 pattern. |
| next/server | 16.1.x | `NextRequest`/`NextResponse` for API route tests | Every integration test constructs a `NextRequest` and calls the exported `POST/GET` handler directly. |
| @testing-library/react | 16.1.x | React component unit tests | Already the locked React test library (see `progress-tab.test.tsx`). |
| zod | 4.3.x | Schema validation assertions | Already imported throughout; test-time use for verifying schemas parse/reject. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:child_process (stdlib) | — | `spawn`/`spawnSync` for `docker run/kill/ps` | **Recommended** for RTEST-02/03 — matches existing runner daemon pattern. No new npm dep. |
| node:fs, node:os, node:path (stdlib) | — | tmpdir workspace seeding | Every existing integration test uses `fs.mkdtempSync(path.join(os.tmpdir(), '...'))`. |
| node:net (stdlib) | — | Dynamic port allocation for the in-test server | Already used in `scripts/e2e-openclaw/start-e2e-server.mjs`. |
| NextIntlClientProvider + `messages/en.json` | (existing) | Component test intl wrapper | Pattern from `progress-tab.test.tsx:26-31`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `docker` subprocess | `testcontainers` (npm `testcontainers@11.14.0`) | `testcontainers` adds ~150 MB of dev deps, handles port mapping + cleanup + wait-for-ready automatically, but (a) has known Vitest parallelism pitfalls (tests tearing down each others' containers if global-setup misused), (b) is designed for registry-pulled images (the `mc-hello-world-agent` is a LOCAL-built image which `testcontainers` can handle via `GenericContainer('image-name')` but less idiomatically than for hub images), and (c) duplicates logic the runner daemon already implements in plain Node. **Recommendation: stick with raw `docker` subprocess, mirroring `scripts/mc-runner.mjs`.** |
| In-process spawning of the runner daemon (`scripts/mc-runner.mjs`) | Directly invoking lib modules (`runner-claim.ts`, `runner-docker.ts`) | Spawning the real daemon exercises the whole boot sequence and dispatch loop — closest to prod. But test teardown is harder (must reliably SIGTERM the child). Direct lib invocation is hermetic but skips the SSE subscriber + poll fallback. **Recommendation: direct lib invocation for the happy-path RTEST-02 (faster, fewer moving parts), plus ONE daemon-spawning smoke test that mirrors `scripts/mc-runner-smoke.sh` for RTEST-03 crash recovery (the daemon restart is the thing under test).** |
| Vitest + Docker for RTEST-04 UI update | pure Playwright mock-SSE via `page.route` | Playwright's `page.route` can intercept `/api/tasks/:id/checkpoints` GET but cannot easily inject SSE frames on `/api/events`. Alternative: seed the checkpoint via the REAL `POST /api/tasks/:id/checkpoints` handler with a runner-token (then the SSE broadcast fires naturally through the event bus). **Recommendation: real POST, real SSE — the existing `recipes-panel.spec.ts` pattern already hits real APIs.** |

**Installation:** No new dependencies required for the recommended path. Both `vitest` and `@playwright/test` are already in devDependencies.

## Architecture Patterns

### Recommended Test File Layout

```
src/
├── lib/__tests__/
│   ├── phase-17-pipeline-integration.test.ts    # RTEST-02 (new; docker-gated)
│   ├── phase-17-crash-recovery.test.ts          # RTEST-03 (new; docker-gated)
│   ├── recipe-indexer.test.ts                   # RTEST-01 (extend existing)
│   ├── task-runtime-validation.test.ts          # RTEST-01 (extend existing)
│   ├── runner-tokens.test.ts                    # RTEST-01 (extend existing)
│   └── task-checkpoints.test.ts                 # RTEST-01 (extend existing)
tests/
└── recipes-progress-live.spec.ts                # RTEST-04 (new; browser E2E)
scripts/
└── mc-runner-smoke.sh                           # EXTEND with `preserve-on-stop` + `preserve-across-crash` (stubbed at lines 542-544)
```

### Pattern 1: Boundary-Mock Integration Test (Phase 15-07 LOCKED)

**What:** Real production modules run; only the narrow auth/event-bus/rate-limit seam is mocked.
**When to use:** RTEST-02 happy-path and RTEST-03 crash-recovery.
**Example:**
```typescript
// Source: src/app/api/tasks/[id]/checkpoints/__tests__/integration.test.ts (LOCKED pattern)
import Database from 'better-sqlite3'
import { vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'

let testDb: Database.Database

vi.mock('@/lib/db', () => ({
  getDatabase: () => testDb,
  db_helpers: {
    logActivity: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    createNotification: vi.fn(),
  },
}))

vi.mock('@/lib/runner-secret', () => ({
  getRunnerSecret: () => 'known-runner-secret-test-value-abc-1234567890',
  ensureRunnerSecret: vi.fn(() => 'known-runner-secret-test-value-abc-1234567890'),
  RUNNER_SECRET_FILENAME: '.data/runner.secret',
}))

vi.mock('@/lib/security-events', () => ({ logSecurityEvent: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

// Real handlers imported AFTER mocks so module bindings point at mocks.
const { POST } = await import('@/app/api/tasks/[id]/checkpoints/route')
```

### Pattern 2: In-Process Docker Integration Test (RTEST-02)

**What:** Vitest test that runs the full claim → docker-run → checkpoint → submit pipeline against a live Docker daemon.
**When to use:** RTEST-02 reference-image pipeline test.
**Structure:**
1. **Preflight** (in `beforeAll`): probe `docker info` via `spawnSync('docker', ['info'])`. If exit code !== 0, call `it.skip` / `describe.skipIf` so the test is inert on hosts without Docker.
2. **Build fixture recipe + worktree:**
   - Write a fixture `recipe.yaml` + `SOUL.md` to a `mkdtemp` recipe root.
   - Configure `runtime.project_repo_map` + `runtime.mount_allowlist` via direct `getDatabase()` settings INSERTs (not PUT /api/settings — faster and avoids the whole admin-auth dance).
   - Initialize a throwaway git repo at the project-repo path (for `git worktree add`).
3. **Create the task:** `POST /api/tasks` with `recipe_slug: 'hello-world-test'` and `workspace_source: { project_id, base_ref: 'main' }`.
4. **Invoke claim directly:** call `POST /api/runner/claim/:task_id` handler with a synthetic runner-secret bearer — the handler returns the dispatch payload.
5. **Stage worktree + seed .mc/:** call `stageRecipe` + `createWorktree` + `seedMcDir` from `@/lib/runner-*` directly (these are pure-logic modules, per Phase 14-08a).
6. **docker run:** `spawnSync('docker', ['run', '--rm', '--name', `mc-task-${id}-a1`, … 'mc-hello-world-agent:latest'])`. The reference image completes in ~5 seconds and POSTs to submit.
7. **Assert:** task row status === 'done', `task_runner_attempts` row count === 1, `task_checkpoints` row count >= 1, JSONL line count === checkpoint row count, HELLO.md present in worktree HEAD commit.

**Key pitfall:** the reference image POSTs to `MC_API_URL/api/runner/tasks/:id/submit` using the runner-token. In a Vitest integration test there is NO listening HTTP server — so either:
- (a) **Spin up a throwaway `http.createServer()`** that delegates to the Next.js handlers in-process (complex; requires a path dispatcher), OR
- (b) **Skip the submit step inside the container** by overriding the entrypoint: `docker run --entrypoint /bin/sh mc-hello-world-agent:latest -c "node /app/agent.mjs || true; touch /workspace/.mc/agent-exited"` — then the test *asserts on the `.mc/` side-effects* rather than the `done` status, and flips the status to `done` synthetically via direct DB update. Less end-to-end but hermetic, OR
- (c) **Run `scripts/mc-runner.mjs` as a child process** against an already-running test server (closest to prod; matches `mc-runner-smoke.sh`). Planner should pick based on what "full pipeline" means in § Open Question #2.

**Strong recommendation:** option (c) — spawn both a real Next.js dev server on a random port AND the runner daemon, just like `mc-runner-smoke.sh` already does. Encode it as a Vitest test that wraps the smoke harness.

### Pattern 3: Crash-Recovery Test Pattern (RTEST-03)

**What:** Vitest test that deliberately SIGKILLs a running container, then asserts resume semantics.
**Flow:**
1. Start from the Pattern 2 setup, but override the entrypoint/CMD so the container sleeps for N seconds BEFORE the HELLO.md commit. A drop-in: `docker run ... --entrypoint /bin/sh mc-hello-world-agent:latest -c "node /app/agent.mjs --sleep-before-commit=30"`.
2. After `progress.md` + `checkpoints.jsonl` have been appended (poll the worktree for the first line to appear, ~1–2s), `spawnSync('docker', ['kill', '-s', 'SIGKILL', containerName])`.
3. Assert: worktree still exists at `.data/runner/worktrees/task-<id>/`, `.mc/progress.md` non-empty, `.mc/checkpoints.jsonl` non-empty, `task.status === 'in_progress'` still (runner will post runner-exit with exit_code=137 which is still within retry cap).
4. Simulate daemon retry: call `POST /api/runner/tasks/:id/runner-exit` directly with `{exit_code: 137, reason: 'crash'}` → runner_attempts increments, task flips to `assigned`.
5. Re-claim: call `POST /api/runner/claim/:task_id` handler → assert response.task.is_resuming === true, response.task.prior_attempts.length === 1.
6. Inspect the resume-preamble written to `.mc/progress.md` by `seedMcDir({is_resuming: true, resume_marker: ...})` — assert the LOCKED marker line appears byte-for-byte (Phase 15-03 lock).
7. Re-run the container (without the sleep override) → assert task reaches done and `.mc/progress.md` contains BOTH the first-attempt line AND the second-attempt line (no redo).

**Key pitfall:** the reference image agent's single-shot flow ALWAYS appends to `progress.md` from scratch. It does not read `progress.md` first. This means "resume without redoing work" is a runtime-agent concern, NOT a runner concern — the runner's job (which Phase 17 tests) is to PRESERVE `.mc/` and PRESENT the resume preamble. The "without redoing work" assertion should be scoped to: `.mc/progress.md` contains TWO appended lines (both attempts), `.mc/checkpoints.jsonl` contains TWO appended JSON lines. Whether a real model-backed agent would actually "not redo" is out of scope for this image — the test asserts the RESUME MECHANICS, not the agent's cognition.

### Pattern 4: Playwright SSE-Update E2E (RTEST-04)

**What:** Playwright spec that asserts a Progress tab appends a checkpoint row when a `POST /api/tasks/:id/checkpoints` fires during the test.
**Precedent:** `tests/recipes-panel.spec.ts` (Phase 16-06 happy-path).
**Flow:**
1. Suppress onboarding wizard via `page.addInitScript` (sessionStorage).
2. Login via `/api/auth/login` (matching existing spec).
3. Seed a recipe (via `POST /api/recipes/resync` to index `recipes/hello-world/`) and a recipe-tagged task in status `in_progress` (via `POST /api/tasks` with `status: 'assigned'` then advance to `in_progress` via a direct PATCH) with an attached worktree_path stub.
4. Navigate to the task detail view; click the Progress tab.
5. Assert the task card recipe badge renders (RUI-01 assertion): `page.getByText('Hello World Agent')` or whatever the recipe name resolves to.
6. Via `page.request.post('/api/runner/tasks/:id/checkpoints', { headers: { Authorization: 'Bearer <runner-token>' }, data: {...} })` — but this requires a runner-token. EASIER: write the checkpoint directly via the operator-role route if one exists, OR mint a runner-token through the test setup by calling `issueRunnerToken` via an internal test-only endpoint (not recommended), OR use the admin API key to call `POST /api/tasks/:id/checkpoints` if the allowlist permits it (check the 15-04 route — it's runner-token-only, so option 3 is out).
7. Recommended test seam: add a test-only `scripts/e2e-openclaw/seed-checkpoint.mjs` invoked via a `page.request.post` to a test harness endpoint, OR direct-insert into `task_checkpoints` + `eventBus.broadcast` via a small test-only API route.
8. Assert the Progress tab appends the new row within ~500 ms.

**Key pitfall:** the E2E server at port 3005 runs a FRESH process; `eventBus` is per-process; a runner-token issued in the Vitest harness is NOT valid in the E2E server's DB. Seeding via `page.request.post` against REAL endpoints is the only clean path. Consider adding a minimal test-only fixture route `/api/test-only/seed-checkpoint` (gated by `MISSION_CONTROL_TEST_MODE=1`) that accepts admin-key auth and writes through `writeCheckpoint()`. The planner MUST decide whether to add this test-only seam.

### Anti-Patterns to Avoid

- **Mocking all of `@/lib/*`:** defeats the purpose of an integration test. Phase 15-07 LOCKED boundary-mock pattern explicitly allows real production modules; only event-bus/rate-limit/runner-secret/security-events/db are mocked.
- **Hard-coded ports for test servers:** E2E server uses `127.0.0.1:3005` (hard-coded in playwright configs). Integration tests must NOT pick the same port. Use `net.createServer().listen(0)` for dynamic allocation.
- **Leaking docker containers or worktrees:** every Docker-dependent test MUST have an `afterEach`/`afterAll` that runs `docker ps -a --filter label=mc.task_id=<id> --format '{{.ID}}' | xargs docker rm -f` AND `fs.rmSync(worktreePath, {recursive: true, force: true})`. The existing smoke harness at `scripts/mc-runner-smoke.sh:106-120` has the trap pattern to copy.
- **Relying on agent cognition for resume correctness:** the `mc-hello-world-agent` image does not READ `progress.md` before appending. Assertions must scope to file-preservation + preamble-emission, not "agent skipped a step."
- **Testing Aegis approval inline:** Aegis runs via `runAegisReviews()` scheduler task, polls gateway or calls Claude directly. Mocking all of that end-to-end is out of Phase 17 scope. See Open Question #1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Container spin-up + cleanup | Custom wrapper around `docker run` with PID tracking | Existing `scripts/mc-runner.mjs` (spawn it) or raw `spawnSync('docker', ['run', '--rm', ...])` with the `--label mc.task_id=<id>` hook | The runner daemon is already Phase 14-08b's tested code path; replicating its logic in tests creates drift. |
| Worktree seeding | Re-implement `.mc/task.json` + `.mc/progress.md` + `.mc/checkpoints.jsonl` layout | `import { seedMcDir } from '@/lib/runner-worktree'` | Phase 14-07 + 15-03 already encode the LOCKED preamble/marker format; re-deriving it in a test would miss byte-for-byte invariants. |
| Runner-token minting for tests | Handcraft a `Bearer` string | `import { issueRunnerToken } from '@/lib/runner-tokens'` | Already the Phase 15-07 precedent pattern. |
| Recipe fixture indexing | Hand-insert rows into `recipes` table | `import { indexRecipe } from '@/lib/recipe-indexer'` with a mkdtemp recipe root | Exercises the real parser + dir_sha + MODEL-02 validation; hand-insert skips those. |
| SSE assertion in Playwright | Poll `page.evaluate` until DOM mutates | Use `page.waitForSelector` or `expect(locator).toBeVisible()` with the default 10 s `expect.timeout` from `playwright.config.ts` | Idiomatic Playwright; no custom retry loop needed. |
| Docker daemon availability detection | Try-catch around `docker run` and conclude from errors | `spawnSync('docker', ['info']).status === 0` at `beforeAll` → `describe.skipIf(!dockerAvailable)` | Declarative skip is visible in test output; try-catch hides the reason. |
| Test teardown of hung containers | Manual `docker rm -f` loops | `spawn('docker', ['kill', '--signal', 'SIGKILL', name])` in afterEach + label-scoped cleanup | Matches the runner daemon's own cleanup logic (`runner-reconcile.ts`). |

**Key insight:** Phase 17 is a *composition* test — assemble existing primitives, don't invent new ones. Every test should import from `@/lib/runner-*`, `@/lib/recipe-*`, `@/lib/task-checkpoints`, `@/lib/runner-tokens`, `@/lib/migrations` and treat those as black boxes. New test code should be ~500 LOC total; if a plan is writing >1000 LOC of test-helper code, it is probably re-deriving something that already exists.

## Common Pitfalls

### Pitfall 1: better-sqlite3 Native Addon Node Version Drift
**What goes wrong:** Tests hang on startup or throw `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` mismatch.
**Why it happens:** The test runner uses a different Node version than the one `better-sqlite3` was built against. CI uses `.nvmrc` (Node 22), but local dev may run Node 24.
**How to avoid:** `pnpm rebuild better-sqlite3` before running integration tests. CI's `pnpm install --frozen-lockfile` handles this automatically because of `pnpm.onlyBuiltDependencies`. The project's own `postinstall` hook at `package.json:31` prints a helpful error if the rebuild is needed.
**Warning signs:** vitest hangs at "Collecting files" or a single integration test times out on first run.

### Pitfall 2: Vitest jsdom vs Node Environment for Docker-Dependent Tests
**What goes wrong:** Integration tests that spawn `docker` subprocesses run inside jsdom's event loop and inherit jsdom's `process.env` stubs.
**Why it happens:** Project-wide `vitest.config.ts` sets `environment: 'jsdom'` globally.
**How to avoid:** Use the file-level `// @vitest-environment node` directive at the top of RTEST-02/03 files. See vitest docs. Do NOT change the global setting.
**Warning signs:** `fetch` or `crypto` behaves differently than expected inside the test.

### Pitfall 3: Resume-Preamble Byte-for-Byte Drift
**What goes wrong:** RTEST-03 asserts on a regex that matches the resume marker, drifts silently when Phase 15-03's LOCKED format changes.
**Why it happens:** Phase 15-07 integration test author chose `expect(progress).toBe(initialProgress + expectedMarker)` specifically to catch this. Regex matching hides drift.
**How to avoid:** Byte-assert the full resume marker string (lines 155-189 in 15-05 SUMMARY cite the format). Plan should copy the exact expected string from `src/lib/runner-worktree.ts` into the test.
**Warning signs:** Regex assertion passes, but operator users notice the resume preamble "looks different" after a release.

### Pitfall 4: Docker Container Not Cleaned Up on Test Failure
**What goes wrong:** A failed test leaves `mc-task-*` containers running, which consume ports + the per-recipe `max_concurrent` cap, and the next test run starts over-cap.
**Why it happens:** `afterEach` didn't run because the test threw in `beforeEach`.
**How to avoid:** Use `afterAll` (runs even on suite-level failure) in addition to `afterEach`, AND wrap all docker-spawning tests in a `describe` block whose `afterAll` does label-based cleanup: `spawnSync('docker', ['ps', '-aq', '--filter', 'label=mc.task_id'], …)` then `docker rm -f`.
**Warning signs:** `docker ps -a` shows lingering `mc-task-*` entries; subsequent test runs 409 on claim.

### Pitfall 5: GitHub Actions Ubuntu Runner Docker Timing
**What goes wrong:** Tests that pull an image or build one inside the CI job time out.
**Why it happens:** First `docker run` on a clean Ubuntu runner has to lazy-start dockerd.
**How to avoid:** Add an explicit `docker info` step at CI-workflow level BEFORE `pnpm test:all`. The reference image is built by `pnpm mc:build-hello-world` — CI must run that build before the integration tests. Recommended CI addition (in `quality-gate.yml` AFTER the "Build" step): `- name: Build reference image\n  run: pnpm mc:build-hello-world` then the integration tests can depend on the image existing.
**Warning signs:** First CI run fails with "mc-hello-world-agent:latest not found"; re-runs succeed (image got cached).

### Pitfall 6: Playwright Needs a Running Server for SSE
**What goes wrong:** RTEST-04 E2E test's SSE assertion never fires because there's no upstream event emitter.
**Why it happens:** Playwright runs against the E2E server (port 3005) — that server's event bus is in-process. A Vitest-side POST to `POST /api/tasks/:id/checkpoints` runs in a SEPARATE process and won't broadcast to the E2E server.
**How to avoid:** Do the checkpoint-creating POST from INSIDE the Playwright spec via `page.request.post(...)` — it goes through the same server the browser is connected to.
**Warning signs:** test passes synchronously but "new checkpoint appeared" assertion times out.

### Pitfall 7: Git Worktree Requires Real Git Repo + Initial Commit
**What goes wrong:** `git worktree add` fails with "not a git repository" or "no commits yet".
**Why it happens:** The test's project-repo path was just `mkdir`'d; no `git init` + `git commit`.
**How to avoid:** Test setup MUST `spawnSync('git', ['init', '-b', 'main'])`, make a dummy initial commit, THEN `git worktree add` will work. The smoke harness doesn't do this because it uses the REAL mission-control repo, which is already a git repo.
**Warning signs:** runner claim succeeds but container fails to start; stderr contains `fatal: not a git repository`.

### Pitfall 8: Existing `runner-tokens.test.ts:194` Deferred Item
**What goes wrong:** RTEST-01 plan author "fixes" the allowlist-length drift note without realizing it's pre-existing since Plan 15-04.
**Why it happens:** The assertion counts 7 entries; adding new routes changes the count. Comment in test notes "update this count if the allowlist grows."
**How to avoid:** Phase 17 should NOT touch `runner-tokens.test.ts:194` unless also landing an explicit length-bump commit, AND the test stays in sync by construction (derive length from import, not magic number).
**Warning signs:** Test fails with "expected 7, got 8" after an unrelated Phase 18 route addition.

### Pitfall 9: Aegis Review vs Direct Submit Mismatch
**What goes wrong:** RTEST-02 plan author implements "task enters review, Aegis approves, done" per the ROADMAP goal but discovers the submit route flips `in_progress → done` directly.
**Why it happens:** ROADMAP language is aspirational; actual Phase 14 submit at `src/app/api/runner/tasks/[task_id]/submit/route.ts:97` does NOT route through a `review` status.
**How to avoid:** See § Open Questions #1. Plan should EITHER (a) accept the direct path and scope RTEST-02 success criterion to "done" not "reviewed+done", OR (b) extend Phase 17 scope to add a feature-flag for `review` gating (scope creep — recommend discussing with operator first).

### Pitfall 10: Reference Image CMD Override for Test Modes
**What goes wrong:** RTEST-03 crash-recovery test needs a container that sleeps or blocks so the test can SIGKILL it deterministically. The existing `mc-hello-world-agent` image runs to completion in ~5 seconds.
**Why it happens:** Phase 14-09 deliberately kept the reference image minimal; no test-mode flags.
**How to avoid:** Two options:
- (a) Override the CMD at `docker run` time: `--entrypoint /bin/sh mc-hello-world-agent:latest -c "sleep 30; node /app/agent.mjs"`. Simplest; no image change.
- (b) Add a `--sleep-ms=N` flag to `agent.mjs` gated by env `MC_TEST_SLEEP_MS`. Cleaner but touches Phase 14 code.
**Recommendation:** option (a). Zero production code change.

## Code Examples

### 1. Recipe Indexer Gap Test — malformed YAML (RTEST-01 AUDIT)

```typescript
// Source: extend src/lib/__tests__/recipe-indexer.test.ts
// Existing file has 40+ tests; add ~5 gap-filling cases:
it('records error row with helpful message on malformed YAML', async () => {
  writeFileSync(join(recipeDir, 'recipe.yaml'), 'slug: hello\nname: [oops unclosed')
  const result = await indexRecipe(recipeDir, { dbOverride: db })
  expect(result.status).toBe('indexed_error')
  const row = getIndexedRecipeBySlug('hello', { dbOverride: db })
  expect(row?.error_message).toMatch(/YAML|parse/i)
})

it('rejects unknown model.primary via MODEL-02', async () => {
  writeFileSync(join(recipeDir, 'recipe.yaml'), validYamlWithModel('claude-future-9-9'))
  const result = await indexRecipe(recipeDir, { dbOverride: db })
  expect(result.status).toBe('indexed_error')
  const row = getIndexedRecipeBySlug('hello', { dbOverride: db })
  expect(row?.error_message).toMatch(/model|registry/i)
})
```

### 2. Mount-Allowlist Symlink-Escape Test (RTEST-01 GAP)

```typescript
// Source: extend src/lib/__tests__/task-runtime-validation.test.ts
// Add to existing describe('validateHostPathAgainstAllowlist'):
it('rejects a symlink whose realpath escapes the allowlist', async () => {
  const outside = await realpath(tmpRootSibling)   // NOT in allowlist
  const link = join(tmpRoot, 'sneaky')
  await symlink(outside, link)
  hoisted.allowlist = [tmpRootReal]                 // only tmpRoot is allowed
  const result = await validateHostPathAgainstAllowlist(link)
  expect(result.ok).toBe(false)
  expect(result.code).toBe('OUT_OF_ALLOWLIST')
})
```

### 3. Runner-Token Cross-Task Rejection (RTEST-01 GAP)

```typescript
// Source: extend src/lib/__tests__/runner-tokens.test.ts
// The existing file has 18 tests; cross-task rejection may already be
// covered by auth-runner-token-principal.test.ts — planner should audit
// before adding. The Plan 11-04 "cross-task 403" invariant lives in
// requireRunnerToken wrapper, not verifyRunnerToken, so the test belongs
// in auth-runner-token-principal.test.ts not runner-tokens.test.ts.
```

### 4. Checkpoint blocked-without-reason (RTEST-01 GAP)

```typescript
// Source: extend src/lib/__tests__/task-checkpoints.test.ts (already exists)
// Plan should VERIFY this case exists; if not, add:
it('rejects status=blocked with missing blocker_reason', () => {
  const parsed = CheckpointBodySchema.safeParse({
    step: 'work',
    summary: 'stuck',
    status: 'blocked',  // no blocker_reason
  })
  expect(parsed.success).toBe(false)
})
```

### 5. Docker Preflight (RTEST-02/03 required)

```typescript
// Source: new at top of phase-17-pipeline-integration.test.ts
// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { describe, beforeAll } from 'vitest'

const dockerAvailable = (() => {
  try {
    return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
  } catch { return false }
})()

const imageAvailable = dockerAvailable && (() => {
  const r = spawnSync('docker', ['image', 'inspect', 'mc-hello-world-agent:latest'],
    { stdio: 'ignore' })
  return r.status === 0
})()

describe.skipIf(!dockerAvailable || !imageAvailable)(
  'Phase 17 pipeline integration (RTEST-02)',
  () => {
    // ... tests
  }
)
```

### 6. Spawn Runner Daemon for Integration (RTEST-02 option c)

```typescript
// Source: matches scripts/mc-runner-smoke.sh pattern
import { spawn } from 'node:child_process'

const runner = spawn('node', ['scripts/mc-runner.mjs'], {
  env: { ...process.env, MC_URL: `http://127.0.0.1:${dynamicPort}` },
  stdio: ['ignore', 'pipe', 'pipe'],
})
// In afterAll:
runner.kill('SIGTERM')
await new Promise((r) => setTimeout(r, 2000))
if (!runner.killed) runner.kill('SIGKILL')
```

### 7. Playwright Live-Update Assertion (RTEST-04)

```typescript
// Source: pattern from tests/recipes-panel.spec.ts
// New file tests/recipes-progress-live.spec.ts
test('Progress tab appends row on live checkpoint SSE', async ({ page }) => {
  // ... login, seed task, open task detail
  await page.getByRole('tab', { name: /progress/i }).click()
  await expect(page.getByText('Initial checkpoint')).toBeVisible()  // seeded

  // POST via the test-only seam (see § Open Question #3)
  const resp = await page.request.post(`/api/test-only/seed-checkpoint`, {
    headers: { Authorization: `Bearer ${process.env.API_KEY}` },
    data: {
      task_id: taskId, step: 'live-step', summary: 'triggered by test',
      status: 'completed',
    },
  })
  expect(resp.ok()).toBe(true)

  // Default expect.timeout is 10s (playwright.config.ts)
  await expect(page.getByText('live-step')).toBeVisible()
})
```

### 8. Git Worktree Fixture Setup (RTEST-02/03)

```typescript
// Source: inferred from runner-worktree.ts expected preconditions
function setupGitRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true })
  for (const args of [
    ['init', '-b', 'main'], ['config', 'user.email', 'test@test'],
    ['config', 'user.name', 'test'], ['commit', '--allow-empty', '-m', 'init'],
  ]) {
    const r = spawnSync('git', ['-C', repoPath, ...args])
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  }
}
```

## Existing Test Coverage Audit

RTEST-01 is "unit tests cover X, Y, Z, W." Four of the four target modules already have test files. Phase 17 plan should AUDIT existing coverage and fill gaps, NOT duplicate:

| Target | Existing file | Tests (approx) | Likely Gaps |
|--------|---------------|----------------|-------------|
| Recipe indexer | `src/lib/__tests__/recipe-indexer.test.ts` + `recipe-schema.test.ts` + `recipe-hash.test.ts` + `recipe-watcher.test.ts` + `recipe-watcher-events.test.ts` + `migrations-v12-recipe.test.ts` | 40+ | Specific malformed-YAML edge cases; MODEL-02 rejection on each fallback-provider combination; dir_sha dedup on error-row re-parse |
| Mount allowlist | `src/lib/__tests__/task-runtime-validation.test.ts` + `task-runtime-settings.test.ts` | 30+ | Symlink-with-parent-walk edge cases if not already covered |
| Runner tokens | `src/lib/__tests__/runner-tokens.test.ts` + `runner-tokens-allowlist.test.ts` + `runner-token-revocation.test.ts` + `auth-runner-token-principal.test.ts` | 40+ | Cross-task rejection is already in auth-runner-token-principal.test.ts; verify coverage; expiry-boundary (exactly-at-expiry rejection) may need a test |
| Checkpoints | `src/lib/__tests__/task-checkpoints.test.ts` + `src/app/api/tasks/[id]/checkpoints/__tests__/` (integration.test.ts + route.test.ts + route-blocker.test.ts) | 50+ | blocked-without-blocker_reason schema rejection; artifact.kind discriminated-union edge cases |

**Key insight:** Phase 17 plan should begin with a "GAP AUDIT" task that reads each existing test file, enumerates the cases covered, and lists ONLY the missing cases that RTEST-01 explicitly calls out. Budget for RTEST-01 is likely 1 short plan (~5 new test cases across 3-4 files), not a multi-wave effort.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 1-10 era: per-route handler unit tests with heavy mocks | Phase 15-07 era: boundary-mock integration tests importing real handler + real libs | 2026-04-20 (Plan 15-07) | Catches cross-module composition bugs that unit tests miss |
| Spawning real runner daemon in tests | Direct lib-module invocation (import + call) | 2026-04-19 (Phase 14-07 / 14-08a split) | Faster, hermetic, no daemon lifecycle management |
| Playwright mocking SSE | Real POST via `page.request` against the same server | 2026-04-21 (Phase 16-06 recipes-panel.spec) | Genuine end-to-end coverage |

**Deprecated/outdated:**
- Vitest v1 patterns (`vi.fn()` without type arg, old `mock.module` signature) — the project uses vitest 2.1 consistently; don't regress.

## Open Questions

1. **Does the Phase 17 pipeline test need to flow through `status: 'review'` and Aegis approval, or is `in_progress → done` via the current submit route sufficient?**
   - What we know: ROADMAP § Phase 17 Success Criterion 2 explicitly says "task enters `review`, Aegis approves, task reaches `done`." But `src/app/api/runner/tasks/[task_id]/submit/route.ts:97` flips `status='done'` directly. Aegis runs via `runAegisReviews()` scheduler task against tasks in status `review`, not against runner-submitted tasks.
   - What's unclear: whether to (a) update the submit route in Phase 17 to route through `review` first (scope creep), (b) mock Aegis approval in the test, or (c) scope RTEST-02 success to "task reaches `done`" and treat the Aegis-review flavor as out-of-scope for this milestone.
   - Recommendation: **option (c) with a deferred-items.md entry**. The ROADMAP language predates the Phase 14 submit implementation; the operator should confirm before the planner commits.

2. **Should RTEST-02 spawn `scripts/mc-runner.mjs` or directly invoke `runner-claim.ts` + `runner-docker.ts`?**
   - What we know: spawning the daemon mirrors production exactly; direct invocation is faster + more hermetic.
   - What's unclear: operator's preference for coverage breadth vs. speed. A daemon-spawn test will run in 60–180 s; a direct-invocation test will run in 10–30 s.
   - Recommendation: **both — one of each**. Budget permitting, a fast "inner-loop" integration test runs on every PR; a slower "full-pipeline" smoke runs weekly or pre-release via the existing `scripts/mc-runner-smoke.sh`.

3. **Does Phase 17 need a test-only `/api/test-only/seed-checkpoint` seam for RTEST-04?**
   - What we know: runner-tokens are per-task, per-attempt, expiry-bound; Playwright spec can't easily mint one from outside the server process. Existing admin API key CANNOT hit the runner-token-scoped checkpoint route.
   - What's unclear: acceptable security posture for a `MISSION_CONTROL_TEST_MODE=1`-gated test fixture endpoint.
   - Options: (a) add a new minimal test-only route, gated by env (matches `.env.test` pattern); (b) refactor POST /api/tasks/:id/checkpoints to accept admin bearer in addition to runner-token (changes scope — auth-surface change); (c) spawn a real runner daemon as part of the E2E setup that claims a seeded task and emits a real checkpoint (matches scripts/mc-runner-smoke.sh; heaviest but most realistic).
   - Recommendation: **option (a)** with an explicit plan-level note that the route lives under `/api/test-only/*` and returns 404 unless `MISSION_CONTROL_TEST_MODE=1`. Matches the existing `e2e-openclaw` harness pattern.

4. **Where do the Docker-gated integration tests live in CI?**
   - What we know: `.github/workflows/quality-gate.yml` runs `pnpm test:all`. Docker is available on `ubuntu-latest` runners but not explicitly set up. The reference image is built locally via `pnpm mc:build-hello-world`.
   - What's unclear: whether to (a) fold the docker tests into `pnpm test:all` with a CI step that pre-builds the reference image, (b) create a separate `test:integration:docker` script that runs only when a label is applied or on a cron schedule, (c) skip the docker tests in CI entirely and rely on local/smoke.
   - Recommendation: **option (a)** — build the image in CI right after the `Build` step and before `Unit tests`. Docker startup on Ubuntu runners is reliable; the reference image build is <60 s after Node 22 + alpine layers are cached.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.x (unit + integration) + Playwright 1.51.x (E2E) |
| Config file | `vitest.config.ts`, `playwright.config.ts`, `playwright.openclaw.local.config.ts` |
| Quick run command | `pnpm test -- src/lib/__tests__/phase-17-*.test.ts` (unit + integration scope) |
| Full suite command | `pnpm test:all` (lint + typecheck + test + build + e2e); `pnpm mc:build-hello-world && pnpm test:e2e` for the Playwright subset |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RTEST-01 | Recipe indexer parses & rejects malformed YAML / unknown model | unit | `pnpm test -- src/lib/__tests__/recipe-indexer.test.ts` | Extend existing |
| RTEST-01 | Mount allowlist rejects symlink escapes | unit | `pnpm test -- src/lib/__tests__/task-runtime-validation.test.ts` | Extend existing |
| RTEST-01 | Runner-token mint/verify/revoke + cross-task 403 + expiry | unit | `pnpm test -- src/lib/__tests__/runner-tokens.test.ts src/lib/__tests__/auth-runner-token-principal.test.ts src/lib/__tests__/runner-token-revocation.test.ts` | Extend existing |
| RTEST-01 | Checkpoint schema + blocked-without-reason rejection | unit | `pnpm test -- src/lib/__tests__/task-checkpoints.test.ts` | Extend existing |
| RTEST-02 | Full pipeline: create task → claim → container → checkpoint → submit → done | integration (Docker-gated) | `pnpm test -- src/lib/__tests__/phase-17-pipeline-integration.test.ts` | ❌ Wave 0 (new file) |
| RTEST-03 | Crash mid-task → worktree preserved → retry resumes without redoing | integration (Docker-gated) | `pnpm test -- src/lib/__tests__/phase-17-crash-recovery.test.ts` | ❌ Wave 0 (new file) |
| RTEST-04 | Recipe badge renders on cards; Progress tab appends on checkpoint SSE | E2E (Playwright) | `pnpm test:e2e -- tests/recipes-progress-live.spec.ts` | ❌ Wave 0 (new file) |

**Note:** RTEST-02 and RTEST-03 are `describe.skipIf(!dockerAvailable)` — they run silently if Docker is absent. CI MUST ensure Docker is present to avoid a silent green.

### Sampling Rate

- **Per task commit:** `pnpm test -- src/lib/__tests__/phase-17-*.test.ts` (<30 s unit + integration when Docker available).
- **Per wave merge:** `pnpm test && pnpm test:e2e` (~3 minutes).
- **Phase gate:** `pnpm mc:build-hello-world && pnpm test:all` must be green before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `src/lib/__tests__/phase-17-pipeline-integration.test.ts` — covers RTEST-02 (new file; node env; Docker-gated)
- [ ] `src/lib/__tests__/phase-17-crash-recovery.test.ts` — covers RTEST-03 (new file; node env; Docker-gated)
- [ ] `tests/recipes-progress-live.spec.ts` — covers RTEST-04 (new Playwright spec)
- [ ] `scripts/mc-runner-smoke.sh` — extend `preserve-on-stop` + `preserve-across-crash` subcommands (stubs already reserved at lines 542-544)
- [ ] (conditional on § Open Question #3 outcome) `src/app/api/test-only/seed-checkpoint/route.ts` — test fixture endpoint gated by `MISSION_CONTROL_TEST_MODE=1`
- [ ] (conditional on § Open Question #4 outcome) `.github/workflows/quality-gate.yml` — add "Build reference image" step before integration tests; optionally add a `docker info` preflight
- [ ] GAP-AUDIT pass across four existing RTEST-01 target test files — list only the missing cases

**If no gaps:** (not applicable — Phase 17 is net-new)

## Sources

### Primary (HIGH confidence)

- Existing codebase: `/Users/aaronwhaley/Github/mission-control/src/app/api/tasks/[id]/checkpoints/__tests__/integration.test.ts` (Phase 15-07 LOCKED boundary-mock pattern)
- Existing codebase: `/Users/aaronwhaley/Github/mission-control/src/lib/__tests__/phase-15-blocker-flow-integration.test.ts` (5-phase end-to-end integration precedent)
- Existing codebase: `/Users/aaronwhaley/Github/mission-control/scripts/mc-runner-smoke.sh` (bash smoke harness with daemon-spawn + cleanup trap; reserved Phase 17 subcommands at lines 542-544)
- Existing codebase: `/Users/aaronwhaley/Github/mission-control/docker/hello-world-agent/{Dockerfile,agent.mjs,build.sh}` (reference image — already exists from Phase 14-09)
- Existing codebase: `/Users/aaronwhaley/Github/mission-control/recipes/hello-world/{recipe.yaml,SOUL.md}` (reference recipe — already indexed)
- Existing codebase: `/Users/aaronwhaley/Github/mission-control/src/app/api/runner/tasks/[task_id]/submit/route.ts` (submit goes in_progress → done directly, bypassing review — source of Open Question #1)
- Existing codebase: `/Users/aaronwhaley/Github/mission-control/playwright.config.ts` and `/Users/aaronwhaley/Github/mission-control/tests/recipes-panel.spec.ts` (Playwright Phase 16 precedent)
- Existing codebase: `/Users/aaronwhaley/Github/mission-control/.github/workflows/quality-gate.yml` (CI — no current Docker setup)
- Phase 14-09/14-10 SUMMARY locks (reference image, smoke harness) at `/Users/aaronwhaley/Github/mission-control/.planning/phases/14-runner-container-v1-2/`
- Phase 15-07 SUMMARY at `/Users/aaronwhaley/Github/mission-control/.planning/phases/15-checkpoints-scheduler-v1-2/15-07-SUMMARY.md` (boundary-mock lock precedent)

### Secondary (MEDIUM confidence)

- [Testcontainers for Node.js](https://node.testcontainers.org/) — v11.14.0 (April 2026) current stable; deferred per § Standard Stack Alternatives Considered
- [testcontainers/testcontainers-node GitHub](https://github.com/testcontainers/testcontainers-node) — package `testcontainers`, current stable
- [Vitest + Testcontainers community guide](https://dev.to/jcteague/using-testconatiners-with-vitest-499f) — documents Vitest parallelism pitfalls with global-setup
- [Docker blog: Testcontainers Best Practices](https://www.docker.com/blog/testcontainers-best-practices/) — dynamic port mapping invariant

### Tertiary (LOW confidence)

- [OneUptime blog: integration tests with testcontainers (2026-01-06)](https://oneuptime.com/blog/post/2026-01-06-nodejs-integration-tests-testcontainers/view) — general pattern reference

## Metadata

**Confidence breakdown:**

- Existing test-coverage audit: HIGH — directly enumerated files on disk.
- Standard stack: HIGH — no new dependencies required; all tooling is already in use.
- Architecture (boundary-mock + Docker subprocess): HIGH — Phase 15-07 LOCKED pattern + existing smoke harness.
- Pitfalls 1–7: HIGH — all verified against existing code or explicit prior locks.
- Pitfall 8 (runner-tokens.test.ts:194 drift): HIGH — documented in STATE.md Pending Todos / Blockers section.
- Pitfall 9 (Aegis vs submit mismatch): HIGH — verified by reading submit route + task-dispatch.runAegisReviews.
- Pitfall 10 (reference-image override): HIGH — reference image source code is short and verified.
- Open Question 1 (review path): HIGH confidence the mismatch EXISTS; LOW confidence on what operator prefers.
- Open Question 3 (test-only seam): MEDIUM — depends on operator risk tolerance for a gated endpoint.
- Open Question 4 (CI docker integration): MEDIUM — CI currently runs fine without docker; adding it is an operator decision.

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days — stable stack + prior-phase locks are fixed; only volatile input is operator preference on Open Questions 1/3/4)
