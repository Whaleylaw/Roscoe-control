import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase, Task, db_helpers } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { validateBody, createTaskSchema, bulkUpdateTaskStatusSchema } from '@/lib/validation';
import { resolveMentionRecipients } from '@/lib/mentions';
import { normalizeTaskCreateStatus } from '@/lib/task-status';
import { pushTaskToGitHub, syncTaskOutbound } from '@/lib/github-sync-engine';
import { pushTaskToGnap } from '@/lib/gnap-sync';
import { config } from '@/lib/config';
import { getIndexedRecipeBySlug } from '@/lib/recipe-indexer';
import { getMountsCap, getExtraSkillsCap } from '@/lib/task-runtime-settings';
import {
  validateHostPathAgainstAllowlist,
  buildAggregatedValidationResponse,
  zodErrorToIssues,
  TASK_RUNTIME_ERROR_CODES,
  type TaskRuntimeValidationIssue,
} from '@/lib/task-runtime-validation';

function formatTicketRef(prefix?: string | null, num?: number | null): string | undefined {
  if (!prefix || typeof num !== 'number' || !Number.isFinite(num) || num <= 0) return undefined
  return `${prefix}-${String(num).padStart(3, '0')}`
}

function mapTaskRow(task: any): Task & {
  tags: string[]
  metadata: Record<string, unknown>
  workspace_source: { project_id: number; base_ref: string } | null
  read_only_mounts: Array<{ host_path: string; container_path: string; label: string }>
  extra_skills: string[]
  review_pr: { provider: string; pr_number: number; pr_url: string; state: string } | null
} {
  return {
    ...task,
    tags: task.tags ? JSON.parse(task.tags) : [],
    metadata: task.metadata ? JSON.parse(task.metadata) : {},
    // Phase 13 runtime-context JSON columns. Default to null / [] for
    // pre-Phase-13 rows where the column is NULL.
    workspace_source: task.workspace_source ? JSON.parse(task.workspace_source) : null,
    read_only_mounts: task.read_only_mounts ? JSON.parse(task.read_only_mounts) : [],
    extra_skills: task.extra_skills ? JSON.parse(task.extra_skills) : [],
    review_pr: task.review_pr ? JSON.parse(task.review_pr) : null,
    ticket_ref: formatTicketRef(task.project_prefix, task.project_ticket_no),
  }
}

function resolveProjectId(db: ReturnType<typeof getDatabase>, workspaceId: number, requestedProjectId?: number): number {
  if (typeof requestedProjectId === 'number' && Number.isFinite(requestedProjectId)) {
    const project = db.prepare(`
      SELECT id FROM projects
      WHERE id = ? AND workspace_id = ? AND status = 'active'
      LIMIT 1
    `).get(requestedProjectId, workspaceId) as { id: number } | undefined
    if (project) return project.id
  }

  const fallback = db.prepare(`
    SELECT id FROM projects
    WHERE workspace_id = ? AND status = 'active'
    ORDER BY CASE WHEN slug = 'general' THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `).get(workspaceId) as { id: number } | undefined

  if (!fallback) {
    throw new Error('No active project available in workspace')
  }
  return fallback.id
}

function hasAegisApproval(db: ReturnType<typeof getDatabase>, taskId: number, workspaceId: number): boolean {
  const review = db.prepare(`
    SELECT status FROM quality_reviews
    WHERE task_id = ? AND reviewer = 'aegis' AND workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(taskId, workspaceId) as { status?: string } | undefined
  return review?.status === 'approved'
}

/**
 * GET /api/tasks - List all tasks with optional filtering
 * Query params: status, assigned_to, priority, project_id, limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id;
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const status = searchParams.get('status');
    const assigned_to = searchParams.get('assigned_to');
    const priority = searchParams.get('priority');
    const projectIdParam = Number.parseInt(searchParams.get('project_id') || '', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    
    // Build dynamic query
    let query = `
      SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix,
        (SELECT json_object(
          'provider', r.provider,
          'pr_number', r.pr_number,
          'pr_url', r.pr_url,
          'state', r.state
        )
         FROM task_review_prs r
         WHERE r.task_id = t.id AND r.workspace_id = t.workspace_id
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT 1) as review_pr,
        (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id AND c.workspace_id = t.workspace_id) as comment_count
      FROM tasks t
      LEFT JOIN projects p
        ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.workspace_id = ?
    `;
    const params: any[] = [workspaceId];
    
    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }
    
    if (assigned_to) {
      query += ' AND t.assigned_to = ?';
      params.push(assigned_to);
    }
    
    if (priority) {
      query += ' AND t.priority = ?';
      params.push(priority);
    }

    if (Number.isFinite(projectIdParam)) {
      query += ' AND t.project_id = ?';
      params.push(projectIdParam);
    }
    
    query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const stmt = db.prepare(query);
    const tasks = stmt.all(...params) as Task[];
    
    // Parse JSON fields
    const tasksWithParsedData = tasks.map(mapTaskRow);
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM tasks WHERE workspace_id = ?';
    const countParams: any[] = [workspaceId];
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    if (assigned_to) {
      countQuery += ' AND assigned_to = ?';
      countParams.push(assigned_to);
    }
    if (priority) {
      countQuery += ' AND priority = ?';
      countParams.push(priority);
    }
    if (Number.isFinite(projectIdParam)) {
      countQuery += ' AND project_id = ?';
      countParams.push(projectIdParam);
    }
    const countRow = db.prepare(countQuery).get(...countParams) as { total: number };

    return NextResponse.json({ tasks: tasksWithParsedData, total: countRow.total, page: Math.floor(offset / limit) + 1, limit });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks error');
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

/**
 * POST /api/tasks - Create a new task
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id;

    // Phase 13 — manual Zod parse so every Phase-13 runtime-context body error
    // (recipe_slug regex, workspace_source refine, duplicate labels/basenames,
    // unknown model_override) surfaces through the aggregated { errors: [...] }
    // shape alongside the business-rule checks below. validateBody's legacy
    // { error: 'Validation failed', details: [...] } shape is used by 60+ other
    // endpoints — we keep it intact and only diverge HERE.
    let body: z.infer<typeof createTaskSchema>
    try {
      const json = await request.json()
      const parsed = createTaskSchema.safeParse(json)
      if (!parsed.success) {
        return buildAggregatedValidationResponse(zodErrorToIssues(parsed.error))
      }
      body = parsed.data
    } catch {
      return buildAggregatedValidationResponse([
        {
          field: '(root)',
          code: TASK_RUNTIME_ERROR_CODES.INVALID_FIELD,
          message: 'Request body is not valid JSON',
          hint: 'Send a JSON object with a Content-Type: application/json header.',
        },
      ])
    }

    // Phase 13 — runtime-context BUSINESS RULES (TCTX-01..06). Collects every
    // failure across all checks before returning so the caller sees all validation
    // errors in one response (CONTEXT.md: "aggregated in a single 400 Bad Request").
    const runtimeIssues: TaskRuntimeValidationIssue[] = []
    let resolvedRecipe: ReturnType<typeof getIndexedRecipeBySlug> = null

    if (body.recipe_slug) {
      resolvedRecipe = getIndexedRecipeBySlug(body.recipe_slug)
      if (resolvedRecipe === null) {
        runtimeIssues.push({
          field: 'recipe_slug',
          code: TASK_RUNTIME_ERROR_CODES.RECIPE_NOT_FOUND,
          message: `recipe_slug '${body.recipe_slug}' does not reference an indexed recipe`,
          hint: 'Verify the slug via GET /api/recipes/:slug or POST /api/recipes/resync.',
        })
      } else if ('error_message' in resolvedRecipe && resolvedRecipe.error_message !== null) {
        runtimeIssues.push({
          field: 'recipe_slug',
          code: TASK_RUNTIME_ERROR_CODES.RECIPE_BROKEN,
          message: `recipe_slug '${body.recipe_slug}' references a broken recipe: ${resolvedRecipe.error_message}`,
          hint: 'Fix the recipe under recipes/<slug>/ and wait for the watcher to re-index, or call POST /api/recipes/resync.',
        })
        resolvedRecipe = null
      } else {
        // resolvedRecipe is RecipeRow (fully indexed, error_message === null)
        if (resolvedRecipe.workspace_mode === 'worktree' && !body.workspace_source) {
          runtimeIssues.push({
            field: 'workspace_source',
            code: TASK_RUNTIME_ERROR_CODES.REQUIRED_BY_RECIPE,
            message: `recipe '${body.recipe_slug}' declares workspace: worktree — task must carry workspace_source`,
            hint: 'Supply workspace_source: { project_id, base_ref } in the same request.',
          })
        }
      }
    }

    // Cap checks — apply regardless of recipe resolution state.
    const mountsCap = getMountsCap()
    if (body.read_only_mounts && body.read_only_mounts.length > mountsCap) {
      runtimeIssues.push({
        field: 'read_only_mounts',
        code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED,
        message: `read_only_mounts has ${body.read_only_mounts.length} entries; the configured cap is ${mountsCap}`,
        hint: `Reduce the list to at most ${mountsCap} entries, or ask an admin to raise 'runtime.read_only_mounts_cap'.`,
      })
    }
    const skillsCap = getExtraSkillsCap()
    if (body.extra_skills && body.extra_skills.length > skillsCap) {
      runtimeIssues.push({
        field: 'extra_skills',
        code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED,
        message: `extra_skills has ${body.extra_skills.length} entries; the configured cap is ${skillsCap}`,
        hint: `Reduce the list to at most ${skillsCap} entries, or ask an admin to raise 'runtime.extra_skills_cap'.`,
      })
    }

    // Allowlist checks for every host_path + extra_skill path.
    if (body.read_only_mounts) {
      for (let i = 0; i < body.read_only_mounts.length; i++) {
        const mount = body.read_only_mounts[i]
        const result = await validateHostPathAgainstAllowlist(mount.host_path)
        if (!result.ok) {
          runtimeIssues.push({
            field: `read_only_mounts.${i}.host_path`,
            code: result.code,
            message: result.message,
            hint: result.hint,
          })
        }
      }
    }
    if (body.extra_skills) {
      for (let i = 0; i < body.extra_skills.length; i++) {
        const result = await validateHostPathAgainstAllowlist(body.extra_skills[i])
        if (!result.ok) {
          runtimeIssues.push({
            field: `extra_skills.${i}`,
            code: result.code,
            message: result.message,
            hint: result.hint,
          })
        }
      }
    }

    if (runtimeIssues.length > 0) {
      return buildAggregatedValidationResponse(runtimeIssues)
    }

    const user = auth.user
    const actor = user.display_name || user.username || 'system'
    const {
      title,
      description,
      status,
      priority = 'medium',
      project_id,
      assigned_to,
      due_date,
      estimated_hours,
      actual_hours,
      outcome,
      error_message,
      resolution,
      feedback_rating,
      feedback_notes,
      retry_count = 0,
      completed_at,
      tags = [],
      metadata = {}
    } = body;
    const normalizedStatus = normalizeTaskCreateStatus(status, assigned_to)

    // Resolve project_id for the task
    const resolvedProjectId = resolveProjectId(db, workspaceId, project_id)
    
    const now = Math.floor(Date.now() / 1000);
    const mentionResolution = resolveMentionRecipients(description || '', db, workspaceId);
    if (mentionResolution.unresolved.length > 0) {
      return NextResponse.json({
        error: `Unknown mentions: ${mentionResolution.unresolved.map((m) => `@${m}`).join(', ')}`,
        missing_mentions: mentionResolution.unresolved
      }, { status: 400 });
    }

    const resolvedCompletedAt = completed_at ?? (normalizedStatus === 'done' ? now : null)

    const createTaskTx = db.transaction(() => {
      db.prepare(`
        UPDATE projects
        SET ticket_counter = ticket_counter + 1, updated_at = unixepoch()
        WHERE id = ? AND workspace_id = ?
      `).run(resolvedProjectId, workspaceId)
      const row = db.prepare(`
        SELECT ticket_counter FROM projects
        WHERE id = ? AND workspace_id = ?
      `).get(resolvedProjectId, workspaceId) as { ticket_counter: number } | undefined
      if (!row || !row.ticket_counter) throw new Error('Failed to allocate project ticket number')

      const insertStmt = db.prepare(`
        INSERT INTO tasks (
          title, description, status, priority, project_id, project_ticket_no, assigned_to, created_by,
          created_at, updated_at, due_date, estimated_hours, actual_hours,
          outcome, error_message, resolution, feedback_rating, feedback_notes, retry_count, completed_at,
          tags, metadata, workspace_id,
          recipe_slug, workspace_source, read_only_mounts, extra_skills, model_override
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const dbResult = insertStmt.run(
        title,
        description,
        normalizedStatus,
        priority,
        resolvedProjectId,
        row.ticket_counter,
        assigned_to,
        actor,
        now,
        now,
        due_date,
        estimated_hours,
        actual_hours,
        outcome,
        error_message,
        resolution,
        feedback_rating,
        feedback_notes,
        retry_count,
        resolvedCompletedAt,
        JSON.stringify(tags),
        JSON.stringify(metadata),
        workspaceId,
        // Phase 13 — runtime-context columns. Destructured body.X direct to avoid
        // extending the already-15-deep destructure above. Object/array columns
        // are JSON-stringified; TEXT columns pass through.
        body.recipe_slug ?? null,
        body.workspace_source ? JSON.stringify(body.workspace_source) : null,
        body.read_only_mounts ? JSON.stringify(body.read_only_mounts) : null,
        body.extra_skills ? JSON.stringify(body.extra_skills) : null,
        body.model_override ?? null
      )
      return Number(dbResult.lastInsertRowid)
    })

    const taskId = createTaskTx()
    
    // Log activity
    db_helpers.logActivity('task_created', 'task', taskId, actor, `Created task: ${title}`, {
      title,
      status: normalizedStatus,
      priority,
      assigned_to,
      ...(outcome ? { outcome } : {})
    }, workspaceId);

    if (actor) {
      db_helpers.ensureTaskSubscription(taskId, actor, workspaceId)
    }

    for (const recipient of mentionResolution.recipients) {
      db_helpers.ensureTaskSubscription(taskId, recipient, workspaceId);
      if (recipient === actor) continue;
      db_helpers.createNotification(
        recipient,
        'mention',
        'You were mentioned in a task description',
        `${actor} mentioned you in task "${title}"`,
        'task',
        taskId,
        workspaceId
      );
    }

    // Create notification if assigned
    if (assigned_to) {
      db_helpers.ensureTaskSubscription(taskId, assigned_to, workspaceId)
      db_helpers.createNotification(
        assigned_to,
        'assignment',
        'Task Assigned',
        `You have been assigned to task: ${title}`,
        'task',
        taskId,
        workspaceId
      );
    }
    
    // Fetch the created task
    const createdTask = db.prepare(`
      SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix,
        (SELECT json_object(
          'provider', r.provider,
          'pr_number', r.pr_number,
          'pr_url', r.pr_url,
          'state', r.state
        )
         FROM task_review_prs r
         WHERE r.task_id = t.id AND r.workspace_id = t.workspace_id
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT 1) as review_pr
      FROM tasks t
      LEFT JOIN projects p
        ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?
    `).get(taskId, workspaceId) as Task;
    const parsedTask = mapTaskRow(createdTask);

    // Fire-and-forget outbound GitHub sync for new tasks
    if (parsedTask.project_id) {
      const project = db.prepare(`
        SELECT id, github_repo, github_sync_enabled FROM projects
        WHERE id = ? AND workspace_id = ?
      `).get(parsedTask.project_id, workspaceId) as any
      if (project?.github_sync_enabled && project?.github_repo) {
        pushTaskToGitHub(parsedTask as any, project).catch(err =>
          logger.error({ err, taskId }, 'Outbound GitHub sync failed for new task')
        )
      }
    }

    // Fire-and-forget GNAP sync for new tasks
    if (config.gnap.enabled && config.gnap.autoSync) {
      try { pushTaskToGnap(parsedTask as any, config.gnap.repoPath) }
      catch (err) { logger.warn({ err, taskId }, 'GNAP sync failed for new task') }
    }

    // Broadcast to SSE clients
    eventBus.broadcast('task.created', parsedTask);

    // Phase 15 SCHED-05: direct-assigned recipe-tagged task signals runner.
    // parsedTask.status reflects the post-normalizeTaskCreateStatus value, so a
    // body of {status:'inbox', assigned_to:'x', recipe_slug:'y'} that was
    // auto-upgraded to 'assigned' IS caught here. Tasks that remain 'inbox'
    // (no assigned_to) do NOT emit — autoRouteInboxTasks handles that path.
    //
    // Note: the Task interface in db.ts doesn't yet include recipe_slug /
    // workspace_id because those columns were added after the interface was
    // authored. Read them off the underlying row (typed as unknown → cast)
    // rather than extending the shared interface in this plan's file surface.
    const parsedTaskAny = parsedTask as unknown as {
      status: string;
      id: number;
      recipe_slug?: string | null;
      workspace_id?: number;
    };
    if (parsedTaskAny.status === 'assigned' && parsedTaskAny.recipe_slug) {
      eventBus.broadcast('task.runner_requested', {
        task_id: parsedTaskAny.id,
        recipe_slug: parsedTaskAny.recipe_slug,
        workspace_id: parsedTaskAny.workspace_id,
      })
    }

    return NextResponse.json({ task: parsedTask }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks error');
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}

/**
 * PUT /api/tasks - Update multiple tasks (for drag-and-drop status changes)
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id;
    const validated = await validateBody(request, bulkUpdateTaskStatusSchema);
    if ('error' in validated) return validated.error;
    const { tasks } = validated.data;

    const now = Math.floor(Date.now() / 1000);

    const updateStmt = db.prepare(`
      UPDATE tasks
      SET status = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?
    `);
    const updateDoneStmt = db.prepare(`
      UPDATE tasks
      SET status = ?, updated_at = ?, completed_at = COALESCE(completed_at, ?)
      WHERE id = ? AND workspace_id = ?
    `);

    const actor = auth.user.username

    const transaction = db.transaction((tasksToUpdate: any[]) => {
      for (const task of tasksToUpdate) {
        const oldTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(task.id, workspaceId) as Task;
        if (!oldTask) continue;

        const oldTaskRecipeSlug = (oldTask as unknown as { recipe_slug?: string | null }).recipe_slug
        if (task.status === 'done' && !oldTaskRecipeSlug && !hasAegisApproval(db, task.id, workspaceId)) {
          throw new Error(`Aegis approval required for task ${task.id}`)
        }

        if (task.status === 'done') {
          updateDoneStmt.run(task.status, now, now, task.id, workspaceId);
        } else {
          updateStmt.run(task.status, now, task.id, workspaceId);
        }

        // Log status change if different
        if (oldTask && oldTask.status !== task.status) {
          db_helpers.logActivity(
            'task_updated',
            'task',
            task.id,
            actor,
            `Task moved from ${oldTask.status} to ${task.status}`,
            { oldStatus: oldTask.status, newStatus: task.status },
            workspaceId
          );
        }
      }
    });
    
    transaction(tasks);

    // Broadcast status changes to SSE clients + outbound sync
    for (const task of tasks) {
      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: task.status,
        updated_at: Math.floor(Date.now() / 1000),
      });

      // Fire-and-forget outbound sync (GitHub + GNAP)
      const fullTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(task.id, workspaceId) as Task | undefined;
      if (fullTask) {
        syncTaskOutbound(fullTask as any, workspaceId);
      }
    }

    return NextResponse.json({ success: true, updated: tasks.length });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/tasks error');
    const message = error instanceof Error ? error.message : 'Failed to update tasks'
    if (message.includes('Aegis approval required')) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to update tasks' }, { status: 500 });
  }
}
