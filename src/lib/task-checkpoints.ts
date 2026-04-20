/**
 * Task checkpoints — Zod schemas + atomic DB+JSONL write + read helpers.
 *
 * Plan 15-04 (CP-01/CP-02/CP-05/CP-06).
 *
 * Pure-logic module. Route handlers in
 * src/app/api/tasks/[id]/checkpoints/route.ts thin-wrap these.
 *
 * ATOMIC-WRITE CONTRACT (locked by .planning/phases/15-checkpoints-scheduler-v1-2/15-CONTEXT.md
 * § Checkpoint Persistence Contract):
 *
 *   - writeCheckpoint wraps the INSERT into task_checkpoints AND the
 *     fs.appendFileSync to <worktreePath>/.mc/checkpoints.jsonl in ONE
 *     better-sqlite3 db.transaction. Throws on any failure.
 *   - On throw, better-sqlite3 rolls the DB INSERT back automatically
 *     (see "Pitfall 2: Async function inside db.transaction" — the callback
 *     MUST be synchronous; we use appendFileSync/statSync/truncateSync, never
 *     their fs.promises counterparts).
 *   - JSONL may have landed before the throw. The CALLER must snapshot
 *     fs.statSync(jsonlPath).size BEFORE invoking writeCheckpoint and
 *     fs.truncateSync the file back to that size in the catch branch.
 *     Plan 15-05 extends the transaction with additional DB ops; the
 *     compensation lives in the caller either way.
 *   - The caller MUST call eventBus.broadcast('task.checkpoint_added', ...)
 *     AFTER the transaction commits (never inside) so subscribers only see
 *     committed state.
 *
 * Concurrent-writer edge case (Pitfall 8): two POSTs racing under failure
 * can produce a JSONL "ghost line" from a rolled-back DB row when the
 * caller truncates to pre-call size. Phase 15 v1.2 does NOT serialize POSTs;
 * the in-container pre-post JSONL (Phase 14 hello-world recipe) remains the
 * local audit source-of-truth if the host JSONL diverges.
 *
 * Plan 15-05 extension note: the blocker-transition state machine
 * (in_progress → awaiting_owner + auto-comment INSERT + docker-stop trigger)
 * lands inside the SAME writeCheckpoint transaction via one of two routes:
 *   (a) writeCheckpoint grows an optional extraOps(db, id) callback, OR
 *   (b) route.ts unrolls writeCheckpoint and inlines the extra DB ops.
 * See 15-04-SUMMARY.md for the trade-off.
 */

import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { z } from 'zod'

// ---------- Zod schemas (CP-05 discriminated union) ----------

const summaryField = { summary: z.string().max(4000).optional() }

/**
 * Artifact shape — strict per-kind via Zod discriminated union (CP-05).
 *
 * Unknown `kind` → Zod returns a discriminator error; route handler surfaces
 * the issue array verbatim at 400.
 */
export const ArtifactSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('file'),
    path: z.string().min(1).max(1000),
    ...summaryField,
  }),
  z.object({
    kind: z.literal('url'),
    url: z.string().min(1).max(2000),
    ...summaryField,
  }),
  z
    .object({
      kind: z.literal('diff'),
      path: z.string().min(1).max(1000).optional(),
      ref: z.string().min(1).max(200).optional(),
      ...summaryField,
    })
    .refine((a) => Boolean(a.path || a.ref), {
      message: 'diff requires path OR ref',
      path: ['path'],
    }),
  z
    .object({
      kind: z.literal('test_result'),
      path: z.string().min(1).max(1000).optional(),
      url: z.string().min(1).max(2000).optional(),
      summary: z.string().min(1).max(4000).optional(),
    })
    .refine((a) => Boolean(a.path || a.url || a.summary), {
      message: 'test_result requires at least one of path/url/summary',
      path: ['summary'],
    }),
  z.object({
    kind: z.literal('comment'),
    summary: z.string().min(1).max(4000),
  }),
  z.object({
    kind: z.literal('other'),
    path: z.string().max(1000).optional(),
    url: z.string().max(2000).optional(),
    ref: z.string().max(200).optional(),
    summary: z.string().max(4000).optional(),
  }),
])

export type Artifact = z.infer<typeof ArtifactSchema>

/**
 * POST body shape. The `status='blocked' && empty blocker_reason` case is
 * rejected by the top-level refine; Plan 15-05 relies on this guarantee so
 * the blocker state machine can assume a non-empty reason is present.
 */
export const CheckpointBodySchema = z
  .object({
    step: z.string().min(1).max(200),
    summary: z.string().min(1).max(4000),
    status: z.enum(['completed', 'in_progress', 'blocked']),
    artifacts: z.array(ArtifactSchema).max(50).optional(),
    next_step: z.string().max(500).optional(),
    blocker_reason: z.string().max(2000).optional(),
    tokens_used: z.number().int().min(0).optional(),
    duration_ms: z.number().int().min(0).optional(),
  })
  .refine(
    (b) =>
      b.status !== 'blocked' ||
      (b.blocker_reason !== undefined && b.blocker_reason.trim().length > 0),
    {
      message: 'status=blocked requires non-empty blocker_reason',
      path: ['blocker_reason'],
    },
  )

export type CheckpointBody = z.infer<typeof CheckpointBodySchema>

// ---------- Atomic write helper ----------

export interface CheckpointInsertResult {
  id: number
  attempt: number
  ts: string // ISO-8601
  nowUnix: number
}

/**
 * Options for extending the writeCheckpoint atomic transaction.
 *
 * Plan 15-05 CP-03: the blocker branch needs to run additional DB ops
 * (tasks status flip + system comment INSERT) INSIDE the same db.transaction
 * that wrote the task_checkpoints row and appended the JSONL line — if any
 * of these operations fail, the entire atomic unit rolls back together.
 */
export interface WriteCheckpointOptions {
  /**
   * Callback invoked inside the atomic db.transaction AFTER the task_checkpoints
   * INSERT and JSONL append. Throwing rolls back the entire transaction (both
   * the INSERT and any DB ops performed in the callback). Used by the blocker
   * branch to add tasks UPDATE + comment INSERT within the same atomic
   * boundary.
   *
   * MUST be synchronous — async callbacks break better-sqlite3 transaction
   * semantics (see Pitfall 2 in 15-RESEARCH.md).
   *
   * Receives the same `db` handle (so callers can re-prepare statements) plus
   * the inserted row id and the unix timestamp used for the INSERT. Callers
   * that need the timestamp to match the checkpoint row's `created_at` should
   * use `nowUnix` rather than calling Date.now() again.
   */
  onInsert?: (
    db: Database.Database,
    insertedId: number,
    nowUnix: number,
  ) => void
}

/**
 * Atomic DB + JSONL write. Throws on any failure.
 *
 * Caller MUST:
 *   1. Snapshot fs.statSync(jsonlPath).size BEFORE this call (pre-call size).
 *   2. Wrap in try/catch and, on catch, truncate the JSONL back to pre-call
 *      size (the DB transaction rolls back automatically on throw).
 *   3. Broadcast 'task.checkpoint_added' AFTER this call returns normally.
 *
 * Returns server-generated id + echo of attempt + ISO timestamp + unix seconds
 * (the route handler echoes the first three in the 201 response body and uses
 * nowUnix for downstream state-machine writes in Plan 15-05).
 */
export function writeCheckpoint(
  db: Database.Database,
  taskId: number,
  attempt: number,
  worktreePath: string | null,
  body: CheckpointBody,
  options: WriteCheckpointOptions = {},
): CheckpointInsertResult {
  const nowUnix = Math.floor(Date.now() / 1000)
  const ts = new Date(nowUnix * 1000).toISOString()

  const result = db.transaction(() => {
    const res = db
      .prepare(
        `
        INSERT INTO task_checkpoints
          (task_id, attempt, step, summary, status, artifacts_json,
           next_step, blocker_reason, tokens_used, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        taskId,
        attempt,
        body.step,
        body.summary,
        body.status,
        JSON.stringify(body.artifacts ?? []),
        body.next_step ?? null,
        body.blocker_reason ?? null,
        body.tokens_used ?? null,
        body.duration_ms ?? null,
        nowUnix,
      )
    const id = Number(res.lastInsertRowid)

    if (worktreePath) {
      const jsonlPath = path.join(worktreePath, '.mc', 'checkpoints.jsonl')
      const line =
        JSON.stringify({
          id,
          task_id: taskId,
          attempt,
          ts,
          step: body.step,
          summary: body.summary,
          status: body.status,
          artifacts: body.artifacts ?? [],
          next_step: body.next_step ?? null,
          blocker_reason: body.blocker_reason ?? null,
          tokens_used: body.tokens_used ?? null,
          duration_ms: body.duration_ms ?? null,
        }) + '\n'
      fs.mkdirSync(path.dirname(jsonlPath), { recursive: true })
      fs.appendFileSync(jsonlPath, line, { mode: 0o600 })
    }

    // Plan 15-05 CP-03 extension: run caller-supplied additional DB ops
    // inside the atomic transaction. A throw here rolls back the INSERT
    // above (and the outer caller truncates the JSONL).
    if (options.onInsert) {
      options.onInsert(db, id, nowUnix)
    }

    return { id, attempt, ts, nowUnix } satisfies CheckpointInsertResult
  })()

  return result
}

// ---------- Read helper (CP-06) ----------

export interface CheckpointRow {
  id: number
  task_id: number
  attempt: number
  step: string
  summary: string
  status: 'completed' | 'in_progress' | 'blocked'
  artifacts: Artifact[]
  next_step: string | null
  blocker_reason: string | null
  tokens_used: number | null
  duration_ms: number | null
  created_at: number // unix seconds
}

/**
 * Read the checkpoint timeline for a task.
 *
 * Ordering: (attempt ASC, id ASC). Deterministic and stable, even across
 * rows created in the same second (id is AUTOINCREMENT so equal-created_at
 * rows are insertion-ordered). The underlying index
 * idx_task_checkpoints_task_attempt_created covers the (task_id, attempt, ...)
 * prefix; ORDER BY attempt, id still uses a cheap in-memory sort of the
 * (already attempt-ordered) index slice.
 *
 * artifacts_json is deserialized here so route handlers never JSON.parse
 * artifact arrays directly.
 */
export function readCheckpoints(
  db: Database.Database,
  taskId: number,
  filter?: { attempt?: number },
): CheckpointRow[] {
  const params: number[] = [taskId]
  let where = 'task_id = ?'
  if (filter?.attempt !== undefined) {
    where += ' AND attempt = ?'
    params.push(filter.attempt)
  }
  const rows = db
    .prepare(
      `
      SELECT id, task_id, attempt, step, summary, status, artifacts_json,
             next_step, blocker_reason, tokens_used, duration_ms, created_at
      FROM task_checkpoints
      WHERE ${where}
      ORDER BY attempt ASC, id ASC
    `,
    )
    .all(...params) as Array<
    Omit<CheckpointRow, 'artifacts'> & { artifacts_json: string }
  >

  return rows.map((r) => ({
    id: r.id,
    task_id: r.task_id,
    attempt: r.attempt,
    step: r.step,
    summary: r.summary,
    status: r.status as CheckpointRow['status'],
    artifacts: JSON.parse(r.artifacts_json) as Artifact[],
    next_step: r.next_step,
    blocker_reason: r.blocker_reason,
    tokens_used: r.tokens_used,
    duration_ms: r.duration_ms,
    created_at: r.created_at,
  }))
}
