import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// Covers: GSD-20 — Lifecycle tab exists in project workspace between
// Dashboard and Tasks (UI-SPEC routing decision).

const routerState = {
  push: vi.fn(),
}

vi.mock('next/navigation', () => ({
  useRouter: () => routerState,
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `project.${key}`,
}))

const workspaceState = {
  current: {
    slug: 'alpha',
    view: 'dashboard',
    detailId: null as string | null,
    project: null as any,
    loading: false,
    error: null as string | null,
  },
}

vi.mock('@/components/project/project-context', () => ({
  useProjectWorkspace: () => workspaceState.current,
}))

import { ProjectTabs } from '@/components/project/project-tabs'

afterEach(() => cleanup())

beforeEach(() => {
  routerState.push.mockReset()
  workspaceState.current.view = 'dashboard'
})

describe('ProjectTabs (GSD-20)', () => {
  it('renders 6 tabs with lifecycle between dashboard and tasks', () => {
    render(<ProjectTabs />)
    const tabs = screen.getAllByRole('button')
    expect(tabs).toHaveLength(6)
    expect(tabs[0]).toHaveTextContent('project.nav.dashboard')
    expect(tabs[1]).toHaveTextContent('project.nav.lifecycle')
    expect(tabs[2]).toHaveTextContent('project.nav.tasks')
    expect(tabs[3]).toHaveTextContent('project.nav.sessions')
    expect(tabs[4]).toHaveTextContent('project.nav.agents')
    expect(tabs[5]).toHaveTextContent('project.nav.settings')
  })

  it('clicking the Lifecycle tab navigates to /project/:slug/lifecycle', () => {
    render(<ProjectTabs />)
    const lifecycleTab = screen.getAllByRole('button')[1]
    fireEvent.click(lifecycleTab)
    expect(routerState.push).toHaveBeenCalledWith('/project/alpha/lifecycle', {
      scroll: false,
    })
  })

  it('highlights the active lifecycle tab when view==="lifecycle"', () => {
    workspaceState.current.view = 'lifecycle'
    render(<ProjectTabs />)
    const tabs = screen.getAllByRole('button')
    expect(tabs[1].className).toContain('border-primary')
    // other tabs should not carry the active underline
    expect(tabs[0].className).not.toContain('border-primary')
  })
})
