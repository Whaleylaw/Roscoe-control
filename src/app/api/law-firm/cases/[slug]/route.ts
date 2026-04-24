import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { readLawFirmCaseDetail, updateLawFirmCaseState } from '@/lib/law-firm'

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
    return NextResponse.json({ case: detail })
  } catch (error) {
    logger.error({ err: error }, 'PATCH /api/law-firm/cases/[slug] failed')
    return NextResponse.json({ error: 'Failed to update law firm case' }, { status: 500 })
  }
}
