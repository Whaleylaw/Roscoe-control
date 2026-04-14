# Phase 6: Settings - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 06-settings
**Areas discussed:** Field scope, Save flow, Layout, Code reuse, Validation, Post-save propagation, Destructive actions, Prefix editing

---

## Field Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Roadmap 7 only | name, description, status, color, ticket prefix, deadline, github_repo. Matches SETT-01/02 exactly. | ✓ |
| Roadmap 7 + GitHub sync sub-fields | Above plus github_sync_enabled toggle + github_default_branch. Mirrors project-manager-modal edit form. | |
| Full parity with project-manager-modal | All of the above plus assigned_agents multi-select. | |

**User's choice:** Roadmap 7 only (Recommended)
**Notes:** Keeps Phase 6 focused on the roadmap requirements; sync sub-fields and agent assignments remain in project-manager-modal.

---

## Save Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit Save + Cancel | Dirty-state tracked, sticky footer on change, one PATCH per save. | ✓ |
| Per-field inline save (on blur) | Each field PATCHes independently on blur/toggle. | |
| Auto-save debounced | Changes saved automatically 500ms after last edit. | |

**User's choice:** Explicit Save + Cancel (Recommended)
**Notes:** Clearest UX for a settings surface; aligns with project-manager-modal save pattern.

---

## Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped sections | Three labeled sections: Basics / Appearance & Tracking / Integrations. Flat scroll. | ✓ |
| Single flat form | All fields in one vertical list, no section headers. | |
| Two-column grid like the modal | Mimic project-manager-modal's inline edit md:grid-cols-2 pairs. | |

**User's choice:** Grouped sections (Recommended)
**Notes:** Readable at-a-glance; groups related fields without over-engineering with accordions.

---

## Code Reuse

| Option | Description | Selected |
|--------|-------------|----------|
| Build fresh in settings-view.tsx | New self-contained form using same PATCH contract. Modal untouched. | ✓ |
| Extract shared <ProjectEditForm /> component | Refactor modal to use a shared component used by both surfaces. | |
| Just import project-manager-modal's edit section | Export the inline block and drop it in. | |

**User's choice:** Build fresh in settings-view.tsx (Recommended)
**Notes:** Phase 4 minimum-surface-area ethos; acceptable duplication of ~8 inputs + COLOR_PALETTE.

---

## Validation

| Option | Description | Selected |
|--------|-------------|----------|
| Inline per-field + banner fallback | Known errors mapped to offending field; unknown → top banner. | ✓ |
| Top-of-form banner only | Single banner above form for any failure. | |
| Toast notifications | Transient toasts for success + error. | |

**User's choice:** Inline per-field + banner fallback (Recommended)
**Notes:** Matches the API's structured error responses; keeps field-specific errors close to the field.

---

## Post-Save

| Option | Description | Selected |
|--------|-------------|----------|
| Refresh store + context | Re-fetch /api/projects, update Zustand; context effect propagates to workspace. | ✓ |
| Optimistic local update | Patch Zustand from PATCH response, no re-fetch. | |
| Full workspace reload | router.refresh() or window.location.reload(). | |

**User's choice:** Refresh store + context (Recommended)
**Notes:** Avoids drift from server normalization (uppercased ticket_prefix, trimmed strings); live updates breadcrumb and dashboard via existing context effect.

---

## Destructive Actions

| Option | Description | Selected |
|--------|-------------|----------|
| Status toggle only | Active/Archived select only; delete stays in project-manager-modal. | ✓ |
| Status toggle + Danger Zone delete | Plus a Delete button in its own section, admin-only. | |
| Archive button, no status select | Replace status field with an Archive/Activate button. | |

**User's choice:** Status toggle only (Recommended)
**Notes:** Matches roadmap scope exactly; avoids expanding Phase 6 beyond SETT-01/02/03.

---

## Prefix Edit

| Option | Description | Selected |
|--------|-------------|----------|
| Editable with warning | Field is editable; helper text explains past tickets keep their original prefix. | ✓ |
| Editable, no explanatory text | Just a text input. | |
| Read-only in Settings | Value shown but disallowed from workspace; must use project-manager-modal. | |

**User's choice:** Editable with warning (Recommended)
**Notes:** Confirmed via task-dispatch.ts:118 — tickets are captured with their prefix at dispatch time, so existing tickets are unaffected by later prefix changes.

---

## Claude's Discretion

- Prop/hook shape for the form (useState per field vs useReducer)
- Spinner / loading affordance style (likely reuse src/components/ui/loader.tsx)
- Whether to split the form into sub-components within project/ (FOUN-03 allows flexibility; ~300 lines is fine as single file)
- Section spacing, typography, horizontal rules between sections
- Focus behavior after save
- Whether to disable Save button while fields are pristine
- Read-only-mode copy for viewer role

## Deferred Ideas

- GitHub sync sub-fields (github_sync_enabled, github_default_branch)
- Agent assignment management from Settings tab
- Delete project from Settings (Danger Zone)
- Cross-session live updates via SSE for project edits
- Extracting COLOR_PALETTE to a shared module
- Extracting shared <ProjectEditForm /> component (deferred until second consumer demands it)
- Client-side ticket-prefix live preview (normalizePrefix mirror)
