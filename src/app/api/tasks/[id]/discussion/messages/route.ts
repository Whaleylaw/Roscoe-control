import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { normalizeWaypointRateLimitError, normalizeWaypointValidationDetails } from '@/lib/waypoint-api'
import { eventBus } from '@/lib/event-bus'
import { postTaskDiscussionMessage } from '@/lib/waypoint-task-discussion'

const Body = z.object({
  content: z.string().trim().min(1),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
})

function discussionMessageError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, action: 'error', error, ...(details !== undefined ? { details } : {}) }, { status })
}

function parseMetadata(raw: string | null | undefined) {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return discussionMessageError(auth.status ?? 403, auth.error ?? 'Forbidden')

  const rateCheck = normalizeWaypointRateLimitError(mutationLimiter(request))
  if (rateCheck) return rateCheck

  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.id, 10)
  if (!Number.isFinite(taskId) || taskId <= 0) return discussionMessageError(400, 'Invalid task ID')

  const body = await request.json().catch(() => null) as unknown
  if (body == null) return discussionMessageError(400, 'Invalid JSON body')
  const parsed = Body.safeParse(body)
  if (!parsed.success) {
    return discussionMessageError(400, 'Invalid request body', normalizeWaypointValidationDetails(parsed.error.issues))
  }

  try {
    const result = postTaskDiscussionMessage(getDatabase(), {
      taskId,
      workspaceId: auth.user.workspace_id ?? 1,
      from: parsed.data.from ?? (auth.user.display_name || auth.user.username || 'operator'),
      to: parsed.data.to,
      content: parsed.data.content,
    })
    const message = {
      ...result.message,
      metadata: parseMetadata(result.message.metadata),
    }
    eventBus.broadcast('chat.message', message)
    return NextResponse.json({ ok: true, action: 'post_discussion_message', message, discussion: result.discussion }, { status: 201 })
  } catch (error: any) {
    const message = String(error?.message || '')
    if (message.includes('not found')) return discussionMessageError(404, 'Task not found')
    if (message.includes('not enabled')) return discussionMessageError(409, 'Waypoint discussion is not enabled for this task')
    return discussionMessageError(500, 'Failed to post discussion message')
  }
}
