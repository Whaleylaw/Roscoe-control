import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ─── Module mocks ────────────────────────────────────────────────────

// Stable translator so `useCallback([t])` identities do not churn across renders.
// Declared inside the mock factory (hoisted) to keep identity stable across every
// useTranslations() call in every render of the component under test.
vi.mock('next-intl', () => {
  const translator = (key: string, values?: Record<string, unknown>) => {
    if (values && Object.keys(values).length > 0) {
      const serialized = Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')
      return `${key}:${serialized}`
    }
    return key
  }
  return { useTranslations: () => translator }
})

vi.mock('@/components/markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}))

import { RecipesPanel } from '../recipes-panel'

// ─── Fixtures ────────────────────────────────────────────────────────

const recipeAlpha = {
  slug: 'alpha',
  name: 'Alpha Recipe',
  description: 'Alpha recipe description',
  model: { primary: 'claude-opus-4-7-20251001' },
  tags: ['docs', 'planning'],
  timeout_seconds: 300,
  max_concurrent: 2,
  soul_md: '# Alpha SOUL\n\nAgent does alpha things.',
}

const recipeBeta = {
  slug: 'beta',
  name: 'Beta Recipe',
  description: 'Beta recipe description',
  model: { primary: 'claude-sonnet-4-5-20250514' },
  tags: ['code'],
  soul_md: '# Beta SOUL',
}

// ─── Fetch stub helpers ─────────────────────────────────────────────

type FetchCall = { url: string; init?: RequestInit }

function installFetchStub(
  scenarios: Array<(call: FetchCall) => Response | Promise<Response>>,
): { calls: FetchCall[]; scenarios: typeof scenarios } {
  const calls: FetchCall[] = []
  let index = 0
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString()
    const call: FetchCall = { url: href, init }
    calls.push(call)
    const handler = scenarios[Math.min(index, scenarios.length - 1)]
    index += 1
    return handler(call)
  }
  vi.stubGlobal('fetch', impl as unknown as typeof fetch)
  return { calls, scenarios }
}

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─── Lifecycle ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ─── Tests ───────────────────────────────────────────────────────────

describe('RecipesPanel', () => {
  it('fetches /api/recipes on mount and renders one row per recipe with name, slug, model chip, description, and tags', async () => {
    const { calls } = installFetchStub([
      () => jsonResponse({ recipes: [recipeAlpha, recipeBeta] }),
    ])

    render(<RecipesPanel />)

    await waitFor(() => {
      expect(screen.getByText('Alpha Recipe')).toBeTruthy()
      expect(screen.getByText('Beta Recipe')).toBeTruthy()
    })

    expect(calls[0]?.url).toBe('/api/recipes')
    // Slugs rendered as mono chips
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
    // Descriptions
    expect(screen.getByText('Alpha recipe description')).toBeTruthy()
    expect(screen.getByText('Beta recipe description')).toBeTruthy()
    // Model chips rendered with primary model string
    expect(screen.getByText('claude-opus-4-7-20251001')).toBeTruthy()
    expect(screen.getByText('claude-sonnet-4-5-20250514')).toBeTruthy()
    // Tag chips
    expect(screen.getByText('docs')).toBeTruthy()
    expect(screen.getByText('planning')).toBeTruthy()
    expect(screen.getByText('code')).toBeTruthy()
  })

  it('renders the empty-state heading + body when /api/recipes returns an empty array', async () => {
    installFetchStub([() => jsonResponse({ recipes: [] })])

    render(<RecipesPanel />)

    await waitFor(() => {
      expect(screen.getByText('emptyHeading')).toBeTruthy()
    })
    expect(screen.getByText('emptyBody')).toBeTruthy()
  })

  it('renders loadError text when /api/recipes returns 500', async () => {
    installFetchStub([() => jsonResponse({ error: 'boom' }, { status: 500 })])

    render(<RecipesPanel />)

    await waitFor(() => {
      expect(screen.getByText('loadError')).toBeTruthy()
    })
  })

  it('Resync button POSTs to /api/recipes/resync, renders success feedback with counts, and re-fetches recipes', async () => {
    const { calls } = installFetchStub([
      // Initial GET
      () => jsonResponse({ recipes: [recipeAlpha] }),
      // POST /api/recipes/resync
      () => jsonResponse({ scanned: 3, inserted: 1, updated: 2, deleted: 0, errors: [] }),
      // Re-fetch GET after resync
      () => jsonResponse({ recipes: [recipeAlpha, recipeBeta] }),
    ])

    render(<RecipesPanel />)
    await waitFor(() => expect(screen.getByText('Alpha Recipe')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^resync$/i }))

    await waitFor(() => {
      // Feedback banner with counts interpolated via mocked translator
      expect(
        screen.getByText(/resyncSuccess:inserted=1,updated=2,deleted=0/),
      ).toBeTruthy()
    })

    // Second call must be the POST, third the refresh
    expect(calls[1]?.url).toBe('/api/recipes/resync')
    expect(calls[1]?.init?.method).toBe('POST')
    expect(calls[2]?.url).toBe('/api/recipes')

    await waitFor(() => expect(screen.getByText('Beta Recipe')).toBeTruthy())

    const banner = screen.getByRole('status')
    expect(banner.className).toContain('text-green-400')
  })

  it('Resync failure renders red feedback banner with server error message', async () => {
    installFetchStub([
      () => jsonResponse({ recipes: [recipeAlpha] }),
      () => jsonResponse({ error: 'resync exploded' }, { status: 500 }),
    ])

    render(<RecipesPanel />)
    await waitFor(() => expect(screen.getByText('Alpha Recipe')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^resync$/i }))

    await waitFor(() => {
      expect(screen.getByText('resync exploded')).toBeTruthy()
    })
    const banner = screen.getByRole('status')
    expect(banner.className).toContain('text-red-400')
  })

  it('feedback banner auto-clears after 6000ms', async () => {
    // Fake timers from mount so the setTimeout scheduled in showFeedback() is
    // fake-scheduled. `shouldAdvanceTime: true` lets real-time microtasks
    // (fetch promise resolution) still progress so waitFor() does not deadlock.
    vi.useFakeTimers({ shouldAdvanceTime: true })

    installFetchStub([
      () => jsonResponse({ recipes: [recipeAlpha] }),
      () => jsonResponse({ scanned: 1, inserted: 1, updated: 0, deleted: 0, errors: [] }),
      () => jsonResponse({ recipes: [recipeAlpha] }),
    ])

    render(<RecipesPanel />)
    await waitFor(() => expect(screen.getByText('Alpha Recipe')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^resync$/i }))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeNull())

    // Advance just past the 6000ms auto-clear window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6100)
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('dispatching mc:recipe-indexed re-fetches /api/recipes', async () => {
    const { calls } = installFetchStub([
      () => jsonResponse({ recipes: [recipeAlpha] }),
      () => jsonResponse({ recipes: [recipeAlpha, recipeBeta] }),
    ])

    render(<RecipesPanel />)
    await waitFor(() => expect(screen.getByText('Alpha Recipe')).toBeTruthy())
    expect(calls).toHaveLength(1)

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mc:recipe-indexed', { detail: { slug: 'beta' } }))
    })

    await waitFor(() => expect(calls).toHaveLength(2))
    await waitFor(() => expect(screen.getByText('Beta Recipe')).toBeTruthy())
  })

  it('dispatching mc:recipe-removed re-fetches /api/recipes', async () => {
    const { calls } = installFetchStub([
      () => jsonResponse({ recipes: [recipeAlpha, recipeBeta] }),
      () => jsonResponse({ recipes: [recipeAlpha] }),
    ])

    render(<RecipesPanel />)
    await waitFor(() => expect(screen.getByText('Beta Recipe')).toBeTruthy())
    expect(calls).toHaveLength(1)

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mc:recipe-removed', { detail: { slug: 'beta' } }))
    })

    await waitFor(() => expect(calls).toHaveLength(2))
    await waitFor(() => expect(screen.queryByText('Beta Recipe')).toBeNull())
  })

  it('View toggle flips aria-expanded and renders soul_md via MarkdownRenderer', async () => {
    installFetchStub([() => jsonResponse({ recipes: [recipeAlpha] })])

    render(<RecipesPanel />)
    await waitFor(() => expect(screen.getByText('Alpha Recipe')).toBeTruthy())

    // Initial label is `viewRecipe`, aria-expanded=false, no markdown body rendered.
    const viewButton = screen.getByRole('button', { name: /viewRecipe/ })
    expect(viewButton.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('markdown-renderer')).toBeNull()

    fireEvent.click(viewButton)

    const hideButton = screen.getByRole('button', { name: /hideRecipe/ })
    expect(hideButton.getAttribute('aria-expanded')).toBe('true')
    const markdown = screen.getByTestId('markdown-renderer')
    expect(markdown.textContent).toBe(recipeAlpha.soul_md)

    // Toggling again collapses the inline panel.
    fireEvent.click(hideButton)
    expect(screen.queryByTestId('markdown-renderer')).toBeNull()
  })

  it('removes event listeners on unmount so late events do not trigger stale fetches', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    installFetchStub([() => jsonResponse({ recipes: [] })])

    const { unmount } = render(<RecipesPanel />)
    await waitFor(() => expect(screen.getByText('emptyHeading')).toBeTruthy())

    unmount()

    const removed = removeSpy.mock.calls.map((c) => c[0])
    expect(removed).toContain('mc:recipe-indexed')
    expect(removed).toContain('mc:recipe-removed')
  })
})
