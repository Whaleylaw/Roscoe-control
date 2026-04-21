'use client'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { modelToTier, modelTierClassName } from '@/lib/model-tier-colors'

type TaskLike = { recipe_slug?: string | null }

/**
 * Phase 16 RUI-01 — renders a compact chip on task cards (and the TaskDetailModal
 * header) when task.recipe_slug is set. The recipe name comes from the Zustand
 * `recipes` cache (seeded on boot + refreshed on mc:recipe-indexed/removed DOM
 * events). The chip background color is derived from the recipe's primary model
 * via the shared `modelToTier` + `modelTierClassName` helpers (Plan 16-01), so
 * this chip stays in lock-step with the Recipes panel tier chip and the agent
 * builder tier swatch — one palette, one source of truth.
 *
 * Null-render guard: returns null when recipe_slug is nullish. Non-recipe
 * tasks look identical to pre-Phase-16 (no layout shift in the parent flex row).
 *
 * First-paint behavior: if the recipes cache has not yet populated when this
 * chip first renders, the label falls back to the raw slug (and the tier color
 * falls back to the neutral muted class). Once Zustand populates via
 * `refreshRecipes()`, React re-renders and the friendly name + correct tier
 * color take over automatically. See `.planning/phases/16-runtime-ui-surfaces/16-RESEARCH.md`
 * Pitfall 10 for the flicker-tradeoff discussion.
 *
 * Test locator: the root span carries data-testid="recipe-badge" (Phase 18-02 /
 * audit-td-2) so Playwright can target it without coupling to recipe name text.
 */
export function RecipeBadge({ task }: { task: TaskLike }) {
  const t = useTranslations('taskBoard.recipeBadge')
  const recipes = useMissionControl((s) => s.recipes)
  if (!task.recipe_slug) return null
  const recipe = recipes.find((r) => r.slug === task.recipe_slug)
  const tier = modelToTier(recipe?.model?.primary)
  const classes = modelTierClassName(tier)
  const label = recipe?.name ?? task.recipe_slug
  return (
    <span
      data-testid="recipe-badge"
      className={`text-[10px] px-1.5 py-0.5 rounded border font-mono truncate max-w-[10rem] ${classes}`}
      title={label}
      aria-label={t('ariaLabel', { slug: task.recipe_slug })}
    >
      {label}
    </span>
  )
}
