import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { collectObservabilityMemoryDetail } from '@/lib/observability'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    return NextResponse.json(await collectObservabilityMemoryDetail())
  } catch (err) {
    logger.error({ err }, 'Observability memory detail failed')
    return NextResponse.json({ error: 'Failed to collect observability memory detail' }, { status: 500 })
  }
}
