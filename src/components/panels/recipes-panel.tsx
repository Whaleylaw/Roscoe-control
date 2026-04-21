'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { modelToTier, modelTierClassName } from '@/lib/model-tier-colors'
import { MarkdownRenderer } from '@/components/markdown-renderer'

/**
 * Phase 16 RUI-06 — Recipes Panel.
 *
 * Read-only list of indexed recipes with a Resync button that calls
 * `POST /api/recipes/resync` and surfaces insert/update/delete counts via
 * an inline feedback banner (pattern copied from github-sync-panel.tsx).
 *
 * Auto-refreshes on `mc:recipe-indexed` / `mc:recipe-removed` DOM events
 * relayed by the Plan 16-01 SSE dispatcher, so filesystem edits under
 * `recipes/` land live without a reload.
 *
 * Authoring stays filesystem-first — no create/edit/delete UI ships here
 * (roadmap SC 5 LOCK). The per-row "View" button expands an inline panel
 * rendering the recipe's `soul_md` via the shared MarkdownRenderer; no
 * new routes and no new modal.
 */

type Recipe = {
  slug: string
  name: string
  description?: string
  model?: { primary?: string; fallback?: string; provider?: string }
  tags?: string[]
  timeout_seconds?: number
  max_concurrent?: number
  soul_md?: string
}

type ResyncReport = {
  scanned: number
  inserted: number
  updated: number
  deleted: number
  errors: Array<{ slug: string; reason: string }>
}

const FEEDBACK_AUTO_CLEAR_MS = 6000

export function RecipesPanel() {
  const t = useTranslations('recipesPanel')
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const fetchRecipes = useCallback(async () => {
    try {
      setLoadError(null)
      const res = await fetch('/api/recipes')
      if (!res.ok) throw new Error(`${res.status}`)
      const data = (await res.json()) as { recipes?: Recipe[] }
      setRecipes(Array.isArray(data?.recipes) ? data.recipes : [])
    } catch {
      setLoadError(t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  // Initial fetch on mount.
  useEffect(() => {
    void fetchRecipes()
  }, [fetchRecipes])

  // SSE-driven live refresh via Plan 16-01's DOM CustomEvent relay.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      void fetchRecipes()
    }
    window.addEventListener('mc:recipe-indexed', handler)
    window.addEventListener('mc:recipe-removed', handler)
    return () => {
      window.removeEventListener('mc:recipe-indexed', handler)
      window.removeEventListener('mc:recipe-removed', handler)
    }
  }, [fetchRecipes])

  const showFeedback = useCallback((ok: boolean, message: string) => {
    setFeedback({ ok, message })
    setTimeout(() => setFeedback(null), FEEDBACK_AUTO_CLEAR_MS)
  }, [])

  const handleResync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const res = await fetch('/api/recipes/resync', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errorMessage = typeof body?.error === 'string' ? body.error : t('resyncError')
        showFeedback(false, errorMessage)
        return
      }
      const report = body as ResyncReport
      showFeedback(
        true,
        t('resyncSuccess', {
          inserted: report.inserted ?? 0,
          updated: report.updated ?? 0,
          deleted: report.deleted ?? 0,
        }),
      )
      await fetchRecipes()
    } catch {
      showFeedback(false, t('resyncError'))
    } finally {
      setSyncing(false)
    }
  }, [syncing, showFeedback, t, fetchRecipes])

  const toggle = useCallback((slug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }, [])

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button variant="secondary" onClick={handleResync} disabled={syncing}>
          {syncing ? t('resyncing') : t('resync')}
        </Button>
      </header>

      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`px-4 py-2 rounded-md border text-sm ${
            feedback.ok
              ? 'bg-green-500/5 border-green-500/20 text-green-400'
              : 'bg-red-500/5 border-red-500/20 text-red-400'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {loading && recipes.length === 0 && (
        <p className="text-sm text-muted-foreground">…</p>
      )}
      {loadError && recipes.length === 0 && (
        <p className="text-sm text-red-400">{loadError}</p>
      )}

      {!loading && !loadError && recipes.length === 0 && (
        <div className="border border-dashed rounded-md p-8 text-center space-y-1">
          <p className="text-base font-medium">{t('emptyHeading')}</p>
          <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
        </div>
      )}

      {recipes.length > 0 && (
        <ul className="space-y-3" aria-label={t('title')}>
          {recipes.map((r) => {
            const tier = modelToTier(r.model?.primary)
            const tierClass = modelTierClassName(tier)
            const isOpen = expanded.has(r.slug)
            return (
              <li key={r.slug} className="border rounded-md">
                <div className="flex items-start gap-3 p-4">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{r.name}</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {r.slug}
                      </span>
                      {r.model?.primary && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${tierClass}`}
                        >
                          {r.model.primary}
                        </span>
                      )}
                    </div>
                    {r.description && (
                      <p className="text-sm text-muted-foreground">{r.description}</p>
                    )}
                    {r.tags && r.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground border"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggle(r.slug)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? t('hideRecipe') : t('viewRecipe')}
                  </Button>
                </div>
                {isOpen && r.soul_md && (
                  <div className="px-4 pb-4 border-t pt-3">
                    <MarkdownRenderer content={r.soul_md} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
