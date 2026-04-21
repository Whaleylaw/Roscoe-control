/**
 * Phase 16 Plan 16-02 — RUI-01 unit tests.
 *
 * RecipeBadge renders a small monospace pill on task cards when task.recipe_slug
 * is set. Color comes from the recipe's `model.primary` via the shared
 * MODEL_TIER_COLORS / modelTierClassName helpers (Plan 16-01). Returns null when
 * recipe_slug is nullish (visual parity with pre-Phase-16 cards). When the slug
 * is set but the recipe is not yet in the Zustand cache, the badge falls back to
 * the raw slug as label + tooltip — first-paint flicker tradeoff (see
 * `.planning/phases/16-runtime-ui-surfaces/16-RESEARCH.md` Pitfall 10).
 *
 * Coverage matrix (10 cases):
 *   1. recipe_slug=null     → renders nothing
 *   2. recipe_slug=undefined → renders nothing
 *   3. recipe in cache       → renders friendly name
 *   4. recipe NOT in cache   → falls back to slug literal
 *   5. model.primary='…opus…'   → opus tier classes
 *   6. model.primary='…sonnet…' → sonnet tier classes
 *   7. model.primary='…haiku…'  → haiku tier classes
 *   8. model.primary missing    → unknown (muted) classes
 *   9. title attr carries the full recipe name (tooltip for truncated labels)
 *  10. aria-label contains the slug
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '../../../../../messages/en.json'
import type { IndexedRecipe } from '@/store'

// Mock the Zustand store. Tests set `recipesMock` before render to control the
// `recipes` array returned by the selector. Mirrors the vi.mock pattern in
// src/lib/__tests__/use-server-events.test.ts.
let recipesMock: IndexedRecipe[] = []
vi.mock('@/store', () => ({
  useMissionControl: <T,>(selector?: (state: { recipes: IndexedRecipe[] }) => T) => {
    const state = { recipes: recipesMock }
    return selector ? selector(state) : state
  },
}))

import { RecipeBadge } from '../recipe-badge'

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider messages={messages as never} locale="en">
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('RecipeBadge (RUI-01)', () => {
  beforeEach(() => {
    recipesMock = []
  })

  it('renders nothing when task.recipe_slug is null', () => {
    const { container } = renderWithIntl(<RecipeBadge task={{ recipe_slug: null }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when task.recipe_slug is undefined', () => {
    const { container } = renderWithIntl(<RecipeBadge task={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders recipe name from cache when the slug matches a Zustand entry', () => {
    recipesMock = [
      { slug: 'hello-world', name: 'Hello World', model: { primary: 'claude-haiku-4-5' } },
    ]
    renderWithIntl(<RecipeBadge task={{ recipe_slug: 'hello-world' }} />)
    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  it('falls back to the slug literal when the recipe is not yet in cache', () => {
    recipesMock = []
    renderWithIntl(<RecipeBadge task={{ recipe_slug: 'not-yet-indexed' }} />)
    expect(screen.getByText('not-yet-indexed')).toBeInTheDocument()
  })

  it('applies the opus tier classes when recipe.model.primary contains "opus"', () => {
    recipesMock = [
      { slug: 'deep-think', name: 'Deep Think', model: { primary: 'claude-opus-4-7-20251001' } },
    ]
    renderWithIntl(<RecipeBadge task={{ recipe_slug: 'deep-think' }} />)
    const el = screen.getByText('Deep Think')
    expect(el).toHaveClass('bg-purple-500/20', 'text-purple-400', 'border-purple-500/30')
  })

  it('applies the sonnet tier classes when recipe.model.primary contains "sonnet"', () => {
    recipesMock = [
      { slug: 'mid-tier', name: 'Mid Tier', model: { primary: 'anthropic/claude-sonnet-4-6' } },
    ]
    renderWithIntl(<RecipeBadge task={{ recipe_slug: 'mid-tier' }} />)
    const el = screen.getByText('Mid Tier')
    expect(el).toHaveClass('bg-blue-500/20', 'text-blue-400', 'border-blue-500/30')
  })

  it('applies the haiku tier classes when recipe.model.primary contains "haiku"', () => {
    recipesMock = [
      { slug: 'quick-task', name: 'Quick Task', model: { primary: 'claude-haiku-4-5-20251001' } },
    ]
    renderWithIntl(<RecipeBadge task={{ recipe_slug: 'quick-task' }} />)
    const el = screen.getByText('Quick Task')
    expect(el).toHaveClass('bg-green-500/20', 'text-green-400', 'border-green-500/30')
  })

  it('applies the muted/unknown tier classes when recipe.model is missing', () => {
    recipesMock = [{ slug: 'no-model', name: 'No Model' }]
    renderWithIntl(<RecipeBadge task={{ recipe_slug: 'no-model' }} />)
    const el = screen.getByText('No Model')
    // modelTierClassName('unknown') → 'bg-muted/20 text-muted-foreground border-muted/30'
    expect(el).toHaveClass('bg-muted/20', 'text-muted-foreground', 'border-muted/30')
  })

  it('title attribute carries the full (non-truncated) recipe name', () => {
    recipesMock = [
      {
        slug: 'long-recipe',
        name: 'A Very Long Recipe Name That Should Truncate Visually But Not In Title',
        model: { primary: 'claude-opus-4-7' },
      },
    ]
    renderWithIntl(<RecipeBadge task={{ recipe_slug: 'long-recipe' }} />)
    const el = screen.getByText(/A Very Long Recipe Name/)
    expect(el).toHaveAttribute(
      'title',
      'A Very Long Recipe Name That Should Truncate Visually But Not In Title',
    )
    // Visual truncation is driven by `truncate max-w-[10rem]` utility classes.
    expect(el).toHaveClass('truncate', 'max-w-[10rem]')
  })

  it('aria-label contains the recipe slug (i18n-interpolated)', () => {
    recipesMock = [
      { slug: 'hello-world', name: 'Hello World', model: { primary: 'claude-haiku-4-5' } },
    ]
    renderWithIntl(<RecipeBadge task={{ recipe_slug: 'hello-world' }} />)
    const el = screen.getByLabelText(/hello-world/)
    expect(el).toBeInTheDocument()
    // The ariaLabel template is `Recipe: {slug}` in en.json.
    expect(el).toHaveAttribute('aria-label', 'Recipe: hello-world')
  })
})
