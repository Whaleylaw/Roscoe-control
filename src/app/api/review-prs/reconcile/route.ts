import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { reconcileOpenReviewPrs } from '@/lib/review-prs'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const result = await reconcileOpenReviewPrs(db, {
      actor: auth.user.username || 'operator',
      workspaceId: auth.user.workspace_id ?? 1,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/review-prs/reconcile error')
    return NextResponse.json({ error: 'Failed to reconcile review PRs' }, { status: 500 })
  }
}
