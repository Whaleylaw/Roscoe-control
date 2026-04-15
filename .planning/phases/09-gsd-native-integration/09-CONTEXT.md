# Phase 09: Native GSD Integration - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Build first-class GSD lifecycle support directly into Mission Control so every project can be created, tracked, and executed through Discuss → Plan → Execute → Verify → Done phases. Delivers:

- DB schema extensions: GSD columns on `projects` (gsd_enabled, gsd_track, gsd_phase, gsd_gate_mode, gsd_project_id, gsd_updated_at) and `tasks` (gsd_phase, gate_required, gate_status, gate_approved_by, gate_approved_at, depends_on_task_ids)
- Three new API endpoints: `POST /api/projects/:id/gsd/bootstrap`, `POST /api/projects/:id/gsd/transition`, `PATCH /api/tasks/:id/gate`
- Enforcement: tasks with `gate_required=1` cannot move to in_progress/done unless `gate_status='approved'`
- UI controls: dedicated Lifecycle tab in the project workspace + phase badges in the task board
- Tests: CRUD including GSD fields, bootstrap idempotency, transition rules, gate enforcement

**Not in scope:** rewriting the existing GSD CLI internals, dispatching work to Paperclip/OpenClaw from UI clicks, any sync between MC's in-DB GSD state and `.planning/` filesystem artifacts.

</domain>

<decisions>
## Implementation Decisions

### GSD state storage scope
- **D-01:** MC's GSD state is stored in-DB only. Completely independent of the `.planning/` CLI workflow on disk — no file reads, no file writes, no sync.
- **D-02:** `gsd_project_id` is a free-text field. Users can optionally populate it to label the link to an external GSD project (e.g., a slug), but MC does not resolve or validate it.
- **D-03:** If the user later wants `.planning/` sync, it's an additive phase — not in scope here.

### UI integration surface
- **D-04:** A new dedicated "Lifecycle" tab inside the project workspace, alongside Dashboard / Tasks / Sessions / Agents / Settings. Contains phase timeline, current-phase callout, bootstrap button, transition controls, and the list of gate-required tasks with approval/rejection actions.
- **D-05:** Phase badges on task cards in the task board (both global and project-scoped). Badge shows `gsd_phase` value when set; no badge when null (non-GSD tasks unaffected visually).
- **D-06:** Gate-required task cards show a distinct "🔒 Approval required" badge; tasks already approved show "✓ Approved".
- **D-07:** Settings view gets a small GSD section: `gsd_enabled` toggle, `gsd_track` dropdown (ops/product/marketing/legal/firmvault/custom), `gsd_gate_mode` selector (manual_approval/auto_internal). The deep controls live in the Lifecycle tab.
- **D-08:** The Lifecycle tab uses the same URL-driven routing pattern from Phase 01 — `/[project-slug]/lifecycle`.

### Gate approval authorization
- **D-09:** Gate approval endpoint (`PATCH /api/tasks/:id/gate`) requires `operator` or `admin` role via existing `requireRole`. Viewers can read gate state but cannot approve/reject.
- **D-10:** Transition endpoint (`POST /api/projects/:id/gsd/transition`) requires `operator` or `admin` role.
- **D-11:** Bootstrap endpoint (`POST /api/projects/:id/gsd/bootstrap`) requires `operator` or `admin` role.
- **D-12:** Approver identity recorded in `gate_approved_by` as the authenticated user's identifier (session username or API key principal — match the pattern used by existing mutation endpoints).
- **D-13:** Per-project custom approver lists are explicitly out of scope for v1 — future additive phase if needed.

### Bootstrap template source
- **D-14:** Default phase task templates live in external JSON files at `<MISSION_CONTROL_DATA_DIR>/gsd-templates/`.
- **D-15:** Selection rule: if `project.gsd_track` is set (non-null, non-empty), bootstrap loads `<track>.json` (e.g., `ops.json`); otherwise it loads `default.json`.
- **D-16:** Fallback: if the selected file does not exist on disk, MC falls back to a bundled hard-coded default set embedded in source code. The bootstrap endpoint MUST always succeed; missing template files are a soft miss, not an error.
- **D-17:** Template JSON shape: `{ "name": "string", "phases": { "discuss": [ {"ticket_ref": "DISCUSS-01", "title": "...", "gate_required": 0 | 1 } ], "plan": [...], "execute": [...], "verify": [...] } }`. Planner and researcher finalize the exact schema.
- **D-18:** Shipping single bundled `default.json` in v1 (content matches the plan's listed defaults: DISCUSS-01/02, PLAN-01/02, EXEC-01/02, VERIFY-01/02). Track-specific templates are optional and user-authored — MC itself does NOT ship `ops.json`, `product.json`, etc. in v1.
- **D-19:** Bootstrap is idempotent per phase: if a task with the same `ticket_ref` + `gsd_phase` already exists on the project, skip creating a duplicate.

### Non-GSD project UX
- **D-20:** Projects with `gsd_enabled=0` still show the Lifecycle tab — it renders an empty state with a short explainer and an "Enable GSD for this project" CTA.
- **D-21:** Clicking the CTA sets `gsd_enabled=1` via PATCH, then reveals the full Lifecycle tab contents; no page reload.
- **D-22:** Phase badges on task cards appear ONLY when the task has a non-null `gsd_phase`. Non-GSD tasks render identically to today.
- **D-23:** Settings-view GSD section is always visible (even when disabled) so the toggle is discoverable; the `gsd_track` and `gsd_gate_mode` controls are disabled/grayed until `gsd_enabled=1`.

### Transition rules (inherited from 09-00-PLAN.md, re-affirmed)
- **D-24:** discuss → plan: at least one task with `gsd_phase='discuss'` must have `status='done'`.
- **D-25:** plan → execute: at least one task with `gsd_phase='plan'` must have `status='done'` AND `gate_status='approved'` (the "approved plan package" gate).
- **D-26:** execute → verify: all tasks with `gsd_phase='execute'` must have `status='done'` OR an explicit waiver flag on the transition request.
- **D-27:** verify → done: at least one task with `gsd_phase='verify'` and `status='done'`.
- **D-28:** Illegal transitions return HTTP 409 with a machine-readable error code and a human-readable message listing the unmet requirement.
- **D-29:** Waiver on execute → verify is a boolean flag on the transition request body (`{ to_phase: 'verify', waive_remaining: true, reason: 'string' }`) requiring a non-empty `reason`; the waiver + reason is recorded as an activity entry.

### Gate enforcement on task status
- **D-30:** Before a task's status changes to `in_progress` or `done`, the task-update handler checks: if `gate_required=1` AND `gate_status!='approved'`, return HTTP 403 with actionable error text.
- **D-31:** Status changes to `backlog`, `blocked`, `in_review`, or back-to-backlog reassignments are NOT gated — only forward motion to in_progress/done.
- **D-32:** Rejected gates (`gate_status='rejected'`) block the same way as `pending`/`not_required` (with `gate_required=1`). Operator must flip to `approved` to unblock.

### Activity / audit
- **D-33:** Transitions and gate status changes emit events via the existing `eventBus` (same pattern as task mutations). No new audit table in v1.
- **D-34:** Events include: `project.gsd.transition` (fields: from_phase, to_phase, actor, reason, waived), `task.gate.changed` (fields: task_id, gate_status, actor, note).
- **D-35:** Existing `/api/activities` stream picks up these events automatically via the event-bus → SSE pipeline.

### i18n
- **D-36:** All new user-facing strings go through next-intl under a new `project.lifecycle.*` namespace. Atomic 10-locale commit via one-shot Node script (Phase 05/06/08 precedent).
- **D-37:** Brand/jargon terms stay untranslated: "GSD", phase names (`Discuss`, `Plan`, `Execute`, `Verify`, `Done`), track names (`ops`, `product`, etc.).
- **D-38:** Gate status labels ARE translated: "Approval required", "Approved", "Rejected", "Pending approval".

### Claude's Discretion
- Exact visual layout of the Lifecycle tab (timeline vs vertical list vs horizontal stepper) — planner/researcher to pick based on existing Dashboard view patterns.
- Phase badge visual style (pill vs tag vs text) — match existing task-board visual language.
- Error-response body shape (field names, error codes) — match MC's existing API error conventions from recent phases.
- Exact column ordering in the tasks-per-phase section of the Lifecycle tab.
- Whether `depends_on_task_ids` is enforced in bootstrap ordering or just stored — defer to planner.
- Migration ID — next incremental (probably 052, verify against `src/lib/migrations.ts`).

</decisions>

<specifics>
## Specific Ideas

- Track names echo real GSD tracks the user runs: `ops`, `product`, `marketing`, `legal`, `firmvault`, `custom`. Plus `custom` for ad-hoc projects.
- The hand-authored 09-00-PLAN.md is the narrative spec — planner should use it as the starting reference for task/endpoint contracts. This CONTEXT.md clarifies the gray areas that plan left ambiguous.
- The 09-02-COMMIT-SEQUENCE.md proposes a 10-commit sequence (schema → validation → API read → API write → bootstrap → transition → gate enforcement → UI → tests). Planner may re-shape this into waves/tasks, but the ordering intent (schema first, enforcement last) is correct.

</specifics>

<canonical_refs>
## Canonical References

### Phase-local specs (authoritative for scope)
- `.planning/phases/09-gsd-native-integration/09-00-PLAN.md` — hand-authored narrative plan covering schema, endpoints, transition rules, default templates, UI goals, and acceptance criteria
- `.planning/phases/09-gsd-native-integration/09-01-CLAUDE-CODE-PROMPT.md` — execution constraints (backward compat, test coverage, auth preservation)
- `.planning/phases/09-gsd-native-integration/09-02-COMMIT-SEQUENCE.md` — proposed 10-commit sequence (informational, not binding on task decomposition)

### Project-level context
- `.planning/PROJECT.md` — Mission Control vision, core value, stack constraints (Next.js 16, React 19, SQLite, no ORM, no icon libraries, pnpm only)
- `.planning/REQUIREMENTS.md` — validated requirements (projects, tasks, agents, SSE, REST API all existing)
- `.planning/STATE.md` — project state; Phase 09 not yet registered (see Deferred section below)

### Inherited patterns from prior phases
- `.planning/phases/01-foundation/01-00-SUMMARY.md` — URL-driven routing, React context pattern (Lifecycle tab uses same pattern)
- `.planning/phases/02-navigation-workspace-shell/02-01-SUMMARY.md` — WorkspaceContent provider + breadcrumb; Lifecycle tab is a new sibling route
- `.planning/phases/05-sessions-agents/05-01-SUMMARY.md` — scoped API endpoint pattern (union SQL, assignment_source derived in-query) and atomic 10-locale i18n precedent
- `.planning/phases/06-settings/06-01-SUMMARY.md` — settings-view form pattern (per-field useState + useMemo isDirty); new GSD section in settings follows this
- `.planning/phases/08-projects-entry-point/08-05-SUMMARY.md` — post-create chain pattern (nested try/catch with graceful failure warning) — transition endpoint can follow the same pattern on transition failures

### Code conventions (from CLAUDE.md)
- Migrations: `src/lib/migrations.ts` — additive ALTER TABLE pattern, never modify existing migrations
- API auth: `requireRole` in `src/lib/auth.ts` — use consistently on all new endpoints
- Validation: Zod schemas in `src/lib/validation.ts` at the top of mutation handlers
- Event bus: `src/lib/event-bus.ts` — emit after DB writes, SSE picks up automatically
- Prepared statements only (no ORM, no string-interpolated SQL)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`requireRole`** (`src/lib/auth.ts`) — reuse for all three new endpoints. Viewer-blocking semantics already codified.
- **`validateBody`** / Zod patterns (`src/lib/validation.ts`) — extend with GSD enums + payload schemas
- **`eventBus`** (`src/lib/event-bus.ts`) — emit transition/gate events; no new audit table needed
- **`MISSION_CONTROL_DATA_DIR`** env var (referenced in `src/lib/paths.ts`) — canonical location for the `gsd-templates/` directory
- **Settings view** (`src/components/project/settings-view.tsx`) — add new GSD section using the per-field-useState pattern from Phase 06
- **Project workspace shell** (`src/components/project/project-workspace.tsx` + `project-tabs.tsx`) — register new "Lifecycle" tab
- **Task card rendering** in `task-board-panel.tsx` — inject phase badge next to existing task metadata
- **Migrations table `idx_*` convention** — follow `idx_projects_*` / `idx_tasks_*` naming

### Established Patterns
- **Scoped API routes**: `/api/projects/:id/*` routes already exist (e.g., `/sessions`). New GSD routes follow the same nesting.
- **Atomic i18n**: 10-locale changes via one-shot Node script, `{...rest}` spread for race-safety with parallel locale writes (Phase 08 precedent).
- **Additive migrations**: ALTER TABLE with new columns + CREATE INDEX IF NOT EXISTS. Never modify old migrations.
- **PATCH over PUT** for partial updates is NOT the convention here — projects use PATCH, tasks use PUT (Phase 04 pitfall #1). Gate endpoint uses PATCH (aligns with project convention; planner to confirm task-gate endpoint HTTP verb during planning).

### Integration Points
- **Project workspace tab registry**: add `Lifecycle` as a new tab key alongside `dashboard | tasks | sessions | agents | settings`
- **Task-board card renderer**: phase-badge component slots into existing task card metadata row
- **Settings-view section list**: append new "GSD lifecycle" section after existing sections
- **`/api/index/route.ts`**: document three new endpoints so they surface in the OpenAPI/interactive docs
- **Migration file order**: new migration goes at the end of `src/lib/migrations.ts` with the next incremental ID

</code_context>

<deferred>
## Deferred Ideas

### Roadmap registration (pre-planning housekeeping)
- Phase 09 is not yet in `.planning/ROADMAP.md`. Before executing plans, either (a) run `/gsd:add-phase 09` to register Phase 09 in the current (v1.0) milestone, or (b) run `/gsd:new-milestone` to open v1.1 and register Phase 09 there. User choice — plan-phase can proceed without it, but executor's STATE.md progress tracking expects a roadmap entry.

### Explicit out-of-scope items (re-affirmed, not lost)
- **`.planning/` filesystem sync** — additive phase if needed later (D-01)
- **Per-project custom approver lists** — future phase (D-13)
- **Track-specific template files shipped with MC** — user-authored or future phase (D-18)
- **Dispatching work to external agents (Paperclip/OpenClaw) from UI** — out of scope per 09-01-CLAUDE-CODE-PROMPT.md
- **Rewriting GSD CLI internals** — out of scope per 09-00-PLAN.md non-goals

### Ideas that may belong in future phases
- Bulk approve/reject gates from the Lifecycle tab (v1 is one-at-a-time)
- Phase templates marketplace / share-to-other-project
- Timeline visualization of transitions (v1 is current-phase + list)
- Slack/email notification when a gate becomes pending

</deferred>

---

*Phase: 09-gsd-native-integration*
*Context gathered: 2026-04-14*
