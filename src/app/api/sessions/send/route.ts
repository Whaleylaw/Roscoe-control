import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'

/**
 * POST /api/sessions/send
 * Inject a message into a live session via the gateway's chat.send RPC.
 * This is non-blocking — the message is delivered to the running session
 * and the response returns immediately.
 *
 * Body: { sessionKey: string, message: string }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const sessionKey = typeof body?.sessionKey === 'string' ? body.sessionKey.trim() : ''
    const message = typeof body?.message === 'string' ? body.message.trim() : ''

    if (!sessionKey) {
      return NextResponse.json({ error: 'sessionKey is required' }, { status: 400 })
    }
    if (!message || message.length > 6000) {
      return NextResponse.json({ error: 'message is required (max 6000 chars)' }, { status: 400 })
    }

    const result = await callOpenClawGateway<any>(
      'chat.send',
      {
        sessionKey,
        message,
        idempotencyKey: `mc-send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        deliver: false,
      },
      12000,
    )

    const status = String(result?.status || '').toLowerCase()
    const delivered = status === 'started' || status === 'ok' || status === 'in_flight'

    if (!delivered) {
      return NextResponse.json(
        { error: `Gateway returned status: ${status}`, status: result?.status },
        { status: 502 },
      )
    }

    return NextResponse.json({
      ok: true,
      status: result?.status,
      runId: result?.runId || null,
    })
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/sessions/send error')
    return NextResponse.json(
      { error: error?.message || 'Failed to send message to session' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
