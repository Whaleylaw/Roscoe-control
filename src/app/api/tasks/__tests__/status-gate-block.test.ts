import { describe, it } from 'vitest'

// Wave 2 fills these in. Covers: GSD-15, GSD-16.
// PUT /api/tasks/:id status transitions are BLOCKED from moving forward
// (in_progress/done) while gate_required=1 and gate_status != "approved".
// Backward/lateral motions (blocked, in_review, backlog) remain allowed
// per D-31. Rejected status behaves same as pending per D-32.

describe('PUT /api/tasks/:id status vs. gate (GSD-15, GSD-16)', () => {
  it.todo('PUT /api/tasks/:id with status="in_progress" on gate_required=1, gate_status="pending" task → 403 code:"GATE_BLOCKED"')
  it.todo('PUT /api/tasks/:id with status="done" on same task → 403 code:"GATE_BLOCKED"')
  it.todo('PUT with status="in_progress" after gate_status="approved" → 200 (GATE unblocks)')
  it.todo('PUT with status="blocked" on gate_required=1, gate_status="pending" → 200 (D-31 — backward motion not gated)')
  it.todo('PUT with status="in_review" on same task → 200 (D-31)')
  it.todo('PUT with status="backlog" on same task → 200 (D-31)')
  it.todo('gate_status="rejected" blocks in_progress same as pending (D-32)')
})
