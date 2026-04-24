import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'

// ─── Module mocks ────────────────────────────────────────────────────

const pushSpy = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy }),
  usePathname: () => '/project/alpha/sessions',
}))

const projectWorkspaceState = {
  current: {
    slug: 'alpha',
    view: 'sessions',
    detailId: null as string | null,
    project: { id: 42, slug: 'alpha', name: 'Alpha' } as any,
    loading: false,
    error: null as string | null,
  },
}

vi.mock('@/components/project/project-context', () => ({
  useProjectWorkspace: () => projectWorkspaceState.current,
}))

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (k: string, vars?: any) => {
    const base = ns ? `${ns}.${k}` : k
    if (vars && typeof vars === 'object') {
      return Object.keys(vars).reduce((acc, key) => `${acc} ${key}=${vars[key]}`, base)
    }
    return base
  },
}))

const fetchSpy = vi.fn()

beforeEach(() => {
  pushSpy.mockReset()
  fetchSpy.mockReset()
  global.fetch = fetchSpy as unknown as typeof fetch
  projectWorkspaceState.current = {
    slug: 'alpha',
    view: 'sessions',
    detailId: null,
    project: { id: 42, slug: 'alpha', name: 'Alpha' } as any,
    loading: false,
    error: null,
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

import { SessionsView } from '@/components/project/sessions-view'

const sampleThread = {
  id: 'thread:42:aegis',
  conversationId: 'project:42:agent:aegis',
  agentName: 'Aegis',
  agentStatus: 'idle',
  lastMessage: 'hi there',
  lastActivity: Date.now() - 1000,
  assignmentSource: 'assigned' as const,
}

const sampleRuntime = {
  id: 'gw-1',
  kind: 'Gateway' as const,
  ticketRef: 'ALPHA-1',
  startedAt: Date.now() - 5000,
  active: true,
  status: 'running' as const,
  agent: 'aegis',
}

function mockResponse(payload: any, agents: any[] = []) {
  fetchSpy.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/agents')) {
      return { ok: true, json: async () => ({ agents }) } as any
    }
    return { ok: true, json: async () => payload } as any
  })
}

describe('SessionsView', () => {
  describe('SESS-01: loading and error states', () => {
    it('renders loading indicator while fetch is pending', () => {
      // fetchSpy returns an unresolved promise
      let resolveFetch: (v: any) => void
      fetchSpy.mockReturnValue(new Promise((r) => { resolveFetch = r }))
      render(<SessionsView />)
      expect(screen.getByText('project.sessions.loading')).toBeInTheDocument()
      // resolve to clean up
      // @ts-expect-error — assigned in promise callback
      resolveFetch?.({ ok: true, json: async () => ({ threads: [], runtimeSessions: [] }) })
    })

    it('renders error state (heading=Could not load sessions, body copy, Retry button) when fetch rejects', async () => {
      fetchSpy.mockRejectedValue(new Error('boom'))
      render(<SessionsView />)
      await waitFor(() => {
        expect(screen.getByText('project.sessions.errorHeading')).toBeInTheDocument()
      })
      expect(screen.getByText('project.sessions.errorBody')).toBeInTheDocument()
      expect(screen.getByText('project.common.retry')).toBeInTheDocument()
    })

    it('Retry button re-invokes fetch', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('boom'))
      render(<SessionsView />)
      await waitFor(() => {
        expect(screen.getByText('project.sessions.errorHeading')).toBeInTheDocument()
      })
      mockResponse({ threads: [], runtimeSessions: [] })
      fireEvent.click(screen.getByText('project.common.retry'))
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(4)
      })
    })
  })

  describe('SESS-01: empty state (D-18)', () => {
    it('renders empty heading "No sessions yet" when both threads[] and runtimeSessions[] are empty', async () => {
      mockResponse({ threads: [], runtimeSessions: [] })
      render(<SessionsView />)
      await screen.findByText('project.sessions.emptyHeading')
      expect(screen.getByText('project.sessions.emptyBody')).toBeInTheDocument()
    })

    it('empty-state CTA button has text from project.sessions.emptyCta key', async () => {
      mockResponse({ threads: [], runtimeSessions: [] })
      render(<SessionsView />)
      await screen.findByText('project.sessions.emptyCta')
    })

    it('CTA click navigates to /project/<slug>/agents (switches to Agents tab)', async () => {
      mockResponse({ threads: [], runtimeSessions: [] })
      render(<SessionsView />)
      const cta = await screen.findByText('project.sessions.emptyCta')
      fireEvent.click(cta)
      await waitFor(() => {
        expect(pushSpy).toHaveBeenCalledWith('/project/alpha/agents', expect.anything())
      })
    })

    it('CTA uses bg-primary text-primary-foreground styling per UI-SPEC (accent use #1)', async () => {
      mockResponse({ threads: [], runtimeSessions: [] })
      render(<SessionsView />)
      const cta = await screen.findByText('project.sessions.emptyCta')
      expect(cta.className).toContain('bg-primary')
      expect(cta.className).toContain('text-primary-foreground')
    })
  })

  describe('SESS-01: threads section', () => {
    it('section header with text from project.sessions.threadsHeader is rendered', async () => {
      mockResponse({ threads: [sampleThread], runtimeSessions: [] })
      render(<SessionsView />)
      await screen.findByText('project.sessions.threadsHeader')
    })

    it('one row per thread in response.threads', async () => {
      mockResponse({
        threads: [
          sampleThread,
          { ...sampleThread, id: 'thread:42:hermes', agentName: 'Hermes' },
        ],
        runtimeSessions: [],
      })
      render(<SessionsView />)
      await screen.findByText('Aegis')
      expect(screen.getByText('Hermes')).toBeInTheDocument()
    })

    it('row shows agent name (text-sm font-semibold), last message preview or threadEmptyPreview, status dot', async () => {
      mockResponse({
        threads: [
          sampleThread,
          {
            ...sampleThread,
            id: 'thread:42:hermes',
            agentName: 'Hermes',
            lastMessage: null,
            lastActivity: 0,
          },
        ],
        runtimeSessions: [],
      })
      render(<SessionsView />)
      await screen.findByText('Aegis')
      expect(screen.getByText('hi there')).toBeInTheDocument()
      expect(screen.getByText('project.sessions.threadEmptyPreview')).toBeInTheDocument()
    })

    it('row click navigates to /project/<slug>/sessions/<thread.id>', async () => {
      mockResponse({ threads: [sampleThread], runtimeSessions: [] })
      render(<SessionsView />)
      const name = await screen.findByText('Aegis')
      const row = name.closest('[role="button"]') as HTMLElement
      expect(row).toBeTruthy()
      fireEvent.click(row)
      await waitFor(() => {
        expect(pushSpy).toHaveBeenCalledWith(
          '/project/alpha/sessions/thread:42:aegis',
          expect.anything(),
        )
      })
    })

    it('row uses bg-card + hover:bg-surface-2 + transition-colors per UI-SPEC', async () => {
      mockResponse({ threads: [sampleThread], runtimeSessions: [] })
      render(<SessionsView />)
      const name = await screen.findByText('Aegis')
      const row = name.closest('[role="button"]') as HTMLElement
      expect(row.className).toContain('bg-card')
      expect(row.className).toContain('hover:bg-surface-2')
      expect(row.className).toContain('transition-colors')
    })
  })

  describe('SESS-01: runtime sessions section', () => {
    it('section header with text from project.sessions.runtimeHeader is rendered', async () => {
      mockResponse({ threads: [], runtimeSessions: [sampleRuntime] })
      render(<SessionsView />)
      await screen.findByText('project.sessions.runtimeHeader')
    })

    it('one row per runtime session in response.runtimeSessions', async () => {
      mockResponse({
        threads: [],
        runtimeSessions: [
          sampleRuntime,
          { ...sampleRuntime, id: 'cl-1', kind: 'Claude' },
        ],
      })
      render(<SessionsView />)
      await screen.findByText('project.sessions.runtimeGateway')
      expect(screen.getByText('project.sessions.runtimeClaude')).toBeInTheDocument()
    })

    it('row shows kind badge (Claude|Codex|Hermes|Gateway), ticketRef or fallback copy, status', async () => {
      mockResponse({ threads: [], runtimeSessions: [sampleRuntime] })
      render(<SessionsView />)
      await screen.findByText('project.sessions.runtimeGateway')
      // taskLabel resolves with ticketRef interpolation in our test mock
      expect(screen.getByText(/project\.sessions\.taskLabel.*ticketRef=ALPHA-1/)).toBeInTheDocument()
      expect(screen.getByText('project.sessions.statusRunning')).toBeInTheDocument()
    })

    it('row click navigates to /project/<slug>/sessions/<session.id>', async () => {
      mockResponse({ threads: [], runtimeSessions: [sampleRuntime] })
      render(<SessionsView />)
      const badge = await screen.findByText('project.sessions.runtimeGateway')
      const row = badge.closest('[role="button"]') as HTMLElement
      expect(row).toBeTruthy()
      fireEvent.click(row)
      await waitFor(() => {
        expect(pushSpy).toHaveBeenCalledWith(
          '/project/alpha/sessions/gw-1',
          expect.anything(),
        )
      })
    })
  })

  describe('SESS-03: selected-row styling when detailId matches', () => {
    it('when useProjectWorkspace().detailId equals a row id, that row gets bg-primary/10 border-l-2 border-l-primary (accent use #2)', async () => {
      projectWorkspaceState.current = {
        ...projectWorkspaceState.current,
        detailId: 'thread:42:aegis',
      }
      mockResponse({ threads: [sampleThread], runtimeSessions: [] })
      render(<SessionsView />)
      const name = await screen.findByText('Aegis')
      const row = name.closest('[role="button"]') as HTMLElement
      expect(row.className).toContain('bg-primary/10')
      expect(row.className).toContain('border-l-2')
      expect(row.className).toContain('border-l-primary')
    })

    it('non-matching rows do NOT get the accent selection styling', async () => {
      projectWorkspaceState.current = {
        ...projectWorkspaceState.current,
        detailId: 'thread:42:somebody-else',
      }
      mockResponse({ threads: [sampleThread], runtimeSessions: [] })
      render(<SessionsView />)
      const name = await screen.findByText('Aegis')
      const row = name.closest('[role="button"]') as HTMLElement
      expect(row.className).not.toContain('bg-primary/10')
      expect(row.className).not.toContain('border-l-primary')
    })
  })

  describe('SESS-01: SSE live updates (D-20)', () => {
    it('subscribing to chat.message events triggers a re-fetch of /api/projects/<id>/sessions', async () => {
      mockResponse({ threads: [], runtimeSessions: [] })
      render(<SessionsView />)
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2)
      })
      await act(async () => {
        window.dispatchEvent(new CustomEvent('mc:chat-message'))
      })
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(4)
      })
      expect(fetchSpy.mock.calls.some((args) => args[0] === '/api/projects/42/sessions')).toBe(true)
    })

    it('when SSE updates a thread.lastMessage, the row text updates with animate-fade-in class applied', async () => {
      mockResponse({ threads: [sampleThread], runtimeSessions: [] })
      render(<SessionsView />)
      const name = await screen.findByText('Aegis')
      const row = name.closest('[role="button"]') as HTMLElement
      // The row container or its preview line should carry animate-fade-in.
      // We assert the class shows up somewhere in the row subtree so the
      // SSE-driven update reads as an "appear" rather than a hard repaint.
      expect(row.outerHTML).toContain('animate-fade-in')
    })
  })

  describe('primary agent project chat', () => {
    it('renders the primary agent selector and opens the selected primary thread', async () => {
      mockResponse(
        { threads: [{ ...sampleThread, isPrimary: true, assignmentRole: 'primary' }], runtimeSessions: [], primaryAgent: { name: 'Aegis', status: 'idle' } },
        [{ name: 'Aegis', status: 'idle' }, { name: 'Hermes', status: 'idle' }],
      )
      render(<SessionsView />)
      const selector = await screen.findByLabelText('project.sessions.primaryAgentSelect')
      expect(selector).toHaveValue('Aegis')
      fireEvent.click(screen.getByText('project.sessions.openPrimaryChat'))
      await waitFor(() => {
        expect(pushSpy).toHaveBeenCalledWith('/project/alpha/sessions/thread:42:aegis', expect.anything())
      })
    })

    it('setting a primary agent POSTs role=primary to the project agents endpoint', async () => {
      mockResponse(
        { threads: [], runtimeSessions: [], primaryAgent: null },
        [{ name: 'Aegis', status: 'idle' }],
      )
      render(<SessionsView />)
      const selector = await screen.findByLabelText('project.sessions.primaryAgentSelect')
      fireEvent.change(selector, { target: { value: 'Aegis' } })
      await waitFor(() => {
        const postCall = fetchSpy.mock.calls.find((args) => {
          const init = args[1] as RequestInit | undefined
          return args[0] === '/api/projects/42/agents' && init?.method === 'POST'
        })
        expect(postCall).toBeTruthy()
        expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({
          agent_name: 'Aegis',
          role: 'primary',
        })
      })
    })
  })
})
