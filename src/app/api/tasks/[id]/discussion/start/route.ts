import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { normalizeWaypointRateLimitError } from '@/lib/waypoint-api'
import { startTaskDiscussion } from '@/lib/waypoint-task-discussion'

function discussionStartError(status: number, error: string) {
  return NextResponse.json({ ok: false, action: 'error', error }, { status })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return discussionStartError(auth.status ?? 403, auth.error ?? 'Forbidden')

  const rateCheck = normalizeWaypointRateLimitError(mutationLimiter(request))
  if (rateCheck) return rateCheck

  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.id, 10)
  if (!Number.isFinite(taskId)) return discussionStartError(400, 'Invalid task ID')

  const body = await request.json().catch(() => null) as { agent?: unknown } | null
  if (body == null) return discussionStartError(400, 'Invalid JSON body')
  const agent = typeof body.agent === 'string' ? body.agent : undefined

  try {
    const result = startTaskDiscussion(getDatabase(), {
      taskId,
      workspaceId: auth.user.workspace_id ?? 1,
      actor: auth.user.display_name || auth.user.username || 'operator',
      agent,
    })
    return NextResponse.json({ ok: true, action: 'start_discussion', discussion: result.discussion })
  } catch (error: any) {
    if (String(error?.message || '').includes('not found')) {
      return discussionStartError(404, 'Task not found')
    }
    return discussionStartError(500, 'Failed to start discussion')
  }
}
