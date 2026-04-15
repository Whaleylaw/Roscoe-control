## 09-04 deferred observations (out-of-scope for this plan)

- `src/app/api/tasks/__tests__/gate.test.ts:146` — TS2741: requireRole mock return type missing `user` discriminant (introduced by 09-00 wave-0 scaffold + 09-05 RED test). Owner: Plan 09-05.
- `src/lib/gsd-templates.ts:64` — TS2352: runtime-validated template doesn't satisfy `as const` DEFAULT_TEMPLATE literal type. Owner: Plan 09-03 (bootstrap/templates plan).

These do not touch `src/app/api/projects/[id]/gsd/transition/route.ts` and are not caused by 09-04 edits. Both will clear when the owning plans finish implementation.

## 09-06 deferred observations (out-of-scope for this plan)

- `src/components/panels/task-card/__tests__/gate-badge.test.ts` — TS2307 missing module `../gate-badge` + TS2769 NextIntlClientProvider children prop. Introduced by 09-08 RED scaffold (commit edaf776). Owner: Plan 09-08.
- `src/components/project/lifecycle/__tests__/phase-timeline.test.tsx` — TS2307 missing module `@/components/project/lifecycle/phase-timeline`. Introduced by 09-08 RED scaffold (commit edaf776). Owner: Plan 09-08.

These do not touch `src/app/api/tasks/[id]/route.ts` and are not caused by 09-06 edits. Both will clear when Plan 09-08 implements the gate-badge and phase-timeline components.

## 09-09 deferred observations (out-of-scope for this plan)

- `src/components/panels/task-card/__tests__/gate-badge.test.tsx` — TS2769 NextIntlClientProvider children. Owner: Plan 09-08.
- `src/components/project/lifecycle/__tests__/empty-state.test.tsx` — TS2307 missing module. Owner: Plan 09-07.
- `src/components/project/lifecycle/__tests__/gate-task-row.test.tsx` — TS2307 missing module. Owner: Plan 09-07.
- `src/components/project/lifecycle/__tests__/phase-timeline.test.tsx` — TS2307 missing module. Owner: Plan 09-08.

Plan 09-09 touches only `src/components/project/settings-view.tsx` and its test file; these errors pre-exist from sibling parallel plans.

## 09-08 deferred observations (out-of-scope for this plan)

- `src/components/project/lifecycle/__tests__/empty-state.test.tsx` — TS2307 missing module `@/components/project/lifecycle/empty-state`. Owner: Plan 09-07 (lifecycle-view).
- `src/components/project/lifecycle/__tests__/gate-task-row.test.tsx` — TS2307 missing module `@/components/project/lifecycle/gate-task-row`. Owner: Plan 09-07 (lifecycle-view).
- `src/components/project/lifecycle/__tests__/lifecycle-view.test.tsx` — TS2307 missing module `@/components/project/lifecycle/lifecycle-view`. Owner: Plan 09-07 (lifecycle-view).

Plan 09-08 scope per frontmatter is strictly `src/components/panels/task-card/**` + `src/components/panels/task-board-panel.tsx`. Earlier deferred-item notes referenced 09-08 as the phase-timeline owner — `phase-timeline.tsx` is actually already created in `src/components/project/lifecycle/` (Plan 09-07 territory). Task-card test files renamed `.test.ts` → `.test.tsx` to enable JSX; the two NextIntlClientProvider / gate-badge errors in 09-06/09-09's notes are now resolved by this plan's implementation.

## 09-10 deferred observations (out-of-scope for this plan)

After Plan 09-10 unblocked the e2e pipeline (static-asset copy + login rate-limit fixes), 7 pre-existing Playwright tests still fail. None are caused by Phase 9 code changes and none touch Phase 9 subsystems; they surface now only because the Phase 9 infra fix let the suite progress far enough to reach them. Logged here so a follow-up plan can address them without re-discovering root cause.

**Modal interaction failures (4)** — Owner: Phase 04 (`task-board`)
- `tests/project-tasks.spec.ts:113` — TASK-02 submit CreateTaskModal: POST /api/tasks is never captured by `page.route(...)`. Likely a modal-submission race — `page.getByRole('button', { name: /^create$/i }).click()` resolves before the POST fires, or the route handler isn't attached in time.
- `tests/project-tasks.spec.ts:141` — TASK-02 new task appears on board: the new card never appears, suggesting the create POST isn't issued or the re-fetch doesn't surface it.
- `tests/project-tasks.spec.ts:178` — TASK-03 EditTaskModal PUT: similar — captured method is null.
- `tests/project-tasks.spec.ts:205` — TASK-03 reassign-out cleanup (pitfall #5): depends on 178 succeeding.

**Workload recommendation seed-data failures (3)** — Owner: Phase 05 or later (`workload-signals`)
- `tests/workload-signals.spec.ts:32` — `throttle` expected, got `normal`. Seeded test-state (leftover idle agents from prior tests within the same server run) shifts the busy_ratio below the throttle threshold.
- `tests/workload-signals.spec.ts:48` — same class of failure (`shed` expected, `normal` actual).
- `tests/workload-signals.spec.ts:64` — `pause` expected when 0 agents online, but there are 9 leftover online agents. The afterEach deletes the agents it created but earlier tests within the same server lifetime may have leaked.

Both buckets predate Phase 9 and require their owning phases' test harnesses to evolve — either reset-between-specs hooks or per-spec agent-name isolation. Phase 9 touches none of the surfaces these specs exercise.

