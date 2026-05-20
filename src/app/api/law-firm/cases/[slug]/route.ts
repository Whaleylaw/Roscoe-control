import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { ensureLawFirmCaseProject, readLawFirmCaseDetail, updateLawFirmCaseState } from '@/lib/law-firm'
import { runWorkflowTriggers, satisfyWorkflowCondition } from '@/lib/workflow-engine'

const patchSchema = z.object({
  current_phase: z.string().optional(),
  landmarks: z.record(z.string(), z.boolean()).optional(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { slug } = await params
    const detail = await readLawFirmCaseDetail(slug)
    return NextResponse.json({ case: detail })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/law-firm/cases/[slug] failed')
    return NextResponse.json({ error: 'Failed to load law firm case' }, { status: 500 })
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
    const body = await request.json()
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
    }

    const { slug } = await params
    const detail = await updateLawFirmCaseState(slug, parsed.data)
    const satisfiedLandmarks = Object.entries(parsed.data.landmarks ?? {})
      .filter(([, satisfied]) => satisfied === true)
      .map(([landmark]) => landmark)
    if (satisfiedLandmarks.length > 0) {
      const db = getDatabase()
      const workspaceId = auth.user.workspace_id ?? 1
      const tenantId = auth.user.tenant_id ?? 1
      const actor = auth.user.display_name || auth.user.username || 'mission-control'
      const project = await ensureLawFirmCaseProject(db, workspaceId, slug)
      for (const landmark of satisfiedLandmarks) {
        const condition = `law_firm.landmarks.${landmark} == true`
        satisfyWorkflowCondition(db, {
          subjectType: 'law_firm_case',
          subjectId: slug,
          condition,
          actor,
          workspaceId,
          payload: { source: 'law_firm_case_patch', landmark },
          status: 'inbox',
        })
        runWorkflowTriggers(db, {
          subjectType: 'law_firm_case',
          subjectId: slug,
          triggerType: 'condition',
          condition,
          projectId: project.id,
          status: 'inbox',
          actor,
          workspaceId,
          tenantId,
        })
      }
    }
    return NextResponse.json({ case: detail })
  } catch (error) {
    logger.error({ err: error }, 'PATCH /api/law-firm/cases/[slug] failed')
    return NextResponse.json({ error: 'Failed to update law firm case' }, { status: 500 })
  }
}
