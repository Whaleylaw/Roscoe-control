---
phase: 09-gsd-native-integration
plan: 02
subsystem: project-api
tags: [projects, api, crud, gsd, validation, types, zustand]

requires:
  - phase: 09-gsd-native-integration
    plan: 01
    provides: GSD_TRACKS + GSD_GATE_MODES + migration 052 columns
provides:
  - GET /api/projects list returns 6 gsd_* columns per row
  - GET /api/projects/:id returns 6 gsd_* columns
  - POST /api/projects accepts and validates gsd_enabled/gsd_track/gsd_gate_mode/gsd_project_id
  - PATCH /api/projects/:id accepts partial gsd field updates; gsd_phase explicitly excluded
  - Project TypeScript interface (new in src/lib/db.ts) with 6 gsd_* fields
  - Task interface extended with 6 gate lifecycle fields in both src/lib/db.ts and src/store/index.ts
  - Project interface extended with 6 gsd_* fields in src/store/index.ts
affects: [09-03, 09-04, 09-05, 09-06, 09-07, 09-08, 09-09, 09-10]

tech-stack:
  added: []
  patterns:
    - GSD_TRACKS / GSD_GATE_MODES imported once per route; runtime cast to readonly string[] for .includes type safety
    - POST validates track pre-INSERT (returns 400 with 'Invalid gsd_track') and gate_mode (400 'Invalid gsd_gate_mode')
    - PATCH accepts null on gsd_track to unset; typed enum check runs only for non-null values
    - gsd_phase intentionally absent from both POST and PATCH — transitions flow through /gsd/transition endpoint (09-04)
    - Test harness mirrors get-last-activity.test.ts: vi.mock of @/lib/db with in-memory Map<id, row> and captured SQL strings for column-presence assertions

key-files:
  created: []
  modified:
    - src/app/api/projects/route.ts
    - src/app/api/projects/[id]/route.ts
    - src/lib/db.ts
    - src/store/index.ts
    - src/app/api/projects/__tests__/projects-crud-gsd.test.ts

key-decisions:
  - "POST accepts body.gsd_enabled as truthy/falsy (typeof-agnostic) to match existing body.github_sync_enabled precedent"
  - "PATCH on gsd_track accepts explicit null as valid 'clear the track' signal; enum check only runs when value is non-null"
  - "gsd_phase is absent from PATCH handler entirely — a PATCH body carrying gsd_phase=execute alongside gsd_enabled:true applies gsd_enabled but silently drops gsd_phase (verified by test)"
  - "GSD_TRACKS/GSD_GATE_MODES (declared 'as const' in validation.ts) cast to readonly string[] at call sites so .includes() accepts arbitrary string inputs without type narrowing"
  - "Project interface did not exist in src/lib/db.ts; created it with full column set + 6 gsd_* fields (Project type in src/store/index.ts is the long-standing client-side type — also extended for parity)"
  - "Test harness is self-contained per-file (in-memory projectTable Map + role-switch mock) — no shared fixture imports; parallel executor safe"

requirements-completed: [GSD-01, GSD-13, GSD-14]

duration: ~7min
completed: 2026-04-14
---

# Phase 09 Plan 02: Project API — GSD Field CRUD + Type Plumbing Summary

**Projects API now carries 6 gsd_* fields end-to-end (DB → API → TypeScript) with enum validation on track/gate_mode and gsd_phase intentionally locked out of PATCH — downstream Lifecycle tab (Wave 3) and Wave 2 transition endpoint can now read typed fields from store and API.**

## Performance

- **Duration:** ~7 min
- **Tasks:** 2
- **Files modified:** 5 (3 source + 1 store + 1 test)

## Accomplishments

- GET /api/projects list SELECT now includes `p.gsd_enabled, p.gsd_track, p.gsd_phase, p.gsd_gate_mode, p.gsd_project_id, p.gsd_updated_at` (line 42-43)
- POST /api/projects accepts gsd_enabled/gsd_track/gsd_gate_mode/gsd_project_id with enum validation for track + gate_mode (returns 400 on invalid)
- POST INSERT now carries the 4 writeable GSD columns; gsd_phase uses DEFAULT 'discuss' from migration 052
- Post-INSERT SELECT echoes all 6 gsd_* fields
- GET /api/projects/:id SELECT now includes 6 gsd_* fields (line 54-55)
- PATCH /api/projects/:id accepts partial updates for gsd_enabled, gsd_track (null clears), gsd_gate_mode, gsd_project_id with validation; silently drops gsd_phase
- Post-PATCH SELECT echoes all 6 gsd_* fields
- src/lib/db.ts: new Project interface (did not exist prior) + Task interface extended with 6 gate fields
- src/store/index.ts: Project + Task interfaces extended with same fields
- projects-crud-gsd.test.ts: 8 it.todo stubs → 11 real tests with 47 expect() assertions

## Task Commits

1. **Task 1 RED: failing tests for project API GSD field extension** — `ce742f2` (test)
2. **Task 1 GREEN: extend projects API with GSD field CRUD (GSD-01, GSD-13, GSD-14)** — `af3ebb1` (feat)
3. **Task 2: extend Project and Task types with GSD fields (GSD-01 type plumbing)** — `9805aaf` (feat)

_Plan metadata commit follows (docs: complete plan)._

## Files Created/Modified

### `src/app/api/projects/route.ts`

- Added import: `import { GSD_TRACKS, GSD_GATE_MODES } from '@/lib/validation'` (line 7)
- Extended GET list SELECT (lines 40-52) — 6 gsd_* columns inserted after `p.color,`
- Added POST GSD field parsing block (after `const color = ...`, lines 100-113) — validates gsd_track via `GSD_TRACKS.includes` (returns 400 "Invalid gsd_track") and gsd_gate_mode via `GSD_GATE_MODES.includes` (400 "Invalid gsd_gate_mode")
- Extended POST INSERT (lines 117-124) — added `gsd_enabled, gsd_track, gsd_gate_mode, gsd_project_id` columns + matching params
- Extended post-INSERT SELECT (lines 131-138) — 6 gsd_* fields

### `src/app/api/projects/[id]/route.ts`

- Added import: `import { GSD_TRACKS, GSD_GATE_MODES } from '@/lib/validation'` (line 10)
- Extended GET detail SELECT (lines 53-60) — 6 gsd_* columns inserted after `p.color,`
- Added PATCH GSD field block (after `github_labels_initialized` block, before `updated_at` push) — 4 field handlers (gsd_enabled, gsd_track with null-clear, gsd_gate_mode with enum validation, gsd_project_id) + inline comment documenting intentional absence of gsd_phase
- Extended post-PATCH SELECT (lines 194-202) — 6 gsd_* fields

### `src/lib/db.ts`

- Task interface (lines 188-222): appended 6 gate lifecycle fields (gsd_phase, gate_required, gate_status, gate_approved_by, gate_approved_at, depends_on_task_ids)
- Project interface (lines 224-248) NEWLY DECLARED — did not exist in db.ts prior; contains full column set + 6 gsd_* lifecycle fields

### `src/store/index.ts`

- Task interface (line 99-145): appended same 6 gate fields; comment anchors to GSD-04/GSD-05
- Project interface (line 336-358): appended 6 gsd_* lifecycle fields; comment anchors to GSD-01/GSD-02/GSD-03/GSD-13

### `src/app/api/projects/__tests__/projects-crud-gsd.test.ts`

- Replaced 8 `it.todo` stubs with 11 real `it()` tests across 4 describe blocks:
  - POST (4 tests: success/invalid-track/invalid-gate-mode/viewer-403)
  - GET list (1 test: all 6 fields + SQL column-presence assertions)
  - GET detail (1 test: all 6 fields)
  - PATCH (6 tests: gsd_enabled update / gsd_track null clear / gsd_phase silently dropped / invalid-track / invalid-gate-mode / viewer-403)
- 47 total `expect()` assertions
- Harness: mock @/lib/db with in-memory `Map<id, Row>` + captured SQL strings + role-switchable auth mock

## Decisions Made

See frontmatter `key-decisions` — six logged for STATE.md.

## Deviations from Plan

None — plan executed exactly as written. The plan noted the `Project` interface may exist in src/lib/db.ts; it did not, so it was created from scratch (with the complete column set + GSD additions) rather than merely extended. This is a structural addition, not a deviation from plan intent.

## Issues Encountered

None. All verification gates passed:

- `pnpm test -- src/app/api/projects/__tests__/projects-crud-gsd.test.ts`: 11/11 PASS
- `pnpm typecheck`: PASS
- `pnpm build`: PASS (standalone bundle includes extended routes)
- Full suite: 1495 passed / 76 todo / 0 failed

## User Setup Required

None — additive field extension with safe defaults; existing clients ignoring new fields continue to work unchanged.

## Next Phase Readiness

- **Wave 2b (09-04 transition endpoint):** Can PATCH gsd_phase directly via SQL UPDATE; user-facing PATCH route confirmed to reject phase mutations.
- **Wave 3 UI (Lifecycle tab, phase/gate badges):** Can consume `project.gsd_enabled === 1`, `project.gsd_phase`, `task.gate_status` from the Zustand store with full TypeScript support.
- **Downstream tests:** `projects-crud-gsd.test.ts` harness (mutable Map-based mock DB) is now a reference pattern for 09-05+ CRUD tests.

## Self-Check: PASSED

- [x] `src/app/api/projects/route.ts` line 42 contains `p.gsd_enabled, p.gsd_track, p.gsd_phase, p.gsd_gate_mode, p.gsd_project_id, p.gsd_updated_at`
- [x] `src/app/api/projects/route.ts` POST body carries `gsd_enabled, gsd_track, gsd_gate_mode, gsd_project_id` in INSERT
- [x] `src/app/api/projects/[id]/route.ts` GET detail SELECT has `p.gsd_enabled`
- [x] `src/app/api/projects/[id]/route.ts` PATCH has `gsd_track = ?` and NO `gsd_phase = ?`
- [x] `src/lib/db.ts` has `gsd_enabled` and `gate_required`
- [x] `src/store/index.ts` has `gsd_enabled` and `gate_status`
- [x] Commit `ce742f2` present in `git log` (Task 1 RED)
- [x] Commit `af3ebb1` present in `git log` (Task 1 GREEN)
- [x] Commit `9805aaf` present in `git log` (Task 2)
- [x] 11 real tests / 0 it.todo / 47 expect() in projects-crud-gsd.test.ts
- [x] `pnpm typecheck` exited 0
- [x] `pnpm build` succeeded

---
*Phase: 09-gsd-native-integration*
*Completed: 2026-04-14*
