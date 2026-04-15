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

