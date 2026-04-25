import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { syncWorkflowDefinitions } from '@/lib/workflow-registry'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null

    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/workflow-definitions/sync',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const report = await syncWorkflowDefinitions({
      db,
      actor: auth.user.display_name || auth.user.username || 'workflow-sync',
      workspaceId,
      tenantId,
    })

    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/workflow-definitions/sync failed')
    return NextResponse.json({ error: 'Workflow definition sync failed' }, { status: 500 })
  }
}
