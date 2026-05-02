import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { eventBus } from '@/lib/event-bus'
import { postTaskDiscussionMessage } from '@/lib/waypoint-task-discussion'

function parseMetadata(raw: string | null | undefined) {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.id, 10)
  if (!Number.isFinite(taskId)) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })

  const body = await request.json().catch(() => ({})) as { content?: unknown; from?: unknown; to?: unknown }
  const content = typeof body.content === 'string' ? body.content : ''
  if (!content.trim()) return NextResponse.json({ error: 'Message content is required' }, { status: 400 })

  try {
    const result = postTaskDiscussionMessage(getDatabase(), {
      taskId,
      workspaceId: auth.user.workspace_id ?? 1,
      from: typeof body.from === 'string' ? body.from : auth.user.display_name || auth.user.username || 'operator',
      to: typeof body.to === 'string' ? body.to : undefined,
      content,
    })
    const message = {
      ...result.message,
      metadata: parseMetadata(result.message.metadata),
    }
    eventBus.broadcast('chat.message', message)
    return NextResponse.json({ message, discussion: result.discussion }, { status: 201 })
  } catch (error: any) {
    const message = String(error?.message || '')
    if (message.includes('not found')) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (message.includes('not enabled')) return NextResponse.json({ error: 'Waypoint discussion is not enabled for this task' }, { status: 409 })
    return NextResponse.json({ error: 'Failed to post discussion message' }, { status: 500 })
  }
}
