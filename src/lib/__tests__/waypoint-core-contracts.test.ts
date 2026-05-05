import { describe, expect, it } from 'vitest'

describe('waypoint-core contracts export surface', () => {
  it('exports host interface contracts and system ports', async () => {
    const core = await import('@waypoint/core')

    expect(core.WAYPOINT_CORE_PACKAGE).toBe('waypoint-core')
    expect(core).toHaveProperty('WAYPOINT_CORE_PACKAGE')

    // runtime interface modules should be exported once M2.1 is complete
    expect(core).toHaveProperty('WaypointSubjectType')
  })

  it('exports route key helper with stable version normalization', async () => {
    const core = await import('@waypoint/core')

    expect(core).toHaveProperty('buildWaypointRouteKey')
    expect(
      core.buildWaypointRouteKey({
        subjectType: 'waypoint_plan',
        subjectId: 88,
        definitionSlug: 'waypoint-plan-execution',
        definitionVersion: 'v2',
      }),
    ).toBe('waypoint:waypoint_plan:88:waypoint-plan-execution:v2')
  })

  it('exports scope normalization helper with legacy subject compatibility', async () => {
    const core = await import('@waypoint/core')

    expect(core).toHaveProperty('normalizeWaypointScope')
    expect(
      core.normalizeWaypointScope({
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

  it('exports autopilot progress helper', async () => {
    const core = await import('@waypoint/core')

    expect(core).toHaveProperty('hasWaypointAutopilotProgress')
    expect(core.hasWaypointAutopilotProgress({ timerCompleted: [], createdCounts: [0, 0] })).toBe(false)
    expect(core.hasWaypointAutopilotProgress({ timerCompleted: [1], createdCounts: [0, 0] })).toBe(true)
    expect(core.hasWaypointAutopilotProgress({ timerCompleted: [], createdCounts: [0, 2] })).toBe(true)
  })

  it('exports task discussion conversation id helpers', async () => {
    const core = await import('@waypoint/core')

    expect(core).toHaveProperty('slugifyWaypointAgent')
    expect(core).toHaveProperty('buildWaypointTaskDiscussionConversationId')
    expect(core).toHaveProperty('isStrictWaypointTaskDiscussionConversationId')
    expect(core.slugifyWaypointAgent('  GSD Researcher  ')).toBe('gsd-researcher')
    expect(core.buildWaypointTaskDiscussionConversationId(123, 'GSD Researcher')).toBe('task:123:discussion:gsd-researcher')
    expect(core.isStrictWaypointTaskDiscussionConversationId('task:123:discussion:gsd-researcher', 123)).toBe(true)
    expect(core.isStrictWaypointTaskDiscussionConversationId('legacy-conversation-id', 123)).toBe(false)
  })

  it('exports task discussion metadata helpers', async () => {
    const core = await import('@waypoint/core')

    expect(core).toHaveProperty('parseWaypointTaskDiscussionMetadata')
    expect(core).toHaveProperty('mergeWaypointTaskDiscussionMetadata')
    expect(core).toHaveProperty('isWaypointTaskDiscussionEnabled')

    expect(core.parseWaypointTaskDiscussionMetadata('{bad json')).toEqual({ enabled: false })
    expect(core.isWaypointTaskDiscussionEnabled({ waypoint: { discussion: { enabled: true } } })).toBe(true)
    expect(
      core.mergeWaypointTaskDiscussionMetadata(
        { other: true },
        { enabled: true, conversation_id: 'task:5:discussion:agent', status: 'active' },
      ),
    ).toMatchObject({
      other: true,
      waypoint: {
        discussion: {
          enabled: true,
          conversation_id: 'task:5:discussion:agent',
          status: 'active',
          mode: 'agent_chat',
        },
      },
    })
  })
})
