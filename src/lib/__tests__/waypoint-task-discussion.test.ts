import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import {
  buildTaskDiscussionConversationId,
  isTaskDiscussionEnabled,
  listTaskDiscussion,
  mergeTaskDiscussionMetadata,
  parseTaskDiscussionMetadata,
  postTaskDiscussionMessage,
  startTaskDiscussion,
} from '../waypoint-task-discussion'

describe('waypoint task discussion helpers', () => {
  it('builds stable task-scoped conversation ids', () => {
    expect(buildTaskDiscussionConversationId(123, 'GSD Researcher')).toBe('task:123:discussion:gsd-researcher')
  })

  it('detects enabled discussion metadata', () => {
    expect(isTaskDiscussionEnabled({ waypoint: { discussion: { enabled: true } } })).toBe(true)
    expect(isTaskDiscussionEnabled({})).toBe(false)
  })

  it('parses missing or malformed metadata safely', () => {
    expect(parseTaskDiscussionMetadata(null)).toEqual({ enabled: false })
    expect(parseTaskDiscussionMetadata('{bad json')).toEqual({ enabled: false })
  })

  it('merges discussion metadata without dropping other task metadata', () => {
    const merged = mergeTaskDiscussionMetadata({ existing: true }, {
      enabled: true,
      conversation_id: 'task:123:discussion:agent',
      agent: 'agent',
      status: 'active',
    })

    expect(merged).toMatchObject({
      existing: true,
      waypoint: {
        discussion: {
          enabled: true,
          conversation_id: 'task:123:discussion:agent',
          agent: 'agent',
          status: 'active',
        },
      },
    })
  })
})

describe('waypoint task discussion service', () => {
  function setupDb() {
    const db = new Database(':memory:')
    runMigrations(db)
    const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general'`).get() as { id: number }
    const now = 8000
    const taskId = Number(db.prepare(`
      INSERT INTO tasks (title, description, status, priority, project_id, assigned_to, created_by, created_at, updated_at, workspace_id)
      VALUES ('Discuss scope', 'Clarify acceptance criteria', 'inbox', 'medium', ?, 'gsd-doc-drafter', 'tester', ?, ?, 1)
    `).run(project.id, now, now).lastInsertRowid)
    return { db, projectId: project.id, taskId }
  }

  it('starts an idempotent task-scoped discussion and persists metadata', () => {
    const { db, taskId } = setupDb()
    try {
      const first = startTaskDiscussion(db, { taskId, workspaceId: 1, actor: 'tester', now: 9000 })
      const second = startTaskDiscussion(db, { taskId, workspaceId: 1, actor: 'tester', now: 9001 })

      expect(first.discussion).toMatchObject({
        enabled: true,
        conversation_id: `task:${taskId}:discussion:gsd-doc-drafter`,
        agent: 'gsd-doc-drafter',
        status: 'active',
        started_at: 9000,
      })
      expect(second.discussion.conversation_id).toBe(first.discussion.conversation_id)
      expect(second.discussion.started_at).toBe(9000)

      const task = db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(taskId) as { metadata: string }
      expect(JSON.parse(task.metadata)).toMatchObject({
        waypoint: { discussion: { enabled: true, conversation_id: first.discussion.conversation_id } },
      })
    } finally {
      db.close()
    }
  })

  it('rewrites malformed conversation ids to strict task-scoped format', () => {
    const { db, taskId } = setupDb()
    try {
      const raw = JSON.stringify({
        waypoint: {
          discussion: {
            enabled: true,
            mode: 'agent_chat',
            agent: 'GSD Reviewer',
            conversation_id: 'legacy-conversation-id',
            status: 'active',
            started_at: 7000,
          },
        },
      })
      db.prepare('UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ?').run(raw, 8001, taskId)

      const started = startTaskDiscussion(db, { taskId, workspaceId: 1, actor: 'tester', now: 9000 })
      expect(started.discussion.conversation_id).toBe(`task:${taskId}:discussion:gsd-reviewer`)
    } finally {
      db.close()
    }
  })

  it('lists and appends discussion messages using the messages table', () => {
    const { db, taskId, projectId } = setupDb()
    try {
      const started = startTaskDiscussion(db, { taskId, workspaceId: 1, actor: 'tester', now: 9000 })
      const posted = postTaskDiscussionMessage(db, {
        taskId,
        workspaceId: 1,
        from: 'Aaron',
        content: '  Can you clarify the acceptance criteria?  ',
        now: 9002,
      })
      const listed = listTaskDiscussion(db, { taskId, workspaceId: 1 })

      expect(posted.message).toMatchObject({
        conversation_id: started.discussion.conversation_id,
        from_agent: 'Aaron',
        to_agent: 'gsd-doc-drafter',
        content: 'Can you clarify the acceptance criteria?',
      })
      expect(JSON.parse(posted.message.metadata!)).toMatchObject({
        kind: 'waypoint_task_discussion',
        task_id: taskId,
        project_id: projectId,
        waypoint: true,
      })
      expect(listed.messages).toHaveLength(1)
      expect(listed.messages[0].content).toBe('Can you clarify the acceptance criteria?')
    } finally {
      db.close()
    }
  })

  it('rejects posting when discussion is not enabled', () => {
    const { db, taskId } = setupDb()
    try {
      expect(() => postTaskDiscussionMessage(db, {
        taskId,
        workspaceId: 1,
        from: 'Aaron',
        content: 'Hello?',
      })).toThrow(/not enabled/)
    } finally {
      db.close()
    }
  })
})
