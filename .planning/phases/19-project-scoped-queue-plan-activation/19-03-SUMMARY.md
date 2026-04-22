---
phase: 19-project-scoped-queue-plan-activation
plan: 03
subsystem: api
tags: [openapi, mcp, cli, queue, scoping, gsd, better-sqlite3, QUEUE-01, QUEUE-02, COMPAT-01]

# Dependency graph
requires:
  - phase: 19-project-scoped-queue-plan-activation
    provides: (plan 19-01) GET /api/tasks/queue project_id/gsd_plan_id/wave filters + cross-filter 400
  - phase: 19-project-scoped-queue-plan-activation
    provides: (plan 19-02) POST /api/gsd/plans/{id}/transition queue_activation response shape + gsd.plan.tasks_activated event
provides:
  - OpenAPI 3.0 spec entries for project_id / gsd_plan_id / wave query params on GET /api/tasks/queue
  - Inline 400 response on GET /api/tasks/queue documenting both failure modes (invalid scope integer, cross-filter project/plan mismatch)
  - OpenAPI queue_activation block on POST /api/gsd/plans/{plan_id}/transition 200 response — full six-field shape with oneOf [object, null] for non-in_progress transitions
  - CLI `tasks queue --wave <n>` flag composed into the query string alongside existing --project and --plan
  - MCP `mc_poll_task_queue` tool `wave` input property forwarded to the underlying GET /api/tasks/queue fetch
affects:
  - phase: 20 lane-aware-routing (ROUTE-01 will read scoped queue via MCP/CLI without raw REST)
  - phase: 21 mcp-routing-field-parity (MCP-01..03 will extend beyond the queue-poll surface established here)
  - phase: 23 e2e-acceptance (ACCEPT-01 asserts queue_activation shape end-to-end through the documented contract)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "oneOf [object, null] documents a response field that exists but is null for some request paths (queue_activation is null unless to_status='in_progress')"
    - "MCP scoping params use type: ['string', 'number'] to tolerate both numeric and stringy inputs from JSON-RPC callers; handler normalises via String() + trim() before forwarding"
    - "CLI flags named for human-friendly short form (--project, --plan, --wave) map to canonical REST params (project_id, gsd_plan_id, wave) inside the query-string builder"
    - "Inline 400 replaces generic $ref: BadRequest when endpoint has specific failure modes worth documenting (scope integer validation, cross-filter mismatch)"

key-files:
  created:
    - .planning/phases/19-project-scoped-queue-plan-activation/19-03-SUMMARY.md
  modified:
    - openapi.json
    - scripts/mc-cli.cjs
    - scripts/mc-mcp-server.cjs

key-decisions:
  - "Inline 400 response (not $ref BadRequest) on GET /api/tasks/queue — the two specific failure modes (invalid scope integer, cross-filter project/plan mismatch) warrant endpoint-specific documentation per the Wave 1 contract (QUEUE-01 error messages are loud and specific)."
  - "openapi.json has no events extension (x-events / asyncapi / similar) — gsd.plan.tasks_activated event is documented only via a reference inside the queue_activation schema description pointing to the same payload shape. Creating a new extension scheme is out of scope for Plan 19-03."
  - "CLI help text: added a second usage example (`mc tasks queue --agent Aegis --project 42 --plan 27 --wave 1`) alongside the existing max-capacity example rather than rewriting. Keeps backward-compatible discovery while surfacing the new flags to anyone reading --help."
  - "MCP tool inputSchema — added only `wave`; left existing project_id/gsd_plan_id handling untouched. The WIP already implemented the correct normalisation pattern (undefined/null/empty-string guard + String()/trim())."

patterns-established:
  - "OpenAPI documentation for an optional side-effect payload: oneOf [object, null] + description that names both the triggering condition and the null case. Reusable for any future plan-level side-effect endpoint."
  - "When a WIP already lands N−1 scoping params and the plan only needs to add the Nth, pattern-match the surrounding block exactly rather than re-designing the normalisation logic — preserves cross-param symmetry and avoids subtle string-vs-number coercion drift."

requirements-completed:
  - QUEUE-01
  - QUEUE-02
  - COMPAT-01

# Metrics
duration: 2min
completed: 2026-04-22
---

# Phase 19 Plan 03: CLI / MCP / OpenAPI Surface for Scoped Queue & Plan Activation Summary

**openapi.json, scripts/mc-cli.cjs, and scripts/mc-mcp-server.cjs now document and forward the three queue-scoping params (project_id, gsd_plan_id, wave) and the queue_activation response shape — so agents can drive the Wave 1 contract without raw REST, while legacy unscoped callers keep working unchanged.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-22T01:27:46Z
- **Completed:** 2026-04-22T01:30:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `--wave <n>` flag to `mc tasks queue`, composing it into the REST query string alongside the existing `--project` / `--plan` scoping. Added a second usage example under `--help` showing all three scopes together.
- Added `wave` input property to `mc_poll_task_queue` MCP tool (type: `['string', 'number']`) and wired it through the handler using the same undefined/null/empty-string guard the WIP already established for `project_id` / `gsd_plan_id`.
- Documented `project_id`, `gsd_plan_id`, and `wave` as optional positive-integer query params on GET /api/tasks/queue in openapi.json. Replaced the generic `$ref: BadRequest` with an inline 400 response naming both specific failure modes from QUEUE-01: invalid scope integer and cross-filter project/plan mismatch.
- Documented the `queue_activation` side-effect payload on POST /api/gsd/plans/{plan_id}/transition 200 response — full six-field shape (`activated`, `already_active`, `skipped_by_state`, `reassigned`, `by_status{inbox,assigned}`, `task_ids`) with `oneOf: [object, null]` to cover non-in_progress transitions per the Wave 1 contract.
- Preserved v1.2 runtime parity: all new CLI flags and MCP input properties are optional; omitting them builds a bare `?agent=...` query string identical to pre-v1.3 behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add wave flag to CLI + wave input property to MCP tool** — `02c2ab2` (feat)
2. **Task 2: Document queue scoping params + queue_activation response in openapi.json** — `a2f9d85` (feat)

## Files Created/Modified

- `scripts/mc-cli.cjs` — `tasks queue` handler now adds `&wave=` to the query string when `flags.wave` is set. Usage help block gains a second `tasks queue` example demonstrating `--project`/`--plan`/`--wave` together.
- `scripts/mc-mcp-server.cjs` — `mc_poll_task_queue` inputSchema gains `wave` property (string|number) with a description pointing at `gsd_plans.wave`. Handler destructures `wave` alongside `project_id` / `gsd_plan_id` and forwards it with the same normalisation (undefined/null/empty-string → skip; else `encodeURIComponent(String(wave))`).
- `openapi.json` — GET /api/tasks/queue `parameters` array gains `project_id`, `gsd_plan_id`, and `wave` (all `integer, minimum: 1`). 400 response replaced with inline schema that explicitly names the two failure modes. POST /api/gsd/plans/{plan_id}/transition 200 response gains `queue_activation` property — `oneOf: [object, null]` with full six-field shape when non-null.

## Decisions Made

- **Events extension NOT added to openapi.json.** The file had zero existing `x-events`, `asyncapi`, or equivalent extension (confirmed via `grep -c 'x-events\|"events":'` → 0 matches for events-as-channel patterns in the relevant subsystems). Creating a new extension scheme was explicitly allowed to be deferred per the plan. The `gsd.plan.tasks_activated` event carrying the same `queue_activation` payload is instead referenced inside the `queue_activation` description — callers get the contract link without us inventing a new spec dialect.
- **Inline 400 (not $ref BadRequest) on GET /api/tasks/queue.** The generic BadRequest ref covers "some invalid input" but hides the two very specific failure modes Wave 1 ships: per-scope positive-integer validation and cross-filter project/plan mismatch. CLI/MCP callers debugging a 400 benefit from the spec showing the exact error strings they'll see. Kept $ref for 401/403 (no endpoint-specific information).
- **CLI help example added, not rewritten.** The pre-existing `mc tasks queue --agent Aegis --max-capacity 2` example still represents the most common unscoped call; replacing it would have regressed discoverability for the v1.2-style usage. Adding a second `--project 42 --plan 27 --wave 1` example alongside surfaces the new surface without demoting the simple case.
- **MCP handler normalisation mirrored, not redesigned.** The WIP-authored `project_id` / `gsd_plan_id` handler already uses `undefined/null guard + String(v).trim() !== ''` — the exact pattern to accept JSON-RPC callers that may send stringy or numeric scoping IDs. Copying the block for `wave` preserves symmetry across the three scoping params and avoids introducing a fourth normalisation style.

## Deviations from Plan

None — plan executed exactly as written. The plan's Task 2 direction allowed deferring the event-documentation question pending an openapi.json extension audit; that audit confirmed no extension exists, so deferral was taken per plan direction.

## Issues Encountered

None. Every intermediate check passed first-try:
- Both script files still load as valid CommonJS (`node -e "require('...')"`).
- `node -e "JSON.parse(...)"` on openapi.json returns without throwing.
- `pnpm typecheck` exits 0.
- `node scripts/verify-runtime-docs.mjs` reports 10/10 checks passed — no runtime-docs drift introduced.

## User Setup Required

None — no external service configuration required. CLI and MCP tool work against the existing `/api/tasks/queue` endpoint; openapi.json is documentation-only (served at `/docs`).

## Next Phase Readiness

- QUEUE-01, QUEUE-02, and COMPAT-01 are now reflected on all three external surfaces (spec, CLI, MCP) per Phase 19 Success Criterion #5.
- Phase 20 (ROUTE-01 lane-aware routing) can safely consume `mc_poll_task_queue` with `project_id` / `gsd_plan_id` / `wave` inputs knowing the tool is documented and the REST contract is spec-backed.
- Phase 21 (MCP-01..03 routing-field parity) will extend beyond the queue-poll surface — this plan deliberately scoped its MCP changes to `mc_poll_task_queue` only per CONTEXT.md's "raw IDs, no slug resolution" deferral.
- Phase 23 (ACCEPT-01 end-to-end acceptance) will assert the `queue_activation` shape through the contract now captured in openapi.json.

---

## Self-Check: PASSED

File existence:
- FOUND: openapi.json
- FOUND: scripts/mc-cli.cjs
- FOUND: scripts/mc-mcp-server.cjs
- FOUND: .planning/phases/19-project-scoped-queue-plan-activation/19-03-SUMMARY.md

Commit existence (`git log --oneline | grep <hash>`):
- FOUND: 02c2ab2 (Task 1 — CLI + MCP wave)
- FOUND: a2f9d85 (Task 2 — openapi.json)

Contract reflection:
- `grep -q '"name": "wave"' openapi.json` → match (queue scoping param present)
- `grep -q queue_activation openapi.json` → match (transition response present)
- `grep -n 'flags.wave' scripts/mc-cli.cjs` → line 678 (CLI handler composes wave)
- `grep -n 'wave.*description' scripts/mc-mcp-server.cjs` → line 380 (MCP schema exposes wave)

Runtime-docs drift:
- `node scripts/verify-runtime-docs.mjs` → "10/10 checks passed"

---
*Phase: 19-project-scoped-queue-plan-activation*
*Completed: 2026-04-22*
