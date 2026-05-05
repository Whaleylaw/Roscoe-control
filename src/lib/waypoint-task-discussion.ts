import type Database from 'better-sqlite3'
import {
  buildWaypointTaskDiscussionConversationId,
  isWaypointTaskDiscussionEnabled,
  mergeWaypointTaskDiscussionMetadata,
  parseWaypointJsonObject,
  parseWaypointTaskDiscussionMetadata,
  buildWaypointTaskDiscussionMessageMetadata,
  resolveWaypointTaskDiscussionStatus,
  resolveWaypointTaskDiscussionAgent,
  normalizeWaypointTaskDiscussionListLimit,
  normalizeWaypointTaskDiscussionMessageContent,
  buildWaypointTaskDiscussionStartMetadata,
  slugifyWaypointAgent,
  type WaypointTaskDiscussionAutoResponseMetadata,
  type WaypointTaskDiscussionMetadata,
  type WaypointTaskDiscussionStatus,
} from '@waypoint/core'
import type { Message, Task } from '@/lib/db'

export type {
  WaypointTaskDiscussionStatus,
  WaypointTaskDiscussionAutoResponseMetadata,
  WaypointTaskDiscussionMetadata,
}

type TaskDiscussionInput = {
  taskId: number
  workspaceId: number
  actor: string
  agent?: string | null
  now?: number
}

type TaskDiscussionMessageInput = {
  taskId: number
  workspaceId: number
  from: string
  content: string
  to?: string | null
  now?: number
}

type TaskDiscussionListInput = {
  taskId: number
  workspaceId: number
  limit?: number
}

export function slugifyAgent(value: string | null | undefined): string {
  return slugifyWaypointAgent(value)
}

export function buildTaskDiscussionConversationId(taskId: number, agent: string | null | undefined): string {
  return buildWaypointTaskDiscussionConversationId(taskId, agent)
}

export function parseJsonObject(raw: unknown): Record<string, unknown> {
  return parseWaypointJsonObject(raw)
}

export function parseTaskDiscussionMetadata(raw: unknown): WaypointTaskDiscussionMetadata {
  return parseWaypointTaskDiscussionMetadata(raw)
}

export function isTaskDiscussionEnabled(raw: unknown): boolean {
  return isWaypointTaskDiscussionEnabled(raw)
}

export function mergeTaskDiscussionMetadata(
  raw: unknown,
  discussion: Omit<WaypointTaskDiscussionMetadata, 'mode'> & { mode?: 'agent_chat' },
): Record<string, unknown> {
  return mergeWaypointTaskDiscussionMetadata(raw, discussion)
}

function requireTask(db: Database.Database, taskId: number, workspaceId: number): Task {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(taskId, workspaceId) as Task | undefined
  if (!task) throw new Error(`Task ${taskId} not found`)
  return task
}

export function startTaskDiscussion(
  db: Database.Database,
  input: TaskDiscussionInput,
): { task: Task; discussion: WaypointTaskDiscussionMetadata } {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const task = requireTask(db, input.taskId, input.workspaceId)
  const existing = parseTaskDiscussionMetadata(task.metadata)
  const agent = resolveWaypointTaskDiscussionAgent({
    requestedAgent: input.agent,
    existingAgent: existing.agent,
    assignedTo: task.assigned_to,
  })
  const discussion: WaypointTaskDiscussionMetadata = buildWaypointTaskDiscussionStartMetadata({
    taskId: task.id,
    now,
    agent,
    existing,
  })
  const metadata = mergeTaskDiscussionMetadata(task.metadata, discussion)
  db.prepare('UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .run(JSON.stringify(metadata), now, task.id, input.workspaceId)
  const updatedTask = requireTask(db, input.taskId, input.workspaceId)
  return { task: updatedTask, discussion }
}

export function listTaskDiscussion(
  db: Database.Database,
  input: TaskDiscussionListInput,
): { task: Task; discussion: WaypointTaskDiscussionMetadata; messages: Message[] } {
  const task = requireTask(db, input.taskId, input.workspaceId)
  const discussion = parseTaskDiscussionMetadata(task.metadata)
  if (!discussion.enabled || !discussion.conversation_id) {
    return { task, discussion: { ...discussion, enabled: false }, messages: [] }
  }
  const limit = normalizeWaypointTaskDiscussionListLimit(input.limit)
  const messages = db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ? AND workspace_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(discussion.conversation_id, input.workspaceId, limit) as Message[]
  return { task, discussion, messages }
}

export function postTaskDiscussionMessage(
  db: Database.Database,
  input: TaskDiscussionMessageInput,
): { task: Task; discussion: WaypointTaskDiscussionMetadata; message: Message } {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const task = requireTask(db, input.taskId, input.workspaceId)
  const discussion = parseTaskDiscussionMetadata(task.metadata)
  if (!discussion.enabled || !discussion.conversation_id) {
    throw new Error(`Waypoint discussion is not enabled for task ${input.taskId}`)
  }
  const content = normalizeWaypointTaskDiscussionMessageContent(input.content)
  if (!content) throw new Error('Discussion message content is required')

  const metadata = buildWaypointTaskDiscussionMessageMetadata({
    id: task.id,
    title: task.title,
    project_id: task.project_id ?? null,
    metadata: task.metadata,
  })
  const result = db.prepare(`
    INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, read_at, created_at, workspace_id)
    VALUES (?, ?, ?, ?, 'text', ?, NULL, ?, ?)
  `).run(
    discussion.conversation_id,
    input.from,
    input.to ?? discussion.agent ?? null,
    content,
    JSON.stringify(metadata),
    now,
    input.workspaceId,
  )
  const message = db.prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
    .get(result.lastInsertRowid, input.workspaceId) as Message
  return { task, discussion, message }
}

