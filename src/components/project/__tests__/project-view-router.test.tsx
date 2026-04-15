import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProjectViewRouter } from '@/components/project/project-view-router'
import { useProjectWorkspace } from '@/components/project/project-context'

vi.mock('@/components/project/project-context', () => ({
  useProjectWorkspace: vi.fn(),
}))

vi.mock('@/components/project/dashboard-view', () => ({
  DashboardView: () => <div data-testid="dashboard-view-mock" />,
}))

vi.mock('@/components/project/lifecycle/lifecycle-view', () => ({
  LifecycleView: () => <div data-testid="lifecycle-view-mock" />,
}))

vi.mock('@/components/project/tasks-view', () => ({
  TasksView: () => <div data-testid="tasks-view-mock" />,
}))

vi.mock('@/components/project/sessions-view', () => ({
  SessionsView: () => <div data-testid="sessions-view-mock" />,
}))

vi.mock('@/components/project/agents-view', () => ({
  AgentsView: () => <div data-testid="agents-view-mock" />,
}))

vi.mock('@/components/project/settings-view', () => ({
  SettingsView: () => <div data-testid="settings-view-mock" />,
}))

vi.mock('@/components/project/session-detail-view', () => ({
  SessionDetailView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="session-detail-view-mock">{sessionId}</div>
  ),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const mockedUseProjectWorkspace = useProjectWorkspace as unknown as ReturnType<typeof vi.fn>

describe('ProjectViewRouter', () => {
  beforeEach(() => {
    mockedUseProjectWorkspace.mockReset()
  })

  describe('SESS-03: sessions view dispatch', () => {
    it('renders <SessionsView/> when view === "sessions" and detailId is null', () => {
      mockedUseProjectWorkspace.mockReturnValue({ view: 'sessions', detailId: null, slug: 'alpha' })
      render(<ProjectViewRouter />)
      expect(screen.getByTestId('sessions-view-mock')).toBeInTheDocument()
      expect(screen.queryByTestId('session-detail-view-mock')).not.toBeInTheDocument()
    })

    it('renders <SessionDetailView sessionId={detailId}/> when view === "sessions" and detailId is a non-empty string', () => {
      mockedUseProjectWorkspace.mockReturnValue({ view: 'sessions', detailId: 'abc123', slug: 'alpha' })
      render(<ProjectViewRouter />)
      expect(screen.getByTestId('session-detail-view-mock')).toHaveTextContent('abc123')
      expect(screen.queryByTestId('sessions-view-mock')).not.toBeInTheDocument()
    })

    it('passes detailId verbatim (including "thread:" prefix) to SessionDetailView', () => {
      mockedUseProjectWorkspace.mockReturnValue({ view: 'sessions', detailId: 'thread:1:aegis', slug: 'alpha' })
      render(<ProjectViewRouter />)
      expect(screen.getByTestId('session-detail-view-mock')).toHaveTextContent('thread:1:aegis')
    })
  })

  describe('SESS-03: regression — other views unchanged', () => {
    it('renders <DashboardView/> when view === "dashboard"', () => {
      mockedUseProjectWorkspace.mockReturnValue({ view: 'dashboard', detailId: null, slug: 'alpha' })
      render(<ProjectViewRouter />)
      expect(screen.getByTestId('dashboard-view-mock')).toBeInTheDocument()
    })

    it('renders <TasksView/> when view === "tasks"', () => {
      mockedUseProjectWorkspace.mockReturnValue({ view: 'tasks', detailId: null, slug: 'alpha' })
      render(<ProjectViewRouter />)
      expect(screen.getByTestId('tasks-view-mock')).toBeInTheDocument()
    })

    it('renders <LifecycleView/> when view === "lifecycle" (GSD-20)', () => {
      mockedUseProjectWorkspace.mockReturnValue({ view: 'lifecycle', detailId: null, slug: 'alpha' })
      render(<ProjectViewRouter />)
      expect(screen.getByTestId('lifecycle-view-mock')).toBeInTheDocument()
    })

    it('renders <AgentsView/> when view === "agents" (even when detailId is present — detail ignored for agents in Phase 5)', () => {
      mockedUseProjectWorkspace.mockReturnValue({ view: 'agents', detailId: 'someAgent', slug: 'alpha' })
      render(<ProjectViewRouter />)
      expect(screen.getByTestId('agents-view-mock')).toBeInTheDocument()
    })

    it('renders <SettingsView/> when view === "settings"', () => {
      mockedUseProjectWorkspace.mockReturnValue({ view: 'settings', detailId: null, slug: 'alpha' })
      render(<ProjectViewRouter />)
      expect(screen.getByTestId('settings-view-mock')).toBeInTheDocument()
    })

    it('renders notFound fallback when view is an unknown value', () => {
      mockedUseProjectWorkspace.mockReturnValue({ view: 'mystery', detailId: null, slug: 'alpha' })
      render(<ProjectViewRouter />)
      expect(screen.getByText('workspace.notFound')).toBeInTheDocument()
    })
  })
})
