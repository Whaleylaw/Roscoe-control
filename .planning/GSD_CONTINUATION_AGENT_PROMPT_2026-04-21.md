# Agent Prompt — Continue GSD Autonomy Finish-Up (Post-P0)

Repo: `/Users/aaronwhaley/Github/mission-control`
Reference baseline: `/Users/aaronwhaley/Downloads/gsd-lawyerinc-main`
Read first:
- `.planning/GSD_PARITY_DIFF_vs_gsd-lawyerinc_2026-04-21.md`
- `.planning/GSD_FINISHUP_PUNCHLIST_2026-04-21.md`

## Mission
Finish the autonomy bridge so routing is automatic and deterministic by project/plan lane, pausing only on explicit blockers requiring owner input.

## Scope (P1 only)

### 1) Lane-aware default auto-routing
Update scheduler routing so it prioritizes lifecycle-ready plan lanes before global legacy inbox scoring.

Target files:
- `src/lib/task-dispatch.ts`
- `src/lib/scheduler.ts` (only if needed)
- tests under `src/lib/__tests__/task-dispatch-autoroute.test.ts` and related scheduler integration tests

Requirements:
- Keep recipe fast-path unchanged.
- For legacy path, prefer inbox tasks linked to active `in_progress` plans (`gsd_plan_id`) and scoped project lanes.
- Preserve backward compatibility fallback for unscoped legacy inbox tasks.
- Add route reason metadata/events for observability.

### 2) Blocker contract parity (legacy + recipe)
Add structured owner-intervention pause/resume to legacy dispatch path so semantics match recipe runner behavior.

Target files:
- `src/lib/task-dispatch.ts`
- `src/lib/task-checkpoints.ts`
- task status route/tests as needed

Requirements:
- Support deterministic `in_progress -> awaiting_owner` with structured blocker fields.
- Support deterministic resume when owner action clears blocker.
- Emit consistent events in both paths.

### 3) MCP create/update routing field parity
Expand MCP schemas/handlers to support lifecycle-linked task creation/updating without raw REST fallback.

Target files:
- `scripts/mc-mcp-server.cjs`
- `docs/cli-agent-control.md`

Required fields (if supported by API):
- `project_id`
- `metadata`
- `gsd_workstream_id`, `gsd_milestone_id`, `gsd_phase_id`, `gsd_plan_id`
- gate fields (`gate_required`, `gate_status`)

## Constraints
- Minimal and reversible changes.
- No unrelated refactors.
- Do not regress non-GSD legacy task routing behavior.

## Verification (must run + include outputs)

```bash
pnpm vitest run src/lib/__tests__/task-dispatch-autoroute.test.ts
pnpm vitest run src/lib/__tests__/phase-15-scheduler-integration.test.ts
pnpm vitest run tests/task-queue.spec.ts
pnpm vitest run src/app/api/gsd/__tests__/phase-plan-routes.test.ts
node scripts/verify-runtime-docs.mjs
```

If native mismatch:

```bash
nvm use 22
pnpm rebuild better-sqlite3
```

## Required return format
1. Summary by scope item (1/2/3)
2. Files changed
3. Verification command outputs (pass/fail)
4. Open risks/deferred items (max 5)
