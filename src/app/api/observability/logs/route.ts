import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { collectObservabilityLogsDetail } from '@/lib/observability'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const limit = Number(searchParams.get('limit') || '80')
    return NextResponse.json(collectObservabilityLogsDetail({ limit }))
  } catch (err) {
    logger.error({ err }, 'Observability logs detail failed')
    return NextResponse.json({ error: 'Failed to collect observability logs detail' }, { status: 500 })
  }
}
