import { describe, it } from 'vitest'

// Wave 2 fills these in. Covers: GSD-05, GSD-11, GSD-28.
// PATCH /api/tasks/:id/gate records gate_status transitions by
// operator users, stamps approver + timestamp, broadcasts events.

describe('PATCH /api/tasks/:id/gate (GSD-05, GSD-11, GSD-28)', () => {
  it.todo('viewer role gets 403')
  it.todo('operator PATCH gate_status="approved" records gate_approved_by=auth.user.username, gate_approved_at=unixepoch()')
  it.todo('operator PATCH gate_status="rejected" records approver + timestamp')
  it.todo('gate_status not in [approved,rejected] → 400')
  it.todo('task has gate_required=0 → 400 code:"NO_GATE"')
  it.todo('task not found → 404 code:"TASK_NOT_FOUND"')
  it.todo('successful PATCH emits eventBus.broadcast("task.gate.changed", …) AND eventBus.broadcast("task.updated", …) (Pitfall 6)')
  it.todo('db_helpers.logActivity called with type "task_gate_changed"')
})
