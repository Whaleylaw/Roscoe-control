/**
 * Tests for RecipeCombobox — Phase 16 Plan 05 (RUI-04).
 *
 * Covers:
 *  1. Mounts with no selection → placeholder.
 *  2. Debounced /api/recipes/search (300ms).
 *  3. Rapid-type aborts the earlier request.
 *  4. ↑/↓ cycles activeIndex modular.
 *  5. Enter on active option → onChange(slug) + closes.
 *  6. Escape closes without onChange.
 *  7. Clear button resets to null.
 *  8. Disabled → readonly input, no clear, lockedHint visible.
 *  9. Results show model-tier chip class matching modelToTier.
 * 10. Selected value + hydrated recipes slice → displays friendly name.
 * 11. Selected value + empty recipes slice → displays slug literal (hydration fallback).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { modelToTier, modelTierClassName } from '@/lib/model-tier-colors'

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}))

// Mutable "recipes" slice: tests set it before render.
let storeRecipes: Array<{ slug: string; name: string }> = []
vi.mock('@/store', () => ({
  useMissionControl: (selector: (s: { recipes?: Array<{ slug: string; name: string }> }) => unknown) =>
    selector({ recipes: storeRecipes }),
}))

import { RecipeCombobox } from '../recipe-combobox'

type SearchResult = {
  slug: string
  name: string
  description?: string
  model?: { primary?: string }
}

function mockFetchOnce(results: SearchResult[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
    // Honour abort signal — simulate fetch rejecting with AbortError if aborted.
    const signal = init?.signal
    if (signal?.aborted) {
      throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
    }
    return {
      ok: true,
      json: async () => ({ recipes: results }),
    } as Response
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

beforeEach(() => {
  storeRecipes = []
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RecipeCombobox', () => {
  it('renders without selection and shows the placeholder', () => {
    render(<RecipeCombobox value={null} onChange={vi.fn()} />)
    const input = screen.getByRole('searchbox') as HTMLInputElement
    expect(input.placeholder).toBe('taskBoard.recipeField.placeholder')
    expect(input.value).toBe('')
  })

  it('fetches /api/recipes/search 300ms after the user types', async () => {
    const fetchMock = mockFetchOnce([{ slug: 'hello-world', name: 'Hello World' }])
    render(<RecipeCombobox value={null} onChange={vi.fn()} />)

    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'hel' } })

    // Before 300ms elapse, no fetch has been issued.
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = (fetchMock.mock.calls[0]?.[0] ?? '') as string
    expect(url).toContain('/api/recipes/search')
    expect(url).toContain('q=hel')
  })

  it('rapid typing aborts the earlier request and issues the latest query', async () => {
    let abortedFirst = false
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const signal = init?.signal
      return await new Promise<Response>((resolve, reject) => {
        const onAbort = () => {
          if (input.includes('q=hel&')) abortedFirst = true
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        // Resolve later so the abort has a chance to fire first.
        setTimeout(() => {
          if (signal?.aborted) return
          resolve({
            ok: true,
            json: async () => ({ recipes: [{ slug: input, name: input }] }),
          } as Response)
        }, 10)
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<RecipeCombobox value={null} onChange={vi.fn()} />)
    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.focus(input)

    fireEvent.change(input, { target: { value: 'hel' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    // First fetch is in-flight.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // New keystroke cancels the in-flight fetch (via useEffect cleanup).
    fireEvent.change(input, { target: { value: 'hello' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(abortedFirst).toBe(true)
  })

  it('ArrowDown / ArrowUp cycle the active option modular', async () => {
    mockFetchOnce([
      { slug: 'a', name: 'Alpha' },
      { slug: 'b', name: 'Bravo' },
      { slug: 'c', name: 'Charlie' },
    ])
    render(<RecipeCombobox value={null} onChange={vi.fn()} />)

    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'a' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    // activeIndex starts at 0 → first option selected
    expect(options[0].getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[2].getAttribute('aria-selected')).toBe('true')

    // Wraps forward.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')

    // Wraps backward.
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[2].getAttribute('aria-selected')).toBe('true')
  })

  it('Enter on the active option commits the slug and closes the dropdown', async () => {
    mockFetchOnce([
      { slug: 'hello-world', name: 'Hello World' },
      { slug: 'lint-fix', name: 'Lint Fix' },
    ])
    const handleChange = vi.fn()
    render(<RecipeCombobox value={null} onChange={handleChange} />)
    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'lin' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(handleChange).toHaveBeenCalledWith('lint-fix')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Escape closes the dropdown without calling onChange', async () => {
    mockFetchOnce([{ slug: 'hello-world', name: 'Hello World' }])
    const handleChange = vi.fn()
    render(<RecipeCombobox value={null} onChange={handleChange} />)
    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'h' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(handleChange).not.toHaveBeenCalled()
  })

  it('Clear button resets selection to null', () => {
    storeRecipes = [{ slug: 'hello-world', name: 'Hello World' }]
    const handleChange = vi.fn()
    render(<RecipeCombobox value="hello-world" onChange={handleChange} />)
    const clearBtn = screen.getByRole('button', { name: 'taskBoard.recipeField.clear' })
    fireEvent.mouseDown(clearBtn)
    expect(handleChange).toHaveBeenCalledWith(null)
  })

  it('disabled renders a readonly input, hides the clear button, and shows lockedHint', () => {
    storeRecipes = [{ slug: 'hello-world', name: 'Hello World' }]
    render(<RecipeCombobox value="hello-world" onChange={vi.fn()} disabled lockedHint="LOCKED_HINT" />)
    const input = screen.getByRole('searchbox') as HTMLInputElement
    expect(input.readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: 'taskBoard.recipeField.clear' })).toBeNull()
    expect(screen.getByText('LOCKED_HINT')).toBeInTheDocument()
  })

  it('result rows carry the model-tier chip class matching modelToTier', async () => {
    mockFetchOnce([
      { slug: 'sonnet-recipe', name: 'Sonnet Recipe', model: { primary: 'claude-sonnet-4-5' } },
    ])
    render(<RecipeCombobox value={null} onChange={vi.fn()} />)
    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 's' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // Find the chip by its model text and verify its class list matches the tier helper.
    const chip = screen.getByText('claude-sonnet-4-5')
    const expectedClass = modelTierClassName(modelToTier('claude-sonnet-4-5'))
    for (const cls of expectedClass.split(/\s+/).filter(Boolean)) {
      expect(chip.className).toContain(cls)
    }
  })

  it('selected value + populated recipes slice displays the friendly name', () => {
    storeRecipes = [{ slug: 'hello-world', name: 'Hello World' }]
    render(<RecipeCombobox value="hello-world" onChange={vi.fn()} />)
    const input = screen.getByRole('searchbox') as HTMLInputElement
    expect(input.value).toBe('Hello World')
  })

  it('selected value + empty recipes slice falls back to the slug literal', () => {
    storeRecipes = []
    render(<RecipeCombobox value="hello-world" onChange={vi.fn()} />)
    const input = screen.getByRole('searchbox') as HTMLInputElement
    expect(input.value).toBe('hello-world')
  })
})
