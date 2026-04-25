import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { satisfyWorkflowCondition } from '@/lib/workflow-engine'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'

const Body = z.object({
  subject_type: z.string().min(1).max(100),
  subject_id: z.string().min(1).max(200),
  condition: z.string().min(1).max(500),
  payload: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['inbox', 'assigned']).optional(),
})

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = Body.safeParse(body)
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
      route: '/api/workflow-dependencies/satisfy',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const actor = auth.user.display_name || auth.user.username || 'workflow-dependency'
    const result = satisfyWorkflowCondition(db, {
      subjectType: parsed.data.subject_type,
      subjectId: parsed.data.subject_id,
      condition: parsed.data.condition,
      actor,
      workspaceId,
      payload: parsed.data.payload,
      status: parsed.data.status ?? 'inbox',
    })

    return NextResponse.json({ result })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/workflow-dependencies/satisfy failed')
    return NextResponse.json({ error: 'Failed to satisfy workflow dependency' }, { status: 500 })
  }
}
