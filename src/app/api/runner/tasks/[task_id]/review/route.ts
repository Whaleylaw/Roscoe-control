import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { revokeTokensForTask } from '@/lib/runner-tokens'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'
import { publishApprovedWorktreeForReview, type ReviewPrPublicationResult } from '@/lib/review-prs'
import { advanceWorkflowAfterTaskApproval } from '@/lib/workflow-engine'

const Body = z.object({
  verdict: z.enum(['approved', 'rejected', 'blocked']),
  notes: z.string().min(1).max(10_000),
})

type TaskRow = {
  id: number
  title: string
  status: string
  project_id: number | null
  workspace_id: number
  recipe_slug: string | null
  worktree_path: string | null
  workspace_source: string | null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ task_id: string }> },
): Promise<NextResponse> {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (auth.user.id !== -2000) {
    return NextResponse.json({ error: 'runner-token principal required' }, { status: 403 })
  }

  const resolvedParams = await params
  const taskId = Number.parseInt(resolvedParams.task_id, 10)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }
  if (auth.user.runner_token_task_id !== taskId) {
    return NextResponse.json({ error: 'cross-task access forbidden' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: z.infer<typeof Body>
  try {
    const json = await request.json()
    const parsed = Body.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', issues: parsed.error.issues }, { status: 400 })
    }
    body = parsed.data
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const task = db.prepare(`
      SELECT id, title, status, project_id, workspace_id, recipe_slug, worktree_path, workspace_source
      FROM tasks
      WHERE id = ?
    `).get(taskId) as TaskRow | undefined

    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (task.status !== 'quality_review') {
      return NextResponse.json({ error: `task is not in quality_review; current status is ${task.status}` }, { status: 409 })
    }

    const now = Math.floor(Date.now() / 1000)

    if (body.verdict === 'approved') {
      let reviewPr: ReviewPrPublicationResult
      try {
        reviewPr = await publishApprovedWorktreeForReview(db, task)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        db.transaction(() => {
          db.prepare(`
            INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
            VALUES (?, 'recipe-reviewer', 'blocked', ?, ?)
          `).run(taskId, `Review PR publication failed after recipe review approval:\n${message}`, task.workspace_id)
          db.prepare(`
            INSERT INTO comments (task_id, author, content, created_at, workspace_id)
            VALUES (?, 'recipe-reviewer', ?, ?, ?)
          `).run(taskId, `Quality Review approved the work, but review PR publication failed:\n${message}`, now, task.workspace_id)
          db.prepare(`
            UPDATE tasks
            SET status = 'quality_review',
                container_id = NULL,
                error_message = ?,
                updated_at = ?
            WHERE id = ?
          `).run(`Review PR publication failed: ${message}`, now, taskId)
          revokeTokensForTask(db, taskId, now)
        })()
        eventBus.broadcast('task.status_changed', {
          task_id: taskId,
          status: 'quality_review',
          previous_status: 'quality_review',
          reason: 'review_pr_publication_failed',
          error_message: `Review PR publication failed: ${message.substring(0, 300)}`,
          workspace_id: task.workspace_id,
          at: now,
        })
        return new NextResponse(null, { status: 204 })
      }

      if (reviewPr.published) {
        db.transaction(() => {
          db.prepare(`
            INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
            VALUES (?, 'recipe-reviewer', 'approved', ?, ?)
          `).run(taskId, body.notes, task.workspace_id)
          db.prepare(`
            INSERT INTO comments (task_id, author, content, created_at, workspace_id)
            VALUES (?, 'recipe-reviewer', ?, ?, ?)
          `).run(taskId, `Quality Review Approved:\n${body.notes}\n\nReview PR opened: ${reviewPr.pr_url}`, now, task.workspace_id)
          db.prepare(`
            UPDATE tasks
            SET status = 'quality_review',
                container_id = NULL,
                error_message = NULL,
                updated_at = ?
            WHERE id = ? AND status = 'quality_review'
          `).run(now, taskId)
          revokeTokensForTask(db, taskId, now)
        })()

        eventBus.broadcast('task.status_changed', {
          task_id: taskId,
          status: 'quality_review',
          previous_status: 'quality_review',
          reason: 'review_pr_opened',
          review_pr: reviewPr,
          workspace_id: task.workspace_id,
          at: now,
        })
        return new NextResponse(null, { status: 204 })
      }

      db.transaction(() => {
        db.prepare(`
          INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
          VALUES (?, 'recipe-reviewer', 'approved', ?, ?)
        `).run(taskId, body.notes, task.workspace_id)
        db.prepare(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, 'recipe-reviewer', ?, ?, ?)
        `).run(taskId, `Quality Review Approved:\n${body.notes}`, now, task.workspace_id)
        const transition = db.prepare(`
          UPDATE tasks
          SET status = 'done',
              container_id = NULL,
              error_message = NULL,
              completed_at = COALESCE(completed_at, ?),
              updated_at = ?
          WHERE id = ? AND status = 'quality_review'
        `).run(now, now, taskId)
        if (transition.changes !== 1) {
          throw new Error('task is no longer in quality_review')
        }
        revokeTokensForTask(db, taskId, now)
        advanceWorkflowAfterTaskApproval(db, {
          taskId,
          actor: 'recipe-reviewer',
          payload: {
            verdict: 'approved',
            notes: body.notes,
            review_pr: reviewPr,
          },
          now,
        })
      })()

      eventBus.broadcast('task.status_changed', {
        task_id: taskId,
        status: 'done',
        previous_status: 'quality_review',
        review_pr: reviewPr,
        workspace_id: task.workspace_id,
        at: now,
      })
      return new NextResponse(null, { status: 204 })
    }

    if (body.verdict === 'rejected') {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
          VALUES (?, 'recipe-reviewer', 'rejected', ?, ?)
        `).run(taskId, body.notes, task.workspace_id)
        db.prepare(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, 'recipe-reviewer', ?, ?, ?)
        `).run(taskId, `Quality Review Rejected:\n${body.notes}`, now, task.workspace_id)
        db.prepare(`
          UPDATE tasks
          SET status = 'assigned',
              container_id = NULL,
              error_message = ?,
              updated_at = ?
          WHERE id = ? AND status = 'quality_review'
        `).run(`Recipe review rejected: ${body.notes.slice(0, 1000)}`, now, taskId)
        revokeTokensForTask(db, taskId, now)
      })()
      eventBus.broadcast('task.status_changed', {
        task_id: taskId,
        status: 'assigned',
        previous_status: 'quality_review',
        reason: 'recipe_review_rejected',
        workspace_id: task.workspace_id,
        at: now,
      })
      eventBus.broadcast('task.runner_requested', {
        task_id: taskId,
        recipe_slug: task.recipe_slug,
        workspace_id: task.workspace_id,
      })
      return new NextResponse(null, { status: 204 })
    }

    db.transaction(() => {
      db.prepare(`
        INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
        VALUES (?, 'recipe-reviewer', 'blocked', ?, ?)
      `).run(taskId, body.notes, task.workspace_id)
      db.prepare(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, 'recipe-reviewer', ?, ?, ?)
      `).run(taskId, `Quality Review Blocked:\n${body.notes}`, now, task.workspace_id)
      db.prepare(`
        UPDATE tasks
        SET status = 'quality_review',
            container_id = NULL,
            error_message = ?,
            updated_at = ?
        WHERE id = ? AND status = 'quality_review'
      `).run(`Recipe review blocked: ${body.notes.slice(0, 1000)}`, now, taskId)
      revokeTokensForTask(db, taskId, now)
    })()
    eventBus.broadcast('task.status_changed', {
      task_id: taskId,
      status: 'quality_review',
      previous_status: 'quality_review',
      reason: 'recipe_review_blocked',
      workspace_id: task.workspace_id,
      at: now,
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    logger.error({ err: error, taskId }, 'POST /api/runner/tasks/:task_id/review error')
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }
}
