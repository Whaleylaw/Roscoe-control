import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase, Task, db_helpers } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { updateTaskSchema } from '@/lib/validation';
import { resolveMentionRecipients } from '@/lib/mentions';
import { normalizeTaskUpdateStatus } from '@/lib/task-status';
import { syncTaskOutbound } from '@/lib/github-sync-engine';
import { removeTaskFromGnap } from '@/lib/gnap-sync';
import { config } from '@/lib/config';
import { revokeTokensForTask } from '@/lib/runner-tokens';
import { getIndexedRecipeBySlug } from '@/lib/recipe-indexer';
import { getMountsCap, getExtraSkillsCap } from '@/lib/task-runtime-settings';
import { isKnownModel, MODEL_IDS } from '@/lib/model-registry';
import {
  validateHostPathAgainstAllowlist,
  buildAggregatedValidationResponse,
  zodErrorToIssues,
  TASK_RUNTIME_ERROR_CODES,
  type TaskRuntimeValidationIssue,
} from '@/lib/task-runtime-validation';

/**
 * Terminal task statuses — when a task transitions INTO one of these, any live
 * runner-tokens (Plan 11-04) must be atomically revoked in the same transaction
 * as the status UPDATE. `cancelled` is defensive: not in the current status enum
 * but self-activates if a future migration widens it. See 11-CONTEXT.md locks.
 */
const TERMINAL_TASK_STATUSES = new Set(['done', 'failed', 'cancelled']);

/**
 * Phase 13 — TCTX-01 / CONTEXT.md "Recipe binding mutability":
 * recipe_slug is mutable only while the task is pre-dispatch (status IN
 * {backlog, inbox}). Any later status returns 400 RECIPE_LOCKED on any
 * attempt to CHANGE recipe_slug. Identity PATCH (body.recipe_slug ===
 * currentTask.recipe_slug) is allowed through all statuses.
 */
const RECIPE_SLUG_MUTABLE_STATUSES = new Set<string>(['backlog', 'inbox']);

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
} {
  return {
    ...task,
    tags: task.tags ? JSON.parse(task.tags) : [],
    metadata: task.metadata ? JSON.parse(task.metadata) : {},
    workspace_source: task.workspace_source ? JSON.parse(task.workspace_source) : null,
    read_only_mounts: task.read_only_mounts ? JSON.parse(task.read_only_mounts) : [],
    extra_skills: task.extra_skills ? JSON.parse(task.extra_skills) : [],
    ticket_ref: formatTicketRef(task.project_prefix, task.project_ticket_no),
  }
}

function hasAegisApproval(
  db: ReturnType<typeof getDatabase>,
  taskId: number,
  workspaceId: number
): boolean {
  const review = db.prepare(`
    SELECT status FROM quality_reviews
    WHERE task_id = ? AND reviewer = 'aegis' AND workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(taskId, workspaceId) as { status?: string } | undefined
  return review?.status === 'approved'
}

/**
 * GET /api/tasks/[id] - Get a specific task
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const taskId = parseInt(resolvedParams.id);
    const workspaceId = auth.user.workspace_id ?? 1;

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    
    const stmt = db.prepare(`
      SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?
    `);
    const task = stmt.get(taskId, workspaceId) as Task;
    
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    // Parse JSON fields
    const taskWithParsedData = mapTaskRow(task);
    
    return NextResponse.json({ task: taskWithParsedData });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id] error');
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

/**
 * PUT /api/tasks/[id] - Update a specific task
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const taskId = parseInt(resolvedParams.id);
    const workspaceId = auth.user.workspace_id ?? 1;

    // Phase 13 — manual Zod parse so runtime-context body errors (unknown
    // model_override, duplicate labels/basenames, base_ref whitespace) flow
    // through the aggregated { errors: [...] } shape matching Plan 13-02's POST
    // handler. Non-runtime PATCH callers are unaffected — legacy body shapes
    // still parse identically via updateTaskSchema.
    let body: z.infer<typeof updateTaskSchema>;
    try {
      const json = await request.json();
      const parsed = updateTaskSchema.safeParse(json);
      if (!parsed.success) {
        return buildAggregatedValidationResponse(zodErrorToIssues(parsed.error));
      }
      body = parsed.data;
    } catch {
      return buildAggregatedValidationResponse([
        {
          field: '(root)',
          code: TASK_RUNTIME_ERROR_CODES.INVALID_FIELD,
          message: 'Request body is not valid JSON',
          hint: 'Send a JSON object with a Content-Type: application/json header.',
        },
      ]);
    }

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    
    // Get current task for comparison
    const currentTask = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
      .get(taskId, workspaceId) as Task;
    
    if (!currentTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    const {
      title,
      description,
      status: requestedStatus,
      priority,
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
      retry_count,
      completed_at,
      tags,
      metadata
    } = body;
    const normalizedStatus = normalizeTaskUpdateStatus({
      currentStatus: currentTask.status,
      requestedStatus,
      assignedTo: assigned_to,
      assignedToProvided: assigned_to !== undefined,
    })
    
    const now = Math.floor(Date.now() / 1000);
    const descriptionMentionResolution = description !== undefined
      ? resolveMentionRecipients(description || '', db, workspaceId)
      : null;
    if (descriptionMentionResolution && descriptionMentionResolution.unresolved.length > 0) {
      return NextResponse.json({
        error: `Unknown mentions: ${descriptionMentionResolution.unresolved.map((m) => `@${m}`).join(', ')}`,
        missing_mentions: descriptionMentionResolution.unresolved
      }, { status: 400 });
    }

    const previousDescriptionMentionRecipients = resolveMentionRecipients(currentTask.description || '', db, workspaceId).recipients;

    // ---------------------------------------------------------------------------
    // Phase 13 — runtime-context business rules (TCTX-01..06).
    //
    // Semantics:
    //   - Body shape already validated by safeParse (above); here we enforce:
    //     1. recipe_slug mutability gate (pre-dispatch only).
    //     2. Recipe existence + workspace_source gap (atomic; reject before UPDATE).
    //     3. Preserve-and-revalidate: if the PATCH omits read_only_mounts /
    //        extra_skills / model_override but changes recipe_slug (or just revisits
    //        the row), we re-validate the EXISTING task values against the current
    //        allowlist + registry. Catches the case where an admin tightened the
    //        allowlist after task creation.
    //     4. Cap checks + allowlist checks against EFFECTIVE arrays (what would
    //        land after the UPDATE).
    // ---------------------------------------------------------------------------
    // A field is "provided" in the PATCH body when the caller sent the key.
    // Distinguishes {undefined (not provided)} from {null (explicit unset)} so
    // preserve-and-revalidate semantics work: omitted = keep current, explicit
    // null = clear.
    const patchProvided = (key: string): boolean =>
      Object.prototype.hasOwnProperty.call(body, key);

    const runtimeIssues: TaskRuntimeValidationIssue[] = [];

    // Current runtime-context values parsed from the DB row.
    const currentRow = currentTask as unknown as {
      recipe_slug: string | null
      workspace_source: string | null
      read_only_mounts: string | null
      extra_skills: string | null
      model_override: string | null
    };
    const currentRecipeSlug = currentRow.recipe_slug ?? null;
    const currentWorkspaceSource = currentRow.workspace_source
      ? (JSON.parse(currentRow.workspace_source) as { project_id: number; base_ref: string })
      : null;
    const currentReadOnlyMounts = currentRow.read_only_mounts
      ? (JSON.parse(currentRow.read_only_mounts) as Array<{ host_path: string; container_path: string; label: string }>)
      : [];
    const currentExtraSkills = currentRow.extra_skills
      ? (JSON.parse(currentRow.extra_skills) as string[])
      : [];
    const currentModelOverride = currentRow.model_override ?? null;

    // Effective post-PATCH values:
    const bodyRecipeSlug = (body as { recipe_slug?: string | null }).recipe_slug;
    const bodyWorkspaceSource = (body as { workspace_source?: { project_id: number; base_ref: string } | null }).workspace_source;
    const bodyReadOnlyMounts = (body as { read_only_mounts?: Array<{ host_path: string; container_path: string; label: string }> | null }).read_only_mounts;
    const bodyExtraSkills = (body as { extra_skills?: string[] | null }).extra_skills;
    const bodyModelOverride = (body as { model_override?: string | null }).model_override;

    const nextRecipeSlug: string | null = patchProvided('recipe_slug')
      ? (bodyRecipeSlug ?? null)
      : currentRecipeSlug;
    const nextWorkspaceSource = patchProvided('workspace_source')
      ? (bodyWorkspaceSource ?? null)
      : currentWorkspaceSource;
    const nextReadOnlyMounts = patchProvided('read_only_mounts')
      ? (bodyReadOnlyMounts ?? [])
      : currentReadOnlyMounts;
    const nextExtraSkills = patchProvided('extra_skills')
      ? (bodyExtraSkills ?? [])
      : currentExtraSkills;
    const nextModelOverride: string | null = patchProvided('model_override')
      ? (bodyModelOverride ?? null)
      : currentModelOverride;
    void nextModelOverride; // reserved for future effective-value checks

    // --- 1. recipe_slug pre-dispatch mutability gate ---
    // Identity PATCH (same value as current) is allowed through any status.
    if (patchProvided('recipe_slug') && bodyRecipeSlug !== currentRecipeSlug) {
      if (!RECIPE_SLUG_MUTABLE_STATUSES.has(currentTask.status)) {
        runtimeIssues.push({
          field: 'recipe_slug',
          code: TASK_RUNTIME_ERROR_CODES.RECIPE_LOCKED,
          message: `recipe_slug is immutable once a task leaves pre-dispatch status; current status is '${currentTask.status}'`,
          hint: "recipe_slug can only be changed while status is 'backlog' or 'inbox'. Cancel the task and recreate if you need a different recipe on a dispatched task.",
        });
      }
    }

    // --- 2. Recipe existence + workspace_source gap for the EFFECTIVE slug ---
    let resolvedRecipe: ReturnType<typeof getIndexedRecipeBySlug> = null;
    if (nextRecipeSlug) {
      resolvedRecipe = getIndexedRecipeBySlug(nextRecipeSlug);
      if (resolvedRecipe === null) {
        runtimeIssues.push({
          field: 'recipe_slug',
          code: TASK_RUNTIME_ERROR_CODES.RECIPE_NOT_FOUND,
          message: `recipe_slug '${nextRecipeSlug}' does not reference an indexed recipe`,
          hint: 'Verify the slug via GET /api/recipes/:slug or POST /api/recipes/resync.',
        });
      } else if ('error_message' in resolvedRecipe && resolvedRecipe.error_message !== null) {
        runtimeIssues.push({
          field: 'recipe_slug',
          code: TASK_RUNTIME_ERROR_CODES.RECIPE_BROKEN,
          message: `recipe_slug '${nextRecipeSlug}' references a broken recipe: ${resolvedRecipe.error_message}`,
          hint: 'Fix the recipe under recipes/<slug>/ and wait for the watcher to re-index, or call POST /api/recipes/resync.',
        });
        resolvedRecipe = null;
      } else {
        // resolvedRecipe is RecipeRow
        if (resolvedRecipe.workspace_mode === 'worktree' && nextWorkspaceSource === null) {
          runtimeIssues.push({
            field: 'workspace_source',
            code: TASK_RUNTIME_ERROR_CODES.REQUIRED_BY_RECIPE,
            message: `recipe '${nextRecipeSlug}' declares workspace: worktree — task must carry workspace_source`,
            hint: 'Supply workspace_source: { project_id, base_ref } in the same PATCH.',
          });
        }
      }
    }

    // --- 3. Cap enforcement against EFFECTIVE arrays ---
    const mountsCap = getMountsCap();
    if (nextReadOnlyMounts.length > mountsCap) {
      runtimeIssues.push({
        field: 'read_only_mounts',
        code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED,
        message: `read_only_mounts has ${nextReadOnlyMounts.length} entries; the configured cap is ${mountsCap}`,
        hint: `Reduce the list to at most ${mountsCap} entries, or ask an admin to raise 'runtime.read_only_mounts_cap'.`,
      });
    }
    const skillsCap = getExtraSkillsCap();
    if (nextExtraSkills.length > skillsCap) {
      runtimeIssues.push({
        field: 'extra_skills',
        code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED,
        message: `extra_skills has ${nextExtraSkills.length} entries; the configured cap is ${skillsCap}`,
        hint: `Reduce the list to at most ${skillsCap} entries, or ask an admin to raise 'runtime.extra_skills_cap'.`,
      });
    }

    // --- 4. Allowlist checks against EFFECTIVE arrays (preserve-and-revalidate) ---
    for (let i = 0; i < nextReadOnlyMounts.length; i++) {
      const mount = nextReadOnlyMounts[i];
      const result = await validateHostPathAgainstAllowlist(mount.host_path);
      if (!result.ok) {
        runtimeIssues.push({
          field: `read_only_mounts.${i}.host_path`,
          code: result.code,
          message: result.message,
          hint: result.hint,
        });
      }
    }
    for (let i = 0; i < nextExtraSkills.length; i++) {
      const result = await validateHostPathAgainstAllowlist(nextExtraSkills[i]);
      if (!result.ok) {
        runtimeIssues.push({
          field: `extra_skills.${i}`,
          code: result.code,
          message: result.message,
          hint: result.hint,
        });
      }
    }

    // --- 5. Preserve-and-revalidate model_override ---
    // Body-shape layer already enforces model_override when PROVIDED (via the
    // Zod refine on updateTaskSchema). But when the PATCH omits model_override
    // and the EXISTING value is invalid under the current registry, we must
    // still catch it per "preserve-and-revalidate" semantics.
    if (!patchProvided('model_override') && currentModelOverride !== null) {
      if (!isKnownModel(currentModelOverride)) {
        runtimeIssues.push({
          field: 'model_override',
          code: TASK_RUNTIME_ERROR_CODES.UNKNOWN_MODEL,
          message: `task's existing model_override '${currentModelOverride}' is no longer in the model registry. Known models: ${MODEL_IDS.join(', ')}`,
          hint: 'Supply a valid model_override in this PATCH, or set it to null to unset.',
        });
      }
    }

    if (runtimeIssues.length > 0) {
      return buildAggregatedValidationResponse(runtimeIssues);
    }

    // Build dynamic update query
    const fieldsToUpdate = [];
    const updateParams: any[] = [];
    let nextProjectTicketNo: number | null = null;
    
    if (title !== undefined) {
      fieldsToUpdate.push('title = ?');
      updateParams.push(title);
    }
    if (description !== undefined) {
      fieldsToUpdate.push('description = ?');
      updateParams.push(description);
    }
    if (normalizedStatus !== undefined) {
      // Phase 09 — GSD-15, D-30, D-31, D-32: gate enforcement on forward motion
      //   D-31: only 'in_progress' and 'done' are gated; backward/sideways motion
      //         (backlog, review, awaiting_owner, inbox, assigned, etc.) bypasses.
      //   D-32: 'rejected' blocks identically to 'pending' / 'not_required' — only
      //         'approved' unblocks. Ordering: runs BEFORE the Aegis check because
      //         gate failure is cheaper + semantically prior (Pitfall ordering).
      if ((normalizedStatus === 'in_progress' || normalizedStatus === 'done')
          && currentTask.gate_required === 1
          && currentTask.gate_status !== 'approved') {
        return NextResponse.json({
          error: 'This task requires gate approval before it can move forward.',
          code: 'GATE_BLOCKED',
          gate_status: currentTask.gate_status,
          gate_required: 1,
        }, { status: 403 })
      }

      if (normalizedStatus === 'done' && !hasAegisApproval(db, taskId, workspaceId)) {
        return NextResponse.json(
          { error: 'Aegis approval is required to move task to done.' },
          { status: 403 }
        )
      }
      fieldsToUpdate.push('status = ?');
      updateParams.push(normalizedStatus);
    }
    if (priority !== undefined) {
      fieldsToUpdate.push('priority = ?');
      updateParams.push(priority);
    }
    if (project_id !== undefined) {
      const project = db.prepare(`
        SELECT id FROM projects
        WHERE id = ? AND workspace_id = ? AND status = 'active'
      `).get(project_id, workspaceId) as { id: number } | undefined
      if (!project) {
        return NextResponse.json({ error: 'Project not found or archived' }, { status: 400 })
      }
      if (project_id !== currentTask.project_id) {
        db.prepare(`
          UPDATE projects
          SET ticket_counter = ticket_counter + 1, updated_at = unixepoch()
          WHERE id = ? AND workspace_id = ?
        `).run(project_id, workspaceId)
        const row = db.prepare(`
          SELECT ticket_counter FROM projects
          WHERE id = ? AND workspace_id = ?
        `).get(project_id, workspaceId) as { ticket_counter: number } | undefined
        if (!row || !row.ticket_counter) {
          return NextResponse.json({ error: 'Failed to allocate project ticket number' }, { status: 500 })
        }
        nextProjectTicketNo = row.ticket_counter
      }
      fieldsToUpdate.push('project_id = ?');
      updateParams.push(project_id);
      if (nextProjectTicketNo !== null) {
        fieldsToUpdate.push('project_ticket_no = ?');
        updateParams.push(nextProjectTicketNo);
      }
    }
    if (assigned_to !== undefined) {
      fieldsToUpdate.push('assigned_to = ?');
      updateParams.push(assigned_to);
    }
    if (due_date !== undefined) {
      fieldsToUpdate.push('due_date = ?');
      updateParams.push(due_date);
    }
    if (estimated_hours !== undefined) {
      fieldsToUpdate.push('estimated_hours = ?');
      updateParams.push(estimated_hours);
    }
    if (actual_hours !== undefined) {
      fieldsToUpdate.push('actual_hours = ?');
      updateParams.push(actual_hours);
    }
    if (outcome !== undefined) {
      fieldsToUpdate.push('outcome = ?');
      updateParams.push(outcome);
    }
    if (error_message !== undefined) {
      fieldsToUpdate.push('error_message = ?');
      updateParams.push(error_message);
    }
    if (resolution !== undefined) {
      fieldsToUpdate.push('resolution = ?');
      updateParams.push(resolution);
    }
    if (feedback_rating !== undefined) {
      fieldsToUpdate.push('feedback_rating = ?');
      updateParams.push(feedback_rating);
    }
    if (feedback_notes !== undefined) {
      fieldsToUpdate.push('feedback_notes = ?');
      updateParams.push(feedback_notes);
    }
    if (retry_count !== undefined) {
      fieldsToUpdate.push('retry_count = ?');
      updateParams.push(retry_count);
    }
    if (completed_at !== undefined) {
      fieldsToUpdate.push('completed_at = ?');
      updateParams.push(completed_at);
    } else if (normalizedStatus === 'done' && !currentTask.completed_at) {
      fieldsToUpdate.push('completed_at = ?');
      updateParams.push(now);
    }
    if (tags !== undefined) {
      fieldsToUpdate.push('tags = ?');
      updateParams.push(JSON.stringify(tags));
    }
    if (metadata !== undefined) {
      fieldsToUpdate.push('metadata = ?');
      updateParams.push(JSON.stringify(metadata));
    }

    // Phase 13 — persist runtime-context fields when provided. Each branch is
    // gated by patchProvided(key) (not `!== undefined`) so an explicit `null`
    // value in the body clears the column, while omission preserves it.
    if (patchProvided('recipe_slug')) {
      fieldsToUpdate.push('recipe_slug = ?');
      updateParams.push(bodyRecipeSlug ?? null);
    }
    if (patchProvided('workspace_source')) {
      fieldsToUpdate.push('workspace_source = ?');
      updateParams.push(bodyWorkspaceSource ? JSON.stringify(bodyWorkspaceSource) : null);
    }
    if (patchProvided('read_only_mounts')) {
      fieldsToUpdate.push('read_only_mounts = ?');
      updateParams.push(bodyReadOnlyMounts ? JSON.stringify(bodyReadOnlyMounts) : null);
    }
    if (patchProvided('extra_skills')) {
      fieldsToUpdate.push('extra_skills = ?');
      updateParams.push(bodyExtraSkills ? JSON.stringify(bodyExtraSkills) : null);
    }
    if (patchProvided('model_override')) {
      fieldsToUpdate.push('model_override = ?');
      updateParams.push(bodyModelOverride ?? null);
    }

    fieldsToUpdate.push('updated_at = ?');
    updateParams.push(now);
    updateParams.push(taskId, workspaceId);
    
    if (fieldsToUpdate.length === 1) { // Only updated_at
      return NextResponse.json({
        task: mapTaskRow(currentTask),
        unchanged: true,
      });
    }
    
    const stmt = db.prepare(`
      UPDATE tasks
      SET ${fieldsToUpdate.join(', ')}
      WHERE id = ? AND workspace_id = ?
    `);

    // Plan 11-04 / RAUTH-05: when a task transitions INTO a terminal status, revoke
    // live runner-tokens in the SAME transaction as the status write. A crash between
    // the two MUST roll both back. `isTerminalTransition` guards against re-revoking
    // on terminal→terminal writes (harmless but noise; revokeTokensForTask is idempotent).
    const isTerminalTransition = normalizedStatus !== undefined
      && TERMINAL_TASK_STATUSES.has(normalizedStatus)
      && !TERMINAL_TASK_STATUSES.has(currentTask.status as string);

    db.transaction(() => {
      stmt.run(...updateParams);
      if (isTerminalTransition) {
        revokeTokensForTask(db, taskId);
      }
    })();
    
    // Track changes and log activities
    const changes: string[] = [];
    
    if (normalizedStatus !== undefined && normalizedStatus !== currentTask.status) {
      changes.push(`status: ${currentTask.status} → ${normalizedStatus}`);
      
      // Create notification for status change if assigned
      if (currentTask.assigned_to) {
        db_helpers.createNotification(
          currentTask.assigned_to,
          'status_change',
          'Task Status Updated',
          `Task "${currentTask.title}" status changed to ${normalizedStatus}`,
          'task',
          taskId,
          workspaceId
        );
      }
    }
    
    if (assigned_to !== undefined && assigned_to !== currentTask.assigned_to) {
      changes.push(`assigned: ${currentTask.assigned_to || 'unassigned'} → ${assigned_to || 'unassigned'}`);
      
      // Create notification for new assignee
      if (assigned_to) {
        db_helpers.ensureTaskSubscription(taskId, assigned_to, workspaceId);
        db_helpers.createNotification(
          assigned_to,
          'assignment',
          'Task Assigned',
          `You have been assigned to task: ${currentTask.title}`,
          'task',
          taskId,
          workspaceId
        );
      }
    }
    
    if (title && title !== currentTask.title) {
      changes.push('title updated');
    }
    
    if (priority && priority !== currentTask.priority) {
      changes.push(`priority: ${currentTask.priority} → ${priority}`);
    }

    if (project_id !== undefined && project_id !== currentTask.project_id) {
      changes.push(`project: ${currentTask.project_id || 'none'} → ${project_id}`);
    }
    if (outcome !== undefined && outcome !== currentTask.outcome) {
      changes.push(`outcome: ${currentTask.outcome || 'unset'} → ${outcome || 'unset'}`);
    }

    if (descriptionMentionResolution) {
      const newMentionRecipients = new Set(descriptionMentionResolution.recipients);
      const previousRecipients = new Set(previousDescriptionMentionRecipients);
      for (const recipient of newMentionRecipients) {
        if (previousRecipients.has(recipient)) continue;
        db_helpers.ensureTaskSubscription(taskId, recipient, workspaceId);
        if (recipient === auth.user.username) continue;
        db_helpers.createNotification(
          recipient,
          'mention',
          'You were mentioned in a task description',
          `${auth.user.username} mentioned you in task "${title || currentTask.title}"`,
          'task',
          taskId,
          workspaceId
        );
      }
    }
    
    // Log activity if there were meaningful changes
    if (changes.length > 0) {
      db_helpers.logActivity(
        'task_updated',
        'task',
        taskId,
        auth.user.username,
        `Task updated: ${changes.join(', ')}`,
        { 
          changes: changes,
          oldValues: {
            title: currentTask.title,
            status: currentTask.status,
            priority: currentTask.priority,
            assigned_to: currentTask.assigned_to
          },
          newValues: { title, status: normalizedStatus ?? currentTask.status, priority, assigned_to }
        },
        workspaceId
      );
    }
    
    // Fetch updated task
    const updatedTask = db.prepare(`
      SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?
    `).get(taskId, workspaceId) as Task;
    const parsedTask = mapTaskRow(updatedTask);

    // Fire-and-forget outbound sync (GitHub + GNAP)
    if (changes.length > 0) {
      syncTaskOutbound(updatedTask as any, workspaceId);
    }

    // Broadcast to SSE clients
    eventBus.broadcast('task.updated', parsedTask);

    return NextResponse.json({ task: parsedTask });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/tasks/[id] error');
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[id] - Delete a specific task
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const taskId = parseInt(resolvedParams.id);
    const workspaceId = auth.user.workspace_id ?? 1;
    
    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    
    // Get task before deletion for logging
    const task = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
      .get(taskId, workspaceId) as Task;
    
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    // Delete task (cascades will handle comments)
    const stmt = db.prepare('DELETE FROM tasks WHERE id = ? AND workspace_id = ?');
    stmt.run(taskId, workspaceId);
    
    // Log deletion
    db_helpers.logActivity(
      'task_deleted',
      'task',
      taskId,
      auth.user.username,
      `Deleted task: ${task.title}`,
      {
        title: task.title,
        status: task.status,
        assigned_to: task.assigned_to
      },
      workspaceId
    );

    // Remove from GNAP repo
    if (config.gnap.enabled && config.gnap.autoSync) {
      try { removeTaskFromGnap(taskId, config.gnap.repoPath) }
      catch (err) { logger.warn({ err, taskId }, 'GNAP sync failed for task deletion') }
    }

    // Broadcast to SSE clients
    eventBus.broadcast('task.deleted', { id: taskId, title: task.title });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/tasks/[id] error');
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
