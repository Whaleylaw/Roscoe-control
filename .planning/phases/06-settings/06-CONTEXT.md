# Phase 6: Settings - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Form-based Settings tab inside the project workspace where users edit a project's seven roadmap-scoped metadata fields — **name, description, status, color, ticket prefix, deadline, github_repo** — and persist changes through the existing `PATCH /api/projects/[id]` endpoint. The 16-line stub at `src/components/project/settings-view.tsx` is replaced with a real form. No new API surface, no schema changes, no additional fields beyond the roadmap seven.

Out of scope for Phase 6: GitHub sync sub-fields (`github_sync_enabled`, `github_default_branch`), agent assignments, delete action, cross-project settings.

</domain>

<decisions>
## Implementation Decisions

### Field Scope
- **D-01:** Settings tab exposes exactly seven fields — name, description, status, color, ticket_prefix, deadline, github_repo. No sync toggle, no default branch, no agent assignments. Those remain in `project-manager-modal.tsx` for now.
- **D-02:** Status field is an Active/Archived select, not a button. The server's existing rule blocking archival of the `general` default project (src/app/api/projects/[id]/route.ts:114) stays authoritative — the UI can additionally disable the Archived option for that project to prevent a round-trip failure, but must still handle the 400 response defensively.
- **D-03:** Ticket prefix is editable with helper text clarifying the effect: *"Changing the prefix affects only new tickets. Existing tickets keep their original prefix."* Confirmed by inspecting `src/lib/task-dispatch.ts:118` — tickets are built from `task.ticket_prefix` captured at dispatch time, so past tickets are unaffected by later prefix changes. Server enforces uniqueness with 409 (route.ts:142).

### Save Flow
- **D-04:** Explicit Save + Cancel buttons with dirty-state tracking. The sticky footer appears only when any field differs from the loaded project. A single PATCH request commits all changes atomically.
- **D-05:** While saving, disable the form and show a subtle in-footer loading affordance (spinner or "Saving..." text). On success, clear dirty state and leave values in place.
- **D-06:** Cancel restores all fields to the last-loaded project values and clears dirty state without a confirmation prompt (no data is lost — user hasn't saved anything).

### Layout
- **D-07:** Single-page grouped layout with three section headers on a flat scroll (no accordions, no tabs-within-a-tab):
  1. **Basics** — name, description, status
  2. **Appearance & Tracking** — color, ticket_prefix, deadline
  3. **Integrations** — github_repo
- **D-08:** Fields inside a section may use a two-column grid where natural (e.g., ticket_prefix + deadline on one row), but the overall shell is vertical.
- **D-09:** Sticky Save/Cancel footer at the bottom of the form when dirty; hidden otherwise.

### Code Reuse
- **D-10:** Build the form fresh in `src/components/project/settings-view.tsx`. Do **not** refactor `project-manager-modal.tsx` to share a component — the modal's inline editor is list-row-shaped and Phase 4 ethos ("minimum-surface-area edits") says keep the blast radius local to this phase.
- **D-11:** `COLOR_PALETTE` duplication is acceptable (8 hex strings, one file each). If this bothers a future maintainer, extracting it to `src/lib/project-colors.ts` is a trivial backlog task.
- **D-12:** Color picker follows the modal's pattern: clicking a swatch toggles it; clicking the currently-selected swatch clears the color (null). See `project-manager-modal.tsx:386-396` for the reference.

### Validation & Error Feedback
- **D-13:** Inline per-field errors for known failures:
  - Empty name → inline error under the name field ("Project name cannot be empty")
  - ticket_prefix conflict (409) → inline error under the ticket_prefix field ("Ticket prefix already in use")
  - Invalid ticket_prefix (400) → inline error under the ticket_prefix field ("Invalid ticket prefix — letters and numbers only")
  - Default-project archive block (400) → inline error under the status field
- **D-14:** Unknown / network errors → top-of-form banner with the server's error text (falling back to "Failed to update project"). Banner clears on the next save attempt.
- **D-15:** Client-side validation is light — trust the server. Only block submission when the form is clean (no dirty state) or already in-flight. Do not duplicate server regex/length checks in the UI beyond what's needed to disable Save (e.g., empty name disables Save).

### Post-Save Propagation
- **D-16:** After PATCH success, re-fetch `/api/projects` and update the Zustand `projects` array. The existing `useProjectWorkspace()` store-lookup effect (src/components/project/project-context.tsx:42-51) will pick up the refreshed row and propagate to breadcrumb, dashboard header, and any other workspace surfaces that read from context.
- **D-17:** No optimistic update. Server normalizes values (e.g., ticket_prefix uppercased, trimmed strings, empty → null), so rendering the server's echoed project object avoids drift.
- **D-18:** No full page reload. No router.refresh(). The store refresh is sufficient.
- **D-19:** SSE reactivity is **not** wired for Phase 6 settings edits. A project PATCH does not currently emit a bus event that workspace shells subscribe to, and adding one is out of scope. Single-user editing is the assumed case; cross-session live-updates can be added later if needed.

### Permissions
- **D-20:** PATCH requires `operator` role (route.ts:82). The Settings tab should render in read-only mode for `viewer` role users — all inputs disabled, footer hidden, small inline note at the top. The planner should confirm the Zustand store already exposes the current user's role; if not, use the existing auth affordance already in place for other write-gated UI (e.g., task board delete button).

### i18n
- **D-21:** Phase 6 owns the `project.settings.*` namespace end-to-end, translated atomically across all 10 locales in the same commit. Phase 5 explicitly deferred this; there is currently only a `title` + `placeholder` stub in `messages/*.json`. Follow the Phase 5 atomic-translation playbook (Translated all 10 locales in one task to prevent messages/*.json merge conflicts across parallel plans).
- **D-22:** Brand-style tokens (e.g., ticket-prefix example "PA", color names like "#3b82f6") stay untranslated. Placeholders for helper-text interpolations use ICU syntax consistent with existing messages.

### Claude's Discretion
- Exact prop/hook shape for the form — likely a single `useState` per field or a `useReducer` for dirty-state tracking; planner decides.
- Spinner / loading affordance style (reuse existing `Loader` component from `src/components/ui/loader.tsx` if available).
- Whether to split the form into a sub-component within the project directory or keep it as a single file — Phase 1 FOUN-03 prohibits monolithic panels, but settings-view at ~300 lines is fine as a single file.
- Exact section spacing, typography, and use of horizontal rules between sections.
- Focus behavior after save (keep focus where it was vs. blur all fields).
- Whether to disable the Save button while fields are pristine (implicit from D-09 but worth confirming during planning).
- Read-only-mode copy ("You don't have permission to edit these settings" or similar).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning
- `.planning/PROJECT.md` — Core value, constraints, evolution log
- `.planning/REQUIREMENTS.md` — SETT-01, SETT-02, SETT-03 with acceptance criteria
- `.planning/ROADMAP.md` — Phase 6 goal, success criteria

### Prior Phase Context (establish patterns reused here)
- `.planning/phases/01-foundation/01-CONTEXT.md` — URL routing decisions, component directory layout, i18n namespace (FOUN-03, FOUN-04)
- `.planning/phases/02-navigation-workspace-shell/02-CONTEXT.md` — Workspace shell, breadcrumb, tabs, data fetching
- `.planning/phases/03-project-dashboard/03-CONTEXT.md` — SSE real-time update patterns (not wired here per D-19 but informs post-save propagation choice)
- `.planning/phases/04-project-tasks/04-CONTEXT.md` — **Minimum-surface-area edit ethos (D-10 derives from this)**
- `.planning/phases/05-sessions-agents/05-CONTEXT.md` — Atomic i18n translation across 10 locales (D-21), build-new-component playbook for the scoped view

### Key Source Files (View to Replace)
- `src/components/project/settings-view.tsx` — 16-line stub; replace with grouped form
- `src/components/project/project-context.tsx` — `useProjectWorkspace()` exposes the current `project` (id, slug, name, etc.); post-save refresh flows through this context via the existing store-lookup effect (lines 42-51)
- `src/components/project/project-view-router.tsx` — Already routes `view === 'settings'` to `<SettingsView />`; no router changes expected

### Key Source Files (Reference, Do Not Edit)
- `src/components/modals/project-manager-modal.tsx` — 435-line multi-project modal with the inline edit form that is the UX reference (lines 143-424). Do NOT refactor it for Phase 6 (D-10).
- `src/components/ui/button.tsx` — Button primitive with variants (default, secondary, outline, destructive, ghost) and sizes (xs, sm, default, lg, icon-sm)
- `src/components/ui/loader.tsx` — Loading affordance if needed

### API & Server Logic (Read-only, DO NOT change)
- `src/app/api/projects/[id]/route.ts:78-201` — PATCH handler accepting name, description, ticket_prefix, status, github_repo, deadline, color, github_sync_enabled, github_default_branch, github_labels_initialized. Server-side validations: empty name → 400, ticket_prefix uniqueness → 409, invalid prefix after normalize → 400, default-project archive block → 400.
- `src/app/api/projects/[id]/route.ts:11-14` — `normalizePrefix()` uppercases + strips non-alphanumerics + 12-char cap. UI should either mirror the transformation for preview or rely on the server's echo after save.
- `src/lib/task-dispatch.ts:118-119` — Ticket refs captured at dispatch time using the project's prefix at that moment; confirms D-03 rationale.

### Data Model
- `src/lib/migrations.ts:691-703` — `projects` table base schema (created_at, updated_at, workspace_id, name, slug, description, ticket_prefix, ticket_counter, status)
- `src/lib/migrations.ts:819-820` — Later ALTER TABLE adding `github_repo`, `deadline`
- `src/lib/migrations.ts` around line 824+ — `color`, `github_sync_enabled`, `github_default_branch`, `github_labels_initialized`

### i18n
- `messages/en.json` (plus ar, de, es, fr, ja, ko, pt, ru, zh — 10 total) — add `project.settings.*` keys atomically per D-21
- Current stub: `project.settings.title` and `project.settings.placeholder` only

### Codebase Architecture
- `.planning/codebase/ARCHITECTURE.md` — Data flow, Zustand store, SSE patterns
- `.planning/codebase/CONVENTIONS.md` — Naming, imports, component patterns
- `.planning/codebase/STRUCTURE.md` — Directory layout

### Project Instructions
- `./CLAUDE.md` — pnpm only, no icon libraries, next-intl for all user-facing strings, Conventional Commits **without** AI attribution, path alias `@/*` → `./src/*`, SQLite via better-sqlite3 (no ORM; prepared statements only)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `project-manager-modal.tsx` inline edit form (lines 143-424) — UX reference for field controls, color picker interaction, deadline date input, github_repo layout. Copy patterns, do not import.
- `COLOR_PALETTE` constant (8 hex strings) in project-manager-modal.tsx:30-39 — duplicate into settings-view.tsx (D-11).
- `normalizePrefix()` logic in route.ts:11-14 — server performs uppercase + strip + 12-char cap. UI can leave input uppercasing to the server echo, or mirror client-side (planner decides).
- `useProjectWorkspace()` from project-context.tsx — provides `project` (full object), `slug`, `loading`, `error` for form initial values and reload handling.
- Zustand store `projects[]` + `setActiveProject()` — refresh target after PATCH (D-16).
- Button primitive variants — default (primary), secondary (Cancel), outline, destructive (none needed for Phase 6).

### Established Patterns
- Views in `src/components/project/` are thin wrappers around workspace-specific logic; stubs get replaced when their phase comes (Phase 4 tasks-view, Phase 5 sessions-view/agents-view, Phase 6 settings-view).
- Server-side validation is authoritative; client mirrors minimally (empty name, dirty state).
- i18n keys added atomically across all 10 locales in a dedicated task within the first plan (Phase 5 pattern).
- Post-action reactivity flows through Zustand store refresh → context effect → UI updates (no prop drilling, no window events needed for this phase).

### Integration Points
- `src/components/project/settings-view.tsx` — the only file needing substantive net-new code.
- `messages/{ar,de,en,es,fr,ja,ko,pt,ru,zh}.json` — `project.settings.*` namespace expands from 2 keys to ~20 (field labels + helper text + error messages + section headers + save/cancel buttons + permission-denied note).
- `project-view-router.tsx` — already routes to SettingsView; no change.
- `project-context.tsx` — consumer only; no change.
- No API changes. No schema changes. No new routes.

### Pitfalls to Watch For (informs Wave-0 test scaffolds)
- **Ticket prefix normalization**: Server uppercases + strips non-alphanumerics; if UI shows "pa-1" and server stores "PA1", the form's dirty check must compare normalized values or the field will always look dirty after save.
- **Default project archive**: The `general` project cannot be archived (route.ts:114); UI must handle the 400 response even if the Archived option is disabled for that project.
- **ticket_counter not editable**: The schema has `ticket_counter`, but Phase 6 never exposes it. Tests should assert it's never in the PATCH body.
- **Deadline timezone**: The modal converts the date input to Unix seconds via `new Date(...).getTime() / 1000`. Timezone-sensitive — verify the round-trip preserves the user's intended date.
- **Null vs empty string**: The PATCH route coerces empty strings to null for description, github_repo, color, deadline. UI should send either the trimmed value or omit the field; explicit `""` payloads should round-trip correctly but tests should cover this.

</code_context>

<specifics>
## Specific Ideas

- UX reference implementation is `project-manager-modal.tsx`'s inline edit section (lines 143-424). Layout is simpler (no multi-project list, no assigned-agents picker, no GitHub sync toggle) but the field controls match one-to-one for the seven in-scope fields.
- Sticky Save/Cancel footer should feel like a standard settings page (e.g., GitHub's repo settings): appears only when dirty, fixed at the bottom of the form, never overlaps the last field.
- Commit style per Phase 5 precedent: `feat(06-XX)`, `test(06-XX)`, **no `Co-Authored-By` trailers** per CLAUDE.md override.
- Translations should preserve ICU placeholders and keep brand/technical tokens (ticket prefix examples like "PA", hex color strings) untranslated.

</specifics>

<deferred>
## Deferred Ideas

- **GitHub sync sub-fields** (`github_sync_enabled`, `github_default_branch`) — deferred from Phase 6; stays in project-manager-modal until a later integration-focused phase.
- **Assigned agents management from Settings tab** — the Agents tab already handles viewing; full assignment management from Settings could be a future polish item.
- **Delete project from Settings** (Danger Zone) — out of Phase 6 scope; delete remains in project-manager-modal.
- **Cross-session live updates** via SSE when another user edits project metadata — no bus event is currently emitted for project PATCH, and single-user editing is the assumed case.
- **Extracting `COLOR_PALETTE` to a shared module** — trivial backlog task; acceptable duplication for now.
- **Extracting a shared `<ProjectEditForm />` component** used by both project-manager-modal and settings-view — refactor deferred until a second consumer demands it.
- **Client-side ticket-prefix live preview** — could mirror `normalizePrefix()` as the user types; deferred unless post-launch UX feedback demands it.

</deferred>

---

*Phase: 06-settings*
*Context gathered: 2026-04-13*
