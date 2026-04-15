import { describe, it } from 'vitest'

// Wave 1 fills these in. Covers: GSD-03, GSD-14.
// Zod schemas: gsdPhaseSchema, gsdTrackSchema, gsdGateModeSchema,
// transitionSchema, taskGatePatchSchema, gsdTemplateSchema.

describe('GSD validation schemas (GSD-03, GSD-14)', () => {
  it.todo('gsdPhaseSchema accepts discuss/plan/execute/verify/done; rejects "foo"')
  it.todo('gsdTrackSchema accepts ops/product/marketing/legal/firmvault/custom; rejects "wrong"')
  it.todo('gsdGateModeSchema accepts manual_approval/auto_internal')
  it.todo('transitionSchema rejects waive_remaining=true without non-empty reason (refine path ["reason"])')
  it.todo('taskGatePatchSchema rejects gate_status="pending" (only approved|rejected allowed)')
  it.todo('gsdTemplateSchema rejects entry with ticket_ref "abc" (regex mismatch)')
})
