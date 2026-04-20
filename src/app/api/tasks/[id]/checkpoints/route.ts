/**
 * /api/tasks/:id/checkpoints — agent-posted checkpoint API + viewer timeline.
 *
 * Plan 15-04 (CP-01, CP-02, CP-05, CP-06, SCHED-06).
 *
 * POST (runner-token authenticated — see src/lib/runner-tokens.ts allowlist
 * entry 7 added in Plan 15-01; auth.ts runner-token prefix filter at
 * line 526+ also extended in 15-01):
 *   - Persists the checkpoint to task_checkpoints DB + <worktree>/.mc/checkpoints.jsonl
 *     atomically (writeCheckpoint helper). On any throw, DB rolls back and we
 *     truncate the JSONL back to its pre-call byte count.
 *   - Broadcasts task.checkpoint_added AFTER the transaction commits so SSE
 *     subscribers never see uncommitted state.
 *   - Cross-task 403 enforced defensively (auth.ts already guards, but a
 *     breakage upstream must not silently permit cross-task writes).
 *   - Task status != 'in_progress' → 409 idempotency guard.
 *
 * GET (viewer authenticated):
 *   - Returns checkpoints ordered by (attempt ASC, id ASC); optional ?attempt=N
 *     filter (CP-06).
 *   - Workspace-scoped: viewer sees a 404 for tasks outside their workspace.
 *
 * Plan 15-05 extension hook: the blocker state machine (in_progress →
 * awaiting_owner + auto-comment INSERT + docker stop) lands inside the SAME
 * writeCheckpoint transaction. Either (a) writeCheckpoint grows an optional
 * extraOps callback, or (b) route.ts unrolls writeCheckpoint and inlines the
 * blocker branch. See 15-04-SUMMARY.md for the trade-off.
 */

import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'
import {
  CheckpointBodySchema,
  readCheckpoints,
  writeCheckpoint,
  type CheckpointBody,
} from '@/lib/task-checkpoints'

// ---------- POST — agent-authored checkpoint ----------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // LOCKED 15-CONTEXT.md § Checkpoint Endpoint Auth Path:
  // POST /api/tasks/:id/checkpoints MUST be runner-token authenticated.
  // Allowlist entry added in Plan 15-01 (runner-tokens.ts #7);
  // auth.ts prefix filter also extended in 15-01.
  if (auth.user.id !== -2000) {
    return NextResponse.json(
      { error: 'runner-token principal required' },
      { status: 403 },
    )
  }

  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.id, 10)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }

  // Defense-in-depth cross-task check. The auth layer
  // (src/lib/auth.ts getUserFromRequest) already verifies the bearer's
  // embedded task_id matches the path :id — but a breakage upstream
  // must not silently permit cross-task writes.
  if (auth.user.runner_token_task_id !== taskId) {
    return NextResponse.json(
      { error: 'cross-task access forbidden' },
      { status: 403 },
    )
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: CheckpointBody
  try {
    const json = await request.json()
    const parsed = CheckpointBodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid checkpoint body', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    body = parsed.data
  } catch {
    return NextResponse.json(
      { error: 'Request body is not valid JSON' },
      { status: 400 },
    )
  }

  const db = getDatabase()
  const task = db
    .prepare(
      `SELECT id, status, worktree_path, runner_attempts, workspace_id
       FROM tasks WHERE id = ?`,
    )
    .get(taskId) as
    | {
        id: number
        status: string
        worktree_path: string | null
        runner_attempts: number
        workspace_id: number
      }
    | undefined

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  if (task.status !== 'in_progress') {
    return NextResponse.json(
      { error: `task status must be in_progress, got ${task.status}` },
      { status: 409 },
    )
  }

  // Snapshot JSONL size BEFORE the atomic write so the compensating truncate
  // can restore on failure. See Pitfall 8 in 15-RESEARCH.md for the
  // concurrent-writer ghost-line edge case — v1.2 accepts this as acceptable
  // staleness; the in-container pre-post JSONL (Phase 14 recipe) remains the
  // local audit source-of-truth if divergence matters.
  const jsonlPath = task.worktree_path
    ? path.join(task.worktree_path, '.mc', 'checkpoints.jsonl')
    : null
  let jsonlSizeBefore = 0
  if (jsonlPath && fs.existsSync(jsonlPath)) {
    try {
      jsonlSizeBefore = fs.statSync(jsonlPath).size
    } catch {
      jsonlSizeBefore = 0
    }
  }

  const attempt = task.runner_attempts

  let inserted: { id: number; attempt: number; ts: string; nowUnix: number }
  try {
    inserted = writeCheckpoint(db, taskId, attempt, task.worktree_path, body)
  } catch (err) {
    // Atomic rollback: DB transaction already rolled back by the throw in
    // writeCheckpoint's db.transaction wrapper. If the JSONL append landed
    // BEFORE the throw, truncate back to pre-call size.
    if (jsonlPath) {
      try {
        const nowSize = fs.existsSync(jsonlPath)
          ? fs.statSync(jsonlPath).size
          : 0
        if (nowSize > jsonlSizeBefore) {
          fs.truncateSync(jsonlPath, jsonlSizeBefore)
        }
      } catch {
        // Non-fatal cleanup — the DB rollback is the primary atomicity
        // guarantee; a JSONL ghost line is audit noise, not correctness.
      }
    }
    logger.error(
      { err, taskId, attempt },
      'POST /api/tasks/:id/checkpoints failed',
    )
    return NextResponse.json(
      { error: 'Failed to persist checkpoint' },
      { status: 500 },
    )
  }

  // Broadcast AFTER the transaction commits so SSE subscribers only see
  // committed state. Plan 15-05 extends this payload with blocker_reason
  // when status='blocked' (already done below — keeps the daemon SSE
  // handler wired for self-initiated docker stop when blocker hits).
  eventBus.broadcast('task.checkpoint_added', {
    checkpoint_id: inserted.id,
    task_id: taskId,
    attempt,
    status: body.status,
    step: body.step,
    workspace_id: task.workspace_id,
    ...(body.status === 'blocked' && body.blocker_reason
      ? { blocker_reason: body.blocker_reason }
      : {}),
  })

  return NextResponse.json(
    {
      id: inserted.id,
      attempt: inserted.attempt,
      ts: inserted.ts,
    },
    { status: 201 },
  )
}

// ---------- GET — viewer timeline (CP-06) ----------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.id, 10)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }

  const url = new URL(request.url)
  const attemptParam = url.searchParams.get('attempt')
  let attemptFilter: number | undefined
  if (attemptParam !== null) {
    const n = Number.parseInt(attemptParam, 10)
    if (!Number.isFinite(n) || n < 0 || String(n) !== attemptParam.trim()) {
      return NextResponse.json(
        { error: 'Invalid attempt parameter (must be non-negative integer)' },
        { status: 400 },
      )
    }
    attemptFilter = n
  }

  const db = getDatabase()
  // Workspace-scoping: viewer must share the task's workspace. Masquerade as
  // 404 (not 403) to avoid leaking task existence across workspaces.
  const task = db
    .prepare(`SELECT id, workspace_id FROM tasks WHERE id = ?`)
    .get(taskId) as { id: number; workspace_id: number } | undefined

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  const viewerWorkspace = auth.user.workspace_id ?? 1
  if (task.workspace_id !== viewerWorkspace) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  try {
    const checkpoints = readCheckpoints(
      db,
      taskId,
      attemptFilter !== undefined ? { attempt: attemptFilter } : undefined,
    )
    return NextResponse.json({ checkpoints }, { status: 200 })
  } catch (err) {
    logger.error({ err, taskId }, 'GET /api/tasks/:id/checkpoints error')
    return NextResponse.json(
      { error: 'Failed to fetch checkpoints' },
      { status: 500 },
    )
  }
}
