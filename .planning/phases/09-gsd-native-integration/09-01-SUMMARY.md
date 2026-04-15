---
phase: 09-gsd-native-integration
plan: 01
subsystem: foundation
tags: [migrations, sqlite, validation, zod, event-bus, i18n, locale-parity, gsd]

requires:
  - phase: 09-gsd-native-integration
    plan: 00
    provides: 17 test scaffolds (it.todo) and atomic 10-locale project.lifecycle.* seed
provides:
  - Migration 052_gsd_native_integration (additive — 12 columns + 4 indexes)
  - 12 GSD-related exports in src/lib/validation.ts (4 enum constants + 8 Zod schemas)
  - 2 new EventType union members for project.gsd.transition + task.gate.changed
  - Real assertions replacing 17 it.todo stubs across 3 test files
affects: [09-02, 09-03, 09-04, 09-05, 09-06, 09-07, 09-08, 09-09, 09-10]

tech-stack:
  added: []
  patterns:
    - PRAGMA-guarded ALTER TABLE for idempotent additive migrations (matches 028_github_sync_v2 precedent)
    - Verbatim insertion at end of migrations array; zero edits to existing entries
    - Zod refine() with custom path for cross-field validation (transitionSchema waiver requires reason)
    - Locale parity test driven by full key tree walk of en.json — every locale must contain every English key

key-files:
  created: []
  modified:
    - src/lib/migrations.ts
    - src/lib/validation.ts
    - src/lib/event-bus.ts
    - src/lib/__tests__/migrations-052.test.ts
    - src/lib/__tests__/validation-gsd.test.ts
    - src/lib/__tests__/locale-parity-gsd.test.ts

key-decisions:
  - "Migration 052 inserted at line 1441 of src/lib/migrations.ts (immediately after 051_project_workspace_indexes); only insertions, zero deletions to pre-existing migrations"
  - "All 6 ALTER TABLE statements wrapped in PRAGMA table_info() guards — re-running migration is safe (verified by dedicated test)"
  - "GSD enum constants (GSD_PHASES, GSD_TRACKS, GSD_GATE_MODES, GSD_GATE_STATUSES) exported as `as const` arrays so downstream code can iterate them and Zod schemas reuse the same source of truth"
  - "transitionSchema uses .refine() with explicit path:['reason'] so 400 responses surface the violating field by name (matches existing validation contract)"
  - "EventType union members appended after 'session.updated' (lines 41-42); inline comment cites GSD-28 + D-34 for traceability"
  - "Locale parity test enumerates 24 specific lifecycle keys + walks full en.json key tree against all 9 other locales (241 assertions total) — fails loudly if any future plan adds a key to en.json without seeding the other 9 locales"

requirements-completed: [GSD-02, GSD-03, GSD-04, GSD-05, GSD-06, GSD-28]

duration: ~5min
completed: 2026-04-15
---

# Phase 09 Plan 01: Foundation (Schema + Validation + Event Bus) Summary

**Migration 052 (12 GSD columns + 4 indexes), 12 Zod exports, 2 EventType members — every Wave 2 endpoint can now import the schema/types it needs without TypeScript errors.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-15T22:39:00Z (approx.)
- **Completed:** 2026-04-15T22:44:00Z
- **Tasks:** 2
- **Files modified:** 6 (3 source + 3 tests)

## Accomplishments

- Appended migration `052_gsd_native_integration` at line 1441 of `src/lib/migrations.ts` with PRAGMA guards on every ALTER TABLE
- Added 12 exported GSD symbols to `src/lib/validation.ts` (lines 203-260): 4 enum constants + 8 Zod schemas
- Extended EventType union in `src/lib/event-bus.ts` lines 41-42 with `'project.gsd.transition'` and `'task.gate.changed'`
- Replaced 17 `it.todo` stubs across 3 test files with real assertions: 6 migration tests + 16 validation tests + 241 locale-parity tests
- Test counts: `pnpm test` jumped from 1170 → 1427 passed (+257); todos shrank from 137 → 120

## Task Commits

1. **Task 1: Migration 052 — additive GSD columns + indexes (GSD-02, GSD-04, GSD-05, GSD-06)** — `df84163` (feat)
2. **Task 2: Validation schemas + EventType union + locale parity (GSD-03, GSD-28, GSD-29)** — `74a93cb` (feat)

_Plan metadata commit follows (docs: complete plan)._

## Files Created/Modified

### `src/lib/migrations.ts` (1 entry appended at line 1441)

New migration `052_gsd_native_integration` adds:

**projects table (6 columns):**
- `gsd_enabled INTEGER NOT NULL DEFAULT 0`
- `gsd_track TEXT` (nullable)
- `gsd_phase TEXT NOT NULL DEFAULT 'discuss'`
- `gsd_gate_mode TEXT NOT NULL DEFAULT 'manual_approval'`
- `gsd_project_id TEXT` (nullable)
- `gsd_updated_at INTEGER` (nullable)

**tasks table (6 columns):**
- `gsd_phase TEXT` (nullable)
- `gate_required INTEGER NOT NULL DEFAULT 0`
- `gate_status TEXT NOT NULL DEFAULT 'not_required'`
- `gate_approved_by TEXT` (nullable)
- `gate_approved_at INTEGER` (nullable)
- `depends_on_task_ids TEXT` (nullable, JSON-encoded)

**4 indexes (CREATE INDEX IF NOT EXISTS):**
- `idx_projects_gsd_phase` on `projects(gsd_phase)`
- `idx_tasks_gsd_phase` on `tasks(gsd_phase)`
- `idx_tasks_gate_status` on `tasks(gate_status)`
- `idx_tasks_project_gsd_phase` on `tasks(project_id, gsd_phase)`

### `src/lib/validation.ts` (lines 202-260, 12 new exports)

```
GSD_PHASES         = ['discuss','plan','execute','verify','done']
GSD_TRACKS         = ['ops','product','marketing','legal','firmvault','custom']
GSD_GATE_MODES     = ['manual_approval','auto_internal']
GSD_GATE_STATUSES  = ['not_required','pending','approved','rejected']

gsdPhaseSchema           // z.enum(GSD_PHASES)
gsdTrackSchema           // z.enum(GSD_TRACKS)
gsdGateModeSchema        // z.enum(GSD_GATE_MODES)
gsdGateStatusSchema      // z.enum(GSD_GATE_STATUSES)

transitionSchema         // { to_phase, reason?, waive_remaining? } with refine(path:['reason'])
bootstrapSchema          // z.object({}).passthrough()
taskGatePatchSchema      // { gate_status: 'approved'|'rejected', note? }
gsdTemplatePhaseEntrySchema  // { ticket_ref:/^[A-Z]+-\d+$/, title, description?, gate_required:0|1, depends_on?:string[] }
gsdTemplateSchema        // { name, phases: { discuss[], plan[], execute[], verify[] } }
```

### `src/lib/event-bus.ts` (lines 41-42)

Two members appended to `EventType` union:
```
| 'project.gsd.transition'   // Phase 09 GSD-28, D-34
| 'task.gate.changed'         // Phase 09 GSD-28, D-34
```

### Test count replacements (it.todo → it)

| File | Stubs → Real Tests | Assertions |
|------|-------|-----|
| `src/lib/__tests__/migrations-052.test.ts` | 6 → 6 | ~25 expect() calls |
| `src/lib/__tests__/validation-gsd.test.ts` | 6 → 16 | ~50 expect() calls |
| `src/lib/__tests__/locale-parity-gsd.test.ts` | 5 → 241 (parameterized over 10 locales × 24 keys + key-tree walk) | ~700 expect() calls |
| **Total** | **17 → 263** | — |

## Decisions Made

See frontmatter `key-decisions` — six logged for STATE.md.

## Deviations from Plan

None — plan executed exactly as written. Migration insertion comma placement was already correct because migration 051 had no trailing comma (the existing pattern terminates the array with a single closing `]`); the new entry was appended with `,` separating it from 051.

## Issues Encountered

None. All verification gates passed first try:

- `pnpm test -- src/lib/__tests__/migrations-052.test.ts`: 6/6 PASS
- `pnpm test -- src/lib/__tests__/validation-gsd.test.ts`: 16/16 PASS
- `pnpm test -- src/lib/__tests__/locale-parity-gsd.test.ts`: 241/241 PASS
- `pnpm test` full suite: 1427 passed, 120 todo, 17 skipped (118 test files), 0 failed
- `pnpm typecheck`: PASS
- `pnpm build`: PASS (standalone bundle includes migration 052)
- `git diff` on `src/lib/migrations.ts`: zero deletions (only insertions to existing migrations array)

## User Setup Required

None — schema migration is additive with safe defaults; existing DBs upgrade automatically on next `runMigrations()` call.

## Next Phase Readiness

- **Wave 2 (09-02..09-07)** can now import:
  - `transitionSchema`, `bootstrapSchema`, `taskGatePatchSchema`, `gsdTemplateSchema` from `@/lib/validation`
  - `GSD_PHASES`, `GSD_TRACKS` constants for runtime iteration
  - `'project.gsd.transition'`, `'task.gate.changed'` event types via `eventBus.broadcast()`
  - All 12 schema columns are present on `projects` and `tasks` tables
- **Locale parity contract** is now enforced — any future plan that adds a `project.lifecycle.*` key to `en.json` will fail tests in 9 locales until they're updated atomically

## Self-Check: PASSED

- [x] `src/lib/migrations.ts` line 1442: `id: '052_gsd_native_integration'` present
- [x] `src/lib/validation.ts` line 203: `export const GSD_PHASES` present
- [x] `src/lib/event-bus.ts` line 41: `'project.gsd.transition'` present
- [x] Commit `df84163` present in `git log` (Task 1)
- [x] Commit `74a93cb` present in `git log` (Task 2)
- [x] All 6 migration tests pass
- [x] All 16 validation tests pass
- [x] All 241 locale-parity tests pass
- [x] `pnpm typecheck` exited 0
- [x] `pnpm build` succeeded
- [x] Zero deletions to pre-existing migrations (verified via `git diff`)
- [x] Zero `it.todo` remaining in the three target test files

---
*Phase: 09-gsd-native-integration*
*Completed: 2026-04-15*
