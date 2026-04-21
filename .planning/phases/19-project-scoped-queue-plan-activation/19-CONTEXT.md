# Phase 19: Project-Scoped Queue & Plan Activation - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 19 delivers two coupled API behaviors:

1. **Project-scoped queue polling** — `GET /api/tasks/queue` accepts optional `project_id`, `gsd_plan_id`, and `wave` query parameters that scope both the read and the atomic claim subquery. Backward compatible when params are absent.
2. **Plan-driven task activation** — `POST /api/gsd/plans/:id/transition` to `in_progress` deterministically activates linked execution tasks (`gsd_plan_id = planId`) into queue-entering state, returns a `queue_activation` payload, and emits `gsd.plan.tasks_activated`.

The CLI (`scripts/mc-cli.cjs`), MCP server (`scripts/mc-mcp-server.cjs`), and `openapi.json` reflect the new scoping params so callers don't need raw REST.

**Out of scope for this phase** — lane-aware default auto-routing (Phase 20 / ROUTE-01), unified blocker contract (Phase 20 / ROUTE-02), MCP create/update field expansion (Phase 21 / MCP-01..03), end-to-end acceptance test (Phase 23 / ACCEPT-01).

</domain>

<decisions>
## Implementation Decisions

### Activation source-state policy

- **Strict source set:** Only tasks in `backlog` or `todo` states activate on plan `in_progress`. `awaiting_owner`, `failed`, `review`, and `in_progress` are never auto-activated by plan transition.
- **Idempotent:** Tasks already in `inbox` or `assigned` are skipped silently and counted in the payload as `already_active`. The activation pass is safe to re-run.
- **Re-entry behavior:** Every `to_status='in_progress'` transition runs the same activation pass — including `in_progress → blocked → in_progress` resumes. Idempotence (above) makes this safe.
- **Unknown-state handling:** Tasks linked to the plan but in an out-of-set state (e.g., `review`, `in_progress`, `failed`) are skipped silently and counted in the payload as `skipped_by_state`. They do NOT block the transition.

### Assignee-based routing (inbox vs assigned)

- **Routing rule:** A task with `assigned_agent_id` non-null OR `recipe_slug` non-null activates to `assigned`; otherwise to `inbox`. The recipe-slug branch is critical for v1.2 runtime parity — recipe-tagged tasks are pre-destined for a specific runner image and the runner already scans `status IN (inbox, assigned)` for them.
- **Recipe path keeps `assigned_agent_id` null:** When a recipe-tagged task routes to `assigned` without a named agent, leave `assigned_agent_id` null. The runner principal claims by recipe via the existing `runner-token` auth path; no synthetic sentinel agent row is created (preserves v1.2 sentinel convention).
- **Dead-assignee policy:** If `assigned_agent_id` points at an agent with `status = disabled`, treat it as no-assignee — route the task to `inbox`, clear the dead `assigned_agent_id`, and count it in the payload as `reassigned`. Only `status = disabled` triggers this (NOT `offline`, `idle`, or any other non-active state — those agents may legitimately come back).
- **Capacity is dispatch-time, not activation-time:** Activation just sets status. Per-agent capacity checks happen when the dispatcher/runner actually tries to claim. Matches v1.2 behavior — `assigned` state is allowed to accumulate beyond capacity and drain over time.

### Filter combination + validation semantics

- **Composition: AND.** When multiple filters are provided (`?project_id=P&gsd_plan_id=X&wave=3`), all must match — each added param narrows the result set. Standard REST filter semantics.
- **Cross-filter validation: 400 on conflict.** If `gsd_plan_id` points at a plan whose project does not match the `project_id` filter, return `400 Bad Request` with a clear error (`plan_id X belongs to project Y, not requested project Z`). Loud failure prevents silent empty-result confusion.
- **`wave` lives on the plan, not the task.** Phase 10 gave plans a `wave` field; tasks do not need a new column. The queue filter uses `JOIN gsd_plans ON task.gsd_plan_id = plan.id WHERE plan.wave = ?`. No new migration.
- **CLI flag shape:** `pnpm mc tasks queue --project <id> --plan <id> --wave <n>`. Raw IDs only (no slug resolution). All flags optional; omitting them preserves v1.2 workspace-level behavior. No short aliases.

### Atomicity + event payload shape

- **Pragmatic atomicity:** One SQLite transaction wraps the plan status flip and all task activations. Real DB / validation errors roll back the entire transition. Idempotent skip outcomes (`already_active`, `skipped_by_state`) are NOT errors — they don't roll back. Use the existing better-sqlite3 `db.transaction()` pattern.
- **Gate-blocked transitions don't activate anything:** If the `to_status='in_progress'` transition is rejected by existing Phase 10 gates (gate, dependency, same-wave conflict), no activation runs. The caller receives the gate error with no queue state change. Activation is a success-path side effect only.
- **Payload shape (response + event identical):**
  ```json
  {
    "queue_activation": {
      "activated": N,
      "already_active": M,
      "skipped_by_state": K,
      "reassigned": J,
      "by_status": { "inbox": A, "assigned": B },
      "task_ids": [...]
    }
  }
  ```
  - `activated` = newly moved into `inbox`/`assigned` from `backlog`/`todo`
  - `already_active` = was already in `inbox`/`assigned`
  - `skipped_by_state` = linked to plan but in out-of-set state
  - `reassigned` = recovered from disabled-agent dead-assignee
  - `by_status` = breakdown of newly-activated tasks (sum equals `activated`)
  - `task_ids` = ids of newly-activated tasks (length equals `activated`)
- **HTTP response carries full payload:** Synchronous response: `{ plan: {...}, queue_activation: {...} }`. CLI/MCP callers see results without subscribing to events. The `gsd.plan.tasks_activated` event carries the same `queue_activation` shape for async observers.

### Claude's Discretion

- The exact SQL of the activation UPDATE (single statement vs prepared cursor) — Claude picks based on better-sqlite3 idioms already in `src/lib/task-dispatch.ts`.
- The Zod schema layout for the new query params on the queue endpoint — Claude picks following the existing `src/app/api/tasks/queue/route.ts` style.
- The exact error code/string format for the cross-filter validation 400 — Claude picks following existing `src/lib/validation.ts` conventions.
- The MCP tool schema deltas for `mc_poll_task_queue` (already supports `project_id` / `gsd_plan_id` per PROJECT.md notes — verify and add `wave` if missing).
- OpenAPI response shape for the new `queue_activation` block on the transition endpoint — follow existing `src/app/api/gsd/plans/[plan_id]/transition/route.ts` response conventions.

</decisions>

<specifics>
## Specific Ideas

- **v1.2 runtime parity is non-negotiable.** Recipe-tagged tasks must continue to claim through the runner exactly as in v1.2 — same status set, same auth path. The recipe-slug branch in the activation routing rule exists specifically to honor this.
- **Source-of-truth documents:**
  - `.planning/GSD_PARITY_DIFF_vs_gsd-lawyerinc_2026-04-21.md` (parity gap framing M1–M4)
  - `.planning/GSD_FINISHUP_PUNCHLIST_2026-04-21.md` (concrete file targets for QUEUE-01/02)
  - `.planning/GSD_CONTINUATION_AGENT_PROMPT_2026-04-21.md` (P1 scope wording)
- **Files the planner will touch:** `src/app/api/tasks/queue/route.ts`, `src/app/api/gsd/plans/[plan_id]/transition/route.ts`, `src/lib/task-dispatch.ts` (helpers), `openapi.json`, `scripts/mc-cli.cjs`, `scripts/mc-mcp-server.cjs`, `tests/task-queue.spec.ts`, and tests under `src/app/api/gsd/__tests__/`.
- **Existing dependencies to consult:** Phase 10 introduced `wave` on `gsd_plans` and gate/dependency/same-wave-conflict checks on plan transitions — research must confirm these still gate cleanly under the new activation side effect.

</specifics>

<deferred>
## Deferred Ideas

- **Lane-aware default auto-routing** — `autoRouteInboxTasks()` preferring lane-scoped work over unscoped legacy inbox is Phase 20 (ROUTE-01).
- **Unified blocker pause/resume contract** for legacy dispatch — Phase 20 (ROUTE-02).
- **MCP `create/update` field expansion** beyond the existing `mc_poll_task_queue` filters — Phase 21 (MCP-01..03).
- **Denormalized `wave` column on tasks** — discussed and rejected for Phase 19 (no migration; join is sufficient). Could revisit if join cost becomes measurable in production load.
- **Slug-resolving CLI flags** (`--project my-app` → ID lookup) — discussed and rejected for Phase 19 (raw IDs only). Could revisit as a CLI ergonomics pass later.
- **Sentinel runner agent row** for recipe-tagged tasks — discussed and rejected (preserves v1.2 sentinel-id convention; runner claims by recipe via `runner-token` auth, no fake agent needed).
- **End-to-end acceptance test** spanning the full activation → claim → blocker → resume loop — Phase 23 (ACCEPT-01).

</deferred>

---

*Phase: 19-project-scoped-queue-plan-activation*
*Context gathered: 2026-04-21*
