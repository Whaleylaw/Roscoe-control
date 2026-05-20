import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WaypointReviewTab } from '../waypoint-review-tab'

function okJson(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data })
}

describe('WaypointReviewTab', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('renders completed referral-package runtime summary and artifacts from route events', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/projects/7/waypoint/routes/42') {
        return okJson({
          ok: true,
          route: {
            id: 42,
            status: 'complete',
            workflow_key: 'referral-package',
            definition_name: 'Referral Package',
            definition_slug: 'referral-package',
            definition_version: 1,
            started_at: 1_800_000_000,
            completed_at: 1_800_000_120,
            updated_at: 1_800_000_120,
          },
          vars: { case_root: '/cases/abby', package_slug: 'referral-package' },
          nodes: [
            { id: 1, node_key: 'start-here', node_type: 'task', status: 'complete', recipe_slug: 'referral-package-start-here-builder', task_id: 99 },
          ],
          node_count: 1,
        })
      }
      if (url === '/api/projects/7/waypoint/routes/42/events?limit=25') {
        return okJson({
          ok: true,
          events: [
            {
              id: 10,
              event_type: 'waypoint.local_package.completed',
              actor_id: 'runner',
              node_key: 'start-here',
              task_id: 99,
              payload_json: JSON.stringify({
                status: 'ok',
                recipe_slug: 'referral-package-start-here-builder',
                summary: 'Built START_HERE and referral packet index.',
                artifacts: ['START_HERE.html', 'referral-package/index.json'],
              }),
              created_at: 1_800_000_120,
            },
          ],
          count: 1,
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WaypointReviewTab projectId={7} routeId={42} />)

    expect(await screen.findByText('Referral Package')).toBeInTheDocument()
    expect(screen.getAllByText('complete').length).toBeGreaterThan(0)
    expect(screen.getByText('Built START_HERE and referral packet index.')).toBeInTheDocument()
    expect(screen.getByText('START_HERE.html')).toBeInTheDocument()
    expect(screen.getByText('referral-package/index.json')).toBeInTheDocument()
    expect(screen.getAllByText('referral-package-start-here-builder').length).toBeGreaterThan(0)
  })

  it('renders blockers and posts an approve gate action for blocked handoff nodes', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/projects/7/waypoint/routes/42') {
        return okJson({
          ok: true,
          route: {
            id: 42,
            status: 'blocked',
            workflow_key: 'referral-package',
            definition_name: 'Referral Package',
            definition_slug: 'referral-package',
            definition_version: 1,
            started_at: 1_800_000_000,
            completed_at: null,
            updated_at: 1_800_000_120,
          },
          vars: { case_root: '/cases/abby', package_slug: 'referral-package' },
          nodes: [
            { id: 2, node_key: 'handoff-qc', node_type: 'review_gate', status: 'blocked', recipe_slug: null, task_id: null },
          ],
        })
      }
      if (url === '/api/projects/7/waypoint/routes/42/events?limit=25') {
        return okJson({
          ok: true,
          events: [
            {
              id: 11,
              event_type: 'waypoint.local_package.blocked',
              actor_id: 'runner',
              node_key: 'handoff-qc',
              task_id: 99,
              payload_json: JSON.stringify({
                status: 'blocked',
                recipe_slug: 'referral-package-package-qc',
                summary: 'Package build needs owner artifacts.',
                missing_artifacts: ['medical-records/2026-01-01.pdf'],
                artifacts: ['START_HERE.html'],
              }),
              created_at: 1_800_000_120,
            },
          ],
        })
      }
      if (url === '/api/projects/7/waypoint/routes/42/gate' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ node_key: 'handoff-qc', decision: 'approve', note: 'Operator approved in Mission Control.' })
        return okJson({ ok: true, action: 'approve_gate', route: { id: 42, status: 'active' }, node: { node_key: 'handoff-qc', status: 'complete' } })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WaypointReviewTab projectId={7} routeId={42} />)

    expect(await screen.findByText('Package build needs owner artifacts.')).toBeInTheDocument()
    expect(screen.getByText('medical-records/2026-01-01.pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /approve handoff-qc/i }))
    expect(await screen.findByText('Gate approved. Refresh route state to continue review.')).toBeInTheDocument()
  })
})
