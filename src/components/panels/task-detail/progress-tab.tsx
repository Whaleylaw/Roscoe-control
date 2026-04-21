'use client'

/**
 * ProgressTab — live checkpoint timeline for the task detail modal (RUI-03).
 *
 * Orchestrator:
 * 1. Subscribes to `mc:checkpoint-added` DOM CustomEvent FIRST (Pitfall 6 —
 *    subscribe-before-fetch so events fired during the initial GET are queued).
 * 2. Fetches GET /api/tasks/:id/checkpoints on mount.
 * 3. De-dupes fetched + SSE-delivered rows by `checkpoint.id` using a Map.
 * 4. Groups by `attempt` descending (newest attempt first).
 * 5. Within each attempt, sorts by `id DESC` so live arrivals land at the top.
 * 6. Latest attempt expanded by default; older attempts collapsed with count.
 * 7. Smooth-scrolls to the top on new arrivals UNLESS the user has scrolled
 *    away (Open Question 4 LOCKED: anchored-unless-user-scrolled).
 *
 * The `mc:checkpoint-added` event is relayed from the SSE dispatcher by
 * Plan 16-01's `use-server-events.ts`. We filter by event.detail.task_id so
 * a modal for task 42 never paints events from task 99.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckpointRow, type Checkpoint } from './checkpoint-row'

export function ProgressTab({ taskId }: { taskId: number }) {
  const t = useTranslations('taskBoard.progressTab')
  const [checkpoints, setCheckpoints] = useState<Map<number, Checkpoint>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const collapsedInitialisedRef = useRef(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const userScrolledUpRef = useRef(false)

  // ── SUBSCRIBE FIRST (Pitfall 6) ──
  // Events that fire between mount and fetch-complete are merged into the
  // state Map by id; the subsequent fetch cannot clobber them because the
  // merge is additive.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Checkpoint & { task_id: number }>).detail
      if (!detail || detail.task_id !== taskId) return
      setCheckpoints((prev) => {
        const next = new Map(prev)
        next.set(detail.id, detail)
        return next
      })
    }
    window.addEventListener('mc:checkpoint-added', handler)
    return () => window.removeEventListener('mc:checkpoint-added', handler)
  }, [taskId])

  // ── THEN FETCH ──
  // Events that arrived during the fetch are already in state; merging is
  // set-union by id, so order of arrival is irrelevant.
  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      const res = await fetch(`/api/tasks/${taskId}/checkpoints`)
      if (!res.ok) throw new Error(`${res.status}`)
      const data = (await res.json()) as { checkpoints: Checkpoint[] }
      setCheckpoints((prev) => {
        const next = new Map(prev)
        for (const c of data.checkpoints) next.set(c.id, c)
        return next
      })
    } catch {
      setLoadError(t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [taskId, t])

  useEffect(() => {
    void load()
  }, [load])

  // ── Scroll anchoring ──
  // Newest-first means the "latest" row is at scrollTop === 0. If the user
  // scrolls down more than 16px, we disable auto-scroll until they scroll
  // back to the top.
  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    userScrolledUpRef.current = el.scrollTop > 16
  }, [])

  useEffect(() => {
    if (userScrolledUpRef.current) return
    const el = listRef.current
    if (!el) return
    // jsdom does not implement Element.scrollTo — guard so tests and headless
    // environments don't throw on first paint.
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      el.scrollTop = 0
    }
  }, [checkpoints.size])

  // ── Group + sort ──
  const grouped = useMemo(() => {
    const byAttempt = new Map<number, Checkpoint[]>()
    for (const c of checkpoints.values()) {
      const list = byAttempt.get(c.attempt) ?? []
      list.push(c)
      byAttempt.set(c.attempt, list)
    }
    const attempts = [...byAttempt.keys()].sort((a, b) => b - a) // newest attempt first
    return attempts.map((attempt) => ({
      attempt,
      rows: (byAttempt.get(attempt) ?? []).sort((a, b) => b.id - a.id), // newest-first within
    }))
  }, [checkpoints])

  // ── Collapse older attempts by default (once, on first grouping) ──
  // `collapsedInitialisedRef` makes this idempotent: toggling after the
  // initial seed does not get overwritten when new checkpoints arrive.
  const latestAttempt = grouped[0]?.attempt ?? null
  useEffect(() => {
    if (latestAttempt == null) return
    if (collapsedInitialisedRef.current) return
    const next = new Set<number>()
    for (const g of grouped) if (g.attempt !== latestAttempt) next.add(g.attempt)
    setCollapsed(next)
    collapsedInitialisedRef.current = true
  }, [latestAttempt, grouped])

  // ── Empty / loading / error states ──
  if (loading && checkpoints.size === 0) {
    return <div className="text-sm text-muted-foreground">{t('empty')}</div>
  }
  if (loadError && checkpoints.size === 0) {
    return <div className="text-sm text-red-400">{loadError}</div>
  }
  if (checkpoints.size === 0) {
    return <div className="text-sm text-muted-foreground">{t('empty')}</div>
  }

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      role="tabpanel"
      className="space-y-6 overflow-y-auto max-h-[60vh]"
      data-testid="progress-tab"
    >
      {grouped.map(({ attempt, rows }) => {
        const isCollapsed = collapsed.has(attempt)
        return (
          <section key={attempt} className="space-y-3" data-testid={`attempt-${attempt}`}>
            <button
              type="button"
              onClick={() => {
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (next.has(attempt)) next.delete(attempt)
                  else next.add(attempt)
                  return next
                })
              }}
              className="w-full text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground flex items-center gap-2"
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? t('expandAttempt') : t('collapseAttempt')}
            >
              <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
              <span>{t('attemptLabel', { n: attempt })}</span>
              <span className="text-muted-foreground/70">
                ({t('attemptCheckpointCount', { count: rows.length })})
              </span>
            </button>
            {!isCollapsed && (
              <div className="space-y-2" data-testid={`attempt-${attempt}-rows`}>
                {rows.map((c) => (
                  <CheckpointRow key={c.id} checkpoint={c} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
