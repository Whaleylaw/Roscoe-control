import { describe, expect, it } from 'vitest'
import {
  WAYPOINT_SUBJECT_TYPES,
  buildWaypointRouteKey,
  isWaypointSubjectType,
  normalizeWaypointScope,
} from '../waypoint'

describe('waypoint helpers', () => {
  it('defines stable Waypoint subject types', () => {
    expect(WAYPOINT_SUBJECT_TYPES).toEqual({
      project: 'waypoint_project',
      workstream: 'waypoint_workstream',
      milestone: 'waypoint_milestone',
      phase: 'waypoint_phase',
      plan: 'waypoint_plan',
    })
  })

  it('detects Waypoint and compatibility subject types', () => {
    expect(isWaypointSubjectType('waypoint_plan')).toBe(true)
    expect(isWaypointSubjectType('gsd_plan')).toBe(true)
    expect(isWaypointSubjectType('law_firm_case')).toBe(false)
  })

  it('builds stable route keys', () => {
    expect(
      buildWaypointRouteKey({
        subjectType: 'waypoint_plan',
        subjectId: 88,
        definitionSlug: 'waypoint-plan-execution',
        definitionVersion: 1,
      }),
    ).toBe('waypoint:waypoint_plan:88:waypoint-plan-execution:v1')
  })

  it('normalizes plan scope from route vars', () => {
    expect(
      normalizeWaypointScope({
        subjectType: 'waypoint_plan',
        subjectId: '88',
        vars: {
          project_id: 42,
          workstream_id: 7,
          milestone_id: 9,
          phase_id: 12,
          plan_id: 88,
        },
      }),
    ).toEqual({
      projectId: 42,
      workstreamId: 7,
      milestoneId: 9,
      phaseId: 12,
      planId: 88,
    })
  })

  it('falls back to subject id for matching subject type', () => {
    expect(
      normalizeWaypointScope({
        subjectType: 'waypoint_milestone',
        subjectId: '9',
        vars: { project_id: 42 },
      }),
    ).toEqual({
      projectId: 42,
      workstreamId: null,
      milestoneId: 9,
      phaseId: null,
      planId: null,
    })
  })

  it('supports gsd_* subject compatibility aliases', () => {
    expect(
      normalizeWaypointScope({
        subjectType: 'gsd_plan',
        subjectId: '88',
        vars: { project_id: '42', milestone_id: '9', phase_id: '12' },
      }),
    ).toEqual({
      projectId: 42,
      workstreamId: null,
      milestoneId: 9,
      phaseId: 12,
      planId: 88,
    })
  })

  it('rejects non-Waypoint subjects', () => {
    expect(() =>
      normalizeWaypointScope({
        subjectType: 'law_firm_case',
        subjectId: 'case-1',
        vars: {},
      }),
    ).toThrow(/Unsupported Waypoint subject type/)
  })
})
