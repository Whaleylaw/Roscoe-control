import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// ─── Module mocks ────────────────────────────────────────────────────
//
// The view is a thin wrapper around AgentSquadPanel — we replace the panel
// with a spy double so we can capture exactly which props are passed.

const mockPanelSpy = vi.fn()

vi.mock('@/components/panels/agent-squad-panel', () => ({
  AgentSquadPanel: (props: any) => {
    mockPanelSpy(props)
    return <div data-testid="agent-squad-panel-mock" />
  },
}))

const projectWorkspaceState = {
  current: {
    slug: 'alpha',
    view: 'agents',
    project: { id: 42, slug: 'alpha', name: 'Alpha' } as any,
    loading: false,
    error: null as string | null,
  },
}

vi.mock('@/components/project/project-context', () => ({
  useProjectWorkspace: () => projectWorkspaceState.current,
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))

beforeEach(() => {
  mockPanelSpy.mockReset()
  // Reset to default (project loaded) state
  projectWorkspaceState.current = {
    slug: 'alpha',
    view: 'agents',
    project: { id: 42, slug: 'alpha', name: 'Alpha' } as any,
    loading: false,
    error: null,
  }
})

afterEach(() => {
  cleanup()
})

import { AgentsView } from '@/components/project/agents-view'

describe('AgentsView', () => {
  describe('SESS-02: embeds AgentSquadPanel with correct scope', () => {
    it('renders <AgentSquadPanel scope={...}/> when project is loaded', () => {
      render(<AgentsView />)
      expect(mockPanelSpy).toHaveBeenCalledTimes(1)
      const props = mockPanelSpy.mock.calls[0][0]
      expect(props.scope).toBeDefined()
    })

    it('scope.lockedProjectId equals useProjectWorkspace().project.id', () => {
      render(<AgentsView />)
      expect(mockPanelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ scope: expect.objectContaining({ lockedProjectId: 42 }) }),
      )
    })

    it('scope.taskScopeProjectId equals useProjectWorkspace().project.id', () => {
      render(<AgentsView />)
      expect(mockPanelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ scope: expect.objectContaining({ taskScopeProjectId: 42 }) }),
      )
    })

    it('scope.hideCreateAgent is true', () => {
      render(<AgentsView />)
      expect(mockPanelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ scope: expect.objectContaining({ hideCreateAgent: true }) }),
      )
    })

    it('scope.showAssignmentBadge is true', () => {
      render(<AgentsView />)
      expect(mockPanelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ scope: expect.objectContaining({ showAssignmentBadge: true }) }),
      )
    })
  })

  describe('SESS-02: renders nothing when project is null', () => {
    it('returns null when useProjectWorkspace().project is null (workspace shell handles loading/not-found)', () => {
      projectWorkspaceState.current = {
        slug: 'alpha',
        view: 'agents',
        project: null,
        loading: false,
        error: null,
      }
      const { container } = render(<AgentsView />)
      expect(container.firstChild).toBeNull()
      expect(mockPanelSpy).not.toHaveBeenCalled()
    })
  })

  describe('SESS-02: empty-state handling is delegated to embedded panel', () => {
    it('does NOT render its own empty state — the panel handles it (empty state copy comes from project.agents.* keys)', () => {
      const { container } = render(<AgentsView />)
      // Wrapper renders only the panel mock — no extra DOM from AgentsView itself
      expect(container.querySelectorAll('[data-testid="agent-squad-panel-mock"]')).toHaveLength(1)
      // No h2, p, or other wrapper chrome
      expect(container.querySelector('h2')).toBeNull()
      expect(container.querySelector('p')).toBeNull()
    })
  })
})
