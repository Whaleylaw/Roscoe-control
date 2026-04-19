---
phase: 11-runtime-foundation-v1-2
plan: 02
subsystem: auth
tags: [auth, runner, secret, bearer, principal, v1.2, runtime, rauth-01]

requires:
  - phase: 11-runtime-foundation-v1-2
    plan: 01
    provides: Phase 11 planning scaffolding (CONTEXT.md constraints for runner principal)
  - lib: auto-credentials
    provides: pattern for auto-generated credential persistence (AUTH_SECRET / API_KEY) that runner-secret mirrors
  - lib: security-events
    provides: logSecurityEvent shape for structured audit logging
provides:
  - runner-secret module (src/lib/runner-secret.ts) — ensureRunnerSecret, getRunnerSecret, RUNNER_SECRET_FILENAME
  - .data/runner.secret auto-generation on first boot with 0600 perms and 32 bytes of entropy
  - runner principal branch in getUserFromRequest (auth.ts) strictly scoped to /api/runner/*
  - synthetic runner User shape — id=-1000, username='runner', role='operator'
  - runner_auth security event emission (principal/path/method only; never the secret)
affects: [11-04 runner-token principal, 14 runner-daemon, 15 checkpoint-api]

tech-stack:
  added: []
  patterns:
    - "Auto-generated credential pattern mirrored from auto-credentials.ts: randomBytes + 0600 persistence + NEXT_PHASE build-phase guard"
    - "Single-value secret file (.data/runner.secret) with rmSync+writeFileSync sequence to guarantee 0600 on regeneration even if a stale broader-perm file exists"
    - "base64url encoding for bearer-token wire format (43 chars, URL-safe for Authorization: Bearer)"
    - "Path-prefix gating in auth resolver — url.pathname.startsWith('/api/runner/') is the sole and mandatory check for runner principal"
    - "Fall-through semantics on wrong/absent bearer — path scope does not short-circuit session cookie / runner-token / agent-key branches"
    - "Audit-safe logging: JSON.stringify({principal, path, method}) — no secret value, no prefix, no hash fingerprint"

key-files:
  created:
    - src/lib/runner-secret.ts
    - src/lib/__tests__/runner-secret.test.ts
    - src/lib/__tests__/auth-runner-principal.test.ts
  modified:
    - src/lib/auth.ts
    - src/lib/db.ts
    - src/lib/__tests__/db-sqlite-busy.test.ts

key-decisions:
  - "Runner branch placed inside getUserFromRequest AFTER proxy-auth but BEFORE session-cookie — path-prefix gate runs first for /api/runner/*, everything else is unchanged"
  - "id = -1000 for the runner principal — outside both the 1..N user range and the -agent_id range used by agent-scoped API keys; Phase 14 claim-route code must treat -1000 as the runner sentinel"
  - "role = 'operator' (not admin) — runner needs write access to checkpoints/claim but is not a superuser; matches RAUTH-01 principle of least privilege"
  - "Wrong/absent bearer on /api/runner/* falls through to the subsequent auth branches (session cookie, runner-token 11-04, agent API keys) rather than short-circuiting — this lets operators hit runner endpoints with their session and lets Plan 11-04's runner-token principal resolve adjacent to this branch"
  - "getRunnerSecret returns null on empty/truncated files (< 32 decoded bytes) — treats operator tampering as 'no secret' rather than 'weak secret', forcing next boot to regenerate"
  - "Defensive fallback in ensureRunnerSecret when config.dataDir is unset (test mocks that stub config with only dbPath) — return empty string rather than crash, matching the build-phase escape hatch"

patterns-established:
  - "Auto-generated per-principal secrets live in <dataDir>/<name>.secret with 0600 perms (peer to AUTH_SECRET / API_KEY in .data/.auto-generated)"
  - "Path-scoped principals in getUserFromRequest use early pathname gating + fall-through rather than short-circuit — keeps multiple auth mechanisms composable on the same path"
  - "extractApiKeyFromHeaders is the shared bearer extractor — reuse in 11-04 for runner-tokens; do not fork a second extraction helper"

requirements-completed:
  - RAUTH-01

duration: 10min
completed: 2026-04-19
---

# Phase 11 Plan 02: Runner Principal + Auto-generated Secret Summary

**Introduces the runner auth principal — a long-lived bearer identity for the Phase 14 runner daemon, backed by an auto-generated `.data/runner.secret` file, strictly path-scoped to `/api/runner/*`. Ships the lock without opening it: no endpoint consumes the principal yet (that's Phase 14/15).**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-19T01:47:43Z
- **Completed:** 2026-04-19T01:57:37Z
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 3

## Accomplishments

- **Auto-generated runner secret.** `.data/runner.secret` materialises on first boot with mode `0600` and 32 bytes of entropy (base64url encoded → 43 chars). UX matches AUTH_SECRET / API_KEY — operator does nothing.
- **Idempotent re-boot.** If a valid secret already exists, `ensureRunnerSecret()` is a no-op (no file write, no log line).
- **Rotation via delete-and-regenerate.** `rm .data/runner.secret && restart` produces a fresh secret with 0600 perms. No dual-secret window, no versioning — locked by CONTEXT.md.
- **Strict path scope.** The runner bearer authenticates as `runner` ONLY on paths matching `url.pathname.startsWith('/api/runner/')`. The same bearer on `/api/tasks`, `/api/users`, or any other path returns null — the path-prefix gate is the only check that ever compares the bearer against the runner secret.
- **Audit-safe logging.** Successful runner auth emits one `runner_auth` security event with `{principal: 'runner', path, method}`. The secret value, a prefix, and a hash fingerprint are all absent from the event.
- **Zero regressions.** Existing `auth.test.ts` (13 tests) and all 1668 other passing tests remain green.

## Task Commits

1. **Task 1: Create runner-secret module with auto-gen + 0600 persistence** — `f95b72e` (feat)
2. **Task 2: Wire runner principal into auth.ts with strict /api/runner/* path check** — `94b3ff2` (feat)

## Files Created/Modified

### Created

- **`src/lib/runner-secret.ts`** — 95 lines. Exports `ensureRunnerSecret()`, `getRunnerSecret()`, `RUNNER_SECRET_FILENAME`. Mirrors the auto-credentials.ts pattern: `randomBytes(32).toString('base64url')`, `writeFileSync` with `mode: 0o600`, preceded by `rmSync` to guarantee 0600 on regeneration even when a stale broader-perm file exists.
- **`src/lib/__tests__/runner-secret.test.ts`** — 141 lines. 11 tests covering auto-gen creates 0600 file, idempotency, entropy floor, stale-perm regeneration, secret never logged, read-returns-null for missing/empty/short files.
- **`src/lib/__tests__/auth-runner-principal.test.ts`** — 217 lines. 11 tests covering path-scope enforcement (accepts /api/runner/*, rejects /api/tasks, /api/users, /api/runnerclown/*), wrong/absent bearer, missing secret file, and audit-log payload safety.

### Modified

- **`src/lib/auth.ts`** — +54 lines. One new import (`getRunnerSecret` from `./runner-secret`) and one new branch inside `getUserFromRequest` at **lines 460–513**, placed after proxy-auth and before session-cookie. Minimal diff: no other auth paths touched.
- **`src/lib/db.ts`** — +4 lines. Import `ensureRunnerSecret` and call it immediately after `ensureAutoGeneratedCredentials()` in `getDatabase()`. Runner is a peer to AUTH_SECRET / API_KEY on the boot sequence.
- **`src/lib/__tests__/db-sqlite-busy.test.ts`** — +1 line. Added `vi.mock('@/lib/runner-secret', ...)` stub alongside the existing `auto-credentials` mock so the sqlite-busy tests don't trip the real runner-secret filesystem path.

## Runner Principal Shape (for downstream plans)

Plan 11-04 and Phase 14 claim-route code must treat this shape as the contract:

| Field | Value | Notes |
| ----- | ----- | ----- |
| `id` | `-1000` | Sentinel — outside `1..N` user range AND outside `-agent_id` (agent API key) range |
| `username` | `'runner'` | Exact string — used for attribution filters |
| `display_name` | `'Runner Daemon'` | UI label |
| `role` | `'operator'` | Write access, NOT admin |
| `workspace_id` | `getDefaultWorkspaceContext().workspaceId` | Resolved at request time |
| `tenant_id` | `getDefaultWorkspaceContext().tenantId` | Resolved at request time |
| `provider` | `'local'` | |
| `email` | `null` | |
| `avatar_url` | `null` | |
| `is_approved` | `1` | |
| `created_at` / `updated_at` | `0` | Synthetic — never persisted |
| `last_login_at` | `null` | |
| `agent_name` | `null` | Runner is not an agent |

## Location of the Runner Branch in auth.ts

**`src/lib/auth.ts` lines 460–513** — the runner-principal check sits between the proxy-auth block (`~433–457`) and the session-cookie block (`~516–520`). Plan 11-04 will insert the `runner-token` principal branch **adjacent to** this one (recommended placement: immediately after the runner-secret branch, before session-cookie, so `/api/runner/*` paths can fall through from secret → token → session in that order).

## Shared Helper for Plan 11-04

**Reuse `extractApiKeyFromHeaders` from `auth.ts`** (already exported inside the module) — do NOT fork a second bearer-extraction helper. Plan 11-04's runner-token check should call the same function; both runner-secret and runner-token bearers live in `Authorization: Bearer <value>` / `X-API-Key: <value>` / `ApiKey`/`Token` scheme, which `extractApiKeyFromHeaders` already normalises.

## Decisions Made

- **Runner branch placement (AFTER proxy-auth, BEFORE session-cookie).** The path-prefix gate runs early for `/api/runner/*` so the runner secret gets first say on those paths. Falls through on mismatch — session cookies and (future) runner-tokens still work on runner paths.
- **`id = -1000` sentinel.** Agent-scoped API keys use `id = -agent_id`; realistic agent IDs are in the low hundreds at most. `-1000` is safely outside both ranges AND outside the `1..N` real-user range. Phase 14 can `if (user.id === -1000)` dispatch on runner identity without string-comparing `username`.
- **`role = 'operator'` not `'admin'`.** RAUTH-01 principle of least privilege — runner needs write access to checkpoint and claim endpoints (Phase 14/15) but must not be able to manage users, modify settings, or hit admin-only paths. Operator is exactly enough.
- **Fall-through on wrong/absent bearer at `/api/runner/*`.** Rather than short-circuiting with 401, the gate lets the request continue through session-cookie / agent-key / (Plan 11-04) runner-token branches. This lets a human operator hit `/api/runner/*` endpoints from their browser session for debugging without juggling bearers, and lets Plan 11-04's runner-token principal resolve on the same path without a second pass.
- **Entropy floor of 32 bytes in `getRunnerSecret`.** If the operator truncates the file (e.g. `> .data/runner.secret`) or leaves it empty, we treat it as "no secret" and return null. The next boot regenerates. Guards against degraded security from filesystem tampering.
- **Path resolution inside the `getRunnerSecret` try/catch.** The path is resolved inside the catch block rather than outside, because `config.dataDir` can be undefined in certain vitest mocks that stub `@/lib/config` with only `dbPath`. We treat "config missing" as "no secret" — same semantics as "file missing" — rather than crashing the entire auth path. Matches the defensive posture in `auto-credentials.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added runner-secret mock to `db-sqlite-busy.test.ts`**
- **Found during:** Task 1 post-wiring verification (`pnpm test -- runner-secret` ran the full suite)
- **Issue:** Adding `ensureRunnerSecret()` to `getDatabase()` boot path caused `db-sqlite-busy.test.ts` to fail with `TypeError: The "path" argument must be of type string. Received undefined`. That test mocks `@/lib/config` with only `{ dbPath: ':memory:' }` — no `dataDir` — so my `path.join(config.dataDir, 'runner.secret')` blew up.
- **Fix:** Added `vi.mock('@/lib/runner-secret', () => ({ ensureRunnerSecret: vi.fn(() => 'test-runner-secret'), getRunnerSecret: vi.fn(() => null), RUNNER_SECRET_FILENAME: '.data/runner.secret' }))` alongside the existing `auto-credentials` mock. One-line change.
- **Files modified:** src/lib/__tests__/db-sqlite-busy.test.ts
- **Committed in:** f95b72e (Task 1)

**2. [Rule 1 - Bug] Defensive path resolution in `getRunnerSecret`**
- **Found during:** Task 1 post-wiring verification (multiple db-helpers tests crashed similarly)
- **Issue:** `db-helpers.test.ts` uses the same incomplete config mock (`{ dbPath: ':memory:' }`) but does NOT mock runner-secret. Without defensive handling, any test file that goes through `getDatabase()` → `ensureRunnerSecret()` → `getRunnerSecret()` would crash at `path.join(undefined, ...)`. Retrofitting mocks into every affected test file was out of proportion to the fix.
- **Fix:** Moved `getRunnerSecretPath()` invocation inside the try/catch in `getRunnerSecret()`, and added `if (!config.dataDir) return ''` early-return in `ensureRunnerSecret()`. Both treat "config missing" as "no secret available" — same semantics as "file missing". This matches the defensive posture used in `auto-credentials.ts` (its `readPersisted()` catches path errors too).
- **Files modified:** src/lib/runner-secret.ts
- **Verification:** Full `pnpm test` run after fix: 1668 passed, 0 failed. No mock changes needed in any other test file.
- **Committed in:** f95b72e (Task 1)

---

**Total deviations:** 2 auto-fixed (Rule 3 blocking + Rule 1 bug). Both stemmed from the same root cause — test fixtures that predate the runner-secret module stubbed `config` narrowly. Functionality matches plan intent exactly; the module is more defensive than the plan spec, which is strictly safer.

## Authentication Gates Encountered

None. Both tasks executed without needing user-provided credentials.

## Issues Encountered

- **Pre-existing `migrations-v12-runtime.test.ts` intermittent failure** observed during one full-suite run (not reproducible in isolation). From Plan 11-03, not this plan. Verified NOT caused by this plan's changes via `git stash && pnpm test -- migrations-v12-runtime` on the pre-change tree. Logged to existing `deferred-items.md` territory — not acted on.
- **Pre-existing lint warnings (76, all `react-hooks/exhaustive-deps`)** unchanged by this plan. Deferred per scope rules.
- **Pre-existing typecheck error in `src/lib/validation.ts:58`** did NOT surface during this plan's typecheck runs — appears cleaner in the current tree than reported in Plan 11-03's summary. Not touched.

## Verification Results

- `pnpm test src/lib/__tests__/runner-secret.test.ts` → **11/11 pass**
- `pnpm test src/lib/__tests__/auth-runner-principal.test.ts` → **11/11 pass**
- `pnpm test src/lib/__tests__/auth.test.ts` (regression check) → **13/13 pass**
- `pnpm test --run` (full suite) → **1668 passed, 0 failed, 44 todo, 4 skipped test files**
- `pnpm typecheck` → **clean (0 errors)**
- `pnpm lint` → **0 errors, 76 pre-existing warnings**
- `grep -rn 'runner.secret\|runner_auth\|getRunnerSecret' src/` → 6 files, all expected (runner-secret.ts, auth.ts, db.ts + 3 test files)

## Self-Check: PASSED

Verified files and commits exist:
- FOUND: src/lib/runner-secret.ts
- FOUND: src/lib/__tests__/runner-secret.test.ts
- FOUND: src/lib/__tests__/auth-runner-principal.test.ts
- FOUND: src/lib/auth.ts (modified, runner branch at lines 460–513)
- FOUND: src/lib/db.ts (modified, ensureRunnerSecret wired into boot)
- FOUND: src/lib/__tests__/db-sqlite-busy.test.ts (modified, runner-secret mock added)
- FOUND: commit f95b72e (Task 1)
- FOUND: commit 94b3ff2 (Task 2)

## Next Phase Readiness

- **Plan 11-04 (runner-token principal)** can now land adjacent to the runner-secret branch in `getUserFromRequest`. Reuse `extractApiKeyFromHeaders`. Path scope and fall-through semantics are already established — follow the same pattern for `/api/runner/tasks/:id/*` with DB-backed token lookup against `task_runner_tokens` (Plan 11-03).
- **Phase 14 (runner daemon)** can now authenticate against MC. First request: `curl -H "Authorization: Bearer $(cat .data/runner.secret)" http://localhost:3000/api/runner/ready-tasks` — will 404 (route doesn't exist yet) but will NOT 401. Claim-route code must dispatch on `user.id === -1000` to distinguish runner from an operator session.
- **Phase 15 (checkpoint API)** can assume the runner principal is well-defined. Operator-level scope is enough for checkpoint writes; no additional role check needed beyond `requireRole(request, 'operator')`.

No blockers. RAUTH-01 substrate is complete.

---
*Phase: 11-runtime-foundation-v1-2*
*Completed: 2026-04-19*
