---
quick_id: 260416-hna
type: quick
scope: refactor
files_modified:
  - src/app/api/sessions/hermes/send/route.ts
  - src/lib/config.ts
autonomous: true
---

<objective>
Clean up three concrete quality gaps in the newly landed Hermes bridge route (`src/app/api/sessions/hermes/send/route.ts`) without changing external behavior. The route remains the only path that can reach Hermes' OpenAI-compatible server at `:8642/v1/chat/completions`; OpenClaw chat paths don't speak that protocol, so a unify-with-chat refactor is explicitly out of scope.

Purpose: Eliminate `any` escapes, move the hardcoded API URL default into `config.ts` so env overrides work, and document (not remove) the two intentional duplications flagged by audit so future readers don't re-flag them.

Output: Typed route that passes `pnpm typecheck`, preserves the existing request/response contract and error codes (400/502/500), and keeps the Phase 10 vitest suite green.
</objective>

<context>
@CLAUDE.md
@.planning/STATE.md
@src/app/api/sessions/hermes/send/route.ts
@src/lib/db.ts
@src/lib/config.ts
</context>

<discovery_findings>
Read upfront so executors don't re-derive:

1. **Message interface** already exists at `src/lib/db.ts:344-354`. It's exported (see `src/app/api/chat/messages/route.ts:2` — `import { ..., Message } from '@/lib/db'` and `.get(...) as Message` at line 106). Columns per interface: `id, conversation_id, from_agent, to_agent, content, message_type, metadata, read_at, created_at`. The DB row also carries a `workspace_id` column that isn't in the interface — that's fine, the query only needs it in the WHERE clause, not the return type. Using `Message` for both `userRow` and `replyRow` is correct.

2. **No shared presence helper exists.** Confirmed via grep for `UPDATE agents SET.*last_seen` — four distinct call sites inline this pattern:
   - `src/lib/scheduler.ts:226`
   - `src/app/api/status/route.ts:351`
   - `src/app/api/agents/register/route.ts:66`
   - `src/app/api/sessions/hermes/send/route.ts:110` (the one we're refactoring)

   `db_helpers.updateAgentStatus` in `src/lib/db.ts:526-553` is NOT a drop-in replacement because it ALSO calls `eventBus.broadcast('agent.status_changed')` and `db_helpers.logActivity('agent_status_change', ...)` on every invocation. Using it here would emit an SSE event + activity-feed entry on every Hermes reply, which is noise. **Conclusion: leave the inlined UPDATE, add a WHY comment documenting the other three inliners.** Per the brief: "no hallucination — only if truly no helper".

3. **No shared message-insert helper exists.** `createChatReply()` in `src/app/api/chat/messages/route.ts:79-112` is a FILE-LOCAL function (not exported) specific to the coordinator/gateway flow — it broadcasts `chat.message` unconditionally, which the Hermes route deliberately avoids for user messages (lines 57-58: "Don't broadcast user message — the client already shows it optimistically"). **Conclusion: leave the two inline INSERTs, do not extract or reuse.**

4. **Config pattern:** `src/lib/config.ts` exports a single `config` object with env-backed defaults (see `gatewayHost`, `gatewayPort` at lines 82-83 for the closest parallel — `'127.0.0.1'` and port pattern). Adding `hermesApiUrl: process.env.HERMES_API_URL || 'http://127.0.0.1:8642'` fits the existing shape cleanly.

5. **Agent config override precedence.** Existing behavior: `agents.config.hermesApiUrl` (per-agent, DB) overrides the default at runtime. That precedence MUST survive the refactor — `config.hermesApiUrl` is only the new default, not a hard cap.
</discovery_findings>

<tasks>

<task type="auto">
  <name>Task 1: Type the route, add HERMES_API_URL to config, wire it as the default</name>
  <files>src/lib/config.ts, src/app/api/sessions/hermes/send/route.ts</files>
  <action>
Two file edits, typecheck-visible, behavior-preserving.

**A. `src/lib/config.ts`** — Add `hermesApiUrl` to the `config` object.

Insert after the existing `gatewayPort` line (around line 83), matching the sibling pattern:

```ts
hermesApiUrl: process.env.HERMES_API_URL || 'http://127.0.0.1:8642',
```

Do not add validation, clamping, or URL parsing — keep it minimal and matching `gatewayHost` shape. The env override is opt-in; unset env preserves the current hardcoded default byte-for-byte.

**B. `src/app/api/sessions/hermes/send/route.ts`** — Three mechanical changes:

1. **Import `Message` from db and `config` from config** (alongside the existing imports at the top of file):
   ```ts
   import { getDatabase, Message } from '@/lib/db'
   import { config } from '@/lib/config'
   ```
   (The existing `import { getDatabase } from '@/lib/db'` line gets extended; add a new import line for `config`.)

2. **Replace the hardcoded default at line 38** — change:
   ```ts
   let apiUrl = 'http://127.0.0.1:8642'
   ```
   to:
   ```ts
   let apiUrl = config.hermesApiUrl
   ```
   The downstream `if (config.hermesApiUrl) apiUrl = config.hermesApiUrl` inside the `agent?.config` JSON parse at line 44 still works — it reads the AGENT's config JSON, not the MC config object. Rename the local `const config = JSON.parse(...)` at line 43 to `const agentConfig = JSON.parse(agent.config)` to avoid shadowing the newly imported `config` module. Update line 44 accordingly: `if (agentConfig.hermesApiUrl) apiUrl = agentConfig.hermesApiUrl` and line 45: `if (agentConfig.hermesApiKey) apiKey = agentConfig.hermesApiKey`.

3. **Type the two row reads** — change both `as any` casts:
   - Line 56: `.get(userMsg.lastInsertRowid, workspaceId) as any` → `.get(userMsg.lastInsertRowid, workspaceId) as Message | undefined`
   - Line 102: `.get(replyMsg.lastInsertRowid, workspaceId) as any` → `.get(replyMsg.lastInsertRowid, workspaceId) as Message | undefined`

   `| undefined` is load-bearing — `better-sqlite3` `.get()` returns `undefined` when no row matches. The existing code at line 103 already guards (`if (replyRow) { eventBus.broadcast(...) }`) so the type narrows cleanly.

4. **Type the catch error at line 120** — change `catch (error: any)` to `catch (error: unknown)` and update line 123 to:
   ```ts
   { error: error instanceof Error ? error.message : 'Failed to send message to Hermes' }
   ```
   This removes the last `any` and matches the `error?.message || ...` fallback semantics.

**What stays identical:**
- Request body parsing (`message`, `conversationId`, `sessionId`), validation (400 on empty/>6000), response shape (`ok`, `reply`, `userMessage`, `replyMessage`, `sessionId`), error codes (502 on Hermes API non-2xx, 500 on exception).
- The eventBus broadcast pattern (only `replyRow`, never `userRow`).
- Per-agent `agents.config.hermesApiUrl` / `hermesApiKey` override precedence.
- The `const agent = db.prepare(...)` type (`{ config?: string } | undefined`) stays as-is — it only reads one column, upgrading it to `Agent | undefined` would force adding `name, role, status, ...` to the SELECT unnecessarily.
  </action>
  <verify>
```bash
pnpm typecheck                                  # must pass (removes 3 any, adds 0)
grep -c "any" src/app/api/sessions/hermes/send/route.ts  # expect 0 (was 3)
grep -n "config.hermesApiUrl" src/lib/config.ts          # expect 1 match
grep -n "hermesApiUrl" src/app/api/sessions/hermes/send/route.ts  # expect 3 (import via config, agent override check, agent override apply)
pnpm test -- src/lib/__tests__/ --run          # Phase 10 suite green
```
  </verify>
  <done>
- Zero `any` remaining in `src/app/api/sessions/hermes/send/route.ts`.
- `config.hermesApiUrl` exists in `src/lib/config.ts`, defaulting to `'http://127.0.0.1:8642'`, overridable via `HERMES_API_URL` env.
- Unset env → behavior identical to pre-refactor (same default URL baked in).
- `agents.config.hermesApiUrl` still overrides the config default at runtime.
- `pnpm typecheck` passes; existing vitest suite passes.
  </done>
</task>

<task type="auto">
  <name>Task 2: Document the two intentional duplications so audit doesn't re-flag them</name>
  <files>src/app/api/sessions/hermes/send/route.ts</files>
  <action>
Add WHY comments to the two inline patterns flagged in audit. No behavior change. This task exists separate from Task 1 so the commit log stays surgical (docs commit vs refactor commit) per Conventional Commits — `refactor:` for Task 1, `docs:` for Task 2.

**A. Heartbeat UPDATE comment** (above line 108, replacing the existing one-line comment `// Keep Hermes agent marked as active so the heartbeat doesn't set it offline`):

```ts
// Keep Hermes agent marked as active so the scheduler heartbeat doesn't
// flip it offline between messages.
//
// Intentionally inlined, not routed through db_helpers.updateAgentStatus:
// that helper also broadcasts 'agent.status_changed' via eventBus and writes
// an 'agent_status_change' activity row on every call. Doing that on every
// Hermes reply would flood the live feed with a heartbeat-every-message
// signal. The same raw UPDATE pattern is used by the three other presence
// writers (src/lib/scheduler.ts, src/app/api/status/route.ts,
// src/app/api/agents/register/route.ts). If a shared silent-presence helper
// ever lands, all four call sites should migrate together.
```

**B. User-message INSERT comment** (above the `const userMsg = db.prepare(...)` block around line 50):

```ts
// Insert user message and reply message inline rather than via a shared
// helper. The file-local createChatReply() in src/app/api/chat/messages/
// route.ts is tightly coupled to the coordinator/gateway flow (always
// broadcasts 'chat.message' and is not exported). The Hermes bridge
// deliberately suppresses the user-message broadcast (the client renders
// it optimistically — see below), so the shared helper's unconditional
// broadcast would cause the UI to flicker with a duplicate user bubble.
```

Place comment B exactly once above the user-message INSERT — the reply-message INSERT just below is close enough to be covered by the same comment context; don't duplicate it.

**What NOT to do:**
- Do not extract `createChatReply` from `chat/messages/route.ts` into a shared module. That's a bigger refactor touching two routes and changing the broadcast contract; out of scope for a quick-task cleanup.
- Do not introduce a new `silentUpdateAgentPresence` helper. Per the brief: "If a helper exists, use it. If not, note the duplication in a comment with a WHY (no hallucination — only if truly no helper)." Confirmed no helper exists; comment is the correct action.
  </action>
  <verify>
```bash
pnpm typecheck                                              # still green
grep -c "Intentionally inlined" src/app/api/sessions/hermes/send/route.ts  # expect 1
grep -c "file-local createChatReply" src/app/api/sessions/hermes/send/route.ts  # expect 1
git diff src/app/api/sessions/hermes/send/route.ts | grep -E "^[+-]" | grep -v "^[+-]//" | grep -v "^[+-] \*" | wc -l  # only comment lines touched (0 non-comment +/- lines)
```
  </verify>
  <done>
- Both audit-flagged inlinings now carry a WHY comment pointing at the other call sites (for the heartbeat) or the coupling that prevents extraction (for the INSERT).
- No non-comment code changes in this task's diff — pure documentation.
- `pnpm typecheck` still passes.
  </done>
</task>

</tasks>

<verification>
Run at the end of the plan (not per-task):

1. **Type safety:** `pnpm typecheck` exits 0. No `any` remaining in the route file (`grep -c ": any" src/app/api/sessions/hermes/send/route.ts` → 0; `grep -c " as any" src/app/api/sessions/hermes/send/route.ts` → 0).

2. **Behavior preservation — default path:** With `HERMES_API_URL` unset and no `agents.config.hermesApiUrl`, the route still posts to `http://127.0.0.1:8642/v1/chat/completions`. Verified by `grep -n "127.0.0.1:8642" src/lib/config.ts` returning exactly 1 match (the default), and the route file no longer containing the literal (`grep -c "127.0.0.1:8642" src/app/api/sessions/hermes/send/route.ts` → 0).

3. **Override precedence:** Per-agent `hermesApiUrl` still wins. Visually confirm the `if (agentConfig.hermesApiUrl) apiUrl = agentConfig.hermesApiUrl` line is reached AFTER `let apiUrl = config.hermesApiUrl`.

4. **Response contract:** `grep -E "ok: true|userMessage|replyMessage|sessionId" src/app/api/sessions/hermes/send/route.ts` returns the same set of keys as pre-refactor (no key adds/drops).

5. **Existing tests green:** `pnpm test -- --run` (Phase 10 vitest suite must be unaffected — this file has no direct unit tests, only integration through the phase suite).

6. **OpenAPI parity:** Still on ignore list — `grep "sessions/hermes/send" scripts/api-contract-parity.ignore` returns a match. No OpenAPI entry is added in this quick task (still no caller wired).
</verification>

<success_criteria>
- Three `any` escapes at lines 56, 85 (as part of line-102 row), and 120 in the route eliminated; route compiles under strict TypeScript with zero new warnings.
- `HERMES_API_URL` env var documented in the new `config.hermesApiUrl` field; current behavior preserved when env unset.
- Heartbeat UPDATE and inline INSERTs now carry WHY comments referencing the other inliners and the coupling that blocks extraction.
- `pnpm typecheck` and `pnpm test -- --run` pass.
- External API contract (request body, response shape, error codes 400/502/500) unchanged.
- Two commits recommended (per Conventional Commits and the task split):
  - `refactor(api): type hermes send route and route default URL through config`
  - `docs(api): explain inlined heartbeat and message insert in hermes send route`
</success_criteria>

<output>
After both tasks complete, update STATE.md "Quick Tasks Completed" table with a 260416-hna row pointing at this directory and the merge commit SHA.
</output>
