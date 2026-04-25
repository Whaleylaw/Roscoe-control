import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { LawFirmCaseWorkspace } from '../case-workspace'

const nav = vi.hoisted(() => ({
  pathname: '/law-firm/case/colleen-colvin',
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/panels/task-board-panel', () => ({
  TaskBoardPanel: ({ scope }: { scope: Record<string, unknown> }) => (
    <div data-testid="task-board" data-scope={JSON.stringify(scope)} />
  ),
}))

const caseSummary = {
  slug: 'colleen-colvin',
  name: 'Colleen Colvin',
  case_type: 'auto_accident',
  current_phase: 'phase_7_litigation',
  date_of_incident: '2023-10-01',
  jurisdiction: 'KY',
  legacy_id: '2023-10-01-MVA-001',
  activity_count: 2,
  document_count: 4,
  claim_count: 1,
  lien_count: 0,
  landmark_count: 2,
  satisfied_landmark_count: 1,
}

const caseDetail = {
  summary: caseSummary,
  dashboard: {
    claims: [
      {
        type: 'bodily_injury',
        carrier: 'Example Mutual',
        claim_number: 'BI-123',
        policy_limit: '$50,000',
        status: 'open',
      },
    ],
    recent_activity: [
      {
        file: 'Activity Log/2024-02-01-call.md',
        date: '2024-02-01',
        category: 'call',
        title: 'Client call',
        excerpt: 'Discussed treatment status.',
      },
    ],
  },
  state: {
    current_phase: 'phase_7_litigation',
    phases: [
      { key: 'phase_2_treatment', label: 'Treatment' },
      { key: 'phase_7_litigation', label: 'Litigation' },
    ],
    landmarks: [
      { key: 'client_info_received', label: 'Client Info Received', satisfied: true, satisfied_at: null, satisfied_by: null, evidence: null },
      { key: 'demand_sent', label: 'Demand Sent', satisfied: false, satisfied_at: null, satisfied_by: null, evidence: null },
    ],
  },
  files: [{ name: 'Dashboard.md', kind: 'markdown' }],
}

beforeEach(() => {
  nav.pathname = '/law-firm/case/colleen-colvin'
  nav.push.mockReset()
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString()
    if (href === '/api/law-firm/cases/colleen-colvin/task-project' && init?.method === 'POST') {
      return new Response(JSON.stringify({ project: { id: 42 } }))
    }
    if (href === '/api/law-firm/cases/colleen-colvin/workflow') {
      return new Response(JSON.stringify({
        ready_items: [],
        workflows: [
          {
            workflow_id: 'lien_resolution',
            name: 'Lien Identification and Resolution',
            goal: 'Identify, open, negotiate, and pay all liens before final distribution.',
            phase_id: 'lien_track',
            source: 'phase_6_lien/workflows/get_final_lien/workflow.md',
            enabled: true,
            status: 'active',
            completed_steps: 0,
            total_steps: 2,
            active_steps: 1,
            blocked_by: [],
            steps: [
              {
                id: 'identify_liens',
                type: 'recipe',
                landmark_id: 'liens_identified',
                recipe_slug: 'firmvault-workflow-task',
                status: 'ready',
                depends_on: [],
                blocked_by: [],
                wait_days: null,
                skip_when: [],
              },
              {
                id: 'open_liens',
                type: 'recipe',
                landmark_id: 'liens_opened',
                recipe_slug: 'firmvault-workflow-task',
                status: 'blocked',
                depends_on: ['identify_liens'],
                blocked_by: ['identify_liens'],
                wait_days: null,
                skip_when: [],
              },
            ],
          },
        ],
      }))
    }
    if (href === '/api/law-firm/cases/colleen-colvin' && init?.method === 'PATCH') {
      return new Response(JSON.stringify({ case: caseDetail }))
    }
    return new Response(JSON.stringify({ case: caseDetail }))
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LawFirmCaseWorkspace', () => {
  it('renders dashboard data parsed from FirmVault files', async () => {
    render(<LawFirmCaseWorkspace />)

    await waitFor(() => expect(screen.getByText('Colleen Colvin')).toBeTruthy())

    expect(fetch).toHaveBeenCalledWith('/api/law-firm/cases/colleen-colvin', { cache: 'no-store' })
    expect(document.body.textContent).toContain('Example Mutual')
    expect(screen.getByText('Client call')).toBeTruthy()
    expect(screen.getByText('Discussed treatment status.')).toBeTruthy()
  })

  it('renders workflow graph status from the workflow tab', async () => {
    nav.pathname = '/law-firm/case/colleen-colvin/workflow'
    render(<LawFirmCaseWorkspace />)

    await waitFor(() => expect(screen.getByText('Lien Identification and Resolution')).toBeTruthy())

    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('identify liens')).toBeTruthy()
    expect(screen.getByText('open liens')).toBeTruthy()
  })

  it('renders a task board scoped to the hidden case project', async () => {
    nav.pathname = '/law-firm/case/colleen-colvin/tasks'
    render(<LawFirmCaseWorkspace />)

    await waitFor(() => expect(screen.getByTestId('task-board')).toBeTruthy())

    expect(fetch).toHaveBeenCalledWith(
      '/api/law-firm/cases/colleen-colvin/task-project',
      { method: 'POST' },
    )
    expect(JSON.parse(screen.getByTestId('task-board').getAttribute('data-scope') || '{}')).toEqual({
      lockedProjectId: 42,
      hideProjectFilter: true,
      hideProjectLabels: true,
      includeHiddenProjects: true,
      defaultCreateProjectId: 42,
    })
  })
})
