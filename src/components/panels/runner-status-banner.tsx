'use client'

/**
 * RunnerStatusBanner — Phase 16 / RUI-02.
 *
 * Sticky ambient status bar that lives inside `task-board-panel.tsx` between
 * the panel header and the Kanban columns. Flips between three states:
 *
 *   - "🟢 Runner online"                          (fresh heartbeat < 90s)
 *   - "🔴 Runner offline — tasks waiting: N"      (no fresh heartbeat)
 *   - "Runner status unavailable"                 (fetch 500 / network error)
 *
 * Driven by `GET /api/runtime/runner-status` (Plan 16-01, viewer auth). Polls
 * every 10s (POLL_INTERVAL_MS) and also subscribes to three DOM CustomEvents
 * relayed by the SSE dispatcher (Plan 16-01 `use-server-events.ts`) for a
 * debounced re-fetch — gives sub-second latency on real transitions without
 * needing a dedicated heartbeat SSE channel.
 *
 * Visual precedent: `src/components/layout/local-mode-banner.tsx` — same
 * sticky container classes, same colored dot + emoji-led copy, same
 * `role="status" aria-live="polite"` accessibility treatment so transitions
 * announce to screen readers without stealing focus.
 *
 * Scope: rendered ONLY inside the task-board panel. Do NOT mount from
 * layout/header — ambient UI stays scoped to where it's relevant.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

type Status = { online: boolean; last_heartbeat_at: number | null; tasks_waiting: number }
type State =
  | { kind: 'loading' }
  | { kind: 'ok'; status: Status }
  | { kind: 'error' }

const POLL_INTERVAL_MS = 10_000 // matches heartbeat cadence
const REFRESH_DEBOUNCE_MS = 1_000 // coalesce bursts of SSE events

export function RunnerStatusBanner() {
  const t = useTranslations('taskBoard.runnerBanner')
  const [state, setState] = useState<State>({ kind: 'loading' })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/runtime/runner-status', { cache: 'no-store' })
      if (!res.ok) {
        setState({ kind: 'error' })
        return
      }
      const data = (await res.json()) as Status
      setState({ kind: 'ok', status: data })
    } catch {
      setState({ kind: 'error' })
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void fetchStatus()
    }, REFRESH_DEBOUNCE_MS)
  }, [fetchStatus])

  // Initial fetch + polling.
  useEffect(() => {
    void fetchStatus()
    const id = setInterval(() => {
      void fetchStatus()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchStatus])

  // Debounced refresh on runtime SSE events (relayed as DOM CustomEvents by
  // use-server-events.ts per Plan 16-01). Any of these three strongly suggests
  // the runner status has changed — container lifecycle + new runner-requested
  // emissions are the fastest external signals we have.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => scheduleRefresh()
    window.addEventListener('mc:task-container-started', handler)
    window.addEventListener('mc:task-container-exited', handler)
    window.addEventListener('mc:task-runner-requested', handler)
    return () => {
      window.removeEventListener('mc:task-container-started', handler)
      window.removeEventListener('mc:task-container-exited', handler)
      window.removeEventListener('mc:task-runner-requested', handler)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefresh])

  if (state.kind === 'loading') {
    // Silent first paint. Next fetch (or the initial resolved promise) flips
    // us to one of the three real branches — rendering "loading" would cause
    // a visible flicker on every mount.
    return null
  }

  if (state.kind === 'error') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mx-4 mt-3 mb-0 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-muted/5 border border-muted/20 text-sm"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0" />
        <p className="flex-1 text-xs text-muted-foreground">{t('statusUnavailable')}</p>
      </div>
    )
  }

  const { online, tasks_waiting } = state.status
  const dotClass = online ? 'bg-green-500' : 'bg-red-500'
  const tone = online
    ? 'bg-green-500/5 border border-green-500/15'
    : 'bg-red-500/5 border border-red-500/15'
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mx-4 mt-3 mb-0 flex items-center gap-3 px-4 py-2.5 rounded-lg ${tone} text-sm`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
      <p className="flex-1 text-xs text-muted-foreground">
        {online ? t('online') : t('offlineCount', { count: tasks_waiting })}
      </p>
    </div>
  )
}
