import { describe, it } from 'vitest'

// Wave 3 fills these in. Covers: GSD-25.
// GateBadge renders an amber "🔒 Approval required" or green "✓ Approved"
// pill on the task card when gate_required=1. Copy is sourced from
// next-intl translations (project.lifecycle.gate.*), never hard-coded.

describe('GateBadge (GSD-25)', () => {
  it.todo('gate_required=0 → renders nothing')
  it.todo('gate_required=1, gate_status!="approved" → amber badge with "🔒 Approval required"')
  it.todo('gate_required=1, gate_status="approved" → green badge with "✓ Approved"')
  it.todo('uses next-intl translations for the inner copy (not hard-coded)')
})
