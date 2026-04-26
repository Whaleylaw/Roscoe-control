import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LawFirmCaseWorkspace } from '../case-workspace'

const nav = vi.hoisted(() => ({
  pathname: '/law-firm/case/colleen-colvin',
  push: vi.fn(),
}))

const translate = vi.hoisted(() => (key: string) => key)

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => translate,
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
    medical_providers: [
      {
        slug: 'uofl-orthopedics',
        name: 'UofL Orthopedics',
        role: 'treating_provider',
        treatment_status: 'Treatment Complete',
        records_requested: false,
        records_received: false,
        bills_requested: false,
        bills_received: false,
        records_requested_date: null,
        records_received_date: null,
        bills_requested_date: null,
        bills_received_date: null,
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
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          result: {
            started: [{ workflow_instance_id: 9, definition_slug: 'firmvault-request-medical-records' }],
            skipped: [],
            materialized: [{ created: [{ task_id: 99, node_key: 'verify_medical_authorization' }] }],
          },
          workflow_instances: [
            {
              workflow_instance_id: 9,
              workflow_key: 'firmvault-request-medical-records:law_firm_case:colleen-colvin:provider_slug=uofl-orthopedics',
              definition_slug: 'firmvault-request-medical-records',
              definition_name: 'Request Medical Records',
              definition_version: 2,
              vars: { provider_slug: 'uofl-orthopedics', provider_name: 'UofL Orthopedics' },
              status: 'active',
              started_by: 'tester',
              started_at: 1000,
              completed_at: null,
              updated_at: 1000,
              total_nodes: 2,
              ready_nodes: 0,
              running_nodes: 1,
              waiting_nodes: 0,
              blocked_nodes: 0,
              complete_nodes: 0,
              failed_nodes: 0,
              task_count: 1,
              nodes: [],
            },
          ],
          medical_providers: caseDetail.dashboard.medical_providers,
        }), { status: 201 })
      }
      if (init?.method === 'PATCH') {
        const requestBody = JSON.parse(String(init.body || '{}')) as { action?: string }
        if (requestBody.action === 'bypass_node') {
          return new Response(JSON.stringify({
            workflow_instances: [
              {
                workflow_instance_id: 7,
                workflow_key: 'firmvault-request-medical-records:law_firm_case:colleen-colvin',
                definition_slug: 'firmvault-request-medical-records',
                definition_name: 'Request Medical Records',
                definition_version: 2,
                status: 'complete',
                started_by: 'tester',
                started_at: 1000,
                completed_at: 1700000001,
                updated_at: 1700000001,
                total_nodes: 1,
                ready_nodes: 0,
                running_nodes: 0,
                waiting_nodes: 0,
                blocked_nodes: 0,
                complete_nodes: 0,
                failed_nodes: 0,
                task_count: 1,
                nodes: [
                  {
                    id: 71,
                    node_key: 'wait_for_records',
                    node_type: 'wait',
                    status: 'skipped',
                    recipe_slug: null,
                    task_id: null,
                    due_at: 1700000000,
                    completed_at: 1700000001,
                    blocked_by: [],
                  },
                ],
              },
            ],
          }))
        }
        return new Response(JSON.stringify({
          workflow_instances: [
            {
              workflow_instance_id: 7,
              workflow_key: 'firmvault-request-medical-records:law_firm_case:colleen-colvin',
              definition_slug: 'firmvault-request-medical-records',
              definition_name: 'Request Medical Records',
              definition_version: 2,
              status: 'cancelled',
              started_by: 'tester',
              started_at: 1000,
              completed_at: 1700000000,
              updated_at: 1700000000,
              total_nodes: 2,
              ready_nodes: 0,
              running_nodes: 0,
              waiting_nodes: 0,
              blocked_nodes: 0,
              complete_nodes: 0,
              failed_nodes: 0,
              task_count: 1,
              nodes: [],
            },
          ],
        }))
      }
      return new Response(JSON.stringify({
        workflow_instances: [
          {
            workflow_instance_id: 7,
            workflow_key: 'firmvault-request-medical-records:law_firm_case:colleen-colvin',
            definition_slug: 'firmvault-request-medical-records',
            definition_name: 'Request Medical Records',
            definition_version: 2,
            vars: { provider_slug: 'foundation-radiology', provider_name: 'Foundation Radiology' },
            status: 'active',
            started_by: 'tester',
            started_at: 1000,
            completed_at: null,
            updated_at: 1000,
            total_nodes: 2,
            ready_nodes: 0,
            running_nodes: 1,
            waiting_nodes: 1,
            blocked_nodes: 0,
            complete_nodes: 0,
            failed_nodes: 0,
            task_count: 1,
            nodes: [
              {
                id: 71,
                node_key: 'wait_for_records',
                node_type: 'wait',
                status: 'waiting',
                recipe_slug: null,
                task_id: null,
                due_at: 1700000000,
                completed_at: null,
                blocked_by: ['timer due 2023-11-14T22:13:20.000Z'],
              },
            ],
          },
        ],
        medical_providers: caseDetail.dashboard.medical_providers,
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

    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(screen.getByText('Request Medical Records')).toBeTruthy()
    expect(document.body.textContent).toContain('due')
    expect(document.body.textContent).toContain('Blocked by: timer due 2023-11-14T22:13:20.000Z')
    expect(screen.getByText('identify liens')).toBeTruthy()
    expect(screen.getByText('open liens')).toBeTruthy()
  })

  it('can start the provider-scoped medical records workflow from the workflow tab', async () => {
    nav.pathname = '/law-firm/case/colleen-colvin/workflow'
    render(<LawFirmCaseWorkspace />)

    await waitFor(() => expect(screen.getByText('UofL Orthopedics')).toBeTruthy())
    fireEvent.click(screen.getByText('Start Records'))

    await waitFor(() => expect(document.body.textContent).toContain('Medical records workflow started'))
    expect(fetch).toHaveBeenCalledWith(
      '/api/law-firm/cases/colleen-colvin/workflow',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('start_provider_medical_records'),
      }),
    )
    expect(document.body.textContent).toContain('Provider: UofL Orthopedics')
  })

  it('can cancel an active workflow instance from the workflow tab', async () => {
    nav.pathname = '/law-firm/case/colleen-colvin/workflow'
    render(<LawFirmCaseWorkspace />)

    await waitFor(() => expect(screen.getByText('Request Medical Records')).toBeTruthy())
    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => expect(document.body.textContent).toContain('Workflow instance cancelled'))
    expect(fetch).toHaveBeenCalledWith(
      '/api/law-firm/cases/colleen-colvin/workflow',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('cancel_instance'),
      }),
    )
    expect(document.body.textContent).toContain('cancelled')
  })

  it('can mark an instance node not applicable from the workflow tab', async () => {
    nav.pathname = '/law-firm/case/colleen-colvin/workflow'
    render(<LawFirmCaseWorkspace />)

    await waitFor(() => expect(screen.getByText('Request Medical Records')).toBeTruthy())
    fireEvent.click(screen.getByText('Not Applicable'))

    await waitFor(() => expect(document.body.textContent).toContain('Workflow node marked not applicable'))
    expect(fetch).toHaveBeenCalledWith(
      '/api/law-firm/cases/colleen-colvin/workflow',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('bypass_node'),
      }),
    )
    await waitFor(() => expect(document.body.textContent).toContain('skipped'))
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
