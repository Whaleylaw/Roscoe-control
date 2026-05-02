import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { listTaskDiscussion } from '@/lib/waypoint-task-discussion'

function parseMetadata(raw: string | null | undefined) {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.id, 10)
  if (!Number.isFinite(taskId)) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })

  try {
    const result = listTaskDiscussion(getDatabase(), {
      taskId,
      workspaceId: auth.user.workspace_id ?? 1,
    })
    return NextResponse.json({
      discussion: result.discussion,
      messages: result.messages.map((message) => ({
        ...message,
        metadata: parseMetadata(message.metadata),
      })),
    })
  } catch (error: any) {
    if (String(error?.message || '').includes('not found')) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to fetch discussion' }, { status: 500 })
  }
}
