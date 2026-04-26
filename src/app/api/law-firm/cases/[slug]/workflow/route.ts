import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { ensureLawFirmCaseProject, getLawFirmRoot, readLawFirmCaseDetail } from '@/lib/law-firm'
import { bypassWorkflowNode, cancelWorkflowInstance, listWorkflowActivity, materializeReadyWorkflowNodes, runWorkflowTriggers } from '@/lib/workflow-engine'
import {
  ensureProjectRepoMapEntry,
  materializeLawFirmWorkflowTasks,
  previewLawFirmWorkflowStatuses,
  previewLawFirmWorkflowTasks,
  updateLawFirmWorkflowOverride,
} from '@/lib/law-firm-workflow'

const materializeSchema = z.object({
  assigned_to: z.string().min(1).max(100).optional(),
  limit: z.number().int().positive().max(100).optional(),
})

const startProviderMedicalRecordsSchema = z.object({
  action: z.literal('start_provider_medical_records'),
  provider_slug: z.string().min(1).max(200),
  request_records: z.boolean().default(true),
  request_bills: z.boolean().default(true),
  assigned_to: z.string().min(1).max(100).optional(),
  status: z.enum(['inbox', 'assigned']).optional(),
})

const postSchema = z.union([startProviderMedicalRecordsSchema, materializeSchema])

const overrideSchema = z.object({
  workflow_id: z.string().min(1).max(100),
  action: z.enum(['activate', 'close']),
})

const patchSchema = z.union([
  overrideSchema,
  z.object({
    action: z.literal('cancel_instance'),
    workflow_instance_id: z.number().int().positive(),
    reason: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal('bypass_node'),
    workflow_instance_id: z.number().int().positive(),
    node_key: z.string().min(1).max(200),
    reason: z.string().max(1000).optional(),
  }),
])

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { slug } = await params
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const [readyItems, workflows] = await Promise.all([
      previewLawFirmWorkflowTasks(slug),
      previewLawFirmWorkflowStatuses(slug),
    ])
    const detail = await readLawFirmCaseDetail(slug)
    const workflowInstances = listWorkflowActivity(db, {
      subjectType: 'law_firm_case',
      subjectId: slug,
      workspaceId,
    })
    return NextResponse.json({
      case_slug: slug,
      ready_items: readyItems,
      workflows,
      workflow_instances: workflowInstances,
      medical_providers: detail.dashboard.medical_providers,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/law-firm/cases/[slug]/workflow failed')
    return NextResponse.json({ error: 'Failed to preview FirmVault workflow tasks' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = postSchema.safeParse(body)
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
      route: '/api/law-firm/cases/[slug]/workflow',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { slug } = await params
    const actor = auth.user.display_name || auth.user.username || 'system'
    if ((parsed.data as { action?: string }).action === 'start_provider_medical_records') {
      const start = parsed.data as z.infer<typeof startProviderMedicalRecordsSchema>
      const detail = await readLawFirmCaseDetail(slug)
      const provider = detail.dashboard.medical_providers.find((item) => item.slug === start.provider_slug)
      if (!provider) return NextResponse.json({ error: 'Medical provider not found for this case' }, { status: 404 })
      const project = await ensureLawFirmCaseProject(db, workspaceId, slug)
      ensureProjectRepoMapEntry(db, project.id, getLawFirmRoot())
      const result = runWorkflowTriggers(db, {
        subjectType: 'law_firm_case',
        subjectId: slug,
        triggerType: 'event',
        event: 'law_firm.medical_records_request.manual',
        vars: {
          provider_slug: provider.slug,
          provider_name: provider.name,
          request_records: start.request_records,
          request_bills: start.request_bills,
          source_trigger: 'manual',
        },
        projectId: project.id,
        assignedTo: start.assigned_to,
        status: start.status ?? 'inbox',
        actor,
        workspaceId,
        tenantId,
      })
      const workflowInstances = listWorkflowActivity(db, {
        subjectType: 'law_firm_case',
        subjectId: slug,
        workspaceId,
      })
      return NextResponse.json({
        case_slug: slug,
        provider,
        result,
        workflow_instances: workflowInstances,
        medical_providers: detail.dashboard.medical_providers,
      }, { status: 201 })
    }
    const result = await materializeLawFirmWorkflowTasks(db, workspaceId, slug, actor, parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/law-firm/cases/[slug]/workflow failed')
    return NextResponse.json({ error: 'Failed to materialize FirmVault workflow tasks' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = patchSchema.safeParse(body)
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
      route: '/api/law-firm/cases/[slug]/workflow',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { slug } = await params
    const actor = auth.user.display_name || auth.user.username || 'system'
    if (parsed.data.action === 'cancel_instance') {
      const cancelled = cancelWorkflowInstance(db, {
        workflowInstanceId: parsed.data.workflow_instance_id,
        actor,
        workspaceId,
        reason: parsed.data.reason ?? `Cancelled from case ${slug}`,
      })
      if (!cancelled) return NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 })
      const workflowInstances = listWorkflowActivity(db, {
        subjectType: 'law_firm_case',
        subjectId: slug,
        workspaceId,
      })
      return NextResponse.json({ case_slug: slug, cancelled, workflow_instances: workflowInstances })
    }
    if (parsed.data.action === 'bypass_node') {
      const bypassed = bypassWorkflowNode(db, {
        workflowInstanceId: parsed.data.workflow_instance_id,
        nodeKey: parsed.data.node_key,
        actor,
        workspaceId,
        reason: parsed.data.reason ?? `Marked not applicable from case ${slug}`,
      })
      if (!bypassed) return NextResponse.json({ error: 'Workflow node not found' }, { status: 404 })
      const project = await ensureLawFirmCaseProject(db, workspaceId, slug)
      const materialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: parsed.data.workflow_instance_id,
        projectId: project.id,
        workspaceId,
        actor,
        status: 'inbox',
      })
      const workflowInstances = listWorkflowActivity(db, {
        subjectType: 'law_firm_case',
        subjectId: slug,
        workspaceId,
      })
      return NextResponse.json({ case_slug: slug, bypassed, materialized, workflow_instances: workflowInstances })
    }

    const workflows = await updateLawFirmWorkflowOverride(slug, parsed.data.workflow_id, parsed.data.action, actor)
    return NextResponse.json({ case_slug: slug, workflows })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'PATCH /api/law-firm/cases/[slug]/workflow failed')
    return NextResponse.json({ error: 'Failed to update FirmVault workflow override' }, { status: 500 })
  }
}
