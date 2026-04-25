/**
 * Pure helpers used by the runner claim route (Plan 14-05) and runner-exit
 * route (Plan 14-06). Kept in a standalone module so the HTTP handlers stay
 * thin and the logic is unit-testable without spinning up Next.js.
 *
 * Phase 14 locked decision (per 14-02 SUMMARY + 14-05/14-06 frontmatter):
 * `recipe.max_attempts` is NOT round-tripped through the recipes DB row.
 * `getIndexedRecipeBySlug` projects a fixed column set and the `recipes`
 * table has no `max_attempts` column. Resolution happens via filesystem
 * re-parse of `recipe.yaml` — this module owns the helper.
 *
 * Resolution rule at claim / exit time:
 *   final_max_attempts = task.runner_max_attempts
 *                     ?? resolveRecipeMaxAttempts(slug)
 *                     ?? 3
 *
 * This module is HTTP-free and NextRequest-free. Claim and runner-exit route
 * handlers compose these helpers into their atomic transactions.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRecipesRoot } from '@/lib/recipe-watcher'
import { parseRecipeYaml } from '@/lib/recipe-schema'
import {
  TASK_RUNTIME_ERROR_CODES,
  type TaskRuntimeValidationIssue,
} from '@/lib/task-runtime-validation'

// ---------------------------------------------------------------------------
// Model resolution (MODEL-04)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective model for a task.
 *
 * Precedence: task.model_override (when present and non-empty) → recipe.model.primary.
 * Both sides are validated at creation time (Phase 11-01 + Phase 12-01) so this
 * helper does NOT re-validate the string against the model registry.
 *
 * Empty strings and null/undefined for `taskOverride` both fall through to the
 * recipe primary — matches the "null means unset" DB semantics from migration 057.
 */
export function resolveEffectiveModel(
  taskOverride: string | null | undefined,
  recipePrimary: string,
): string {
  if (typeof taskOverride === 'string' && taskOverride.length > 0) {
    return taskOverride
  }
  return recipePrimary
}

// ---------------------------------------------------------------------------
// Container env composition (CONTAINER-01)
// ---------------------------------------------------------------------------

export interface ComposeEnvMapParams {
  apiUrl: string
  taskId: number
  workspacePath: string
  recipePath: string
  preamblePath: string
  runnerToken: string
  modelPrimary: string
  modelFallback?: string | null
  modelProvider: string
  modelParams?: unknown
  /** Recipe-declared env map (from recipe.yaml `env`). */
  recipeEnv?: Record<string, string>
  /** Resolved secrets (e.g. values read from `.data/runner/secrets/<NAME>`). Merged LAST so they can override recipe.env. */
  recipeSecrets?: Record<string, string>
}

/**
 * Compose the full container env map.
 *
 * Merge order (later keys win):
 *   1. MC_* system vars (API_URL, TASK_ID, API_TOKEN, WORKSPACE, RECIPE_PATH,
 *      PREAMBLE_PATH, MODEL_PRIMARY, MODEL_FALLBACK?, MODEL_PROVIDER, MODEL_PARAMS_JSON)
 *   2. recipe.env (operator-authored env)
 *   3. recipe.secrets (resolved per-secret values)
 *
 * MC_MODEL_FALLBACK is omitted entirely (not emitted as empty string) when
 * `modelFallback` is null / undefined / empty. MC_MODEL_PARAMS_JSON is always
 * JSON.stringify'd — callers on the container side read it via JSON.parse.
 */
export function composeEnvMap(params: ComposeEnvMapParams): Record<string, string> {
  const out: Record<string, string> = {
    MC_API_URL: params.apiUrl,
    MC_TASK_ID: String(params.taskId),
    MC_API_TOKEN: params.runnerToken,
    MC_WORKSPACE: params.workspacePath,
    MC_RECIPE_PATH: params.recipePath,
    MC_PREAMBLE_PATH: params.preamblePath,
    MC_MODEL_PRIMARY: params.modelPrimary,
    MC_MODEL_PROVIDER: params.modelProvider,
    MC_MODEL_PARAMS_JSON: JSON.stringify(params.modelParams ?? {}),
  }

  if (typeof params.modelFallback === 'string' && params.modelFallback.length > 0) {
    out.MC_MODEL_FALLBACK = params.modelFallback
  }

  if (params.recipeEnv) {
    for (const [k, v] of Object.entries(params.recipeEnv)) {
      out[k] = v
    }
  }
  if (params.recipeSecrets) {
    for (const [k, v] of Object.entries(params.recipeSecrets)) {
      out[k] = v
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Resource limits (RUNNER-09, admin ceilings from Plan 14-02)
// ---------------------------------------------------------------------------

/** Runner-default memory limit when recipe does not declare one. */
export const RUNNER_DEFAULT_MEMORY_LIMIT = '2g'
/** Runner-default CPU limit when recipe does not declare one. */
export const RUNNER_DEFAULT_CPU_LIMIT = 1.0

export interface ResolveResourceLimitsParams {
  /** Recipe-declared memory limit, e.g. '4g' or '512m'. Null/undefined → runner default. */
  recipeMemoryLimit?: string | null
  /** Recipe-declared CPU limit, e.g. 2.0. Null/undefined → runner default. */
  recipeCpuLimit?: number | null
  /** Admin ceiling from runtime.max_memory_per_container (Plan 14-02 default '8g'). */
  adminMemoryCeiling: string
  /** Admin ceiling from runtime.max_cpu_per_container (Plan 14-02 default 4.0). */
  adminCpuCeiling: number
}

export type ResolveResourceLimitsResult =
  | { ok: true; memory: string; cpus: number }
  | { ok: false; error: TaskRuntimeValidationIssue }

/**
 * Parse a Docker-style memory string (e.g. '2g', '512m', '1024k') into bytes.
 *
 * Accepts suffixes: b (bytes), k/kb, m/mb, g/gb. Bare numbers are treated as
 * bytes. Returns NaN when the string fails to parse — callers map that to an
 * INVALID_FIELD rejection.
 */
export function parseMemoryBytes(value: string): number {
  const trimmed = value.trim().toLowerCase()
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([bkmg]b?)?$/)
  if (!match) return NaN
  const num = parseFloat(match[1])
  if (!Number.isFinite(num) || num < 0) return NaN
  const suffix = match[2] ?? 'b'
  switch (suffix) {
    case 'b':
      return num
    case 'k':
    case 'kb':
      return num * 1024
    case 'm':
    case 'mb':
      return num * 1024 * 1024
    case 'g':
    case 'gb':
      return num * 1024 * 1024 * 1024
    default:
      return NaN
  }
}

/**
 * Resolve the effective resource limits for a container, enforcing admin ceilings.
 *
 * Precedence: recipe-declared limit → runner default.
 * Admin ceilings (from runtime.max_memory_per_container /
 * runtime.max_cpu_per_container) are a HARD cap: if the recipe declares more
 * than the ceiling, the call fails with CAP_EXCEEDED.
 *
 * When a declared value fails to parse, returns INVALID_FIELD rather than
 * silently substituting the default — we want the operator to fix the recipe.
 */
export function resolveResourceLimits(
  params: ResolveResourceLimitsParams,
): ResolveResourceLimitsResult {
  // Memory.
  const rawMemory =
    typeof params.recipeMemoryLimit === 'string' && params.recipeMemoryLimit.length > 0
      ? params.recipeMemoryLimit
      : RUNNER_DEFAULT_MEMORY_LIMIT
  const memBytes = parseMemoryBytes(rawMemory)
  if (!Number.isFinite(memBytes)) {
    return {
      ok: false,
      error: {
        field: 'recipe.memory_limit',
        code: TASK_RUNTIME_ERROR_CODES.INVALID_FIELD,
        message: `recipe.memory_limit '${rawMemory}' is not a valid Docker memory string (expected e.g. '2g', '512m')`,
        hint: 'Use a positive integer followed by b/k/m/g (case-insensitive).',
      },
    }
  }
  const ceilingBytes = parseMemoryBytes(params.adminMemoryCeiling)
  if (!Number.isFinite(ceilingBytes)) {
    return {
      ok: false,
      error: {
        field: 'runtime.max_memory_per_container',
        code: TASK_RUNTIME_ERROR_CODES.INVALID_FIELD,
        message: `runtime.max_memory_per_container '${params.adminMemoryCeiling}' is not a valid Docker memory string`,
        hint: "Set runtime.max_memory_per_container via PUT /api/settings to a string like '8g'.",
      },
    }
  }
  if (memBytes > ceilingBytes) {
    return {
      ok: false,
      error: {
        field: 'recipe.memory_limit',
        code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED,
        message: `recipe.memory_limit '${rawMemory}' exceeds admin ceiling runtime.max_memory_per_container '${params.adminMemoryCeiling}'`,
        hint: `Lower the recipe's memory_limit to at most '${params.adminMemoryCeiling}' or have an admin raise runtime.max_memory_per_container.`,
      },
    }
  }

  // CPU.
  const rawCpu =
    typeof params.recipeCpuLimit === 'number' && Number.isFinite(params.recipeCpuLimit)
      ? params.recipeCpuLimit
      : RUNNER_DEFAULT_CPU_LIMIT
  if (rawCpu <= 0) {
    return {
      ok: false,
      error: {
        field: 'recipe.cpu_limit',
        code: TASK_RUNTIME_ERROR_CODES.INVALID_FIELD,
        message: `recipe.cpu_limit '${rawCpu}' must be a positive number`,
        hint: 'Use a positive number of cores, e.g. 1.0 or 2.5.',
      },
    }
  }
  if (rawCpu > params.adminCpuCeiling) {
    return {
      ok: false,
      error: {
        field: 'recipe.cpu_limit',
        code: TASK_RUNTIME_ERROR_CODES.CAP_EXCEEDED,
        message: `recipe.cpu_limit ${rawCpu} exceeds admin ceiling runtime.max_cpu_per_container ${params.adminCpuCeiling}`,
        hint: `Lower the recipe's cpu_limit to at most ${params.adminCpuCeiling} or have an admin raise runtime.max_cpu_per_container.`,
      },
    }
  }

  return { ok: true, memory: rawMemory, cpus: rawCpu }
}

// ---------------------------------------------------------------------------
// Concurrency caps (RUNNER-08)
// ---------------------------------------------------------------------------

export type CapCheckResult = { ok: true } | { ok: false; current: number }

/**
 * Count tasks currently holding a container and compare against the global cap.
 *
 * Counts every task with `status='in_progress' AND container_id IS NOT NULL`.
 * This includes `pending:<task_id>:<attempt>` placeholders (set at claim time
 * and replaced with the real Docker ID post-`docker run`) so in-flight claims
 * count toward the cap — critical to prevent two simultaneous claims from
 * both passing the cap check.
 */
export function checkGlobalCap(
  db: Database.Database,
  maxGlobal: number,
): CapCheckResult {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE status = 'in_progress' AND container_id IS NOT NULL`,
    )
    .get() as { c: number } | undefined
  const current = row?.c ?? 0
  if (current < maxGlobal) return { ok: true }
  return { ok: false, current }
}

/**
 * Count tasks currently holding a container for a specific recipe slug and
 * compare against the per-recipe cap. Same include-placeholder semantics as
 * checkGlobalCap.
 */
export function checkPerRecipeCap(
  db: Database.Database,
  recipeSlug: string,
  maxPerRecipe: number,
): CapCheckResult {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tasks
       WHERE status = 'in_progress'
         AND container_id IS NOT NULL
         AND recipe_slug = ?`,
    )
    .get(recipeSlug) as { c: number } | undefined
  const current = row?.c ?? 0
  if (current < maxPerRecipe) return { ok: true }
  return { ok: false, current }
}

// ---------------------------------------------------------------------------
// Prior attempts (WORK-02)
// ---------------------------------------------------------------------------

export interface PriorAttempt {
  attempt: number
  started_at: number
  exit_code: number | null
  failure_reason: string | null
}

/**
 * Read all prior attempt rows for a task, in chronological order. Feeds the
 * dispatch payload's `task.prior_attempts[]` so the agent can surface
 * resume-context inside the container (WORK-02).
 */
export function readPriorAttempts(
  db: Database.Database,
  taskId: number,
): PriorAttempt[] {
  return db
    .prepare(
      `SELECT attempt, started_at, exit_code, failure_reason
       FROM task_runner_attempts
       WHERE task_id = ?
       ORDER BY attempt ASC`,
    )
    .all(taskId) as PriorAttempt[]
}

// ---------------------------------------------------------------------------
// Recipe max_attempts filesystem re-parse (LOCKED — Plan 14-02 decision)
// ---------------------------------------------------------------------------

/**
 * Re-parse the recipe's on-disk `recipe.yaml` and return the declared
 * `max_attempts` (optional field, 1..10).
 *
 * LOCKED: getIndexedRecipeBySlug does NOT round-trip max_attempts (the recipes
 * DB row has no column for it). This helper is the canonical resolver at claim
 * time and exit time — see Plan 14-02 decisions.
 *
 * Silently returns `undefined` on missing file, unreadable file, or parse
 * error. A corrupt recipe.yaml must NEVER prevent the claim/exit state
 * machine from making progress — the 500 surface belongs to the indexer,
 * not to the runner-exit hot path.
 *
 * @param slug  Recipe slug (directory name under recipes root).
 * @param recipesRootOverride  Optional override for the recipes root. Used
 *                             by tests to point at a tmpdir fixture without
 *                             mutating `MISSION_CONTROL_RECIPES_DIR`.
 */
export function resolveRecipeMaxAttempts(
  slug: string,
  recipesRootOverride?: string,
): number | undefined {
  if (!slug) return undefined
  const recipesRoot = recipesRootOverride ?? getRecipesRoot()
  const yamlPath = join(recipesRoot, slug, 'recipe.yaml')
  if (!existsSync(yamlPath)) return undefined
  try {
    const raw = readFileSync(yamlPath, 'utf8')
    const parsed = parseRecipeYaml(raw)
    if (parsed.ok) return parsed.value.max_attempts
  } catch {
    // Fall through to undefined — see function-header contract.
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Dispatch payload shaping (consumer: Plan 14-08b runner daemon)
// ---------------------------------------------------------------------------

export interface DispatchTaskPayload {
  id: number
  title?: string | null
  description?: string | null
  tags?: unknown
  metadata?: unknown
  recipe_slug: string
  workspace_source: unknown
  read_only_mounts: unknown
  extra_skills: unknown
  attempt: number
  is_resuming: boolean
  prior_attempts: PriorAttempt[]
  runner_max_attempts: number
  /**
   * Phase 15 CP-04: present on resume attempts whose latest checkpoint is
   * status='blocked'; null otherwise (first attempts + non-blocker resumes).
   * Daemon forwards into seedMcDir which appends the LOCKED marker line to
   * progress.md.
   */
  resume_marker: ResumeMarker | null
}

export interface BuildDispatchPayloadParams {
  taskId: number
  title?: string | null
  description?: string | null
  tags?: unknown
  metadata?: unknown
  recipeSlug: string
  workspaceSource: unknown
  readOnlyMounts: unknown
  extraSkills: unknown
  newAttempt: number
  priorAttempts: PriorAttempt[]
  runnerMaxAttempts: number
  /** Phase 15 CP-04 — resolved via resolveResumeMarker(db, taskId). */
  resumeMarker?: ResumeMarker | null
}

/**
 * Shape the `task` sub-object of the claim response. `is_resuming` is derived
 * purely from `newAttempt > 1` — a second attempt is always a resume in the
 * v1.2 semantics (even if the prior attempt failed instantly).
 *
 * `priorAttempts` is assumed to have ALREADY been filtered to exclude the
 * row for `newAttempt` (the caller holds the transaction and inserted it just
 * before reading). This helper does not re-filter.
 *
 * Phase 15 CP-04 extension: the optional `resumeMarker` field is included in
 * the response so the runner daemon can pass it to seedMcDir on the next
 * attempt. The claim route resolves the marker via `resolveResumeMarker(db,
 * taskId)` and passes it through here.
 */
export function buildDispatchPayload(
  params: BuildDispatchPayloadParams,
): DispatchTaskPayload {
  return {
    id: params.taskId,
    title: params.title ?? null,
    description: params.description ?? null,
    tags: params.tags ?? null,
    metadata: params.metadata ?? null,
    recipe_slug: params.recipeSlug,
    workspace_source: params.workspaceSource,
    read_only_mounts: params.readOnlyMounts,
    extra_skills: params.extraSkills,
    attempt: params.newAttempt,
    is_resuming: params.newAttempt > 1,
    prior_attempts: params.priorAttempts,
    runner_max_attempts: params.runnerMaxAttempts,
    resume_marker: params.resumeMarker ?? null,
  }
}

// ---------------------------------------------------------------------------
// Resume marker resolution (Phase 15 CP-04)
// ---------------------------------------------------------------------------

/**
 * Phase 15 CP-04 — payload that surfaces the most-recent blocker reason on a
 * resume attempt. The runner daemon receives this via the claim dispatch
 * payload and forwards it into `seedMcDir`, which appends a single LOCKED
 * marker line to `<worktree>/.mc/progress.md`. The agent's preamble reads
 * progress.md at startup, so the blocker reason surfaces naturally without
 * expanding the runtime env surface.
 */
export interface ResumeMarker {
  blocker_reason: string
  /** ISO-8601 timestamp of the blocker checkpoint (created_at). */
  at_iso: string
}

/**
 * Query the most recent checkpoint for a task and, when it is a blocked
 * checkpoint, return the marker payload to inject into progress.md on resume.
 *
 * Rule: inject ONLY when the LATEST checkpoint (ORDER BY id DESC LIMIT 1) is
 * status='blocked'. Returns null when:
 *   - Task has no checkpoints.
 *   - Latest checkpoint is non-blocker (the blocker was resolved and a later
 *     checkpoint landed; injecting the stale marker would mislead the agent).
 *   - Latest checkpoint is blocked but blocker_reason IS NULL (defensive — the
 *     CP-01 Zod refine prevents this combination, but guard anyway).
 *
 * The `id DESC` ordering is the SAME row that the blocker flow flipped the
 * task on. If the agent continued posting checkpoints after an owner flipped
 * the task back AND before the daemon re-claimed, the follow-up checkpoints
 * are still legitimate progress context — the rule is "latest must be the
 * blocker" rather than "any blocker exists in history".
 */
export function resolveResumeMarker(
  db: Database.Database,
  taskId: number,
): ResumeMarker | null {
  const row = db
    .prepare(
      `SELECT status, blocker_reason, created_at
       FROM task_checkpoints
       WHERE task_id = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(taskId) as
    | {
        status: string
        blocker_reason: string | null
        created_at: number
      }
    | undefined

  if (!row) return null
  if (row.status !== 'blocked') return null
  if (!row.blocker_reason) return null

  return {
    blocker_reason: row.blocker_reason,
    at_iso: new Date(row.created_at * 1000).toISOString(),
  }
}
