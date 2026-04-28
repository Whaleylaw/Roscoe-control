/**
 * POST /api/runner/claim/:task_id — the critical-section endpoint the runner
 * daemon calls once per task.
 *
 * One request does all of the following atomically:
 *   1. Runner-secret auth (user.id === -1000); anything else → 403.
 *   2. Look up the task; reject 404 / 400 when missing / recipe_slug-less.
 *   3. Load the indexed recipe via getIndexedRecipeBySlug; reject 400 with
 *      RECIPE_NOT_FOUND / RECIPE_BROKEN on miss / error-row.
 *   4. Re-validate every read_only_mount.host_path + every extra_skill entry
 *      against runtime.mount_allowlist — defence-in-depth over Phase 13's
 *      creation-time check (symlinks can change between create and claim).
 *   5. Enforce global + per-recipe concurrency caps; 409 CAP_EXCEEDED via
 *      buildAggregatedValidationResponse.
 *   6. Resolve resource limits vs admin ceilings (CAP_EXCEEDED on overshoot).
 *   7. Single db.transaction:
 *      - `UPDATE tasks SET status='in_progress', container_id='pending:<id>:<n>',
 *        runner_started_at=?, runner_attempts=runner_attempts+1,
 *        worktree_path=?` (worktree_path set to the deterministic
 *        .data/runner/worktrees/task-<id>/ path when recipe.workspace_mode
 *        is 'worktree', null otherwise — RUNNER-09 / SC3). WHERE clause
 *        requires status='assigned' AND container_id IS NULL.
 *        result.changes === 0 → 409 (double-claim lost the race).
 *      - `INSERT INTO task_runner_attempts (task_id, attempt, started_at)
 *        ... ON CONFLICT DO NOTHING`.
 *      - `issueRunnerToken` to mint a per-attempt bearer; expiry =
 *        runner_started_at + recipe.timeout_seconds + 60.
 *   8. Read prior_attempts (all rows BEFORE the one just inserted), resolve
 *      runner_max_attempts from task.runner_max_attempts ??
 *      resolveRecipeMaxAttempts(slug) ?? 3 (LOCKED — filesystem re-parse, NOT
 *      from getIndexedRecipeBySlug which does not round-trip max_attempts).
 *   9. Compose the container env map (MC_* system vars + recipe.env +
 *      placeholder recipe.secrets — secrets-file resolution happens in Plan
 *      14-08b's runner daemon, not the server).
 *   10. Return the full dispatch payload the daemon hands to `docker run`.
 *
 * The placeholder container_id (`pending:<task_id>:<attempt>`) guarantees the
 * concurrency caps counted INSIDE the transaction include this in-flight
 * claim. Plan 14-11 (POST /api/runner/tasks/:id/container-started) replaces
 * the placeholder with the real Docker container_id after `docker run`.
 * Reconciliation (Plan 14-08b) matches real container_ids post-crash via the
 * `mc.task_id` label.
 */

import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'
import {
  TASK_RUNTIME_ERROR_CODES,
  buildAggregatedValidationResponse,
  validateHostPathAgainstAllowlist,
  type TaskRuntimeValidationIssue,
} from '@/lib/task-runtime-validation'
import {
  getMaxConcurrentContainers,
  getMaxMemoryPerContainer,
  getMaxCpuPerContainer,
} from '@/lib/task-runtime-settings'
import { getIndexedRecipeBySlug } from '@/lib/recipe-indexer'
import { issueRunnerToken } from '@/lib/runner-tokens'
import { getModel } from '@/lib/model-registry'
import {
  resolveEffectiveModel,
  composeEnvMap,
  resolveResourceLimits,
  checkGlobalCap,
  checkPerRecipeCap,
  readPriorAttempts,
  resolveRecipeMaxAttempts,
  resolveResumeMarker,
  buildDispatchPayload,
} from '@/lib/runner-claim'

const DEFAULT_RUNNER_MAX_ATTEMPTS = 3

interface TaskRow {
  id: number
  title: string
  description: string | null
  tags: string | null
  metadata: string | null
  recipe_slug: string | null
  model_override: string | null
  workspace_source: string | null
  read_only_mounts: string | null
  extra_skills: string | null
  status: string
  container_id: string | null
  runner_attempts: number
  runner_max_attempts: number | null
  workspace_id: number
  runner_mode?: 'work' | 'review'
}

function parseJsonColumn<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ task_id: string }> },
) {
  // 1. Auth — runner-secret principal only.
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

  // 2. Parse + validate task_id param.
  const params = await context.params
  const taskId = Number(params.task_id)
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'Invalid task_id' }, { status: 400 })
  }

  const db = getDatabase()

  // 3. Look up the task.
  const task = db
    .prepare(
      `SELECT id, recipe_slug, model_override, workspace_source, read_only_mounts,
              extra_skills, status, container_id, runner_attempts, runner_max_attempts,
              workspace_id, title, description, tags, metadata
       FROM tasks
       WHERE id = ?`,
    )
    .get(taskId) as TaskRow | undefined

  if (!task) {
    return NextResponse.json({ error: 'task not found' }, { status: 404 })
  }

  if (!task.recipe_slug) {
    return NextResponse.json(
      { error: 'task has no recipe_slug — not eligible for runner dispatch' },
      { status: 400 },
    )
  }

  // 4. Load the indexed recipe.
  const recipe = getIndexedRecipeBySlug(task.recipe_slug)
  if (!recipe) {
    return buildAggregatedValidationResponse([
      {
        field: 'recipe_slug',
        code: TASK_RUNTIME_ERROR_CODES.RECIPE_NOT_FOUND,
        message: `recipe_slug '${task.recipe_slug}' not indexed`,
        hint: 'Verify the recipe directory exists under the recipes root and was indexed without errors.',
      },
    ])
  }
  if (recipe.error_message !== null) {
    return buildAggregatedValidationResponse([
      {
        field: 'recipe_slug',
        code: TASK_RUNTIME_ERROR_CODES.RECIPE_BROKEN,
        message: `recipe_slug '${task.recipe_slug}' is in an error state: ${recipe.error_message}`,
        hint: 'Fix the recipe.yaml and re-index via POST /api/recipes/resync.',
      },
    ])
  }

  const runnerMode: 'work' | 'review' = task.status === 'quality_review' ? 'review' : 'work'
  if (runnerMode === 'review' && !recipe.review_md) {
    return NextResponse.json(
      { error: `recipe '${task.recipe_slug}' does not define REVIEW.md` },
      { status: 400 },
    )
  }
  if (runnerMode === 'review') {
    const openReviewPr = db.prepare(`
      SELECT id
      FROM task_review_prs
      WHERE task_id = ?
        AND workspace_id = ?
        AND state = 'open'
      LIMIT 1
    `).get(taskId, task.workspace_id) as { id: number } | undefined
    if (openReviewPr) {
      return NextResponse.json(
        { error: 'task is waiting on an open review PR and is not eligible for another quality review run' },
        { status: 409 },
      )
    }
  }

  // 5. Re-validate mounts + skills against the allowlist (defense-in-depth).
  const mounts = parseJsonColumn<Array<{ host_path: string; container_path: string; label: string }>>(
    task.read_only_mounts,
    [],
  )
  const skills = parseJsonColumn<string[]>(task.extra_skills, [])
  const workspaceSource = task.workspace_source ? parseJsonColumn<unknown>(task.workspace_source, null) : null
  const taskTags = parseJsonColumn<unknown[]>(task.tags, [])
  const taskMetadata = parseJsonColumn<Record<string, unknown>>(task.metadata, {})

  const allowlistIssues: TaskRuntimeValidationIssue[] = []
  for (let i = 0; i < mounts.length; i++) {
    const m = mounts[i]
    if (!m || typeof m.host_path !== 'string') continue
    const result = await validateHostPathAgainstAllowlist(m.host_path)
    if (!result.ok) {
      allowlistIssues.push({
        field: `read_only_mounts.${i}.host_path`,
        code: result.code,
        message: result.message,
        hint: result.hint,
      })
    }
  }
  for (let i = 0; i < skills.length; i++) {
    const hostPath = skills[i]
    if (typeof hostPath !== 'string') continue
    const result = await validateHostPathAgainstAllowlist(hostPath)
    if (!result.ok) {
      allowlistIssues.push({
        field: `extra_skills.${i}`,
        code: result.code,
        message: result.message,
        hint: result.hint,
      })
    }
  }
  if (allowlistIssues.length > 0) {
    return buildAggregatedValidationResponse(allowlistIssues)
  }

  // 6. Concurrency caps.
  const globalCap = getMaxConcurrentContainers()
  const globalCheck = checkGlobalCap(db, globalCap)
  if (!globalCheck.ok) {
    return NextResponse.json(
      {
        errors: [
          {
            field: '(global)',
            code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED,
            message: `global concurrency cap reached: ${globalCheck.current}/${globalCap} containers in-flight`,
            hint: `Wait for an in-flight task to finish, or raise runtime.max_concurrent_containers via PUT /api/settings.`,
          },
        ],
      },
      { status: 409 },
    )
  }
  const perRecipeCheck = checkPerRecipeCap(db, task.recipe_slug, recipe.max_concurrent)
  if (!perRecipeCheck.ok) {
    return NextResponse.json(
      {
        errors: [
          {
            field: 'recipe.max_concurrent',
            code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED,
            message: `per-recipe concurrency cap reached: ${perRecipeCheck.current}/${recipe.max_concurrent} containers for recipe '${task.recipe_slug}'`,
            hint: `Wait for another instance of this recipe to finish, or raise max_concurrent in recipe.yaml.`,
          },
        ],
      },
      { status: 409 },
    )
  }

  // 7. Resolve resource limits vs admin ceilings.
  const adminMemoryCeiling = getMaxMemoryPerContainer()
  const adminCpuCeiling = getMaxCpuPerContainer()
  // Recipe memory/cpu limits are NOT schema fields in v1.2 — reserve for a
  // later phase. Until then, always fall back to runner defaults (2g, 1.0).
  const limits = resolveResourceLimits({
    recipeMemoryLimit: null,
    recipeCpuLimit: null,
    adminMemoryCeiling,
    adminCpuCeiling,
  })
  if (!limits.ok) {
    return NextResponse.json({ errors: [limits.error] }, { status: 409 })
  }

  // 8. Atomic transaction — UPDATE tasks, INSERT task_runner_attempts, mint token.
  const nowUnix = Math.floor(Date.now() / 1000)
  const nextAttempt = (task.runner_attempts ?? 0) + 1
  const placeholder = `pending:${taskId}:${nextAttempt}`
  // worktree_path is deterministic from task_id for workspace_mode='worktree'
  // recipes; the runner daemon creates the directory at this exact path before
  // `git worktree add`. RUNNER-09 / SC3.
  const worktreePath =
    recipe.workspace_mode === 'worktree'
      ? path.join(config.dataDir, 'runner', 'worktrees', `task-${taskId}`)
      : null

  let outcome: { claimed: false } | { claimed: true; token: { token: string; expiresAt: number } }
  try {
    outcome = db.transaction(() => {
      const result = db
        .prepare(
          `UPDATE tasks
           SET status = CASE WHEN status = 'quality_review' THEN 'quality_review' ELSE 'in_progress' END,
               container_id = ?,
               runner_started_at = ?,
               runner_attempts = runner_attempts + 1,
               runner_exit_code = NULL,
               runner_last_failure_reason = NULL,
               worktree_path = ?,
               updated_at = ?
           WHERE id = ?
             AND status IN ('assigned', 'quality_review')
             AND container_id IS NULL
             AND recipe_slug IS NOT NULL`,
        )
        .run(placeholder, nowUnix, worktreePath, nowUnix, taskId)
      if (result.changes === 0) {
        return { claimed: false as const }
      }

      db.prepare(
        `INSERT INTO task_runner_attempts (task_id, attempt, started_at)
         VALUES (?, ?, ?)
         ON CONFLICT(task_id, attempt) DO NOTHING`,
      ).run(taskId, nextAttempt, nowUnix)

      const token = issueRunnerToken(
        db,
        taskId,
        nextAttempt,
        recipe.timeout_seconds,
        nowUnix,
      )
      return { claimed: true as const, token }
    })()
  } catch (err) {
    logger.error({ err, taskId }, 'POST /api/runner/claim — transaction failed')
    throw err
  }

  if (!outcome.claimed) {
    return NextResponse.json(
      { error: 'already claimed or ineligible' },
      { status: 409 },
    )
  }

  eventBus.broadcast('task.status_changed', {
    id: taskId,
    task_id: taskId,
    status: runnerMode === 'review' ? 'quality_review' : 'in_progress',
    runner_mode: runnerMode,
    previous_status: task.status,
    container_id: placeholder,
    runner_started_at: nowUnix,
    runner_attempts: nextAttempt,
    worktree_path: worktreePath,
    workspace_id: task.workspace_id,
    at: nowUnix,
  })

  // 9. Read prior attempts (exclude the one we just inserted).
  const allAttempts = readPriorAttempts(db, taskId)
  const priorAttempts = allAttempts.filter((row) => row.attempt < nextAttempt)

  // 10. Resolve runner_max_attempts — LOCKED precedence:
  //   task.runner_max_attempts  ??  resolveRecipeMaxAttempts(slug)  ??  3
  const resolvedMaxAttempts =
    task.runner_max_attempts ??
    resolveRecipeMaxAttempts(task.recipe_slug) ??
    DEFAULT_RUNNER_MAX_ATTEMPTS

  // 11. Compose the container env map.
  const modelPrimary = resolveEffectiveModel(task.model_override, recipe.model.primary)
  const modelFallback = recipe.model.fallback ?? null
  const modelProvider =
    recipe.model.provider ||
    getModel(modelPrimary)?.provider ||
    'anthropic'
  const apiUrl = `http://host.docker.internal:${process.env.PORT || '3000'}`

  const env = composeEnvMap({
    apiUrl,
    taskId,
    workspacePath: '/workspace',
    recipePath: '/recipe',
    preamblePath: '/recipe/PREAMBLE.md',
    runnerToken: outcome.token.token,
    modelPrimary,
    modelFallback,
    modelProvider,
    modelParams: recipe.model.params,
    recipeEnv: recipe.env,
    // recipe.secrets is a list of ENV VAR NAMES — values are resolved by the
    // runner daemon from .data/runner/secrets/<NAME>. The server never reads
    // those files; keeping the env-merge step here a no-op for secret values
    // preserves the "secrets never touch HTTP" property.
    recipeSecrets: undefined,
  })
  env.MC_RUNNER_MODE = runnerMode

  // 12. Build dispatch payload.
  // Phase 15 CP-04: query the most-recent blocked checkpoint and attach the
  // marker so the daemon can pass it to seedMcDir on the resumed attempt.
  // resolveResumeMarker returns null when the latest checkpoint is non-blocker
  // or no checkpoints exist (first attempt) — the dispatch payload field is
  // typed as `ResumeMarker | null` either way.
  const resumeMarker = resolveResumeMarker(db, taskId)

  const taskPayload = buildDispatchPayload({
    taskId,
    title: task.title,
    description: task.description,
    tags: taskTags,
    metadata: taskMetadata,
    recipeSlug: task.recipe_slug,
    workspaceSource,
    readOnlyMounts: mounts,
    extraSkills: skills,
    newAttempt: nextAttempt,
    priorAttempts,
    runnerMaxAttempts: resolvedMaxAttempts,
    resumeMarker,
  })
  ;(taskPayload as unknown as Record<string, unknown>).runner_mode = runnerMode

  return NextResponse.json({
    task: taskPayload,
    recipe,
    env,
    runner_token_expires_at: outcome.token.expiresAt,
    resource_limits: { memory: limits.memory, cpus: limits.cpus },
    container_name_prefix: `mc-task-${taskId}-a${nextAttempt}`,
  })
}
