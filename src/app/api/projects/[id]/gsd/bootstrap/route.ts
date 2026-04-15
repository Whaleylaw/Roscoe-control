import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { logger } from '@/lib/logger'
import { loadGsdTemplate } from '@/lib/gsd-templates'

/**
 * POST /api/projects/[id]/gsd/bootstrap — seed GSD default phase tasks.
 *
 * Phase 09 plan 03 (GSD-07, GSD-11, GSD-12, GSD-17, GSD-19).
 *
 * Loads the project's track template from disk (or DEFAULT_TEMPLATE on
 * soft miss per D-16) and creates the default phase task pack. Idempotent
 * per D-19 / Pitfall 3 — the existence check uses
 *   (project_id, gsd_phase, json_extract(metadata,'$.gsd_ticket_ref'))
 * so re-running on the same project is a no-op (created:0, skipped:N).
 *
 * task.created events are broadcast AFTER the transaction commits so SSE
 * subscribers always observe a committed row.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor =
      (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/gsd/bootstrap',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = Number.parseInt(id, 10)
    if (!Number.isFinite(projectId) || String(projectId) !== id.trim()) {
      return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })
    }

    const project = db
      .prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`)
      .get(projectId, workspaceId) as any
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found', code: 'PROJECT_NOT_FOUND' },
        { status: 404 },
      )
    }

    const template = loadGsdTemplate(project.gsd_track ?? null)
    const phases = ['discuss', 'plan', 'execute', 'verify'] as const
    let created = 0
    let skipped = 0
    const createdTasks: any[] = []

    const existsStmt = db.prepare(`
      SELECT id FROM tasks
      WHERE project_id = ? AND workspace_id = ? AND gsd_phase = ?
        AND json_extract(COALESCE(metadata, '{}'), '$.gsd_ticket_ref') = ?
      LIMIT 1
    `)
    const bumpCounter = db.prepare(`
      UPDATE projects SET ticket_counter = ticket_counter + 1, updated_at = unixepoch()
      WHERE id = ? AND workspace_id = ?
    `)
    const readCounter = db.prepare(
      `SELECT ticket_counter FROM projects WHERE id = ? AND workspace_id = ?`,
    )
    const insertTask = db.prepare(`
      INSERT INTO tasks (
        workspace_id, title, description, status, priority,
        project_id, project_ticket_no, created_by,
        gsd_phase, gate_required, gate_status,
        tags, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, 'backlog', 'medium', ?, ?, ?, ?, ?, ?, '[]', ?, unixepoch(), unixepoch())
    `)
    const readTask = db.prepare(`SELECT * FROM tasks WHERE id = ?`)

    const tx = db.transaction(() => {
      for (const phase of phases) {
        for (const entry of template.phases[phase]) {
          if (existsStmt.get(projectId, workspaceId, phase, entry.ticket_ref)) {
            skipped++
            continue
          }
          bumpCounter.run(projectId, workspaceId)
          const row = readCounter.get(projectId, workspaceId) as { ticket_counter: number }
          const gateStatus = entry.gate_required ? 'pending' : 'not_required'
          const result = insertTask.run(
            workspaceId,
            entry.title,
            entry.description ?? null,
            projectId,
            row.ticket_counter,
            auth.user.username,
            phase,
            entry.gate_required ? 1 : 0,
            gateStatus,
            JSON.stringify({ gsd_ticket_ref: entry.ticket_ref }),
          )
          created++
          const newTask = readTask.get(Number(result.lastInsertRowid))
          createdTasks.push(newTask)
        }
      }
    })
    tx()

    // Broadcast OUTSIDE the transaction so subscribers observe committed rows.
    for (const t of createdTasks) {
      eventBus.broadcast('task.created', { ...t, workspace_id: workspaceId })
    }

    db_helpers.logActivity(
      'project_gsd_bootstrap',
      'project',
      projectId,
      auth.user.username,
      `Bootstrapped ${created} task${created === 1 ? '' : 's'} (${skipped} skipped)`,
      { created, skipped, track: project.gsd_track || 'default' },
      workspaceId,
    )

    return NextResponse.json({ created, skipped, tasks: createdTasks }, { status: 200 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/gsd/bootstrap error')
    return NextResponse.json({ error: 'Bootstrap failed' }, { status: 500 })
  }
}
