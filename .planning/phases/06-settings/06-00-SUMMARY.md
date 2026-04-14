---
phase: 06-settings
plan: 00
subsystem: testing
tags: [vitest, i18n, next-intl, scaffolding, settings]

# Dependency graph
requires:
  - phase: 05-sessions-agents
    provides: wave-0 it.todo()/test.fixme() scaffolding rhythm, atomic multi-locale i18n commit pattern, embedded mock-setup block comment convention
  - phase: 02-navigation-workspace-shell
    provides: project-context (useProjectWorkspace), URL-driven view parsing
  - phase: 01-foundation
    provides: i18n namespace structure (project.* in messages/{10 locales}.json)
provides:
  - 1 new vitest scaffold (settings-view.test.tsx) with 35 it.todo() pending tests covering SETT-01, SETT-02, SETT-03 plus every pitfall from 06-CONTEXT.md
  - 1 extended vitest coverage test (i18n-coverage.test.tsx) enforcing 32-key project.settings.* surface across all 10 locales + placeholder-removed guard + en.json canonical title
  - 32 i18n keys per locale × 10 locales = 320 translated strings (minus 20 existing title/placeholder = 300 net new strings) under project.settings.* matching the UI-SPEC Copywriting Contract
  - Locked test bucket that Plan 06-01 can fill without locale-file churn
affects: [06-01, 06-VERIFICATION]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave 0 it.todo() scaffold + atomic multi-locale i18n commit — replay of the Phase 5 playbook so Wave 1 implementation never touches messages/*.json"
    - "Imports minimized in the scaffold (only describe/it from vitest) since it.todo bodies can't reference runtime code — keeps the file parseable while SettingsView is still the 16-line stub"
    - "Extended existing i18n-coverage.test.tsx instead of creating a new per-namespace test file — the SETTINGS_KEYS array becomes the authoritative manifest future plans can import if they split out settings coverage"

key-files:
  created:
    - src/components/project/__tests__/settings-view.test.tsx
    - .planning/phases/06-settings/06-00-SUMMARY.md
  modified:
    - src/components/project/__tests__/i18n-coverage.test.tsx
    - messages/ar.json
    - messages/de.json
    - messages/en.json
    - messages/es.json
    - messages/fr.json
    - messages/ja.json
    - messages/ko.json
    - messages/pt.json
    - messages/ru.json
    - messages/zh.json

key-decisions:
  - "Continued wave-0 it.todo() pattern from Phases 1–5 — Plan 06-01 has a concrete test bucket with 35 stubs to fill; no harness re-derivation needed"
  - "Atomic 10-locale commit for settings.* — eliminates conflict surface for any future parallel work on settings-adjacent copy"
  - "Scaffold imports only describe/it from vitest (no SettingsView import yet) — scaffold stays green while settings-view.tsx is still the 16-line stub"
  - "Title updated from 'Settings' to 'Project settings' per UI-SPEC; brand tokens (GitHub, PA, owner/repo, hex colors) intentionally untranslated per Phase 5 precedent"
  - "Reused existing project.common.retry across all locales instead of adding a loadErrorRetry key (per plan's explicit direction)"
  - "Translation voice matches the existing Phase 5 settings-adjacent copy already present in each file (retry, errorHeading, loading) — keeps tone consistent across the project namespace"

metrics:
  duration: ~7min
  completed_date: 2026-04-14
  tasks_completed: 2
  files_changed: 12
  lines_added: ~430
  it_todo_stubs_added: 35
  i18n_keys_added_per_locale: 30  # 32 total - 2 pre-existing (title/placeholder; placeholder removed)
---

# Phase 6 Plan 00: Settings Wave 0 Scaffold Summary

One-liner: Wave 0 test scaffolds and atomic 10-locale i18n namespace for SettingsView following the Phase 5 playbook — Plan 06-01 can fill stubs without locale-file churn.

## What Was Built

**Task 1 — SettingsView test scaffold** (`5a01f1b`)
- Created `src/components/project/__tests__/settings-view.test.tsx`
- 35 `it.todo()` pending stubs (exceeds the ≥32 requirement)
- Coverage bands:
  - Basics (SETT-01): 5 stubs — name, description, status select + Archived disable for `slug==="general"`, dirty detection
  - Appearance & Tracking (SETT-02): 6 stubs — 8-swatch palette + None pill, click-to-toggle, ticket_prefix monospace/uppercase/maxLength=12, prefixHelp i18n wiring, deadline YYYY-MM-DD seeding, dirty detection
  - Integrations (SETT-02): 1 stub — github_repo placeholder
  - Save flow (SETT-03): 6 stubs — PATCH with only dirty fields, deadline serialization, empty/null coercion, fetchProjects refresh, no router.refresh, never include ticket_counter
  - Pitfalls: 5 stubs — normalized prefix comparison, deadline round-trip timezone, empty-vs-null dirty false-positives, default-project archive 400 defense, in-progress-edit preservation on projects[] refresh
  - Cancel + footer: 4 stubs — reset on cancel, Save disabled when pristine/empty-name, Saving… state + Cancel disable
  - Error handling: 6 stubs — 400 name empty, 409 prefix conflict, 400 invalid prefix, 400 default archive, unknown error banner focus, network failure fallback copy
  - Viewer role (D-20): 1 stub — disabled inputs, hidden footer, readOnlyNote
  - i18n wiring: 1 stub — all strings route through `useTranslations('project.settings')`
- Top-of-file block comment documents the harness setup (next-intl mock, project-context mock, store mock, global.fetch, project fixture) for Wave 1 fill-in
- Imports only `describe`, `it` from vitest — no SettingsView import (would dangle since stubs have no bodies while settings-view.tsx is still the 16-line stub)

**Task 2 — i18n atomic commit across 10 locales** (`ed5de47`)
- Replaced 2-key `project.settings` block (`title`, `placeholder`) with 32-key full namespace in every locale file:
  - `messages/ar.json`, `de.json`, `en.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt.json`, `ru.json`, `zh.json`
- Updated title from "Settings" to "Project settings" (en.json canonical; other locales translated idiomatically)
- Added 31 new keys: `sectionBasics`, `sectionAppearance`, `sectionIntegrations`, `readOnlyNote`, `nameLabel`, `namePlaceholder`, `descriptionLabel`, `descriptionPlaceholder`, `statusLabel`, `statusActive`, `statusArchived`, `colorLabel`, `colorNone`, `prefixLabel`, `prefixPlaceholder`, `prefixHelp`, `deadlineLabel`, `githubRepoLabel`, `githubRepoPlaceholder`, `githubRepoHelp`, `save`, `cancel`, `saving`, `unsavedChanges`, `errorNameRequired`, `errorPrefixConflict`, `errorPrefixInvalid`, `errorDefaultArchive`, `errorBannerHeading`, `errorBannerFallback`, `loadErrorHeading`
- Removed the old stub `placeholder` key from all 10 files
- Did NOT add `loadErrorRetry` — reuses existing `project.common.retry` per plan direction
- Extended `src/components/project/__tests__/i18n-coverage.test.tsx` with a new `it()` that iterates `SETTINGS_KEYS` across all 10 locales, asserts:
  1. Every key is present in `data.project.settings`
  2. `data.project.settings.placeholder` is undefined (stub gone)
  3. `en.json`'s `data.project.settings.title === 'Project settings'` (canonical)
- Left the existing `it.todo()` entries at the end of the describe block unchanged

## Translation Judgement Calls (by Locale)

All locales translated the 31 new keys idiomatically rather than literally, matching the voice of existing Phase 5 settings-adjacent copy already present in each file. Notable calls:

- **ar (Arabic)**: Used "الموعد النهائي" for deadline (standard), "مؤرشف" for archived passive. RTL rendering left to the existing locale direction setup.
- **de (German)**: Kept the project convention of ASCII-only umlaut expansion (ae, oe, ue, ss) matching the existing Phase 5 copy style ("oeffnen", "pruefen"). "Appearance & Tracking" → "Darstellung und Verfolgung".
- **es (Spanish)**: Used inverted question mark in descriptionPlaceholder ("¿De qué trata...?") and accented characters throughout.
- **fr (French)**: `&` → "et" ("Apparence et suivi"). Space before `?` and `:` preserved per French typography convention (e.g., "Format : owner/repo", "De quoi s'agit-il dans ce projet ?").
- **ja (Japanese)**: Used 全角 punctuation where natural ("?" kept as half-width `?` to match existing Phase 5 copy that mixes CJK and ASCII punctuation). GitHub and owner/repo left untranslated.
- **ko (Korean)**: Standard 존댓말 voice matching existing Phase 5 copy. "형식:" uses half-width colon to match codebase convention.
- **pt (Portuguese)**: Brazilian Portuguese spelling ("Configurações", "Integrações") matching existing locale voice.
- **ru (Russian)**: Used ё where appropriate ("Отменить", "Формат"). "В архиве" for archived (standard).
- **zh (Chinese)**: Simplified Chinese matching existing Phase 5 copy. Full-width colon ":" in helpers ("格式:owner/repo") matches CJK punctuation convention.
- **en (English)**: Canonical source. Used ellipsis character "…" (U+2026) for "Saving…" per UI-SPEC.

**Brand tokens untranslated across all 10 locales** (per D-21/D-22 and Phase 5 precedent):
- `GitHub` (brand name)
- `PA` (prefix example)
- `owner/repo` (format token)
- `Live Feed` (product surface name)

## Pitfall Stub List (Verbatim Copy for Plan 06-01)

These five pitfall stubs from `settings-view.test.tsx` encode the research findings from 06-CONTEXT.md for the implementation plan to honor:

1. `Pitfall — ticket_prefix dirty-check compares normalized values (uppercased, alphanumeric-only, 12-char cap) so form is not false-dirty after server echoes normalized value`
2. `Pitfall — deadline round-trip: loading project.deadline as Unix seconds and saving back yields the same date in the user local timezone the modal uses`
3. `Pitfall — empty string vs null: description/github_repo/color that were null on load and remain empty do NOT mark the form dirty`
4. `Pitfall — slug==="general" status archive still shows inline status error if server returns 400 (defensive handling, Archived option is UI-disabled)`
5. `Pitfall — form re-seeding does not clobber in-progress edits: if projects[] refreshes while form is dirty, current inputs are preserved`

## Verification Results

- `pnpm test -- src/components/project/__tests__/settings-view.test.tsx --run` — 35 todos reported, 0 failures
- `pnpm test -- src/components/project/__tests__/i18n-coverage.test.tsx --run` — new assertion passes across all 10 locales
- `pnpm test` (full suite) — **89 passed / 5 skipped test files, 1081 passed / 79 todo tests**
- `pnpm typecheck` — clean (0 errors)
- `pnpm lint` — 0 errors (72 pre-existing warnings in unrelated files are out of scope per Rule 4 Scope Boundary)
- All 10 locale files are valid JSON (parsed successfully via `node -e`)
- All 10 files have exactly 32 keys under `project.settings` with `placeholder` absent
- `en.json`'s `project.settings.title === 'Project settings'`

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None encountered.

## Commits

| Task | Type | Hash     | Message                                                                   | Files                                                                                  |
| ---- | ---- | -------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1    | test | 5a01f1b  | test(06-00): add SettingsView test scaffold with it.todo stubs            | src/components/project/__tests__/settings-view.test.tsx                                |
| 2    | feat | ed5de47  | feat(06-00): add project.settings.* i18n namespace across 10 locales      | 10 messages/*.json files + src/components/project/__tests__/i18n-coverage.test.tsx     |

## Known Stubs

None at the implementation level. The SettingsView component itself remains the 16-line Phase-1 stub (intentional — Plan 06-01 will flesh it out with the scaffold now in place).

## Self-Check: PASSED

- File exists: `src/components/project/__tests__/settings-view.test.tsx` — FOUND
- File exists: `src/components/project/__tests__/i18n-coverage.test.tsx` — FOUND (modified)
- All 10 locale files modified — FOUND
- Commit `5a01f1b` exists — FOUND
- Commit `ed5de47` exists — FOUND
- 35 it.todo stubs in settings-view.test.tsx (≥32 required) — VERIFIED
- 32 keys in project.settings for all 10 locales — VERIFIED
- `placeholder` key removed from all 10 locales — VERIFIED
- `pnpm test` / `pnpm typecheck` / `pnpm lint` all green — VERIFIED
