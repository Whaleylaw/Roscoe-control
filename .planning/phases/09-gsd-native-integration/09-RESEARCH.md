# Phase 9: GSD Native Integration — Research

**Researched:** 2026-04-14
**Domain:** Full-stack feature — SQLite migration + REST API endpoints (Next.js 16 App Router) + React 19 UI (Tailwind/Zustand) + Vitest/Playwright tests + atomic 10-locale i18n
**Confidence:** HIGH (all authoritative files directly inspected; no speculative claims)

## Summary

Phase 9 is a well-scoped vertical feature that cuts through every layer of Mission Control: one additive migration (052), three new API endpoints, one cross-cutting enforcement point inside `PUT /api/tasks/[id]`, a new tab in the project workspace, two new task-card badge slots, a new settings section, and an atomic i18n update across 10 locale files.

Every pattern Phase 9 needs is already codified by phases 1-8 and directly reusable with minimal adaptation: additive-migration-with-PRAGMA-guard (027/028), `requireRole` + `ensureTenantWorkspaceAccess` on every mutation endpoint, `body?.field !== undefined` manual field gate inside PATCH handlers, Zod+`validateBody` for POST bodies, `eventBus.broadcast()` to emit SSE events, `FieldBlock` + per-field `useState` + `useMemo` dirty check for forms, and the `text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono` ticket-ref geometry for new badges. Templates are loaded from `<config.dataDir>/gsd-templates/<track>.json` with a Zod-validated shape and an inline bundled fallback.

**Primary recommendation:** Follow the UI-SPEC and 10-commit sequence literally; treat the ambiguous items as closed (migration ID `052`, `bg-primary/15` phase badge, gate-block hook at `src/app/api/tasks/[id]/route.ts:172`). Organize into 4 waves: Wave 0 (test scaffolds + en.json seed), Wave 1 schema+validation+i18n atomic, Wave 2 API endpoints (parallelizable: bootstrap / transition / gate / project-CRUD-extension), Wave 3 UI (parallelizable: task-board badges / Lifecycle tab / settings section) + gate enforcement hook, Wave 4 verification sweep.

## Project Constraints (from CLAUDE.md)

| Directive | Enforcement |
|-----------|-------------|
| Package manager | **pnpm only** — never npm/yarn in commands, scripts, or docs |
| Icons | **No icon libraries** — use raw text/emoji (`🔒`, `✓`, `→`) inline per UI-SPEC |
| i18n | **All user-facing strings via next-intl** — `project.lifecycle.*` namespace, 10 locales atomic |
| Commits | **Conventional Commits** (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`) |
| Commit trailers | **No `Co-Authored-By` or other AI attribution** — hard rule |
| Stack | Next.js 16 App Router, React 19, TypeScript 5, SQLite via `better-sqlite3` (no ORM), Tailwind 3, Zustand 5 |
| SQL | **Prepared statements only** — no string interpolation into SQL |
| Path alias | `@/*` → `./src/*` everywhere, no relative paths between feature areas |
| Standalone | `next.config.js` sets `output: 'standalone'` — do not break |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**GSD state storage scope**
- **D-01:** MC's GSD state is stored in-DB only. Completely independent of the `.planning/` CLI workflow on disk — no file reads, no file writes, no sync.
- **D-02:** `gsd_project_id` is a free-text field. Users can optionally populate it to label the link to an external GSD project (e.g., a slug), but MC does not resolve or validate it.
- **D-03:** If the user later wants `.planning/` sync, it's an additive phase — not in scope here.

**UI integration surface**
- **D-04:** A new dedicated "Lifecycle" tab inside the project workspace, alongside Dashboard / Tasks / Sessions / Agents / Settings. Contains phase timeline, current-phase callout, bootstrap button, transition controls, and the list of gate-required tasks with approval/rejection actions.
- **D-05:** Phase badges on task cards in the task board (both global and project-scoped). Badge shows `gsd_phase` value when set; no badge when null (non-GSD tasks unaffected visually).
- **D-06:** Gate-required task cards show a distinct "🔒 Approval required" badge; tasks already approved show "✓ Approved".
- **D-07:** Settings view gets a small GSD section: `gsd_enabled` toggle, `gsd_track` dropdown (ops/product/marketing/legal/firmvault/custom), `gsd_gate_mode` selector (manual_approval/auto_internal). The deep controls live in the Lifecycle tab.
- **D-08:** The Lifecycle tab uses the same URL-driven routing pattern from Phase 01 — `/[project-slug]/lifecycle`.

**Gate approval authorization**
- **D-09:** Gate approval endpoint (`PATCH /api/tasks/:id/gate`) requires `operator` or `admin` role via existing `requireRole`. Viewers can read gate state but cannot approve/reject.
- **D-10:** Transition endpoint (`POST /api/projects/:id/gsd/transition`) requires `operator` or `admin` role.
- **D-11:** Bootstrap endpoint (`POST /api/projects/:id/gsd/bootstrap`) requires `operator` or `admin` role.
- **D-12:** Approver identity recorded in `gate_approved_by` as the authenticated user's identifier (session username or API key principal — match the pattern used by existing mutation endpoints).
- **D-13:** Per-project custom approver lists are explicitly out of scope for v1 — future additive phase if needed.

**Bootstrap template source**
- **D-14:** Default phase task templates live in external JSON files at `<MISSION_CONTROL_DATA_DIR>/gsd-templates/`.
- **D-15:** Selection rule: if `project.gsd_track` is set (non-null, non-empty), bootstrap loads `<track>.json` (e.g., `ops.json`); otherwise it loads `default.json`.
- **D-16:** Fallback: if the selected file does not exist on disk, MC falls back to a bundled hard-coded default set embedded in source code. The bootstrap endpoint MUST always succeed; missing template files are a soft miss, not an error.
- **D-17:** Template JSON shape: `{ "name": "string", "phases": { "discuss": [ {"ticket_ref": "DISCUSS-01", "title": "...", "gate_required": 0 | 1 } ], "plan": [...], "execute": [...], "verify": [...] } }`.
- **D-18:** Shipping single bundled `default.json` in v1 (content matches the plan's listed defaults: DISCUSS-01/02, PLAN-01/02, EXEC-01/02, VERIFY-01/02). Track-specific templates are optional and user-authored — MC itself does NOT ship `ops.json`, `product.json`, etc. in v1.
- **D-19:** Bootstrap is idempotent per phase: if a task with the same `ticket_ref` + `gsd_phase` already exists on the project, skip creating a duplicate.

**Non-GSD project UX**
- **D-20:** Projects with `gsd_enabled=0` still show the Lifecycle tab — it renders an empty state with a short explainer and an "Enable GSD for this project" CTA.
- **D-21:** Clicking the CTA sets `gsd_enabled=1` via PATCH, then reveals the full Lifecycle tab contents; no page reload.
- **D-22:** Phase badges on task cards appear ONLY when the task has a non-null `gsd_phase`. Non-GSD tasks render identically to today.
- **D-23:** Settings-view GSD section is always visible (even when disabled) so the toggle is discoverable; the `gsd_track` and `gsd_gate_mode` controls are disabled/grayed until `gsd_enabled=1`.

**Transition rules**
- **D-24:** discuss → plan: at least one task with `gsd_phase='discuss'` must have `status='done'`.
- **D-25:** plan → execute: at least one task with `gsd_phase='plan'` must have `status='done'` AND `gate_status='approved'`.
- **D-26:** execute → verify: all tasks with `gsd_phase='execute'` must have `status='done'` OR an explicit waiver flag on the transition request.
- **D-27:** verify → done: at least one task with `gsd_phase='verify'` and `status='done'`.
- **D-28:** Illegal transitions return HTTP 409 with a machine-readable error code and a human-readable message listing the unmet requirement.
- **D-29:** Waiver on execute → verify is a boolean flag on the transition request body (`{ to_phase: 'verify', waive_remaining: true, reason: 'string' }`) requiring a non-empty `reason`; the waiver + reason is recorded as an activity entry.

**Gate enforcement on task status**
- **D-30:** Before a task's status changes to `in_progress` or `done`, the task-update handler checks: if `gate_required=1` AND `gate_status!='approved'`, return HTTP 403 with actionable error text.
- **D-31:** Status changes to `backlog`, `blocked`, `in_review`, or back-to-backlog reassignments are NOT gated — only forward motion to in_progress/done.
- **D-32:** Rejected gates (`gate_status='rejected'`) block the same way as `pending`/`not_required` (with `gate_required=1`). Operator must flip to `approved` to unblock.

**Activity / audit**
- **D-33:** Transitions and gate status changes emit events via the existing `eventBus` (same pattern as task mutations). No new audit table in v1.
- **D-34:** Events include: `project.gsd.transition` (fields: from_phase, to_phase, actor, reason, waived), `task.gate.changed` (fields: task_id, gate_status, actor, note).
- **D-35:** Existing `/api/activities` stream picks up these events automatically via the event-bus → SSE pipeline.

**i18n**
- **D-36:** All new user-facing strings go through next-intl under a new `project.lifecycle.*` namespace. Atomic 10-locale commit via one-shot Node script (Phase 05/06/08 precedent).
- **D-37:** Brand/jargon terms stay untranslated: "GSD", phase names (`Discuss`, `Plan`, `Execute`, `Verify`, `Done`), track names (`ops`, `product`, etc.).
- **D-38:** Gate status labels ARE translated: "Approval required", "Approved", "Rejected", "Pending approval".

### Claude's Discretion

- Exact visual layout of the Lifecycle tab — **resolved by UI-SPEC:** horizontal stepper + stacked sections.
- Phase badge visual style — **resolved by UI-SPEC:** tag (same geometry as ticket_ref badge).
- Error-response body shape — **recommended below** in `## Error Response Shape`.
- Exact column ordering in the tasks-per-phase section — **resolved by UI-SPEC:** ticket_ref → title → gate status pill → action buttons.
- Whether `depends_on_task_ids` is enforced in bootstrap ordering or just stored — **recommended below:** STORE only in v1; enforcement is a future phase. v1 default template has no dependencies.
- Migration ID — **verified:** `052_gsd_native_integration` (last existing is `051_project_workspace_indexes`).

### Deferred Ideas (OUT OF SCOPE)

- `.planning/` filesystem sync (D-01, D-03)
- Per-project custom approver lists (D-13)
- Track-specific template files shipped with MC itself (D-18 — user-authored only)
- Dispatching work to external agents (Paperclip/OpenClaw) from UI
- Rewriting GSD CLI internals
- Bulk approve/reject gates from Lifecycle tab (v1 is one-at-a-time)
- Phase templates marketplace / share-to-other-project
- Timeline visualization of past transitions (v1 is current-phase + list only)
- Slack/email notification when gate becomes pending
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GSD-01 | Projects: `gsd_enabled` flag + `gsd_track` enum at create/update | Migration 052 + POST/PATCH extensions to `src/app/api/projects/route.ts` and `src/app/api/projects/[id]/route.ts` (`## Project API Extensions`) |
| GSD-02 | Projects: `gsd_phase` tracked with backward-compatible default `'discuss'` | Migration 052: `ALTER TABLE projects ADD COLUMN gsd_phase TEXT NOT NULL DEFAULT 'discuss'` (`## Migration 052 Exact SQL`) |
| GSD-03 | Projects: `gsd_gate_mode` enum (`manual_approval`/`auto_internal`) default `manual_approval` | Migration 052 column + Zod enum in `validation.ts` |
| GSD-04 | Tasks: `gsd_phase` + `gate_required` flag | Migration 052: nullable `gsd_phase` TEXT + `gate_required INTEGER NOT NULL DEFAULT 0` |
| GSD-05 | Tasks: `gate_status` + `gate_approved_by` + `gate_approved_at` | Migration 052 columns; `gate_status` default `'not_required'` (`## Migration 052 Exact SQL`) |
| GSD-06 | Migrations additive & safe on existing DBs | Pattern: `hasCol()` PRAGMA guard from migrations 027/028; never modify prior migrations |
| GSD-07 | `POST /api/projects/:id/gsd/bootstrap` idempotent | Pattern: Zod body schema + dedupe via `SELECT 1 FROM tasks WHERE project_id=? AND gsd_phase=? AND ticket_ref=?` per ticket_ref (`## Bootstrap Endpoint — Algorithm`) |
| GSD-08 | `POST /api/projects/:id/gsd/transition` with enforced ordering | Transition-rule SQL in `## Transition Endpoint — Rule Enforcement` |
| GSD-09 | Transition rejects illegal jumps with machine-readable code | `## Error Response Shape` — HTTP 409 + `code` field |
| GSD-10 | Transition supports waiver flag on execute→verify with required reason | `## Transition Endpoint — Rule Enforcement` (Execute→Verify case) |
| GSD-11 | `PATCH /api/tasks/:id/gate` records approver + timestamp | `## Gate Approval Endpoint` — records `auth.user.username` + `unixepoch()` |
| GSD-12 | All 3 new endpoints require operator/admin; viewers can read gate state | `requireRole(request, 'operator')` — same pattern as `src/app/api/projects/route.ts:72` |
| GSD-13 | Project/task read endpoints include new GSD fields | Extend SELECT in `src/app/api/projects/route.ts:40`, `src/app/api/projects/[id]/route.ts:52`, `src/app/api/tasks/route.ts`, `src/app/api/tasks/[id]/route.ts:62` |
| GSD-14 | Project create/update accepts GSD fields with validation | Extend POST body handling in `src/app/api/projects/route.ts:91-99` and PATCH in `[id]/route.ts:121-175` with same `body?.field !== undefined` pattern |
| GSD-15 | `gate_required=1` + `gate_status!='approved'` returns 403 on status→in_progress/done | Hook inside `src/app/api/tasks/[id]/route.ts:172-181` immediately before or after the existing Aegis check |
| GSD-16 | Gate enforcement forward motion only | Explicit `['in_progress', 'done'].includes(normalizedStatus)` check — not applied to `backlog`, `blocked`, `in_review` |
| GSD-17 | Bootstrap loads templates from `<MISSION_CONTROL_DATA_DIR>/gsd-templates/<track>.json` or `default.json` | `config.dataDir` from `src/lib/config.ts:73` → `path.join(config.dataDir, 'gsd-templates', `${track}.json`)` |
| GSD-18 | Bundled fallback default template | Inline `DEFAULT_TEMPLATE` const in `src/lib/gsd-templates.ts` (new file) |
| GSD-19 | Idempotent per `ticket_ref` + `gsd_phase` | Dedupe SQL above |
| GSD-20 | Lifecycle tab at `/[slug]/lifecycle` | Modify `src/components/project/project-tabs.tsx:8` VIEWS tuple + `project-view-router.tsx` switch |
| GSD-21 | Shows current phase, timeline, bootstrap, transition | `LifecycleView` component per UI-SPEC layout |
| GSD-22 | Inline approve/reject actions (operator+) | `GateTaskRow` component with role-gated buttons |
| GSD-23 | Non-GSD: empty state + Enable CTA | `LifecycleEmptyState` component |
| GSD-24 | Task board shows phase badges when `gsd_phase!==null` | Insert between `task-board-panel.tsx:1050` (after ticket_ref `</span>`) and existing github-issue badge |
| GSD-25 | Gate-required tasks show "Approval required"/"Approved" | Same badge slot; two-branch render based on `gate_status` |
| GSD-26 | Settings view: enable toggle + track dropdown + gate-mode selector | Append section to `settings-view.tsx` after line 477 |
| GSD-27 | Section always visible; track/gate-mode disabled until enabled | Standard `disabled={!gsdEnabled}` on controls; section itself unconditional |
| GSD-28 | Events via existing `eventBus`: `project.gsd.transition`, `task.gate.changed` | `eventBus.broadcast()` pattern from `src/app/api/tasks/[id]/route.ts:400` + expand `EventType` union in `event-bus.ts:15` |
| GSD-29 | All strings via next-intl, `project.lifecycle.*`, 10 locales atomic | Phase 05/06/08 one-shot Node script pattern (`## i18n Update — One-Shot Node Script Pattern`) |
</phase_requirements>

## Standard Stack

All required libraries are already in `package.json`. Phase 9 adds NO new dependencies.

### Core (already installed, already used)

| Library | Version (from package.json) | Purpose | Why Standard |
|---------|-----------------------------|---------|--------------|
| `better-sqlite3` | 12.6.x | Migration 052 and all DB reads/writes | Project-wide DB engine, synchronous + prepared statements |
| `zod` | 4.3.x | Validation schemas for bootstrap/transition/gate bodies | Already used in `validation.ts`, paired with `validateBody` helper |
| `next-intl` | 4.8.x | All user-facing strings | Phase 05/06/08 established the one-shot 10-locale atomic commit pattern |
| `next` | 16.1.x (App Router) | All three new route handlers live under `src/app/api/...` | Existing convention |
| React | 19.0.x | New components under `src/components/project/lifecycle/` | Existing convention |
| `vitest` | 2.1.x | Unit tests: migration guard, validation schemas, bootstrap idempotency, transition rules, gate enforcement | Co-located `__tests__/` directories (see `src/lib/__tests__/`, `src/app/api/projects/__tests__/`) |
| `@playwright/test` | 1.51.x | E2E: full lifecycle flow (create → bootstrap → illegal transition → legal transition → gate block → approve) | `tests/projects-crud.spec.ts` is the nearest template |
| `class-variance-authority` + `tailwind-merge` + `clsx` | existing | `Button` with `success`/`destructive` variants already defined | Confirmed in `src/components/ui/button.tsx` |

### Don't add

| Tempting | Reason to NOT add |
|----------|-------------------|
| A state machine library (xstate, robot) | Five phases, four transitions, four rules. Manual switch is ~40 lines and easier to test. |
| An ORM / query builder | CLAUDE.md bans ORMs — project uses raw prepared statements. |
| A JSON schema validator (ajv, etc.) | Zod is already the standard for payload validation in `validation.ts`. Template-file shape is validated with a Zod schema. |
| An icon library | CLAUDE.md hard rule. Use `🔒`, `✓`, `→` inline. |
| A new notifications library | D-33/D-34/D-35: reuse existing `eventBus` + `/api/activities` stream. |

### Version verification

No new packages — all versions verified against `package.json`.

## Architecture Patterns

### Recommended file structure

```
src/
├── app/api/
│   ├── projects/
│   │   ├── [id]/
│   │   │   └── gsd/
│   │   │       ├── bootstrap/route.ts       ← NEW (POST)
│   │   │       └── transition/route.ts      ← NEW (POST)
│   │   │       └── __tests__/
│   │   │           ├── bootstrap.test.ts    ← NEW (vitest)
│   │   │           └── transition.test.ts   ← NEW (vitest)
│   │   ├── [id]/route.ts                    ← MODIFY (PATCH accepts GSD fields, GET returns them)
│   │   └── route.ts                         ← MODIFY (GET + POST include GSD fields)
│   └── tasks/
│       └── [id]/
│           ├── gate/route.ts                ← NEW (PATCH)
│           ├── route.ts                     ← MODIFY (gate enforcement at line 172)
│           └── __tests__/
│               ├── gate.test.ts             ← NEW
│               └── status-gate-block.test.ts ← NEW
│   └── index/route.ts                       ← MODIFY (document 3 new endpoints)
├── components/
│   ├── project/
│   │   ├── lifecycle/                       ← NEW SUBDIR (mirrors project/dashboard/)
│   │   │   ├── lifecycle-view.tsx
│   │   │   ├── phase-timeline.tsx
│   │   │   ├── current-phase-callout.tsx
│   │   │   ├── gate-task-list.tsx
│   │   │   ├── gate-task-row.tsx
│   │   │   ├── empty-state.tsx
│   │   │   └── __tests__/
│   │   ├── project-tabs.tsx                 ← MODIFY (add 'lifecycle' to VIEWS)
│   │   ├── project-view-router.tsx          ← MODIFY (dispatch lifecycle case)
│   │   └── settings-view.tsx                ← MODIFY (append GSD section after line 477)
│   └── panels/
│       └── task-card/                       ← NEW SUBDIR (extract reusable card bits)
│           ├── phase-badge.tsx
│           └── gate-badge.tsx
├── lib/
│   ├── migrations.ts                        ← MODIFY (append migration 052 at line 1440)
│   ├── validation.ts                        ← MODIFY (append enums + schemas)
│   ├── event-bus.ts                         ← MODIFY (expand EventType union)
│   ├── gsd-templates.ts                     ← NEW (loader + bundled fallback + Zod validator)
│   └── __tests__/
│       ├── gsd-templates.test.ts            ← NEW
│       └── validation-gsd.test.ts           ← NEW (extend existing validation.test.ts or parallel file)
└── app/api/projects/__tests__/
    └── projects-crud-gsd.test.ts            ← NEW (project GET/POST/PATCH with GSD fields)

messages/                                    ← MODIFY (all 10 locales, atomically)
├── en.json, de.json, es.json, fr.json, ja.json, ko.json, pt.json, ru.json, ar.json, zh.json

.planning/phases/09-gsd-native-integration/  ← DOCS (unchanged)
tests/
└── gsd-lifecycle.spec.ts                    ← NEW Playwright E2E
```

### Pattern 1: Additive migration with PRAGMA guard

**What:** Append to `src/lib/migrations.ts` — new `{ id: '052_gsd_native_integration', up(db) { ... } }` entry.
**When to use:** Every new column/index for existing tables.
**Example (exact pattern from migration 028 at line 841):**

```ts
// Source: src/lib/migrations.ts:841-866 (migration 028_github_sync_v2)
{
  id: '052_gsd_native_integration',
  up(db: Database.Database) {
    const projCols = db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>
    const hasProjCol = (name: string) => projCols.some((c) => c.name === name)
    if (!hasProjCol('gsd_enabled')) db.exec(`ALTER TABLE projects ADD COLUMN gsd_enabled INTEGER NOT NULL DEFAULT 0`)
    // ... etc
  }
}
```

The PRAGMA guard is defensive — migrations run once, but re-applying is a no-op on fresh DBs where schema.sql might already create the column in the future. Matches the exact style of migrations 027 and 028.

### Pattern 2: Scoped API route nesting

**What:** New routes live at `src/app/api/projects/[id]/gsd/<action>/route.ts`.
**When to use:** Any per-project endpoint.
**Reference:** `src/app/api/projects/[id]/sessions/route.ts` and `src/app/api/projects/[id]/tasks/route.ts` — same shape.

Standard preamble every new route MUST include (inferred from `src/app/api/projects/route.ts:71-89`):

```ts
const auth = requireRole(request, 'operator')
if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

const rateCheck = mutationLimiter(request)
if (rateCheck) return rateCheck

const db = getDatabase()
const workspaceId = auth.user.workspace_id ?? 1
const tenantId = auth.user.tenant_id ?? 1
const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
  actor: auth.user.username,
  actorId: auth.user.id,
  route: '/api/projects/[id]/gsd/bootstrap',  // or transition, gate
  ipAddress: forwardedFor,
  userAgent: request.headers.get('user-agent'),
})
```

### Pattern 3: Validation — Zod + `validateBody`

**What:** `validateBody(request, schema)` returns `{ data } | { error }`.
**When to use:** Every POST/PATCH with a structured body.
**Example (from `src/app/api/tasks/[id]/route.ts:102`):**

```ts
const validated = await validateBody(request, transitionSchema)
if ('error' in validated) return validated.error
const body = validated.data
```

### Pattern 4: PATCH field-gating

**What:** Inspect `body?.field !== undefined` before including in the UPDATE.
**When to use:** Partial updates on projects.
**Example (from `src/app/api/projects/[id]/route.ts:121-175`):**

```ts
const updates: string[] = []
const paramsList: Array<string | number | null> = []
if (body?.gsd_enabled !== undefined) {
  updates.push('gsd_enabled = ?')
  paramsList.push(body.gsd_enabled ? 1 : 0)
}
// ... then:
updates.push('updated_at = unixepoch()')
db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`)
  .run(...paramsList, projectId, workspaceId)
```

### Pattern 5: Broadcast after mutation

**What:** `eventBus.broadcast('type.name', payload)` after successful DB write.
**When to use:** Anything user-visible in real-time.
**Example (from `src/app/api/tasks/[id]/route.ts:400`):**

```ts
eventBus.broadcast('task.updated', parsedTask)
```

The EventType union in `src/lib/event-bus.ts:15` MUST be extended to include the two new types. TypeScript will fail compilation otherwise.

### Pattern 6: Activity log for audit

**What:** `db_helpers.logActivity(type, entity_type, entity_id, actor, description, data, workspaceId)` — inserts into `activities` table.
**When to use:** Transition + gate changes (D-33 audit).
**Example (from `src/app/api/tasks/[id]/route.ts:365`):**

```ts
db_helpers.logActivity(
  'project_gsd_transition',
  'project',
  projectId,
  auth.user.username,
  `GSD phase: ${fromPhase} → ${toPhase}${waived ? ' (waived)' : ''}`,
  { from_phase: fromPhase, to_phase: toPhase, waived: !!waived, reason: body.reason || null },
  workspaceId
)
```

`/api/activities` surfaces this automatically (D-35).

### Pattern 7: Form state (settings section)

**What:** Per-field `useState` + `useMemo` dirty derivation + single PATCH on save.
**When to use:** The GSD settings section in `settings-view.tsx`.
**Reference:** `src/components/project/settings-view.tsx:89-130` — follow verbatim for the 3 new fields (`gsd_enabled`, `gsd_track`, `gsd_gate_mode`). Extend the `isDirty` useMemo with three new comparisons, extend the `save()` PATCH body, extend the seeding `useEffect` to initialize them from `project`.

### Anti-Patterns to Avoid

- **Cross-file SQL reuse via string building.** Never build SQL with `+`; always use prepared-statement positional placeholders.
- **Emitting events before DB commit succeeds.** The broadcast MUST follow the `.run()` call.
- **Reading ticket_ref from tasks.ticket_ref (there's no such column).** It's derived: `ticket_ref = ${project.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`. See `src/app/api/tasks/[id]/route.ts:14-17`. Phase 9 bootstrap stores the LOGICAL ticket_ref like `DISCUSS-01` in a DIFFERENT field (inside the template) AND assigns the project's own ticket_counter-derived ticket_ref via the normal task-creation path. **Important: the bootstrap MUST increment `projects.ticket_counter` for each task it creates, same way task create does.**
- **Assuming Zod default means "required to send".** Zod `.default()` means "if omitted, fill in"; the field is still optional on the wire.
- **PUT vs PATCH confusion.** Tasks use `PUT` (full-resource update semantics, partial fields allowed). Projects use `PATCH`. Gate endpoint: use `PATCH` per D-09 spec (`PATCH /api/tasks/:id/gate`).
- **Hand-rolling `project.gsd_phase` allowed-transitions table.** Just a static `NEXT_PHASE: Record<Phase, Phase | null>` map.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request body validation | Custom `typeof` switch statements | Zod schema + `validateBody` from `src/lib/validation.ts` | Already-standard, returns consistent 400 with issue details |
| Role auth | New middleware | `requireRole(request, 'operator')` at top of handler | Single source of truth; viewer/operator/admin hierarchy in `auth.ts:623` |
| Tenant/workspace isolation | Custom SQL WHERE pile | `ensureTenantWorkspaceAccess()` helper, already called on every project endpoint | Consistent cross-tenant guard + audit on failure |
| Rate limiting | Custom bucket | `mutationLimiter(request)` returns response directly if hit | Same pattern as projects/tasks |
| Activity log table | New audit table | `db_helpers.logActivity()` writes to existing `activities` table | D-33 — no new audit surface this phase |
| SSE broadcast | Custom listener | `eventBus.broadcast()` + expand `EventType` union | Already piped to `/api/events` SSE stream |
| Slug parsing / normalization | Custom functions | Existing `slugify()`/`normalizePrefix()` (projects route) — not relevant here but for reference |
| Idempotent INSERT | Custom "try/catch UNIQUE error" | `INSERT ... SELECT ... WHERE NOT EXISTS (...)` OR pre-check `SELECT 1 FROM ... LIMIT 1` | The pre-check pattern is clearer for "skip if seen" semantics needed by bootstrap |
| 10-locale JSON editing | 10 separate manual edits | One-shot Node script with JSON.parse → insert keys → JSON.stringify → write (see Phase 05/06/08 precedent) | Prevents drift, preserves insertion order |

**Key insight:** Phase 9 is 80% wiring and 20% new logic. The new logic (transition rules, gate enforcement, bootstrap dedupe) is tiny and specific — don't reach for libraries.

## Migration 052 — Exact SQL

Append to `src/lib/migrations.ts` at line 1440, immediately before the closing `]` of the `migrations` array:

```ts
{
  id: '052_gsd_native_integration',
  up(db: Database.Database) {
    // GSD-01, GSD-02, GSD-03: project-level GSD columns
    const projCols = db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>
    const hasProjCol = (n: string) => projCols.some((c) => c.name === n)
    if (!hasProjCol('gsd_enabled'))     db.exec(`ALTER TABLE projects ADD COLUMN gsd_enabled INTEGER NOT NULL DEFAULT 0`)
    if (!hasProjCol('gsd_track'))       db.exec(`ALTER TABLE projects ADD COLUMN gsd_track TEXT`)
    if (!hasProjCol('gsd_phase'))       db.exec(`ALTER TABLE projects ADD COLUMN gsd_phase TEXT NOT NULL DEFAULT 'discuss'`)
    if (!hasProjCol('gsd_gate_mode'))   db.exec(`ALTER TABLE projects ADD COLUMN gsd_gate_mode TEXT NOT NULL DEFAULT 'manual_approval'`)
    if (!hasProjCol('gsd_project_id'))  db.exec(`ALTER TABLE projects ADD COLUMN gsd_project_id TEXT`)
    if (!hasProjCol('gsd_updated_at'))  db.exec(`ALTER TABLE projects ADD COLUMN gsd_updated_at INTEGER`)

    // GSD-04, GSD-05: task-level GSD columns
    const taskCols = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>
    const hasTaskCol = (n: string) => taskCols.some((c) => c.name === n)
    if (!hasTaskCol('gsd_phase'))           db.exec(`ALTER TABLE tasks ADD COLUMN gsd_phase TEXT`)
    if (!hasTaskCol('gate_required'))       db.exec(`ALTER TABLE tasks ADD COLUMN gate_required INTEGER NOT NULL DEFAULT 0`)
    if (!hasTaskCol('gate_status'))         db.exec(`ALTER TABLE tasks ADD COLUMN gate_status TEXT NOT NULL DEFAULT 'not_required'`)
    if (!hasTaskCol('gate_approved_by'))    db.exec(`ALTER TABLE tasks ADD COLUMN gate_approved_by TEXT`)
    if (!hasTaskCol('gate_approved_at'))    db.exec(`ALTER TABLE tasks ADD COLUMN gate_approved_at INTEGER`)
    if (!hasTaskCol('depends_on_task_ids')) db.exec(`ALTER TABLE tasks ADD COLUMN depends_on_task_ids TEXT`)  // JSON array

    // Indexes for lookup hot-paths
    db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_gsd_phase ON projects(gsd_phase)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_gsd_phase ON tasks(gsd_phase)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_gate_status ON tasks(gate_status)`)
    // Composite for the most common bootstrap-dedupe query (project_id, gsd_phase)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_gsd_phase ON tasks(project_id, gsd_phase)`)
  }
}
```

**Why `INTEGER NOT NULL DEFAULT 0` for booleans, not BOOLEAN:** SQLite does not have a boolean type; project uses `0/1 INTEGER` (see `projects.github_sync_enabled` at migrations.ts:864, `tasks.retry_count` at migrations.ts:800).

**Why `'discuss'` default on `gsd_phase`:** Matches CONTEXT.md D-24 and plan spec; even non-GSD projects get it without cost. The `gsd_enabled=0` flag is the real "is this project using GSD" gate — `gsd_phase` is just always-populated structural data.

**Why `'not_required'` default on `gate_status`:** Matches the enum set `not_required | pending | approved | rejected`. Tasks with `gate_required=0` stay at `not_required`, which never triggers block logic (D-30).

## Validation Schemas — Append to `src/lib/validation.ts`

```ts
// Append after line 200 (end of existing schemas)
export const GSD_PHASES = ['discuss', 'plan', 'execute', 'verify', 'done'] as const
export const GSD_TRACKS = ['ops', 'product', 'marketing', 'legal', 'firmvault', 'custom'] as const
export const GSD_GATE_MODES = ['manual_approval', 'auto_internal'] as const
export const GSD_GATE_STATUSES = ['not_required', 'pending', 'approved', 'rejected'] as const

export const gsdPhaseSchema = z.enum(GSD_PHASES)
export const gsdTrackSchema = z.enum(GSD_TRACKS)
export const gsdGateModeSchema = z.enum(GSD_GATE_MODES)
export const gsdGateStatusSchema = z.enum(GSD_GATE_STATUSES)

// POST /api/projects/:id/gsd/transition body
export const transitionSchema = z.object({
  to_phase: gsdPhaseSchema,
  reason: z.string().max(1000).optional(),
  waive_remaining: z.boolean().optional(),
}).refine(
  (v) => !v.waive_remaining || (v.reason && v.reason.trim().length > 0),
  { message: 'reason is required when waive_remaining is true', path: ['reason'] }
)

// POST /api/projects/:id/gsd/bootstrap body (body may be empty)
export const bootstrapSchema = z.object({}).passthrough()

// PATCH /api/tasks/:id/gate body
export const taskGatePatchSchema = z.object({
  gate_status: z.enum(['approved', 'rejected']),  // only these two are user-settable
  note: z.string().max(1000).optional(),
})

// Template-file JSON shape (D-17)
export const gsdTemplatePhaseEntrySchema = z.object({
  ticket_ref: z.string().regex(/^[A-Z]+-\d+$/, 'ticket_ref must match PREFIX-NN'),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  gate_required: z.union([z.literal(0), z.literal(1)]).default(0),
  depends_on: z.array(z.string()).optional(),  // array of sibling ticket_refs; stored but not enforced in v1
})
export const gsdTemplateSchema = z.object({
  name: z.string().min(1),
  phases: z.object({
    discuss: z.array(gsdTemplatePhaseEntrySchema),
    plan: z.array(gsdTemplatePhaseEntrySchema),
    execute: z.array(gsdTemplatePhaseEntrySchema),
    verify: z.array(gsdTemplatePhaseEntrySchema),
  }),
})
```

## Project API Extensions

### GET `/api/projects` (list) — extend SELECT

File: `src/app/api/projects/route.ts:40-52`. Add to the SELECT column list (after `p.color` on line 42):

```ts
// src/app/api/projects/route.ts:40-52 (modified columns only)
p.gsd_enabled, p.gsd_track, p.gsd_phase, p.gsd_gate_mode, p.gsd_project_id, p.gsd_updated_at,
```

### GET `/api/projects/[id]` — same extension at line 53.

### POST `/api/projects` — accept GSD fields on create

File: `src/app/api/projects/route.ts:91-119`. Parse optional fields:

```ts
const gsdEnabled = body?.gsd_enabled ? 1 : 0
const gsdTrack = typeof body?.gsd_track === 'string' && GSD_TRACKS.includes(body.gsd_track as any) ? body.gsd_track : null
const gsdGateMode = typeof body?.gsd_gate_mode === 'string' && GSD_GATE_MODES.includes(body.gsd_gate_mode as any) ? body.gsd_gate_mode : 'manual_approval'
const gsdProjectId = typeof body?.gsd_project_id === 'string' ? body.gsd_project_id.trim() || null : null
```

Extend the INSERT at line 116-119 to include these columns.

### PATCH `/api/projects/[id]` — accept GSD updates

File: `src/app/api/projects/[id]/route.ts:121-175`. Follow the existing `body?.field !== undefined` pattern:

```ts
if (body?.gsd_enabled !== undefined) {
  updates.push('gsd_enabled = ?')
  paramsList.push(body.gsd_enabled ? 1 : 0)
}
if (body?.gsd_track !== undefined) {
  const v = body.gsd_track
  if (v !== null && !GSD_TRACKS.includes(v)) {
    return NextResponse.json({ error: 'Invalid gsd_track' }, { status: 400 })
  }
  updates.push('gsd_track = ?')
  paramsList.push(v ?? null)
}
if (body?.gsd_gate_mode !== undefined) {
  if (!GSD_GATE_MODES.includes(body.gsd_gate_mode)) {
    return NextResponse.json({ error: 'Invalid gsd_gate_mode' }, { status: 400 })
  }
  updates.push('gsd_gate_mode = ?')
  paramsList.push(body.gsd_gate_mode)
}
if (body?.gsd_project_id !== undefined) {
  updates.push('gsd_project_id = ?')
  paramsList.push(typeof body.gsd_project_id === 'string' ? body.gsd_project_id.trim() || null : null)
}
// gsd_phase is NOT user-settable via PATCH — must go through /gsd/transition
// gsd_updated_at is server-managed — set automatically on transition
```

**Important:** Do NOT accept `gsd_phase` on PATCH. Phase transitions MUST flow through `/gsd/transition` so rules are enforced (D-24..28). `gsd_updated_at` is server-side only.

## Bootstrap Endpoint — Algorithm

File to create: `src/app/api/projects/[id]/gsd/bootstrap/route.ts`.

```
1. Standard preamble: requireRole('operator'), mutationLimiter, ensureTenantWorkspaceAccess.
2. Parse projectId from params; resolve project row; 404 if missing.
3. Read `project.gsd_track` (may be null).
4. Load template via loadGsdTemplate(track) from src/lib/gsd-templates.ts — NEVER throws, always returns valid template.
5. For each phase (discuss, plan, execute, verify) in template.phases:
     For each entry in that phase's array:
       SELECT id FROM tasks
         WHERE project_id = ? AND gsd_phase = ?
           AND json_extract(metadata, '$.gsd_ticket_ref') = ?
           AND workspace_id = ?
       If exists → skip (idempotency per D-19).
       Else:
         Increment projects.ticket_counter (same pattern as src/app/api/tasks/[id]/route.ts:196-207).
         INSERT INTO tasks(
           workspace_id, title, description, status, priority,
           project_id, project_ticket_no, created_by,
           gsd_phase, gate_required, gate_status,
           metadata, created_at, updated_at
         ) VALUES (?, ?, ?, 'backlog', 'medium',
                   ?, ?, ?,
                   ?, ?, ?,
                   ?, unixepoch(), unixepoch())
         -- metadata includes { gsd_ticket_ref: "DISCUSS-01" } so dedupe key is stable even if
         --   projects.ticket_prefix changes later.
         -- gate_status = entry.gate_required ? 'pending' : 'not_required'
6. Collect list of created_task_ids and skipped_count.
7. Broadcast eventBus.broadcast('task.created', ...) for each new task (so task board refreshes).
8. Respond with { created: <count>, skipped: <count>, tasks: [<created rows>] }.
```

**Idempotency key rationale:** `ticket_ref` could theoretically collide across phases (e.g., two phases both numbered `01`) — so the dedupe key is `(project_id, gsd_phase, metadata.gsd_ticket_ref)`. Using `metadata.gsd_ticket_ref` (JSON field) instead of the derived `ticket_ref` avoids coupling to project-level `ticket_prefix` changes; the JSON column is already writable and queryable via `json_extract` in better-sqlite3.

**Alternative idempotency key (simpler):** `(project_id, gsd_phase, title)` if the planner wants to avoid json_extract. The planner decides — same semantic guarantee, since bundled template titles are stable.

## Bundled Default Template — `src/lib/gsd-templates.ts`

```ts
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { config } from '@/lib/config'
import { gsdTemplateSchema, GSD_TRACKS } from '@/lib/validation'
import { logger } from '@/lib/logger'

export const DEFAULT_TEMPLATE = {
  name: 'default',
  phases: {
    discuss: [
      { ticket_ref: 'DISCUSS-01', title: 'Clarify goal, scope, and success criteria', gate_required: 0 },
      { ticket_ref: 'DISCUSS-02', title: 'Identify constraints and risks', gate_required: 0 },
    ],
    plan: [
      { ticket_ref: 'PLAN-01', title: 'Draft implementation plan', gate_required: 0 },
      { ticket_ref: 'PLAN-02', title: 'Approval package', gate_required: 1 },
    ],
    execute: [
      { ticket_ref: 'EXEC-01', title: 'Core implementation', gate_required: 0 },
      { ticket_ref: 'EXEC-02', title: 'Integration tasks', gate_required: 1 },
    ],
    verify: [
      { ticket_ref: 'VERIFY-01', title: 'Verify acceptance criteria', gate_required: 0 },
      { ticket_ref: 'VERIFY-02', title: 'Ship / readout', gate_required: 0 },
    ],
  },
} as const

export function loadGsdTemplate(track: string | null): typeof DEFAULT_TEMPLATE {
  const safeTrack = (track && GSD_TRACKS.includes(track as any)) ? track : null
  const fileName = safeTrack ? `${safeTrack}.json` : 'default.json'
  const filePath = join(config.dataDir, 'gsd-templates', fileName)
  if (!existsSync(filePath)) return DEFAULT_TEMPLATE  // D-16 soft miss
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return gsdTemplateSchema.parse(parsed)  // Zod validates; throws if malformed
  } catch (err) {
    logger.warn({ err, filePath }, 'Invalid GSD template file, falling back to bundled default')
    return DEFAULT_TEMPLATE
  }
}
```

The Zod validation protects against malformed user-authored JSON. A malformed file logs a warning and falls back to bundled default — preserving D-16 guarantee that bootstrap always succeeds.

## Transition Endpoint — Rule Enforcement

File to create: `src/app/api/projects/[id]/gsd/transition/route.ts`.

Static transition map:

```ts
const NEXT_PHASE: Record<string, string | null> = {
  discuss: 'plan',
  plan: 'execute',
  execute: 'verify',
  verify: 'done',
  done: null,
}
```

Rule SQL (run for each transition):

```ts
// D-24: discuss → plan
const discussDone = db.prepare(`
  SELECT COUNT(*) AS n FROM tasks
  WHERE project_id = ? AND workspace_id = ?
    AND gsd_phase = 'discuss' AND status = 'done'
`).get(projectId, workspaceId) as { n: number }
if (discussDone.n < 1) return 409('DISCUSS_REQUIRES_ONE_DONE', ...)

// D-25: plan → execute
const planDoneApproved = db.prepare(`
  SELECT COUNT(*) AS n FROM tasks
  WHERE project_id = ? AND workspace_id = ?
    AND gsd_phase = 'plan' AND status = 'done' AND gate_status = 'approved'
`).get(projectId, workspaceId) as { n: number }
if (planDoneApproved.n < 1) return 409('PLAN_REQUIRES_APPROVED_PACKAGE', ...)

// D-26: execute → verify
const executeOpen = db.prepare(`
  SELECT COUNT(*) AS n FROM tasks
  WHERE project_id = ? AND workspace_id = ?
    AND gsd_phase = 'execute' AND status != 'done'
`).get(projectId, workspaceId) as { n: number }
if (executeOpen.n > 0 && !body.waive_remaining) {
  return 409('EXECUTE_TASKS_INCOMPLETE', `${executeOpen.n} execute tasks still open — pass waive_remaining=true with a reason`)
}
// if waive_remaining is true, body.reason already validated by Zod .refine() to be non-empty

// D-27: verify → done
const verifyDone = db.prepare(`
  SELECT COUNT(*) AS n FROM tasks
  WHERE project_id = ? AND workspace_id = ?
    AND gsd_phase = 'verify' AND status = 'done'
`).get(projectId, workspaceId) as { n: number }
if (verifyDone.n < 1) return 409('VERIFY_REQUIRES_ONE_DONE', ...)
```

**Illegal-jump check:** `if (project.gsd_phase === body.to_phase || NEXT_PHASE[project.gsd_phase] !== body.to_phase) return 409('ILLEGAL_TRANSITION', ...)`. This forces strict sequential traversal — no skipping phases.

On success:
```sql
UPDATE projects
  SET gsd_phase = ?, gsd_updated_at = unixepoch(), updated_at = unixepoch()
  WHERE id = ? AND workspace_id = ?
```

Then:
```ts
db_helpers.logActivity('project_gsd_transition', 'project', projectId, auth.user.username,
  `${fromPhase} → ${toPhase}${body.waive_remaining ? ' (waived)' : ''}`,
  { from_phase: fromPhase, to_phase: toPhase, waived: !!body.waive_remaining, reason: body.reason || null },
  workspaceId)
eventBus.broadcast('project.gsd.transition', { project_id: projectId, from_phase: fromPhase, to_phase: toPhase, actor: auth.user.username, reason: body.reason || null, waived: !!body.waive_remaining, workspace_id: workspaceId })
```

## Gate Approval Endpoint

File to create: `src/app/api/tasks/[id]/gate/route.ts`.

```ts
export async function PATCH(request, { params }) {
  const auth = requireRole(request, 'operator')  // D-09
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request); if (rateCheck) return rateCheck

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const { id } = await params
  const taskId = parseInt(id, 10)
  if (!Number.isFinite(taskId)) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })

  const validated = await validateBody(request, taskGatePatchSchema)
  if ('error' in validated) return validated.error
  const body = validated.data

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ? AND workspace_id = ?`)
    .get(taskId, workspaceId) as any
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (!task.gate_required) {
    return NextResponse.json({ error: 'This task has no gate to approve', code: 'NO_GATE' }, { status: 400 })
  }

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE tasks
    SET gate_status = ?, gate_approved_by = ?, gate_approved_at = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `).run(body.gate_status, auth.user.username, now, now, taskId, workspaceId)

  db_helpers.logActivity('task_gate_changed', 'task', taskId, auth.user.username,
    `Gate ${body.gate_status}${body.note ? `: ${body.note}` : ''}`,
    { gate_status: body.gate_status, note: body.note || null },
    workspaceId)

  eventBus.broadcast('task.gate.changed', {
    task_id: taskId, gate_status: body.gate_status, actor: auth.user.username,
    note: body.note || null, workspace_id: workspaceId,
  })

  const updated = db.prepare(`SELECT * FROM tasks WHERE id = ? AND workspace_id = ?`).get(taskId, workspaceId)
  return NextResponse.json({ task: updated })
}
```

**D-12:** `gate_approved_by` is set to `auth.user.username` — same identity used throughout (API-key principal = `'api'`, agent key = `'agent:<name>'`, session user = actual username, proxy auth = actual username). Matches every other mutation endpoint in the codebase.

## Gate Enforcement Hook — Exact Location

File: `src/app/api/tasks/[id]/route.ts`. Hook point: **line 172-181**, immediately inside the `if (normalizedStatus !== undefined)` block, BEFORE the existing Aegis check at line 173.

```ts
// src/app/api/tasks/[id]/route.ts:172 (existing → modified)
if (normalizedStatus !== undefined) {
  // NEW: GSD-15, D-30, D-31, D-32 — gate enforcement
  if ((normalizedStatus === 'in_progress' || normalizedStatus === 'done')
      && currentTask.gate_required === 1
      && currentTask.gate_status !== 'approved') {
    return NextResponse.json({
      error: 'This task requires gate approval before it can move forward.',
      code: 'GATE_BLOCKED',
      gate_status: currentTask.gate_status,
      gate_required: 1,
    }, { status: 403 })
  }

  // Existing Aegis check (line 173 onward — unchanged)
  if (normalizedStatus === 'done' && !hasAegisApproval(db, taskId, workspaceId)) {
    return NextResponse.json(
      { error: 'Aegis approval is required to move task to done.' },
      { status: 403 }
    )
  }
  fieldsToUpdate.push('status = ?')
  updateParams.push(normalizedStatus)
}
```

**Why before the Aegis check:** Gate block is cheaper (pure field read) and semantically prior — if the gate isn't approved, it doesn't matter whether Aegis is. Also means the error message the user sees is the actionable one (`GATE_BLOCKED` points them to the Lifecycle tab to approve).

**D-31 coverage:** Only `in_progress` and `done` trigger the check. Transitions to `backlog`, `blocked`, `in_review`, `inbox`, `assigned`, etc. all bypass the gate — same as the plan requires. No need to list every non-blocked status explicitly.

**D-32 coverage:** The check is `gate_status !== 'approved'` — which covers `pending`, `rejected`, and `not_required` identically. A `rejected` gate behaves as still-blocked until flipped back to `approved` via the gate endpoint. Matches spec.

## Event Bus Extension

File: `src/lib/event-bus.ts:15`. Extend the EventType union:

```ts
export type EventType =
  | 'task.created'
  | 'task.updated'
  // ... existing types ...
  | 'project.gsd.transition'   // NEW (D-34)
  | 'task.gate.changed'        // NEW (D-34)
```

Without this expansion, TypeScript fails in the three new endpoints. Keep the change minimal — just these two additions.

## i18n Update — One-Shot Node Script Pattern

**File list (all 10 locales, each ~2350 lines):**

```
messages/ar.json
messages/de.json
messages/en.json
messages/es.json
messages/fr.json
messages/ja.json
messages/ko.json
messages/pt.json
messages/ru.json
messages/zh.json
```

**Script pattern (from Phase 08-04 precedent — `{...rest}` spread preserves all keys added by concurrent work):**

```js
// Run once, then delete the script file. Does NOT persist in scripts/.
// The script is ephemeral — it just mutates JSON files.
const fs = require('node:fs')
const path = require('node:path')

const LOCALES = ['en','de','es','fr','ja','ko','pt','ru','ar','zh']
// Note: English copy is canonical; other locales use English as fallback per
// Phase 7 "loadTimeout* uses English-fallback" precedent. This matches STATE.md decision.

const LIFECYCLE_TREE = {
  // Keys match UI-SPEC Copywriting Contract
  title: 'Lifecycle',
  currentPhase: 'Current phase',
  phaseTimeline: 'Phase timeline',
  gateTasks: 'Tasks awaiting approval',
  gateTasksNone: 'No tasks awaiting approval',
  cta: {
    enable: 'Enable GSD for this project',
    bootstrap: 'Bootstrap phase tasks',
    bootstrapRerun: 'Re-run bootstrap',
    bootstrapHelper: 'Safe to re-run — creates only missing tasks',
    advance: 'Advance to {next} phase',
    waive: 'Waive remaining and continue',
  },
  gate: {
    approve: 'Approve',
    reject: 'Reject',
    statusPending: 'Pending approval',
    statusRequired: '🔒 Approval required',
    statusApproved: '✓ Approved',
    statusRejected: 'Rejected',
    rejectConfirmBody: 'Reject this gate? The task will stay blocked until an operator re-approves.',
  },
  cta_waiveConfirmBody: 'Waive the remaining Execute tasks and move to Verify? The reason is recorded in the activity log.',
  settings: {
    heading: 'GSD lifecycle',
    enableLabel: 'GSD enabled',
    enableHelper: 'Turn on to track this project through Discuss → Plan → Execute → Verify → Done phases',
    trackLabel: 'Track',
    trackHelperDisabled: 'Enable GSD to choose a track',
    gateModeLabel: 'Gate approval mode',
    gateModeHelper: 'Manual approval requires an operator to approve each gate. Auto internal skips approval for internal-only work.',
  },
  empty: {
    heading: 'GSD is not enabled on this project',
    body: 'Turn on GSD to track this project through its Discuss, Plan, Execute, Verify, and Done phases, bootstrap default phase tasks, and enforce approval gates on high-impact work.',
    notBootstrapped: {
      heading: 'No phase tasks yet',
      body: 'Bootstrap to create the default Discuss → Plan → Execute → Verify task pack for this project. You can customize any task after bootstrap.',
    },
  },
  gateTasksEmptyBody: 'Nothing needs approval right now. Gate-required tasks appear here when they are created or promoted to pending approval.',
  error: {
    illegalTransition: "Can't advance to {toPhase} yet: {reason}. {remedy}",
    gateBlocked: 'This task needs approval before it can move forward. Approve the gate below or ask an operator to approve it.',
    bootstrapFailed: "Couldn't reach the server. Retry bootstrap in a moment.",
    enableFailed: "Couldn't enable GSD. {serverError} Try again.",
    transitionFailed: "Couldn't advance the phase. Check your connection and try again.",
  },
}

for (const loc of LOCALES) {
  const p = path.join('messages', `${loc}.json`)
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  j.project = { ...(j.project || {}), lifecycle: LIFECYCLE_TREE }
  // Also add nav.lifecycle alongside existing nav.dashboard etc.
  j.project.nav = { ...(j.project.nav || {}), lifecycle: 'Lifecycle' }
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n')
}
console.log('Done:', LOCALES.length, 'locales updated')
```

Per D-37 + UI-SPEC: phase names (`Discuss`, `Plan`, `Execute`, `Verify`, `Done`), track names (`ops`, `product`, `marketing`, `legal`, `firmvault`, `custom`), and gate-mode values (`manual_approval`, `auto_internal`) remain English in all locales. This matches the `runtime*` brand-literal pattern from Phase 5 (`Claude`, `Codex`, `Hermes`, `Gateway`).

The script itself is not committed. Commit only the 10 locale-file changes + one feature commit.

## Task Board Badge Slot — Exact Location

File: `src/components/panels/task-board-panel.tsx`. Insert after **line 1050** (after the `ticket_ref` badge closing `</span>` and before the github-issue anchor). Render order matches UI-SPEC:

```
[recurring-spawn] [ticket_ref] [phase badge] [gate badge] [github issue] [github pr] [aegis] [awaiting owner]
```

Insertion code:

```tsx
{/* Phase 9 GSD-24: phase badge — only when gsd_phase is set (D-22) */}
{task.gsd_phase && (
  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono"
        title={`GSD phase: ${task.gsd_phase}`}>
    {task.gsd_phase.toUpperCase()}
  </span>
)}
{/* Phase 9 GSD-25: gate badge — only when gate_required */}
{task.gate_required === 1 && task.gate_status === 'approved' && (
  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20">
    {t('lifecycle.gate.statusApproved') /* '✓ Approved' */}
  </span>
)}
{task.gate_required === 1 && task.gate_status !== 'approved' && (
  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
    {t('lifecycle.gate.statusRequired') /* '🔒 Approval required' */}
  </span>
)}
```

Two-branch render matches D-06. Emoji prefix lives inside the translated string (UI-SPEC: "the badge is a single atomic translatable unit"). The `t()` reference requires the translation namespace scope — task-board-panel already calls `useTranslations('tasks')` for other strings; the planner should either:
- (A) Add a second `useTranslations('project.lifecycle')` call at the top of the component, or
- (B) Extract `PhaseBadge` + `GateBadge` into `src/components/panels/task-card/` (UI-SPEC's suggested component structure) which carry their own `useTranslations` scopes. This is cleaner and matches UI-SPEC's component inventory.

**Recommendation (Claude's Discretion):** (B) — extract two tiny new components, they're imported identically in global and project-scoped task boards, and keep task-board-panel.tsx from growing.

**Task type surfacing:** `src/components/panels/task-board-panel.tsx:41` defines the in-file Task type (inherited from a wider store definition). Confirm `gsd_phase?: string | null`, `gate_required?: 0 | 1`, `gate_status?: 'not_required'|'pending'|'approved'|'rejected'` are carried through the store (Zustand store at `src/store/index.ts`) — the GET endpoints extension must propagate them. The planner must extend the `Task` type in `src/lib/db.ts` (where it's defined) and the store's `Task` interface; typecheck will flag any omission.

## Lifecycle Tab Routing

File: `src/components/project/project-tabs.tsx:8`. Current VIEWS tuple:

```ts
const VIEWS = ['dashboard', 'tasks', 'sessions', 'agents', 'settings'] as const
```

Modify to (UI-SPEC: between `dashboard` and `tasks`):

```ts
const VIEWS = ['dashboard', 'lifecycle', 'tasks', 'sessions', 'agents', 'settings'] as const
```

File: `src/components/project/project-view-router.tsx:12-28`. Add case:

```ts
case 'lifecycle':
  return <LifecycleView />
```

Plus `import { LifecycleView } from '@/components/project/lifecycle/lifecycle-view'` at the top.

`project-context.tsx:16` — the `view` type comment (`'dashboard' | 'tasks' | 'sessions' | 'agents' | 'settings'`) is a documentation string only; no enum to expand. The `view` field is typed as `string`, so no change needed beyond the VIEWS tuple.

**Tests to update:** `src/components/project/__tests__/project-tabs.test.ts` will need to expect 6 tabs in `VIEWS` (not 5). The existing test is a close-reading reference for what the unit test must assert.

## Error Response Shape (Claude's Discretion — planner decides)

All new endpoint errors SHOULD follow the shape:

```json
{
  "error": "Human-readable actionable message",
  "code": "MACHINE_READABLE_CODE",
  // optional context fields:
  "gate_status": "pending",
  "from_phase": "plan",
  "to_phase": "execute"
}
```

Existing MC endpoints are inconsistent — some return `{ error }` only, some return `{ error, details }`. Adopting `{ error, code, ...context }` for ALL three new endpoints is cleanest for client-side i18n mapping (UI-SPEC specifies client maps `code: 'GATE_BLOCKED'` → `t('lifecycle.error.gateBlocked')`).

**Error codes to define:**

| Endpoint | Condition | code | HTTP |
|----------|-----------|------|------|
| transition | current phase is not `to_phase - 1` | `ILLEGAL_TRANSITION` | 409 |
| transition | discuss → plan missing done task | `DISCUSS_REQUIRES_ONE_DONE` | 409 |
| transition | plan → execute missing approved+done | `PLAN_REQUIRES_APPROVED_PACKAGE` | 409 |
| transition | execute → verify has open tasks, no waiver | `EXECUTE_TASKS_INCOMPLETE` | 409 |
| transition | execute → verify waiver without reason | caught by Zod → 400 | 400 |
| transition | verify → done missing done task | `VERIFY_REQUIRES_ONE_DONE` | 409 |
| bootstrap | project not found | `PROJECT_NOT_FOUND` | 404 |
| gate | task not found | `TASK_NOT_FOUND` | 404 |
| gate | task has no gate | `NO_GATE` | 400 |
| tasks PUT status | gate not approved | `GATE_BLOCKED` | 403 |

## Common Pitfalls

### Pitfall 1: Forgetting to add GSD fields to every read path

**What goes wrong:** Migration ships, POST/PATCH accept GSD fields, but the task-board and Lifecycle tab can't see them because GET `/api/tasks`, GET `/api/projects/[id]/tasks`, and the Zustand store `Task` type aren't updated. UI renders with `task.gsd_phase === undefined` and no badge appears.
**Why it happens:** Eight different read-path locations (four SELECTs + the Task type in db.ts + the Zustand store Task + the API Task response + the Project response) all need to be kept in sync.
**How to avoid:** Audit every `SELECT` of the tasks/projects tables and every `Task`/`Project` interface. A grep for `SELECT.*FROM tasks` and `SELECT.*FROM projects` reveals them all.
**Warning signs:** TypeScript compiles because new fields are optional. Add tests asserting GET returns the fields (validation.test.ts pattern). Playwright check after bootstrap: `expect(task.gsd_phase).toBe('discuss')`.

### Pitfall 2: Bootstrap races with PATCH enabling GSD

**What goes wrong:** User clicks "Enable GSD" (PATCH sets `gsd_enabled=1`), then immediately clicks "Bootstrap" before the state refetches. Bootstrap sees `gsd_enabled=0` and rejects.
**Why it happens:** The UI-SPEC says PATCH + re-render without reload (D-21).
**How to avoid:** Bootstrap MUST NOT require `gsd_enabled=1`. The endpoint just seeds tasks; the user's intent is clear. Add unit test: bootstrap succeeds even when `gsd_enabled=0` (and optionally flips it to `1` as a side effect).
**Recommendation (Claude's Discretion):** Bootstrap does NOT auto-enable GSD. User-facing flow: Settings → enable GSD first, then Lifecycle tab bootstrap. Keeps responsibility separated. The UI disables the Bootstrap button until `gsd_enabled=1`, so the race is UI-prevented.

### Pitfall 3: Task `ticket_ref` vs template `ticket_ref` confusion

**What goes wrong:** Bootstrap creates a task with project ticket_prefix `PA` and ticket_counter `3` → real ticket ref `PA-003`. But the template says `DISCUSS-01`. Dev writes `task.ticket_ref = 'DISCUSS-01'` somewhere — corrupts the existing project-wide counter scheme.
**Why it happens:** Two unrelated ID concepts share a name.
**How to avoid:** Bootstrap stores `DISCUSS-01` in `task.metadata.gsd_ticket_ref` as a JSON field. The task's real displayed ticket_ref (`PA-003`) is derived normally. The Lifecycle tab's gate-task list displays `metadata.gsd_ticket_ref` alongside the derived ticket_ref. UI-SPEC: gate-task row uses ticket_ref — it's the project-derived `PA-003`, not the template's `DISCUSS-01`. The template value is for dedupe only.
**Warning signs:** Task row has both `ticket_ref='PA-003'` and `metadata.gsd_ticket_ref='DISCUSS-01'`. Don't confuse them in UI.

### Pitfall 4: Forgetting `updated_at` on the project row after transition

**What goes wrong:** `gsd_updated_at` moves but `updated_at` doesn't. Dashboard's "last activity" uses `updated_at`, so the project looks stale.
**How to avoid:** Always set BOTH in the UPDATE: `SET gsd_phase = ?, gsd_updated_at = unixepoch(), updated_at = unixepoch()`.

### Pitfall 5: Role enforcement on the transition endpoint forgetting tenant isolation

**What goes wrong:** `requireRole('operator')` passes for a user in workspace A, but the `projectId` in the URL belongs to workspace B. User now mutates another workspace's project phase.
**How to avoid:** Always pair `requireRole` with `ensureTenantWorkspaceAccess(db, tenantId, workspaceId, ...)` AND a query that scopes `project_id=? AND workspace_id=?`. This is the existing contract — see `src/app/api/projects/[id]/route.ts:43-50`. Reproduce in all three new endpoints.

### Pitfall 6: SSE event not reaching the task board after gate change

**What goes wrong:** `task.gate.changed` is broadcast but the task board listens for `task.updated`. The Approved badge doesn't appear until refresh.
**How to avoid:** ALSO broadcast `task.updated` after a gate change (or have the task-board subscriber listen to both). Simpler: the PATCH /gate handler broadcasts BOTH — one for the specific semantic event (D-34) and one `task.updated` so existing listeners refresh without code changes. Two broadcasts, one PATCH.

### Pitfall 7: Zod `.refine()` error position

**What goes wrong:** `transitionSchema.refine(...)` error lands at the root of the issue path; client can't attribute to a specific field.
**How to avoid:** Use `path: ['reason']` in the refine options (shown in schema above). `validateBody` surfaces path in the 400 response.

### Pitfall 8: Bootstrap template file exists but is malformed JSON

**What goes wrong:** User-authored `ops.json` has a trailing comma. `JSON.parse` throws; bootstrap returns 500.
**How to avoid:** `try/catch` around `JSON.parse` + Zod validation, fall back to bundled default on any parse/validation error (see `loadGsdTemplate` above). `logger.warn` surfaces the issue for the user without failing bootstrap (D-16: bootstrap always succeeds).

### Pitfall 9: Atomic 10-locale commit conflicts with in-flight work

**What goes wrong:** Two parallel tasks both want to add keys to `messages/*.json`. One overwrites the other.
**How to avoid:** The one-shot script uses `{ ...(j.project || {}), lifecycle: ... }` spread. Run the script at the START of Phase 9 implementation and commit in a single atomic commit. Downstream tasks only add NEW keys; they never remove.

### Pitfall 10: Migration's IF-NOT-EXISTS guard hides a fresh-DB bug

**What goes wrong:** On a fresh DB where migration 052 runs after schema.sql (which might not have GSD columns), the PRAGMA guard creates the columns fine. But if someone later adds the columns to schema.sql, the `hasCol` guard silently skips, no bug surfaces — until someone changes a default value. The two sources of truth drift.
**How to avoid:** Phase 9 does NOT modify `src/lib/schema.sql`. GSD columns live ONLY in migration 052. Fresh and migrated DBs follow the same path.

## Code Examples

### Bootstrap endpoint — complete handler skeleton

```ts
// src/app/api/projects/[id]/gsd/bootstrap/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { logger } from '@/lib/logger'
import { loadGsdTemplate } from '@/lib/gsd-templates'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request); if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, { /* ...standard fields... */ })
    const { id } = await params
    const projectId = Number.parseInt(id, 10)
    if (!Number.isFinite(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const project = db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`)
      .get(projectId, workspaceId) as any
    if (!project) return NextResponse.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, { status: 404 })

    const template = loadGsdTemplate(project.gsd_track)
    const phases: Array<'discuss'|'plan'|'execute'|'verify'> = ['discuss', 'plan', 'execute', 'verify']
    let created = 0, skipped = 0
    const createdTasks: any[] = []

    const existsStmt = db.prepare(`
      SELECT id FROM tasks
      WHERE project_id = ? AND workspace_id = ? AND gsd_phase = ?
        AND json_extract(COALESCE(metadata, '{}'), '$.gsd_ticket_ref') = ?
      LIMIT 1
    `)
    const bumpCounter = db.prepare(`
      UPDATE projects SET ticket_counter = ticket_counter + 1, updated_at = unixepoch()
      WHERE id = ? AND workspace_id = ?
    `)
    const readCounter = db.prepare(`SELECT ticket_counter FROM projects WHERE id = ? AND workspace_id = ?`)
    const insertTask = db.prepare(`
      INSERT INTO tasks (
        workspace_id, title, description, status, priority,
        project_id, project_ticket_no, created_by,
        gsd_phase, gate_required, gate_status,
        tags, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, 'backlog', 'medium', ?, ?, ?, ?, ?, ?, '[]', ?, unixepoch(), unixepoch())
    `)

    const tx = db.transaction(() => {
      for (const phase of phases) {
        for (const entry of template.phases[phase]) {
          if (existsStmt.get(projectId, workspaceId, phase, entry.ticket_ref)) {
            skipped++
            continue
          }
          bumpCounter.run(projectId, workspaceId)
          const row = readCounter.get(projectId, workspaceId) as { ticket_counter: number }
          const gateStatus = entry.gate_required ? 'pending' : 'not_required'
          const result = insertTask.run(
            workspaceId,
            entry.title,
            entry.description ?? null,
            projectId,
            row.ticket_counter,
            auth.user.username,
            phase,
            entry.gate_required ? 1 : 0,
            gateStatus,
            JSON.stringify({ gsd_ticket_ref: entry.ticket_ref })
          )
          created++
          const newTask = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(Number(result.lastInsertRowid))
          createdTasks.push(newTask)
        }
      }
    })
    tx()

    // Broadcast outside the transaction
    for (const t of createdTasks) {
      eventBus.broadcast('task.created', { ...t, workspace_id: workspaceId })
    }
    db_helpers.logActivity('project_gsd_bootstrap', 'project', projectId, auth.user.username,
      `Bootstrapped ${created} task${created === 1 ? '' : 's'} (${skipped} skipped)`,
      { created, skipped, track: project.gsd_track || 'default' }, workspaceId)

    return NextResponse.json({ created, skipped, tasks: createdTasks }, { status: 200 })
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error({ err: error }, 'POST /api/projects/[id]/gsd/bootstrap error')
    return NextResponse.json({ error: 'Bootstrap failed' }, { status: 500 })
  }
}
```

### Extended PATCH gate check in task status update

Already shown in `## Gate Enforcement Hook — Exact Location`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 05 multi-locale edits piecemeal | Atomic one-shot Node script, `{...rest}` spread | Phase 08 (2026-04-13) | Eliminates conflict surface for parallel Wave 1 tasks |
| `SELECT *` in list endpoints | Explicit column lists + derived fields via subquery | Phase 01/08 | Allows adding columns without UI-layer side effects |
| `useReducer` for multi-field forms | Per-field `useState` + `useMemo` isDirty | Phase 06 (2026-04-14) | Simpler, matches 7-field project settings form; reused for GSD section |
| In-line `getDatabase()` per route call | Unchanged — still per-call | N/A | Singleton under the hood — no pooling concern |

**Deprecated/outdated:** None for this phase — all existing patterns are current.

## Open Questions

1. **Does bootstrap also toggle `gsd_enabled=1` as a side effect?**
   - What we know: D-19 says bootstrap is idempotent; does not require `gsd_enabled=1` per spec.
   - What's unclear: UX — user who clicks Bootstrap in Settings probably expects "do the whole thing".
   - Recommendation: Bootstrap does NOT auto-enable. UI hides/disables the bootstrap button when `gsd_enabled=0`. Planner may override to "auto-enable" if preferred — both are defensible.

2. **Does the "Enable GSD" CTA flow auto-populate `gsd_track`?**
   - What we know: D-20/D-21 say Enable CTA PATCHes `gsd_enabled=1`.
   - What's unclear: What's the default track?
   - Recommendation: Leave `gsd_track=null`. Bootstrap loads `default.json`. User can set track in Settings later. Matches D-15.

3. **What SSE event does the client listen for to refresh the phase timeline?**
   - What we know: `project.gsd.transition` is broadcast.
   - What's unclear: Existing client listens for `task.updated`, `task.created`, etc. The Lifecycle tab needs a new listener.
   - Recommendation: Expand `src/lib/use-server-events.ts` (or equivalent) to handle the two new types. If time-boxed, the tab can just re-fetch project data on transition-response resolution (optimistic-UI — page-local) + let the SSE land eventually. Less robust but ships faster.

4. **Does `depends_on_task_ids` appear in the default bundled template?**
   - What we know: D-17 mentions the field; CONTEXT.md says enforcement is deferred.
   - Recommendation: NO. v1 bundled `default.json` has empty `depends_on` on all entries. Field exists structurally, enforcement in v1.1+.

5. **Should task.created broadcasts from bootstrap deduplicate?**
   - What we know: Spec doesn't say.
   - Recommendation: Broadcast individually for each created task. Already scoped by workspace. Same volume as creating 8 tasks via task-creation UI — not a problem.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, tests | ✓ | >= 22 (enforced) | — |
| pnpm | Install, test, build | ✓ | via corepack | — |
| better-sqlite3 native addon | DB operations | ✓ | 12.6.x (in lockfile) | — |
| `<MISSION_CONTROL_DATA_DIR>/gsd-templates/` directory | Template loader | N/A (optional) | — | Bundled `DEFAULT_TEMPLATE` constant in `src/lib/gsd-templates.ts` (D-16) |
| Playwright browsers | E2E tests | likely ✓ | 1.51.x | Unit tests via vitest cover most behavior if E2E is degraded |
| Vitest jsdom | Unit tests | ✓ | 2.1.x, jsdom 26.x | — |

**Missing dependencies with no fallback:** none — pure code/config feature.

**Missing dependencies with fallback:** the `gsd-templates/` directory is intentionally optional per D-16.

## Validation Architecture

`.planning/config.json.workflow.nyquist_validation = true` — this section is REQUIRED.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.x (unit) + Playwright 1.51.x (E2E) |
| Config file | `vitest.config.ts` (root), `playwright.config.ts` (root) |
| Quick run command | `pnpm test -- src/lib/__tests__/<file> src/app/api/**/__tests__/<file>` |
| Full suite command | `pnpm test:all` (lint + typecheck + test + build + e2e) |

### Phase Requirements → Test Map

Critical-path validation dimensions for Phase 9. Every requirement has a test that can be automated in under 30 seconds (unit) or 5 minutes (E2E). Manual-only items are flagged.

| Req ID | Behavior (what MUST pass) | Test Type | Automated Command | File Exists? |
|--------|---------------------------|-----------|-------------------|--------------|
| GSD-01 | Project create with `gsd_enabled=true, gsd_track='ops'` returns 201 and fields persist | unit | `pnpm test -- src/app/api/projects/__tests__/projects-crud-gsd.test.ts` | ❌ Wave 0 |
| GSD-02 | Migration 052 sets `gsd_phase='discuss'` default on existing projects row | unit | `pnpm test -- src/lib/__tests__/migrations-052.test.ts` | ❌ Wave 0 |
| GSD-03 | Invalid `gsd_gate_mode` returns 400 from POST/PATCH | unit | `pnpm test -- src/app/api/projects/__tests__/projects-crud-gsd.test.ts` | ❌ Wave 0 |
| GSD-04 | Task row carries `gsd_phase`, `gate_required` fields in GET | unit | `pnpm test -- src/app/api/tasks/__tests__/tasks-gsd-fields.test.ts` | ❌ Wave 0 |
| GSD-05 | PATCH `/api/tasks/:id/gate` records `gate_approved_by = user`, `gate_approved_at = unixepoch()` | unit | `pnpm test -- src/app/api/tasks/__tests__/gate.test.ts` | ❌ Wave 0 |
| GSD-06 | Migration is additive; existing DB before 052 still boots after 052 applied | unit | Same migration test — snapshot DB before, run migration, snapshot after | ❌ Wave 0 |
| GSD-07 | Bootstrap twice on same project creates 8 tasks first time, 0 second time | unit | `pnpm test -- src/app/api/projects/__tests__/bootstrap.test.ts` | ❌ Wave 0 |
| GSD-08 | Transition discuss→execute (skipping plan) returns 409 `ILLEGAL_TRANSITION` | unit | `pnpm test -- src/app/api/projects/__tests__/transition.test.ts` | ❌ Wave 0 |
| GSD-09 | 409 response body includes `code` + `error` fields | unit | same transition.test.ts | ❌ Wave 0 |
| GSD-10 | Transition execute→verify with unfinished tasks + no waiver returns 409; with `waive_remaining=true, reason: 'x'` returns 200 | unit | same transition.test.ts | ❌ Wave 0 |
| GSD-11 | Approve/reject via PATCH /gate flips `gate_status` + emits event | unit | `pnpm test -- src/app/api/tasks/__tests__/gate.test.ts` | ❌ Wave 0 |
| GSD-12 | Viewer role gets 403 on all 3 new endpoints; operator succeeds | unit | tests above, one test per endpoint | ❌ Wave 0 |
| GSD-13 | GET /api/projects and /api/projects/:id return all 6 new GSD columns | unit | projects-crud-gsd.test.ts | ❌ Wave 0 |
| GSD-14 | POST with invalid `gsd_track` rejected; valid accepted | unit | projects-crud-gsd.test.ts | ❌ Wave 0 |
| GSD-15 | PUT /api/tasks/:id with status='in_progress' returns 403 when gate_required=1, gate_status='pending' | unit | `pnpm test -- src/app/api/tasks/__tests__/status-gate-block.test.ts` | ❌ Wave 0 |
| GSD-16 | Same task with status='blocked' succeeds (not gated) | unit | same status-gate-block.test.ts | ❌ Wave 0 |
| GSD-17 | Bootstrap with `gsd_track='ops'` and no file on disk falls back to bundled default | unit | `pnpm test -- src/lib/__tests__/gsd-templates.test.ts` | ❌ Wave 0 |
| GSD-18 | Bundled default template schema-validates | unit | gsd-templates.test.ts | ❌ Wave 0 |
| GSD-19 | Bootstrap idempotency — snapshot task count, re-bootstrap, count unchanged | unit | bootstrap.test.ts | ❌ Wave 0 |
| GSD-20 | `/project/<slug>/lifecycle` URL renders LifecycleView (not 404) | unit (RTL) | `pnpm test -- src/components/project/lifecycle/__tests__/lifecycle-view.test.ts` | ❌ Wave 0 |
| GSD-21 | LifecycleView shows current phase, timeline, bootstrap button for gsd_enabled project | unit (RTL) | same | ❌ Wave 0 |
| GSD-22 | Operator sees Approve/Reject buttons; viewer does not | unit (RTL) | `pnpm test -- src/components/project/lifecycle/__tests__/gate-task-row.test.ts` | ❌ Wave 0 |
| GSD-23 | gsd_enabled=0 renders EmptyState with Enable CTA | unit (RTL) | `pnpm test -- src/components/project/lifecycle/__tests__/empty-state.test.ts` | ❌ Wave 0 |
| GSD-24 | Task card renders phase badge when `gsd_phase='plan'`; absent when null | unit (RTL) | `pnpm test -- src/components/panels/task-card/__tests__/phase-badge.test.ts` | ❌ Wave 0 |
| GSD-25 | Task card renders green ✓ Approved or amber 🔒 Approval required based on gate_status | unit (RTL) | `pnpm test -- src/components/panels/task-card/__tests__/gate-badge.test.ts` | ❌ Wave 0 |
| GSD-26 | Settings view renders GSD section with 3 fields | unit (RTL) | existing `src/components/project/__tests__/settings-view.test.ts` — extend | ❌ Wave 0 (extend existing) |
| GSD-27 | Track + gate-mode disabled when gsd_enabled=false | unit (RTL) | same | ❌ Wave 0 |
| GSD-28 | Transition and gate PATCH emit events via eventBus.broadcast (mock + assert) | unit | transition.test.ts, gate.test.ts | ❌ Wave 0 |
| GSD-29 | All 10 locale files have `project.lifecycle.*` keys | unit | `pnpm test -- src/lib/__tests__/locale-parity-gsd.test.ts` | ❌ Wave 0 |
| Cross-layer | Full E2E: create project → enable GSD → bootstrap → illegal transition → legal sequence → gate block → approve → continue | E2E | `pnpm test:e2e -- tests/gsd-lifecycle.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test -- <touched paths>` + `pnpm typecheck` — sub-30-second run for single-file changes.
- **Per wave merge:** `pnpm lint && pnpm typecheck && pnpm test` — full unit + lint + TS, typically under 2 minutes.
- **Phase gate (before `/gsd:verify-work`):** `pnpm test:all` — full suite including E2E. Under 10 minutes on developer laptop.

### Wave 0 Gaps

All test files are NEW. Wave 0 creates test scaffolds using the established `it.todo()` / `test.fixme()` pattern from Phases 1-8 so the suite stays green during iteration.

**New test files to create in Wave 0 (all scaffolds with `it.todo()`):**

- [ ] `src/lib/__tests__/migrations-052.test.ts` — migration 052 runs; schema after matches expectation; re-run is no-op
- [ ] `src/lib/__tests__/gsd-templates.test.ts` — bundled default validates; missing file → fallback; malformed → fallback; valid file → returned
- [ ] `src/lib/__tests__/validation-gsd.test.ts` — all new Zod schemas accept valid, reject invalid (or extend `validation.test.ts`)
- [ ] `src/lib/__tests__/locale-parity-gsd.test.ts` — each locale has `project.lifecycle.*` keys (parity check)
- [ ] `src/app/api/projects/__tests__/projects-crud-gsd.test.ts` — project create/read/patch with GSD fields; role enforcement; invalid values
- [ ] `src/app/api/projects/__tests__/bootstrap.test.ts` — bootstrap creates tasks; idempotent on re-run; role enforcement
- [ ] `src/app/api/projects/__tests__/transition.test.ts` — each transition rule (D-24..27); illegal jumps; waiver path; event emission
- [ ] `src/app/api/tasks/__tests__/gate.test.ts` — approve/reject path; role enforcement; fields recorded; event emission
- [ ] `src/app/api/tasks/__tests__/status-gate-block.test.ts` — PUT status transitions blocked/allowed by gate state
- [ ] `src/app/api/tasks/__tests__/tasks-gsd-fields.test.ts` — GET includes GSD fields on tasks
- [ ] `src/components/project/lifecycle/__tests__/lifecycle-view.test.ts`
- [ ] `src/components/project/lifecycle/__tests__/gate-task-row.test.ts`
- [ ] `src/components/project/lifecycle/__tests__/empty-state.test.ts`
- [ ] `src/components/project/lifecycle/__tests__/phase-timeline.test.ts`
- [ ] `src/components/panels/task-card/__tests__/phase-badge.test.ts`
- [ ] `src/components/panels/task-card/__tests__/gate-badge.test.ts`
- [ ] `tests/gsd-lifecycle.spec.ts` — Playwright E2E end-to-end flow

**Extend existing:**

- [ ] `src/components/project/__tests__/settings-view.test.ts` — add GSD section tests
- [ ] `src/components/project/__tests__/project-tabs.test.ts` — expect 6 tabs including 'lifecycle'

**No framework install needed** — both vitest and playwright already configured.

## Wave Mapping (Commit-Sequence Feasibility)

The 10-commit sequence in `09-02-COMMIT-SEQUENCE-SPEC.md` maps cleanly to 4 waves. Commits 03/04 can be merged (single Project API extension), and the three endpoints in commits 05/06/07 are parallelizable.

| Wave | Commits (SPEC) | Tasks (parallel-safe) | Boundary |
|------|----------------|------------------------|----------|
| **0** | — (scaffolds) | Test scaffolds + 10-locale i18n atomic commit | Schema unchanged yet; tests all `.todo()`/`.fixme()` — suite stays green |
| **1** | 01, 02 | Migration 052 + Zod enums/schemas + EventType union expansion | Serial — validation depends on migration shape being agreed |
| **2** | 03+04, 05, 06, 07 | **Parallel tasks:** (a) Project GET/POST/PATCH extensions, (b) Bootstrap endpoint, (c) Transition endpoint, (d) Gate PATCH endpoint. All four write to disjoint files. | All endpoints wired; tests replace `.todo()` with real assertions |
| **3** | 08 + 09 | **Parallel tasks:** (a) Gate-enforcement hook in task PUT (tiny, single-file), (b) Lifecycle tab components (new files), (c) Task-card badge components (new files), (d) Settings section extension. Only (b), (c), (d) are fully parallel; (a) is a 20-line change in a single file and can slot into any slot. | UI live, all behavior tested end-to-end in browser |
| **4** | 10 | Fill any remaining test `.todo()` marks, add Playwright E2E, update `/api/index/route.ts` to document new endpoints, verify full suite green | Phase gate; `/gsd:verify-work` can proceed |

**Parallelism math:** Wave 2 has 4 parallel tasks (one agent each), Wave 3 has 3 parallel UI tasks + 1 small hook task. Expected wall-clock savings vs. serial: ~40% for the endpoint wave, ~50% for the UI wave.

## Sources

### Primary (HIGH confidence)

- `src/lib/migrations.ts:1432-1441` — confirmed next migration ID is `052` and exact style (PRAGMA guard pattern from line 816-817)
- `src/lib/schema.sql:5-20, 51-60` — tasks, projects, activities base schema
- `src/lib/auth.ts:623-641` — `requireRole` contract + role hierarchy
- `src/lib/event-bus.ts:15-65` — `EventType` union (must extend) + `.broadcast()` method (not `.emit()`)
- `src/lib/validation.ts:1-200` — Zod + `validateBody` helper pattern
- `src/lib/config.ts:69-113` — `config.dataDir` resolution (canonical location for gsd-templates/)
- `src/app/api/projects/route.ts:22-135` — GET/POST patterns for project list/create with GSD extension points
- `src/app/api/projects/[id]/route.ts:21-275` — GET/PATCH/DELETE with `body?.field !== undefined` PATCH pattern
- `src/app/api/tasks/[id]/route.ts:87-407` — PUT flow, `normalizeTaskUpdateStatus`, **gate hook point at line 172**, `eventBus.broadcast` at line 400
- `src/app/api/projects/[id]/sessions/route.ts:55-60` — scoped endpoint nesting pattern
- `src/app/api/activities/route.ts:34-80` — how events surface in the activity stream (pure DB read)
- `src/app/api/events/route.ts:1-75` — SSE broadcast pipeline
- `src/components/project/project-tabs.tsx:8` — VIEWS tuple to extend
- `src/components/project/project-view-router.tsx:16-28` — router switch to extend
- `src/components/project/settings-view.tsx:82-517` — FieldBlock + per-field useState + useMemo isDirty pattern
- `src/components/project/project-context.tsx:14-41` — URL-derived view state
- `src/components/panels/task-board-panel.tsx:1046-1090` — task-card metadata row; exact ticket_ref badge classes for parity
- `src/components/ui/button.tsx` — confirms `success` and `destructive` variants exist
- `messages/en.json:2231-2349` — `project.*` namespace structure
- `.planning/phases/09-gsd-native-integration/09-CONTEXT.md` — 38 locked decisions
- `.planning/phases/09-gsd-native-integration/09-UI-SPEC.md` — approved UI design contract
- `.planning/REQUIREMENTS.md:57-109` — GSD-01..29 verbatim
- `.planning/phases/09-gsd-native-integration/09-00-SPEC.md` — narrative spec
- `.planning/config.json` — `workflow.nyquist_validation=true` (validation section required)

### Secondary (MEDIUM confidence — inferred from existing code)

- Phase 05/06/08 one-shot i18n pattern — documented in STATE.md at phase 08 entries 141, 147; scripts are ephemeral and not present in `scripts/`. Reproduced by convention.

### Tertiary (LOW confidence — none)

None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all versions from lockfile; no new deps proposed.
- Architecture: HIGH — all patterns (migration, API, validation, event bus, form state) directly inspected in the active codebase.
- Pitfalls: HIGH — every pitfall traceable to a specific existing file line or a concrete edge case surfaced by the migration/endpoint design.
- Transition rules & gate hook: HIGH — direct code inspection of `src/app/api/tasks/[id]/route.ts:172` confirms hook location and the one-line insertion adjacent to existing Aegis gate.
- Migration ID: HIGH — last existing is `051_project_workspace_indexes` (src/lib/migrations.ts:1433); next is 052 verified.
- Template loader: HIGH — `config.dataDir` resolution directly sourced from `src/lib/config.ts:73`.

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable internal patterns; 30 days)
