import { describe, it } from 'vitest'

// Mock setup (to be implemented in Plan 05-03):
// - vi.mock('@/components/project/project-context', ...) for useProjectWorkspace (return slug, view, detailId, project)
// - vi.mock('next-intl', ...) for useTranslations
// - vi.mock('next/navigation', ...) for useRouter (to spy on push()) and usePathname
// - global.fetch mock for GET /api/projects/<id>/sessions
// - React Testing Library render() of <SessionsView/>

describe('SessionsView', () => {
  describe('SESS-01: loading and error states', () => {
    it.todo('renders loading indicator while fetch is pending')
    it.todo('renders error state (heading=Could not load sessions, body copy, Retry button) when fetch rejects')
    it.todo('Retry button re-invokes fetch')
  })

  describe('SESS-01: empty state (D-18)', () => {
    it.todo('renders empty heading "No sessions yet" when both threads[] and runtimeSessions[] are empty')
    it.todo('empty-state CTA button has text from project.sessions.emptyCta key')
    it.todo('CTA click navigates to /project/<slug>/agents (switches to Agents tab)')
    it.todo('CTA uses bg-primary text-primary-foreground styling per UI-SPEC (accent use #1)')
  })

  describe('SESS-01: threads section', () => {
    it.todo('section header with text from project.sessions.threadsHeader is rendered')
    it.todo('one row per thread in response.threads')
    it.todo('row shows agent name (text-sm font-semibold), last message preview or threadEmptyPreview, status dot')
    it.todo('row click navigates to /project/<slug>/sessions/<thread.id>')
    it.todo('row uses bg-card + hover:bg-surface-2 + transition-colors per UI-SPEC')
  })

  describe('SESS-01: runtime sessions section', () => {
    it.todo('section header with text from project.sessions.runtimeHeader is rendered')
    it.todo('one row per runtime session in response.runtimeSessions')
    it.todo('row shows kind badge (Claude|Codex|Hermes|Gateway), ticketRef or fallback copy, status')
    it.todo('row click navigates to /project/<slug>/sessions/<session.id>')
  })

  describe('SESS-03: selected-row styling when detailId matches', () => {
    it.todo('when useProjectWorkspace().detailId equals a row id, that row gets bg-primary/10 border-l-2 border-l-primary (accent use #2)')
    it.todo('non-matching rows do NOT get the accent selection styling')
  })

  describe('SESS-01: SSE live updates (D-20)', () => {
    it.todo('subscribing to chat.message events triggers a re-fetch of /api/projects/<id>/sessions')
    it.todo('when SSE updates a thread.lastMessage, the row text updates with animate-fade-in class applied')
  })
})
