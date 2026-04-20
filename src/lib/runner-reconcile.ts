/**
 * Runner container reconciliation (Phase 14 Plan 08a).
 *
 * Pure-logic module — no docker CLI calls, no DB access. The runner daemon
 * calls `docker ps -a --filter label=mc.task_id` to collect live containers
 * and `GET /api/runner/pending-containers` to collect pending tasks, then
 * feeds both into `reconcileContainers` to partition them into three buckets:
 *
 *   - adopt    — live running container paired with a pending task (daemon
 *                attaches stdout/stderr streams and resumes timeout tracking)
 *   - kill     — live running container WITHOUT a pending task (daemon issues
 *                `docker kill` — task already terminal or unknown)
 *   - orphaned — pending task WITHOUT a live container (daemon posts
 *                `runner-exit` with reason='crash' per Plan 14-06)
 *
 * Exited containers are IGNORED entirely: `docker run --rm` removes them on
 * exit but `docker ps -a --filter` may surface a transient exited row during
 * reconciliation; treating those as kill targets would issue `docker kill`
 * against an already-removed container.
 *
 * See: .planning/phases/14-runner-container-v1-2/14-CONTEXT.md "Reconciliation discovery"
 */

export interface LiveContainer {
  container_id: string
  labels: Record<string, string>
  state: 'running' | 'exited'
}

export interface PendingTask {
  id: number
  /** Real container ID once Plan 14-11 container-started posts; may be the `pending:<claim-id>` placeholder until then. */
  container_id: string
  status: string
  runner_started_at: number | null
}

export interface ReconcileResult {
  adopt: Array<{ task: PendingTask; container: LiveContainer }>
  kill: LiveContainer[]
  orphaned: PendingTask[]
}

export function reconcileContainers(
  live: LiveContainer[],
  pending: PendingTask[],
): ReconcileResult {
  const adopt: ReconcileResult['adopt'] = []
  const kill: LiveContainer[] = []
  const orphaned: PendingTask[] = []

  // Only running containers are reconcilable. Exited containers are ignored:
  // docker --rm removes them on exit, but --filter may surface transient
  // exited rows. Treating them as kill targets would error against an
  // already-removed container.
  const runningLive = live.filter((c) => c.state === 'running')

  // Build a lookup map by container_id so each pending task can probe in O(1).
  const liveById = new Map<string, LiveContainer>()
  for (const c of runningLive) liveById.set(c.container_id, c)

  // Track which running containers have been adopted, so unmatched live
  // containers can be classified as kill targets below.
  const adoptedContainerIds = new Set<string>()

  for (const task of pending) {
    const match = liveById.get(task.container_id)
    if (match) {
      adopt.push({ task, container: match })
      adoptedContainerIds.add(match.container_id)
    } else {
      orphaned.push(task)
    }
  }

  for (const c of runningLive) {
    if (!adoptedContainerIds.has(c.container_id)) {
      kill.push(c)
    }
  }

  return { adopt, kill, orphaned }
}
