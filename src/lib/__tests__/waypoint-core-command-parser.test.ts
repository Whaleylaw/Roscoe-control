import { describe, expect, it } from 'vitest'
import { parseWaypointCommand } from '../../../packages/waypoint-core/src/commands/parser'

describe('waypoint-core command parser', () => {
  it('parses auto status pagination with offset zero', () => {
    expect(parseWaypointCommand('/waypoint auto status --limit 25 --offset 0')).toEqual({
      name: 'auto_status',
      limit: 25,
      offset: 0,
    })
  })
})
