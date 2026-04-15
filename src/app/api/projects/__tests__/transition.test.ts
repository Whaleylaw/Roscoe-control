import { describe, it } from 'vitest'

// Wave 1/2 fills these in. Covers: GSD-08, GSD-09, GSD-10, GSD-28.
// POST /api/projects/:id/gsd/transition enforces legal phase progression
// (discuss→plan→execute→verify→done) with structured error codes and
// waiver semantics on execute→verify (D-26).

describe('POST /api/projects/:id/gsd/transition (GSD-08, GSD-09, GSD-10, GSD-28)', () => {
  it.todo('viewer role gets 403')
  it.todo('operator on current=discuss + no done discuss task → 409 code:"DISCUSS_REQUIRES_ONE_DONE" (D-24)')
  it.todo('operator on current=plan + no approved+done plan task → 409 code:"PLAN_REQUIRES_APPROVED_PACKAGE" (D-25)')
  it.todo('operator on current=execute + open execute tasks + no waiver → 409 code:"EXECUTE_TASKS_INCOMPLETE" (D-26)')
  it.todo('operator on current=execute + open execute tasks + waive_remaining:true + reason:"x" → 200 and projects.gsd_phase="verify"')
  it.todo('operator on current=verify + no done verify task → 409 code:"VERIFY_REQUIRES_ONE_DONE" (D-27)')
  it.todo('skip-phase (discuss→execute) → 409 code:"ILLEGAL_TRANSITION" (D-28)')
  it.todo('successful transition UPDATE sets gsd_phase, gsd_updated_at, AND updated_at (Pitfall 4)')
  it.todo('successful transition emits eventBus.broadcast("project.gsd.transition", …) (GSD-28)')
  it.todo('db_helpers.logActivity called with type "project_gsd_transition"')
  it.todo('response body always has {error, code, …} shape')
})
