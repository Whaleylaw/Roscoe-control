import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { collectObservabilitySnapshot } from '@/lib/observability'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') || 'snapshot'
    const probeServices = scope !== 'offline'
    const snapshot = await collectObservabilitySnapshot({ probeServices })
    return NextResponse.json(snapshot)
  } catch (err) {
    logger.error({ err }, 'Observability snapshot failed')
    return NextResponse.json({ error: 'Failed to collect observability snapshot' }, { status: 500 })
  }
}
