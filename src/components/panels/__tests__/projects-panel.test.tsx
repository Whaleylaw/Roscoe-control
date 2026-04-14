import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { Mock } from 'vitest'

// ─── Module mocks ────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/store', () => ({
  useMissionControl: vi.fn(),
}))

vi.mock('@/components/modals/project-manager-modal', () => ({
  ProjectManagerModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="project-manager-modal" onClick={onClose}>
      modal
    </div>
  ),
}))

import { ProjectsPanel } from '../projects-panel'
import { useMissionControl } from '@/store'

interface MockProject {
  id: number
  name: string
  slug: string
  ticket_prefix: string
  status: string
  deadline?: number
  last_activity_at?: number
  color?: string
}

const fixtureA: MockProject = {
  id: 1,
  name: 'Alpha',
  slug: 'alpha',
  ticket_prefix: 'ALP',
  status: 'active',
  deadline: 1_800_000_000, // unix seconds
}

const fixtureB: MockProject = {
  id: 2,
  name: 'Beta',
  slug: 'beta',
  ticket_prefix: 'BTA',
  status: 'active',
  last_activity_at: 1_700_000_000_000, // unix ms
}

const fixtureArchived: MockProject = {
  id: 3,
  name: 'Gamma',
  slug: 'gamma',
  ticket_prefix: 'GMA',
  status: 'archived',
}

function setStore(projects: MockProject[]) {
  const fetchProjectsSpy = vi.fn()
  ;(useMissionControl as unknown as Mock).mockReturnValue({
    projects,
    fetchProjects: fetchProjectsSpy,
  })
  return fetchProjectsSpy
}

beforeEach(() => {
  pushMock.mockClear()
  ;(useMissionControl as unknown as Mock).mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ProjectsPanel', () => {
  it('renders one clickable row per active project', () => {
    setStore([fixtureA, fixtureB])
    render(<ProjectsPanel />)
    const rows = screen.getAllByRole('button', { name: /alpha|beta/i })
    // Two project rows (empty-state CTA doesn't match alpha/beta regex)
    expect(rows).toHaveLength(2)
  })

  it('each row displays project name, status text, and ticket prefix', () => {
    setStore([fixtureA])
    render(<ProjectsPanel />)
    const row = screen.getByRole('button', { name: /alpha/i })
    expect(row.textContent).toContain('Alpha')
    expect(row.textContent?.toLowerCase()).toContain('active')
    expect(row.textContent).toContain('ALP')
  })

  it('navigates to /project/{slug} when a row is clicked', () => {
    setStore([fixtureA])
    render(<ProjectsPanel />)
    const row = screen.getByRole('button', { name: /alpha/i })
    fireEvent.click(row)
    expect(pushMock).toHaveBeenCalledWith('/project/alpha', expect.anything())
  })

  it('renders empty-state message and CTA that opens the project-manager modal', () => {
    setStore([])
    render(<ProjectsPanel />)
    // Empty title from t('empty.title') — mock returns the key verbatim
    expect(screen.getByText(/empty\.title/i)).toBeTruthy()
    const cta = screen.getByRole('button', { name: /empty\.cta/i })
    fireEvent.click(cta)
    expect(screen.getByTestId('project-manager-modal')).toBeTruthy()
  })

  it('renders deadline meta when deadline present, last-activity otherwise', () => {
    setStore([fixtureA, fixtureB])
    render(<ProjectsPanel />)
    const rowA = screen.getByRole('button', { name: /alpha/i })
    const rowB = screen.getByRole('button', { name: /beta/i })
    // Fixture A has deadline: meta slot should include deadline label key
    expect(rowA.textContent).toMatch(/row\.deadlineLabel/)
    // Fixture B has last_activity_at only: meta slot should include last-activity label
    expect(rowB.textContent).toMatch(/row\.lastActivityLabel/)
  })

  it('keyboard Enter on a focused row triggers navigation', () => {
    setStore([fixtureA])
    render(<ProjectsPanel />)
    const row = screen.getByRole('button', { name: /alpha/i })
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(pushMock).toHaveBeenCalledWith('/project/alpha', expect.anything())
  })

  it('filters out archived projects', () => {
    setStore([fixtureA, fixtureB, fixtureArchived])
    render(<ProjectsPanel />)
    expect(screen.queryByRole('button', { name: /gamma/i })).toBeNull()
    expect(screen.getByRole('button', { name: /alpha/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /beta/i })).toBeTruthy()
  })

  it("renders a 'New project' button in the header", () => {
    setStore([fixtureA])
    render(<ProjectsPanel />)
    // Header CTA is keyed by header.cta — the mock returns the key verbatim,
    // so disambiguating via name regex cleanly separates it from row buttons.
    const headerCta = screen.getByRole('button', { name: /header\.cta/i })
    expect(headerCta).toBeTruthy()
    const rowButton = screen.getByRole('button', { name: /alpha/i })
    // The header CTA must NOT be the same DOM node as the row button.
    expect(headerCta).not.toBe(rowButton)
  })

  it("header 'New project' button opens ProjectManagerModal", () => {
    setStore([fixtureA])
    render(<ProjectsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /header\.cta/i }))
    expect(screen.getByTestId('project-manager-modal')).toBeTruthy()
  })

  it('header CTA onClose triggers fetchProjects', () => {
    const fetchSpy = setStore([fixtureA])
    render(<ProjectsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /header\.cta/i }))
    // The mocked modal invokes onClose when clicked.
    fireEvent.click(screen.getByTestId('project-manager-modal'))
    expect(fetchSpy).toHaveBeenCalled()
  })
})
