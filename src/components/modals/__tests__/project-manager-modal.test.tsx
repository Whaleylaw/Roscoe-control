import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// i18n mock: 'projects' namespace — translate known keys back to English so placeholder/label matching works intuitively.
// Other keys fall through to key-echo.
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => {
    const map: Record<string, string> = {
      'create.githubRepoPlaceholder': 'owner/repo',
    }
    return map[k] ?? k
  },
}))

vi.mock('@/lib/use-focus-trap', () => ({
  useFocusTrap: () => ({ current: null }),
}))

import { ProjectManagerModal } from '../project-manager-modal'

interface StubResponse {
  ok: boolean
  status?: number
  json: unknown
}

function mockFetchSequence(responses: Array<StubResponse>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const queue = [...responses]
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const res = queue.shift()
    if (!res) throw new Error(`Unexpected fetch: ${url}`)
    return {
      ok: res.ok,
      status: res.status ?? (res.ok ? 200 : 500),
      json: async () => res.json,
    } as Response
  })
  ;(global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
  return { fetchMock, calls }
}

// Default responses for the initial load() GET calls (projects + agents)
const initialLoad: Array<StubResponse> = [
  { ok: true, json: { projects: [] } },
  { ok: true, json: { agents: [] } },
]

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  ;(global as unknown as { fetch?: typeof fetch }).fetch = undefined as unknown as typeof fetch
})

describe('ProjectManagerModal — create form upgrades', () => {
  it('renders new github_repo, deadline, and color-palette fields', async () => {
    mockFetchSequence([...initialLoad])
    render(<ProjectManagerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading projects...')).toBeNull())

    expect(screen.getByPlaceholderText('owner/repo')).toBeTruthy()
    // deadline label
    expect(screen.getByText(/create\.deadlineLabel/i)).toBeTruthy()
    // Color palette: eight buttons with aria-label = hex value
    expect(screen.getByRole('button', { name: '#3b82f6' })).toBeTruthy()
  })

  it('sync checkbox is hidden when github_repo is empty', async () => {
    mockFetchSequence([...initialLoad])
    render(<ProjectManagerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading projects...')).toBeNull())
    expect(screen.queryByLabelText(/create\.enableSyncLabel/i)).toBeNull()
  })

  it('sync checkbox appears + is checked when valid github_repo is typed', async () => {
    mockFetchSequence([...initialLoad])
    render(<ProjectManagerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading projects...')).toBeNull())
    fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'octocat/hello' } })
    const cb = screen.getByLabelText(/create\.enableSyncLabel/i) as HTMLInputElement
    expect(cb.checked).toBe(true)
  })

  it('shows invalid-format error and hides sync checkbox for malformed repo input', async () => {
    mockFetchSequence([...initialLoad])
    render(<ProjectManagerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading projects...')).toBeNull())
    fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'bad-format' } })
    expect(screen.getByText(/create\.githubRepoInvalid/i)).toBeTruthy()
    expect(screen.queryByLabelText(/create\.enableSyncLabel/i)).toBeNull()
  })

  it('invalid github_repo blocks POST /api/projects', async () => {
    const { calls } = mockFetchSequence([...initialLoad])
    render(<ProjectManagerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading projects...')).toBeNull())
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'X' } })
    fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: /Add Project/i }))
    // Only the two initial GETs should have fired
    expect(calls.filter(c => c.init?.method === 'POST')).toHaveLength(0)
  })

  it('POST payload includes github_repo, deadline (unix seconds), and color when provided', async () => {
    const { calls } = mockFetchSequence([
      ...initialLoad,
      { ok: true, status: 201, json: { project: { id: 42, github_repo: 'octocat/hello' } } },
      { ok: true, json: { ok: true } }, // init-labels
      { ok: true, json: {} },            // PATCH
      { ok: true, json: { projects: [] } }, // reload
      { ok: true, json: { agents: [] } },
    ])
    render(<ProjectManagerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading projects...')).toBeNull())
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'Hello' } })
    fireEvent.change(screen.getByPlaceholderText('Ticket prefix (e.g. PA)'), { target: { value: 'HEL' } })
    fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'octocat/hello' } })
    // pick color
    fireEvent.click(screen.getByRole('button', { name: '#3b82f6' }))
    // pick deadline
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-12-31' } })

    fireEvent.click(screen.getByRole('button', { name: /Add Project/i }))
    await waitFor(() => {
      const post = calls.find(c => c.url === '/api/projects' && c.init?.method === 'POST')
      expect(post).toBeTruthy()
      const body = JSON.parse(post!.init!.body as string)
      expect(body.name).toBe('Hello')
      expect(body.ticket_prefix).toBe('HEL')
      expect(body.github_repo).toBe('octocat/hello')
      expect(body.color).toBe('#3b82f6')
      // Unix seconds for 2026-12-31: assert it's a number within a sane range
      expect(typeof body.deadline).toBe('number')
      expect(body.deadline).toBeGreaterThan(1_700_000_000)
      expect(body.deadline).toBeLessThan(2_000_000_000)
    })
  })

  it('fires init-labels + PATCH chain when sync checkbox is checked', async () => {
    const { calls } = mockFetchSequence([
      ...initialLoad,
      { ok: true, status: 201, json: { project: { id: 42 } } },
      { ok: true, json: { ok: true, repo: 'octocat/hello' } },
      { ok: true, json: {} },
      { ok: true, json: { projects: [] } },
      { ok: true, json: { agents: [] } },
    ])
    render(<ProjectManagerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading projects...')).toBeNull())
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'Hello' } })
    fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'octocat/hello' } })
    fireEvent.click(screen.getByRole('button', { name: /Add Project/i }))

    await waitFor(() => {
      const init = calls.find(c => c.url === '/api/github' && c.init?.method === 'POST')
      expect(init).toBeTruthy()
      const initBody = JSON.parse(init!.init!.body as string)
      expect(initBody.action).toBe('init-labels')
      expect(initBody.repo).toBe('octocat/hello')

      const patch = calls.find(c => c.url === '/api/projects/42' && c.init?.method === 'PATCH')
      expect(patch).toBeTruthy()
      const patchBody = JSON.parse(patch!.init!.body as string)
      expect(patchBody.github_sync_enabled).toBe(1)
    })
  })

  it('skips chain when sync checkbox is unchecked', async () => {
    const { calls } = mockFetchSequence([
      ...initialLoad,
      { ok: true, status: 201, json: { project: { id: 42 } } },
      { ok: true, json: { projects: [] } },
      { ok: true, json: { agents: [] } },
    ])
    render(<ProjectManagerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading projects...')).toBeNull())
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'Hello' } })
    fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'octocat/hello' } })
    const cb = screen.getByLabelText(/create\.enableSyncLabel/i)
    fireEvent.click(cb) // uncheck
    fireEvent.click(screen.getByRole('button', { name: /Add Project/i }))

    await waitFor(() => {
      const post = calls.find(c => c.url === '/api/projects' && c.init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(calls.find(c => c.url === '/api/github')).toBeUndefined()
      expect(calls.find(c => c.url === '/api/projects/42' && c.init?.method === 'PATCH')).toBeUndefined()
    })
  })

  it('shows inline warning when init-labels fails but keeps project created', async () => {
    const { calls } = mockFetchSequence([
      ...initialLoad,
      { ok: true, status: 201, json: { project: { id: 42 } } },
      { ok: false, status: 500, json: { error: 'GITHUB_TOKEN not configured' } },
      { ok: true, json: { projects: [] } },
      { ok: true, json: { agents: [] } },
    ])
    render(<ProjectManagerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading projects...')).toBeNull())
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'Hello' } })
    fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'octocat/hello' } })
    fireEvent.click(screen.getByRole('button', { name: /Add Project/i }))

    await waitFor(() => {
      expect(screen.getByText(/create\.initLabelsFailedWarning/i)).toBeTruthy()
      // PATCH was NOT attempted
      expect(calls.find(c => c.url === '/api/projects/42' && c.init?.method === 'PATCH')).toBeUndefined()
    })
  })

  it('no chain when github_repo is empty', async () => {
    const { calls } = mockFetchSequence([
      ...initialLoad,
      { ok: true, status: 201, json: { project: { id: 42 } } },
      { ok: true, json: { projects: [] } },
      { ok: true, json: { agents: [] } },
    ])
    render(<ProjectManagerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading projects...')).toBeNull())
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: /Add Project/i }))

    await waitFor(() => {
      expect(calls.find(c => c.url === '/api/projects' && c.init?.method === 'POST')).toBeTruthy()
      expect(calls.find(c => c.url === '/api/github')).toBeUndefined()
    })
  })
})
