import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { runWorkflowTriggers } from '@/lib/workflow-engine'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'

const Body = z.object({
  subject_type: z.string().min(1).max(100),
  subject_id: z.string().min(1).max(200),
  trigger_type: z.enum(['condition', 'event', 'cooldown', 'cron']),
  condition: z.string().min(1).max(500).optional(),
  event: z.string().min(1).max(200).optional(),
  vars: z.record(z.string(), z.unknown()).optional(),
  project_id: z.number().int().positive().optional(),
  base_ref: z.string().min(1).max(200).optional(),
  assigned_to: z.string().min(1).max(100).optional(),
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
      route: '/api/workflow-triggers/run',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const actor = auth.user.display_name || auth.user.username || 'workflow-trigger'
    const result = runWorkflowTriggers(db, {
      subjectType: parsed.data.subject_type,
      subjectId: parsed.data.subject_id,
      triggerType: parsed.data.trigger_type,
      condition: parsed.data.condition,
      event: parsed.data.event,
      vars: parsed.data.vars,
      projectId: parsed.data.project_id,
      baseRef: parsed.data.base_ref,
      assignedTo: parsed.data.assigned_to,
      status: parsed.data.status ?? 'inbox',
      actor,
      workspaceId,
      tenantId,
    })
    return NextResponse.json({ result })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/workflow-triggers/run failed')
    const message = error instanceof Error ? error.message : 'Failed to run workflow triggers'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
