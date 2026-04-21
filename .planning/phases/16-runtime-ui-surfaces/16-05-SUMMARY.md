---
phase: 16-runtime-ui-surfaces
plan: 05
subsystem: ui
tags: [next-intl, zustand, react, vitest, task-form, autocomplete, combobox, abort-controller, debounce, runtime-context]

# Dependency graph
requires:
  - phase: 16-runtime-ui-surfaces
    provides: "Plan 16-01 Wave-0 substrate (MODEL_TIER_COLORS + modelTierClassName from `@/lib/model-tier-colors`, Task interface widened with recipe_slug/read_only_mounts/extra_skills/model_override fields in both src/store/index.ts AND src/components/panels/task-board-panel.tsx, i18n keys under taskBoard.recipeField.* + taskBoard.advancedSection.* in all 10 locales)"
  - phase: 13-task-runtime-context-v1-2
    provides: "POST/PUT /api/tasks schema with recipe_slug + read_only_mounts + extra_skills + model_override, Phase 13 aggregated `{ error, issues: [{field, code, message, hint?}] }` validation response, RECIPE_LOCKED 409 contract past-dispatch"
  - phase: 12-recipe-system-v1-2
    provides: "GET /api/recipes/search?q=...&limit= FTS5 BM25 autocomplete endpoint (tag weighting 2x)"
provides:
  - "Four pure controlled components under src/components/panels/task-form/: RecipeCombobox, AdvancedSection, MountsEditor, SkillsChipInput"
  - "RecipeCombobox reads `recipes` slice from Zustand for selected-slug→friendly-name lookup with slug-literal fallback on pre-hydration (integration contract with Plan 16-02 LOCKED: combobox is READ-ONLY consumer, does NOT fetch /api/recipes or subscribe to mc:recipe-* events)"
  - "300ms debounce + AbortController per fetch on /api/recipes/search (cancels stale in-flight on rapid typing)"
  - "Session-local collapsed Advanced section exposing read_only_mounts / extra_skills / model_override (NOT persisted across reloads)"
  - "CreateTaskModal + EditTaskModal both extended with the new controls; EditTaskModal gates them via isDispatched = task.status !== 'inbox' && task.status !== 'assigned'"
  - "Inline 400 issues[] error surface: read_only_mounts.<idx>.<field> paths map to per-row MountsEditor errors; top-level issues render as role=alert banner"
affects: [16-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure controlled form components with value + onChange contract; server remains source of truth for validation, 400 issues[] surfaced inline"
    - "Debounced autocomplete with AbortController cleanup tied to useEffect cleanup — rapid typing aborts prior in-flight request"
    - "Defensive Zustand selector pattern: `useMissionControl((s: unknown) => (s as { recipes?: Recipe[] }).recipes)` tolerates pre-hydration absence of the slice owned by a sibling Wave-1 plan"
    - "aria-combobox / role=listbox / role=option + aria-activedescendant wiring matches native combobox spec; Mission Control stays off cmdk / downshift / radix-combobox"
    - "Partial-update PATCH semantic preserved in EditTaskModal: each v1.2 field only sent when changed from its current task.* value (JSON.stringify deep-equals for arrays)"

key-files:
  created:
    - src/components/panels/task-form/recipe-combobox.tsx
    - src/components/panels/task-form/advanced-section.tsx
    - src/components/panels/task-form/mounts-editor.tsx
    - src/components/panels/task-form/skills-chip-input.tsx
    - src/components/panels/task-form/__tests__/recipe-combobox.test.tsx
    - src/components/panels/task-form/__tests__/advanced-section.test.tsx
    - src/components/panels/task-form/__tests__/mounts-editor.test.tsx
    - src/components/panels/task-form/__tests__/skills-chip-input.test.tsx
  modified:
    - src/components/panels/task-board-panel.tsx

key-decisions:
  - "RecipeCombobox is a READ-ONLY consumer of Zustand `recipes` slice (owned by Plan 16-02); it NEVER fetches /api/recipes or listens for mc:recipe-* CustomEvents — only /api/recipes/search autocomplete fetches originate in the combobox"
  - "Defensive selector pattern `(s as { recipes?: Recipe[] }).recipes` used because Plan 16-02 creates the slice in parallel; at pre-hydration / slice-absent the combobox falls back to the slug literal for the selected value"
  - "RECIPE_LOCKED client-side gate rule: `task.status !== 'inbox' && task.status !== 'assigned'` — mirrors Phase 13 server-side 409 contract so users never issue PATCHes that will fail"
  - "Partial-update semantic in EditTaskModal: each of recipe_slug / read_only_mounts / extra_skills / model_override only sent when changed from current task.* — uses JSON.stringify deep-equal for array fields"
  - "300ms debounce + AbortController per /api/recipes/search fetch; no client-side result caching per CONTEXT.md anti-pattern rule (always debounced fetch)"
  - "400 issues[] shape from Phase 13 mapped: regex `/^read_only_mounts\\.(\\d+)\\./` extracts row index into MountsEditor errors; everything else rendered as a top-of-form role=alert banner"
  - "Advanced section default state is collapsed (session-local, NOT persisted per CONTEXT.md LOCKED); AdvancedSection component owns the useState(false) internally"
  - "No icon library imports: ✖ / ➕ / ▾ / ▸ are raw Unicode glyphs per CLAUDE.md"
  - "No client-side allowlist / caps validation — server is source of truth; plan explicitly forbids duplicating Phase 13 task-runtime-validation.ts on the client"
  - "Component file-structure: one component per file under task-form/, test files live in __tests__/ sibling directory matching project convention (parallel to task-card/__tests__/ + panels/__tests__/)"

patterns-established:
  - "Autocomplete combobox pattern (debounce + AbortController + Zustand slice for selected-name fallback): future UI surfaces needing a slug→friendly-name lookup can mirror the defensive selector idiom"
  - "400 `issues[]` → inline per-row + banner surface pattern (no toast library): repeat for any future form that posts to a Phase 13-style aggregated-validation endpoint"
  - "Task-form sub-directory convention: `src/components/panels/task-form/{component}.tsx` + `__tests__/{component}.test.tsx` establishes the home for create/edit form composition"

requirements-completed: [RUI-04, RUI-05]

# Metrics
duration: 13min
completed: 2026-04-21
---

# Phase 16 Plan 05: Task Form Recipe Combobox + Advanced Section Summary

**Command-palette-style recipe autocomplete (debounced /api/recipes/search + AbortController) plus a collapsible Advanced section exposing read_only_mounts / extra_skills / model_override on both Create and Edit task modals; EditTaskModal disables the controls past-dispatch per Phase 13 RECIPE_LOCKED contract.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-04-21T01:23:22Z
- **Completed:** 2026-04-21T01:37:09Z
- **Tasks:** 2
- **Files modified:** 9 (8 created, 1 modified)

## Accomplishments

- `src/components/panels/task-form/recipe-combobox.tsx` ships the full RUI-04 combobox: role=combobox with aria-expanded/autocomplete/activedescendant, ↑/↓/Enter/Escape/Tab keyboard nav, 300ms debounced `/api/recipes/search` fetch with AbortController cancellation, model-tier chip per result row via `modelTierClassName(modelToTier(recipe.model?.primary))`, and a ✖ Clear button that resets the selection to null. Selected-slug display reads from the Zustand `recipes` slice with slug-literal fallback when the slice is empty.
- `src/components/panels/task-form/advanced-section.tsx` renders a collapsible wrapper (default collapsed; session-local) composing MountsEditor + SkillsChipInput + a plain model-override text input; `disabled` propagates to every child with a localized lockedHint.
- `src/components/panels/task-form/mounts-editor.tsx` provides the repeatable row editor for `read_only_mounts: Array<{host_path, container_path, label}>` with a per-row error-prop surface fed from server validation issues[].
- `src/components/panels/task-form/skills-chip-input.tsx` provides a chip input for `extra_skills: string[]` — Enter commits trimmed-unique entries, Backspace on an empty input removes the last chip, per-chip ✖ removes that entry.
- CreateTaskModal and EditTaskModal (both in `src/components/panels/task-board-panel.tsx`) now host the RecipeCombobox + AdvancedSection. POST payload includes v1.2 runtime fields only when non-default. PUT payload includes each field only when actually changed by the user. EditTaskModal gates on `isDispatched = task.status !== 'inbox' && task.status !== 'assigned'` and surfaces Phase 13 aggregated 400 issues[] inline (read_only_mounts.<idx>.<field> → per-row errors, everything else → role=alert banner). 409 RECIPE_LOCKED surfaces the localized hint.
- 29 new unit tests across 4 files: 11 for RecipeCombobox (placeholder, debounce-timing, abort-on-rapid-type, keyboard nav, Enter-commit, Escape-close, Clear-button, disabled, tier-chip, name-hydrated, slug-fallback), 7 for MountsEditor, 7 for SkillsChipInput, 4 for AdvancedSection. All pass; `pnpm typecheck` exits 0; existing 29 task-board-panel tests still pass.

## Exact Insertion Sites in task-board-panel.tsx

- **Imports (top of file):** `RecipeCombobox` from `./task-form/recipe-combobox` + `AdvancedSection` from `./task-form/advanced-section` added after the `RunnerStatusBanner` + `ProgressTab` imports from other Wave-1 plans (lines 23-24 after parallel Wave-1 landed).
- **CreateTaskModal state:** runtime-context useState block (recipeSlug, mounts, extraSkills, modelOverride, mountErrors, formError) appended after `mentionTargets = useMentionTargets()` and before `handleScheduleChange`.
- **CreateTaskModal render:** `<RecipeCombobox>` + `<AdvancedSection>` + formError banner inserted between the tags input (label "create-tags") and the Recurring Schedule checkbox.
- **CreateTaskModal submit:** POST payload extended with `...(recipeSlug ? { recipe_slug: ... } : {})` pattern for each of the 4 fields; 400 issues[] branch added with the read_only_mounts.<idx> regex.
- **EditTaskModal state:** `isDispatched` + runtime-context useState block (recipeSlug, mounts, extraSkills, modelOverride, mountErrors, formError) initialized from `task.*` appended after `agentSessions = useAgentSessions(...)`.
- **EditTaskModal render:** `<RecipeCombobox disabled={isDispatched} lockedHint={t('recipeField.lockedHint')}>` + `<AdvancedSection disabled={isDispatched} lockedHint={t('advancedSection.lockedHint')}>` + formError banner inserted between the tags input (label "edit-tags") and the Save/Cancel button row.
- **EditTaskModal submit:** PUT payload gains a `runtimeBody` partial — each field only included when changed from its current `task.*` value; `runtimeBody` entirely empty when `isDispatched`. 400 issues[] + 409 RECIPE_LOCKED branches added.

## Debounce + AbortController Pattern (pattern reference for Wave-1 consumers)

```tsx
useEffect(() => {
  if (!open) return
  const controller = new AbortController()
  const timeout = setTimeout(async () => {
    try {
      const res = await fetch(`/api/recipes/search?q=${encodeURIComponent(q)}&limit=20`, {
        signal: controller.signal,
      })
      ...
    } catch (err) {
      if ((err as Error).name !== 'AbortError') { /* handle real errors */ }
    }
  }, DEBOUNCE_MS)  // 300
  return () => {
    clearTimeout(timeout)
    controller.abort()
  }
}, [q, open])
```

The cleanup function on every `q` change aborts the in-flight request AND clears the pending debounce timer, so rapid typing never leaves a stale response racing a newer one.

## Test Coverage Matrix (29 cases)

| File | Case count | Coverage |
| --- | --- | --- |
| recipe-combobox.test.tsx | 11 | placeholder render, 300ms debounce timing, rapid-type abort, ↑/↓ modular cycling, Enter-commit-and-close, Escape-close-no-onChange, Clear-button, disabled (readonly + no clear + lockedHint), model-tier chip class, selected+hydrated→name, selected+empty→slug |
| mounts-editor.test.tsx | 7 | empty array+Add button, one row per value, Add appends empty, Remove drops at index, input edit→onChange with update, disabled (readonly+hidden buttons), per-row error prop renders |
| skills-chip-input.test.tsx | 7 | one chip per value, Enter commits trimmed+unique, whitespace-Enter no-op, duplicate-Enter clears draft, Backspace on empty removes last chip, chip-✖ click removes, disabled (readonly+hidden ✖) |
| advanced-section.test.tsx | 4 | default collapsed, click heading expands children, disabled renders lockedHint+propagates, heading toggles (expand→collapse) |

All 29 pass. Plus 29 pre-existing task-board-panel tests still pass (58 total on verify).

## Task Commits

1. **Task 1: Four task-form components + 29 unit tests** — `fcc9137` (feat) **[see Deviations below — files were swept into the parallel 16-03 commit due to uncommitted-when-other-executor-committed race]**
2. **Task 2a: Wire into CreateTaskModal + EditTaskModal** — `af4b20f` (feat) **[EditTaskModal portion only; CreateTaskModal portion was lost to same race and reapplied in 2b]**
3. **Task 2b: Reapply CreateTaskModal wiring** — `498bdd3` (feat)

**Plan metadata commit:** (to follow — includes SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified

### Created

- `src/components/panels/task-form/recipe-combobox.tsx` — 281 lines. RecipeCombobox component with debounced autocomplete, AbortController cancellation, keyboard nav, accessibility wiring, model-tier chip per result, Clear button, disabled+lockedHint rendering.
- `src/components/panels/task-form/advanced-section.tsx` — ~80 lines. Collapsible wrapper composing MountsEditor + SkillsChipInput + model_override input. Default collapsed session-local state.
- `src/components/panels/task-form/mounts-editor.tsx` — ~110 lines. Repeatable row editor; host_path + container_path + label inputs per row; Add/Remove buttons; per-row error surface.
- `src/components/panels/task-form/skills-chip-input.tsx` — ~90 lines. Chip input with Enter-commit / Backspace-remove / chip-✖ removal.
- `src/components/panels/task-form/__tests__/recipe-combobox.test.tsx` — 11 tests.
- `src/components/panels/task-form/__tests__/advanced-section.test.tsx` — 4 tests.
- `src/components/panels/task-form/__tests__/mounts-editor.test.tsx` — 7 tests.
- `src/components/panels/task-form/__tests__/skills-chip-input.test.tsx` — 7 tests.

### Modified

- `src/components/panels/task-board-panel.tsx` — 2 new imports; runtime-context state + handleSubmit payload + issues[] handling + render-insertions on BOTH CreateTaskModal and EditTaskModal. EditTaskModal additionally gates on `isDispatched` for the client-side RECIPE_LOCKED UX.

## Decisions Made

See frontmatter `key-decisions` for the full list. Highlights:

1. **Integration contract with Plan 16-02 (LOCKED):** RecipeCombobox is a READ-ONLY consumer of the Zustand `recipes` slice. Plan 16-02 owns the fetch + refresh + mc:recipe-* subscription lifecycle; the combobox only fetches `/api/recipes/search` for autocomplete. This avoids double-fetching on boot and keeps the two plans file-disjoint.
2. **Defensive selector at pre-hydration:** Used `useMissionControl((s: unknown) => (s as { recipes?: Recipe[] }).recipes)` with `Array.isArray(...)  ? ... : []` fallback because Plan 16-02 adds the slice in parallel and the exact shape wasn't yet in the Zustand `MissionControlStore` interface when 16-05 executed. This makes the combobox robust whether 16-02 lands before or after 16-05.
3. **RECIPE_LOCKED gate formula LOCKED:** `task.status !== 'inbox' && task.status !== 'assigned'` per the plan frontmatter must_haves.truths. Past-dispatch PATCH would 409 RECIPE_LOCKED on the server; disabling the controls client-side prevents the round-trip.
4. **Partial-update preservation:** EditTaskModal's PATCH only includes a runtime field when the user actually changed it, computed via `JSON.stringify(current) !== JSON.stringify(next)` for arrays and strict equality for scalars. Preserves the existing "partial update" semantic; `model_override === ''` sends `null` to clear.
5. **issues[] error surface:** `/^read_only_mounts\\.(\\d+)\\./` regex splits per-row errors out of the Phase 13 aggregated response into the MountsEditor `errors` prop; all other issues render as a top-of-form role=alert banner whose text is pre-line so multi-line issue lists are readable. No toast library introduced.
6. **No cmdk / downshift / radix-combobox:** MentionTextarea pattern (task-board-panel.tsx:199-354) extended — absolute-positioned listbox, mousedown-over-click to beat input blur, role wiring assembled inline.
7. **Advanced section collapsed by default (session-local):** `useState(false)` inside AdvancedSection; never persists to localStorage or the store per CONTEXT.md LOCKED rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking race] CreateTaskModal edits lost to parallel-executor race and reapplied in a follow-up commit**
- **Found during:** Task 2 verification (`pnpm typecheck`)
- **Issue:** The editor tooling's "File has been modified since read" guard triggered repeatedly during Task 2 because four other Wave-1 executors were simultaneously committing their own patches to `src/components/panels/task-board-panel.tsx`. My first big CreateTaskModal edit errored out; I then applied smaller EditTaskModal edits successfully, but the CreateTaskModal state + handleSubmit + render additions never reapplied. Typecheck passed because the EditTaskModal references compiled cleanly, so the silent drop wasn't caught until a subsequent grep for `recipeSlug` declarations revealed they were missing from CreateTaskModal.
- **Fix:** Added a follow-up commit (`498bdd3`) that reapplies all CreateTaskModal changes: runtime-context state, payload extensions, issues[] handling, and the RecipeCombobox + AdvancedSection render insertions. CreateTaskModal is now functionally identical to EditTaskModal minus the RECIPE_LOCKED gate.
- **Files modified:** src/components/panels/task-board-panel.tsx
- **Verification:** `pnpm typecheck` clean; 58 tests pass (29 task-form + 29 existing task-board-panel).
- **Committed in:** 498bdd3 (Task 2b reapply commit)

**2. [Rule 3 - Blocking race] Task 1 files committed under a sibling plan's commit hash**
- **Found during:** Staging for Task 1 commit
- **Issue:** At the moment of my `git commit` for Task 1, a parallel executor (Plan 16-03 RunnerStatusBanner) used a less-targeted `git add` and swept up my uncommitted `src/components/panels/task-form/` files. The files landed in commit `fcc9137` titled "feat(16-03): add RunnerStatusBanner component with polling + SSE refresh (RUI-02)". My own follow-up commit attempt returned "no changes added to commit" because everything was already committed.
- **Fix:** None applied — per CLAUDE.md git safety protocol, NEVER run destructive git commands (push --force, reset --hard) unless explicitly requested. Attribution is wrong in the git log but the code is present, functional, and tracked. This SUMMARY.md + the plan metadata commit preserve the correct authorship record.
- **Files modified:** None (the intended files were already committed under the wrong authorship).
- **Verification:** `git show fcc9137 -- src/components/panels/task-form/recipe-combobox.tsx` confirms the file is in that commit; `git ls-files src/components/panels/task-form/` lists all 8 files as tracked.
- **Committed in:** fcc9137 (sibling plan's commit — attribution documented here)

**3. [Rule 2 - Missing Critical] Added `formError` role=alert banner for top-level issues[] items**
- **Found during:** Task 2 implementation
- **Issue:** The plan spec handled read_only_mounts per-row errors into MountsEditor but was silent on how to surface top-level issues (e.g. `recipe_slug: RECIPE_NOT_FOUND`, `model_override: UNKNOWN_MODEL`) from the Phase 13 aggregated response. Silently discarding them would leave users staring at a failed submission with no feedback.
- **Fix:** Added `formError` state on both CreateTaskModal and EditTaskModal; non-mount issues collect into a newline-joined string rendered as `<p role="alert" className="... whitespace-pre-line">` below the Advanced section. Also catches thrown `Error.message` in the final catch block for network-level failures.
- **Files modified:** src/components/panels/task-board-panel.tsx (both modals)
- **Verification:** TypeScript compiles; form behavior is correct by construction (unit tests for the components themselves do not mock this path, but the rendering is straightforward and the modals' existing test scope does not regress).
- **Committed in:** af4b20f + 498bdd3

---

**Total deviations:** 3 auto-fixed (2 blocking races from parallel-executor contention on the single task-board-panel.tsx file, 1 missing critical — surface top-level validation issues)
**Impact on plan:** Zero scope creep. The two blocking-race deviations are environmental artifacts of concurrent execution; the code landed in the correct shape, just with some attribution noise in git log documented here. The missing-critical addition (formError banner) closes a visible UX gap that users would hit on recipe_slug / model_override validation failures.

## Issues Encountered

- **Concurrent edit tooling contention on `src/components/panels/task-board-panel.tsx`**: Four other Wave-1 plans (16-02 RecipeBadge, 16-03 RunnerStatusBanner, 16-04 ProgressTab, 16-06 Recipes panel) also edit this single file. My editor's "File has been modified since read" guard fired repeatedly; large multi-part edits for EditTaskModal landed partially while CreateTaskModal edits silently dropped until a grep revealed the omission. Recovered via a Task 2b follow-up commit — see Deviations above.
- **Commit-atomicity race**: My Task 1 files ended up committed under a sibling plan's commit hash. Documented; no destructive fix attempted per git safety protocol. The correct authorship and intent is preserved in this SUMMARY.md.

## Auth Gates Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Wave-1 of Phase 16 is effectively complete with this plan's landing:
- **RUI-01 (Recipe badge)** — Plan 16-02 (`4f03226`)
- **RUI-02 (Runner-status banner)** — Plan 16-03 (`fcc9137`, `1b6bef8`, `75194e0`)
- **RUI-03 (Progress tab)** — Plan 16-04 (`edde713`, `e2159c8`)
- **RUI-04 (Recipe combobox + Advanced section)** — Plan 16-05 (this plan) (`fcc9137` for task-form files, `af4b20f` + `498bdd3` for task-board-panel wiring)
- **RUI-05 (i18n parity)** — Plan 16-01 Wave-0 (complete)
- **RUI-06 (Recipes panel)** — Plan 16-06 (`c2fc1ba`, `ebcf05f`)

All Wave-1 plans share the Plan 16-01 substrate (shared MODEL_TIER_COLORS, widened Task interface, DOM CustomEvent relays, viewer-auth runner-status endpoint, 10-locale i18n key parity). RUI-04 specifically closes the loop from authoring a recipe (Phase 12) → scheduling it as a task with the right runtime context (Phase 13) → watching it run (Phase 14/15) via a dedicated UI rather than curl.

No blockers for Phase 16 verification (`/gsd:verify-work 16`) or for Phase 17 Integration Testing kickoff.

## Self-Check: PASSED

All created files present on disk:
- `src/components/panels/task-form/recipe-combobox.tsx`
- `src/components/panels/task-form/advanced-section.tsx`
- `src/components/panels/task-form/mounts-editor.tsx`
- `src/components/panels/task-form/skills-chip-input.tsx`
- `src/components/panels/task-form/__tests__/recipe-combobox.test.tsx`
- `src/components/panels/task-form/__tests__/advanced-section.test.tsx`
- `src/components/panels/task-form/__tests__/mounts-editor.test.tsx`
- `src/components/panels/task-form/__tests__/skills-chip-input.test.tsx`

All task commits present in `git log`:
- fcc9137 — Task 1 (four components + 29 unit tests; swept into sibling 16-03 commit due to concurrent-staging race)
- af4b20f — Task 2a (EditTaskModal wiring)
- 498bdd3 — Task 2b (CreateTaskModal wiring reapply)

Plan verification gates:
- `pnpm typecheck` → 0
- `pnpm vitest run src/components/panels/task-form src/components/panels/__tests__/task-board-panel.test.tsx src/components/panels/__tests__/create-task-modal-open-workspace.test.tsx` → 58/58 passing
- Grep `from './task-form/recipe-combobox'` in task-board-panel.tsx → PRESENT
- Grep `from './task-form/advanced-section'` in task-board-panel.tsx → PRESENT
- Grep `RecipeCombobox` in task-board-panel.tsx → count 2 (CreateTaskModal + EditTaskModal render sites)
- Grep `AdvancedSection` in task-board-panel.tsx → count 2 (CreateTaskModal + EditTaskModal render sites)
- Grep `isDispatched` in task-board-panel.tsx → count 4 (EditTaskModal: 1 definition + 1 runtimeBody guard + 2 passes to RecipeCombobox / AdvancedSection)
- Grep `read_only_mounts` in task-board-panel.tsx → count >= 4 (payload includes + change-detection + render wiring)

---
*Phase: 16-runtime-ui-surfaces*
*Completed: 2026-04-21*
