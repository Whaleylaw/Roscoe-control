import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `rollups.${key}`,
}))

import { LifecycleHierarchy } from '@/components/project/lifecycle/lifecycle-hierarchy'

function makeProps() {
  return {
    rollups: {
      active_workstreams: 1,
      active_milestones: 1,
      active_phases: 1,
      in_progress_plans: 1,
      blocked_gates: 0,
      wave_conflicts: 0,
    },
    workstreams: [
      {
        id: 10,
        key: 'CORE',
        name: 'Core platform',
        status: 'active',
        updated_at: 111,
        milestones: [
          {
            id: 20,
            version_label: 'v1.2',
            title: 'Hierarchy UI',
            status: 'active',
            workstream_id: 10,
            updated_at: 222,
            phases: [
              {
                id: 30,
                phase_key: 'phase-10-ui',
                phase_slug: 'hierarchy-ui',
                lifecycle_phase: 'discuss',
                ordering_numeric: 1,
                status: 'planned',
                depends_on_phase_ids: '[]',
                updated_at: 333,
                plans: [
                  {
                    id: 40,
                    plan_ref: 'P10-UI-01',
                    title: 'Render lifecycle graph',
                    wave: 1,
                    status: 'todo',
                    depends_on_plan_ids: '[]',
                    updated_at: 444,
                  },
                  {
                    id: 41,
                    plan_ref: 'P10-UI-02',
                    title: 'QA polish',
                    wave: 1,
                    status: 'review',
                    depends_on_plan_ids: '[]',
                    updated_at: 445,
                  },
                ],
              },
              {
                id: 31,
                phase_key: 'phase-11-verify',
                phase_slug: 'verify-ui',
                lifecycle_phase: 'verify',
                ordering_numeric: 2,
                status: 'active',
                depends_on_phase_ids: '[]',
                updated_at: 334,
                plans: [
                  {
                    id: 42,
                    plan_ref: 'P11-UI-01',
                    title: 'Verification sweep',
                    wave: 2,
                    status: 'todo',
                    depends_on_plan_ids: '[]',
                    updated_at: 446,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 11,
        key: 'OPS',
        name: 'Operations lane',
        status: 'paused',
        updated_at: 112,
        milestones: [],
      },
    ],
    unscopedMilestones: [],
    isViewer: false,
    isRefreshing: false,
    onRefresh: vi.fn(),
    onCreateWorkstream: vi.fn().mockResolvedValue(undefined),
    onUpdateWorkstream: vi.fn().mockResolvedValue(undefined),
    onUpdateWorkstreamStatus: vi.fn().mockResolvedValue(undefined),
    onCompleteWorkstream: vi.fn().mockResolvedValue(undefined),
    onCreateMilestone: vi.fn().mockResolvedValue(undefined),
    onUpdateMilestone: vi.fn().mockResolvedValue(undefined),
    onUpdateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    onCompleteMilestone: vi.fn().mockResolvedValue(undefined),
    onCreatePhase: vi.fn().mockResolvedValue(undefined),
    onUpdatePhase: vi.fn().mockResolvedValue(undefined),
    onTransitionPhase: vi.fn().mockResolvedValue(undefined),
    onCreatePlan: vi.fn().mockResolvedValue(undefined),
    onUpdatePlan: vi.fn().mockResolvedValue(undefined),
    onTransitionPlan: vi.fn().mockResolvedValue(undefined),
  }
}

describe('LifecycleHierarchy', () => {
  it('creates a workstream from the inline form', async () => {
    const props = makeProps()
    render(<LifecycleHierarchy {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add workstream' }))
    fireEvent.change(screen.getByPlaceholderText('CORE'), { target: { value: 'API' } })
    fireEvent.change(screen.getByPlaceholderText('Core platform'), { target: { value: 'API reliability' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create workstream' }))

    await waitFor(() => {
      expect(props.onCreateWorkstream).toHaveBeenCalledWith({
        key: 'API',
        name: 'API reliability',
        status: 'active',
      })
    })
  })

  it('advances a phase and transitions a plan with optimistic-lock payloads', async () => {
    const props = makeProps()
    render(<LifecycleHierarchy {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Advance to Plan' }))
    await waitFor(() => {
      expect(props.onTransitionPhase).toHaveBeenCalledWith(30, {
        to_lifecycle_phase: 'plan',
        expected_updated_at: 333,
      })
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'In Progress' })[0])
    await waitFor(() => {
      expect(props.onTransitionPlan).toHaveBeenCalledWith(40, {
        to_status: 'in_progress',
        expected_updated_at: 444,
      })
    })
  })

  it('edits workstream metadata through the inline edit form', async () => {
    const props = makeProps()
    render(<LifecycleHierarchy {...props} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit details' })[0])
    fireEvent.change(screen.getByLabelText('Workstream key'), { target: { value: 'PLATFORM' } })
    fireEvent.change(screen.getByLabelText('Workstream name'), { target: { value: 'Platform systems' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => {
      expect(props.onUpdateWorkstream).toHaveBeenCalledWith(10, {
        key: 'PLATFORM',
        name: 'Platform systems',
        status: 'active',
        expected_updated_at: 111,
      })
    })
  })

  it('edits milestone, phase, and plan metadata with patch payloads', async () => {
    const props = makeProps()
    render(<LifecycleHierarchy {...props} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit details' })[1])
    fireEvent.change(screen.getByLabelText('Workstream'), { target: { value: '11' } })
    fireEvent.change(screen.getByLabelText('Milestone version'), { target: { value: 'v1.3' } })
    fireEvent.change(screen.getByLabelText('Milestone title'), { target: { value: 'Delivery UI' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => {
      expect(props.onUpdateMilestone).toHaveBeenCalledWith(20, {
        workstream_id: 11,
        version_label: 'v1.3',
        title: 'Delivery UI',
        status: 'active',
        expected_updated_at: 222,
      })
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit phase' })[0])
    fireEvent.change(screen.getByLabelText('Phase key'), { target: { value: 'phase-10-polish' } })
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save phase' }))

    await waitFor(() => {
      expect(props.onUpdatePhase).toHaveBeenCalledWith(30, {
        phase_key: 'phase-10-polish',
        phase_slug: 'hierarchy-ui',
        lifecycle_phase: 'discuss',
        ordering_numeric: 1,
        status: 'planned',
        depends_on_phase_ids: [31],
        expected_updated_at: 333,
      })
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit plan' })[0])
    fireEvent.change(screen.getByLabelText('Plan ref'), { target: { value: 'P10-UI-09' } })
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))

    await waitFor(() => {
      expect(props.onUpdatePlan).toHaveBeenCalledWith(40, {
        plan_ref: 'P10-UI-09',
        title: 'Render lifecycle graph',
        wave: 1,
        status: 'todo',
        depends_on_plan_ids: [41],
        expected_updated_at: 444,
      })
    })
  })

  it('viewer mode hides create and mutation controls', () => {
    const props = {
      ...makeProps(),
      isViewer: true,
    }
    render(<LifecycleHierarchy {...props} />)

    expect(screen.queryByRole('button', { name: 'Add workstream' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Advance to Plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'In Progress' })).toBeNull()
  })
})
