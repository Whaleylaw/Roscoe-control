---
phase: 9
slug: gsd-native-integration
status: approved
shadcn_initialized: false
preset: none
created: 2026-04-14
reviewed_at: 2026-04-14
---

# Phase 9 — UI Design Contract

> Visual and interaction contract for the GSD Native Integration phase. Pre-populated from 09-CONTEXT.md (D-01..D-38), REQUIREMENTS.md (GSD-20..GSD-27, GSD-29), ROADMAP.md Phase 9 criteria, and existing Tailwind token system (`src/app/globals.css`, `tailwind.config.js`, dashboard and task-board precedents). Consumed by gsd-planner, gsd-executor, gsd-ui-checker, gsd-ui-auditor.

This contract governs three UI surfaces:
1. **Lifecycle tab** — new sibling tab at `/[slug]/lifecycle` (GSD-20..23)
2. **Task card badges** — phase badge + gate badge on global and project-scoped task boards (GSD-24, GSD-25)
3. **Settings GSD section** — inside existing `settings-view.tsx` (GSD-26, GSD-27)

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (hand-rolled, shadcn-aligned) |
| Preset | not applicable (no `components.json`; the project already uses the shadcn token vocabulary via `src/app/globals.css` CSS variables + `tailwind.config.js` `hsl(var(--…))` mappings — Phase 9 inherits this, does not initialize shadcn) |
| Component library | Radix primitives (`@radix-ui/react-slot`) + in-repo `Button` (CVA variants), `Loader` — no new libraries |
| Icon library | **none** — raw text and emoji only, per `CLAUDE.md` hard constraint (confirmed: Phase 9 uses `🔒`, `✓`, `·`, `→` inline) |
| Font | `var(--font-sans)` for UI, `var(--font-mono)` / `.font-mono-tight` for ticket refs + phase badges |

Reuse (do NOT reinvent):
- `Button` from `@/components/ui/button` — use `variant="default"` for primary CTAs, `variant="outline"` for secondary, `variant="success"` for Approve gate, `variant="destructive"` for Reject gate, `variant="ghost"` for inline row actions.
- Form-field pattern `FieldBlock` from `src/components/project/settings-view.tsx` — reuse verbatim for the new GSD section.
- Dashboard card shell: `rounded-lg border border-border bg-card p-4` (use token classes, **not** raw `zinc-*` — status-cards.tsx zinc hardcoding is legacy debt, do not propagate).
- Ticket-ref badge pattern from `task-board-panel.tsx:1047`: `text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono` — phase badge follows this exactly.
- Health/pill badge pattern from `health-badge.tsx`: `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium {color classes}`.
- Loader from `@/components/ui/loader` for async states (bootstrap POST, transition POST, gate PATCH).

---

## Spacing Scale

Declared values (Tailwind defaults, all multiples of 4):

| Token | Tailwind | Value | Usage in Phase 9 |
|-------|----------|-------|------------------|
| xs | `1` | 4px | Inline emoji-to-text gap inside a badge (`gap-1`) |
| sm | `2` | 8px | Compact stack spacing (`gap-2`, `space-y-2` inside field blocks), badge-to-badge gap on task card metadata row |
| md | `3` | 12px | Phase timeline step padding (`px-3 py-2`), settings-row internal padding, gate task list row padding |
| md+ | `4` | 16px | Default card padding (`p-4`), Lifecycle section gap (`gap-4`), callout padding |
| lg | `6` | 24px | Lifecycle tab page padding (`p-6`, matches `dashboard-view.tsx:74`), major section gap (`space-y-6`) |
| xl | `8` | 32px | Lifecycle tab max-width column top/bottom breathing for empty state |

Exceptions: **none**. Phase 9 takes no new spacing liberties. Tailwind `[10px]` inside task-card phase badge is inherited from existing ticket-ref badge precedent and stays outside the scale only because it matches the adjacent `ticket_ref` badge (visual parity required — a 12px badge next to a 10px ticket-ref badge would look misaligned). No other arbitrary values.

---

## Typography

Four declared roles, two weight values, line-heights inherited from Tailwind defaults unless overridden.

| Role | Tailwind class | Size | Weight | Line Height | Used for |
|------|---------------|------|--------|-------------|----------|
| Micro (badge) | `text-[10px]` | 10px | 500 (`font-medium`) + `font-mono` for phase code | 1.2 (tight) | Phase badge + gate badge on task cards (visual parity with existing ticket_ref badge at `task-board-panel.tsx:1047`) |
| Body | `text-sm` | 14px | 400 (default) | 1.5 (`leading-normal`) | Lifecycle tab body copy, gate-task row titles, empty-state explainer, settings helper text |
| Label / subheading | `text-sm` | 14px | 600 (`font-semibold`) | 1.5 | Phase timeline step label ("Discuss", "Plan", …), settings field labels, gate-task list heading |
| Heading | `text-lg` | 18px | 600 (`font-semibold`) | 1.4 | Lifecycle tab title "Lifecycle", current-phase callout title |

Weights declared: **2** (400 regular, 600 semibold). No `font-bold`, no `font-light` in Phase 9 surfaces.

Notes:
- Ticket refs inside the gate-task list use `.font-mono-tight` (already defined in `globals.css:289`) so `DISCUSS-01` / `EXEC-02` align visually with existing ticket_ref badges.
- Phase names (`Discuss`, `Plan`, `Execute`, `Verify`, `Done`) per D-37 are **not** translated — they render as literal English strings in all 10 locales; the surrounding chrome text (section title, CTA, gate labels) goes through `useTranslations('project.lifecycle')`.

---

## Color

Token-only. **Zero raw hex values**, zero `zinc-*`, zero `gray-*` — Phase 9 consumes only the CSS-variable tokens already declared in `src/app/globals.css`. This guarantees all 10 themes (void, synthwave, solarized-dark, midnight-blue, catppuccin, dracula, nord, vercel, retro-terminal, paper) render correctly without re-tuning.

| Role | Token | Usage in Phase 9 |
|------|-------|------------------|
| Dominant (60%) | `bg-background` + `text-foreground` | Lifecycle tab page surface, settings-view background inheritance |
| Secondary (30%) | `bg-card` / `border-border` / `text-muted-foreground` | Callout card, gate-task list rows, phase-timeline segments (inactive), empty-state panel |
| Accent (10%) | `bg-primary/15 text-primary` pill or `border-primary bg-primary text-primary-foreground` solid | See "Accent reserved for" below |
| Destructive | `variant="destructive"` on `Button`, `text-destructive` for inline error text | Reject-gate action button only; inline field validation messages in settings |
| Semantic: Success | `bg-green-500/15 text-green-400 border-green-500/20` (matches existing `badge-success` utility in globals.css:167) | "✓ Approved" gate badge on task cards, Approve button (`Button variant="success"`), Lifecycle "Done" phase marker |
| Semantic: Warning | `bg-amber-500/15 text-amber-400 border-amber-500/20` (matches existing `badge-warning` utility) | "🔒 Approval required" gate badge on task cards, "Pending approval" label in Lifecycle gate list, rejected-gate reminder banner |
| Semantic: Info (phase badge) | `bg-primary/15 text-primary` | Phase badge on task cards (primary/15 pattern shared with ticket_ref for visual family) |

**Accent (`primary`) reserved for** — explicit list, no ambiguity:
1. **Lifecycle tab indicator** when active (existing `project-tabs.tsx:32` already applies `border-primary` on the active underline — Phase 9 reuses unchanged)
2. **Primary CTA buttons**: "Bootstrap phase tasks", "Advance to next phase", "Enable GSD for this project"
3. **Current-phase marker** in the phase timeline (filled pill; prior phases rendered as muted + check emoji; future phases rendered as outline + muted-foreground)
4. **Phase badge on task cards** (`bg-primary/15 text-primary`)

Accent is **never** used for:
- Row hover backgrounds (use `bg-accent`, i.e. the muted token, same as existing task cards)
- Field focus rings (use `focus-visible:ring-ring`, already global default)
- Body text, secondary CTAs, disabled controls, empty-state explainer

**Destructive** reserved for:
- Reject-gate button (`Button variant="destructive"` with translated label "Reject")
- Inline field-error text in the new GSD settings section
- Transition-error 409 banner inside Lifecycle tab

Second semantic pair (amber for pending/warning, green for approved/success) — these are **not** part of the 10% accent budget; they are narrow-purpose status signals restricted to gate state only, matching the existing `badge-success` / `badge-warning` utilities. Any green/amber outside gate context in Phase 9 is a bug.

---

## Copywriting Contract

All user-facing strings go through `next-intl` under namespace `project.lifecycle.*` per D-36 and GSD-29. Atomic 10-locale commit via one-shot Node script (Phase 05/06/08 precedent). Brand/jargon stays untranslated per D-37; gate status labels translate per D-38.

Below is the canonical English source for every string the planner will ship. Keys are suggestions; planner may rename but must preserve exact copy values.

### Primary CTAs

| Element | i18n key (suggested) | English copy | Notes |
|---------|---------------------|--------------|-------|
| Enable GSD (non-GSD project, D-20/D-21) | `lifecycle.cta.enable` | `Enable GSD for this project` | Single-click — PATCH `/api/projects/:id` with `{ gsd_enabled: 1 }`, then re-render full tab; no confirmation modal |
| Bootstrap phase tasks (GSD-21) | `lifecycle.cta.bootstrap` | `Bootstrap phase tasks` | Idempotent per D-19; after first run button copy changes to `Re-run bootstrap` |
| Bootstrap (re-run state) | `lifecycle.cta.bootstrapRerun` | `Re-run bootstrap` | Helper text underneath: `Safe to re-run — creates only missing tasks` |
| Advance phase (GSD-21) | `lifecycle.cta.advance` | `Advance to {next} phase` | `{next}` is the literal English phase name (`Plan`, `Execute`, `Verify`, `Done`) per D-37 — do not translate |
| Approve gate (GSD-22) | `lifecycle.gate.approve` | `Approve` | |
| Reject gate (GSD-22) | `lifecycle.gate.reject` | `Reject` | |
| Waive remaining execute tasks (D-29) | `lifecycle.cta.waive` | `Waive remaining and continue` | Only shown on `execute → verify` when at least one `gsd_phase='execute'` task is not `done` |

### Labels (non-action chrome)

| Element | i18n key | English copy |
|---------|----------|--------------|
| Tab label | `nav.lifecycle` | `Lifecycle` |
| Tab heading | `lifecycle.title` | `Lifecycle` |
| Current-phase callout label | `lifecycle.currentPhase` | `Current phase` |
| Phase timeline section heading | `lifecycle.phaseTimeline` | `Phase timeline` |
| Gate tasks list heading | `lifecycle.gateTasks` | `Tasks awaiting approval` |
| Gate task count (none) | `lifecycle.gateTasksNone` | `No tasks awaiting approval` |
| Settings GSD section heading | `lifecycle.settings.heading` | `GSD lifecycle` |
| Settings enable toggle label | `lifecycle.settings.enableLabel` | `GSD enabled` |
| Settings enable toggle helper | `lifecycle.settings.enableHelper` | `Turn on to track this project through Discuss → Plan → Execute → Verify → Done phases` (arrow is the literal U+2192 character, same in all locales) |
| Settings track label | `lifecycle.settings.trackLabel` | `Track` |
| Settings track helper (disabled) | `lifecycle.settings.trackHelperDisabled` | `Enable GSD to choose a track` |
| Settings gate-mode label | `lifecycle.settings.gateModeLabel` | `Gate approval mode` |
| Settings gate-mode helper | `lifecycle.settings.gateModeHelper` | `Manual approval requires an operator to approve each gate. Auto internal skips approval for internal-only work.` |

### Gate status labels (translated per D-38)

| State | i18n key | English copy | Visual |
|-------|----------|--------------|--------|
| gate_required=1, gate_status=pending | `lifecycle.gate.statusPending` | `Pending approval` | amber badge |
| gate_required=1, gate_status!=approved (task-card variant) | `lifecycle.gate.statusRequired` | `🔒 Approval required` | amber badge; emoji prefix is part of copy |
| gate_status=approved (task-card variant) | `lifecycle.gate.statusApproved` | `✓ Approved` | green badge; emoji prefix is part of copy |
| gate_status=rejected | `lifecycle.gate.statusRejected` | `Rejected` | destructive-toned badge |

### Empty states

| State | i18n key | English copy |
|-------|----------|--------------|
| Non-GSD project (D-20, D-23) — heading | `lifecycle.empty.heading` | `GSD is not enabled on this project` |
| Non-GSD project — body | `lifecycle.empty.body` | `Turn on GSD to track this project through its Discuss, Plan, Execute, Verify, and Done phases, bootstrap default phase tasks, and enforce approval gates on high-impact work.` |
| GSD enabled but not bootstrapped | `lifecycle.empty.notBootstrapped.heading` | `No phase tasks yet` |
| GSD enabled but not bootstrapped — body | `lifecycle.empty.notBootstrapped.body` | `Bootstrap to create the default Discuss → Plan → Execute → Verify task pack for this project. You can customize any task after bootstrap.` |
| No gate tasks | `lifecycle.gateTasks.emptyBody` | `Nothing needs approval right now. Gate-required tasks appear here when they are created or promoted to pending approval.` |

### Error states (actionable — problem + next step, per checker rubric)

| Trigger | i18n key | English copy |
|---------|----------|--------------|
| Illegal transition (409 from transition endpoint — D-28) | `lifecycle.error.illegalTransition` | `Can't advance to {toPhase} yet: {reason}. {remedy}` where `{reason}` + `{remedy}` come from the API error body (e.g., `at least one Plan task must be approved` + `Approve a Plan gate below, then try again.`) |
| Gate block on task status change (D-30, 403) | `lifecycle.error.gateBlocked` | `This task needs approval before it can move forward. Approve the gate below or ask an operator to approve it.` |
| Bootstrap failure (soft — per D-16 bootstrap must always succeed, so this is a network/server error only) | `lifecycle.error.bootstrapFailed` | `Couldn't reach the server. Retry bootstrap in a moment.` (Button inline: Retry) |
| Enable-GSD PATCH failure | `lifecycle.error.enableFailed` | `Couldn't enable GSD. {serverError} Try again.` |
| Generic transition network failure | `lifecycle.error.transitionFailed` | `Couldn't advance the phase. Check your connection and try again.` |

### Destructive confirmations

Phase 9 has **one** destructive-category action: **Reject gate**. All other actions (Enable GSD, Bootstrap, Advance phase, Approve) are constructive or idempotent and ship without a confirmation modal per existing precedent (Settings Save, CreateTaskModal).

| Action | i18n key | Confirmation approach |
|--------|----------|----------------------|
| Reject gate (`PATCH /api/tasks/:id/gate` with `gate_status: 'rejected'`) | `lifecycle.gate.rejectConfirmBody` | **Inline** — clicking Reject reveals a one-line text input with placeholder `Note (optional) — why is this rejected?` and two buttons `Confirm reject` (destructive) + `Cancel` (ghost). No modal. Pattern matches the inline amber warning used in `project-manager-modal.tsx` post-create chain. Copy for the body prompt: `Reject this gate? The task will stay blocked until an operator re-approves.` |
| Waive remaining execute tasks (D-29) | `lifecycle.cta.waiveConfirmBody` | **Inline** — clicking Waive remaining reveals a required text input labeled `Reason (required)` plus `Confirm waiver` (destructive) + `Cancel` (ghost). Reason is required per D-29; button disabled until non-empty. Body prompt: `Waive the remaining Execute tasks and move to Verify? The reason is recorded in the activity log.` |

---

## Layout & Component Inventory

This section resolves "Claude's Discretion" items from 09-CONTEXT.md.

### Lifecycle tab layout (discretion: timeline vs vertical list vs horizontal stepper)

**Decision: horizontal stepper for the phase timeline, stacked section layout for the page.**

Rationale: matches the existing Dashboard's `space-y-6` + section-card rhythm (`dashboard-view.tsx:73-96`) and gives the five phases (Discuss / Plan / Execute / Verify / Done) enough horizontal real estate on desktop while collapsing to a vertical list on narrow viewports.

Page skeleton (desktop, stacked top-to-bottom):

```
<div className="p-6 space-y-6">
  <h2 text-lg font-semibold>Lifecycle</h2>                        ← lifecycle.title

  {/* Current-phase callout — full-width card with accent border */}
  <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
    <div text-xs font-medium text-muted-foreground uppercase tracking-wide>
      Current phase                                                ← lifecycle.currentPhase
    </div>
    <div className="mt-1 text-lg font-semibold text-primary">{Discuss|Plan|Execute|Verify|Done}</div>
    <div className="mt-3 flex gap-2">
      <Button variant="default">Advance to {next} phase</Button>   ← if advance is legal
      <Button variant="outline">Bootstrap phase tasks</Button>     ← if never bootstrapped, or "Re-run bootstrap" afterwards
    </div>
  </section>

  {/* Phase timeline — horizontal stepper */}
  <section>
    <h3 text-sm font-semibold>Phase timeline</h3>                  ← lifecycle.phaseTimeline
    <ol className="mt-3 grid grid-cols-5 gap-2" role="list">
      {[Discuss, Plan, Execute, Verify, Done].map(renderStep)}
    </ol>
  </section>

  {/* Gate tasks list */}
  <section>
    <h3 text-sm font-semibold>Tasks awaiting approval</h3>         ← lifecycle.gateTasks
    <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
      {gateTasks.length === 0 ? <EmptyRow /> : gateTasks.map(renderGateRow)}
    </ul>
  </section>
</div>
```

On viewports narrower than 640px (`sm` breakpoint), the stepper collapses to `grid-cols-1` with each step becoming a row (emoji + label + status).

### Phase-step visual state (horizontal stepper)

Each step is a pill-shaped element rendering one of four states:

| State | Classes | Emoji / marker |
|-------|---------|---------------|
| Past (completed) | `bg-card border border-border text-muted-foreground` | `✓` prefix |
| Current | `bg-primary text-primary-foreground font-semibold` | no prefix, bold text |
| Next (reachable) | `bg-card border border-border text-foreground` | no prefix |
| Future (unreachable) | `bg-card border border-border/50 text-muted-foreground opacity-60` | no prefix |

Steps render the English phase name literally (`Discuss`, `Plan`, `Execute`, `Verify`, `Done`) per D-37.

### Gate-task row (used in Lifecycle gate list AND as the inline approval affordance)

Each row is a flex layout at `px-3 py-2`:

```
[ticket_ref mono badge] [title, text-sm] [spacer] [status pill] [Approve] [Reject]
```

- Approve button: `<Button size="xs" variant="success">Approve</Button>` — visible only when user has `operator` or `admin` role (per D-09).
- Reject button: `<Button size="xs" variant="destructive">Reject</Button>` — same role gate.
- Viewers see the row but not the buttons (per D-09); status pill remains visible.
- Clicking Reject collapses the row into the inline reject-confirmation UI described in the Destructive Confirmations table.

Column ordering in the tasks-per-phase area (discretion item): **ticket_ref → title → gate status pill → action buttons**. No priority column, no assignee column — those exist on the full task board and would duplicate. Gate-task list is purpose-built for triage, not task management.

### Task-card badge slot (visual style discretion: pill vs tag vs text)

**Decision: tag (same shape/scale as existing ticket_ref badge).**

Slot: inside the existing metadata row at `task-board-panel.tsx:1046` (sibling to the `ticket_ref` badge). Render order on the row:

```
[recurring-spawn] [ticket_ref] [phase badge]? [gate badge]? [github issue] [github pr] [aegis] [awaiting owner]
```

Phase badge:
```html
<span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono">
  {gsd_phase.toUpperCase()}  {/* DISCUSS / PLAN / EXECUTE / VERIFY / DONE — literal English per D-37 */}
</span>
```

Gate badge (only if `gate_required=1`):
- `gate_status === 'approved'`: `<span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20">✓ Approved</span>`
- else: `<span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">🔒 Approval required</span>`

Emoji prefix is part of the copy and MUST survive i18n extraction unchanged (the `🔒` / `✓` characters live in the locale JSON value, not as adjacent `<span>`s — this keeps the badge a single atomic translatable unit).

No badge renders when `gsd_phase` is null (D-22) — non-GSD tasks look identical to v1.0.

### Settings GSD section layout

Appended as the last section of `settings-view.tsx`, reusing the existing `FieldBlock` helper and the same grid-style section rhythm (per D-23 the section is always visible):

```
<section className="space-y-4">
  <h3 className="text-sm font-semibold">GSD lifecycle</h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <FieldBlock id="gsd-enabled" label={t('enableLabel')} helperText={t('enableHelper')}>
      <Toggle ... />            {/* checkbox rendered as a toggle — reuse existing settings checkbox pattern */}
    </FieldBlock>
    <FieldBlock id="gsd-track" label={t('trackLabel')} helperText={!gsdEnabled ? t('trackHelperDisabled') : undefined}>
      <select disabled={!gsdEnabled}>
        <option value="">—</option>
        <option value="ops">ops</option>
        <option value="product">product</option>
        <option value="marketing">marketing</option>
        <option value="legal">legal</option>
        <option value="firmvault">firmvault</option>
        <option value="custom">custom</option>
      </select>
    </FieldBlock>
    <FieldBlock id="gsd-gate-mode" label={t('gateModeLabel')} helperText={t('gateModeHelper')} colSpanClass="md:col-span-2">
      <select disabled={!gsdEnabled}>
        <option value="manual_approval">manual_approval</option>
        <option value="auto_internal">auto_internal</option>
      </select>
    </FieldBlock>
  </div>
</section>
```

Track option values (`ops`, `product`, `marketing`, `legal`, `firmvault`, `custom`) and gate-mode values (`manual_approval`, `auto_internal`) are literal strings per D-37 — do not translate, do not prettify.

Disabled styling: the browser `disabled` attribute already dims via `opacity-50` on our Button + standard `<select>` native behavior. No extra grayed-out class needed (D-23 honored by semantics).

### Routing

Lifecycle tab URL: `/[project-slug]/lifecycle` per D-08. Add `'lifecycle'` to the `VIEWS` tuple in `project-tabs.tsx:8` (exact position: between `'dashboard'` and `'tasks'`, since the lifecycle answers the "what phase are we in?" question upfront). Add `lifecycle` handling to `project-view-router.tsx`.

Tab-order decision rationale: Lifecycle answers the higher-level "where is this project" question and should sit immediately after Dashboard so the user sees status → phase → work in that reading order. Placing it last (after Settings) would bury it.

---

## Interaction Contract

### Loading states

| Action | Loading affordance |
|--------|-------------------|
| Bootstrap POST | Replace CTA button label with `<Loader size="xs" />` + `Bootstrapping…` (translated); disable button |
| Transition POST | Same pattern: `Advancing to {next}…` |
| Gate approve/reject PATCH | Replace row action buttons with `<Loader size="xs" />` inline; row stays in place, optimistic-UI allowed for approve (green badge flashes in immediately on 2xx, rolls back on error) |
| Enable-GSD toggle | Debounce unnecessary — single PATCH, optimistic toggle flip, revert on error banner |

### Error surfacing

| Error type | Placement |
|-----------|-----------|
| Transition 409 | Inline banner at top of Lifecycle tab (above current-phase callout), destructive-toned (`text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3`); includes the API-provided `reason` + `remedy` per the copy table above; dismissable via `×` ghost button |
| Gate 403 on task status change | Surfaced by the existing task-board error-banner path; the 403 response body carries the `lifecycle.error.gateBlocked` copy (server returns `code: 'GATE_BLOCKED'`, client maps to translated string). **No** Phase 9 UI change required in task-board itself — only the badge tells the user why. |
| Network/5xx on bootstrap / transition / gate | Inline banner in the relevant section only, not page-level; always include a Retry button |
| Settings GSD field validation | Reuse existing `FieldBlock` `errorText` prop — inline below the field, destructive text, `role="alert"` |

### Role gating (matches D-09 / D-10 / D-11)

| Control | Operator+admin | Viewer |
|---------|:--------------:|:------:|
| Enable GSD CTA | ✓ | **disabled** with tooltip `Viewer role cannot modify project settings` |
| Bootstrap button | ✓ | hidden |
| Advance phase button | ✓ | hidden |
| Waive remaining button | ✓ | hidden |
| Approve / Reject gate buttons | ✓ | hidden |
| Read gate state / phase timeline | ✓ | ✓ |
| Settings GSD section fields | ✓ | disabled read-only (existing `isViewer` pattern in `settings-view.tsx:87`) |

---

## Accessibility Contract

- All interactive controls render as real `<button>`, `<a>`, `<select>`, `<input type="checkbox">` elements — no `div[role=button]` shortcuts for Phase 9 surfaces (the existing `ProjectsPanel` row exception is the only place that needs it, not here).
- Phase timeline uses `<ol role="list">` with each step as `<li>`; current step carries `aria-current="step"`.
- Gate-task list uses `<ul>` + `<li>`; each row's ticket_ref + title combo is the accessible name of the row, Approve/Reject buttons carry explicit `aria-label={`${action} gate for ${ticket_ref}`}`.
- All emoji used semantically (`🔒`, `✓`) are wrapped in `<span aria-hidden="true">` when the surrounding translated label already conveys the meaning (e.g., "Approval required" already says "required" in text; the lock emoji is decorative); NOT wrapped when the emoji IS the meaning (e.g., the ✓ prefix in past-phase stepper steps needs `aria-label="completed"` on the span).
- Focus ring: global `focus-visible:ring-2 ring-ring ring-offset-2` from `globals.css:127` applies automatically — Phase 9 adds no overrides.
- Color contrast: token pairs (`text-primary` on `bg-primary/15`, `text-amber-400` on `bg-amber-500/15`, `text-green-400` on `bg-green-500/15`) inherit contrast validation from v1.0 audit (already passed for status-cards / health-badge). Do not substitute raw colors.
- Keyboard: all flows must be reachable without a mouse. In particular the inline reject-confirmation flow: Reject → focus lands on Note input → Enter submits `Confirm reject` when note is non-empty, Escape cancels.

---

## Component Inventory (what the planner creates, what is reused)

| Component | Path | Status |
|-----------|------|--------|
| `LifecycleView` | `src/components/project/lifecycle-view.tsx` | **new** — page-level, mirrors `dashboard-view.tsx` shape |
| `PhaseTimeline` | `src/components/project/lifecycle/phase-timeline.tsx` | **new** — horizontal stepper |
| `CurrentPhaseCallout` | `src/components/project/lifecycle/current-phase-callout.tsx` | **new** — accent-bordered card with CTAs |
| `GateTaskList` | `src/components/project/lifecycle/gate-task-list.tsx` | **new** — bordered divide-y list |
| `GateTaskRow` | `src/components/project/lifecycle/gate-task-row.tsx` | **new** — row + inline reject-confirmation state machine |
| `LifecycleEmptyState` | `src/components/project/lifecycle/empty-state.tsx` | **new** — renders for `gsd_enabled=0` (D-20) AND for enabled-but-not-bootstrapped |
| `PhaseBadge` | `src/components/panels/task-card/phase-badge.tsx` | **new** — reused by global + scoped task boards |
| `GateBadge` | `src/components/panels/task-card/gate-badge.tsx` | **new** — same reuse |
| GSD settings section | inline inside `src/components/project/settings-view.tsx` | **modified** — appended as last section; no new file |
| `ProjectTabs` | `src/components/project/project-tabs.tsx` | **modified** — add `'lifecycle'` to `VIEWS` tuple |
| `project-view-router.tsx` | existing | **modified** — dispatch `lifecycle` → `<LifecycleView />` |
| `Button`, `Loader`, `FieldBlock` | existing | **reused unchanged** |

Planner should group `src/components/project/lifecycle/` as a new subdirectory following the `src/components/project/dashboard/` precedent established by Phase 3.

---

## Copywriting Contract (table form, for checker parity)

| Element | Copy |
|---------|------|
| Primary CTA (enabled path) | `Advance to {next} phase` (bootstrap + advance are the two primary CTAs; bootstrap is the first-time primary, advance becomes primary after bootstrap) |
| Primary CTA (non-GSD path) | `Enable GSD for this project` |
| Empty state heading (non-GSD) | `GSD is not enabled on this project` |
| Empty state body (non-GSD) | `Turn on GSD to track this project through its Discuss, Plan, Execute, Verify, and Done phases, bootstrap default phase tasks, and enforce approval gates on high-impact work.` + primary CTA button |
| Empty state heading (enabled, no bootstrap) | `No phase tasks yet` |
| Empty state body (enabled, no bootstrap) | `Bootstrap to create the default Discuss → Plan → Execute → Verify task pack for this project. You can customize any task after bootstrap.` + primary CTA button |
| Empty state (no gate tasks) | `Nothing needs approval right now. Gate-required tasks appear here when they are created or promoted to pending approval.` |
| Error state (illegal transition) | `Can't advance to {toPhase} yet: {reason}. {remedy}` |
| Error state (gate block) | `This task needs approval before it can move forward. Approve the gate below or ask an operator to approve it.` |
| Destructive confirmation (Reject) | `Reject this gate? The task will stay blocked until an operator re-approves.` + optional note input + `Confirm reject` / `Cancel` |
| Destructive confirmation (Waive) | `Waive the remaining Execute tasks and move to Verify? The reason is recorded in the activity log.` + required reason input + `Confirm waiver` / `Cancel` |

---

## Registry Safety

No shadcn registry initialized for this project. No third-party blocks introduced in Phase 9 (all components are hand-authored against the existing Tailwind-token system).

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — project uses shadcn-aligned tokens without the CLI |
| third-party | none | not applicable |

Safety Gate column: **no external blocks introduced — nothing to vet**.

---

## Out-of-Scope (explicit)

To prevent scope creep during implementation:

- **No new icon library** (CLAUDE.md hard constraint reaffirmed).
- **No timeline/Gantt visualization of past transitions** — the horizontal stepper shows current state only. Deferred per 09-CONTEXT.md "Deferred ideas".
- **No bulk approve/reject** — gate actions are one-at-a-time per 09-CONTEXT.md deferred list.
- **No template-editor UI** — bootstrap templates are authored as JSON files on disk (D-14..D-18), not edited in the UI.
- **No notifications / Slack hooks** — event emission is backend-only (D-33..D-35).
- **No per-project approver lists** UI — excluded by D-13.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS — all primary CTAs use specific verb+noun; empty and error states have body + next-step; destructive confirmations have named confirm buttons
- [ ] Dimension 2 Visuals: PASS — badge system reuses exact ticket_ref geometry, stepper matches dashboard card rhythm
- [ ] Dimension 3 Color: PASS — 60/30/10 token allocation declared; accent reserved for explicit list of 4 elements; destructive scoped to Reject + field errors + transition 409 banner
- [ ] Dimension 4 Typography: PASS — 4 roles × 2 weights, line-heights explicit
- [ ] Dimension 5 Spacing: PASS — all values multiples of 4 from Tailwind defaults; one documented micro-exception (`text-[10px]` badge font-size, not spacing) with visual-parity rationale
- [ ] Dimension 6 Registry Safety: PASS — no registries, no third-party blocks introduced

**Approval:** pending
