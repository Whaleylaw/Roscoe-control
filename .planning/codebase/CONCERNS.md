# Codebase Concerns

**Analysis Date:** 2026-04-13

## Tech Debt

**Massive Panel Components:**
- Issue: Several UI panel components have grown to 2,000–3,000 lines, mixing data-fetching, state management, and rendering with no sub-component extraction.
- Files: `src/components/panels/agent-detail-tabs.tsx` (2,951 lines), `src/components/panels/task-board-panel.tsx` (2,527 lines), `src/components/panels/office-panel.tsx` (2,411 lines), `src/components/panels/cron-management-panel.tsx` (1,626 lines)
- Impact: Extremely hard to navigate, test, or incrementally change. Any edit risks regressions in unrelated sections. No component tests exist for panels.
- Fix approach: Extract distinct sub-components (columns, cards, modals, forms) into separate files. Each sub-component should manage its own fetch or receive data via props.

**Phase-Suffixed Zombie File:**
- Issue: `src/components/panels/agent-squad-panel-phase3.tsx` (1,222 lines) is an evolutionary "phase3" replacement that is actively used in production. The original `agent-squad-panel.tsx` still exists alongside it with no indication which is canonical.
- Files: `src/components/panels/agent-squad-panel-phase3.tsx`, `src/components/panels/agent-squad-panel.tsx`
- Impact: Confusion about which implementation is current. The phase naming implies a third iteration exists while two and three both ship.
- Fix approach: Rename phase3 to `agent-squad-panel.tsx` (removing the legacy file) once confirmed as canonical. Remove phase naming convention from all future work.

**Pervasive `as any` / `: any` Type Casts:**
- Issue: 699+ instances of `any` usage across `src/` (375 in `src/app/api`, 161 in `src/lib`). Many appear as DB query results cast with `as any` instead of typed row interfaces.
- Files: Concentrated in `src/app/api/tasks/route.ts`, `src/app/api/chat/messages/route.ts`, `src/app/api/tasks/queue/route.ts`, `src/app/api/tasks/[id]/*.ts`
- Impact: TypeScript provides no type safety for SQLite query results; bugs from shape mismatches silently reach production.
- Fix approach: Define typed interfaces for each DB row shape (e.g., `TaskRow`, `AgentRow`) and cast query results to those interfaces. Do not cast to `any` for DB returns.

**Monolithic Zustand Store:**
- Issue: `src/store/index.ts` is 1,192 lines and contains every piece of client state (sessions, agents, logs, chat messages, notifications, cron jobs, spawn requests, etc.) in a single store slice.
- Files: `src/store/index.ts`
- Impact: Any state change triggers broad selector re-renders. Difficult to add new slices without risking merge conflicts. No selector memoization visible.
- Fix approach: Split into domain slices (agents, tasks, chat, sessions, notifications) using Zustand's `combine` or separate `create` calls, then compose in a root store.

**Migrations File Without Rollback:**
- Issue: `src/lib/migrations.ts` is 1,441 lines and contains 215+ DDL statements with no `down` (rollback) path for any migration. Only forward migrations exist.
- Files: `src/lib/migrations.ts`
- Impact: Any bad migration must be manually corrected via raw SQL. Recovery from failed deploys is manual and risky.
- Fix approach: Add a `down` function to the `Migration` type and implement rollback DDL for new migrations going forward.

**Dynamic `require()` Inside Route Handlers:**
- Issue: Multiple API routes and lib files use `require('node:child_process')` and `require('node:fs')` inside function bodies instead of top-level imports. This defeats static analysis and tree-shaking.
- Files: `src/app/api/gateways/control/route.ts` (line 55), `src/lib/agent-runtimes.ts` (lines 104, 119, 144, 159, 195), `src/app/api/agents/route.ts` (line 266), `src/lib/tailscale-serve.ts` (line 10)
- Impact: Bundler cannot statically resolve dependencies. Pattern inconsistency makes auditing harder.
- Fix approach: Move all `require()` calls to top-level `import` statements. These are server-only routes and lib files so there is no browser concern.

**Input Validation Coverage Is Incomplete:**
- Issue: Only 23 of 151 API route files use `validateBody`/`safeParse` schema validation. The remaining ~128 routes parse body fields manually via ad-hoc `typeof body.field === 'string'` checks with no schema enforcement.
- Files: Affects the majority of routes under `src/app/api/`
- Impact: Invalid or oversized inputs may reach the database or child processes. Pagination parameters like `limit` and `offset` are parsed directly with `parseInt()` without an upper bound clamp in many routes.
- Fix approach: Adopt Zod schema validation consistently. At minimum add `Math.min(parsed, MAX)` guards on all user-supplied numeric query params.

**No-History Pagination for Limits in v1 Routes:**
- Issue: `src/app/api/v1/runs/route.ts` and `src/app/api/v1/evals/leaderboard/route.ts` accept a `limit` query param via `parseInt()` with no upper bound.
- Files: `src/app/api/v1/runs/route.ts` (lines 24–25), `src/app/api/v1/evals/leaderboard/route.ts` (line 21)
- Impact: A caller requesting `limit=9999999` could cause an unbounded DB scan.
- Fix approach: Clamp: `const safeLimit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 500)`.

---

## Security Considerations

**`execSync` with Shell Interpolation in Security Scan:**
- Risk: `src/lib/security-scan.ts` uses `execSync(cmd, ...)` where `cmd` is a composed shell string (not `execFileSync` with argument arrays). Although scan commands use hardcoded literals today, the pattern allows future callers to pass user-influenced strings.
- Files: `src/lib/security-scan.ts` (line 127)
- Current mitigation: Comment claims all calls use hardcoded literals.
- Recommendations: Replace `execSync(cmd)` with `execFileSync(binary, args[])` for all cases, even internal ones, to eliminate the shell-injection class entirely.

**Rate Limiting Not Applied to ~128 API Routes:**
- Risk: Most of the 151 API routes (only 40 import from `@/lib/rate-limit`) lack rate limiting. Unauthenticated callers or compromised API keys can hammer expensive endpoints.
- Files: Majority of files under `src/app/api/`
- Current mitigation: `MC_DISABLE_RATE_LIMIT` env flag, login endpoint is `critical`-flagged.
- Recommendations: Add `readLimiter` or `mutationLimiter` to all routes; at minimum to all agent-facing and mutation endpoints.

**In-Memory Rate Limit Store Does Not Survive Restart:**
- Risk: The rate limiter (`src/lib/rate-limit.ts`) uses a `Map` in module scope. On process restart (hot reload, crash, deploy) all throttle counters reset to zero, making sustained burst attacks feasible across restarts.
- Files: `src/lib/rate-limit.ts`
- Current mitigation: Map evicts oldest entry at 10,000 entries max.
- Recommendations: For production hardening, back the rate limit store with a persistent or shared store (Redis/SQLite) or at least document this limitation prominently.

**`dangerouslySetInnerHTML` with Inline Script:**
- Risk: `src/app/layout.tsx` uses `dangerouslySetInnerHTML` to inject a theme detection script. The script content is a hardcoded string literal today, but XSS is one interpolated variable away.
- Files: `src/app/layout.tsx` (line 102–103)
- Current mitigation: The string is fully hardcoded; no user data is interpolated.
- Recommendations: Enforce via ESLint rule or code review that no variable interpolation is ever added to this `__html` block.

**Private Key Material in localStorage:**
- Risk: `src/lib/device-identity.ts` stores the device private key (`STORAGE_PRIVKEY`) in `localStorage`. In a shared-browser or XSS scenario this private key is accessible to any script on the origin.
- Files: `src/lib/device-identity.ts` (lines 76–78, 95–96)
- Current mitigation: Used only for gateway signature, not for user auth session.
- Recommendations: Migrate to `indexedDB` with the `CryptoKey` non-extractable flag so the private key cannot be read by JavaScript after generation.

**Hardcoded Fallback Workspace/Tenant IDs:**
- Risk: Throughout the codebase, `auth.user.workspace_id ?? 1` and `auth.user.tenant_id ?? 1` mean a user with a `null` workspace gets silently assigned to workspace 1. This is a latent multi-tenancy data-boundary issue.
- Files: Pattern found in 209+ locations; representative examples: `src/app/api/v1/runs/route.ts`, `src/app/api/tasks/route.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/projects/route.ts`
- Current mitigation: Single-tenant deployments (the common case) are unaffected.
- Recommendations: If multi-tenancy is ever enabled, replace all `?? 1` fallbacks with an explicit auth check that rejects requests with no workspace affiliation.

---

## Performance Bottlenecks

**No Database Query Caching:**
- Problem: All database reads in route handlers re-execute raw SQLite queries on every request. Frequently read data (agent list, settings, token summaries) has no in-process cache.
- Files: `src/lib/db.ts`, `src/app/api/agents/route.ts`, `src/app/api/tokens/route.ts`, `src/app/api/settings/route.ts`
- Cause: No query-layer cache; WAL mode mitigates write contention but not read load.
- Improvement path: Add short-TTL in-memory caches (Map + expiry) for hot read paths (agent list, settings). The `execCache` pattern in `src/lib/security-scan.ts` (lines 133–140) is a working example.

**Multiple Polling Intervals in Components:**
- Problem: Components open independent `setInterval` polling loops against the API (every 10s in `agent-squad-panel.tsx`, plus intervals in `settings/agent-runtimes-section.tsx`, `layout/update-banner.tsx`). Under the same session, these stack with WebSocket traffic.
- Files: `src/components/panels/agent-squad-panel.tsx` (line 82), `src/components/settings/agent-runtimes-section.tsx` (line 61), `src/components/layout/update-banner.tsx` (line 41)
- Cause: Components fetch independently rather than subscribing to the centralized WebSocket event bus.
- Improvement path: Route state updates through the global WebSocket event bus and Zustand store so panels subscribe rather than poll.

**Multiple Stacked `setTimeout` for Transcript Refresh:**
- Problem: After a message send in `src/components/chat/chat-workspace.tsx`, three stacked `setTimeout` calls fire at 1s, 3s, and 8s to refresh the transcript. This creates redundant API calls.
- Files: `src/components/chat/chat-workspace.tsx` (lines 703–705, 728, 755–756)
- Cause: Workaround for WebSocket event delivery uncertainty.
- Improvement path: Replace with a single retry after WebSocket `chat.message` event is confirmed, with exponential backoff.

---

## Fragile Areas

**Single SQLite Database File for All Workloads:**
- Files: `src/lib/db.ts`, `.data/mission-control.db`
- Why fragile: A single WAL-mode SQLite file serves all reads and writes. Under high concurrent write load (many agents heartbeating, logging, updating tasks simultaneously) `SQLITE_BUSY` errors can still occur despite the 5s `busy_timeout`. No connection pooling is possible with `better-sqlite3`.
- Safe modification: Keep writes short and transactional. Do not run long-running SELECT queries inside transactions.
- Test coverage: No load/concurrency tests exist.

**WebSocket Module-Level Singleton with Many Mutable Refs:**
- Files: `src/lib/websocket.ts` (lines 55–74)
- Why fragile: The WebSocket connection is managed via 15+ module-level mutable ref objects outside any React lifecycle. Multiple `useWebSocket()` hook mounts share this global state. Hot-reload or concurrent hook mounts can leave stale state.
- Safe modification: Treat the WebSocket hook as a singleton by gating mount side-effects on a `mounted` flag. Do not add new module-level refs; use the existing `wsRef` family.
- Test coverage: `src/lib/__tests__/websocket-utils.test.ts` covers URL utilities only; the connection lifecycle is untested.

**Migration Runner Has No Idempotency Check Per Statement:**
- Files: `src/lib/migrations.ts` (line 24)
- Why fragile: The initial migration (`001_init`) splits `schema.sql` on `;` and executes each statement. If `schema.sql` contains a statement that fails partway through, the migration version is not recorded and the next startup retries the whole migration, potentially double-applying DDL.
- Safe modification: Always use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` in `schema.sql`. Do not use bare `CREATE TABLE`.
- Test coverage: No migration tests.

**`src/app/api/chat/messages/route.ts` Is 1,000+ Lines of Business Logic:**
- Files: `src/app/api/chat/messages/route.ts`
- Why fragile: This single route file handles message sending, agent dispatch, session management, file attachment processing, mention parsing, and token tracking. Changes to any one concern risk breaking others. `as any` casts appear throughout DB result access.
- Safe modification: Treat each top-level section as independent; extract into lib helpers before modifying.
- Test coverage: No route-level tests for this file.

---

## Scaling Limits

**SQLite as the Sole Persistent Store:**
- Current capacity: Suitable for single-node deployments with moderate write throughput (~100 writes/sec).
- Limit: Cannot be shared across multiple Next.js processes or containers. Horizontal scaling requires a different database.
- Scaling path: The `getDatabase()` singleton pattern in `src/lib/db.ts` abstracts the connection; swapping to PostgreSQL (via `better-pg` or Drizzle) is the natural upgrade path but is a large migration effort.

**In-Memory Rate Limit and Event Bus:**
- Current capacity: Rate limit store handles up to 10,000 IP entries per limiter instance; event bus is in-process only.
- Limit: Multi-process or clustered deployments would have per-process rate limit counters and no cross-process event delivery.
- Scaling path: Replace `Map`-based rate limiter with Redis (or a DB-backed counter) and the event bus with a pub/sub mechanism (Redis, or SSE fan-out) for multi-instance deployment.

---

## Dependencies at Risk

**`better-sqlite3` Native Addon:**
- Risk: Requires recompile when switching Node.js versions (explicitly noted in `CLAUDE.md`). This is a frequent pain point in CI and Docker builds.
- Impact: Build failures if the Node version in the container or CI environment drifts from what the addon was compiled against.
- Migration plan: Pin Node version strictly via `.nvmrc` / `engines` field; consider `@libsql/client` (pure JS) as a long-term alternative if native addon friction grows.

---

## Test Coverage Gaps

**Zero Tests for UI Components:**
- What's not tested: All 41 panel components (`src/components/panels/`) and all shared UI components (`src/components/ui/`) have zero test files.
- Files: Entire `src/components/` tree
- Risk: Regressions in core UI (agent list, task board, chat, settings) go undetected until manual QA.
- Priority: High

**No API Route Integration Tests:**
- What's not tested: Of 151 API routes, unit/integration tests exist only for a small subset (gateway health utils, agents delete, auth). Core routes like chat messages, tasks, sessions, and agent heartbeat lack tests.
- Files: `src/app/api/chat/messages/route.ts`, `src/app/api/tasks/route.ts`, `src/app/api/agents/[id]/heartbeat/route.ts`, `src/app/api/sessions/` directory
- Risk: Breaking changes to DB schema, auth logic, or response shapes go undetected.
- Priority: High

**No Migration Tests:**
- What's not tested: `src/lib/migrations.ts` migrations run against a live DB at startup; there are no tests that apply migrations to an empty DB and verify the resulting schema.
- Files: `src/lib/migrations.ts`
- Risk: A bad migration silently corrupts the DB schema on upgrade.
- Priority: High

**No WebSocket Lifecycle Tests:**
- What's not tested: The full connection, reconnect, heartbeat, and error-handling lifecycle in `src/lib/websocket.ts`.
- Files: `src/lib/websocket.ts`
- Risk: Reconnect regressions and missed-pong bugs go undetected.
- Priority: Medium

---

*Concerns audit: 2026-04-13*
