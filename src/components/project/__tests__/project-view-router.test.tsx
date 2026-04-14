import { describe, it } from 'vitest'

// Mock setup (to be implemented in Plan 05-02):
// - vi.mock('@/components/project/project-context', ...) for useProjectWorkspace
// - vi.mock each view component ('dashboard-view', 'tasks-view', 'sessions-view', 'agents-view', 'settings-view', 'session-detail-view') to return lightweight stubs
// - vi.mock('next-intl') for useTranslations
// - React Testing Library render() of <ProjectViewRouter />

describe('ProjectViewRouter', () => {
  describe('SESS-03: sessions view dispatch', () => {
    it.todo('renders <SessionsView/> when view === "sessions" and detailId is null')
    it.todo('renders <SessionDetailView sessionId={detailId}/> when view === "sessions" and detailId is a non-empty string')
    it.todo('passes detailId verbatim (including "thread:" prefix) to SessionDetailView')
  })

  describe('SESS-03: regression — other views unchanged', () => {
    it.todo('renders <DashboardView/> when view === "dashboard"')
    it.todo('renders <TasksView/> when view === "tasks"')
    it.todo('renders <AgentsView/> when view === "agents" (even when detailId is present — detail ignored for agents in Phase 5)')
    it.todo('renders <SettingsView/> when view === "settings"')
    it.todo('renders notFound fallback when view is an unknown value')
  })
})
