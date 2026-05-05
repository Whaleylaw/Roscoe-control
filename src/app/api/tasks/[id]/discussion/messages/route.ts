import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { normalizeWaypointRateLimitError, normalizeWaypointValidationDetails } from '@/lib/waypoint-api'
import { eventBus } from '@/lib/event-bus'
import { postTaskDiscussionMessage } from '@/lib/waypoint-task-discussion'
import {
  resolveWaypointDiscussionAutoResponse,
  parseWaypointDiscussionAutoResponseEnvFlag,
  WAYPOINT_DISCUSSION_MESSAGE_AUTHORED_BY_VALUES,
  type WaypointDiscussionMessageAuthoredBy,
} from '@waypoint/core'

const Body = z.object({
  content: z.string().trim().min(1),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  authored_by: z.enum(WAYPOINT_DISCUSSION_MESSAGE_AUTHORED_BY_VALUES).optional(),
}).strict()

function discussionMessageError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, action: 'error', error, ...(details !== undefined ? { details } : {}) }, { status })
}

function parseMetadata(raw: string | null | undefined) {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function isAutoResponseGloballyEnabled() {
  return parseWaypointDiscussionAutoResponseEnvFlag(process.env.WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED)
}

function isValidServiceToken(request: NextRequest): boolean {
  const expected = process.env.WAYPOINT_AUTORESPONSE_SERVICE_TOKEN
  if (!expected || !expected.trim()) return false
  const provided = request.headers.get('x-waypoint-service-token')
  if (!provided) return false
  return provided === expected
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Peek at body once to determine if this is an agent-authored request.
  // Clone request so we can read JSON early then still pass original body downstream via parsed object.
  let rawBody: unknown = null
  try {
    rawBody = await request.json()
  } catch {
    return discussionMessageError(400, 'Invalid JSON body')
  }
  if (rawBody == null) return discussionMessageError(400, 'Invalid JSON body')

  const parsed = Body.safeParse(rawBody)
  if (!parsed.success) {
    return discussionMessageError(400, 'Invalid request body', normalizeWaypointValidationDetails(parsed.error.issues))
  }

  const authoredBy: WaypointDiscussionMessageAuthoredBy = parsed.data.authored_by ?? 'user'

  // Service-token path (agent authorship) — bypass user auth but require matching token.
  let actingUser: { display_name?: string; username?: string; workspace_id?: number } | null = null

  if (authoredBy === 'agent') {
    if (!isValidServiceToken(request)) {
      return discussionMessageError(401, 'Service token required for agent-authored messages')
    }
    // rate-limit still applies to agent-authored messages
    const rateCheck = normalizeWaypointRateLimitError(mutationLimiter(request))
    if (rateCheck) return rateCheck
    actingUser = { workspace_id: 1 }
  } else {
    const auth = requireRole(request, 'operator')
    if ('error' in auth) return discussionMessageError(auth.status ?? 403, auth.error ?? 'Forbidden')
    const rateCheck = normalizeWaypointRateLimitError(mutationLimiter(request))
    if (rateCheck) return rateCheck
    actingUser = {
      display_name: auth.user.display_name,
      username: auth.user.username,
      workspace_id: auth.user.workspace_id ?? 1,
    }
  }

  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.id, 10)
  if (!Number.isFinite(taskId) || taskId <= 0) return discussionMessageError(400, 'Invalid task ID')

  try {
    const result = postTaskDiscussionMessage(getDatabase(), {
      taskId,
      workspaceId: actingUser?.workspace_id ?? 1,
      from: parsed.data.from ?? (actingUser?.display_name || actingUser?.username || (authoredBy === 'agent' ? 'agent' : 'operator')),
      to: parsed.data.to,
      content: parsed.data.content,
    })

    // Enrich persisted message metadata with authorship info. We patch the stored row
    // AND the in-memory message so the response and downstream consumers see it.
    let enrichedMetadataObject: unknown = parseMetadata(result.message.metadata)
    if (enrichedMetadataObject && typeof enrichedMetadataObject === 'object') {
      ;(enrichedMetadataObject as Record<string, unknown>).authored_by = authoredBy
      ;(enrichedMetadataObject as Record<string, unknown>).agent =
        authoredBy === 'agent' ? (parsed.data.from ?? result.discussion.agent ?? null) : null
      try {
        getDatabase()
          .prepare('UPDATE messages SET metadata = ? WHERE id = ?')
          .run(JSON.stringify(enrichedMetadataObject), result.message.id)
      } catch {
        // best-effort metadata enrichment; do not fail the request if this update fails
      }
    }

    const message = {
      ...result.message,
      metadata: enrichedMetadataObject,
    }
    try {
      eventBus.broadcast('chat.message', message)
    } catch {
      // best-effort broadcast; do not fail message persistence on transport errors
    }

    // Loop prevention: agent-authored messages must NEVER retrigger auto-response.
    let autoResponse:
      | { requested: true; agent: string }
      | { requested: false; agent?: string; reason?: string }
    if (authoredBy === 'agent') {
      autoResponse = {
        requested: false,
        agent: result.discussion.agent ?? undefined,
        reason: 'agent_authored',
      }
    } else {
      autoResponse = resolveWaypointDiscussionAutoResponse({
        metadataOptIn: result.discussion.auto_response?.enabled === true,
        globalOptIn: isAutoResponseGloballyEnabled(),
        agent: result.discussion.agent,
      })

      if (autoResponse.requested) {
        try {
          eventBus.broadcast('waypoint.discussion.auto_response.requested', {
            task_id: result.task.id,
            workspace_id: actingUser?.workspace_id ?? 1,
            conversation_id: result.discussion.conversation_id,
            message_id: result.message.id,
            agent: result.discussion.agent,
            content: result.message.content,
          })
        } catch {
          // best-effort dispatch; do not fail persisted discussion messages
        }
      }
    }

    return NextResponse.json(
      { ok: true, action: 'post_discussion_message', message, discussion: result.discussion, auto_response: autoResponse },
      { status: 201 },
    )
  } catch (error: any) {
    const message = String(error?.message || '')
    if (message.includes('not found')) return discussionMessageError(404, 'Task not found')
    if (message.includes('not enabled')) return discussionMessageError(409, 'Waypoint discussion is not enabled for this task')
    return discussionMessageError(500, 'Failed to post discussion message')
  }
}
