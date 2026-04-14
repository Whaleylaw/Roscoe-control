# Phase 6: Settings - Research

**Researched:** 2026-04-13
**Domain:** React form with dirty-state tracking on an existing REST API (Next.js 16 / React 19 / TypeScript / Tailwind / Zustand / next-intl)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Field Scope**
- **D-01:** Settings tab exposes exactly seven fields — `name`, `description`, `status`, `color`, `ticket_prefix`, `deadline`, `github_repo`. No sync toggle, no default branch, no agent assignments. Those remain in `project-manager-modal.tsx`.
- **D-02:** Status field is an Active/Archived select (not a button). Server rule blocking archival of the `general` default project (route.ts:114) stays authoritative. UI may additionally disable the Archived option for that project, but must still handle the 400 response defensively.
- **D-03:** Ticket prefix is editable with helper text: *"Changing the prefix affects only new tickets. Existing tickets keep their original prefix."* (confirmed by `src/lib/task-dispatch.ts:118` — tickets captured at dispatch time). Server enforces uniqueness with 409.

**Save Flow**
- **D-04:** Explicit Save + Cancel buttons with dirty-state tracking. Sticky footer appears only when any field differs from loaded project. Single PATCH request commits all changes atomically.
- **D-05:** While saving, disable form, show subtle in-footer "Saving…" affordance. On success, clear dirty state, leave values in place.
- **D-06:** Cancel restores all fields to last-loaded values and clears dirty state without a confirmation prompt.

**Layout**
- **D-07:** Single-page grouped layout with three section headers on a flat scroll (no accordions, no tabs-within-a-tab):
  1. **Basics** — name, description, status
  2. **Appearance & Tracking** — color, ticket_prefix, deadline
  3. **Integrations** — github_repo
- **D-08:** Fields inside a section may use a two-column grid (e.g., ticket_prefix + deadline on one row); shell is vertical.
- **D-09:** Sticky Save/Cancel footer at bottom when dirty; hidden otherwise.

**Code Reuse**
- **D-10:** Build fresh in `src/components/project/settings-view.tsx`. Do NOT refactor `project-manager-modal.tsx` for sharing (Phase 4 minimum-surface-area ethos).
- **D-11:** `COLOR_PALETTE` duplication is acceptable (8 hex strings).
- **D-12:** Color picker follows modal pattern: clicking a swatch toggles it; clicking selected swatch clears to null. Reference: `project-manager-modal.tsx:386-396`.

**Validation & Error Feedback**
- **D-13:** Inline per-field errors for known failures:
  - Empty name → under name field ("Project name cannot be empty")
  - ticket_prefix 409 → under ticket_prefix field ("Ticket prefix already in use")
  - Invalid ticket_prefix 400 → under ticket_prefix field ("Invalid ticket prefix — letters and numbers only")
  - Default-project archive 400 → under status field
- **D-14:** Unknown/network errors → top-of-form banner with server's error text (fallback "Failed to update project"). Banner clears on next save attempt.
- **D-15:** Client-side validation is light — trust server. Only block submission when form is clean or already in-flight. Do not duplicate server regex/length checks beyond disabling Save when name is empty.

**Post-Save Propagation**
- **D-16:** After PATCH success, re-fetch `/api/projects` and update Zustand `projects` array. The existing `useProjectWorkspace()` store-lookup effect (`project-context.tsx:42-51`) picks up the refreshed row.
- **D-17:** No optimistic update. Server normalizes values — render server's echoed project object.
- **D-18:** No full page reload. No `router.refresh()`. Store refresh is sufficient.
- **D-19:** SSE reactivity is NOT wired for Phase 6. Single-user editing is the assumed case.

**Permissions**
- **D-20:** PATCH requires `operator` role. Settings tab renders in read-only mode for `viewer` — inputs disabled, footer hidden, inline note at top. Role is available via `useMissionControl().currentUser?.role`.

**i18n**
- **D-21:** Phase 6 owns the `project.settings.*` namespace end-to-end, translated atomically across all 10 locales in the same commit (Phase 5 atomic-translation playbook).
- **D-22:** Brand-style tokens (e.g., "PA", hex colors like "#3b82f6") stay untranslated. Placeholders use ICU syntax consistent with existing messages.

### Claude's Discretion

- Exact prop/hook shape for the form (single `useState` per field vs. `useReducer` for dirty-state tracking).
- Spinner/loading affordance style (reuse `Loader` if needed, but default is text swap per UI-SPEC).
- Whether to split form into sub-component or keep as single file — settings-view at ~300 lines is fine as a single file.
- Exact section spacing, typography, use of horizontal rules.
- Focus behavior after save (keep focus vs. blur all).
- Whether to disable Save button while pristine (implicit from D-09).
- Read-only-mode copy ("You don't have permission to edit these settings" or similar).

### Deferred Ideas (OUT OF SCOPE)

- **GitHub sync sub-fields** (`github_sync_enabled`, `github_default_branch`) — stays in project-manager-modal.
- **Assigned agents management from Settings tab.**
- **Delete project from Settings** (Danger Zone).
- **Cross-session live updates** via SSE for project PATCH.
- **Extracting `COLOR_PALETTE` to a shared module.**
- **Extracting a shared `<ProjectEditForm />` component.**
- **Client-side ticket-prefix live preview.**
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SETT-01** | User can edit project name, description, and status from project settings | PATCH `/api/projects/[id]` accepts `name`, `description`, `status` (route.ts:125-151). Section 1 "Basics" of the form covers these three fields. Server enforces empty-name → 400, archived-default → 400. |
| **SETT-02** | User can edit project color, ticket prefix, deadline, and GitHub repo from settings | PATCH accepts `color`, `ticket_prefix`, `deadline`, `github_repo` (route.ts:135-162). Sections 2 "Appearance & Tracking" and 3 "Integrations" cover these four fields. Server normalizes prefix (uppercase + strip + 12-char cap) and enforces uniqueness (409). |
| **SETT-03** | Project settings use existing PATCH /api/projects/[id] endpoint | No new API surface. Server route at `src/app/api/projects/[id]/route.ts:78-201` handles all seven fields. Post-save: re-fetch `/api/projects` → Zustand `setProjects()` → context propagation. |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

- **Package manager**: pnpm only (`corepack enable`). No npm / yarn.
- **Icons**: No icon libraries. Use raw text/emoji/Unicode glyphs (`×`, `•`) only.
- **i18n**: All user-facing strings go through next-intl message files (10 locales: ar, de, en, es, fr, ja, ko, pt, ru, zh).
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`). **No AI attribution** — no `Co-Authored-By` trailers.
- **Database**: SQLite via `better-sqlite3`. Prepared statements only. No ORM. (Not touched in Phase 6.)
- **Path alias**: `@/*` → `./src/*`. Always use `@/` prefix for internal imports.
- **Standalone output**: `next.config.js` sets `output: 'standalone'`.
- **GSD workflow enforcement**: Before Edit/Write tool use, start work through a GSD command.

---

## Summary

Phase 6 replaces a 16-line stub at `src/components/project/settings-view.tsx` with a grouped three-section form that edits the seven roadmap-scoped project metadata fields and persists them atomically through the existing `PATCH /api/projects/[id]` endpoint. **No new API surface, no schema changes, no new dependencies.** The UI-SPEC is frozen; research confirms it is feasible with zero new design tokens and entirely reuses Tailwind utility patterns, the `Button` primitive, and Unicode-glyph-based affordances already in Phase 1–5.

All seven fields are editable by `operator` role users. The `viewer` role gets a read-only variant. The server is authoritative for validation (empty name, ticket_prefix uniqueness/regex, default-project archive block); the UI mirrors only enough to disable Save. Post-save reactivity flows through a Zustand `setProjects()` refresh that the existing `useProjectWorkspace()` store-lookup effect (`project-context.tsx:42-51`) picks up. No SSE, no `router.refresh()`.

**Primary recommendation:** Build the form as a single functional component using granular `useState` per field. Compute `isDirty` from a normalized comparison against the last-loaded project. On Save, build a partial PATCH body (only dirty fields), POST to `/api/projects/[id]`, then call the store's `fetchProjects()` and seed local form state from the server-echoed project object. Translations ship in the same commit across all 10 locales — follow the Phase 5 atomic-i18n playbook.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.0.x | UI rendering, hooks | Already the app's UI runtime; no alternatives acceptable |
| Next.js | 16.1.x (App Router) | Route handler, client component boundary | App already built on Next.js 16 |
| TypeScript | 5.7.x | Type safety | Strict mode enabled; `@/*` path alias in place |
| next-intl | 4.8.x | i18n for all form strings | FOUN-04 requires every user-facing string go through message files; `project.settings.*` namespace already stubbed |
| Tailwind CSS | 3.4.x | All layout & styling | All prior phases ship Tailwind-only styling; UI-SPEC inherits tokens |
| Zustand | 5.0.x | `projects[]` refresh after save | `useMissionControl().setProjects()` / `fetchProjects()` already exposed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | 2.1.x | Unit tests for the view | Every Phase 1–5 plan used `it.todo()` scaffolds in Wave 0 |
| @testing-library/react | 16.1.x | DOM rendering in unit tests | Phase 5 sessions-view/agents-view tests are the reference pattern |
| @radix-ui/react-slot | 1.2.x | Powers `Button` variant composition | Already wired via `src/components/ui/button.tsx`; no new Radix primitives needed |
| Playwright | 1.51.x | E2E happy-path test | Only if Wave 0 test scaffold requires an end-to-end trace |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Granular `useState` per field | `useReducer` with a single `formState` | Reducer is cleaner for 7 fields but adds ceremony; `useState` is the pattern used by every other form in this codebase (modal, task board, cron) — stick with precedent |
| Native `<select>` for status | Custom dropdown (Radix Select) | CLAUDE.md forbids icon libraries and Phase 6 adds no new tokens; native select is already used in Phase 5 modals and passes a11y requirements |
| `react-hook-form` / `formik` | Hand-rolled form state | Adds a heavy dependency for 7 fields; no existing form in the codebase uses a form library. Do NOT introduce |
| Client Zod validation | Server-only validation | D-15 explicitly defers to server; client mirrors only "name non-empty" for Save-button disabling |
| Optimistic update | Server-echoed update | D-17 forbids optimistic UI — server normalizes ticket_prefix and coerces empty strings to null, so rendering the echoed object avoids drift |

**Installation:** None. All libraries already present in `package.json`. No `pnpm install` step required.

**Version verification:** Not applicable — Phase 6 introduces no new dependencies. (Skipped the `npm view` verification step intentionally; this is a pure UI-on-existing-stack phase.)

---

## Architecture Patterns

### Recommended Project Structure

```
src/components/project/
├── settings-view.tsx                   # REWRITE — 16-line stub → ~300-line form
├── project-context.tsx                 # Read-only reference; provides useProjectWorkspace()
├── project-view-router.tsx             # Read-only; already routes view === 'settings'
└── __tests__/
    └── settings-view.test.tsx          # NEW — Vitest unit test file

messages/
├── en.json                             # Extend project.settings.* namespace
├── ar.json, de.json, es.json,
├── fr.json, ja.json, ko.json,
├── pt.json, ru.json, zh.json           # Atomic translation across all 10 locales
```

### Pattern 1: Client Component with Workspace Context + Zustand

**What:** The settings view is a `'use client'` component that reads the current project via `useProjectWorkspace()` (React context) and refreshes it after save via `useMissionControl()` (Zustand store).

**When to use:** Any scoped view that needs both the URL-derived project object AND the ability to trigger a store-wide refresh.

**Example:**
```typescript
// Source: src/components/project/settings-view.tsx (new implementation pattern)
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useProjectWorkspace } from '@/components/project/project-context'
import { useMissionControl } from '@/store'

export function SettingsView() {
  const t = useTranslations('project.settings')
  const { project, loading } = useProjectWorkspace()
  const { fetchProjects, currentUser } = useMissionControl()
  const isReadOnly = currentUser?.role === 'viewer'

  // Granular state per field
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<'active' | 'archived'>('active')
  const [color, setColor] = useState('')
  const [ticketPrefix, setTicketPrefix] = useState('')
  const [deadline, setDeadline] = useState('')
  const [githubRepo, setGithubRepo] = useState('')

  // Seed from project whenever it changes
  useEffect(() => {
    if (!project) return
    setName(project.name)
    setDescription(project.description ?? '')
    setStatus(project.status === 'archived' ? 'archived' : 'active')
    setColor(project.color ?? '')
    setTicketPrefix(project.ticket_prefix)
    setDeadline(project.deadline ? new Date(project.deadline * 1000).toISOString().split('T')[0] : '')
    setGithubRepo(project.github_repo ?? '')
  }, [project])

  const handleSave = useCallback(async () => {
    // Build partial PATCH body from dirty fields
    // fetch PATCH, await, fetchProjects(), clear dirty
  }, [/* deps */])

  // ...
}
```

### Pattern 2: Normalized Dirty-State Comparison

**What:** `isDirty` is computed by normalizing both form state and loaded project state, then comparing. Prevents false-dirty after save caused by server normalization (ticket_prefix uppercasing, empty→null coercion).

**When to use:** Any form where the server normalizes values before persisting.

**Example:**
```typescript
// Source: derived from route.ts:11-14 (normalizePrefix) + UI-SPEC dirty detection rules
function normalizePrefix(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

function deadlineToIsoDate(deadline: number | null | undefined): string {
  if (!deadline) return ''
  return new Date(deadline * 1000).toISOString().split('T')[0]
}

function computeDirty(
  form: FormState,
  project: Project,
): boolean {
  const trimmedName = form.name.trim()
  const trimmedDesc = form.description.trim()
  const normPrefix = normalizePrefix(form.ticketPrefix)
  const trimmedRepo = form.githubRepo.trim()
  const trimmedColor = form.color.trim()

  if (trimmedName !== project.name) return true
  if (trimmedDesc !== (project.description ?? '')) return true
  if (form.status !== (project.status === 'archived' ? 'archived' : 'active')) return true
  if (trimmedColor !== (project.color ?? '')) return true
  if (normPrefix !== project.ticket_prefix) return true
  if (form.deadline !== deadlineToIsoDate(project.deadline)) return true
  if (trimmedRepo !== (project.github_repo ?? '')) return true
  return false
}
```

### Pattern 3: Error Routing — Server Error String → Inline Field

**What:** The server returns `{ error: string }` with 400/409. Match the string to a known inline-field error; fall back to top-of-form banner.

**When to use:** Any form that needs differentiated inline vs. banner error handling.

**Example:**
```typescript
// Source: derived from route.ts:117, 127, 138, 143 error strings + UI-SPEC error mapping
type FieldErrorKey = 'name' | 'ticketPrefix' | 'status'

function routeError(errorText: string): { field?: FieldErrorKey; bannerText?: string } {
  if (errorText === 'Project name cannot be empty') return { field: 'name' }
  if (errorText === 'Ticket prefix already in use') return { field: 'ticketPrefix' }
  if (errorText === 'Invalid ticket prefix') return { field: 'ticketPrefix' }
  if (errorText === 'Default project cannot be archived') return { field: 'status' }
  return { bannerText: errorText || 'Failed to update project' }
}
```

### Pattern 4: Atomic i18n Translation (Phase 5 Playbook)

**What:** Phase 5 introduced the atomic-translation pattern: all 10 locale files updated in a single task/commit to prevent merge conflicts across parallel Wave 1 plans. Brand tokens (`PA`, `owner/repo`, hex strings) stay untranslated.

**When to use:** Any phase that adds new i18n keys to the `project.*` namespace.

**Reference:** `.planning/phases/05-sessions-agents/05-00-PLAN.md` Task 1 translates ar, de, en, es, fr, ja, ko, pt, ru, zh atomically. Same pattern applies here for ~29 new `project.settings.*` keys (+ verify existing `title`, remove `placeholder` stub).

### Anti-Patterns to Avoid

- **Optimistic update before server confirms** — Server normalizes `ticket_prefix` (uppercase + strip); rendering the local value before the PATCH response will cause visible flicker when the value changes. Render server-echoed values only.
- **Direct props from modal component** — `project-manager-modal.tsx` is the UX reference, NOT an import target. D-10 forbids refactoring it into a shared form; copy the patterns, write the code fresh.
- **`router.refresh()` after save** — Kills client state and re-fetches the whole tree. Unnecessary; Zustand `fetchProjects()` + context-effect propagation is sufficient (D-18).
- **Mirror server regex client-side** — D-15 says trust server. Only block Save on empty name; let the server return 400/409 for anything else.
- **Adding per-field "touched" state** — UI-SPEC shows errors only after a save attempt (no on-blur validation). Keep it simple: one inline error per field cleared by next edit or next save attempt.
- **Custom SELECT component** — Native `<select>` is specified. Do not introduce a Radix Select or custom dropdown.
- **Icon libraries** — CLAUDE.md explicit prohibition. Use Unicode glyphs (`×`, `•`, colored dots via `bg-primary rounded-full`) only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form state management | Custom reducer with actions/middleware | Granular `useState` per field | Codebase pattern; 7 fields don't justify reducer overhead |
| Client-side field validation | Duplicate of server `normalizePrefix`, length checks, email regex, etc. | Server validation + inline errors on response | D-15; server is authoritative |
| Date picker UI | Custom calendar component | Native `<input type="date">` | UI-SPEC specifies browser-native; matches `project-manager-modal.tsx:376-381` |
| Toggle between active/archived | Custom toggle switch | Native `<select>` | D-02 specifies select, not a button or toggle |
| Color picker | Custom color wheel or third-party | 8-swatch palette + "None" pill (duplicated from modal) | D-12 |
| Loading spinner during save | Custom animated spinner | Text swap "Saving…" or existing `Loader` component if needed | UI-SPEC specifies text-swap as default |
| Toast on save success | Sonner / react-hot-toast / custom | No toast — silent success (UI-SPEC § Success state) | Matches Phase 3/5 silent reconciliation pattern |
| SSE event wiring for project PATCH | New event type + broadcast + listener | Zustand `fetchProjects()` after PATCH | D-19 explicitly defers cross-session live updates |
| Dirty-state library (e.g., React Hook Form's `isDirty`) | react-hook-form, formik, react-final-form | Hand-rolled `computeDirty()` using normalized comparison | Zero new deps; normalization is domain-specific anyway |

**Key insight:** Every problem Phase 6 needs to solve already has an in-house pattern from Phases 1–5 or from `project-manager-modal.tsx`. The discipline is to copy those patterns without importing the source components. The ONE new library-level decision — "how do we manage form state?" — is answered by "the same way every other form in this codebase does: `useState` per field." No new dependencies.

---

## Environment Availability

Step 2.6: **SKIPPED (no external dependencies identified)** — Phase 6 is a pure frontend change against an existing API, with no new tools, runtimes, services, or package installations. All required infrastructure (Node.js 22+, pnpm, better-sqlite3 native addon, Next.js dev server) is already running from Phases 1–5.

---

## Common Pitfalls

### Pitfall 1: False-Dirty After Save Due to Ticket Prefix Normalization

**What goes wrong:** User types `pa-1` in ticket_prefix. Form state has `pa-1`. PATCH fires; server stores `PA1`. Response echoes `{ ticket_prefix: "PA1" }`. Form state still has `pa-1`. Dirty check: `pa-1 !== PA1` → footer stays visible forever; Save fires again; loops.

**Why it happens:** Server runs `normalizePrefix()` (uppercase + strip non-alphanumeric + 12-char cap) at `route.ts:11-14`. The client does not.

**How to avoid:** After PATCH success, seed form state from the server-echoed `project` object (call `fetchProjects()`, let the context effect propagate the new row, and let the `useEffect([project])` re-initializer copy the echoed values into form state). Additionally, the `computeDirty()` function should apply the same `normalizePrefix()` to the user's typed value before comparing.

**Warning signs:** Footer remains visible after a successful save. Save button stays enabled after commit.

---

### Pitfall 2: Deadline Timezone Drift

**What goes wrong:** User picks `2026-04-14` in the date input. Code does `new Date('2026-04-14').getTime() / 1000`. In a negative-UTC-offset timezone (e.g., Pacific Time), JavaScript interprets the bare date string as UTC midnight — which is the previous local day. Server stores Unix seconds for `2026-04-13 UTC`. On reload, `new Date(deadline * 1000).toISOString().split('T')[0]` returns `2026-04-13` (UTC) or `2026-04-14` (local) depending on toISOString behavior — likely `2026-04-13`. User sees yesterday's date.

**Why it happens:** `new Date('YYYY-MM-DD')` is parsed as UTC per ECMA-262; `toISOString()` always emits UTC. Round-trip loses timezone.

**How to avoid:** Use consistent parsing: for the "to server" direction, compute `Math.floor(new Date(dateString + 'T00:00:00').getTime() / 1000)` to force local-midnight interpretation (matches the user's intent). For the "from server" direction, use `new Date(seconds * 1000).toISOString().split('T')[0]` OR use local-timezone-aware formatting if drift is observed. Important: match whatever `project-manager-modal.tsx:166` does so the two views agree on encoding. Currently it uses `new Date(editForm.deadline).getTime() / 1000` (UTC-interpreted) — Phase 6 should either match for consistency or document the deviation. **Recommendation: match the modal's existing encoding for now; fix in a future cross-cutting bug if user reports emerge.**

**Warning signs:** Deadline appears to shift one day after save in certain timezones. Round-trip test fails when mocked date crosses UTC boundary.

---

### Pitfall 3: Empty-String vs. Null Serialization

**What goes wrong:** User clears the github_repo field to empty. UI sends `{ github_repo: "" }`. Server at `route.ts:154` coerces this to `null` in the DB. Response echoes `{ github_repo: null }`. If form state retains the empty string, dirty check compares `"" !== null` via Object.is — actually this is `true` in strict equality — so the dirty check can misfire depending on normalization.

**Why it happens:** Server normalizes empty string → null. Client should treat these as equivalent for dirty comparison.

**How to avoid:** In `computeDirty()`, normalize both sides: `(trimmedValue || null) === (project.field ?? null)`. For the PATCH body, either send explicit `""` (server coerces) or omit the field entirely. Sending `""` is idempotent — verified by reading `route.ts:133, 154, 162` (all three fields: description, github_repo, color do the empty-string → null coercion via `.trim() || null`).

**Warning signs:** Dirty-state footer appears on first mount before any user input. Fields that were originally null show as "dirty" with no visible user change.

---

### Pitfall 4: Default Project Archive — UI Disables Option but Server 400 Still Possible

**What goes wrong:** UI disables the "Archived" option when `slug === 'general'`. But the Archived value could still be sent via direct form manipulation, a race (user opens settings for General while another user renames it), or a logic bug.

**Why it happens:** The server-side check at `route.ts:114-118` is authoritative: the `general` project cannot be archived. It returns 400 with `"Default project cannot be archived"`.

**How to avoid:** UI disables the option (D-02) AND handles the 400 response by routing it to the status field's inline error slot (D-13). Never assume the UI-side disable is enough.

**Warning signs:** 400 errors in logs from Settings tab. Silent-fail save on the General project.

---

### Pitfall 5: Role Check Uses `currentUser` That May Be Null During Boot

**What goes wrong:** `useMissionControl().currentUser` is initialized to `null` at the store level (src/store/index.ts:815) and populated asynchronously on boot. If the settings view renders during the tiny boot window where currentUser is null, `currentUser?.role === 'viewer'` is false — the view briefly shows the editable form to a viewer before collapsing to read-only.

**Why it happens:** Auth/user state hydrates asynchronously. The component can render before.

**How to avoid:** Treat `currentUser === null` as "unknown permissions — render read-only shell or a neutral loading state until role is known." The `loading` flag on `useProjectWorkspace()` will already keep us in a loading state until the project is fetched; gating on `currentUser !== null` AND `project !== null` together should eliminate the flash.

**Warning signs:** Flash of editable form on page load. Viewer role sees Save button momentarily.

---

### Pitfall 6: Form Re-Seeds and Clobbers User Edits on Store Refresh

**What goes wrong:** User types a new name but doesn't save. Another action elsewhere (nav-rail clock, stats poll) triggers `fetchProjects()`. The `projects[]` array updates. The `useProjectWorkspace()` context effect re-sets `project` to the refreshed row. The settings view's `useEffect([project])` seeds form state from the new project object — wiping the user's in-progress typing.

**Why it happens:** Effect-driven re-seeding does not distinguish between "fresh mount" and "remote refresh."

**How to avoid:** The seed effect should run ONLY when the form is pristine (`!isDirty`). Something like:
```typescript
useEffect(() => {
  if (!project) return
  if (isDirty) return  // Do not clobber user edits
  // seed form state
}, [project, isDirty])
```
UI-SPEC's "Real-time updates" section explicitly documents this: "If the form is pristine: re-sync. If dirty: keep user's in-progress edits. Silent reconciliation favors the editing user."

**Warning signs:** User reports "My typing gets erased when I'm editing." Tests show form state reverting after simulated background fetch.

---

### Pitfall 7: Locale Merge Conflicts Across Parallel Plans

**What goes wrong:** Two Wave 1 plans both touch `messages/en.json` (and 9 others). Git merge conflicts on `project.settings.*` keys.

**Why it happens:** JSON merges are fragile; parallel plans editing the same file serialize poorly.

**How to avoid:** Translate all 10 locales in a single dedicated task at Wave 0 (following Phase 5 precedent per D-21). Subsequent Wave 1 plans reference the keys by name but never touch the JSON files.

**Warning signs:** Merge conflicts on `messages/*.json`. Missing keys in non-en locales after rebase.

---

### Pitfall 8: i18n Test Asserts Only `settings` Key Present — Passes Trivially

**What goes wrong:** The existing `i18n-coverage.test.tsx` only checks that `project.settings` exists as a key, not that all 29 new sub-keys exist. Missing `project.settings.errorPrefixConflict` in `ja.json` would not be caught.

**Why it happens:** The Phase 1–5 coverage test was written when only `title` + `placeholder` stubs existed.

**How to avoid:** Extend `src/components/project/__tests__/i18n-coverage.test.tsx` in Wave 0 to iterate over the full `project.settings.*` key manifest (from UI-SPEC § i18n Key Manifest) and assert each key exists in each of the 10 locale files. This matches the Phase 5 approach (their test checks specific nested keys like `sessions.emptyHeading`, `agents.listHeader`).

**Warning signs:** A locale ships without a needed key; user sees a literal key path (e.g., `project.settings.errorPrefixConflict`) in the UI instead of translated copy.

---

### Pitfall 9: Button Default Size Mismatch with Inputs

**What goes wrong:** `Button` defaults to `size="md"` (h-9). Inputs in the form use `py-2` (which varies with line-height; typically ~36px = h-9 visually). Deadline `<input type="date">` specifically gets `h-9` per UI-SPEC. If inputs don't explicitly declare `h-9`, browser defaults can make the form look vertically misaligned when Save/Cancel buttons sit below.

**Why it happens:** Tailwind `py-2` + default font-size produces a computed height close to but not exactly 36px; the date input is browser-styled and varies.

**How to avoid:** Apply explicit `h-9` to all text/select inputs to match the Button height, OR accept the minor variance (modal's existing pattern does `px-3 py-2` without explicit height). UI-SPEC says `h-9` specifically for the date input because date-input browser rendering is taller than text-input by default. Recommendation: match modal precedent (`px-3 py-2` no height) for text/select fields; apply `h-9` only to date input.

**Warning signs:** Visual regression test flags vertical misalignment in the sticky footer.

---

### Pitfall 10: Reading `slug === 'general'` Without the Full Project Object

**What goes wrong:** Archived-option-disabled logic and viewer-role-readonly logic both need data from `project`. If the form mounts before `project` is populated, both checks silently fall through and may expose the wrong UI.

**Why it happens:** `project` is null until fetch completes.

**How to avoid:** Render a loader (`<Loader variant="panel" />`) when `loading === true` or `project === null`. Only render the form once `project !== null`. This is the pattern Phase 5 sessions-view and agents-view both follow.

**Warning signs:** Archived option enabled for the general project. Form renders with all-empty fields before project loads.

---

## Code Examples

### Minimal Save Flow (Reference Pattern)

```typescript
// Source: pattern derived from project-manager-modal.tsx:160-203 save flow
// + UI-SPEC § Save flow + D-16/D-17 post-save propagation rules

async function handleSave() {
  if (!project) return
  setIsSaving(true)
  setBannerError(null)
  setFieldErrors({})

  // Build partial body — only dirty fields
  const body: Record<string, unknown> = {}
  if (name.trim() !== project.name) body.name = name.trim()
  if (description.trim() !== (project.description ?? '')) body.description = description.trim()
  if (status !== (project.status === 'archived' ? 'archived' : 'active')) body.status = status
  if ((color.trim() || null) !== (project.color ?? null)) body.color = color.trim() || null
  const normPrefix = normalizePrefix(ticketPrefix)
  if (normPrefix !== project.ticket_prefix) body.ticket_prefix = normPrefix
  const newDeadlineSeconds = deadline
    ? Math.floor(new Date(deadline).getTime() / 1000)
    : null
  if (newDeadlineSeconds !== (project.deadline ?? null)) body.deadline = newDeadlineSeconds
  if ((githubRepo.trim() || null) !== (project.github_repo ?? null)) body.github_repo = githubRepo.trim() || null

  try {
    const res = await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      // Route to field error OR banner
      const routed = routeError(data.error)
      if (routed.field) {
        setFieldErrors({ [routed.field]: data.error })
      } else {
        setBannerError(routed.bannerText ?? 'Failed to update project')
      }
      return
    }
    // Success: refresh store; the context effect will re-seed the form via useEffect([project])
    await fetchProjects()
  } catch (err) {
    setBannerError(err instanceof Error ? err.message : 'Failed to update project')
  } finally {
    setIsSaving(false)
  }
}
```

### Color Swatch Keyboard-Accessible Pattern

```typescript
// Source: project-manager-modal.tsx:385-396 geometry + UI-SPEC § Color picker
// Duplicated COLOR_PALETTE per D-11

const COLOR_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
]

<fieldset className="space-y-2">
  <legend className="block text-sm font-semibold text-foreground">
    {t('colorLabel')}
  </legend>
  <div className="flex gap-2 items-center flex-wrap">
    {COLOR_PALETTE.map((c) => (
      <button
        key={c}
        type="button"
        aria-label={c}
        aria-pressed={color === c}
        onClick={() => setColor((prev) => (prev === c ? '' : c))}
        className={`w-6 h-6 rounded-full border-2 transition-smooth focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          color === c
            ? 'border-foreground scale-110'
            : 'border-transparent hover:border-border'
        }`}
        style={{ backgroundColor: c }}
        disabled={isReadOnly}
      />
    ))}
    <button
      type="button"
      aria-pressed={color === ''}
      onClick={() => setColor('')}
      className="bg-transparent border border-border rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
      disabled={isReadOnly}
    >
      {t('colorNone')}
    </button>
  </div>
</fieldset>
```

### Sticky Footer with Dirty-Saving-Cancel States

```typescript
// Source: UI-SPEC § Sticky footer verbatim

{isDirty && !isReadOnly && (
  <div className="sticky bottom-0 -mx-6 mt-6 px-6 py-4 bg-card/95 backdrop-blur border-t border-border flex items-center justify-between gap-4">
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {isSaving ? (
        <span>{t('saving')}</span>
      ) : (
        <>
          <span className="inline-block w-2 h-2 bg-primary rounded-full" aria-hidden="true" />
          <span>{t('unsavedChanges')}</span>
        </>
      )}
    </div>
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="md" onClick={handleCancel} disabled={isSaving}>
        {t('cancel')}
      </Button>
      <Button
        variant="default"
        size="md"
        onClick={handleSave}
        disabled={isSaving || !name.trim()}
      >
        {isSaving ? t('saving') : t('save')}
      </Button>
    </div>
  </div>
)}
```

---

## State of the Art

No meaningful "state of the art" shifts for this phase — it's an in-codebase form-on-existing-API that uses only patterns already proven in Phases 1–5. No libraries changed versions, no new React 19 hooks that would help (`useActionState` could be considered but would diverge from the existing hand-rolled pattern; not worth the inconsistency).

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| (none — no superseded pattern) | Hand-rolled form state + explicit Save/Cancel buttons with dirty-state tracking | Phase 6 greenfield | Matches every form in `project-manager-modal.tsx`, task board detail modal, cron edit modal |

**Deprecated/outdated:**
- Existing `project.settings.placeholder` i18n key (`messages/*.json`) — should be removed as part of the atomic translation task.

---

## Open Questions

1. **How should timezone drift on `<input type="date">` be handled?**
   - What we know: `new Date('YYYY-MM-DD')` parses as UTC; `project-manager-modal.tsx:166` already uses this pattern.
   - What's unclear: Whether users in non-UTC timezones currently experience a one-day drift after save/reload.
   - Recommendation: Match the modal's existing encoding for consistency in Phase 6. If drift turns out to be a bug, fix in a cross-cutting patch touching both views. **Do not diverge the two views' date encoding inside Phase 6.**

2. **Should the permission-denied note and read-only mode gate on `currentUser === null` as well?**
   - What we know: `currentUser` is null during app boot before auth hydrates.
   - What's unclear: How likely a viewer sees the Settings tab during the boot window (they'd have to navigate directly to `/project/<slug>/settings` before `currentUser` loads).
   - Recommendation: Treat `currentUser === null` as a brief loader state — same loader shown during `loading === true`. Only render the form when both `project` and `currentUser` are populated.

3. **Should Save button disable while pristine, or just do nothing when clicked?**
   - What we know: D-09 implies the footer only appears when dirty, so the button is only visible when dirty.
   - What's unclear: Whether there's ever a state where the footer is visible but name is empty (user typed name, deleted it).
   - Recommendation: Disable Save when `!name.trim()` even while footer is visible (visual-only disable; Enter-key submit already blocked at the same condition).

4. **Does `currentUser.role` reliably propagate through Zustand on login?**
   - What we know: `src/store/index.ts:815` initializes `currentUser: null`; `setCurrentUser` is called from auth bootstrap.
   - What's unclear: Whether viewer-role sessions reliably populate `currentUser` before hitting the Settings URL in local testing.
   - Recommendation: Verify during Wave 1 by opening DevTools → Zustand state while logged in as each role. Add a small test using a mock currentUser to lock the behavior.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.x + @testing-library/react 16.1.x (jsdom) |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test src/components/project/__tests__/settings-view.test.tsx` |
| Full suite command | `pnpm test && pnpm typecheck && pnpm lint` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SETT-01 | Form renders editable inputs for name, description, status fields | unit | `pnpm test settings-view -t "renders Basics section"` | ❌ Wave 0 |
| SETT-01 | Empty name disables Save button | unit | `pnpm test settings-view -t "disables save when name empty"` | ❌ Wave 0 |
| SETT-01 | Archived option disabled for `slug === 'general'` | unit | `pnpm test settings-view -t "disables archived option for general"` | ❌ Wave 0 |
| SETT-02 | Form renders editable inputs for color, ticket_prefix, deadline, github_repo | unit | `pnpm test settings-view -t "renders Appearance and Integrations sections"` | ❌ Wave 0 |
| SETT-02 | Color swatch click toggles selection; click selected clears to null | unit | `pnpm test settings-view -t "color swatch toggle"` | ❌ Wave 0 |
| SETT-02 | Ticket prefix normalization: typing lowercase preserves dirty state after save echoes uppercase | unit | `pnpm test settings-view -t "ticket_prefix dirty after save"` | ❌ Wave 0 |
| SETT-03 | Save POSTs to `/api/projects/[id]` with partial body of dirty fields only | unit | `pnpm test settings-view -t "PATCH body contains only dirty fields"` | ❌ Wave 0 |
| SETT-03 | 400/409 server errors route to inline field error; unknown errors to top banner | unit | `pnpm test settings-view -t "error routing"` | ❌ Wave 0 |
| SETT-03 | After successful save, fetchProjects() is called and dirty state clears | unit | `pnpm test settings-view -t "post-save store refresh"` | ❌ Wave 0 |
| FOUN-04 | All 29 new `project.settings.*` keys exist in all 10 locales | unit | `pnpm test i18n-coverage` | ❌ Wave 0 (extend existing) |
| D-20 | Viewer role renders form with all inputs disabled and no sticky footer | unit | `pnpm test settings-view -t "viewer readonly mode"` | ❌ Wave 0 |
| (smoke) | Full happy path: open settings → edit fields → save → see updated breadcrumb | e2e | `pnpm test:e2e tests/project-settings.spec.ts` | ❌ Wave 0 (optional) |

### Sampling Rate
- **Per task commit:** `pnpm test src/components/project/__tests__/settings-view.test.tsx`
- **Per wave merge:** `pnpm test && pnpm typecheck`
- **Phase gate:** Full suite green (`pnpm test && pnpm typecheck && pnpm lint`) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/components/project/__tests__/settings-view.test.tsx` — NEW. `it.todo()` stubs covering every SETT-01/02/03 behavior and the viewer-role case. Pattern matches `sessions-view.test.tsx` (mocks `next-intl`, `next/navigation`, `@/components/project/project-context`, `global.fetch`). Embed pitfall annotations (Pitfalls 1, 3, 4, 5, 6, 9 from research) as comments.
- [ ] Extend `src/components/project/__tests__/i18n-coverage.test.tsx` — assert all 29 new `project.settings.*` sub-keys exist in all 10 locales (currently only asserts that the `settings` key itself is present). Remove the now-orphaned `project.settings.placeholder` key check if any exists.
- [ ] `messages/{ar,de,en,es,fr,ja,ko,pt,ru,zh}.json` — atomic translation of 29 new keys plus verification/update of existing `title`. Removal of `placeholder` stub.
- [ ] (OPTIONAL) `tests/project-settings.spec.ts` — Playwright E2E `test.fixme()` stub for end-to-end navigation: visit `/project/<slug>/settings` → edit name → save → verify breadcrumb updates. Follow Phase 5 `project-sessions.spec.ts` pattern.
- No framework install needed (vitest + playwright already configured).

---

## Sources

### Primary (HIGH confidence)
- `src/app/api/projects/[id]/route.ts` (lines 11-14 normalizePrefix, 78-201 PATCH handler) — authoritative request/response contract
- `src/components/modals/project-manager-modal.tsx` (lines 30-39 COLOR_PALETTE, 143-203 edit flow, 385-396 color picker) — UX reference implementation
- `src/components/project/project-context.tsx` — workspace state provider, post-save propagation hook (`useProjectWorkspace`)
- `src/components/project/project-view-router.tsx` — already routes `view === 'settings'` to `<SettingsView />`
- `src/store/index.ts` (lines 294-304 CurrentUser + role typing, 329-344 Project interface, 539-540 currentUser in store, 815-816 default, 866-885 project setters + fetchProjects) — Zustand store contract
- `src/components/ui/button.tsx` — variants and size tokens (default, secondary, md, etc.)
- `src/components/ui/loader.tsx` — Loader primitive for the loading state
- `messages/en.json` (lines 2200-2285) — `project.settings.*` namespace structure and current stub
- `src/components/project/__tests__/sessions-view.test.tsx`, `tasks-view.test.tsx`, `i18n-coverage.test.tsx` — test pattern references
- `vitest.config.ts` — test framework configuration (jsdom, setup files)
- `.planning/codebase/TESTING.md` — project testing conventions
- `.planning/phases/05-sessions-agents/05-00-PLAN.md` — atomic i18n translation playbook
- `.planning/phases/06-settings/06-UI-SPEC.md` — locked visual/interaction contract
- `.planning/phases/06-settings/06-CONTEXT.md` — user-decided constraints
- `CLAUDE.md` — project-wide constraints (pnpm, no icon libs, Conventional Commits without AI attribution)

### Secondary (MEDIUM confidence)
- `src/lib/task-dispatch.ts:118-119` — ticket_ref captured at dispatch time (supports D-03 helper text accuracy)
- `src/lib/migrations.ts:691-703, 819-820, 824+` — projects table base schema + later ALTER TABLE adds (color, deadline, github_repo, github_sync_enabled, github_default_branch) — confirms no schema work needed

### Tertiary (LOW confidence)
- None — this phase is entirely codebase-internal; no web lookups or library documentation queries were required or performed.

---

## Metadata

**Confidence breakdown:**
- User Constraints: **HIGH** — copied verbatim from CONTEXT.md and UI-SPEC; both are user-approved.
- Standard Stack: **HIGH** — every library already in `package.json` and in active use across Phases 1–5; no new deps.
- Architecture: **HIGH** — patterns fully lifted from `project-manager-modal.tsx`, `sessions-view.tsx`, and established Phase 5 precedent.
- Don't Hand-Roll: **HIGH** — every item enumerated from existing codebase inventory.
- Pitfalls: **HIGH** (Pitfalls 1, 3, 4, 6, 7, 8, 10) — derived directly from observable code. **MEDIUM** (Pitfalls 2, 5, 9) — plausible scenarios backed by code inspection but may or may not manifest in practice; flagged as open questions where applicable.
- Environment: **HIGH** — no external deps to audit.
- Validation Architecture: **HIGH** — test infrastructure pattern confirmed via existing `__tests__/sessions-view.test.tsx`.

**Research date:** 2026-04-13
**Valid until:** 30 days (stable domain; the only churn risk is the i18n `project.settings` namespace if another phase mutates it before Phase 6 ships)
