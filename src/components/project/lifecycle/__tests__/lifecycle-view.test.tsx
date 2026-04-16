import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

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

vi.mock('@/components/ui/loader', () => ({
  Loader: () => <div data-testid="loader" />,
}))

const fetchSpy = vi.fn()
let eventSourceInstance: {
  onmessage: ((event: { data: string }) => void) | null
  close: ReturnType<typeof vi.fn>
} | null = null

import { LifecycleView } from '@/components/project/lifecycle/lifecycle-view'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  fetchSpy.mockReset()
  global.fetch = fetchSpy as unknown as typeof fetch
  eventSourceInstance = null
  vi.stubGlobal('EventSource', class {
    onmessage: ((event: { data: string }) => void) | null = null
    close = vi.fn()
    constructor(_url: string) {
      eventSourceInstance = this
    }
  })
  projectWorkspaceState.current.project = null
  missionControlState.current.tasks = []
  missionControlState.current.currentUser = { role: 'operator' }
  missionControlState.current.fetchProjects = vi.fn().mockResolvedValue(undefined)
})

function mockGraphResponse(payload: Record<string, unknown>) {
  fetchSpy.mockResolvedValue({
    ok: true,
    json: async () => payload,
  } as Response)
}

describe('LifecycleView (Phase 10)', () => {
  it('renders translated title via useTranslations("project.lifecycle")', () => {
    projectWorkspaceState.current.project = {
      id: 3,
      slug: 'alpha',
      gsd_enabled: 0,
    }
    render(<LifecycleView />)
    expect(screen.getAllByText('lifecycle.title').length).toBeGreaterThanOrEqual(1)
  })

  it('gsd_enabled=0 renders non-gsd empty state and does not fetch lifecycle graph', () => {
    projectWorkspaceState.current.project = {
      id: 3,
      slug: 'alpha',
      gsd_enabled: 0,
    }
    render(<LifecycleView />)
    expect(screen.getByText('lifecycle.empty.heading')).toBeTruthy()
    expect(screen.getByRole('button', { name: /lifecycle\.cta\.enable/ })).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('gsd_enabled=1 with no hierarchy and no legacy fallback renders bootstrap empty state', async () => {
    projectWorkspaceState.current.project = {
      id: 7,
      slug: 'alpha',
      gsd_enabled: 1,
      gsd_phase: 'discuss',
    }
    missionControlState.current.tasks = [
      { id: 1, project_id: 7, gsd_phase: null, gate_required: 0, status: 'inbox', title: 'x' },
    ]
    mockGraphResponse({
      rollups: {
        active_workstreams: 0,
        active_milestones: 0,
        active_phases: 0,
        in_progress_plans: 0,
        blocked_gates: 0,
        wave_conflicts: 0,
      },
      workstreams: [],
      unscopedMilestones: [],
      legacy: {
        enabled: false,
        current_phase: 'discuss',
        track: null,
        gate_mode: null,
        task_counts: [],
        fallback_active: false,
      },
    })

    render(<LifecycleView />)

    await waitFor(() => {
      expect(screen.getByText('lifecycle.empty.notBootstrapped.heading')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: /lifecycle\.cta\.bootstrap/ })).toBeTruthy()
  })

  it('hierarchy graph renders workstreams, milestones, phases, plans, and rollups', async () => {
    projectWorkspaceState.current.project = {
      id: 2,
      slug: 'alpha',
      gsd_enabled: 1,
      gsd_phase: 'execute',
    }
    missionControlState.current.tasks = [
      { id: 12, project_id: 2, gsd_phase: 'execute', gate_required: 1, gate_status: 'pending', status: 'review', title: 'Approve', ticket_ref: 'A-12' },
    ]
    mockGraphResponse({
      rollups: {
        active_workstreams: 1,
        active_milestones: 1,
        active_phases: 1,
        in_progress_plans: 1,
        blocked_gates: 1,
        wave_conflicts: 0,
      },
      workstreams: [
        {
          id: 10,
          key: 'CORE',
          name: 'Core platform',
          status: 'active',
          milestones: [
            {
              id: 20,
              version_label: 'v1.2',
              title: 'Hierarchy UI',
              status: 'active',
              phases: [
                {
                  id: 30,
                  phase_key: 'phase-10-ui',
                  phase_slug: 'hierarchy-ui',
                  lifecycle_phase: 'execute',
                  ordering_numeric: 2,
                  status: 'active',
                  depends_on_phase_ids: '[11]',
                  plans: [
                    {
                      id: 40,
                      plan_ref: 'P10-UI-01',
                      title: 'Render lifecycle graph',
                      wave: 1,
                      status: 'in_progress',
                      depends_on_plan_ids: '[]',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      unscopedMilestones: [
        {
          id: 21,
          version_label: 'v1.2.1',
          title: 'Unscoped cleanup',
          status: 'planned',
          phases: [],
        },
      ],
      legacy: {
        enabled: true,
        current_phase: 'execute',
        track: 'product',
        gate_mode: 'manual_approval',
        task_counts: [],
        fallback_active: false,
      },
    })

    render(<LifecycleView />)

    await waitFor(() => {
      expect(screen.getByText('Hierarchy rollups')).toBeTruthy()
    })

    expect(screen.getByText('Workstreams')).toBeTruthy()
    expect(screen.getByText('Core platform')).toBeTruthy()
    expect(screen.getByText('Hierarchy UI')).toBeTruthy()
    expect(screen.getByText('phase-10-ui')).toBeTruthy()
    expect(screen.getByText('Render lifecycle graph')).toBeTruthy()
    expect(screen.getByText('Project milestones')).toBeTruthy()
    expect(screen.getByText('Unscoped cleanup')).toBeTruthy()
    expect(screen.getByText('lifecycle.gateTasks')).toBeTruthy()
  })

  it('legacy fallback keeps the Phase 09 timeline surface active', async () => {
    projectWorkspaceState.current.project = {
      id: 4,
      slug: 'alpha',
      gsd_enabled: 1,
      gsd_phase: 'plan',
    }
    missionControlState.current.tasks = [
      { id: 21, project_id: 4, gsd_phase: 'plan', gate_required: 0, status: 'in_progress', title: 'Design', ticket_ref: 'A-21' },
    ]
    mockGraphResponse({
      rollups: {
        active_workstreams: 0,
        active_milestones: 0,
        active_phases: 0,
        in_progress_plans: 0,
        blocked_gates: 0,
        wave_conflicts: 0,
      },
      workstreams: [],
      unscopedMilestones: [],
      legacy: {
        enabled: true,
        current_phase: 'plan',
        track: 'product',
        gate_mode: 'manual_approval',
        task_counts: [{ phase: 'plan', count: 1 }],
        fallback_active: true,
      },
    })

    render(<LifecycleView />)

    await waitFor(() => {
      expect(screen.getByText('lifecycle.currentPhase')).toBeTruthy()
    })
    expect(screen.getAllByRole('list').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Hierarchy rollups')).toBeNull()
  })

  it('viewer role hides advance and bootstrap buttons in legacy fallback mode', async () => {
    missionControlState.current.currentUser = { role: 'viewer' }
    projectWorkspaceState.current.project = {
      id: 5,
      slug: 'alpha',
      gsd_enabled: 1,
      gsd_phase: 'plan',
    }
    missionControlState.current.tasks = [
      { id: 21, project_id: 5, gsd_phase: 'plan', gate_required: 0, status: 'in_progress', title: 'Design', ticket_ref: 'A-21' },
    ]
    mockGraphResponse({
      rollups: {
        active_workstreams: 0,
        active_milestones: 0,
        active_phases: 0,
        in_progress_plans: 0,
        blocked_gates: 0,
        wave_conflicts: 0,
      },
      workstreams: [],
      unscopedMilestones: [],
      legacy: {
        enabled: true,
        current_phase: 'plan',
        track: 'product',
        gate_mode: 'manual_approval',
        task_counts: [{ phase: 'plan', count: 1 }],
        fallback_active: true,
      },
    })

    render(<LifecycleView />)

    await waitFor(() => {
      expect(screen.getByText('lifecycle.currentPhase')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /lifecycle\.cta\.advance/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /lifecycle\.cta\.bootstrap/ })).toBeNull()
  })

  it('refetches the lifecycle graph when a matching GSD SSE event arrives', async () => {
    projectWorkspaceState.current.project = {
      id: 2,
      slug: 'alpha',
      gsd_enabled: 1,
      gsd_phase: 'execute',
    }

    mockGraphResponse({
      rollups: {
        active_workstreams: 1,
        active_milestones: 1,
        active_phases: 1,
        in_progress_plans: 1,
        blocked_gates: 0,
        wave_conflicts: 0,
      },
      workstreams: [],
      unscopedMilestones: [],
      legacy: {
        enabled: true,
        current_phase: 'execute',
        track: 'product',
        gate_mode: 'manual_approval',
        task_counts: [],
        fallback_active: false,
      },
    })
    mockGraphResponse({
      rollups: {
        active_workstreams: 2,
        active_milestones: 1,
        active_phases: 1,
        in_progress_plans: 1,
        blocked_gates: 0,
        wave_conflicts: 0,
      },
      workstreams: [],
      unscopedMilestones: [],
      legacy: {
        enabled: true,
        current_phase: 'execute',
        track: 'product',
        gate_mode: 'manual_approval',
        task_counts: [],
        fallback_active: false,
      },
    })

    render(<LifecycleView />)
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(eventSourceInstance).not.toBeNull()
    })
    eventSourceInstance?.onmessage?.({
      data: JSON.stringify({
        type: 'gsd.phase.updated',
        data: { project_id: 2, phase_id: 30 },
        timestamp: Date.now(),
      }),
    })

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/projects/2/gsd/lifecycle-graph')
  })

  it('shows a conflict banner when a matching GSD conflict event arrives', async () => {
    projectWorkspaceState.current.project = {
      id: 2,
      slug: 'alpha',
      gsd_enabled: 1,
      gsd_phase: 'execute',
    }
    mockGraphResponse({
      rollups: {
        active_workstreams: 1,
        active_milestones: 1,
        active_phases: 1,
        in_progress_plans: 1,
        blocked_gates: 0,
        wave_conflicts: 0,
      },
      workstreams: [],
      unscopedMilestones: [],
      legacy: {
        enabled: true,
        current_phase: 'execute',
        track: 'product',
        gate_mode: 'manual_approval',
        task_counts: [],
        fallback_active: false,
      },
    })
    mockGraphResponse({
      rollups: {
        active_workstreams: 1,
        active_milestones: 1,
        active_phases: 1,
        in_progress_plans: 1,
        blocked_gates: 0,
        wave_conflicts: 0,
      },
      workstreams: [],
      unscopedMilestones: [],
      legacy: {
        enabled: true,
        current_phase: 'execute',
        track: 'product',
        gate_mode: 'manual_approval',
        task_counts: [],
        fallback_active: false,
      },
    })

    render(<LifecycleView />)
    await waitFor(() => {
      expect(eventSourceInstance).not.toBeNull()
    })
    eventSourceInstance?.onmessage?.({
      data: JSON.stringify({
        type: 'gsd.conflict.detected',
        data: { project_id: 2, code: 'PLAN_DEPENDENCY_BLOCKED', blocking_plan_ids: [41, 42] },
        timestamp: Date.now(),
      }),
    })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Plan is blocked by unfinished plan dependencies: 41, 42.')
    })
  })
})
