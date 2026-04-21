'use client'

/**
 * RecipeCombobox — Phase 16 Plan 05 (RUI-04).
 *
 * Debounced autocomplete combobox that backs /api/recipes/search for suggestions
 * and falls back to the shared Zustand `recipes` slice (owned by Plan 16-02) for
 * the selected-slug-to-friendly-name lookup.
 *
 * Integration contract (LOCKED):
 *   - READ-ONLY consumer of useMissionControl(s => s.recipes). Does NOT fetch
 *     /api/recipes, does NOT call refreshRecipes(), does NOT listen for
 *     mc:recipe-* CustomEvents. That boot + refresh lifecycle is owned by Plan
 *     16-02 inside useServerEvents.
 *   - Only /api/recipes/search autocomplete fetches originate here.
 *   - When the recipes slice is empty (pre-hydration), the input displays the
 *     raw slug literal. Once 16-02's boot refresh populates the store, the next
 *     render picks up the friendly name.
 *
 * Keyboard: ↑/↓ cycle modular, Enter selects active option, Escape closes,
 * Tab closes without selection. Mirrors MentionTextarea pattern.
 *
 * Accessibility: role="combobox" + aria-expanded + aria-autocomplete on the
 * input, role="listbox" on the dropdown, role="option" + aria-selected on rows,
 * aria-activedescendant wires the active option to the input.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { modelToTier, modelTierClassName } from '@/lib/model-tier-colors'

export type RecipeSearchResult = {
  slug: string
  name: string
  description?: string | null
  model?: { primary?: string | null; fallback?: string | null; provider?: string | null } | null
  tags?: string[] | null
}

export type RecipeComboboxProps = {
  /** Currently selected recipe slug, or null when no recipe is selected. */
  value: string | null
  /** Called with the new slug on selection, or null when cleared. */
  onChange: (slug: string | null) => void
  /** When true, the input becomes readonly, clear is hidden, and lockedHint renders. */
  disabled?: boolean
  /** Localized hint shown beneath the input when disabled (RECIPE_LOCKED gate). */
  lockedHint?: string
  /** Optional override for the field label; falls back to t('label'). */
  label?: string
}

const DEBOUNCE_MS = 300

export function RecipeCombobox({
  value,
  onChange,
  disabled = false,
  lockedHint,
  label,
}: RecipeComboboxProps) {
  const t = useTranslations('taskBoard.recipeField')
  const reactId = useId()
  const listId = `recipe-combobox-list-${reactId}`
  const inputId = `recipe-combobox-input-${reactId}`

  // Pre-hydration fallback: if Plan 16-02 hasn't yet added the `recipes` slice to
  // the Zustand store, the selector returns undefined; coerce to an empty array so
  // downstream code can treat it uniformly without branching.
  const recipesFromStore = useMissionControl(
    (s: unknown) => (s as { recipes?: RecipeSearchResult[] }).recipes,
  )
  const recipes: RecipeSearchResult[] = Array.isArray(recipesFromStore) ? recipesFromStore : []

  const inputRef = useRef<HTMLInputElement | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [results, setResults] = useState<RecipeSearchResult[]>([])
  const [fetching, setFetching] = useState(false)

  // Friendly name for the selected slug — derived, not stored.
  const selectedRow = value ? recipes.find((r) => r.slug === value) ?? null : null
  const selectedDisplay = value ? selectedRow?.name ?? value : ''

  // Debounced autocomplete fetch with AbortController (Pitfall 5 — rapid-typing race).
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setFetching(true)
      try {
        const url = `/api/recipes/search?q=${encodeURIComponent(q)}&limit=20`
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) {
          setResults([])
          return
        }
        const data = (await res.json()) as { recipes?: RecipeSearchResult[] }
        setResults(Array.isArray(data.recipes) ? data.recipes : [])
        setActiveIndex(0)
      } catch (err) {
        // AbortError on unmount / rapid-typing cancel is expected; swallow it.
        if ((err as Error).name !== 'AbortError') {
          setResults([])
        }
      } finally {
        // Guard against setting state after an abort — the controller's signal
        // tells us the effect's cleanup already ran.
        if (!controller.signal.aborted) {
          setFetching(false)
        }
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [q, open])

  const commit = (slug: string | null) => {
    onChange(slug)
    setOpen(false)
    setQ('')
    setResults([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setOpen(true)
        return
      }
      return
    }
    if (results.length === 0) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((prev) => (prev + 1) % results.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const selected = results[activeIndex]
      if (selected) commit(selected.slug)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  // When a slug is selected, the input shows the resolved name; user must clear to search again.
  const displayedValue = value ? selectedDisplay : q

  const resolvedLabel = label ?? t('label')
  const resolvedLockedHint = lockedHint ?? t('lockedHint')

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm text-muted-foreground mb-1">
        {resolvedLabel}
      </label>
      <div className="relative" role="combobox" aria-expanded={open} aria-controls={listId} aria-haspopup="listbox">
        <div className="flex items-stretch gap-2">
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={open && results[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined}
            value={displayedValue}
            placeholder={t('placeholder')}
            readOnly={disabled || value !== null}
            disabled={disabled}
            onFocus={() => {
              if (!disabled && value === null) setOpen(true)
            }}
            onChange={(e) => {
              if (disabled) return
              // Typing is only meaningful when no value is currently selected.
              if (value !== null) return
              setQ(e.target.value)
              setOpen(true)
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Close on blur using a small deferral so option mousedown can still fire first.
              setTimeout(() => setOpen(false), 120)
            }}
            className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
          />
          {value !== null && !disabled && (
            <button
              type="button"
              aria-label={t('clear')}
              onMouseDown={(e) => {
                // mousedown so the input's blur doesn't swallow the click
                e.preventDefault()
                commit(null)
                inputRef.current?.focus()
              }}
              className="px-2 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md"
            >
              ✖
            </button>
          )}
        </div>
        {open && !disabled && value === null && (
          <div
            id={listId}
            role="listbox"
            className="absolute z-[60] w-full mt-1 bg-surface-1 border border-border rounded-md shadow-xl max-h-64 overflow-y-auto"
          >
            {fetching && results.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">{t('searching')}</div>
            )}
            {!fetching && results.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">{t('noResults')}</div>
            )}
            {results.map((r, index) => {
              const tierClass = modelTierClassName(modelToTier(r.model?.primary))
              return (
                <button
                  key={r.slug}
                  id={`${listId}-opt-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    commit(r.slug)
                  }}
                  className={`w-full text-left px-3 py-2 text-xs border-b last:border-b-0 border-border/40 ${
                    index === activeIndex ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-surface-2'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tierClass}`}>
                      {r.model?.primary ?? 'unknown'}
                    </span>
                  </div>
                  {r.description && (
                    <div className="text-muted-foreground truncate mt-0.5">{r.description}</div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {disabled && resolvedLockedHint && (
        <p className="text-[11px] text-amber-500/80 mt-1">{resolvedLockedHint}</p>
      )}
    </div>
  )
}
