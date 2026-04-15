import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Covers: GSD-20, GSD-21.
// LifecycleView renders the project Lifecycle tab: current-phase
// callout, phase timeline, gate-task list, and conditional CTAs
// driven by gsd_enabled / bootstrapped state + role.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `lifecycle.${key}`,
}))

const projectWorkspaceState = {
  current: {
    slug: 'alpha',
    view: 'lifecycle',
    detailId: null as string | null,
    project: null as any,
    loading: false,
    error: null as string | null,
  },
}

vi.mock('@/components/project/project-context', () => ({
  useProjectWorkspace: () => projectWorkspaceState.current,
}))

const missionControlState = {
  current: {
    currentUser: { role: 'operator' } as { role: string } | null,
    tasks: [] as any[],
    fetchProjects: vi.fn().mockResolvedValue(undefined),
  },
}

vi.mock('@/store', () => ({
  useMissionControl: () => missionControlState.current,
}))

import { LifecycleView } from '@/components/project/lifecycle/lifecycle-view'

afterEach(() => cleanup())

beforeEach(() => {
  projectWorkspaceState.current.project = null
  missionControlState.current.tasks = []
  missionControlState.current.currentUser = { role: 'operator' }
})

describe('LifecycleView (GSD-20, GSD-21)', () => {
  it('renders translated title via useTranslations("project.lifecycle")', () => {
    projectWorkspaceState.current.project = {
      id: 1,
      slug: 'alpha',
      gsd_enabled: 1,
      gsd_phase: 'discuss',
    }
    missionControlState.current.tasks = [
      { id: 1, project_id: 1, gsd_phase: 'discuss', gate_required: 0, status: 'done', title: 'Kickoff', ticket_ref: 'A-1' },
    ]
    render(<LifecycleView />)
    // title appears (lifecycle.title from stub)
    expect(screen.getAllByText('lifecycle.title').length).toBeGreaterThanOrEqual(1)
  })

  it('gsd_enabled=1, not bootstrapped → renders not-bootstrapped empty state with Bootstrap CTA', () => {
    projectWorkspaceState.current.project = {
      id: 7,
      slug: 'alpha',
      gsd_enabled: 1,
      gsd_phase: 'discuss',
    }
    // No tasks with gsd_phase — treated as not bootstrapped
    missionControlState.current.tasks = [
      { id: 1, project_id: 7, gsd_phase: null, gate_required: 0, status: 'inbox', title: 'x' },
    ]
    render(<LifecycleView />)
    expect(screen.getByText('lifecycle.empty.notBootstrapped.heading')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /lifecycle\.cta\.bootstrap/ })
    ).toBeTruthy()
  })

  it('gsd_enabled=1, bootstrapped → renders PhaseTimeline + GateTaskList sections', () => {
    projectWorkspaceState.current.project = {
      id: 2,
      slug: 'alpha',
      gsd_enabled: 1,
      gsd_phase: 'execute',
    }
    missionControlState.current.tasks = [
      { id: 11, project_id: 2, gsd_phase: 'execute', gate_required: 0, status: 'in_progress', title: 'Work', ticket_ref: 'A-11' },
      { id: 12, project_id: 2, gsd_phase: 'execute', gate_required: 1, gate_status: 'pending', status: 'review', title: 'Approve', ticket_ref: 'A-12' },
    ]
    render(<LifecycleView />)
    // PhaseTimeline has role="list" (the <ol>)
    const lists = screen.getAllByRole('list')
    expect(lists.length).toBeGreaterThanOrEqual(1)
    // Gate task list section title present
    expect(screen.getByText('lifecycle.gateTasks')).toBeTruthy()
  })

  it('gsd_enabled=0 → renders LifecycleEmptyState (with Enable CTA)', () => {
    projectWorkspaceState.current.project = {
      id: 3,
      slug: 'alpha',
      gsd_enabled: 0,
    }
    render(<LifecycleView />)
    expect(screen.getByText('lifecycle.empty.heading')).toBeTruthy()
    expect(screen.getByRole('button', { name: /lifecycle\.cta\.enable/ })).toBeTruthy()
  })

  it('viewer role hides Advance/Bootstrap buttons but shows PhaseTimeline read-only', () => {
    missionControlState.current.currentUser = { role: 'viewer' }
    projectWorkspaceState.current.project = {
      id: 4,
      slug: 'alpha',
      gsd_enabled: 1,
      gsd_phase: 'plan',
    }
    missionControlState.current.tasks = [
      { id: 21, project_id: 4, gsd_phase: 'plan', gate_required: 0, status: 'in_progress', title: 'Design', ticket_ref: 'A-21' },
    ]
    render(<LifecycleView />)
    // PhaseTimeline list renders
    const lists = screen.getAllByRole('list')
    expect(lists.length).toBeGreaterThanOrEqual(1)
    // No advance / bootstrap buttons visible to viewers
    expect(screen.queryByRole('button', { name: /lifecycle\.cta\.advance/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /lifecycle\.cta\.bootstrap/ })).toBeNull()
  })
})
