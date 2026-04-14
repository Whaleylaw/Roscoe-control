---
phase: 08-projects-entry-point
plan: 03
subsystem: testing
tags: [e2e, playwright, nav-01, projects, breadcrumb, regression-guard]

# Dependency graph
requires:
  - phase: 08-projects-entry-point
    plan: 01
    provides: "Projects nav-rail item + /projects panel (ContentRouter 'projects' case + ProjectsPanel row selectors)"
  - phase: 08-projects-entry-point
    plan: 02
    provides: "Breadcrumb Projects segment routes to /projects (re-target verified end-to-end)"
provides:
  - "Playwright spec tests/projects-entry-point.spec.ts covering the NAV-01 cold-start journey end-to-end"
  - "Regression guard for any future change that breaks: nav-rail Projects placement, ContentRouter 'projects' wiring, ProjectsPanel row click handler, ProjectBreadcrumb Projects target"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Playwright E2E via session-cookie POST + page.request.post('/api/auth/login') — bypasses React-hydration race on login form onSubmit (traced failure mode: browser did native GET submit to /login? before React attached the preventDefault handler)"
    - "Onboarding-wizard suppression via context.addInitScript + sessionStorage['mc-onboarding-dismissed']='1' — reads the exact key src/lib/onboarding-session.ts exposes (ONBOARDING_SESSION_DISMISSED_KEY)"
    - "Boot-complete gate under test: await expect(getByRole('navigation', { name: /main navigation/i })).toBeVisible() — earliest deterministic signal that all 9 STEP_KEYS marked done and NavRail mounted"

key-files:
  created:
    - tests/projects-entry-point.spec.ts
  modified: []

key-decisions:
  - "Login via API request (page.request.post) instead of driving the login form — the form path is already covered by login-flow.spec.ts; this spec's subject is the journey AFTER login. Initial attempt via form-click hit a hydration race: browser occasionally submitted natively (GET /login?) before React attached the preventDefault handler. API login also happens to be faster and more deterministic."
  - "Suppress onboarding via sessionStorage injection instead of clicking 'Skip setup'. The wizard hides the nav-rail entirely ({!showOnboarding && <NavRail />}), and clicking skip involves server-side onboarding state machinery irrelevant to NAV-01. Injecting the dismissed-this-session key gives the page the exact state a returning-admin session has."
  - "Wait on <nav aria-label='Main navigation'> visibility as the boot-complete signal. The Home component only renders the real UI after bootComplete (9 async steps done). Any earlier wait (e.g. just `/` nav) falls through the splash screen where no nav exists."
  - "Role-based selectors for every click target: nav Projects button via getByRole('button', { name: /^projects$/i }), project row via getByRole('button', { name: projectName }) (ProjectsPanel sets aria-label={project.name} on the role=button div), breadcrumb scoped via getByRole('navigation', { name: /breadcrumb/i }).getByRole('button', { name: /^projects$/i }). Survives CSS/style churn."
  - "Fixture cleanup uses `?mode=delete` (admin hard delete) rather than the default `?mode=archive` — plan research confirmed this handler path reparents tasks to 'general' and fully removes the row, which matches the E2E clean-slate expectation."

patterns-established:
  - "First end-to-end spec in the Phase 8 projects-entry-point subsystem — reusable template for any future cold-start journey (role-based selectors, sessionStorage pre-seeding for onboarding, API-login for speed)"

requirements-completed: [NAV-01]

# Metrics
duration: 10min
completed: 2026-04-14
---

# Phase 08 Plan 03: NAV-01 Cold-Start Journey E2E Summary

**Playwright regression guard for the ROADMAP Phase 8 success criterion #4 — login -> Projects nav -> row click -> workspace -> breadcrumb -> /projects navigated entirely via clicks, zero URL editing.**

## Performance

- **Duration:** ~10 min (wall clock)
- **Started:** 2026-04-14T17:18:50Z
- **Tasks:** 1
- **Files created:** 1 (tests/projects-entry-point.spec.ts — 128 lines)
- **Commits:** 1

## Accomplishments

- **End-to-end regression guard authored**: `tests/projects-entry-point.spec.ts` encodes the full NAV-01 cold-start journey (six click steps plus two URL assertions) and passes under the existing `pnpm test:e2e` harness in ~3 seconds per run.
- **Forward path verified**: login -> nav-rail Projects -> /projects panel -> row click -> /project/{slug} workspace with breadcrumb visible.
- **Back path verified**: workspace breadcrumb 'Projects' button -> /projects (NOT /, which was the pre-Plan-08-02 behavior — defensive `not.toHaveURL(/^http[s]?:\/\/[^/]+\/$/)` assertion guards against regression).
- **Role-based selectors throughout**: every click and assertion uses `getByRole(...)` with name regex, not CSS or text-only matching. The breadcrumb's `aria-label="Breadcrumb"` and ProjectsPanel row's `aria-label={project.name}` were chosen precisely for this use-case in Plans 08-01 and 08-02 — this spec exercises that contract.
- **Fixture discipline**: `beforeAll` creates a project via `POST /api/projects` with deterministic slug `e2e-phase-8`; `afterAll` deletes it via `DELETE /api/projects/{id}?mode=delete` (admin-only hard delete — confirmed present during plan research). No orphaned rows, no reliance on the pre-seeded 'general' project.

## Task Commits

1. `3e73c24` — `test(08-03): add e2e spec for NAV-01 cold-start journey`

## Files Created

- `tests/projects-entry-point.spec.ts` — **created** — 128 lines. Single `test.describe` + single `test`, one `beforeAll` fixture + one `afterAll` cleanup. Imports only `@playwright/test` and `./helpers.API_KEY_HEADER`.

## Deviations from Plan

**Auth strategy change — session-cookie POST instead of form fill (Rule 3 — auto-fix blocking issue).**

Plan suggested: "If no browser-driving spec exists yet, perform the login inline" with a form-fill helper. Implemented that first; it hit a hydration race — the browser occasionally submitted the form natively (`GET /login?` with no query string because form inputs lack `name` attributes) before React attached the `preventDefault` handler. Verified via trace inspection of `1-trace.network` — the POST to `/api/auth/login` never occurred on failing runs; instead a GET to `/login?` appeared, confirming native submit. 

Switched to `page.request.post('/api/auth/login', ...)` which plants the `mc-session` cookie on the context's cookie jar directly. The cookie is set `secure: false` for HTTP requests in this codebase (`src/lib/session-cookie.ts` honors `isRequestSecure(request)` for 127.0.0.1:3005). Subsequent `page.goto('/')` authenticates cleanly.

Rationale for the change being within scope: the spec's subject under test is the **journey after login**, not the login form itself — `tests/login-flow.spec.ts` already covers the form path comprehensively. API login is equally truthful for the NAV-01 contract (user has a session; starting navigation happens at `/`).

**Onboarding wizard suppression (Rule 2 — auto-add missing critical functionality).**

Plan did not mention the OnboardingWizard. Empirically, `src/app/[[...panel]]/page.tsx:414` hides `<NavRail />` behind `{!showOnboarding && <NavRail />}`. For a fresh admin session, `data?.showOnboarding === true` in `/api/onboarding` → wizard renders → no nav-rail → spec cannot click Projects. Added a one-line `context.addInitScript` that sets the exact sessionStorage key (`mc-onboarding-dismissed=1`) that `src/lib/onboarding-session.ts:readOnboardingDismissedThisSession` reads. Gives the page the state a returning-admin session has.

Not a functional change — reflects the real user journey (admins dismiss onboarding on their second visit; we pre-seed that state so the test exercises the representative path).

## Issues Encountered

**Stale standalone build (pre-existing, out-of-scope but load-bearing for e2e).** First test run failed with CSP/MIME errors in the browser: `_next/static/chunks/*.js` were served as `text/html` (404 fallthrough). Root cause: `.next/standalone/.next/static/` did not exist because the last `pnpm build` ran before the Phase 8 UI work landed, and Next.js standalone mode requires `.next/static/` to be manually copied into `.next/standalone/.next/static/` post-build.

Resolved by running `pnpm build` and copying `.next/static → .next/standalone/.next/static` + refreshing `.next/standalone/public/`. This is infrastructure housekeeping, not test code — the spec is green on the rebuilt bundle. Future CI should automate the static/public copy (out of scope for this plan; e2e harness convention).

Logged in `deferred-items.md` candidate: `scripts/e2e-openclaw/start-e2e-server.mjs` could optionally run `cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public` on boot. Not a Phase 8 blocker — the e2e suite has been passing via other means pre-Phase-8.

## Verification

- `pnpm test:e2e -- projects-entry-point` — **1 passed** (2.9s test, 5.0s total)
- `pnpm typecheck` — exit 0
- `grep -c '\.skip' tests/projects-entry-point.spec.ts` — 0 (no skips, no escape hatches)
- `grep -c 'waitForURL|/projects|/project/|breadcrumb|toHaveURL|mode=delete' tests/projects-entry-point.spec.ts` — 25 (all plan-required substrings present)

## User Setup Required

None — the E2E harness auto-starts the server via `playwright.config.ts` `webServer` block. If running locally for the first time after pulling Phase 8, a one-time `pnpm build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public` is needed to refresh the standalone bundle with Plan 08-01/02 UI changes (this is the usual standalone-build workflow, not Phase-8-specific).

## Next Plan Readiness

Phase 8 verification is now hard-gated: any regression of the NAV-01 journey will fail this spec. No further plans in Phase 8 depend on this output.

## Known Stubs

None — spec exercises real components via real HTTP, real DB writes/reads, real router pushes. No mocks, no test-only flags.

## Self-Check

Verifying claims before closing out:

- File `tests/projects-entry-point.spec.ts` — FOUND
- Commit `3e73c24` — FOUND (`git log --oneline` shows `3e73c24 test(08-03): add e2e spec for NAV-01 cold-start journey`)
- `pnpm test:e2e -- projects-entry-point` — exit 0 (1 passing)
- `pnpm typecheck` — exit 0
- `grep -c '\.skip' tests/projects-entry-point.spec.ts` — 0
- `grep -c 'waitForURL' tests/projects-entry-point.spec.ts` — 3 matches (required: >=1)
- `grep -c '/projects' tests/projects-entry-point.spec.ts` — present
- `grep -c '/project/' tests/projects-entry-point.spec.ts` — present
- `grep -i breadcrumb tests/projects-entry-point.spec.ts` — present in both getByRole selectors
- `grep toHaveURL tests/projects-entry-point.spec.ts` — 4 matches (required: >=1)
- `grep mode=delete tests/projects-entry-point.spec.ts` — 1 match in afterAll

## Self-Check: PASSED

---
*Phase: 08-projects-entry-point*
*Completed: 2026-04-14*
