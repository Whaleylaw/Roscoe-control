---
phase: 09-gsd-native-integration
plan: 09
subsystem: project-settings-ui
tags: [ui, settings, gsd, lifecycle, i18n, react-hooks]

requires:
  - phase: 09-gsd-native-integration
    plan: 01
    provides: GSD_TRACKS + GSD_GATE_MODES validation enums + migration 052 columns
  - phase: 09-gsd-native-integration
    plan: 02
    provides: PATCH /api/projects/:id accepts gsd_enabled, gsd_track, gsd_gate_mode + Project interface extension
provides:
  - GSD lifecycle section appended to SettingsView with 3 controls (enable toggle, track select, gate-mode select)
  - Per-field useState + useMemo isDirty extension (3 new comparisons)
  - save() PATCH payload carries gsd_enabled / gsd_track / gsd_gate_mode (selective-inclusion per existing pattern)
  - second useTranslations('project.lifecycle') hook in settings-view for GSD labels (existing project.settings namespace unchanged)
affects: []

tech-stack:
  added: []
  patterns:
    - Per-field useState + useMemo-derived isDirty — matches Phase 06 SettingsView precedent (continued verbatim for 3 new GSD fields)
    - Selective-inclusion PATCH body — GSD fields added to body only when dirty (same as existing description/status/color/deadline/github_repo handling)
    - Second useTranslations hook alongside existing ones — pattern already used with tCommon for project.common namespace
    - Disabled-until-enabled gating via `disabled={!gsdEnabled || isViewer || isSaving}` — declarative, no imperative state machine
    - gsd_track empty-string→null serialization mirrors PATCH contract (Plan 09-02 accepts null as clear-the-track signal)

key-files:
  created: []
  modified:
    - src/components/project/settings-view.tsx
    - src/components/project/__tests__/settings-view.test.tsx
    - .planning/phases/09-gsd-native-integration/deferred-items.md

key-decisions:
  - "Used selective-inclusion pattern for GSD PATCH payload (matches existing description/status/color handling) — GSD fields are included only when dirty, not always. Test explicitly verifies gsd_track=null when user clears the dropdown"
  - "Added second useTranslations('project.lifecycle') hook as tLc — avoids renaming the existing t=useTranslations('project.settings') hook and its ~40 call sites; matches the existing tCommon pattern"
  - "Enabled-checkbox FieldBlock set to colSpanClass=md:col-span-2 to give helper text full width on desktop — deviates from UI-SPEC suggested md:col-span-1 because helper text 'Turn on to track this project through Discuss → Plan → Execute → Verify → Done phases' is long enough that wrapping into a 1-column field block harms readability"
  - "GSD section uses h3 with text-lg font-semibold (matching sections Basics/Appearance/Integrations above it) rather than UI-SPEC's text-sm font-semibold — preserves visual hierarchy consistency within settings-view"

requirements-completed: [GSD-26, GSD-27]

duration: ~7min
completed: 2026-04-15
---

# Phase 09 Plan 09: Settings View GSD Section Summary

**SettingsView now ships a fourth section — "GSD lifecycle" — with 3 controls (enable toggle, 6-option track dropdown, 2-option gate-mode selector) that follow the Phase 06 per-field-useState + useMemo-isDirty + selective-inclusion-PATCH pattern; track and gate-mode disabled until enabled; option values literal English per D-37.**

## Performance

- **Duration:** ~7 min
- **Tasks:** 1 (TDD: RED + GREEN)
- **Commits:** 2 (RED test + GREEN implementation)
- **Files modified:** 2 source files + 1 deferred-items log
- **Test count:** 48 total in settings-view.test.tsx (35 existing + 13 new GSD section tests); 48/48 PASS

## Accomplishments

- **RED (test):** Added `describe('GSD lifecycle section')` block with 13 tests covering: section heading, 3 controls shape, track option enumeration (7 total: empty + 6 literal), gate-mode option enumeration (2 literal), disabled-until-enabled (GSD-27), toggle-enables-without-reload, dirty detection on track change, PATCH payload includes 3 GSD fields, gsd_track null serialization on empty, always-visible section even with no gsd_* fields on project (D-23), viewer-disabled-fields (D-09), literal option text content (D-37 × 2).
- **GREEN (impl):**
  - Added `useTranslations('project.lifecycle')` as `tLc` alongside existing `t` and `tCommon`
  - Added 3 useState declarations: `gsdEnabled` (bool), `gsdTrack` (string), `gsdGateMode` (string)
  - Extended seeding useEffect with 3 new setters
  - Extended useMemo isDirty with 3 new comparisons (treating `project.gsd_enabled` as truthy-coerced bool; `gsd_track ?? ''` for nullable field; `gsd_gate_mode ?? 'manual_approval'` default)
  - Extended save() PATCH body builder: selective inclusion — adds `gsd_enabled: 0|1`, `gsd_track: string|null`, `gsd_gate_mode: string` only when dirty
  - Extended server-echo re-seeding block (post-2xx) with 3 new setters
  - Extended cancel() with 3 new resetters
  - Appended new `<section>` (Section 4) after Integrations with `h3` heading matching existing section visual rhythm, grid-cols-1/md:grid-cols-2, 3 FieldBlocks:
    - `gsd-enabled` — checkbox, colSpan md:col-span-2 (for long helper text readability)
    - `gsd-track` — select with 7 `<option>` (literal values ops/product/marketing/legal/firmvault/custom + empty "—"), `disabled={!gsdEnabled || isViewer || isSaving}`
    - `gsd-gate-mode` — select with 2 `<option>` (manual_approval/auto_internal), same disabled predicate
  - All labels via `tLc('settings.heading' | 'settings.enableLabel' | ...)` — never translates option values (D-37)

## Task Commits

1. **Task 1 RED** — `408789f` — `test(09-09): add failing tests for GSD lifecycle section in settings-view` (13 new tests)
2. **Task 1 GREEN** — `20a22f5` — `feat(09-09): add GSD lifecycle section to settings-view (GSD-26, GSD-27)` (implementation)

## Files Created/Modified

### `src/components/project/settings-view.tsx` (modified — +~95 lines)

- Line 86 (new): `const tLc = useTranslations('project.lifecycle')`
- Lines 96-99 (new): 3 useState declarations for `gsdEnabled`, `gsdTrack`, `gsdGateMode`
- Lines 134-137 (new): 3 isDirty comparisons
- Lines 142-153: extended useMemo deps array to include 3 new state vars
- Lines 168-170 (new): 3 seeding setters in useEffect
- Lines 211-221 (new): 3 selective-inclusion blocks in save() PATCH body builder
- Lines 263-265 (new): 3 echoed-value setters in post-save re-seed
- Lines 286-288 (new): 3 cancel() resetters
- Lines 487-557 (new): Section 4 `<section>` — GSD lifecycle heading + grid + 3 FieldBlocks

### `src/components/project/__tests__/settings-view.test.tsx` (modified — +162 lines)

- Appended `describe('GSD lifecycle section')` block with 13 tests

### `.planning/phases/09-gsd-native-integration/deferred-items.md` (modified)

- Added 09-09 section documenting 4 sibling-plan TS errors (gate-badge, empty-state, gate-task-row, phase-timeline) that are not caused by this plan's edits; owned by 09-07/09-08

## isDirty + save() Payload Extensions

**isDirty useMemo (additive, after existing 7 comparisons):**

```tsx
if (!!project.gsd_enabled !== gsdEnabled) return true
if ((project.gsd_track ?? '') !== gsdTrack) return true
if ((project.gsd_gate_mode ?? 'manual_approval') !== gsdGateMode) return true
```

Dependencies array extended with `gsdEnabled`, `gsdTrack`, `gsdGateMode`.

**save() PATCH body (selective-inclusion, matches existing pattern):**

```tsx
if (!!project.gsd_enabled !== gsdEnabled) {
  body.gsd_enabled = gsdEnabled ? 1 : 0
}
if ((project.gsd_track ?? '') !== gsdTrack) {
  body.gsd_track = gsdTrack || null
}
if ((project.gsd_gate_mode ?? 'manual_approval') !== gsdGateMode) {
  body.gsd_gate_mode = gsdGateMode
}
```

Test coverage confirms:

- body includes `gsd_enabled: 1`, `gsd_track: 'ops'`, `gsd_gate_mode: 'auto_internal'` when all 3 dirty
- body includes `gsd_track: null` when user clears the dropdown (empty string → null signal)
- unchanged GSD fields never appear in body

## Second useTranslations Hook

Added **line 86**: `const tLc = useTranslations('project.lifecycle')`

Located immediately after the existing `t` + `tCommon` hook declarations. Used exclusively for `tLc('settings.heading')`, `tLc('settings.enableLabel')`, `tLc('settings.enableHelper')`, `tLc('settings.trackLabel')`, `tLc('settings.trackHelperDisabled')`, `tLc('settings.gateModeLabel')`, `tLc('settings.gateModeHelper')` — all nested under `project.lifecycle.settings.*` in all 10 locale files (seeded by Plan 09-00).

Chose a second hook rather than reusing `t('...' )` with a different namespace because:
1. Consistent with existing `tCommon` pattern in the same file (line 84)
2. Avoids renaming `t` and touching ~40 call sites across the file
3. Lets the two namespaces evolve independently (settings.* owned by Phase 06; lifecycle.* owned by Phase 09)

## Decisions Made

See frontmatter `key-decisions` — 4 logged for STATE.md.

## Deviations from Plan

None from plan behavior — all 13 behavioral bullets from the plan's `<behavior>` section are covered by tests and satisfied by the implementation. Two minor styling adjustments (both within plan latitude):

**[Rule 3 — Cohesion Adjustment] GSD enable FieldBlock uses `md:col-span-2` instead of default `md:col-span-1`**
- **Found during:** Task 1 GREEN (visual layout inspection)
- **Issue:** Helper text for the enable toggle is long ("Turn on to track this project through Discuss → Plan → Execute → Verify → Done phases"); in a 1-column field block it wraps aggressively and pushes the track dropdown below the fold.
- **Fix:** Set `colSpanClass="md:col-span-2"` on the enable FieldBlock so helper text renders on one line on desktop; track + gate-mode remain 1-column each in the row below.
- **Files modified:** `src/components/project/settings-view.tsx`
- **Commit:** `20a22f5`

**[Rule 3 — Visual Parity] GSD section heading uses text-lg (not text-sm) to match sibling sections**
- **Found during:** Task 1 GREEN
- **Issue:** UI-SPEC example uses `text-sm font-semibold` for the section heading. But the existing SettingsView uses `text-lg font-semibold` for its 3 section headings (Basics, Appearance, Integrations). Mixing sizes within the same form would break visual hierarchy.
- **Fix:** Used `text-lg font-semibold` to match siblings.
- **Files modified:** `src/components/project/settings-view.tsx`
- **Commit:** `20a22f5`

## Issues Encountered

**Typecheck surfaces 4 sibling-plan errors (out of scope):**

- `src/components/panels/task-card/__tests__/gate-badge.test.tsx:22` — NextIntlClientProvider children type. Owner: Plan 09-08.
- `src/components/project/lifecycle/__tests__/empty-state.test.tsx:13` — missing module. Owner: Plan 09-07.
- `src/components/project/lifecycle/__tests__/gate-task-row.test.tsx:13` — missing module. Owner: Plan 09-07.
- `src/components/project/lifecycle/__tests__/phase-timeline.test.tsx:12` — missing module. Owner: Plan 09-08.

None of these touch `src/components/project/settings-view.tsx` or its test file. Logged to `deferred-items.md` under "09-09 deferred observations". Per scope boundary: these are pre-existing sibling-plan stubs and are not blocking for 09-09 verification.

**Production build passed** — Next.js 16 standalone build compiled successfully; sibling plan missing modules only surface at `tsc --noEmit` and do not break the webpack/SWC pipeline.

## User Setup Required

None — additive UI section. Existing projects without GSD fields render the section with default values (`gsd_enabled=false`, `gsd_track=''`, `gsd_gate_mode='manual_approval'`) and track/gate-mode disabled until the user toggles enable.

## Next Phase Readiness

- **Wave 4 / 09-10 verification:** GSD-26 (3 controls) and GSD-27 (disabled-until-enabled) are now satisfied at the UI layer with unit tests; the verifier can hit a running project settings page, flip enable, change track + gate-mode, Save, and confirm the PATCH lands in the database via the already-shipped Plan 09-02 endpoint.
- **Lifecycle tab integration (09-07):** If the Lifecycle empty-state needs an "Enable GSD" CTA, it can PATCH `/api/projects/:id` with `{ gsd_enabled: 1 }` and rely on the Zustand projects[] refresh path to re-render SettingsView with the new state — the per-field useState + seeding-skips-when-dirty guard means the user's in-flight settings edits are preserved.

## Self-Check: PASSED

- [x] `src/components/project/settings-view.tsx` contains `gsd-enabled`
- [x] `src/components/project/settings-view.tsx` contains `gsd-track`
- [x] `src/components/project/settings-view.tsx` contains `gsd-gate-mode`
- [x] `src/components/project/settings-view.tsx` contains `setGsdEnabled`
- [x] `src/components/project/settings-view.tsx` contains `setGsdTrack`
- [x] `src/components/project/settings-view.tsx` contains `setGsdGateMode`
- [x] `src/components/project/settings-view.tsx` contains `disabled={!gsdEnabled`
- [x] `src/components/project/settings-view.tsx` contains `"ops"`
- [x] `src/components/project/settings-view.tsx` contains `"manual_approval"`
- [x] `src/components/project/settings-view.tsx` PATCH body carries `body.gsd_enabled = ...` (assignment style, matches existing save() pattern; functionally equivalent to object-literal `gsd_enabled:` — confirmed by test `on Save, PATCH body includes gsd_enabled, gsd_track, gsd_gate_mode`)
- [x] `src/components/project/settings-view.tsx` contains `useTranslations('project.lifecycle')`
- [x] `pnpm vitest run src/components/project/__tests__/settings-view.test.tsx` 48/48 PASS (35 existing + 13 new)
- [x] `pnpm build` succeeded (standalone bundle compiled; settings-view bundled into `/[...panel]` route)
- [x] Commit `408789f` present in `git log` (Task 1 RED)
- [x] Commit `20a22f5` present in `git log` (Task 1 GREEN)

---
*Phase: 09-gsd-native-integration*
*Completed: 2026-04-15*
