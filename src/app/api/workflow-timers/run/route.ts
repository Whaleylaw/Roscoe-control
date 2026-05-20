import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { satisfyPassiveFirmVaultLandmarks } from '@/lib/firmvault-passive-landmarks'
import { advanceDueWorkflowTimers } from '@/lib/workflow-engine'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'

const RunBody = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  status: z.enum(['inbox', 'assigned']).optional(),
})

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = RunBody.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/workflow-timers/run',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const actor = auth.user.display_name || auth.user.username || 'workflow-timer'
    const passive = await satisfyPassiveFirmVaultLandmarks(db, {
      workspaceId,
      actor: 'passive-landmark-resolver',
      status: parsed.data.status ?? 'inbox',
    })
    const result = advanceDueWorkflowTimers(db, {
      actor,
      workspaceId,
      limit: parsed.data.limit,
      status: parsed.data.status ?? 'inbox',
    })
    return NextResponse.json({ passive, result })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/workflow-timers/run failed')
    return NextResponse.json({ error: 'Failed to advance workflow timers' }, { status: 500 })
  }
}
