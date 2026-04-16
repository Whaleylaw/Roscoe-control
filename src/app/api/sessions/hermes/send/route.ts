import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'

/**
 * POST /api/sessions/hermes/send
 * Send a message to Hermes via its OpenAI-compatible API server.
 * Saves both the user message and Hermes response to the MC chat DB
 * with correct from/to attribution.
 *
 * Body: { message: string, conversationId?: string, sessionId?: string }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : 'agent_Hermes'
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : undefined

    if (!message || message.length > 6000) {
      return NextResponse.json({ error: 'message is required (max 6000 chars)' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const userName = auth.user.display_name || auth.user.username || 'human'

    // Look up Hermes agent config for API URL and key
    const agent = db.prepare(
      "SELECT config FROM agents WHERE lower(name) = 'hermes' AND workspace_id = ?"
    ).get(workspaceId) as { config?: string } | undefined

    let apiUrl = 'http://127.0.0.1:8642'
    let apiKey = ''

    if (agent?.config) {
      try {
        const config = JSON.parse(agent.config)
        if (config.hermesApiUrl) apiUrl = config.hermesApiUrl
        if (config.hermesApiKey) apiKey = config.hermesApiKey
      } catch { /* use defaults */ }
    }

    // Save user message to DB — use 'human' as from_agent so the UI renders it on the right
    const userMsg = db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversationId, 'human', 'Hermes', message, 'text', workspaceId)

    const userRow = db.prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
      .get(userMsg.lastInsertRowid, workspaceId) as any
    // Don't broadcast user message — the client already shows it optimistically
    // and will replace it with this DB row when the response comes back

    // Call Hermes API
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    if (sessionId) {
      headers['X-Hermes-Session-Id'] = sessionId
    }

    const res = await fetch(`${apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
        stream: false,
      }),
      signal: AbortSignal.timeout(120000),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      logger.error({ status: res.status, error: errBody }, 'Hermes API error')
      return NextResponse.json(
        { error: errBody?.error?.message || `Hermes API returned ${res.status}`, userMessage: userRow },
        { status: 502 },
      )
    }

    const data = await res.json()
    const reply = data?.choices?.[0]?.message?.content || ''

    // Save Hermes response to DB
    let replyRow = null
    if (reply) {
      const replyMsg = db.prepare(`
        INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, workspace_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(conversationId, 'Hermes', 'human', reply, 'text', workspaceId)

      replyRow = db.prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
        .get(replyMsg.lastInsertRowid, workspaceId) as any
      if (replyRow) {
        eventBus.broadcast('chat.message', replyRow)
      }
    }

    // Keep Hermes agent marked as active so the heartbeat doesn't set it offline
    const now = Math.floor(Date.now() / 1000)
    db.prepare("UPDATE agents SET status = 'active', last_seen = ?, updated_at = ? WHERE lower(name) = 'hermes' AND workspace_id = ?")
      .run(now, now, workspaceId)

    return NextResponse.json({
      ok: true,
      reply,
      userMessage: userRow,
      replyMessage: replyRow,
      sessionId: data?.id || sessionId || null,
    })
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/sessions/hermes/send error')
    return NextResponse.json(
      { error: error?.message || 'Failed to send message to Hermes' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
