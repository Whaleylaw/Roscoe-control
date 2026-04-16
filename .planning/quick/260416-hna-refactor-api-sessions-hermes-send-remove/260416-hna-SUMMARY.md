---
quick_id: 260416-hna
type: quick
scope: refactor
status: complete
completed_at: "2026-04-16T16:48:00Z"
duration_min: 3
tasks_completed: 2
commits:
  - hash: d712cb8
    type: refactor
    subject: "refactor(api): type hermes send route and route default URL through config"
  - hash: 84f9f3b
    type: docs
    subject: "docs(api): explain inlined heartbeat and message insert in hermes send route"
files_modified:
  - src/app/api/sessions/hermes/send/route.ts
  - src/lib/config.ts
tech-stack:
  added:
    - "HERMES_API_URL env var (opt-in override, defaults preserve prior behavior)"
  patterns:
    - "Import renamed pattern: local const config → agentConfig to avoid shadowing imported config module"
    - "Message | undefined typing for better-sqlite3 .get() row reads"
    - "catch (error: unknown) + instanceof Error narrowing in API routes"
key-decisions:
  - "Kept inline heartbeat UPDATE (not db_helpers.updateAgentStatus) — helper broadcasts + logs activity on every call; would flood live feed per Hermes reply"
  - "Kept inline message INSERTs (not createChatReply) — that helper unconditionally broadcasts 'chat.message'; Hermes bridge deliberately suppresses user-message broadcast for optimistic-render flow"
  - "Added hermesApiUrl to config.ts rather than inline env read — matches gatewayHost/gatewayPort sibling pattern"
---

# Quick Task 260416-hna: Refactor Hermes Send Route Summary

Eliminated the three `any` escapes in the Hermes bridge route, moved the hardcoded `http://127.0.0.1:8642` default into `src/lib/config.ts` as `hermesApiUrl` (env-overridable via `HERMES_API_URL`), and documented the two intentional duplications (inline heartbeat UPDATE and inline message INSERTs) that audit had flagged — preserving the existing request/response contract, error codes, and per-agent override precedence byte-for-byte.

## Scope

- **Quick ID:** 260416-hna
- **Type:** Refactor (no behavior change)
- **Files modified:** 2
  - `src/app/api/sessions/hermes/send/route.ts`
  - `src/lib/config.ts`

## Tasks

### Task 1 — Type the route, add HERMES_API_URL to config, wire it as the default

**Commit:** `d712cb8` — `refactor(api): type hermes send route and route default URL through config`

Three mechanical changes to the route plus one addition to `config.ts`:

1. Imported `Message` from `@/lib/db` and `config` from `@/lib/config` at the top of the route file.
2. Replaced the hardcoded `let apiUrl = 'http://127.0.0.1:8642'` with `let apiUrl = config.hermesApiUrl`.
3. Renamed the local `const config = JSON.parse(agent.config)` to `const agentConfig = JSON.parse(agent.config)` (and updated the two `config.hermes*` reads below it) so the newly imported `config` module isn't shadowed.
4. Typed the two `.get(...) as any` row reads as `Message | undefined` — `better-sqlite3`'s `.get()` returns `undefined` when no row matches, and the existing `if (replyRow)` guard already narrows cleanly.
5. Changed `catch (error: any)` to `catch (error: unknown)` and replaced the `error?.message` access with `error instanceof Error ? error.message : 'Failed to send message to Hermes'`.

`src/lib/config.ts` gained one new field next to `gatewayPort`:

```ts
hermesApiUrl: process.env.HERMES_API_URL || 'http://127.0.0.1:8642',
```

**Verification:**
- `pnpm typecheck` → exit 0
- `grep -c ": any" src/app/api/sessions/hermes/send/route.ts` → 0 (was 1)
- `grep -c " as any" src/app/api/sessions/hermes/send/route.ts` → 0 (was 2)
- `grep -c "127.0.0.1:8642" src/app/api/sessions/hermes/send/route.ts` → 0 (was 1)
- `grep -c "127.0.0.1:8642" src/lib/config.ts` → 1 (the new default)
- Phase 10 vitest suite: 124 test files passed (1616 tests, 44 todo, 4 skipped files)

### Task 2 — Document the two intentional duplications so audit doesn't re-flag them

**Commit:** `84f9f3b` — `docs(api): explain inlined heartbeat and message insert in hermes send route`

Comment-only change. Two multi-line WHY comments added:

- **Above the user-message `INSERT INTO messages ...` block:** explains that the file-local `createChatReply()` in `src/app/api/chat/messages/route.ts` is not reusable here because it unconditionally broadcasts `chat.message`, which would cause a duplicate user-bubble flicker on top of the client's optimistic render.
- **Above the heartbeat `UPDATE agents SET status = 'active' ...`:** explains that `db_helpers.updateAgentStatus` is not a drop-in replacement because it also calls `eventBus.broadcast('agent.status_changed')` and `db_helpers.logActivity('agent_status_change', ...)` on every invocation — flooding the live feed on every Hermes reply. The comment names the three other raw-UPDATE presence call sites (`src/lib/scheduler.ts`, `src/app/api/status/route.ts`, `src/app/api/agents/register/route.ts`) so a future silent-presence helper can migrate all four together.

**Verification:**
- `pnpm typecheck` → exit 0
- `grep -c "Intentionally inlined" src/app/api/sessions/hermes/send/route.ts` → 1
- `grep -c "file-local createChatReply" src/app/api/sessions/hermes/send/route.ts` → 1
- Diff only contains lines starting with `//` — zero non-comment code changes

## Final Verification (Plan `<verification>` Section)

1. **Type safety** — `pnpm typecheck` exits 0; zero `: any` or ` as any` remaining in the route file.
2. **Behavior preservation (default path)** — With `HERMES_API_URL` unset and no `agents.config.hermesApiUrl`, the route still posts to `http://127.0.0.1:8642/v1/chat/completions`. The literal `127.0.0.1:8642` now appears exactly once in the codebase: in `src/lib/config.ts` as the default. Zero matches in the route file.
3. **Override precedence** — Per-agent `agents.config.hermesApiUrl` still wins. Visually confirmed: `let apiUrl = config.hermesApiUrl` on line 39, followed by `if (agentConfig.hermesApiUrl) apiUrl = agentConfig.hermesApiUrl` on line 45.
4. **Response contract** — Response keys `ok`, `reply`, `userMessage`, `replyMessage`, `sessionId` unchanged (lines 133–137). Error codes 400 (validation), 502 (Hermes non-2xx), 500 (exception) unchanged.
5. **Existing tests green** — `pnpm test -- src/lib/__tests__/ --run` → 124 test files passed, 1616 tests passed, 44 todo, 4 skipped files.
6. **OpenAPI parity** — Route still on the ignore list: `grep sessions/hermes/send scripts/api-contract-parity.ignore` returns `POST /api/sessions/hermes/send` (line 19). No OpenAPI entry added — still no caller wired.

## Deviations from Plan

None — plan executed exactly as written.

One nuance worth noting (not a deviation): the plan's Task 1 verification expected `grep -n "hermesApiUrl" src/app/api/sessions/hermes/send/route.ts` to return 3 matches ("import via config, agent override check, agent override apply"). Actual count is 2 because the agent override "check" and "apply" share one line (`if (agentConfig.hermesApiUrl) apiUrl = agentConfig.hermesApiUrl`). The plan's action-section text is unambiguous and was followed literally; the expectation grep was miscounted by the planner. All semantic checks (default URL via config, override precedence preserved) pass.

## Success Criteria Checklist

- [x] Three `any` escapes eliminated (two row reads + catch clause); route compiles under strict TypeScript with zero new warnings.
- [x] `HERMES_API_URL` env var documented via the new `config.hermesApiUrl` field; current behavior preserved when env unset.
- [x] Heartbeat UPDATE and inline INSERTs now carry WHY comments referencing the other inliners and the coupling that blocks extraction.
- [x] `pnpm typecheck` and `pnpm test -- src/lib/__tests__/ --run` pass.
- [x] External API contract (request body, response shape, error codes 400/502/500) unchanged.
- [x] Two commits landed per Conventional Commits: `refactor(api): ...` and `docs(api): ...`.

## Self-Check: PASSED

- File `src/app/api/sessions/hermes/send/route.ts` — exists (modified by both commits).
- File `src/lib/config.ts` — exists (modified by Task 1).
- Commit `d712cb8` — `git log --oneline` confirms present.
- Commit `84f9f3b` — `git log --oneline` confirms present (current HEAD).
