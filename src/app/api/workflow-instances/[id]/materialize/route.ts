import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { materializeReadyWorkflowNodes } from '@/lib/workflow-engine'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'

const Body = z.object({
  project_id: z.number().int().positive(),
  base_ref: z.string().min(1).max(200).optional(),
  assigned_to: z.string().min(1).max(100).optional(),
  status: z.enum(['inbox', 'assigned']).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const workflowInstanceId = Number.parseInt(id, 10)
    if (!Number.isFinite(workflowInstanceId) || workflowInstanceId <= 0) {
      return NextResponse.json({ error: 'Invalid workflow instance id' }, { status: 400 })
    }

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
      route: '/api/workflow-instances/[id]/materialize',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const actor = auth.user.display_name || auth.user.username || 'system'
    const result = materializeReadyWorkflowNodes(db, {
      workflowInstanceId,
      projectId: parsed.data.project_id,
      workspaceId,
      actor,
      baseRef: parsed.data.base_ref,
      assignedTo: parsed.data.assigned_to,
      status: parsed.data.status,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/workflow-instances/[id]/materialize failed')
    return NextResponse.json({ error: 'Failed to materialize workflow nodes' }, { status: 500 })
  }
}
