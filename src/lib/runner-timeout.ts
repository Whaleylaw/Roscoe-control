/**
 * Runner timeout arithmetic (Phase 14 Plan 08a).
 *
 * Pure-logic helper used by the daemon to compute how much time remains
 * before a container must be hard-killed (CONTAINER-03).
 *
 * Resync-safe: after reconciliation (runner crash + relaunch), the daemon
 * re-computes remaining time from the container's
 * `mc.runner_started_at` label rather than re-starting a local timer — that
 * way a crashed-and-restarted runner enforces the ORIGINAL deadline, not
 * deadline-from-now (Pitfall 9, 14-CONTEXT.md).
 *
 * Defensive clamping rules:
 *   - Any non-finite input (NaN / Infinity) → 0 ms remaining (kill now)
 *   - Elapsed time > timeout                → 0 ms remaining (kill now)
 *   - startedAtUnix in the future           → timeoutSeconds * 1000 ms
 *                                             (should never happen; defensive)
 *
 * See: .planning/phases/14-runner-container-v1-2/14-CONTEXT.md Pitfall 9
 */

const SECONDS_TO_MS = 1000

export function computeRemainingTimeoutMs(
  runnerStartedAtUnix: number,
  timeoutSeconds: number,
  nowUnix: number,
): number {
  // Defensive: any non-finite input → no remaining time (kill immediately).
  if (
    !Number.isFinite(runnerStartedAtUnix) ||
    !Number.isFinite(timeoutSeconds) ||
    !Number.isFinite(nowUnix)
  ) {
    return 0
  }

  // Timeout zero → no runway, kill immediately.
  if (timeoutSeconds <= 0) return 0

  const elapsed = nowUnix - runnerStartedAtUnix

  // If startedAt is in the future (should not happen, but defensive against
  // clock skew or a bad label parse), clamp elapsed to zero so the full
  // timeout window is returned rather than returning a negative value.
  if (elapsed < 0) {
    return timeoutSeconds * SECONDS_TO_MS
  }

  const remainingSeconds = timeoutSeconds - elapsed
  if (remainingSeconds <= 0) return 0

  return remainingSeconds * SECONDS_TO_MS
}
