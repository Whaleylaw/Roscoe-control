# Phase 20: Lane-Aware Routing & Unified Blocker Contract - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning
**Source:** derived from the v1.3 parity documents shipped with Phase 19 — `.planning/GSD_PARITY_DIFF_vs_gsd-lawyerinc_2026-04-21.md` (M1, M2), `.planning/GSD_FINISHUP_PUNCHLIST_2026-04-21.md` (Gap C, Gap D, Sections P0.3 + P1 scope items), `.planning/GSD_CONTINUATION_AGENT_PROMPT_2026-04-21.md` (Scope items 1 + 2), `.planning/REQUIREMENTS.md` (ROUTE-01, ROUTE-02, COMPAT-02, COMPAT-03).

<domain>
## Phase Boundary

Phase 20 delivers two coupled runtime behaviors on top of the Phase 19 lane primitives:

1. **Lane-aware default auto-routing (ROUTE-01, COMPAT-02)** — `autoRouteInboxTasks()` in `src/lib/task-dispatch.ts` prefers legacy inbox tasks linked to `in_progress` plans (`gsd_plan_id` IN lane-active plan set) over unscoped legacy inbox rows, and emits observable reason metadata (`auto_route_lane_scoped` on a lane-scoped route, `auto_route_legacy_fallback` on the unscoped path) inside the existing `task.status_changed` payload. The recipe fast-path SELECT at `src/lib/task-dispatch.ts:1083-1111` is BYTE-FOR-BYTE unchanged (same SELECT, same UPDATE WHERE clause, same two emissions with `reason: 'auto_route_recipe'`). The global 5-row batch cap and priority-then-created_at ordering in the legacy SELECT are preserved; only the WHERE-clause preference order changes.

2. **Unified blocker pause/resume contract (ROUTE-02, COMPAT-03)** — the legacy dispatch path in `src/lib/task-dispatch.ts:dispatchAssignedTasks()` gains a structured `in_progress → awaiting_owner` transition with required `blocker_reason`, `blocker_kind`, and `resume_hint` fields, plus a deterministic owner-initiated resume (`awaiting_owner → assigned` restores the pre-blocker assignee and clears blocker fields). Recipe runner + legacy dispatch emit a common blocker-transition event shape so downstream UI/observers handle both paths identically. Existing legacy retry/fail semantics (`assigned ↔ in_progress → failed/review` via `requeueStaleTasks` and `dispatchAssignedTasks` catch branches) are preserved — the blocker contract is additive, not a replacement.

The scope covers only the deterministic bridge between lifecycle lane primitives (Phase 19) and dispatch/routing behavior (this phase). End-to-end acceptance of the full "automatic unless blocker" loop lives in Phase 23 (ACCEPT-01).

**Out of scope for this phase** — MCP `create/update` field expansion (Phase 21 / MCP-01..03), doc reconciliation + `it.todo` burn-down (Phase 22 / DOCS-01..02, TESTS-01..03), full end-to-end acceptance test (Phase 23 / ACCEPT-01). Schema or migration changes to queue/task tables are explicitly OUT (REQUIREMENTS.md § Out of Scope) — the existing `runner_last_failure_reason` column (used by the recipe path) is sufficient for legacy blocker persistence.

</domain>

<decisions>
## Implementation Decisions

### Lane-aware routing preference (ROUTE-01)

- **Active-plan set is computed once per tick.** Issue `SELECT id FROM gsd_plans WHERE status = 'in_progress'` at the top of the legacy-path branch (after the recipe fast-path runs). Result is an array of plan IDs — becomes the IN-list for the lane-scoped candidate query. If the set is empty, the lane-scoped branch is skipped entirely and the function falls through to the existing legacy SELECT unchanged (except for route-reason metadata — see below).
- **"Project lane" scope is resolved via plan membership, not a task.project_id filter.** REQUIREMENTS.md ROUTE-01 mentions "scoped project lanes" — this phase implements that as an emergent property: a task carrying `gsd_plan_id = P` can only ever belong to project P's hierarchy (phase→milestone→workstream→project), so filtering by in_progress plan IDs implicitly scopes to those plans' projects. `autoRouteInboxTasks()` runs workspace-wide; there is no per-tick project filter and no per-project batch allocation. If two projects have active plans, tasks from either are eligible in the lane-scoped pass — this matches the Phase 19 QUEUE-01 workspace-scoped semantics (the CLI/MCP caller can narrow per-request via `?project_id=` on the queue endpoint, but scheduler ticks are global by design).
- **Two-pass legacy SELECT.** Replace the single `SELECT … WHERE status = 'inbox' AND assigned_to IS NULL AND recipe_slug IS NULL … LIMIT 5` with a two-pass shape:
  1. **Lane-scoped pass:** `SELECT … WHERE status = 'inbox' AND assigned_to IS NULL AND recipe_slug IS NULL AND gsd_plan_id IN (<active_plan_ids>) ORDER BY priority/created_at ASC LIMIT 5`. Any rows here are processed first.
  2. **Unscoped fallback pass:** only runs when the lane-scoped pass returned strictly fewer than 5 rows AND the function has remaining batch budget (`5 - lane_rows_count` rows). Identical SELECT as today but with `gsd_plan_id NOT IN (<active_plan_ids>) OR gsd_plan_id IS NULL` clause to avoid re-considering the rows the first pass already took.
- **Batch budget stays at 5.** Combined, the two passes still consume at most 5 rows per tick (matches v1.2 global legacy behavior). `LIMIT 5` on pass 1 and `LIMIT (5 - lane_rows_count)` on pass 2.
- **Empty active-plan set:** When no plans are `in_progress`, skip pass 1 entirely, run pass 2 with an unbounded WHERE (`1=1` or equivalent), and emit `auto_route_legacy_fallback` on each route — the scheduler IS running in legacy-only mode in that case and observers need to see that.
- **Route-reason metadata rides existing events.** The existing `task.status_changed` broadcasts at lines 1189 and 1203 of `src/lib/task-dispatch.ts` gain a `reason: 'auto_route_lane_scoped' | 'auto_route_legacy_fallback'` field. No new event type — observers that filter `task.status_changed` already process the lane-scoped routes today, they just lack the reason discriminator. The `reason` field is set from whichever pass produced the row (pass 1 → `auto_route_lane_scoped`, pass 2 → `auto_route_legacy_fallback`).
- **Recipe fast-path untouched (COMPAT-02 lock).** The recipe SELECT + UPDATE + two broadcasts at lines 1083-1111 do not move, do not change text, do not change emission order. Verify via textual diff in the PLAN's `verify` step. The two-pass legacy logic is inserted BETWEEN the recipe fast-path block and the existing agent-scoring / capacity-check loop — not intermixed with either.
- **Ordering stability:** within each pass, ORDER BY priority (critical/high/medium/low) then created_at ASC — same tuple shape as today. Tasks linked to different active plans are interleaved by that global ordering (there is NO per-plan grouping or round-robin in v1.3). The only preference is "lane-scoped beats unscoped"; within the lane-scoped pass, a critical priority task from plan A still beats a high priority task from plan B.
- **Capacity check (`3 in-progress per agent`) is unchanged** — applies to both passes identically. A lane-scoped task that fails capacity skips to the alt-agent branch, same as today. No lane-scoped capacity leak (capacity is per-agent, not per-lane).
- **activity log row:** the existing `logActivity('task_auto_routed', …)` call includes the agent name, role, and score. Add `route_reason` to the metadata object — no format change, just an additional field. No prose change in the human-legible summary.

### Legacy blocker contract (ROUTE-02, COMPAT-03)

- **Legacy blocker envelope shape:**
  ```ts
  type LegacyBlockerEnvelope = {
    blocker_reason: string   // required, 1–2000 chars
    blocker_kind:   'needs_input' | 'needs_approval' | 'external_dependency' | 'policy' | 'other'
    resume_hint:    string   // required, 1–500 chars — what the owner must do to resume
  }
  ```
  - `blocker_reason` is the free-text explanation (same 2000-char bound as recipe path's checkpoint `blocker_reason` field in `CheckpointBodySchema`).
  - `blocker_kind` is the LOCKED enum. `needs_input` is the dominant case (agent asked a question it cannot answer); `needs_approval` is policy/Aegis-adjacent; `external_dependency` is "waiting on a third-party"; `policy` is compliance/legal; `other` is the escape hatch (CONTEXT.md discipline: avoid unless none of the four fit).
  - `resume_hint` is an operator-readable short sentence — e.g., "reply in a task comment with the final budget number" or "approve the gate on this task".
- **Persistence policy — no schema migration.** All three envelope fields serialize into a single JSON blob and live in the existing `runner_last_failure_reason` TEXT column on `tasks` (the same column the recipe runner already uses to persist `blocked:<reason>` — see `src/app/api/tasks/[id]/checkpoints/route.ts:170-183`). Shape: `{ "blocker_reason": "...", "blocker_kind": "...", "resume_hint": "..." }` (JSON-encoded). The column name is legacy-ugly but the schema is additive and zero-migration. Phase 22 (DOCS-01) may document this naming; a future column rename is a separate concern.
  - **Recipe path keeps its current string format** (`blocked:<reason>`). The blocker-envelope JSON is ONLY written by the legacy path. When the field is JSON-parseable, UI/observers treat it as a structured envelope; when it is a bare string (legacy recipe path), they treat it as a free-text reason. This is backward-compatible for any existing reader.
- **Trigger surface — existing status-update endpoint, not a new route.** A caller (typically the dispatched agent via an API key or a human via the UI) transitions a legacy task to `awaiting_owner` via the existing update endpoint `PUT /api/tasks/:id` (handler exported as `export async function PUT(...)` at `src/app/api/tasks/[id]/route.ts:129` — the handler is semantically partial-update so behaves PATCH-like; the HTTP method is PUT). Body: `{ status: 'awaiting_owner', blocker_reason, blocker_kind, resume_hint }`. The handler accepts the three optional new fields (Zod-validated via `updateTaskSchema`); when `status === 'awaiting_owner'` is the target AND the task is currently `in_progress` AND the task has NO recipe_slug (i.e., legacy path), the PUT is required to carry all three blocker fields. Missing fields → 400 with a structured error listing which were missing.
- **Resume: PUT `status = 'assigned'` with no extra body.** When an owner PUTs `{ status: 'assigned' }` on an `awaiting_owner` legacy task, the handler restores the pre-blocker `assigned_to` (if any; preserved through the blocker transition since we never cleared it) and clears the JSON blocker envelope from `runner_last_failure_reason`. Emits the shared blocker event (see below). The task then re-enters legacy dispatch on the next scheduler tick via the existing `status='assigned'` select path — no new dispatch hook needed.
- **Retry/fail semantics preserved (COMPAT-03 lock).** The catch branches in `dispatchAssignedTasks` at lines 957-993 (`dispatch failed N times` → `failed` or `assigned`) and `requeueStaleTasks` at lines 703-739 (stale → `failed` or `assigned`) are untouched. The blocker contract is a NEW transition reachable only via a caller-initiated PUT — it is never driven by the scheduler's retry/fail/stale logic. An in_progress task that times out still retries/fails exactly as today; a caller that needs the owner-wait path must explicitly PUT with the envelope.
- **Zod validation lives in `src/lib/validation.ts`.** Extend `updateTaskSchema` with `blocker_reason`, `blocker_kind`, `resume_hint` as OPTIONAL top-level fields. Add a cross-field refine that fires when `status === 'awaiting_owner'` and the task has no recipe (determined in the PUT handler before the refine runs) — the handler, not the schema, checks recipe-slug because the schema cannot see the DB row. The schema enforces `blocker_kind` enum membership when provided and string-length bounds.

### Shared blocker/resume event shape (umbrella goal 6)

- **Event name:** `task.blocker_transition`. NEW event type registered in `src/lib/event-bus.ts:EventType` union. Distinct from `task.status_changed` so UI/observers that want to surface blocker-specific affordances can subscribe without reading every status change.
- **Payload shape (LOCKED, identical across recipe and legacy paths):**
  ```ts
  {
    task_id: number
    workspace_id: number
    direction: 'paused' | 'resumed'
    previous_status: string    // 'in_progress' | 'awaiting_owner'
    status: string             // 'awaiting_owner' | 'assigned'
    blocker_reason: string | null
    blocker_kind: string | null   // enum string for legacy; null for recipe (not captured)
    resume_hint: string | null    // string for legacy; null for recipe
    source: 'recipe' | 'legacy'
    attempt: number | null        // runner_attempts for recipe; null for legacy
    ts: number                    // unix seconds
  }
  ```
- **Emission sites:**
  - Recipe path: the existing blocker checkpoint flow in `src/app/api/tasks/[id]/checkpoints/route.ts` gains a second broadcast right after the existing `task.status_changed` with `reason: 'blocked_checkpoint'` emission. Does NOT replace the status_changed emission (backward-compat for current subscribers). The second broadcast is `task.blocker_transition` with `direction: 'paused'`, `source: 'recipe'`, `attempt: task.runner_attempts`, `blocker_kind: null`, `resume_hint: null`.
  - Legacy path (pause): the PUT handler in `src/app/api/tasks/[id]/route.ts` emits `task.blocker_transition` with `direction: 'paused'`, `source: 'legacy'`, `attempt: null`, all three envelope fields populated.
  - Recipe path (resume): owners today flip `awaiting_owner → assigned` via the same PUT handler (the generic write path at lines 403-705 of route.ts owns the status column for non-legacy-blocker transitions). The PUT handler is the single resume emission site for BOTH paths; it derives `source` from `recipe_slug` presence on the fetched row.
  - Legacy path (resume): same PUT handler (dedicated resume branch added by Plan 20-02), `direction: 'resumed'`, `source: 'legacy'`.
- **No event for retry/fail.** The existing `task.status_changed` with `reason: 'dispatch_failed'` / `stale_task_requeue` / `max_dispatch_retries_exceeded` is unchanged. `task.blocker_transition` fires ONLY on the explicit owner-intervention pause/resume pair.
- **Backward compat:** existing subscribers of `task.status_changed` see the same payloads they saw before — blocker pause on recipe still fires `task.status_changed { status: 'awaiting_owner', reason: 'blocked_checkpoint' }` as it does today. The new `task.blocker_transition` is purely additive.

### Ordering + atomicity

- **Lane-scoped route SQL is a SELECT, not an UPDATE.** The atomic claim pattern used by the queue endpoint (UPDATE-with-subquery) is not needed here because `autoRouteInboxTasks` runs once per scheduler tick, single-threaded, and the subsequent per-row UPDATE already guards against concurrent flip (`WHERE id = ? AND status = 'inbox'` idiom already present in the alt-agent branch must be re-added to the primary branch — a pre-existing hardening that Phase 20 picks up). Add the guard, then assert `res.changes > 0` before broadcasting.
- **Blocker PUT runs in `db.transaction()`.** The status flip + `runner_last_failure_reason` JSON write + (resume branch only) `runner_last_failure_reason = NULL` clear happen inside one better-sqlite3 transaction. Event broadcast fires AFTER commit (same discipline as Phase 19 transition route).

### Claude's Discretion

- The exact SQL shape of the two-pass SELECT (one SELECT with `OR` vs two prepared statements) — Claude picks based on better-sqlite3 idioms already in `src/lib/task-dispatch.ts`. Preference: two prepared statements, clearer read.
- The precise JSON key order in the blocker envelope persisted to `runner_last_failure_reason` — Claude picks; tests assert parseability + field presence, not exact serialization.
- Whether `blocker_kind` enum uses snake_case or kebab-case — Claude picks snake_case (matches existing `auto_route_recipe`, `stale_task_max_retries` reason conventions).
- The exact Zod refine message for the 400 when blocker fields are missing — Claude picks, following `src/lib/validation.ts` conventions (consistent "must include X, Y, Z" wording).
- Whether the existing `auto_route_recipe` reason also carries through to the new event shape or stays only on `task.status_changed` — Claude picks: `auto_route_recipe` stays on `task.status_changed` only (recipe path is not a blocker path).
- CLI flag or MCP tool changes to surface the new fields — NOT in Phase 20 scope (MCP-01..03 is Phase 21). If a discretionary CLI help-text tweak materializes, Claude may include it but it is not a success criterion.

</decisions>

<specifics>
## Specific Ideas

- **v1.2 runtime parity is non-negotiable.** Recipe-tagged tasks must continue to claim through the runner with byte-identical fast-path SQL + event emission. COMPAT-02 is a hard lock — the PLAN verify step MUST include a textual/behavioral assertion that the recipe fast-path block is unchanged.
- **Source-of-truth documents:**
  - `.planning/GSD_PARITY_DIFF_vs_gsd-lawyerinc_2026-04-21.md` (M1, M2 framing; P1-A, P1-B acceptance criteria)
  - `.planning/GSD_FINISHUP_PUNCHLIST_2026-04-21.md` (Gap C, Gap D; P0.3 file targets; acceptance criteria for both the routing preference and the blocker envelope)
  - `.planning/GSD_CONTINUATION_AGENT_PROMPT_2026-04-21.md` (Scope items 1 + 2; explicit constraint "keep recipe fast-path unchanged" and "emit consistent events in both paths")
  - `.planning/REQUIREMENTS.md` (ROUTE-01, ROUTE-02, COMPAT-02, COMPAT-03 authoritative wording)
  - `.planning/phases/19-project-scoped-queue-plan-activation/19-CONTEXT.md` (Phase 19 decisions — activation writes to `inbox`/`assigned`, runner claims by recipe via runner-token, legacy path routes by `assigned_to`)
- **Files the planner will touch:**
  - `src/lib/task-dispatch.ts` (autoRouteInboxTasks — two-pass legacy SELECT + route_reason metadata; UNTOUCHED: recipe fast-path block, capacity check, agent scoring)
  - `src/lib/validation.ts` (updateTaskSchema — add optional blocker_reason / blocker_kind / resume_hint fields; keep status enum)
  - `src/app/api/tasks/[id]/route.ts` (PUT handler — blocker envelope validation, JSON persistence to runner_last_failure_reason, resume clear, shared event emission)
  - `src/app/api/tasks/[id]/checkpoints/route.ts` (recipe blocker emission — ADD the second `task.blocker_transition` broadcast; DO NOT remove the existing status_changed emission)
  - `src/lib/event-bus.ts` (EventType union — add `task.blocker_transition`)
  - Test files: `src/lib/__tests__/task-dispatch-autoroute.test.ts` (extend with lane-scoped preference + reason metadata cases), NEW `src/app/api/tasks/__tests__/blocker-transition.test.ts` (legacy pause/resume + shared event shape), `src/lib/__tests__/phase-15-blocker-flow-integration.test.ts` (extend to assert the new `task.blocker_transition` emission on the recipe path)
- **Existing dependencies to consult:**
  - Phase 15 recipe blocker flow at `src/app/api/tasks/[id]/checkpoints/route.ts:150-256` — this is the reference shape for "how blocker transitions emit and persist"; the legacy path mirrors it.
  - Phase 19 activation pass at `src/app/api/gsd/plans/[plan_id]/transition/route.ts:162-261` — this is the source of truth for `in_progress` plan membership that the lane-scoped SELECT reads.
  - Existing PUT status gate checks at `src/app/api/tasks/[id]/route.ts:411-437` (gate_required + Aegis approval) — the blocker PUT branch must NOT interfere with gate checks on `status === 'done'`; the `awaiting_owner` branch fires before those gates because awaiting_owner is not a forward-motion target.
  - Existing `task.status_changed` emission pattern (every dispatch + route site emits one) — the new `task.blocker_transition` emissions are ADDITIVE, never replacing.

</specifics>

<deferred>
## Deferred Ideas

- **MCP `create/update` field expansion** beyond the existing `mc_poll_task_queue` filters — Phase 21 (MCP-01..03). The PUT handler in Phase 20 accepts the blocker envelope but no MCP tool exposes it yet; MCP exposure is a Phase 21 concern.
- **End-to-end acceptance test** spanning activation → claim → blocker → resume across both paths — Phase 23 (ACCEPT-01). Phase 20 unit + integration tests cover the two paths in isolation; the deterministic full-loop acceptance test is explicitly deferred.
- **UI surfacing of route_reason or blocker_kind** — Phase 20 is API-only per REQUIREMENTS.md § Out of Scope. The events fire; no dashboard panel update is in scope. Phase 22 may replace a dashboard `it.todo` with executable coverage of the event flow, but UI panels wiring is a later concern.
- **Schema migration to rename `runner_last_failure_reason`** — discussed and rejected. The column name is misleading for the legacy JSON envelope but the zero-migration path is strictly preferred. A cosmetic rename + data migration can land in a future phase if UI/docs drift becomes costly.
- **Per-plan or per-project round-robin routing** (fairness across lanes) — discussed and rejected for Phase 20. The lane-scoped pass uses the same global priority/created_at ordering as the unscoped pass; a critical task from plan A beats a high from plan B even if plan B hasn't had a route this hour. Round-robin fairness is a future concern if observed lane starvation becomes an operational pain point.
- **Cron/scheduler-driven blocker timeouts** (auto-fail an `awaiting_owner` task after N hours) — out of scope. Owner intervention is the only resume trigger in Phase 20; time-based auto-resolution can be added later without breaking the contract.
- **Separate `blocker_fields` column(s) on `tasks`** — discussed and rejected. JSON in `runner_last_failure_reason` is reversible, zero-migration, and sufficient for v1.3. A follow-up phase may normalize the blocker envelope into first-class columns if query patterns emerge that need them.
- **Breaking change to `task.status_changed` payload** (adding a required `reason` field or changing the `reason` vocabulary) — rejected. The Phase 20 additions to the reason field are STRICTLY additive (new enum values; existing values unchanged); observers that don't know the new values still see the same events they saw before.

</deferred>

---

*Phase: 20-lane-aware-routing-unified-blocker-contract*
*Context gathered: 2026-04-22*
