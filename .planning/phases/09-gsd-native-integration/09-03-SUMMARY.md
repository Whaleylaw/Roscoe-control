---
phase: 09-gsd-native-integration
plan: 03
subsystem: bootstrap
tags: [api, bootstrap, templates, idempotency, event-bus, gsd]

requires:
  - phase: 09-gsd-native-integration
    plan: 01
    provides: validation schemas (gsdTemplateSchema, GSD_TRACKS) + task.created event type + tasks.gsd_phase/gate_required/gate_status columns
provides:
  - DEFAULT_TEMPLATE constant (8 entries — DISCUSS/PLAN/EXEC/VERIFY × 2)
  - loadGsdTemplate(track) with D-16 soft-miss fallback
  - POST /api/projects/:id/gsd/bootstrap (idempotent per D-19)
  - metadata.gsd_ticket_ref logical-ref carrier on every seeded task
affects: [09-04, 09-05, 09-06, 09-07, 09-08, 09-09, 09-10]

tech-stack:
  added: []
  patterns:
    - Idempotency key via json_extract(metadata, '$.gsd_ticket_ref') composite check
    - db.transaction() batch seed; event broadcast AFTER commit (never inside TX)
    - Zod schema inference (z.infer<typeof gsdTemplateSchema>) as the public type
      so 'as const' literal narrowing inside DEFAULT_TEMPLATE does not leak
    - Whitelist check (GSD_TRACKS.includes) before filesystem lookup — unknown
      track falls through to default.json path, then to DEFAULT_TEMPLATE

key-files:
  created:
    - src/lib/gsd-templates.ts
    - src/app/api/projects/[id]/gsd/bootstrap/route.ts
  modified:
    - src/lib/__tests__/gsd-templates.test.ts
    - src/app/api/projects/__tests__/bootstrap.test.ts

key-decisions:
  - "DEFAULT_TEMPLATE retained 'as const' (matches plan spec line 159) — return type widened via z.infer<typeof gsdTemplateSchema> so consumers see a structural type, not a readonly tuple; DEFAULT_TEMPLATE cast once at each return site with 'as unknown as GsdTemplate'"
  - "Idempotency key is (project_id, workspace_id, gsd_phase, json_extract metadata $.gsd_ticket_ref) — re-bootstrap on same project returns { created:0, skipped:8 } without touching rows"
  - "gate_status derived from gate_required: 1 → 'pending', 0 → 'not_required' (D-09 / D-10 gate contract)"
  - "eventBus.broadcast('task.created') called in a post-commit loop over createdTasks, NEVER inside db.transaction() — guarantees SSE listeners observe persisted rows"
  - "loadGsdTemplate NEVER throws — unknown track, missing file, malformed JSON, and Zod-invalid shape all resolve to DEFAULT_TEMPLATE so bootstrap always succeeds (D-16 contract)"
  - "Non-numeric id validation uses String(parsed)===id.trim() (Pitfall mixed-junk guard from Plan 08-02 precedent) — rejects '1abc' as 400, not silent truncation"

requirements-completed: [GSD-07, GSD-11, GSD-12, GSD-17, GSD-18, GSD-19]

duration: ~8min
completed: 2026-04-14
---

# Phase 09 Plan 03: Bootstrap Endpoint + Template Loader Summary

**POST /api/projects/:id/gsd/bootstrap seeds 8 default phase tasks from on-disk JSON templates (or DEFAULT_TEMPLATE fallback) idempotently; re-runs are no-ops and eventBus emits task.created per freshly-created row.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 2
- **Commits:** 4 (2× RED test commits + 2× GREEN implementation commits)
- **Files created:** 2 (`src/lib/gsd-templates.ts`, `src/app/api/projects/[id]/gsd/bootstrap/route.ts`)
- **Files modified:** 2 test files (filled from `it.todo` scaffolds into 24 real tests)

## Accomplishments

- **Task 1 (GSD-17, GSD-18):** Added `DEFAULT_TEMPLATE` constant with 8 entries (DISCUSS-01/02, PLAN-01/02, EXEC-01/02, VERIFY-01/02 — PLAN-02 and EXEC-02 gate-required) and `loadGsdTemplate(track)` resolver. Soft-miss fallback on missing / malformed / Zod-invalid files with `logger.warn` (Pitfall 8).
- **Task 2 (GSD-07, GSD-11, GSD-12, GSD-19):** Created `POST /api/projects/:id/gsd/bootstrap` handler with the standard `requireRole('operator') → mutationLimiter → ensureTenantWorkspaceAccess` preamble. Transactional batch insert with per-entry idempotency check. `projects.ticket_counter` bumped per created task. Broadcasts `task.created` after commit. Activity log entry `project_gsd_bootstrap` captures `{ created, skipped, track }`.
- **Tests:** Replaced 5 + 9 = 14 `it.todo` stubs with 12 + 12 = **24 real tests**, all green (≥27 `expect()` assertions in bootstrap.test.ts alone).
- **Typecheck:** `pnpm typecheck` passes clean.

## Task Commits

1. **Task 1 RED** — `b8de0bd` — `test(09-03): add failing tests for DEFAULT_TEMPLATE + loadGsdTemplate`
2. **Task 1 GREEN** — `f86eb69` — `feat(09-03): add DEFAULT_TEMPLATE + loadGsdTemplate (GSD-17, GSD-18)`
3. **Task 2 RED** — `5b5972b` — `test(09-03): add failing tests for POST /api/projects/:id/gsd/bootstrap`
4. **Task 2 GREEN** — `361c1cb` — `feat(09-03): add POST /api/projects/:id/gsd/bootstrap (GSD-07, GSD-11, GSD-12, GSD-19)`

## Files Created/Modified

### `src/lib/gsd-templates.ts` (new, 72 lines)

- `DEFAULT_TEMPLATE` (const, `as const`) — 8 entries across 4 phases
- `export type GsdTemplate = z.infer<typeof gsdTemplateSchema>` (structural, not literal)
- `loadGsdTemplate(track: string | null): GsdTemplate` — whitelist check via `GSD_TRACKS.includes`, then `<dataDir>/gsd-templates/<track>.json` lookup, then try/catch with `logger.warn` on failure

### `src/app/api/projects/[id]/gsd/bootstrap/route.ts` (new, 148 lines)

POST handler. Key SQL statements:

```sql
-- idempotency dedupe
SELECT id FROM tasks
WHERE project_id = ? AND workspace_id = ? AND gsd_phase = ?
  AND json_extract(COALESCE(metadata, '{}'), '$.gsd_ticket_ref') = ?
LIMIT 1;

-- counter bump (once per created task, Pitfall 3)
UPDATE projects SET ticket_counter = ticket_counter + 1, updated_at = unixepoch()
WHERE id = ? AND workspace_id = ?;

-- task insert (inside db.transaction())
INSERT INTO tasks (workspace_id, title, description, status, priority,
  project_id, project_ticket_no, created_by,
  gsd_phase, gate_required, gate_status,
  tags, metadata, created_at, updated_at)
VALUES (?, ?, ?, 'backlog', 'medium', ?, ?, ?, ?, ?, ?, '[]', ?, unixepoch(), unixepoch());
```

### Test coverage (24 new tests)

| Test file | Tests | Assertions |
|-----------|-------|-----------|
| `src/lib/__tests__/gsd-templates.test.ts` | 12 (6 DEFAULT_TEMPLATE shape + 6 loadGsdTemplate resolution) | ~20 expects |
| `src/app/api/projects/__tests__/bootstrap.test.ts` | 12 (role/404/400 + happy path + gate semantics + idempotency + track fallback + event broadcast + logActivity) | 27 expects |

## Decisions Made

See frontmatter `key-decisions` — six logged for STATE.md:

1. DEFAULT_TEMPLATE retains `as const`; GsdTemplate type comes from `z.infer<typeof gsdTemplateSchema>` (structural). Each return site casts DEFAULT_TEMPLATE once via `as unknown as GsdTemplate`.
2. Idempotency key = (project_id, workspace_id, gsd_phase, json_extract metadata.gsd_ticket_ref).
3. gate_status derived directly from gate_required (1 → 'pending', 0 → 'not_required').
4. Event broadcast happens AFTER transaction commit, in a post-TX loop.
5. loadGsdTemplate NEVER throws — contract makes bootstrap universally safe.
6. Non-numeric id guard uses `String(parsed) === id.trim()` (Plan 08-02 precedent) so `'1abc'` → 400.

## Deviations from Plan

**[Rule 3 — blocking issue] GsdTemplate type widened from `typeof DEFAULT_TEMPLATE`**

- **Found during:** Task 1 GREEN (typecheck)
- **Issue:** Plan spec (line 161) set `export type GsdTemplate = typeof DEFAULT_TEMPLATE`, but TypeScript inferred DEFAULT_TEMPLATE (with `as const`) as a readonly tuple of literal strings ("DISCUSS-01", "Clarify goal, ..."). Returning `gsdTemplateSchema.parse(parsed) as GsdTemplate` failed: parsed Zod output is a mutable array with wider string types, so `as` cast was illegal ("neither type sufficiently overlaps"). Also the fallback `return DEFAULT_TEMPLATE` couldn't satisfy the narrowed tuple shape.
- **Fix:** Changed type to `z.infer<typeof gsdTemplateSchema>`. For DEFAULT_TEMPLATE return sites, used `as unknown as GsdTemplate` (the runtime value satisfies the structural schema; this only crosses the literal↔wide boundary). No behavior change.
- **Files modified:** `src/lib/gsd-templates.ts`
- **Commit:** `f86eb69`

No other deviations — plan Task 2 implementation was verbatim from RESEARCH.md lines 1059-1157.

## Issues Encountered

- **Unrelated test failures in sibling Wave-2 plans:** Initial `pnpm test` run showed 9 failures in `projects-crud-gsd.test.ts` and `transition.test.ts` — these belong to sibling plans 09-02 and 09-04, not 09-03. Filtered verification to `pnpm vitest run src/lib/__tests__/gsd-templates.test.ts src/app/api/projects/__tests__/bootstrap.test.ts` (both files, 24/24 pass). Sibling failures are out-of-scope per the deviation rules (Scope Boundary).
- **Typecheck sometimes surfaces sibling errors, sometimes doesn't:** The global `tsc --noEmit` picked up errors from `src/app/api/projects/__tests__/transition.test.ts` (Plan 09-04's test importing a not-yet-created route) and `src/app/api/tasks/__tests__/gate.test.ts` (Plan 09-05). These cleared on a subsequent run — likely due to tsbuildinfo cache — and exited 0 at final verification. My files (`gsd-templates.ts`, `bootstrap/route.ts`) have zero type errors.

## User Setup Required

None. No new dependencies. The `<MISSION_CONTROL_DATA_DIR>/gsd-templates/` directory is created lazily — it doesn't need to exist for bootstrap to work (DEFAULT_TEMPLATE fallback).

## Next Phase Readiness

Wave 2 can now use:

- `POST /api/projects/:id/gsd/bootstrap` for initial phase-task seeding (called by operators from the UI in Wave 3)
- `loadGsdTemplate(track)` — any future endpoint that needs to iterate the template tree (e.g., validation rules, preview UI) can call this directly
- `DEFAULT_TEMPLATE` as the canonical gate-required task inventory for documentation / onboarding UIs

## Self-Check: PASSED

- [x] `src/lib/gsd-templates.ts` exists (72 lines)
- [x] `src/app/api/projects/[id]/gsd/bootstrap/route.ts` exists (148 lines)
- [x] `src/lib/__tests__/gsd-templates.test.ts` has zero `it.todo` (12 real tests)
- [x] `src/app/api/projects/__tests__/bootstrap.test.ts` has zero `it.todo` (12 real tests, ≥27 expects)
- [x] Commit `b8de0bd` present in `git log` (Task 1 RED)
- [x] Commit `f86eb69` present in `git log` (Task 1 GREEN)
- [x] Commit `5b5972b` present in `git log` (Task 2 RED)
- [x] Commit `361c1cb` present in `git log` (Task 2 GREEN)
- [x] `pnpm vitest run src/lib/__tests__/gsd-templates.test.ts` 12/12 PASS
- [x] `pnpm vitest run src/app/api/projects/__tests__/bootstrap.test.ts` 12/12 PASS
- [x] `pnpm typecheck` EXIT 0
- [x] All 11 Task 1 acceptance grep criteria PASS
- [x] All 13 Task 2 acceptance grep criteria PASS

---
*Phase: 09-gsd-native-integration*
*Completed: 2026-04-14*
