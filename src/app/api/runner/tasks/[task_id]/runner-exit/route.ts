import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { eventBus } from '@/lib/event-bus'
import { revokeTokensForTask } from '@/lib/runner-tokens'
import { resolveRecipeMaxAttempts } from '@/lib/runner-claim'

/**
 * POST /api/runner/tasks/:task_id/runner-exit
 *
 * Daemon-side reporting endpoint the runner calls after a container exits
 * (normal, timeout, crash, OOM, docker_error, worktree_create_failed).
 *
 * Responsibilities:
 *   1. Persist the attempt outcome onto the `task_runner_attempts` row that
 *      the claim route (Plan 14-05) pre-inserted.
 *   2. Drive the retry vs fail state machine based on the resolved cap
 *      (`task.runner_max_attempts ?? recipe.max_attempts ?? 3`).
 *   3. On terminal fail, revoke runner-tokens for the task atomically with
 *      the status UPDATE — matches the Phase 11-04 terminal-revocation
 *      invariant.
 *
 * Non-responsibilities:
 *   - Successful exits (exit_code=0, reason='exit') DO NOT flip task.status
 *     to `done` here. The agent owns the terminal flip via the upcoming
 *     POST /api/runner/tasks/:task_id/submit endpoint (Plan 14-11). This
 *     handler only persists the attempt row and returns 204 — the status
 *     and container_id stay put for the /submit caller to transition.
 *
 * Auth: runner-SECRET (user.id === -1000). The runner-TOKEN (id=-2000) may
 * already be expired at container-exit time, so the daemon authenticates
 * with the long-lived runner secret. Path starts with `/api/runner/`, so
 * `src/lib/auth.ts` resolves the runner-secret branch first.
 *
 * Rate limit: mutationLimiter (default 60/min per IP) — matches the
 * precedent established by the heartbeat + recipes mutation routes.
 *
 * Response codes:
 *   204  Success (attempt persisted, state machine advanced if applicable)
 *   400  Invalid body (bad JSON, Zod failures) or non-positive task_id
 *   401  Authentication required (requireRole 401)
 *   403  Caller is authenticated but NOT the runner-secret principal
 *   404  Task not found
 *   409  Task already in a terminal status (idempotency guard)
 *   500  DB error while persisting / transitioning
 */

const RunnerExitBodySchema = z.object({
  exit_code: z.number().int().nullable(),
  reason: z.enum([
    'exit',
    'timeout',
    'oom',
    'crash',
    'worktree_create_failed',
    'docker_error',
  ]),
  stderr_tail: z.string().max(16_384).optional(),
  attempt: z.number().int().min(1),
})

type RunnerExitReason = z.infer<typeof RunnerExitBodySchema>['reason']

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled'])

interface TaskRow {
  id: number
  status: string
  recipe_slug: string | null
  runner_attempts: number | null
  runner_max_attempts: number | null
  container_id: string | null
  runner_started_at: number | null
  workspace_id: number
}

/**
 * Build the failure_reason string persisted on `tasks.runner_last_failure_reason`
 * and on `task_runner_attempts.failure_reason`.
 *
 * Matches the locked decision: `reason='exit' && exit_code != null` → `exit:${exit_code}`
 * so the UI can distinguish exit codes of failed runs; all other reasons
 * stringify to themselves (`timeout`, `oom`, `crash`, `worktree_create_failed`,
 * `docker_error`).
 */
function formatFailureReason(reason: RunnerExitReason, exitCode: number | null): string {
  if (reason === 'exit' && exitCode !== null) return `exit:${exitCode}`
  return reason
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ task_id: string }> },
) {
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

  const limited = mutationLimiter(request)
  if (limited) return limited

  const { task_id: taskIdParam } = await params
  const taskId = Number.parseInt(taskIdParam, 10)
  if (!Number.isFinite(taskId) || taskId <= 0 || String(taskId) !== taskIdParam) {
    return NextResponse.json({ error: 'Invalid task_id' }, { status: 400 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = RunnerExitBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid runner-exit body', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { exit_code, reason, stderr_tail, attempt } = parsed.data

  let db: ReturnType<typeof getDatabase>
  try {
    db = getDatabase()
  } catch (err) {
    logger.error({ err, task_id: taskId }, 'runner-exit: getDatabase failed')
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }

  const task = db
    .prepare(
      `SELECT id, status, recipe_slug, runner_attempts, runner_max_attempts,
              container_id, runner_started_at, workspace_id
       FROM tasks
       WHERE id = ?`,
    )
    .get(taskId) as TaskRow | undefined

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  // Idempotency: if the task is already terminal (e.g., another code path
  // raced us, or the daemon retried after a previous successful call), do
  // not mutate further. 409 signals "already handled" — callers can drop
  // the retry safely.
  if (TERMINAL_STATUSES.has(task.status)) {
    return NextResponse.json(
      { error: 'Task is already terminal', status: task.status },
      { status: 409 },
    )
  }

  // Resolve the effective cap: task override > recipe.yaml > default 3.
  // `resolveRecipeMaxAttempts` re-parses recipe.yaml from disk (LOCKED per
  // Phase 14-02 / 14-05 / 14-06 decisions). `getIndexedRecipeBySlug` does
  // NOT surface max_attempts.
  const recipeMaxAttempts = task.recipe_slug
    ? resolveRecipeMaxAttempts(task.recipe_slug)
    : undefined
  const resolvedMaxAttempts = task.runner_max_attempts ?? recipeMaxAttempts ?? 3

  const runnerAttempts = task.runner_attempts ?? 0
  const failureReason = formatFailureReason(reason, exit_code)
  const nowUnix = Math.floor(Date.now() / 1000)

  const isSuccessfulExit = exit_code === 0 && reason === 'exit'
  const shouldFail =
    !isSuccessfulExit &&
    (runnerAttempts >= resolvedMaxAttempts || reason === 'worktree_create_failed')

  // Snapshot the container_id BEFORE the transaction — the retry / fail
  // branches NULL it out as part of the state transition, but the
  // task.container_exited broadcast wants the container the runner just
  // reported on (Plan 15-06 task.container_started uses the same convention).
  const exitedContainerId = task.container_id

  try {
    db.transaction(() => {
      // 1. Always persist the attempt row update — exit_code/failure_reason/
      //    stderr_tail land on the row inserted by the claim route.
      const upd = db
        .prepare(
          `UPDATE task_runner_attempts
             SET exited_at = ?,
                 exit_code = ?,
                 failure_reason = ?,
                 stderr_tail = ?
           WHERE task_id = ? AND attempt = ?`,
        )
        .run(
          nowUnix,
          exit_code,
          failureReason,
          stderr_tail ?? null,
          taskId,
          attempt,
        )

      if (upd.changes === 0) {
        // Defensive: the claim route should have inserted the row. Zero
        // changes means either (a) the daemon reported a different attempt
        // number than claim issued, or (b) the claim-route invariant broke.
        // Log and proceed with the status transition — losing attempt
        // history is strictly preferable to wedging the state machine.
        logger.warn(
          { task_id: taskId, attempt },
          'runner-exit: task_runner_attempts UPDATE affected 0 rows; proceeding with status transition',
        )
      }

      // 2. If another runner endpoint already moved the task out of the
      //    in-progress runtime state, do not clobber that handoff. This covers
      //    blocked recipe checkpoints that move to review before docker wait
      //    posts runner-exit.
      if (task.status !== 'in_progress') {
        if (!isSuccessfulExit && task.status === 'quality_review') {
          db.prepare(
            `UPDATE tasks
               SET container_id = NULL,
                   runner_started_at = NULL,
                   runner_last_failure_reason = ?,
                   updated_at = ?
             WHERE id = ?
               AND status = 'quality_review'`,
          ).run(failureReason, nowUnix, taskId)
        }
        return
      }

      // 3. Successful exits do NOT flip tasks.status here. The agent owns
      //    the terminal flip via /submit (Plan 14-11). Exit early after
      //    persisting the attempt row.
      if (isSuccessfulExit) return

      if (shouldFail) {
        // Terminal fail path.
        //  - status → 'failed'
        //  - container_id cleared so reconciliation doesn't re-adopt
        //  - runner_last_failure_reason populated for the UI
        //  - WHERE guard prevents clobbering a raced terminal transition
        db.prepare(
          `UPDATE tasks
             SET status = 'failed',
                 container_id = NULL,
                 runner_last_failure_reason = ?,
                 updated_at = ?
           WHERE id = ?
             AND status NOT IN ('done', 'failed', 'cancelled')`,
        ).run(failureReason, nowUnix, taskId)

        // Atomic token revocation — inside the same transaction as the
        // status UPDATE so a crash rolls BOTH back. Mirrors the Phase 11-04
        // wiring on src/app/api/tasks/[id]/route.ts.
        revokeTokensForTask(db, taskId, nowUnix)
      } else {
        // Retry path.
        //  - status → 'assigned' so the claim loop picks it up again
        //  - container_id cleared so a fresh claim can reassign
        //  - runner_started_at cleared so it re-records on next claim
        //  - runner_last_failure_reason populated for observability
        //  - WHERE guard limits to the current in-flight status to avoid
        //    reverting a state the scheduler already moved
        db.prepare(
          `UPDATE tasks
             SET status = 'assigned',
                 container_id = NULL,
                 runner_started_at = NULL,
                 runner_last_failure_reason = ?,
                 updated_at = ?
           WHERE id = ?
             AND status = 'in_progress'`,
        ).run(failureReason, nowUnix, taskId)
      }
    })()
  } catch (err) {
    logger.error(
      { err, task_id: taskId, attempt },
      'runner-exit: transaction failed',
    )
    return NextResponse.json(
      { error: 'Failed to persist runner exit' },
      { status: 500 },
    )
  }

  // Phase 15 SCHED-06: broadcast task.container_exited for every exit so
  // observers (Phase 16 UI, integration tests) see the container go down.
  // Blocker-override rule: when the task is in `awaiting_owner` status post-
  // transaction, the blocker checkpoint flow flipped it before the runner-
  // exit arrived. Override the reported reason to 'blocked' so the UI sees
  // a coherent story (the docker stop was triggered by the blocker, not by
  // the agent's own exit code).
  let exitReasonForBroadcast: string = reason
  let freshStatus: string | null = null
  try {
    const fresh = db
      .prepare(`SELECT status FROM tasks WHERE id = ?`)
      .get(taskId) as { status: string } | undefined
    freshStatus = fresh?.status ?? null
    if (fresh?.status === 'awaiting_owner') {
      exitReasonForBroadcast = 'blocked'
    }
  } catch (err) {
    // Defensive — broadcast falls back to the runner-reported reason. The
    // primary state transition already committed; failing the SELECT here
    // must not 500 the response.
    logger.warn(
      { err, task_id: taskId },
      'runner-exit: post-transaction status SELECT failed; using runner-reported reason',
    )
  }

  if (!isSuccessfulExit && freshStatus) {
    eventBus.broadcast('task.status_changed', {
      id: taskId,
      task_id: taskId,
      status: freshStatus,
      previous_status: 'in_progress',
      container_id: null,
      runner_last_failure_reason: failureReason,
      workspace_id: task.workspace_id,
      at: nowUnix,
    })
  }

  eventBus.broadcast('task.container_exited', {
    id: taskId,
    task_id: taskId,
    attempt,
    reason: exitReasonForBroadcast,
    exit_code: exit_code ?? null,
    container_id: exitedContainerId,
    workspace_id: task.workspace_id,
  })

  // Phase 15 SCHED-05 (third emission point): when the retry branch flipped
  // the task back to `assigned` and the task carries a recipe_slug, re-emit
  // task.runner_requested so the daemon knows to claim. The daemon's claim
  // path is idempotent (runner-token mint by task_id+attempt), so duplicates
  // from poll/SSE overlap are safe.
  //
  // Gate: only fires when (a) the post-transaction status is `assigned` AND
  // (b) the task carries a recipe_slug. The gate is intentionally tight —
  // we only re-emit on the retry path's actual transition to assigned.
  if (!isSuccessfulExit && !shouldFail && task.recipe_slug) {
    const retryTask = db
      .prepare(`SELECT status FROM tasks WHERE id = ?`)
      .get(taskId) as { status: string } | undefined
    if (retryTask?.status === 'assigned') {
      eventBus.broadcast('task.runner_requested', {
        task_id: taskId,
        recipe_slug: task.recipe_slug,
        workspace_id: task.workspace_id,
      })
    }
  }

  return new NextResponse(null, { status: 204 })
}
