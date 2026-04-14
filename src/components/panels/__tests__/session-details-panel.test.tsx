import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SessionDetailsPanel } from '@/components/panels/session-details-panel'

const useSmartPollSpy = vi.fn()
vi.mock('@/lib/use-smart-poll', () => ({
  useSmartPoll: (cb: any, ms: any, opts: any) => useSmartPollSpy(cb, ms, opts),
}))

const setSessionsSpy = vi.fn()
const setSelectedSessionSpy = vi.fn()

const baseSession = {
  id: 'sess-abc',
  key: 'workspace:proj:1:main:main',
  session_key: 'sess-abc',
  active: true,
  age: '5m',
  tokens: '1k/100k (1.0%)',
  model: 'claude-sonnet-4',
  flags: [],
  kind: 'main',
  lastActivity: Date.now(),
  messageCount: 4,
  label: '',
}

const otherSession = {
  ...baseSession,
  id: 'sess-other',
  key: 'workspace:proj:2:main:main',
  session_key: 'sess-other',
  age: '1h',
}

let storeSessions: any[] = [baseSession, otherSession]

vi.mock('@/store', () => ({
  useMissionControl: () => ({
    sessions: storeSessions,
    selectedSession: null,
    setSessions: setSessionsSpy,
    setSelectedSession: setSelectedSessionSpy,
    availableModels: [],
    connection: { isConnected: false, sseConnected: false },
  }),
}))

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (k: string, vars?: Record<string, any>) => {
    if (vars) {
      const parts = Object.entries(vars).map(([key, val]) => `${key}=${val}`).join(',')
      return ns ? `${ns}.${k}(${parts})` : `${k}(${parts})`
    }
    return ns ? `${ns}.${k}` : k
  },
}))

vi.mock('@/lib/client-logger', () => ({
  createClientLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}))

const fetchMock = vi.fn(async (url: string) => {
  if (typeof url === 'string' && url.startsWith('/api/chat/messages')) {
    return {
      ok: true,
      json: async () => ({
        messages: [
          { id: 1, from_agent: 'user', content: 'hi there' },
          { id: 2, from_agent: 'aegis', content: 'hello back' },
        ],
      }),
    } as any
  }
  if (typeof url === 'string' && url.startsWith('/api/sessions')) {
    return {
      ok: true,
      json: async () => ({ sessions: storeSessions }),
    } as any
  }
  return { ok: true, json: async () => ({}) } as any
})

beforeEach(() => {
  useSmartPollSpy.mockReset()
  setSessionsSpy.mockReset()
  setSelectedSessionSpy.mockReset()
  fetchMock.mockClear()
  storeSessions = [baseSession, otherSession]
  global.fetch = fetchMock as any
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SessionDetailsPanel', () => {
  describe('scope default (undefined) — current behavior preserved (regression guard)', () => {
    it('useSmartPoll(loadSessions) IS invoked when scope is undefined', () => {
      render(<SessionDetailsPanel />)
      expect(useSmartPollSpy).toHaveBeenCalled()
      // first call's first arg should be the loadSessions callback (a function)
      expect(typeof useSmartPollSpy.mock.calls[0][0]).toBe('function')
    })

    it('setSessions is called with the GET /api/sessions response when scope is undefined', async () => {
      render(<SessionDetailsPanel />)
      // useSmartPoll would normally invoke the callback; here we invoke it directly to assert wiring
      const cb = useSmartPollSpy.mock.calls[0][0]
      await cb()
      expect(setSessionsSpy).toHaveBeenCalled()
    })

    it('filters, sort, time-window controls render when scope is undefined', () => {
      render(<SessionDetailsPanel />)
      expect(screen.getByText('sessionDetails.filter')).toBeInTheDocument()
      expect(screen.getByText('sessionDetails.sortBy')).toBeInTheDocument()
      expect(screen.getByText('sessionDetails.timeWindow')).toBeInTheDocument()
    })

    it('page header/title renders when scope is undefined', () => {
      render(<SessionDetailsPanel />)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('sessionDetails.title')
    })
  })

  describe('SESS-03: scope.sessionId renders a single-session detail view', () => {
    it('only the session whose id matches scope.sessionId is rendered (no list of other sessions)', () => {
      render(<SessionDetailsPanel scope={{ sessionId: 'sess-abc' }} />)
      // baseSession.key visible, otherSession.key absent
      expect(screen.getByText(baseSession.key)).toBeInTheDocument()
      expect(screen.queryByText(otherSession.key)).not.toBeInTheDocument()
    })

    it('transcript + metadata panel for the matching session is visible', () => {
      render(<SessionDetailsPanel scope={{ sessionId: 'sess-abc' }} />)
      // The matching session's key is rendered, confirming detail row is present
      expect(screen.getByText(baseSession.key)).toBeInTheDocument()
    })

    it('component does not crash when scope.sessionId matches no session in the store', () => {
      expect(() =>
        render(<SessionDetailsPanel scope={{ sessionId: 'does-not-exist' }} />),
      ).not.toThrow()
    })
  })

  describe('SESS-03: scope.hideFilters hides filter controls', () => {
    it('session-filter <select> (all/active/idle) is NOT rendered when scope.hideFilters is true', () => {
      render(<SessionDetailsPanel scope={{ sessionId: 'sess-abc', hideFilters: true }} />)
      expect(screen.queryByText('sessionDetails.filter')).not.toBeInTheDocument()
    })

    it('sort-by <select> is NOT rendered when scope.hideFilters is true', () => {
      render(<SessionDetailsPanel scope={{ sessionId: 'sess-abc', hideFilters: true }} />)
      expect(screen.queryByText('sessionDetails.sortBy')).not.toBeInTheDocument()
    })

    it('time-window <select> is NOT rendered when scope.hideFilters is true', () => {
      render(<SessionDetailsPanel scope={{ sessionId: 'sess-abc', hideFilters: true }} />)
      expect(screen.queryByText('sessionDetails.timeWindow')).not.toBeInTheDocument()
    })
  })

  describe('SESS-03: scope.hideHeader hides top page header', () => {
    it('top page header/title is NOT rendered when scope.hideHeader is true', () => {
      render(<SessionDetailsPanel scope={{ sessionId: 'sess-abc', hideHeader: true }} />)
      expect(screen.queryByText('sessionDetails.title')).not.toBeInTheDocument()
    })

    it('back-link (if scope.backHref provided) IS rendered in place of the header', () => {
      render(
        <SessionDetailsPanel
          scope={{ sessionId: 'sess-abc', hideHeader: true, backHref: '/project/alpha/sessions' }}
        />,
      )
      const link = screen.getByRole('link', { name: /detailBackLink/i })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', '/project/alpha/sessions')
    })
  })

  describe('SESS-01: scope.threadMode renders chat-thread transcript instead of runtime transcript', () => {
    it('when scope.threadMode is true, messages are fetched from /api/chat/messages with derived conversation_id', async () => {
      render(
        <SessionDetailsPanel
          scope={{ sessionId: 'thread:1:aegis', threadMode: true, hideHeader: true, hideFilters: true }}
        />,
      )
      await waitFor(() => {
        const calledWithThread = fetchMock.mock.calls.some((args) =>
          typeof args[0] === 'string' && args[0].includes('/api/chat/messages') && args[0].includes('project%3A1%3Aagent%3Aaegis'),
        )
        expect(calledWithThread).toBe(true)
      })
    })

    it('when scope.threadMode is true, runtime-session controls (set-thinking, set-verbose) are hidden', () => {
      render(
        <SessionDetailsPanel
          scope={{ sessionId: 'thread:1:aegis', threadMode: true, hideHeader: true, hideFilters: true }}
        />,
      )
      expect(screen.queryByText('sessionDetails.thinking')).not.toBeInTheDocument()
      expect(screen.queryByText('sessionDetails.verbose')).not.toBeInTheDocument()
    })

    it('when scope.threadMode is false, /api/chat/messages is NOT fetched', async () => {
      render(<SessionDetailsPanel scope={{ sessionId: 'sess-abc' }} />)
      // Wait a tick so any synchronous useEffect would have fired
      await new Promise((r) => setTimeout(r, 10))
      const calledWithChat = fetchMock.mock.calls.some(
        (args) => typeof args[0] === 'string' && args[0].startsWith('/api/chat/messages'),
      )
      expect(calledWithChat).toBe(false)
    })
  })

  describe('Pitfall 9: no Zustand clobber when scope.sessionId is set', () => {
    it('useSmartPoll(loadSessions) is NOT invoked when scope.sessionId is set', () => {
      render(<SessionDetailsPanel scope={{ sessionId: 'sess-abc' }} />)
      // useSmartPoll may be called with the disabled flag — what matters is that polling never executes loadSessions
      const callsWithEnabled = useSmartPollSpy.mock.calls.filter((args) => args[2]?.enabled !== false)
      expect(callsWithEnabled.length).toBe(0)
    })

    it('setSessions is NOT called when scope.sessionId is set (would clobber the global list)', async () => {
      render(<SessionDetailsPanel scope={{ sessionId: 'sess-abc' }} />)
      await new Promise((r) => setTimeout(r, 10))
      expect(setSessionsSpy).not.toHaveBeenCalled()
    })

    it('setSelectedSession is NOT called unconditionally when scope.sessionId is set', () => {
      render(<SessionDetailsPanel scope={{ sessionId: 'sess-abc' }} />)
      // No row click occurred; the panel must not auto-set selectedSession in scope mode
      expect(setSelectedSessionSpy).not.toHaveBeenCalled()
    })

    it('detail data is sourced from the existing store.sessions selector without mutating setSessions', () => {
      render(<SessionDetailsPanel scope={{ sessionId: 'sess-abc' }} />)
      // The matched session is rendered using the data already in the store
      expect(screen.getByText(baseSession.key)).toBeInTheDocument()
      expect(setSessionsSpy).not.toHaveBeenCalled()
    })
  })
})
