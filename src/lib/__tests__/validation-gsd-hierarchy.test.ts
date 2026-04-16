import { describe, it, expect } from 'vitest'
import {
  GSD_WORKSTREAM_STATUSES,
  GSD_MILESTONE_STATUSES,
  GSD_PHASE_STATUSES,
  GSD_PLAN_STATUSES,
  gsdWorkstreamStatusSchema,
  gsdMilestoneStatusSchema,
  gsdPhaseStatusSchema,
  gsdPlanStatusSchema,
  gsdDependencyIdsSchema,
  createGsdWorkstreamSchema,
  updateGsdWorkstreamSchema,
  createGsdMilestoneSchema,
  updateGsdMilestoneSchema,
  createGsdPhaseSchema,
  updateGsdPhaseSchema,
  transitionGsdPhaseSchema,
  createGsdPlanSchema,
  updateGsdPlanSchema,
  transitionGsdPlanSchema,
} from '@/lib/validation'

describe('Phase 10 GSD hierarchy enums', () => {
  it('workstream status schema accepts only active/paused/complete', () => {
    for (const v of GSD_WORKSTREAM_STATUSES) expect(gsdWorkstreamStatusSchema.parse(v)).toBe(v)
    expect(() => gsdWorkstreamStatusSchema.parse('archived')).toThrow()
  })

  it('milestone status schema accepts only planned/active/complete/archived', () => {
    for (const v of GSD_MILESTONE_STATUSES) expect(gsdMilestoneStatusSchema.parse(v)).toBe(v)
    expect(() => gsdMilestoneStatusSchema.parse('paused')).toThrow()
  })

  it('phase and plan status schemas reject out-of-model values', () => {
    for (const v of GSD_PHASE_STATUSES) expect(gsdPhaseStatusSchema.parse(v)).toBe(v)
    for (const v of GSD_PLAN_STATUSES) expect(gsdPlanStatusSchema.parse(v)).toBe(v)
    expect(() => gsdPhaseStatusSchema.parse('todo')).toThrow()
    expect(() => gsdPlanStatusSchema.parse('planned')).toThrow()
  })
})

describe('Phase 10 dependency and create/update schemas', () => {
  it('dependency ids default to [] and reject zero/negative ids', () => {
    expect(gsdDependencyIdsSchema.parse(undefined)).toEqual([])
    expect(gsdDependencyIdsSchema.parse([1, 2, 3])).toEqual([1, 2, 3])
    expect(() => gsdDependencyIdsSchema.parse([0])).toThrow()
    expect(() => gsdDependencyIdsSchema.parse([-4])).toThrow()
  })

  it('createGsdWorkstreamSchema defaults status and patch schema requires at least one field', () => {
    const created = createGsdWorkstreamSchema.parse({ key: 'core-platform', name: 'Core Platform' })
    expect(created.status).toBe('active')
    expect(updateGsdWorkstreamSchema.safeParse({}).success).toBe(false)
    expect(updateGsdWorkstreamSchema.safeParse({ name: 'Renamed' }).success).toBe(true)
  })

  it('createGsdMilestoneSchema accepts nullable workstream_id and defaults status', () => {
    const created = createGsdMilestoneSchema.parse({
      workstream_id: null,
      version_label: 'v1.2',
      title: 'Parallel launch',
    })
    expect(created.status).toBe('planned')
    expect(created.workstream_id).toBeNull()
    expect(updateGsdMilestoneSchema.safeParse({}).success).toBe(false)
    expect(updateGsdMilestoneSchema.safeParse({ status: 'active' }).success).toBe(true)
  })

  it('createGsdPhaseSchema enforces kebab-case phase_slug and dependency arrays', () => {
    const created = createGsdPhaseSchema.parse({
      phase_key: '10.1',
      phase_slug: 'stabilization-pass',
      ordering_numeric: 10.1,
      depends_on_phase_ids: [3, 4],
    })
    expect(created.lifecycle_phase).toBe('discuss')
    expect(created.status).toBe('planned')
    expect(created.depends_on_phase_ids).toEqual([3, 4])

    expect(
      createGsdPhaseSchema.safeParse({
        phase_key: '10.2',
        phase_slug: 'Not Kebab',
        ordering_numeric: 10.2,
        depends_on_phase_ids: [],
      }).success
    ).toBe(false)

    expect(updateGsdPhaseSchema.safeParse({}).success).toBe(false)
    expect(updateGsdPhaseSchema.safeParse({ status: 'active' }).success).toBe(true)
  })

  it('createGsdPlanSchema defaults wave/status and patch schema requires at least one field', () => {
    const created = createGsdPlanSchema.parse({
      plan_ref: '10-01',
      title: 'Schema foundation',
      depends_on_plan_ids: [11],
    })
    expect(created.wave).toBe(1)
    expect(created.status).toBe('todo')
    expect(created.depends_on_plan_ids).toEqual([11])

    expect(updateGsdPlanSchema.safeParse({}).success).toBe(false)
    expect(updateGsdPlanSchema.safeParse({ wave: 2 }).success).toBe(true)
  })
})

describe('Phase 10 transition schemas', () => {
  it('transitionGsdPhaseSchema accepts lifecycle target plus optional optimistic lock', () => {
    expect(
      transitionGsdPhaseSchema.parse({
        to_lifecycle_phase: 'plan',
        expected_updated_at: 123,
      })
    ).toEqual({
      to_lifecycle_phase: 'plan',
      expected_updated_at: 123,
    })
    expect(transitionGsdPhaseSchema.safeParse({ to_lifecycle_phase: 'invalid' }).success).toBe(false)
  })

  it('transitionGsdPlanSchema accepts plan status target plus optional optimistic lock', () => {
    expect(
      transitionGsdPlanSchema.parse({
        to_status: 'in_progress',
      })
    ).toEqual({
      to_status: 'in_progress',
    })
    expect(transitionGsdPlanSchema.safeParse({ to_status: 'discuss' }).success).toBe(false)
  })
})
