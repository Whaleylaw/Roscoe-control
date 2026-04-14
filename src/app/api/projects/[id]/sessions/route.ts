import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getAllGatewaySessions } from '@/lib/sessions'
import { syncClaudeSessions, getLocalClaudeSessions } from '@/lib/claude-sessions'
import { scanCodexSessions } from '@/lib/codex-sessions'
import { scanHermesSessions } from '@/lib/hermes-sessions'

type Thread = {
  id: string
  conversationId: string
  agentName: string
  agentStatus: string
  lastMessage: string | null
  lastActivity: number
  assignmentSource: 'assigned' | 'task'
}

type RuntimeSession = {
  id: string
  kind: 'Claude' | 'Codex' | 'Hermes' | 'Gateway'
  ticketRef: string | null
  startedAt: number
  active: boolean
  status: 'running' | 'finished' | 'failed'
  agent: string | null
}

/**
 * Union linkage rule (Open Question 1 resolution — Pitfall 1 + Pitfall 2):
 * include a runtime session if EITHER its agent is in the project's
 * assigned-or-task-derived agent set OR its project_slug equals the
 * project's slug.
 */
function isSessionInProject(
  session: { agent?: string | null; project_slug?: string | null },
  projectSlug: string,
  projectAgentsLower: Set<string>,
): boolean {
  if (session.agent && projectAgentsLower.has(session.agent.toLowerCase())) return true
  if (session.project_slug && session.project_slug === projectSlug) return true
  return false
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pickId(s: any): string {
  return String(s?.id ?? s?.session_id ?? s?.sessionId ?? s?.session_key ?? s?.key ?? '')
}

/**
 * GET /api/projects/[id]/sessions — returns { threads, runtimeSessions }.
 *
 * Pure read endpoint: NO inserts, NO updates (Pitfall 3 — Option B thread
 * derivation). Threads are derived per request from the project's agent set;
 * if no message yet exists for a (project, agent) pair the thread row is
 * still returned with a null `lastMessage`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const projectId = Number.parseInt(id, 10)
  if (!Number.isFinite(projectId) || String(projectId) !== id.trim()) {
    return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })
  }

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  const project = db
    .prepare('SELECT id, slug FROM projects WHERE id = ? AND workspace_id = ?')
    .get(projectId, workspaceId) as { id: number; slug: string } | undefined

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // 1) Agent union (mirrors /api/agents?project_id=<id> from Plan 05-01) —
  // assigned ∪ task-derived, LOWER()-deduped, with assignment_source.
  const agentRows = db
    .prepare(
      `
      SELECT a.name, a.status,
        CASE WHEN paa.agent_name IS NOT NULL THEN 'assigned' ELSE 'task' END AS assignment_source
      FROM agents a
      LEFT JOIN project_agent_assignments paa
        ON LOWER(paa.agent_name) = LOWER(a.name)
       AND paa.project_id = ?
      WHERE a.workspace_id = ?
        AND (
          paa.agent_name IS NOT NULL
          OR LOWER(a.name) IN (
            SELECT DISTINCT LOWER(assigned_to)
            FROM tasks
            WHERE project_id = ? AND assigned_to IS NOT NULL AND workspace_id = ?
          )
        )
      `,
    )
    .all(projectId, workspaceId, projectId, workspaceId) as Array<{
      name: string
      status: string
      assignment_source: 'assigned' | 'task'
    }>

  // 2) Threads — Option B (Pitfall 3): derive without writes.
  const lastMessageStmt = db.prepare(
    'SELECT content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1',
  )

  const threads: Thread[] = agentRows.map((row) => {
    const agentLower = row.name.toLowerCase()
    const conversationId = `project:${projectId}:agent:${agentLower}`
    const lastMsg = lastMessageStmt.get(conversationId) as
      | { content: string; created_at: number }
      | undefined
    return {
      id: `thread:${projectId}:${agentLower}`,
      conversationId,
      agentName: row.name,
      agentStatus: row.status,
      lastMessage: lastMsg?.content ?? null,
      lastActivity: lastMsg?.created_at ?? 0,
      assignmentSource: row.assignment_source,
    }
  })

  // Sort by lastActivity DESC; threads with no messages (lastActivity=0) end up last.
  threads.sort((a, b) => b.lastActivity - a.lastActivity)

  // 3) Runtime sessions — union rule (agent-membership OR slug-match).
  const projectAgentsLower = new Set(agentRows.map((r) => r.name.toLowerCase()))
  const runtimeSessions: RuntimeSession[] = []

  function pushIfMatching(
    s: any,
    kind: RuntimeSession['kind'],
  ) {
    if (!isSessionInProject(s, project.slug, projectAgentsLower)) return
    const active = Boolean(s?.active ?? s?.isActive ?? s?.is_active === 1)
    runtimeSessions.push({
      id: pickId(s),
      kind,
      ticketRef: s?.ticketRef ?? s?.ticket_ref ?? null,
      startedAt: num(s?.startedAt ?? s?.started_at ?? s?.firstMessageAt ?? 0),
      active,
      status: active ? 'running' : 'finished',
      agent: s?.agent ?? null,
    })
  }

  try {
    for (const s of getAllGatewaySessions()) pushIfMatching(s, 'Gateway')
  } catch (err) {
    logger.warn({ err }, 'gateway session scan failed')
  }

  try {
    await syncClaudeSessions()
    for (const s of getLocalClaudeSessions()) pushIfMatching(s, 'Claude')
  } catch (err) {
    logger.warn({ err }, 'claude session scan failed')
  }

  try {
    for (const s of scanCodexSessions()) pushIfMatching(s, 'Codex')
  } catch (err) {
    logger.warn({ err }, 'codex session scan failed')
  }

  try {
    for (const s of scanHermesSessions()) pushIfMatching(s, 'Hermes')
  } catch (err) {
    logger.warn({ err }, 'hermes session scan failed')
  }

  runtimeSessions.sort((a, b) => b.startedAt - a.startedAt)

  return NextResponse.json({ threads, runtimeSessions })
}

export const dynamic = 'force-dynamic'
