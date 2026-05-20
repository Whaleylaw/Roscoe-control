import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { listTaskDiscussion } from '@/lib/waypoint-task-discussion'

function discussionError(status: number, error: string) {
  return NextResponse.json({ ok: false, action: 'error', error }, { status })
}

function parseMetadata(raw: string | null | undefined) {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return discussionError(auth.status ?? 403, auth.error ?? 'Forbidden')

  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.id, 10)
  if (!Number.isFinite(taskId) || taskId <= 0) return discussionError(400, 'Invalid task ID')

  try {
    const result = listTaskDiscussion(getDatabase(), {
      taskId,
      workspaceId: auth.user.workspace_id ?? 1,
    })
    return NextResponse.json({
      ok: true,
      action: 'list_discussion',
      discussion: result.discussion,
      messages: result.messages.map((message) => ({
        ...message,
        metadata: parseMetadata(message.metadata),
      })),
    })
  } catch (error: any) {
    if (String(error?.message || '').includes('not found')) {
      return discussionError(404, 'Task not found')
    }
    return discussionError(500, 'Failed to fetch discussion')
  }
}
