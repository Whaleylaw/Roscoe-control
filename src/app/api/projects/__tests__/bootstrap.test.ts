import { describe, it } from 'vitest'

// Wave 1/2 fills these in. Covers: GSD-07, GSD-11 (role), GSD-17, GSD-19.
// POST /api/projects/:id/gsd/bootstrap creates the default phase-task
// pack from the track template (or DEFAULT_TEMPLATE on soft-miss) and
// is idempotent on re-run.
//
// Template contract:
//   DISCUSS-01, DISCUSS-02, PLAN-01, PLAN-02,
//   EXEC-01, EXEC-02, VERIFY-01, VERIFY-02 (8 total)

describe('POST /api/projects/:id/gsd/bootstrap (GSD-07, GSD-11, GSD-17, GSD-19)', () => {
  it.todo('viewer role gets 403')
  it.todo('operator role gets 200 and creates 8 tasks on first run (DISCUSS-01/02 + PLAN-01/02 + EXEC-01/02 + VERIFY-01/02)')
  it.todo('created tasks carry gsd_phase, gate_required, gate_status="pending" when gate_required=1 else "not_required"')
  it.todo('task.metadata.gsd_ticket_ref stores logical ref (e.g., "DISCUSS-01")')
  it.todo('bumps projects.ticket_counter once per created task')
  it.todo('re-running bootstrap on same project returns created:0, skipped:8 — task count unchanged (GSD-19)')
  it.todo('bootstrap with gsd_track="ops" and no ops.json file on disk falls back to DEFAULT_TEMPLATE (GSD-17)')
  it.todo('eventBus.broadcast("task.created", …) called once per created task')
  it.todo('returns 404 PROJECT_NOT_FOUND for missing project')
})
