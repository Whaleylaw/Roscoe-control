import { describe, expect, it } from 'vitest'
import { runWaypointAutopilot } from '../waypoint-autopilot'

describe('runWaypointAutopilot', () => {
  it('stops immediately when a human gate is pending', () => {
    const result = runWaypointAutopilot({} as never, {
      projectId: 42,
      workspaceId: 1,
      actor: 'tester',
      maxIterations: 3,
      deps: {
        getStatus: () => ({
          next_actions: ['Review pending Waypoint gates.'],
          tasks: { waiting_on_gate: [{ id: 1001 }] },
          routes: [],
        }),
        advanceTimers: () => ({ completed: [], materialized: [] }),
        materializeRoute: () => ({ created: [], skipped: [] }),
      },
    })

    expect(result).toEqual({
      iterations: 1,
      changed: false,
      stopReason: 'pending_gate',
      nextActions: ['Review pending Waypoint gates.'],
    })
  })

  it('stops when there is no progress', () => {
    const result = runWaypointAutopilot({} as never, {
      projectId: 42,
      workspaceId: 1,
      actor: 'tester',
      maxIterations: 3,
      deps: {
        getStatus: () => ({
          next_actions: ['Start a Waypoint route for the next lifecycle objective.'],
          tasks: { waiting_on_gate: [] },
          routes: [{ workflow_instance_id: 7001 }],
        }),
        advanceTimers: () => ({ completed: [], materialized: [] }),
        materializeRoute: () => ({ created: [], skipped: [] }),
      },
    })

    expect(result).toEqual({
      iterations: 1,
      changed: false,
      stopReason: 'no_progress',
      nextActions: ['Start a Waypoint route for the next lifecycle objective.'],
    })
  })

  it('stops when a route is blocked', () => {
    const result = runWaypointAutopilot({} as never, {
      projectId: 42,
      workspaceId: 1,
      actor: 'tester',
      maxIterations: 3,
      deps: {
        getStatus: () => ({
          next_actions: ['Resolve blocked Waypoint route.'],
          tasks: { waiting_on_gate: [] },
          routes: [{ workflow_instance_id: 9991, status: 'blocked' }],
        }),
        advanceTimers: () => ({ completed: [], materialized: [] }),
        materializeRoute: () => ({ created: [], skipped: [] }),
      },
    })

    expect(result).toEqual({
      iterations: 1,
      changed: false,
      stopReason: 'blocked',
      nextActions: ['Resolve blocked Waypoint route.'],
    })
  })

  it('stops on budget when progress keeps happening', () => {
    let statusCalls = 0
    const materializedByRoute: number[] = []

    const result = runWaypointAutopilot({} as never, {
      projectId: 42,
      workspaceId: 1,
      actor: 'tester',
      maxIterations: 2,
      deps: {
        getStatus: () => {
          statusCalls += 1
          return {
            next_actions: ['Continue active Waypoint tasks or wait for their completion.'],
            tasks: { waiting_on_gate: [] },
            routes: [
              { workflow_instance_id: 9101 },
              { workflow_instance_id: 9102 },
            ],
          }
        },
        advanceTimers: () => ({ completed: [{ workflow_instance_id: 9101 }], materialized: [] }),
        materializeRoute: (_db, input) => {
          materializedByRoute.push(input.workflowInstanceId)
          return { created: [{ task_id: input.workflowInstanceId }], skipped: [] }
        },
      },
    })

    expect(statusCalls).toBe(2)
    expect(materializedByRoute).toEqual([9101, 9102, 9101, 9102])
    expect(result).toEqual({
      iterations: 2,
      changed: true,
      stopReason: 'max_iterations',
      nextActions: ['Continue active Waypoint tasks or wait for their completion.'],
    })
  })
})
