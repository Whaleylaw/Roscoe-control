import { describe, expect, it } from 'vitest'
import { parseWaypointCommand } from '../waypoint-command'

describe('waypoint command parser', () => {
  it('parses status with and without prefix', () => {
    expect(parseWaypointCommand('/waypoint status')).toEqual({ name: 'status' })
    expect(parseWaypointCommand('wp status')).toEqual({ name: 'status' })
  })

  it('parses help by default when empty', () => {
    expect(parseWaypointCommand('/waypoint')).toEqual({ name: 'help' })
    expect(parseWaypointCommand('')).toEqual({ name: 'help' })
  })

  it('parses start plan with defaults', () => {
    expect(parseWaypointCommand('/waypoint start plan --plan-id 88')).toEqual({
      name: 'start',
      target: 'plan',
      planId: 88,
      definitionSlug: 'waypoint-plan-execution',
      definitionVersion: 1,
    })
  })

  it('parses start plan with explicit definition/version', () => {
    expect(
      parseWaypointCommand('/waypoint start plan --plan-id 88 --definition waypoint-project-intake --version 2'),
    ).toEqual({
      name: 'start',
      target: 'plan',
      planId: 88,
      definitionSlug: 'waypoint-project-intake',
      definitionVersion: 2,
    })
  })

  it('parses auto with optional max iterations', () => {
    expect(parseWaypointCommand('/waypoint auto')).toEqual({ name: 'auto' })
    expect(parseWaypointCommand('/waypoint auto --max-iterations 5')).toEqual({
      name: 'auto',
      maxIterations: 5,
    })
  })

  it('parses discuss with and without message', () => {
    expect(parseWaypointCommand('/waypoint discuss --task-id 42')).toEqual({ name: 'discuss', taskId: 42 })
    expect(parseWaypointCommand('/waypoint discuss --task-id 42 --message hello there')).toEqual({
      name: 'discuss',
      taskId: 42,
      message: 'hello there',
    })
  })

  it('parses routes/pause/resume commands', () => {
    expect(parseWaypointCommand('/waypoint routes')).toEqual({ name: 'routes' })
    expect(parseWaypointCommand('/waypoint routes --status blocked')).toEqual({ name: 'routes', status: 'blocked' })
    expect(parseWaypointCommand('/waypoint pause --route-id 19')).toEqual({ name: 'pause', routeId: 19 })
    expect(parseWaypointCommand('/waypoint resume --route-id 19')).toEqual({ name: 'resume', routeId: 19 })
  })

  it('parses doctor and forensics with defaults and overrides', () => {
    expect(parseWaypointCommand('/waypoint doctor')).toEqual({
      name: 'doctor',
      definitionSlug: 'waypoint-doctor',
      definitionVersion: 1,
    })
    expect(parseWaypointCommand('/waypoint forensics --definition waypoint-forensics-custom --version 2')).toEqual({
      name: 'forensics',
      definitionSlug: 'waypoint-forensics-custom',
      definitionVersion: 2,
    })
  })

  it('rejects invalid commands and malformed flags', () => {
    expect(() => parseWaypointCommand('/waypoint nonsense')).toThrow(/Unknown Waypoint command/)
    expect(() => parseWaypointCommand('/waypoint start plan')).toThrow(/--plan-id/)
    expect(() => parseWaypointCommand('/waypoint auto --max-iterations nope')).toThrow(/max-iterations/)
    expect(() => parseWaypointCommand('/waypoint discuss --task-id nope')).toThrow(/--task-id/)
  })
})
