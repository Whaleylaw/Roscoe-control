import { describe, it } from 'vitest'

// Wave 2 fills these in. Covers: GSD-04, GSD-13.
// GET /api/tasks and GET /api/tasks/:id include gsd_phase +
// gate_* fields so the task board + task card can render phase
// and gate badges without extra round-trips.

describe('GET /api/tasks — gsd fields (GSD-04, GSD-13)', () => {
  it.todo('GET /api/tasks returns gsd_phase, gate_required, gate_status, gate_approved_by, gate_approved_at on each task')
  it.todo('GET /api/tasks/:id returns the same')
  it.todo('non-GSD tasks (gsd_phase=null, gate_required=0) render fields with expected defaults')
})
