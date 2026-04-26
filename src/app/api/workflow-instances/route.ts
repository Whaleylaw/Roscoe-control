import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import {
  materializeReadyWorkflowNodes,
  startWorkflowInstance,
} from '@/lib/workflow-engine'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'

const StartBody = z.object({
  definition_id: z.number().int().positive(),
  subject_type: z.string().min(1).max(100),
  subject_id: z.string().min(1).max(200),
  workflow_key: z.string().min(1).max(300).optional(),
  vars: z.record(z.string(), z.unknown()).optional(),
  project_id: z.number().int().positive().optional(),
  base_ref: z.string().min(1).max(200).optional(),
  assigned_to: z.string().min(1).max(100).optional(),
  status: z.enum(['inbox', 'assigned']).optional(),
  materialize: z.boolean().default(true),
})

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)
    const subjectType = searchParams.get('subject_type')
    const subjectId = searchParams.get('subject_id')
    const params: unknown[] = [workspaceId]
    let where = 'wi.workspace_id = ?'
    if (subjectType) {
      where += ' AND wi.subject_type = ?'
      params.push(subjectType)
    }
    if (subjectId) {
      where += ' AND wi.subject_id = ?'
      params.push(subjectId)
    }
    const rows = db.prepare(`
      SELECT wi.*, wd.slug AS definition_slug, wd.name AS definition_name, wd.version AS definition_version
      FROM workflow_instances wi
      JOIN workflow_definitions wd ON wd.id = wi.definition_id
      WHERE ${where}
      ORDER BY wi.updated_at DESC, wi.id DESC
      LIMIT 200
    `).all(...params)
    return NextResponse.json({ workflow_instances: rows })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workflow-instances failed')
    return NextResponse.json({ error: 'Failed to list workflow instances' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = StartBody.safeParse(body)
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
      route: '/api/workflow-instances',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const actor = auth.user.display_name || auth.user.username || 'system'
    const started = startWorkflowInstance(db, {
      definitionId: parsed.data.definition_id,
      subjectType: parsed.data.subject_type,
      subjectId: parsed.data.subject_id,
      workflowKey: parsed.data.workflow_key,
      vars: parsed.data.vars,
      actor,
      workspaceId,
      tenantId,
    })

    const materialized = parsed.data.materialize && parsed.data.project_id
      ? materializeReadyWorkflowNodes(db, {
          workflowInstanceId: started.instance_id,
          projectId: parsed.data.project_id,
          workspaceId,
          actor,
          baseRef: parsed.data.base_ref,
          assignedTo: parsed.data.assigned_to,
          status: parsed.data.status,
        })
      : null

    return NextResponse.json({
      workflow_instance: started,
      materialized,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/workflow-instances failed')
    const message = error instanceof Error ? error.message : 'Failed to start workflow instance'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
