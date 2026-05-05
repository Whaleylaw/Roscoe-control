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

export function parseWaypointJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function parseStatus(value: unknown): WaypointTaskDiscussionStatus | undefined {
  return ['pending', 'active', 'summarized', 'closed'].includes(String(value))
    ? (value as WaypointTaskDiscussionStatus)
    : undefined
}

export function parseWaypointTaskDiscussionMetadata(raw: unknown): WaypointTaskDiscussionMetadata {
  const metadata = parseWaypointJsonObject(raw)
  const waypoint = parseWaypointJsonObject(metadata.waypoint)
  const discussion = parseWaypointJsonObject(waypoint.discussion)
  if (Object.keys(discussion).length === 0) return { enabled: false }
  const autoResponse = parseWaypointJsonObject(discussion.auto_response)
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

export function isWaypointTaskDiscussionEnabled(raw: unknown): boolean {
  return parseWaypointTaskDiscussionMetadata(raw).enabled
}

export function mergeWaypointTaskDiscussionMetadata(
  raw: unknown,
  discussion: Omit<WaypointTaskDiscussionMetadata, 'mode'> & { mode?: 'agent_chat' },
): Record<string, unknown> {
  const metadata = parseWaypointJsonObject(raw)
  const waypoint = parseWaypointJsonObject(metadata.waypoint)
  const existingDiscussion = parseWaypointJsonObject(waypoint.discussion)
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

export function parseWaypointWorkflowMetadataNumber(raw: unknown, key: string): number | null {
  const metadata = parseWaypointJsonObject(raw)
  const workflow = parseWaypointJsonObject(metadata.workflow)
  const value = workflow[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
