/**
 * Phase 13 task-runtime-context validation helpers (TCTX-01..06).
 *
 * Three responsibilities:
 *   1. Zod schemas for the runtime field shapes (workspace_source, read_only_mounts,
 *      extra_skills). Standalone so consumers can compose them or extend the existing
 *      createTaskSchema/updateTaskSchema in validation.ts.
 *   2. validateHostPathAgainstAllowlist — the single allowlist gate every host_path
 *      flows through (POST /api/tasks, PATCH /api/tasks/[id], Phase 14 runner re-validation).
 *   3. buildAggregatedValidationResponse — CONTEXT.md's locked error shape
 *      { errors: [{ field, code, message, hint }] } as a 400 NextResponse.
 *
 * Design notes:
 *   - Errors are AGGREGATED — callers collect issues in an array across all
 *     validation passes and return ONCE. This is the CONTEXT.md "aggregated in a
 *     single 400 Bad Request" decision.
 *   - HTTP 400 always (never 422) — matches MC's existing validateBody convention.
 *   - host_path is ECHOED verbatim in errors (CONTEXT.md: "Echo offending host_path
 *     in full ... debugging value outweighs leakage risk").
 *   - Every error has an actionable `hint` (CONTEXT.md decision).
 *   - Existence is NOT enforced at this layer — realpath walks up parent directories
 *     on ENOENT so not-yet-materialised paths (like a worktree target) still validate.
 */
import { NextResponse } from 'next/server'
import { realpath } from 'node:fs/promises'
import { basename, dirname, resolve as pathResolve, sep } from 'node:path'
import { z, type ZodError } from 'zod'
import { getMountAllowlist } from './task-runtime-settings'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Error types + aggregated response
// ---------------------------------------------------------------------------

export interface TaskRuntimeValidationIssue {
  field: string // dotted path, e.g. 'read_only_mounts.0.host_path'
  code: string // SCREAMING_SNAKE error code (see TASK_RUNTIME_ERROR_CODES)
  message: string // human sentence; echoes offending value where relevant
  hint?: string // actionable suggestion
}

export const TASK_RUNTIME_ERROR_CODES = {
  RECIPE_NOT_FOUND: 'RECIPE_NOT_FOUND',
  RECIPE_BROKEN: 'RECIPE_BROKEN',
  REQUIRED_BY_RECIPE: 'REQUIRED_BY_RECIPE',
  RECIPE_LOCKED: 'RECIPE_LOCKED',
  ALLOWLIST_EMPTY: 'ALLOWLIST_EMPTY',
  OUT_OF_ALLOWLIST: 'OUT_OF_ALLOWLIST',
  INVALID_PATH: 'INVALID_PATH',
  DUPLICATE_LABEL: 'DUPLICATE_LABEL',
  DUPLICATE_SKILL_BASENAME: 'DUPLICATE_SKILL_BASENAME',
  CAP_EXCEEDED: 'CAP_EXCEEDED',
  UNKNOWN_MODEL: 'UNKNOWN_MODEL',
  INVALID_BASE_REF: 'INVALID_BASE_REF',
  INVALID_FIELD: 'INVALID_FIELD',
} as const

export function buildAggregatedValidationResponse(
  errors: TaskRuntimeValidationIssue[],
): NextResponse {
  return NextResponse.json({ errors }, { status: 400 })
}

/**
 * Translate a ZodError into TaskRuntimeValidationIssue[] so body-shape errors
 * and runtime-context errors share ONE response format. Used by Plans 13-02 /
 * 13-03 when validateBody fails on the new fields.
 *
 * ZodIssue.code (Zod internal code) maps to INVALID_FIELD by default; for the
 * custom-refine model_override issue Phase 11 raises, the issue.message contains
 * "not in the model registry" so we surface UNKNOWN_MODEL there specifically.
 */
export function zodErrorToIssues(err: ZodError): TaskRuntimeValidationIssue[] {
  return err.issues.map((issue) => {
    const field = issue.path.map(String).join('.') || '(root)'
    const message = issue.message
    let code: string = TASK_RUNTIME_ERROR_CODES.INVALID_FIELD
    if (message.includes('not in the model registry')) {
      code = TASK_RUNTIME_ERROR_CODES.UNKNOWN_MODEL
    }
    return {
      field,
      code,
      message,
      hint:
        code === TASK_RUNTIME_ERROR_CODES.UNKNOWN_MODEL
          ? 'Set model_override to a value from the model registry or omit it.'
          : 'See the Zod issue message for the exact constraint violated.',
    }
  })
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/**
 * workspace_source shape. CONTEXT.md locks:
 *   - base_ref: non-empty, no whitespace, no '..' (light syntactic check; runner
 *     resolves against the real repo)
 *   - project_id: positive integer
 */
export const WorkspaceSourceSchema = z.object({
  project_id: z.number().int().positive(),
  base_ref: z
    .string()
    .min(1, 'base_ref cannot be empty')
    .max(200)
    .refine((v) => !/\s/.test(v), { message: 'base_ref cannot contain whitespace' })
    .refine((v) => !v.includes('..'), { message: "base_ref cannot contain '..'" }),
})

export type WorkspaceSource = z.infer<typeof WorkspaceSourceSchema>

/**
 * Single read_only_mount entry. All three fields required.
 * label uniqueness is enforced on the ARRAY via readOnlyMountsArraySchema.
 */
export const ReadOnlyMountSchema = z.object({
  host_path: z.string().min(1, 'host_path is required').max(4096),
  container_path: z.string().min(1, 'container_path is required').max(4096),
  label: z
    .string()
    .min(1, 'label is required')
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/i,
      'label must start with alphanumeric and contain only alphanumerics or hyphens',
    ),
})

export type ReadOnlyMount = z.infer<typeof ReadOnlyMountSchema>

/**
 * Array-level schema with unique-label refinement. Raises a Zod issue on any
 * duplicate label so Plans 13-02/13-03 can catch and map to DUPLICATE_LABEL.
 *
 * Note: cap enforcement is NOT a Zod refinement here — caps are dynamic
 * (admin-mutable via settings), so enforcing in Zod would freeze the value at
 * module-eval time. Caps are applied separately in the POST/PATCH handlers
 * using getMountsCap() / getExtraSkillsCap().
 */
export const readOnlyMountsArraySchema = z
  .array(ReadOnlyMountSchema)
  .refine(
    (arr) => {
      const seen = new Set<string>()
      for (const m of arr) {
        if (seen.has(m.label)) return false
        seen.add(m.label)
      }
      return true
    },
    {
      message:
        'read_only_mounts contains duplicate labels; each label must be unique per task',
    },
  )

/**
 * Array-level schema for extra_skills. Each entry is a host path (string).
 * basename-uniqueness enforced at the array level.
 */
export const extraSkillsArraySchema = z
  .array(z.string().min(1, 'extra_skills entry cannot be empty').max(4096))
  .refine(
    (arr) => {
      const seen = new Set<string>()
      for (const p of arr) {
        const base = basename(p)
        if (seen.has(base)) return false
        seen.add(base)
      }
      return true
    },
    {
      message:
        'extra_skills contains entries with duplicate basenames; container mounts at /skills/<basename> collide',
    },
  )

// ---------------------------------------------------------------------------
// Allowlist resolver
// ---------------------------------------------------------------------------

export type AllowlistResult =
  | { ok: true; realpath: string }
  | { ok: false; code: string; message: string; hint: string }

/**
 * Resolve a hostPath via fs.realpath, walking up parent directories on ENOENT
 * (CONTEXT.md: "Existence check NOT enforced at task creation"), then check the
 * resolved absolute path against the current allowlist from the settings table.
 *
 * Return codes:
 *   - ALLOWLIST_EMPTY — allowlist is [] (admin hasn't configured it); mounts are
 *     rejected wholesale with a hint pointing at the settings endpoint.
 *   - OUT_OF_ALLOWLIST — realpath resolved but is not under any allowed prefix.
 *   - INVALID_PATH — realpath failed even after walking to a root that still
 *     exists (e.g. path is not absolute-resolvable, or OS denies access).
 *
 * The offending `hostPath` is echoed verbatim in both `message` and `hint` per
 * CONTEXT.md "Echo offending host_path in full".
 */
export async function validateHostPathAgainstAllowlist(
  hostPath: string,
): Promise<AllowlistResult> {
  const allowlist = getMountAllowlist()
  if (allowlist.length === 0) {
    return {
      ok: false,
      code: TASK_RUNTIME_ERROR_CODES.ALLOWLIST_EMPTY,
      message: `host_path '${hostPath}' rejected: runtime.mount_allowlist is empty. No mounts are permitted until an admin configures it.`,
      hint: "Set 'runtime.mount_allowlist' to a JSON array of allowed path prefixes via PUT /api/settings, e.g. '[\"/Users/me/repos\",\"/opt/refs\"]'.",
    }
  }

  const resolvedAbs = pathResolve(hostPath)
  let realpathResolved: string | null = null
  try {
    realpathResolved = await realpath(resolvedAbs)
  } catch (err) {
    // ENOENT is expected for not-yet-existing paths; walk up parent dirs until
    // we find an existing ancestor, then re-append the missing tail. This
    // preserves the symlink-resolution semantics for whatever DOES exist while
    // still allowing validation of non-existent targets.
    const errCode = (err as NodeJS.ErrnoException).code
    if (errCode === 'ENOENT' || errCode === 'ENOTDIR') {
      let ancestor = resolvedAbs
      const unresolvedTail: string[] = []
      // Walk up until we find an existing directory or hit the filesystem root.
      while (ancestor !== dirname(ancestor)) {
        unresolvedTail.unshift(basename(ancestor))
        ancestor = dirname(ancestor)
        try {
          const ancestorReal = await realpath(ancestor)
          realpathResolved =
            unresolvedTail.length > 0
              ? ancestorReal + sep + unresolvedTail.join(sep)
              : ancestorReal
          break
        } catch {
          continue
        }
      }
      if (realpathResolved === null) {
        // No existing ancestor at all — the path isn't resolvable.
        logger.warn(
          { hostPath, err },
          'validateHostPathAgainstAllowlist could not resolve any ancestor',
        )
        return {
          ok: false,
          code: TASK_RUNTIME_ERROR_CODES.INVALID_PATH,
          message: `host_path '${hostPath}' could not be resolved on the filesystem`,
          hint: `Supply an absolute path whose parent directory exists, and retry. Offending value: '${hostPath}'.`,
        }
      }
    } else {
      logger.warn(
        { hostPath, err },
        'validateHostPathAgainstAllowlist realpath failed',
      )
      return {
        ok: false,
        code: TASK_RUNTIME_ERROR_CODES.INVALID_PATH,
        message: `host_path '${hostPath}' could not be resolved: ${(err as Error).message}`,
        hint: `Check that '${hostPath}' is an absolute path and is accessible to the server process.`,
      }
    }
  }

  // Prefix match. Use subtree-of semantics with trailing-sep: allowlist entry
  // '/opt/refs' admits '/opt/refs' and '/opt/refs/foo' but NOT '/opt/refs-2'.
  // Apply the same realpath treatment to allowlist entries so symlinked
  // allowlist prefixes behave identically to symlinked hostPaths.
  const resolvedAllowlist: string[] = []
  for (const prefix of allowlist) {
    try {
      resolvedAllowlist.push(await realpath(pathResolve(prefix)))
    } catch {
      // Skip allowlist entries that don't resolve — a misconfigured entry
      // should not take down the whole validator; it simply doesn't admit
      // anything.
    }
  }

  const rp = realpathResolved // narrowed
  const isUnder = (prefix: string) => {
    if (rp === prefix) return true
    const withSep = prefix.endsWith(sep) ? prefix : prefix + sep
    return rp.startsWith(withSep)
  }
  if (resolvedAllowlist.some(isUnder)) {
    return { ok: true, realpath: rp }
  }
  return {
    ok: false,
    code: TASK_RUNTIME_ERROR_CODES.OUT_OF_ALLOWLIST,
    message: `host_path '${hostPath}' resolved to '${rp}' which is not under any entry of runtime.mount_allowlist. Allowed prefixes: ${JSON.stringify(allowlist)}`,
    hint: `Either supply a host_path under one of [${allowlist.join(', ')}] or ask an admin to add '${hostPath}' to runtime.mount_allowlist via PUT /api/settings.`,
  }
}
