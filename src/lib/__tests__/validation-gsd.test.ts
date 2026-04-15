import { describe, it, expect } from 'vitest'
import {
  gsdPhaseSchema,
  gsdTrackSchema,
  gsdGateModeSchema,
  gsdGateStatusSchema,
  transitionSchema,
  taskGatePatchSchema,
  gsdTemplateSchema,
  GSD_PHASES,
  GSD_TRACKS,
  GSD_GATE_MODES,
  GSD_GATE_STATUSES,
} from '@/lib/validation'

// Wave 1 fills these in. Covers: GSD-03, GSD-14.
// Zod schemas: gsdPhaseSchema, gsdTrackSchema, gsdGateModeSchema,
// transitionSchema, taskGatePatchSchema, gsdTemplateSchema.

describe('GSD validation schemas (GSD-03, GSD-14)', () => {
  it('gsdPhaseSchema accepts discuss/plan/execute/verify/done; rejects "foo"', () => {
    for (const v of GSD_PHASES) expect(gsdPhaseSchema.parse(v)).toBe(v)
    expect(() => gsdPhaseSchema.parse('foo')).toThrow()
    expect(() => gsdPhaseSchema.parse('')).toThrow()
    expect(() => gsdPhaseSchema.parse(null)).toThrow()
  })

  it('gsdTrackSchema accepts ops/product/marketing/legal/firmvault/custom; rejects "wrong"', () => {
    for (const v of GSD_TRACKS) expect(gsdTrackSchema.parse(v)).toBe(v)
    expect(() => gsdTrackSchema.parse('wrong')).toThrow()
    expect(() => gsdTrackSchema.parse('ops_extra')).toThrow()
  })

  it('gsdGateModeSchema accepts manual_approval/auto_internal only', () => {
    for (const v of GSD_GATE_MODES) expect(gsdGateModeSchema.parse(v)).toBe(v)
    expect(() => gsdGateModeSchema.parse('auto')).toThrow()
    expect(() => gsdGateModeSchema.parse('manual')).toThrow()
  })

  it('gsdGateStatusSchema accepts not_required/pending/approved/rejected', () => {
    for (const v of GSD_GATE_STATUSES) expect(gsdGateStatusSchema.parse(v)).toBe(v)
    expect(() => gsdGateStatusSchema.parse('blocked')).toThrow()
  })
})

describe('transitionSchema waiver validation (GSD-10)', () => {
  it('accepts simple { to_phase } without waiver', () => {
    const r = transitionSchema.safeParse({ to_phase: 'plan' })
    expect(r.success).toBe(true)
  })

  it('rejects waive_remaining=true without non-empty reason (refine path ["reason"])', () => {
    const result = transitionSchema.safeParse({ to_phase: 'verify', waive_remaining: true })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['reason'])
    }
  })

  it('rejects waive_remaining=true with whitespace-only reason', () => {
    const result = transitionSchema.safeParse({ to_phase: 'verify', waive_remaining: true, reason: '   ' })
    expect(result.success).toBe(false)
  })

  it('accepts waive_remaining=true with non-empty reason', () => {
    const result = transitionSchema.safeParse({
      to_phase: 'verify',
      waive_remaining: true,
      reason: 'partial ship — last task deferred to next milestone',
    })
    expect(result.success).toBe(true)
  })
})

describe('taskGatePatchSchema (GSD-11, D-09)', () => {
  it('accepts gate_status approved with optional note', () => {
    expect(taskGatePatchSchema.safeParse({ gate_status: 'approved' }).success).toBe(true)
    expect(taskGatePatchSchema.safeParse({ gate_status: 'approved', note: 'lgtm' }).success).toBe(true)
  })

  it('accepts gate_status rejected', () => {
    expect(taskGatePatchSchema.safeParse({ gate_status: 'rejected', note: 'needs more work' }).success).toBe(true)
  })

  it('rejects gate_status="pending" (only approved|rejected allowed)', () => {
    const r = taskGatePatchSchema.safeParse({ gate_status: 'pending' })
    expect(r.success).toBe(false)
  })

  it('rejects gate_status="not_required" and "blocked"', () => {
    expect(taskGatePatchSchema.safeParse({ gate_status: 'not_required' }).success).toBe(false)
    expect(taskGatePatchSchema.safeParse({ gate_status: 'blocked' }).success).toBe(false)
  })
})

describe('gsdTemplateSchema (D-17)', () => {
  const validTemplate = {
    name: 'default',
    phases: {
      discuss: [{ ticket_ref: 'AUTH-01', title: 'Decide auth strategy', gate_required: 0 }],
      plan: [{ ticket_ref: 'AUTH-02', title: 'Write plan', gate_required: 0 }],
      execute: [{ ticket_ref: 'AUTH-03', title: 'Implement', gate_required: 1 }],
      verify: [{ ticket_ref: 'AUTH-04', title: 'Test', gate_required: 0 }],
    },
  }

  it('parses valid template shape', () => {
    const r = gsdTemplateSchema.safeParse(validTemplate)
    expect(r.success).toBe(true)
  })

  it('rejects entry with ticket_ref "abc123" (regex requires PREFIX-NN)', () => {
    const bad = {
      ...validTemplate,
      phases: { ...validTemplate.phases, discuss: [{ ticket_ref: 'abc123', title: 'x', gate_required: 0 }] },
    }
    const r = gsdTemplateSchema.safeParse(bad)
    expect(r.success).toBe(false)
  })

  it('rejects entry with ticket_ref "abc" (regex mismatch)', () => {
    const bad = {
      ...validTemplate,
      phases: { ...validTemplate.phases, plan: [{ ticket_ref: 'abc', title: 'x', gate_required: 0 }] },
    }
    expect(gsdTemplateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects template missing one of the four phase keys', () => {
    const { plan: _plan, ...rest } = validTemplate.phases
    const bad = { ...validTemplate, phases: rest as typeof validTemplate.phases }
    expect(gsdTemplateSchema.safeParse(bad).success).toBe(false)
  })
})
