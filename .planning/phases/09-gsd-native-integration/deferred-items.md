## 09-04 deferred observations (out-of-scope for this plan)

- `src/app/api/tasks/__tests__/gate.test.ts:146` — TS2741: requireRole mock return type missing `user` discriminant (introduced by 09-00 wave-0 scaffold + 09-05 RED test). Owner: Plan 09-05.
- `src/lib/gsd-templates.ts:64` — TS2352: runtime-validated template doesn't satisfy `as const` DEFAULT_TEMPLATE literal type. Owner: Plan 09-03 (bootstrap/templates plan).

These do not touch `src/app/api/projects/[id]/gsd/transition/route.ts` and are not caused by 09-04 edits. Both will clear when the owning plans finish implementation.
