import { describe, it } from 'vitest'

// Wave 3 fills these in. Covers: GSD-22.
// GateTaskRow renders one gate-required task with an inline
// Approve/Reject control set (operators only) and a keyboard-accessible
// destructive-confirmation flow for rejection.

describe('GateTaskRow (GSD-22)', () => {
  it.todo('operator sees Approve + Reject buttons with aria-label containing ticket_ref')
  it.todo('viewer sees row + status pill but no Approve/Reject buttons')
  it.todo('clicking Reject reveals inline note input + Confirm reject (destructive) + Cancel')
  it.todo('pressing Escape on note input cancels (returns row to initial state)')
})
