# Waypoint Discussion Auto-Response Wiring Plan

> **For Hermes:** Use subagent-driven-development / TDD skill to implement this plan task-by-task.

**Goal:** Close the loop so that when a Waypoint task discussion is enabled and a user posts a message, a Hermes-driven agent (either a task-specific recipe agent or the orchestrator as fallback) responds in the same discussion thread.

**Architecture:** Mission Control emits `waypoint.discussion.auto_response.requested` (already implemented, gated by metadata + global env flag). A new MC-side **webhook dispatcher** listens to that event and performs an outbound HTTP POST to the Hermes gateway with a shared-secret header. Hermes runs an agent turn with supplied discussion history and writes the reply back via `POST /api/tasks/:id/discussion/messages` using a service token that marks the message as agent-authored. Agent-authored messages are excluded from auto-response retrigger to prevent loops.

**Tech Stack:** Next.js (MC), TypeScript, existing `event-bus`, Node `fetch`, existing Hermes gateway HTTP endpoint, shared-secret auth.

---

## Decisions (locked)

| Decision | Value |
|---|---|
| Transport | HTTP webhook from MC → Hermes gateway |
| Agent routing | Route by `agent` field to recipe when present; fallback to orchestrator |
| MC → Hermes auth | Shared secret header (`X-Waypoint-Signature` HMAC-SHA256 over body) |
| Hermes → MC auth | Service token env var; message flagged agent-authored; loop-prevented |
| First-slice scope | Orchestrator + agent-by-field routing, with history passed in payload (no fetch-back) |

---

## End state (Definition of Done)

1. Enabling discussion + setting `WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED=true` causes Hermes to respond in-thread on each user message.
2. Agent-authored replies appear in the discussion list with authorship attribution.
3. Agent-authored replies do NOT retrigger auto-response.
4. Webhook failures are best-effort and never break message persistence.
5. Shared secret is validated on Hermes side; missing/bad signature rejects with `401`.
6. Config, env vars, and rollback paths are documented.
7. All new behavior has targeted vitest coverage + passes `typecheck` + `lint`.

---

## Envelope & config

### New env vars (MC)
- `WAYPOINT_AUTORESPONSE_WEBHOOK_URL` — absolute URL of Hermes endpoint (if unset, dispatcher no-ops).
- `WAYPOINT_AUTORESPONSE_WEBHOOK_SECRET` — shared secret used for HMAC.
- `WAYPOINT_AUTORESPONSE_SERVICE_TOKEN` — service token Hermes uses when calling MC back.

### New env vars (Hermes)
- `WAYPOINT_AUTORESPONSE_WEBHOOK_SECRET` — same shared secret.
- `WAYPOINT_MC_BASE_URL` — base URL to call MC back (e.g., `http://localhost:3000`).
- `WAYPOINT_AUTORESPONSE_SERVICE_TOKEN` — same service token.

### Webhook payload (MC → Hermes)
```json
{
  "event": "waypoint.discussion.auto_response.requested",
  "task_id": 123,
  "workspace_id": 1,
  "conversation_id": "task:123:discussion:gsd-doc-drafter",
  "message_id": 456,
  "agent": "gsd-doc-drafter",
  "content": "the user's new message",
  "history": [
    { "role": "user" | "assistant", "content": "...", "created_at": 1777720000 }
  ]
}
```

Headers:
- `Content-Type: application/json`
- `X-Waypoint-Signature: sha256=<hex>` (HMAC over raw body with shared secret)

### Callback (Hermes → MC)
Hermes posts the agent reply to:
```
POST /api/tasks/:id/discussion/messages
Headers:
  Content-Type: application/json
  X-Waypoint-Service-Token: <service token>
Body:
  { "content": "<agent reply>", "authored_by": "agent" }
```

MC behavior:
- If `X-Waypoint-Service-Token` matches `WAYPOINT_AUTORESPONSE_SERVICE_TOKEN`, bypass user auth and treat as agent-authored.
- Persist the message with `metadata.waypoint.authored_by = "agent"` and `metadata.waypoint.agent = "<agent>"`.
- **Do NOT** emit `waypoint.discussion.auto_response.requested` for agent-authored messages.

---

## Phased Slices

### Phase W0 — Shared contracts in `@waypoint/core`
Extract message-authorship + webhook payload types to the core package so both MC and Hermes share them.

**Tasks:**
- W0.1 Add `packages/waypoint-core/src/discussion/auto-response-contract.ts` with types:
  - `WaypointDiscussionAutoResponseRequestPayload`
  - `WaypointDiscussionMessageAuthoredBy = 'user' | 'agent'`
- W0.2 Export from `packages/waypoint-core/src/index.ts`.
- W0.3 Core contract test in `packages/waypoint-core/src/__tests__/auto-response-contract.test.ts`.

**Verification:** `pnpm exec vitest run packages/waypoint-core/src/__tests__/auto-response-contract.test.ts`

---

### Phase W1 — MC loop-prevention + agent authorship
Before wiring the webhook, make the MC endpoint safe for agent replies.

**Tasks:**
- W1.1 Add optional `authored_by` to message POST body schema (default `"user"`).
- W1.2 Add service-token fast path in `POST /api/tasks/:id/discussion/messages`:
  - If `X-Waypoint-Service-Token` matches env var → bypass user auth; require `authored_by: "agent"`.
- W1.3 Persist `metadata.waypoint.authored_by` and `metadata.waypoint.agent` on message record.
- W1.4 Do not emit `auto_response.requested` for agent-authored messages.
- W1.5 Tests:
  - Agent-authored message succeeds with valid service token.
  - Rejects with `401` when service token missing/wrong.
  - Agent-authored message does NOT retrigger auto-response event.
  - User message still works and still fires event when enabled.

**Files:**
- `src/app/api/tasks/[id]/discussion/messages/route.ts`
- `src/app/api/tasks/[id]/discussion/messages/__tests__/route.test.ts`
- `src/lib/waypoint-task-discussion.ts` (if metadata helper touches needed)

**Verification:** `pnpm exec vitest run src/app/api/tasks/[id]/discussion/messages/__tests__/route.test.ts`

---

### Phase W2 — MC webhook dispatcher
Turn the already-emitted event into an outbound HTTP call.

**Tasks:**
- W2.1 Add `src/lib/waypoint-autoresponse-webhook.ts`:
  - `buildSignature(body, secret): string`
  - `dispatchAutoResponseWebhook(payload): Promise<void>` (best-effort, logs on failure, never throws)
  - Reads `WAYPOINT_AUTORESPONSE_WEBHOOK_URL` + `WAYPOINT_AUTORESPONSE_WEBHOOK_SECRET`. No-op if unset.
- W2.2 Subscribe in `src/lib/event-bus.ts` bootstrap (or a dedicated startup module) to `waypoint.discussion.auto_response.requested` and call dispatcher.
- W2.3 Build history by calling internal `listTaskDiscussion()` to get last N messages (configurable cap, default 20).
- W2.4 Tests using mocked `fetch`:
  - HMAC header computed correctly for known body+secret.
  - URL unset → no fetch call.
  - Fetch rejects → no throw.
  - Success → single fetch with expected headers/body shape.
- W2.5 Integration test: simulate user message → event fires → dispatcher is called with expected payload (use a `vi.fn()` dispatcher injection).

**Files:**
- `src/lib/waypoint-autoresponse-webhook.ts` (new)
- `src/lib/__tests__/waypoint-autoresponse-webhook.test.ts` (new)
- `src/lib/event-bus.ts` or a bootstrap file
- Optional: `src/lib/waypoint-autoresponse-bootstrap.ts`

**Verification:** `pnpm exec vitest run src/lib/__tests__/waypoint-autoresponse-webhook.test.ts`

---

### Phase W3 — Hermes-side receiver (design + minimal impl)
Add a Hermes gateway entry point that accepts the webhook and produces an agent reply that posts back to MC.

**Tasks:**
- W3.1 Document the receiver contract in `docs/waypoint-autoresponse-hermes-integration.md`:
  - Request schema, signature verification steps, routing rules, callback format.
- W3.2 Add (or stub in repo) reference adapter code under `examples/waypoint-host-minimal/autoresponse-receiver.ts`:
  - Verify signature.
  - If `agent` exists and matches a known recipe name, delegate to that recipe; otherwise delegate to orchestrator.
  - Compose reply text.
  - POST back to `WAYPOINT_MC_BASE_URL + /api/tasks/:id/discussion/messages` with service token.
- W3.3 Tests:
  - Signature verification unit tests.
  - Bad signature → `401`.
  - Valid signature + known agent → calls correct recipe dispatcher.
  - Valid signature + unknown agent → calls orchestrator fallback.
- W3.4 Note: production wiring in the actual Hermes gateway repo is handled separately; this repo provides the reference and contract.

**Files:**
- `docs/waypoint-autoresponse-hermes-integration.md` (new)
- `examples/waypoint-host-minimal/autoresponse-receiver.ts` (new)
- `examples/waypoint-host-minimal/autoresponse-receiver.test.ts` (new)

**Verification:** `pnpm exec vitest run examples/waypoint-host-minimal/autoresponse-receiver.test.ts`

---

### Phase W4 — End-to-end dogfood + docs
**Tasks:**
- W4.1 Update `docs/waypoint-operations-runbook.md`:
  - New env vars.
  - How to enable auto-response on a task.
  - How to disable / kill switch.
  - Rollback steps.
- W4.2 Update parity matrix doc with agent-authorship note on `POST /discussion/messages`.
- W4.3 Add smoke test script (`scripts/smoke-waypoint-autoresponse.ts`) that:
  - Creates a project+task with discussion metadata enabled.
  - Posts a user message via HTTP.
  - Asserts dispatcher was invoked (via log capture or test double).
- W4.4 Run full Waypoint regression pack.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Infinite agent-response loop | Agent-authored flag + skip event emission (W1.4). Also bound to one emission per user message. |
| Webhook down / slow | Best-effort dispatch + timeout + never throws (W2.1). |
| Secret leakage | Shared secret in env only; never logged; signature comparison constant-time. |
| Agent unavailable | Orchestrator fallback (W3.2); if orchestrator also fails, logged + no reply. |
| Wrong agent replies | Agent field is carried in payload; unknown agent → fallback, not silent drop. |

---

## Rollback

- Set `WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED=false` (global kill).
- Or unset `WAYPOINT_AUTORESPONSE_WEBHOOK_URL` (dispatcher no-ops).
- Or unset task metadata opt-in on the specific task.

---

## Immediate next slice

**W0.1** — add shared auto-response contract types to `@waypoint/core` and a failing core contract test.
