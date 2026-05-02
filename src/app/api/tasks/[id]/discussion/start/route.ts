import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { startTaskDiscussion } from '@/lib/waypoint-task-discussion'

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

  const body = await request.json().catch(() => ({})) as { agent?: unknown }
  const agent = typeof body.agent === 'string' ? body.agent : undefined

  try {
    const result = startTaskDiscussion(getDatabase(), {
      taskId,
      workspaceId: auth.user.workspace_id ?? 1,
      actor: auth.user.display_name || auth.user.username || 'operator',
      agent,
    })
    return NextResponse.json({ discussion: result.discussion })
  } catch (error: any) {
    if (String(error?.message || '').includes('not found')) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to start discussion' }, { status: 500 })
  }
}
