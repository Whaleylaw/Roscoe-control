import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody, qualityReviewSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { eventBus } from '@/lib/event-bus'
import { advanceWorkflowAfterTaskApproval } from '@/lib/workflow-engine'
import { publishApprovedWorktreeForReview, type ReviewPrPublicationResult } from '@/lib/review-prs'
import { revokeTokensForTask } from '@/lib/runner-tokens'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const workspaceId = auth.user.workspace_id ?? 1;
    const taskIdsParam = searchParams.get('taskIds')
    const taskId = parseInt(searchParams.get('taskId') || '')

    if (taskIdsParam) {
      const ids = taskIdsParam
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter((id) => !Number.isNaN(id))

      if (ids.length === 0) {
        return NextResponse.json({ error: 'taskIds must include at least one numeric id' }, { status: 400 })
      }

      const placeholders = ids.map(() => '?').join(',')
      const rows = db.prepare(`
        SELECT * FROM quality_reviews
        WHERE task_id IN (${placeholders}) AND workspace_id = ?
        ORDER BY task_id ASC, created_at DESC
      `).all(...ids, workspaceId) as Array<{ task_id: number; reviewer?: string; status?: string; created_at?: number }>

      const byTask: Record<number, { status?: string; reviewer?: string; created_at?: number } | null> = {}
      for (const id of ids) {
        byTask[id] = null
      }

      for (const row of rows) {
        const existing = byTask[row.task_id]
        if (!existing || (row.created_at || 0) > (existing.created_at || 0)) {
          byTask[row.task_id] = { status: row.status, reviewer: row.reviewer, created_at: row.created_at }
        }
      }

      return NextResponse.json({ latest: byTask })
    }

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
    }

    const reviews = db.prepare(`
      SELECT * FROM quality_reviews
      WHERE task_id = ? AND workspace_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(taskId, workspaceId)

    return NextResponse.json({ reviews })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/quality-review error')
    return NextResponse.json({ error: 'Failed to fetch quality reviews' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const validated = await validateBody(request, qualityReviewSchema)
    if ('error' in validated) return validated.error
    const { taskId, reviewer, status, notes } = validated.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1;

    const task = db
      .prepare('SELECT id, title, status, workspace_id, recipe_slug, metadata, worktree_path, workspace_source FROM tasks WHERE id = ? AND workspace_id = ?')
      .get(taskId, workspaceId) as any
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    if (task.status !== 'quality_review') {
      return NextResponse.json({ error: `task is not in quality_review; current status is ${task.status}` }, { status: 409 })
    }

    // Auto-advance task based on review outcome
    let workflowAdvancement = null
    let reviewId: number | null = null
    if (status === 'approved') {
      let reviewPr: ReviewPrPublicationResult
      try {
        reviewPr = await publishApprovedWorktreeForReview(db, task)
      } catch (publicationErr: any) {
        const now = Math.floor(Date.now() / 1000)
        const message = publicationErr?.message || String(publicationErr)
        reviewId = db.transaction(() => {
          const blockedReview = db.prepare(`
            INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
            VALUES (?, ?, ?, ?, ?)
          `).run(taskId, reviewer, 'blocked', `Review PR publication failed after approval:\n${message}`, workspaceId)
          const insertedReviewId = Number(blockedReview.lastInsertRowid)
          db_helpers.logActivity(
            'quality_review',
            'task',
            taskId,
            reviewer,
            `Quality review blocked for task: ${task.title}`,
            { status: 'blocked', notes: `Review PR publication failed: ${message}` },
            workspaceId
          )
          db.prepare(`
            INSERT INTO comments (task_id, author, content, created_at, workspace_id)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            taskId,
            reviewer,
            `Quality review approved the work, but review PR publication failed:\n${message}\n\nThe task worktree was left intact for inspection. The base repository was not marked done and downstream workflow nodes were not advanced.`,
            now,
            workspaceId,
          )
          const transition = db.prepare(`
            UPDATE tasks
            SET status = ?, error_message = ?, updated_at = ?
            WHERE id = ? AND workspace_id = ? AND status = 'quality_review'
          `).run('quality_review', `Review PR publication failed: ${message}`, now, taskId, workspaceId)
          if (transition.changes !== 1) {
            throw new Error('task is no longer in quality_review')
          }
          return insertedReviewId
        })()
        eventBus.broadcast('task.status_changed', {
          id: taskId,
          status: 'quality_review',
          previous_status: task.status,
          error_message: `Review PR publication failed: ${message.substring(0, 300)}`,
          reason: 'review_pr_publication_failed',
          workspace_id: workspaceId,
          updated_at: now,
        })
        return NextResponse.json(
          {
            success: false,
            id: reviewId,
            error: 'Review PR publication failed',
            detail: message,
          },
          { status: 409 },
        )
      }

      if (reviewPr.published) {
        const now = Math.floor(Date.now() / 1000)
        reviewId = db.transaction(() => {
          const result = db.prepare(`
            INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
            VALUES (?, ?, ?, ?, ?)
          `).run(taskId, reviewer, status, notes, workspaceId)
          const insertedReviewId = Number(result.lastInsertRowid)
          db_helpers.logActivity(
            'quality_review',
            'task',
            taskId,
            reviewer,
            `Quality review ${status} for task: ${task.title}`,
            { status, notes },
            workspaceId
          )
          db.prepare(`
            INSERT INTO comments (task_id, author, content, created_at, workspace_id)
            VALUES (?, ?, ?, ?, ?)
          `).run(taskId, reviewer, `Review PR opened: ${reviewPr.pr_url}`, now, workspaceId)
          const transition = db.prepare(`
            UPDATE tasks
            SET status = 'quality_review',
                container_id = NULL,
                error_message = NULL,
                updated_at = ?
            WHERE id = ? AND workspace_id = ? AND status = 'quality_review'
          `).run(now, taskId, workspaceId)
          if (transition.changes !== 1) {
            throw new Error('task is no longer in quality_review')
          }
          revokeTokensForTask(db, taskId, now)
          return insertedReviewId
        })()
        eventBus.broadcast('task.status_changed', {
          id: taskId,
          status: 'quality_review',
          previous_status: task.status,
          reason: 'review_pr_opened',
          review_pr: reviewPr,
          workspace_id: workspaceId,
          updated_at: now,
        })
        return NextResponse.json({
          success: true,
          id: reviewId,
          review_pr: reviewPr,
          workflow_advancement: null,
        })
      }

      const directResult = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(taskId, reviewer, status, notes, workspaceId)
        const insertedReviewId = Number(result.lastInsertRowid)
        db_helpers.logActivity(
          'quality_review',
          'task',
          taskId,
          reviewer,
          `Quality review ${status} for task: ${task.title}`,
          { status, notes },
          workspaceId
        )
        const transition = db.prepare(`
          UPDATE tasks
          SET status = ?,
              container_id = NULL,
              error_message = NULL,
              completed_at = COALESCE(completed_at, unixepoch()),
              updated_at = unixepoch()
          WHERE id = ? AND workspace_id = ? AND status = 'quality_review'
        `)
          .run('done', taskId, workspaceId)
        if (transition.changes !== 1) {
          throw new Error('task is no longer in quality_review')
        }
        revokeTokensForTask(db, taskId, Math.floor(Date.now() / 1000))
        const advancement = advanceWorkflowAfterTaskApproval(db, {
          taskId,
          actor: reviewer,
          payload: {
            source: 'quality_review',
            quality_review_id: insertedReviewId,
            reviewer,
            status,
            notes,
            review_pr: reviewPr,
          },
          status: 'inbox',
        })
        return { reviewId: insertedReviewId, workflowAdvancement: advancement }
      })()
      reviewId = directResult.reviewId
      workflowAdvancement = directResult.workflowAdvancement
      eventBus.broadcast('task.status_changed', {
        id: taskId,
        status: 'done',
        previous_status: task.status,
        workspace_id: workspaceId,
        updated_at: Math.floor(Date.now() / 1000),
      })
    } else if (status === 'rejected') {
      reviewId = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(taskId, reviewer, status, notes, workspaceId)
        const insertedReviewId = Number(result.lastInsertRowid)
        db_helpers.logActivity(
          'quality_review',
          'task',
          taskId,
          reviewer,
          `Quality review ${status} for task: ${task.title}`,
          { status, notes },
          workspaceId
        )
        // Rejected: push back to in_progress with the rejection notes as error_message
        const transition = db.prepare(`
          UPDATE tasks
          SET status = ?, error_message = ?, updated_at = unixepoch()
          WHERE id = ? AND workspace_id = ? AND status = 'quality_review'
        `).run('in_progress', `Quality review rejected by ${reviewer}: ${notes}`, taskId, workspaceId)
        if (transition.changes !== 1) {
          throw new Error('task is no longer in quality_review')
        }
        return insertedReviewId
      })()
      eventBus.broadcast('task.status_changed', {
        id: taskId,
        status: 'in_progress',
        previous_status: task.status,
        workspace_id: workspaceId,
        updated_at: Math.floor(Date.now() / 1000),
      })
    }

    return NextResponse.json({ success: true, id: reviewId, review_pr: null, workflow_advancement: workflowAdvancement })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/quality-review error')
    return NextResponse.json({ error: 'Failed to create quality review' }, { status: 500 })
  }
}
