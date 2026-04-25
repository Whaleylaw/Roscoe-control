import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { createWorkflowDefinition, parseWorkflowDefinition } from '@/lib/workflow-engine'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'

const CreateBody = z.object({
  definition_yaml: z.string().min(1).max(200_000),
})

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const rows = db.prepare(`
      SELECT id, slug, name, version, subject_type, status, created_by, created_at, updated_at
      FROM workflow_definitions
      WHERE workspace_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 200
    `).all(workspaceId)
    return NextResponse.json({ workflow_definitions: rows })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workflow-definitions failed')
    return NextResponse.json({ error: 'Failed to list workflow definitions' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = CreateBody.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
    }

    const definition = parseWorkflowDefinition(parsed.data.definition_yaml)
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/workflow-definitions',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const actor = auth.user.display_name || auth.user.username || 'system'
    const id = createWorkflowDefinition(db, parsed.data.definition_yaml, actor, workspaceId, tenantId)
    return NextResponse.json({ workflow_definition: { db_id: id, ...definition } }, { status: 201 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/workflow-definitions failed')
    const message = error instanceof Error ? error.message : 'Failed to create workflow definition'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
