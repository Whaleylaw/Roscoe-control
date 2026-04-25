import { NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';
import { getDatabase, Task, db_helpers } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { validateBody, updateTaskSchema } from '@/lib/validation';
import { resolveMentionRecipients } from '@/lib/mentions';
import { normalizeTaskUpdateStatus } from '@/lib/task-status';
import { syncTaskOutbound } from '@/lib/github-sync-engine';
import { removeTaskFromGnap } from '@/lib/gnap-sync';
import { config } from '@/lib/config';
import { revokeTokensForTask } from '@/lib/runner-tokens';
import { getIndexedRecipeBySlug } from '@/lib/recipe-indexer';
import { getMountsCap, getExtraSkillsCap } from '@/lib/task-runtime-settings';
import { isKnownModel, MODEL_IDS } from '@/lib/model-registry';
import { bypassLawFirmCaseLandmark } from '@/lib/law-firm';
import { satisfyWorkflowCondition } from '@/lib/workflow-engine';
import {
  validateHostPathAgainstAllowlist,
  buildAggregatedValidationResponse,
  zodErrorToIssues,
  TASK_RUNTIME_ERROR_CODES,
  type TaskRuntimeValidationIssue,
} from '@/lib/task-runtime-validation';

// Suppress unused-import warnings for legacy consumers; validateBody is still
// referenced by other handlers in the codebase that share this import shape.
void validateBody;

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

function parseTaskMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | null {
  if (value == null) return null
  const str = String(value).trim()
  return str || null
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
    // through the aggregated { errors: [...] } shape matching Plan 13-02's
    // POST handler. Non-runtime PATCH callers are unaffected — legacy body
    // shapes still parse identically via updateTaskSchema.
    let body: z.infer<typeof updateTaskSchema>;
    let rawBody: Record<string, unknown>;
    try {
      const json = await request.json();
      rawBody = (json && typeof json === 'object') ? json as Record<string, unknown> : {};
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

    // A field is "provided" in the PATCH body when the caller sent the key.
    // Distinguishes {undefined (not provided)} from {null (explicit unset)} so
    // preserve-and-revalidate semantics work: omitted = keep current, explicit
    // null = clear. Use rawBody (pre-Zod) because Zod strips unknown keys by
    // default and sets undefined for optional unset fields, so `in body` would
    // be unreliable. rawBody preserves the caller's intent.
    const patchProvided = (key: string): boolean =>
      Object.prototype.hasOwnProperty.call(rawBody, key);

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

    if (rawBody.bypass_not_applicable === true) {
      const metadataObject = parseTaskMetadata(currentTask.metadata)
      const lawFirm = objectRecord(metadataObject.law_firm)
      const caseSlug = stringValue(lawFirm.case_slug)
      const landmark = stringValue(lawFirm.landmark)
      if (!caseSlug || !landmark) {
        return NextResponse.json(
          { error: 'Bypass Not Applicable is only available for FirmVault workflow tasks with case and landmark metadata.' },
          { status: 400 },
        )
      }

      const actor = auth.user.display_name || auth.user.username || 'mission-control'
      const bypassReason = stringValue(rawBody.bypass_reason)
        || 'Marked not applicable in Mission Control.'
      const bypassReasonSentence = bypassReason.replace(/[.!?]+$/, '')
      const bypass = {
        status: 'not_applicable',
        reason: bypassReason,
        task_id: taskId,
        created_at: now,
        created_by: actor,
      }
      const nextMetadata = {
        ...metadataObject,
        law_firm: {
          ...lawFirm,
          workflow_bypass: bypass,
        },
      }
      const nextResolution = `Marked not applicable by ${actor}: ${bypassReasonSentence}. The FirmVault workflow item is complete, but no factual landmark such as an exhausted-benefits finding was asserted.`

      await bypassLawFirmCaseLandmark(caseSlug, landmark, bypassReason, actor, taskId)
      satisfyWorkflowCondition(db, {
        subjectType: 'law_firm_case',
        subjectId: caseSlug,
        condition: `law_firm.landmarks.${landmark} == true`,
        actor,
        workspaceId,
        payload: {
          source: 'task_bypass_not_applicable',
          landmark,
          task_id: taskId,
          reason: bypassReason,
        },
        status: 'inbox',
      })

      db.transaction(() => {
        db.prepare(`
          UPDATE tasks
          SET status = 'done',
              outcome = 'success',
              resolution = ?,
              metadata = ?,
              error_message = NULL,
              container_id = NULL,
              completed_at = COALESCE(completed_at, ?),
              updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `).run(nextResolution, JSON.stringify(nextMetadata), now, now, taskId, workspaceId)

        db.prepare(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, 'system', ?, ?, ?)
        `).run(taskId, `Bypass Not Applicable applied. ${nextResolution}`, now, workspaceId)

        db.prepare(`
          INSERT INTO quality_reviews (task_id, reviewer, status, notes, created_at, workspace_id)
          VALUES (?, 'owner', 'approved', ?, ?, ?)
        `).run(taskId, `Owner-approved not-applicable bypass: ${bypassReason}`, now, workspaceId)

        revokeTokensForTask(db, taskId)
      })()

      db_helpers.logActivity(
        'task_updated',
        'task',
        taskId,
        auth.user.username,
        `Task bypassed as not applicable: ${currentTask.status} → done`,
        {
          changes: ['bypass_not_applicable', `status: ${currentTask.status} → done`],
          law_firm: { case_slug: caseSlug, landmark },
        },
        workspaceId,
      )

      const updatedTask = db.prepare(`
        SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
        WHERE t.id = ? AND t.workspace_id = ?
      `).get(taskId, workspaceId) as Task
      const parsedTask = mapTaskRow(updatedTask)
      syncTaskOutbound(updatedTask as any, workspaceId)
      eventBus.broadcast('task.updated', parsedTask)

      return NextResponse.json({
        task: parsedTask,
        bypass: {
          case_slug: caseSlug,
          landmark,
          status: 'not_applicable',
        },
      })
    }

    // ---------------------------------------------------------------------------
    // Phase 13 — runtime-context business rules (TCTX-01..06).
    //
    // Semantics:
    //   - Body shape already validated by safeParse above; here we enforce:
    //     1. recipe_slug mutability gate (pre-dispatch only).
    //     2. Recipe existence + workspace_source gap (atomic; reject before UPDATE).
    //     3. Preserve-and-revalidate: if the PATCH omits read_only_mounts /
    //        extra_skills / model_override but changes recipe_slug (or just
    //        revisits the row), we re-validate the EXISTING task values against
    //        the current allowlist + registry. Catches the case where an admin
    //        tightened the allowlist after task creation.
    //     4. Cap checks + allowlist checks against EFFECTIVE arrays (what would
    //        land after the UPDATE).
    // ---------------------------------------------------------------------------
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
    const currentWorkspaceSource: { project_id: number; base_ref: string } | null =
      currentRow.workspace_source
        ? JSON.parse(currentRow.workspace_source) as { project_id: number; base_ref: string }
        : null;
    const currentReadOnlyMounts: Array<{ host_path: string; container_path: string; label: string }> =
      currentRow.read_only_mounts
        ? JSON.parse(currentRow.read_only_mounts) as Array<{ host_path: string; container_path: string; label: string }>
        : [];
    const currentExtraSkills: string[] = currentRow.extra_skills
      ? JSON.parse(currentRow.extra_skills) as string[]
      : [];
    const currentModelOverride = currentRow.model_override ?? null;

    // Effective post-PATCH values:
    const nextRecipeSlug: string | null = patchProvided('recipe_slug')
      ? ((body.recipe_slug as string | null | undefined) ?? null)
      : currentRecipeSlug;
    const nextWorkspaceSource: { project_id: number; base_ref: string } | null =
      patchProvided('workspace_source')
        ? ((body.workspace_source as { project_id: number; base_ref: string } | null | undefined) ?? null)
        : currentWorkspaceSource;
    const nextReadOnlyMounts: Array<{ host_path: string; container_path: string; label: string }> =
      patchProvided('read_only_mounts')
        ? ((body.read_only_mounts as Array<{ host_path: string; container_path: string; label: string }> | null | undefined) ?? [])
        : currentReadOnlyMounts;
    const nextExtraSkills: string[] = patchProvided('extra_skills')
      ? ((body.extra_skills as string[] | null | undefined) ?? [])
      : currentExtraSkills;

    // --- 1. recipe_slug pre-dispatch mutability gate ---
    // Identity PATCH (same value as current) is allowed through any status.
    if (patchProvided('recipe_slug') && (body.recipe_slug ?? null) !== currentRecipeSlug) {
      if (!RECIPE_SLUG_MUTABLE_STATUSES.has(currentTask.status as string)) {
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

      if (
        normalizedStatus === 'done' &&
        !currentRecipeSlug &&
        !hasAegisApproval(db, taskId, workspaceId)
      ) {
        return NextResponse.json(
          { error: 'Aegis approval is required to move task to done.' },
          { status: 403 }
        )
      }

      // -----------------------------------------------------------------------
      // Phase 20 Plan 20-02 (ROUTE-02, COMPAT-03) — legacy blocker contract branch.
      //
      // Fires ONLY when the PUT is targeting a legacy pause (in_progress → awaiting_owner)
      // or a legacy resume (awaiting_owner → assigned). Both transitions own the
      // status write and the runner_last_failure_reason envelope write atomically
      // inside one db.transaction() and return early, short-circuiting the generic
      // fieldsToUpdate write path below.
      //
      // Recipe-tagged tasks (recipe_slug IS NOT NULL) MUST use the checkpoints
      // endpoint (POST /api/tasks/:id/checkpoints with status='blocked') — a PUT
      // against a recipe task here returns 409 and redirects the caller.
      //
      // Retry/fail paths in scheduler (`requeueStaleTasks`,
      // `dispatchAssignedTasks` catch branches) are UNCHANGED — they write
      // directly via db.prepare(...).run(...) and never traverse this branch.
      // The existing gate-required guard runs BEFORE this branch; awaiting_owner
      // is not a forward-motion target so it is inherently bypassed — gate-blocked
      // tasks can still be paused for owner input, matching D-31.
      // -----------------------------------------------------------------------
      const currentRecipeSlugForBlocker = (currentTask as unknown as { recipe_slug: string | null }).recipe_slug ?? null
      const isRecipe = currentRecipeSlugForBlocker !== null && currentRecipeSlugForBlocker !== ''

      // --- Pause branch: in_progress → awaiting_owner ---------------------
      if (normalizedStatus === 'awaiting_owner' && currentTask.status === 'in_progress') {
        if (isRecipe) {
          return NextResponse.json(
            {
              error:
                'Recipe-tagged tasks must use the checkpoints endpoint to pause. POST /api/tasks/:id/checkpoints with status="blocked" and a blocker_reason.',
              code: 'RECIPE_BLOCKER_VIA_CHECKPOINTS',
            },
            { status: 409 },
          )
        }

        const missing: string[] = []
        if (!body.blocker_reason || !body.blocker_reason.trim()) missing.push('blocker_reason')
        if (!body.blocker_kind) missing.push('blocker_kind')
        if (!body.resume_hint || !body.resume_hint.trim()) missing.push('resume_hint')
        if (missing.length > 0) {
          return NextResponse.json(
            {
              error: `Blocker pause requires ${missing.join(', ')}`,
              code: 'BLOCKER_FIELDS_MISSING',
              missing,
            },
            { status: 400 },
          )
        }

        const envelope = JSON.stringify({
          blocker_reason: body.blocker_reason!.trim(),
          blocker_kind: body.blocker_kind!,
          resume_hint: body.resume_hint!.trim(),
        })

        const runPause = db.transaction(() => {
          const upd = db.prepare(
            `UPDATE tasks
               SET status = 'awaiting_owner',
                   runner_last_failure_reason = ?,
                   updated_at = ?
             WHERE id = ? AND workspace_id = ? AND status = 'in_progress' AND recipe_slug IS NULL`,
          ).run(envelope, now, taskId, workspaceId)
          if (upd.changes === 0) {
            // Raced with another transition OR recipe_slug appeared — surface a 409.
            throw new Error('concurrent_transition')
          }
        })

        try {
          runPause()
        } catch (err) {
          if (err instanceof Error && err.message === 'concurrent_transition') {
            return NextResponse.json(
              {
                error: 'Task status changed during blocker transition; retry',
                code: 'CONCURRENT_TRANSITION',
              },
              { status: 409 },
            )
          }
          throw err
        }

        // Re-SELECT the fresh row (not currentTask) so the response reflects
        // the committed envelope + status.
        const freshRow = db.prepare(
          'SELECT * FROM tasks WHERE id = ? AND workspace_id = ?',
        ).get(taskId, workspaceId) as Task
        const freshTask = mapTaskRow(freshRow)

        eventBus.broadcast('task.status_changed', {
          id: taskId,
          status: 'awaiting_owner',
          previous_status: 'in_progress',
          reason: 'blocker_pause_legacy',
          workspace_id: workspaceId,
        })
        // Mirror the existing generic-write-path `task.updated` broadcast so
        // clients that listen on task.updated still see this pause. Keeps shape
        // consistent with the generic broadcast emitted at the end of this PUT.
        eventBus.broadcast('task.updated', freshTask)
        // Plan 20-03 ROUTE-02 — unified blocker pause event. Fires AFTER both
        // broadcasts above. 10-key payload shared with the recipe emission site
        // in src/app/api/tasks/[id]/checkpoints/route.ts. Additive — does not
        // modify or reorder the broadcasts above.
        eventBus.broadcast('task.blocker_transition', {
          task_id: taskId,
          workspace_id: workspaceId,
          direction: 'paused',
          previous_status: 'in_progress',
          status: 'awaiting_owner',
          blocker_reason: body.blocker_reason!.trim(),
          blocker_kind: body.blocker_kind!,
          resume_hint: body.resume_hint!.trim(),
          source: 'legacy',
          attempt: null,
          ts: now,
        })

        return NextResponse.json({ task: freshTask })
      }

      // --- Resume branch: awaiting_owner → assigned (legacy only) ---------
      if (normalizedStatus === 'assigned' && currentTask.status === 'awaiting_owner' && !isRecipe) {
        // Plan 20-03 ROUTE-02 — capture the pre-clear blocker envelope BEFORE
        // the transaction runs, because the UPDATE wipes runner_last_failure_reason
        // to NULL. currentTask holds the pre-clear row value (frozen from the
        // SELECT at line 185). The captured envelope is used in the
        // task.blocker_transition broadcast so observers still see what the
        // blocker WAS at resume time.
        let priorEnvelope: {
          blocker_reason: string | null
          blocker_kind: string | null
          resume_hint: string | null
        } = { blocker_reason: null, blocker_kind: null, resume_hint: null }
        const rawPriorReason = (currentTask as unknown as {
          runner_last_failure_reason: string | null
        }).runner_last_failure_reason
        if (rawPriorReason) {
          try {
            const parsed = JSON.parse(rawPriorReason)
            if (parsed && typeof parsed === 'object') {
              priorEnvelope = {
                blocker_reason:
                  typeof parsed.blocker_reason === 'string' ? parsed.blocker_reason : null,
                blocker_kind:
                  typeof parsed.blocker_kind === 'string' ? parsed.blocker_kind : null,
                resume_hint:
                  typeof parsed.resume_hint === 'string' ? parsed.resume_hint : null,
              }
            }
          } catch {
            // Pre-v1.3 legacy data may have a free-text string here. Leave null —
            // observers cope.
          }
        }

        // No required fields on resume — owner just clears the pause.
        const runResume = db.transaction(() => {
          const upd = db.prepare(
            `UPDATE tasks
               SET status = 'assigned',
                   runner_last_failure_reason = NULL,
                   updated_at = ?
             WHERE id = ? AND workspace_id = ? AND status = 'awaiting_owner' AND recipe_slug IS NULL`,
          ).run(now, taskId, workspaceId)
          if (upd.changes === 0) throw new Error('concurrent_transition')
        })

        try {
          runResume()
        } catch (err) {
          if (err instanceof Error && err.message === 'concurrent_transition') {
            return NextResponse.json(
              {
                error: 'Task status changed during resume; retry',
                code: 'CONCURRENT_TRANSITION',
              },
              { status: 409 },
            )
          }
          throw err
        }

        const freshRow = db.prepare(
          'SELECT * FROM tasks WHERE id = ? AND workspace_id = ?',
        ).get(taskId, workspaceId) as Task
        const freshTask = mapTaskRow(freshRow)

        eventBus.broadcast('task.status_changed', {
          id: taskId,
          status: 'assigned',
          previous_status: 'awaiting_owner',
          reason: 'blocker_resume_legacy',
          workspace_id: workspaceId,
        })
        // Mirror the existing generic-write-path `task.updated` broadcast so
        // task.updated subscribers still see this resume.
        eventBus.broadcast('task.updated', freshTask)
        // Plan 20-03 ROUTE-02 — unified blocker resume event. Fires AFTER both
        // broadcasts above. priorEnvelope carries the pre-clear envelope context
        // so observers see what the blocker WAS (UPDATE above already cleared
        // the column to NULL). Additive — does not modify or reorder the
        // broadcasts above.
        eventBus.broadcast('task.blocker_transition', {
          task_id: taskId,
          workspace_id: workspaceId,
          direction: 'resumed',
          previous_status: 'awaiting_owner',
          status: 'assigned',
          blocker_reason: priorEnvelope.blocker_reason,
          blocker_kind: priorEnvelope.blocker_kind,
          resume_hint: priorEnvelope.resume_hint,
          source: 'legacy',
          attempt: null,
          ts: now,
        })

        return NextResponse.json({ task: freshTask })
      }

      // Neither pause nor resume matched — fall through to the generic write
      // path below. Examples: PUT { status: 'awaiting_owner' } on an already-
      // awaiting task, PUT { status: 'assigned' } as part of a non-blocker
      // transition (e.g., scheduler requeue), recipe-path awaiting_owner →
      // assigned resume (generic write path, COMPAT lock). COMPAT-03: generic
      // path keeps working.

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
    } else if (normalizedStatus === 'quality_review' && currentTask.status !== 'quality_review') {
      fieldsToUpdate.push('error_message = ?');
      updateParams.push(null);
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

    // Phase 13 — runtime-context fields. Each column is dynamically added to
    // the UPDATE only when the caller explicitly sent the key. patchProvided
    // distinguishes omission from explicit null: omitted = keep current,
    // explicit null = clear. JSON columns are serialized here; arrays/objects
    // become JSON strings, null stays null.
    if (patchProvided('recipe_slug')) {
      fieldsToUpdate.push('recipe_slug = ?');
      updateParams.push(body.recipe_slug ?? null);
    }
    if (patchProvided('workspace_source')) {
      fieldsToUpdate.push('workspace_source = ?');
      updateParams.push(body.workspace_source ? JSON.stringify(body.workspace_source) : null);
    }
    if (patchProvided('read_only_mounts')) {
      fieldsToUpdate.push('read_only_mounts = ?');
      updateParams.push(body.read_only_mounts ? JSON.stringify(body.read_only_mounts) : null);
    }
    if (patchProvided('extra_skills')) {
      fieldsToUpdate.push('extra_skills = ?');
      updateParams.push(body.extra_skills ? JSON.stringify(body.extra_skills) : null);
    }
    if (patchProvided('model_override')) {
      fieldsToUpdate.push('model_override = ?');
      updateParams.push(body.model_override ?? null);
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

    if (
      currentTask.status !== 'assigned' &&
      normalizedStatus === 'assigned' &&
      (currentTask as unknown as { recipe_slug: string | null }).recipe_slug != null &&
      (currentTask as unknown as { recipe_slug: string }).recipe_slug !== ''
    ) {
      eventBus.broadcast('task.runner_requested', {
        task_id: taskId,
        recipe_slug: (currentTask as unknown as { recipe_slug: string }).recipe_slug,
        workspace_id: workspaceId,
      })
    }

    if (
      currentTask.status !== 'quality_review' &&
      normalizedStatus === 'quality_review' &&
      (currentTask as unknown as { recipe_slug: string | null }).recipe_slug != null &&
      (currentTask as unknown as { recipe_slug: string }).recipe_slug !== ''
    ) {
      const recipe = getIndexedRecipeBySlug((currentTask as unknown as { recipe_slug: string }).recipe_slug)
      if (recipe && recipe.error_message === null && recipe.review_md) {
        eventBus.broadcast('task.runner_requested', {
          task_id: taskId,
          recipe_slug: (currentTask as unknown as { recipe_slug: string }).recipe_slug,
          runner_mode: 'review',
          workspace_id: workspaceId,
        })
      }
    }

    // Plan 20-03 ROUTE-02 — recipe resume detection (Site 4).
    // Only the awaiting_owner → assigned flip on a recipe-tagged task emits
    // the unified blocker event from this generic write path. Other generic
    // PUTs (backlog → inbox, review → done, etc.) do NOT emit this event.
    //
    // Column-clear policy — LOCKED per 20-CONTEXT.md option A: this path does
    // NOT clear runner_last_failure_reason. The recipe path's `blocked:<reason>`
    // string is self-healing — the next blocker checkpoint POST via
    // writeCheckpoint rewrites the column atomically (see
    // src/app/api/tasks/[id]/checkpoints/route.ts:170-183). A stale
    // `blocked:<reason>` between resume and the next blocker cycle is
    // acceptable; observers that care about "is this task currently blocked"
    // check `status`, not runner_last_failure_reason.
    if (
      currentTask.status === 'awaiting_owner' &&
      normalizedStatus === 'assigned' &&
      (currentTask as unknown as { recipe_slug: string | null }).recipe_slug != null &&
      (currentTask as unknown as { recipe_slug: string }).recipe_slug !== ''
    ) {
      // Best-effort reason extraction: recipe path stores `blocked:<reason>`
      // or older formats. Strip the known prefix when present; otherwise pass
      // the raw string. Missing field → null.
      let priorReason: string | null = null
      const raw = (currentTask as unknown as { runner_last_failure_reason: string | null })
        .runner_last_failure_reason
      if (typeof raw === 'string' && raw.length > 0) {
        priorReason = raw.startsWith('blocked:') ? raw.slice('blocked:'.length) : raw
      }

      eventBus.broadcast('task.blocker_transition', {
        task_id: taskId,
        workspace_id: workspaceId,
        direction: 'resumed',
        previous_status: 'awaiting_owner',
        status: 'assigned',
        blocker_reason: priorReason,
        blocker_kind: null,
        resume_hint: null,
        source: 'recipe',
        attempt:
          ((currentTask as unknown as { runner_attempts: number | null | undefined })
            .runner_attempts ?? null),
        ts: now,
      })
    }

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
