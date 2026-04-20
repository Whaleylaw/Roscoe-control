import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * GET /api/runner/ready-tasks — tasks the runner daemon can claim.
 *
 * Auth: runner-secret principal only (user.id === -1000). 403 otherwise.
 *
 * Query shape — tasks that are:
 *   - status = 'assigned' (the scheduler-assigned-to-runner lane)
 *   - recipe_slug IS NOT NULL (recipe-mode execution — non-recipe tasks
 *     are agent-or-human work and do NOT go to the runner)
 *   - container_id IS NULL (not yet claimed by any runner)
 *
 * Ordered id ASC to preserve creation-order fairness. LIMIT 50 caps the
 * response to a single poll's worth — the runner polls every 15s (Phase 14
 * CONTEXT.md boot sequence step 5) with SSE as the primary trigger, so this
 * is a fallback and a coarse batch is enough.
 *
 * Response: { tasks: [...] } with a narrow column subset tuned for the claim
 * payload builder (Plan 14-05). JSON columns are parsed server-side.
 */

type ReadyTaskRow = {
  id: number
  recipe_slug: string
  model_override: string | null
  workspace_source: string | null
  read_only_mounts: string | null
  extra_skills: string | null
  runner_max_attempts: number | null
  runner_attempts: number
}

type ReadyTaskResponse = {
  id: number
  recipe_slug: string
  model_override: string | null
  workspace_source: unknown
  read_only_mounts: unknown[]
  extra_skills: unknown[]
  runner_max_attempts: number | null
  runner_attempts: number
}

function mapRow(row: ReadyTaskRow): ReadyTaskResponse {
  // Narrow subset of mapTaskRow from src/app/api/tasks/route.ts — only the
  // runtime-context columns the runner needs to build the claim dispatch.
  return {
    id: row.id,
    recipe_slug: row.recipe_slug,
    model_override: row.model_override,
    workspace_source: row.workspace_source ? JSON.parse(row.workspace_source) : null,
    read_only_mounts: row.read_only_mounts ? JSON.parse(row.read_only_mounts) : [],
    extra_skills: row.extra_skills ? JSON.parse(row.extra_skills) : [],
    runner_max_attempts: row.runner_max_attempts,
    runner_attempts: row.runner_attempts,
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (auth.user.id !== -1000) {
    return NextResponse.json(
      { error: 'runner-secret principal required' },
      { status: 403 },
    )
  }

  try {
    const db = getDatabase()
    const rows = db
      .prepare(
        `SELECT id, recipe_slug, model_override, workspace_source, read_only_mounts,
                extra_skills, runner_max_attempts, runner_attempts
         FROM tasks
         WHERE status = 'assigned'
           AND recipe_slug IS NOT NULL
           AND container_id IS NULL
         ORDER BY id ASC
         LIMIT 50`,
      )
      .all() as ReadyTaskRow[]

    return NextResponse.json({ tasks: rows.map(mapRow) })
  } catch (err) {
    logger.error({ err }, 'GET /api/runner/ready-tasks — DB error')
    return NextResponse.json({ error: 'Failed to load ready tasks' }, { status: 500 })
  }
}
