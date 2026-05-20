# Handoff Prompt — Finish GSD Queue/Blocker Automation

Repository: `/Users/aaronwhaley/Github/mission-control`
Read first: `.planning/GSD_FINISHUP_PUNCHLIST_2026-04-21.md`

## Mission
Implement the remaining bridge so Mission Control behaves like autonomous GSD execution:

- project/plan-scoped queue routing
- automatic plan->task queue activation
- blocker pause/resume parity (not just recipe-runner path)

Do this with minimal, reversible changes and no regressions.

## Required deliverables

1. **P0.1 queue scoping**
   - Add optional `project_id` and `gsd_plan_id` support to `GET /api/tasks/queue`
   - Wire through OpenAPI, CLI, MCP wrappers
   - Add/adjust tests

2. **P0.2 plan transition activation**
   - On `POST /api/gsd/plans/:id/transition` to `in_progress`, activate linked tasks (`gsd_plan_id`) into queue-ready state
   - Emit event with activation count
   - Add tests

3. **P0.3 blocker parity**
   - Add structured blocker transition support for non-recipe dispatch path
   - Ensure `in_progress -> awaiting_owner -> resume` is deterministic and reasoned
   - Add tests

4. **P1 docs cleanup**
   - Resolve contradictions in `docs/GSD-MODEL-COMPARISON.md`
   - Fix runtime doc links in `docs/runtime/INDEX.md`
   - Ensure `node scripts/verify-runtime-docs.mjs` passes

5. **P1 MCP task schema parity**
   - Expand `mc_create_task` / `mc_update_task` schemas to include project + GSD linkage fields supported by API

## Constraints

- No unrelated refactors.
- Preserve backward compatibility when new queue filters are omitted.
- Keep existing scheduler behavior unless required for P0 goals.
- Prefer additive changes.

## Verification checklist (must run and report)

```bash
pnpm test tests/task-queue.spec.ts
pnpm test src/app/api/gsd/__tests__/phase-plan-routes.test.ts
pnpm test src/lib/__tests__/gsd-conflicts.test.ts
node scripts/verify-runtime-docs.mjs
```

If node-native mismatch occurs:

```bash
nvm use 22
pnpm rebuild better-sqlite3
```

## Output format

Return exactly:

1. Summary of implemented deltas (by P0/P1 item)
2. Files changed
3. Test/verification command outputs (pass/fail)
4. Any open risks or deferred items (max 5)
