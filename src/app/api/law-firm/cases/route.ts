import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getLawFirmRoot, listLawFirmCases } from '@/lib/law-firm'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const cases = await listLawFirmCases()
    return NextResponse.json({ root: getLawFirmRoot(), cases })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/law-firm/cases failed')
    return NextResponse.json({ error: 'Failed to load law firm cases' }, { status: 500 })
  }
}
