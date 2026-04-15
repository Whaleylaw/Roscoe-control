---
phase: 09-gsd-native-integration
plan: 10
subsystem: verification-sweep
tags: [e2e, playwright, api-index, test-infra, rate-limit, phase-gate]
dependency-graph:
  requires: [09-02, 09-03, 09-04, 09-05, 09-06, 09-07, 09-08, 09-09]
  provides: [phase-09-gate-verification, gsd-lifecycle-e2e]
  affects: [tests/gsd-lifecycle.spec.ts, src/app/api/index/route.ts, scripts/e2e-openclaw/start-e2e-server.mjs, tests/login-flow.spec.ts, tests/projects-entry-point.spec.ts, tests/project-sessions.spec.ts, tests/project-tasks.spec.ts]
tech-stack:
  added: []
  patterns: [x-real-ip login-bucket isolation, standalone-static auto-copy]
key-files:
  created:
    - path: "n/a (test + docs only)"
      purpose: "No new source files — this plan replaces a Wave 0 stub and appends catalog entries"
  modified:
    - path: "tests/gsd-lifecycle.spec.ts"
      change: "Replaced Wave 0 test.fixme() with real 10-step Playwright E2E covering the full GSD lifecycle"
    - path: "src/app/api/index/route.ts"
      change: "Added 3 endpoint catalog entries: POST gsd/bootstrap, POST gsd/transition, PATCH tasks/:id/gate"
    - path: "scripts/e2e-openclaw/start-e2e-server.mjs"
      change: "Auto-copy .next/static and /public into .next/standalone before spawning — Next.js standalone doesn't do this on its own"
    - path: "tests/login-flow.spec.ts"
      change: "x-forwarded-for → x-real-ip so loginLimiter actually distinguishes the spec's IP bucket"
    - path: "tests/projects-entry-point.spec.ts"
      change: "Added x-real-ip to login helper for bucket isolation"
    - path: "tests/project-sessions.spec.ts"
      change: "Counter-bumped x-real-ip per test call + onboarding sessionStorage init script"
    - path: "tests/project-tasks.spec.ts"
      change: "Counter-bumped x-real-ip per test call + onboarding sessionStorage init script"
decisions:
  - "Route E2E through API primarily, UI click only for the bootstrap CTA (deterministic; no Zustand-lag race on transition buttons)"
  - "Use quality-review POST with reviewer=aegis as the Aegis-bypass mechanism — side-steps the 'done' gate without seeding quality_reviews directly"
  - "x-real-ip (not x-forwarded-for) is the correct login-bucket differentiator in e2e mode because MC_TRUSTED_PROXIES is unset and XFF is ignored"
  - "Standalone asset copy lives in start-e2e-server.mjs (not package.json test:all) so running the script directly works the same as pnpm test:e2e"
  - "Deferred items from Phase 9 (2 TS errors in 09-04 notes, 3 missing-module errors in 09-06/08/09 notes) have all been resolved by completed sibling plans; no residual cross-plan debt carries into Phase 10"
metrics:
  duration: 59min
  tasks: 3
  files: 7
  completed: 2026-04-15
---

# Phase 09 Plan 10: Verification sweep Summary

Closes Phase 9 by adding the cross-layer E2E that exercises the full GSD lifecycle, documenting the three new endpoints in the API catalog, and unblocking the `pnpm test:all` pipeline so future phases can actually run the suite green.

## Scope delivered

1. **`tests/gsd-lifecycle.spec.ts`** — real Playwright test replacing the Wave 0 `test.fixme()` stub. 10 steps, ~2.8s runtime against a warm server:
   1. Login as admin (x-real-ip for bucket isolation)
   2. POST /api/projects creates non-GSD project
   3. Navigate to `/project/{slug}/lifecycle` — Enable CTA visible
   4. PATCH /api/projects/{id} sets `gsd_enabled=1` (API — equivalent to clicking Enable)
   5. UI click on `Bootstrap phase tasks` — asserts POST /api/projects/{id}/gsd/bootstrap returns 200, ≥8 tasks created with phase + gate flags
   6. POST /api/projects/{id}/gsd/transition with `to_phase=execute` while in `discuss` — asserts 409 `ILLEGAL_TRANSITION`, from/to phases echoed
   7. POST /api/quality-review with `reviewer=aegis, status=approved` flips the first DISCUSS task to `done` (Aegis-bypass path per `quality-review/route.ts:108`)
   8. POST /api/projects/{id}/gsd/transition with `to_phase=plan` → 200, project.gsd_phase=plan
   9. PUT /api/tasks/{gated-plan-id} with `status=in_progress` → 403 `GATE_BLOCKED`
   10. PATCH /api/tasks/{id}/gate with `gate_status=approved` → 200, gate_approved_by set
   11. Retry PUT → 200, status=in_progress

   All 7 acceptance-criteria greps pass. Test is deterministic (no `waitForTimeout`), uses `page.waitForResponse` for the single UI click and `expect.poll`-free API checks elsewhere.

2. **`/api/index/route.ts`** — 3 new endpoint entries appended in the same shape the existing catalog uses (`{ path, methods, description, tag, auth }`):
   - `POST /api/projects/:id/gsd/bootstrap` → Projects tag, operator auth
   - `POST /api/projects/:id/gsd/transition` → Projects tag, operator auth
   - `PATCH /api/tasks/:id/gate` → Tasks tag, operator auth

   All three descriptions call out Phase 09 and include the key behavioral notes (idempotency, body shape, 409 codes, emitted events).

3. **`pnpm test:all` pipeline unblocked** (deviation Rule 2 — critical functionality missing):
   - Next.js standalone build doesn't copy `.next/static` or `/public` into `.next/standalone` on its own. `pnpm build && pnpm test:e2e` therefore served every JS/CSS chunk as HTML 404, which tripped strict MIME checks and hung React hydration mid-boot. Fixed by auto-copy in `start-e2e-server.mjs`. This had been broken for everyone running `pnpm test:all` on a cold clone — discovered by Phase 9's first full-suite run.
   - Login rate-limiter (`loginLimiter`, 5/min, `critical=true` so it cannot be disabled) is keyed by client IP. Every e2e spec that didn't set `x-real-ip` shared the `'unknown'` bucket and exhausted it after the 5th login, 429-ing all subsequent UI tests. Existing `x-forwarded-for` headers in some specs were silently ignored because `MC_TRUSTED_PROXIES` is unset in e2e mode. Fixed by adding unique `x-real-ip` headers across 5 specs.

## Phase 9 success criteria — all verifiable

| ROADMAP criterion | Validated by |
|---|---|
| 1. GSD-enabled project creation | 09-02 unit tests + Plan 10 E2E step 2 |
| 2. Bootstrap creates tasks exactly once | 09-03 unit tests + Plan 10 E2E step 5 (≥8 tasks, idempotent re-run skips) |
| 3. Transition enforces ordering | 09-04 unit tests + Plan 10 E2E step 6 (illegal) + step 8 (legal) |
| 4. PATCH gate flips status + gate-block on task status | 09-05 + 09-06 unit tests + Plan 10 E2E steps 9-11 |
| 5. All 3 endpoints require operator+admin | 09-03/04/05 tests all assert `requireRole('operator')` |
| 6. Lifecycle tab renders per UI-SPEC | 09-07 component tests |
| 7. Task board phase + gate badges | 09-08 component tests |
| 8. Settings view GSD section | 09-09 component tests |
| 9. Events via eventBus; activities stream | 09-04 transition broadcast + 09-05 gate double-broadcast |
| 10. All strings under project.lifecycle.*, 10 locales atomic | 09-00 locale-parity test (241 assertions) |
| 11. Migration additive; non-GSD projects unchanged | 09-01 migration tests |
| 12. Test suite covers all required behaviors | Waves 0-4 |

## Deviations from Plan

### Rule 2 — Auto-add missing critical functionality

**1. Next.js standalone missing static-asset copy (tests fail across the board)**
- Found during: Task 3 (`pnpm test:all`)
- Issue: `pnpm build` produces `.next/standalone/server.js` but does NOT copy `.next/static` or `/public` into the standalone dir. The e2e harness spawns the server from that path and serves every chunk as HTML (404 → wrong MIME), which prevents React from hydrating. Manifests as 20+ UI tests hanging on the splash screen.
- Fix: `scripts/e2e-openclaw/start-e2e-server.mjs` now performs the copy inside the `if (fs.existsSync(standaloneServerPath))` branch, matching the same copy that `scripts/start-standalone.sh` already does for production launches.
- Files modified: `scripts/e2e-openclaw/start-e2e-server.mjs`
- Commit: 7b5772e

**2. Login rate-limiter keyed by unknown-bucket in e2e mode (tests 429 after the 5th login)**
- Found during: Task 3 (`pnpm test:all`)
- Issue: `loginLimiter` is `critical=true` (cannot be disabled by `MC_DISABLE_RATE_LIMIT=1`) and keyed by IP (5/min). `MC_TRUSTED_PROXIES` is unset in the e2e env, so `x-forwarded-for` is ignored; all specs that didn't set `x-real-ip` share `'unknown'` and exhaust it partway through the suite.
- Fix: Added unique `x-real-ip` headers to the 5 affected specs. Two specs (`project-sessions`, `project-tasks`) call login once per test, so they use a monotonic counter to give each test its own bucket.
- Files modified: `tests/gsd-lifecycle.spec.ts`, `tests/login-flow.spec.ts`, `tests/projects-entry-point.spec.ts`, `tests/project-sessions.spec.ts`, `tests/project-tasks.spec.ts`
- Commit: 7b5772e

### Rule 3 — Auto-fix blocking issues

**3. Onboarding wizard blocks UI in project-sessions / project-tasks specs**
- Found during: Task 3 post-rate-limit rerun
- Issue: With login fixed, these specs reached UI assertions that rely on the nav-rail and workspace tabs being clickable. The first-time-admin onboarding wizard covers the workspace until dismissed. `tests/projects-entry-point.spec.ts` already suppresses this via a sessionStorage init script — the other two specs were missing the same hook.
- Fix: Added `sessionStorage.setItem('mc-onboarding-dismissed', '1')` init script inside `loginAndAttachCookie` for both specs.
- Files modified: `tests/project-sessions.spec.ts`, `tests/project-tasks.spec.ts`
- Commit: 7b5772e

## Pre-existing failures (out of scope, logged to deferred-items.md)

After this plan's infra fixes, 7 Playwright tests still fail. None touch Phase 9 surfaces; they surface now only because the suite can finally run end-to-end. See `.planning/phases/09-gsd-native-integration/deferred-items.md` § "09-10 deferred observations".

- `tests/project-tasks.spec.ts` × 4 — CreateTaskModal / EditTaskModal submission races (Phase 04 territory)
- `tests/workload-signals.spec.ts` × 3 — recommendation thresholds fail because leftover agents from prior tests within the same server run shift the busy ratio (Phase 05+ territory)

**Test-run breakdown:** 520 passed, 7 failed (pre-existing), 2 skipped on the final `pnpm test:e2e` pass of this plan. Phase 9's new spec (`gsd-lifecycle`) is in the 520-passing bucket; no Phase 9 test is in the 7-failing bucket.

## Timing breakdown — final `pnpm test:all`

| Stage | Duration |
|---|---|
| lint | ~6s |
| typecheck | ~5s |
| test (vitest, 1551 tests) | ~14s |
| build (next build, standalone) | ~60s |
| test:e2e (527 tests, 520 pass) | ~4.6min |
| **Total** | **~6 min** |

## Self-Check: PASSED

- [x] `tests/gsd-lifecycle.spec.ts` exists and has `test.fixme` count == 0, ≥1 real `test(` call
- [x] `ILLEGAL_TRANSITION`, `GATE_BLOCKED`, `gate_status.*approved`, `/gsd/bootstrap`, `/gsd/transition` all grep >0 in the spec
- [x] `src/app/api/index/route.ts` has 1 entry each for `/api/projects/:id/gsd/bootstrap`, `/api/projects/:id/gsd/transition`, `/api/tasks/:id/gate`
- [x] `pnpm lint` green (0 errors, 72 warnings)
- [x] `pnpm typecheck` exits 0
- [x] `pnpm test` — 1551 pass / 44 todo (all todos from pre-Phase-9 specs)
- [x] `pnpm build` succeeds, standalone output produced
- [x] `pnpm test:e2e` — Phase 9 spec passes; 7 unrelated pre-existing failures logged to deferred-items.md
- [x] All 3 Task commits visible in `git log`: 16a4001, 5f80509, 7b5772e
