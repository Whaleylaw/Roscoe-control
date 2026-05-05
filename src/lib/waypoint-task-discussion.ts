import type Database from 'better-sqlite3'
import {
  buildWaypointTaskDiscussionConversationId,
  slugifyWaypointAgent,
} from '@waypoint/core'
import type { Message, Task } from '@/lib/db'

export type WaypointTaskDiscussionStatus = 'pending' | 'active' | 'summarized' | 'closed'

export type WaypointTaskDiscussionAutoResponseMetadata = {
  enabled: boolean
}

export type WaypointTaskDiscussionMetadata = {
  enabled: boolean
  mode?: 'agent_chat'
  conversation_id?: string
  agent?: string
  prompt?: string
  started_at?: number
  status?: WaypointTaskDiscussionStatus
  summary_comment_id?: number | null
  auto_response?: WaypointTaskDiscussionAutoResponseMetadata
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

function isStrictTaskDiscussionConversationId(value: unknown, taskId: number): value is string {
  if (typeof value !== 'string') return false
  return value.startsWith(`task:${taskId}:discussion:`) && value.length > `task:${taskId}:discussion:`.length
}

export function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function parseStatus(value: unknown): WaypointTaskDiscussionStatus | undefined {
  return ['pending', 'active', 'summarized', 'closed'].includes(String(value))
    ? value as WaypointTaskDiscussionStatus
    : undefined
}

export function parseTaskDiscussionMetadata(raw: unknown): WaypointTaskDiscussionMetadata {
  const metadata = parseJsonObject(raw)
  const waypoint = parseJsonObject(metadata.waypoint)
  const discussion = parseJsonObject(waypoint.discussion)
  if (Object.keys(discussion).length === 0) return { enabled: false }
  const autoResponse = parseJsonObject(discussion.auto_response)
  return {
    enabled: discussion.enabled === true,
    mode: discussion.mode === 'agent_chat' ? 'agent_chat' : undefined,
    conversation_id: typeof discussion.conversation_id === 'string' ? discussion.conversation_id : undefined,
    agent: typeof discussion.agent === 'string' ? discussion.agent : undefined,
    prompt: typeof discussion.prompt === 'string' ? discussion.prompt : undefined,
    started_at: typeof discussion.started_at === 'number' ? discussion.started_at : undefined,
    status: parseStatus(discussion.status),
    summary_comment_id: typeof discussion.summary_comment_id === 'number' ? discussion.summary_comment_id : null,
    auto_response: autoResponse.enabled === true ? { enabled: true } : undefined,
  }
}

export function isTaskDiscussionEnabled(raw: unknown): boolean {
  return parseTaskDiscussionMetadata(raw).enabled
}

export function mergeTaskDiscussionMetadata(
  raw: unknown,
  discussion: Omit<WaypointTaskDiscussionMetadata, 'mode'> & { mode?: 'agent_chat' },
): Record<string, unknown> {
  const metadata = parseJsonObject(raw)
  const waypoint = parseJsonObject(metadata.waypoint)
  const existingDiscussion = parseJsonObject(waypoint.discussion)
  return {
    ...metadata,
    waypoint: {
      ...waypoint,
      discussion: {
        ...existingDiscussion,
        mode: 'agent_chat',
        ...discussion,
      },
    },
  }
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
  const agent = input.agent?.trim() || existing.agent || task.assigned_to || 'agent'
  const conversationId = isStrictTaskDiscussionConversationId(existing.conversation_id, task.id)
    ? existing.conversation_id
    : buildTaskDiscussionConversationId(task.id, agent)

  const discussion: WaypointTaskDiscussionMetadata = {
    ...existing,
    enabled: true,
    mode: 'agent_chat',
    conversation_id: conversationId,
    agent,
    started_at: existing.started_at ?? now,
    status: existing.status === 'closed' || existing.status === 'summarized' ? existing.status : 'active',
    summary_comment_id: existing.summary_comment_id ?? null,
  }
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
  const limit = Math.max(1, Math.min(input.limit ?? 100, 200))
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
  const content = input.content.trim()
  if (!content) throw new Error('Discussion message content is required')

  const metadata = {
    kind: 'waypoint_task_discussion',
    task_id: task.id,
    task_title: task.title,
    project_id: task.project_id ?? null,
    workflow_instance_id: parseWorkflowMetadataNumber(task.metadata, 'workflow_instance_id'),
    workflow_node_instance_id: parseWorkflowMetadataNumber(task.metadata, 'node_instance_id'),
    waypoint: true,
  }
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

function parseWorkflowMetadataNumber(raw: unknown, key: string): number | null {
  const metadata = parseJsonObject(raw)
  const workflow = parseJsonObject(metadata.workflow)
  const value = workflow[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
