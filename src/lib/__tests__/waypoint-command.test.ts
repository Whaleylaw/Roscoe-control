import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import { executeWaypointCommand, parseWaypointCommand } from '../waypoint-command'

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

  it('parses auto status with optional pagination', () => {
    expect(parseWaypointCommand('/waypoint auto status')).toEqual({ name: 'auto_status' })
    expect(parseWaypointCommand('/waypoint auto status --limit 15 --offset 3')).toEqual({
      name: 'auto_status',
      limit: 15,
      offset: 3,
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

  it('parses routes/route/route-events/pause/resume commands', () => {
    expect(parseWaypointCommand('/waypoint routes')).toEqual({ name: 'routes' })
    expect(parseWaypointCommand('/waypoint routes --status blocked')).toEqual({ name: 'routes', status: 'blocked' })
    expect(parseWaypointCommand('/waypoint routes --status active --limit 20 --offset 5')).toEqual({
      name: 'routes',
      status: 'active',
      limit: 20,
      offset: 5,
    })
    expect(parseWaypointCommand('/waypoint route --route-id 19')).toEqual({ name: 'route', routeId: 19 })
    expect(parseWaypointCommand('/waypoint route --id 19')).toEqual({ name: 'route', routeId: 19 })
    expect(parseWaypointCommand('/waypoint route-events --route-id 19')).toEqual({
      name: 'route_events',
      routeId: 19,
    })
    expect(parseWaypointCommand('/waypoint events --id 19 --limit 10 --offset 2')).toEqual({
      name: 'route_events',
      routeId: 19,
      limit: 10,
      offset: 2,
    })
    expect(parseWaypointCommand('/waypoint pause --route-id 19')).toEqual({ name: 'pause', routeId: 19 })
    expect(parseWaypointCommand('/waypoint resume --route-id 19')).toEqual({ name: 'resume', routeId: 19 })
    expect(parseWaypointCommand('/waypoint gate --route-id 19 --node quality_gate --approve')).toEqual({
      name: 'gate',
      routeId: 19,
      nodeKey: 'quality_gate',
      decision: 'approve',
    })
    expect(parseWaypointCommand('/waypoint gate --route-id 19 --node quality_gate --reject --note needs changes')).toEqual({
      name: 'gate',
      routeId: 19,
      nodeKey: 'quality_gate',
      decision: 'reject',
      note: 'needs changes',
    })
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

describe('waypoint command execution envelope', () => {
  it('returns consistent ok/command/action envelope for help', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const result = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: 1,
        actor: 'tester',
        rawCommand: '/waypoint help',
      })

      expect(result).toMatchObject({ ok: true, action: 'help', command: { name: 'help' } })
      expect(result).toHaveProperty('message')
    } finally {
      db.close()
    }
  })

  it('returns consistent ok/command/action envelope for status', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general' LIMIT 1`).get() as
        | { id: number }
        | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      const result = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: '/waypoint status',
      })

      expect(result).toMatchObject({ ok: true, action: 'status', command: { name: 'status' } })
      expect(result).toHaveProperty('status.project.id', project!.id)
    } finally {
      db.close()
    }
  })

  it('returns consistent ok/command/action envelope for auto status', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general' LIMIT 1`).get() as
        | { id: number }
        | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      const result = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: '/waypoint auto status --limit 5 --offset 0',
      })

      expect(result).toMatchObject({
        ok: true,
        action: 'auto_status',
        command: { name: 'auto_status', limit: 5, offset: 0 },
      })
      expect(result).toHaveProperty('runs')
      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('pagination', { limit: 5, offset: 0 })
    } finally {
      db.close()
    }
  })

  it('returns consistent ok/command/action envelope for routes pagination', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general' LIMIT 1`).get() as
        | { id: number }
        | undefined
      expect(project).toBeTruthy()
      db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project!.id)

      const result = executeWaypointCommand({
        db,
        workspaceId: 1,
        tenantId: 1,
        projectId: project!.id,
        actor: 'tester',
        rawCommand: '/waypoint routes --limit 10 --offset 0',
      })

      expect(result).toMatchObject({
        ok: true,
        action: 'routes',
        command: { name: 'routes', limit: 10, offset: 0 },
      })
      expect(result).toHaveProperty('routes')
      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('pagination', { limit: 10, offset: 0 })
    } finally {
      db.close()
    }
  })
})
