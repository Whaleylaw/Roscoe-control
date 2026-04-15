import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { Mock } from 'vitest'

// ─── Module mocks ────────────────────────────────────────────────────
//
// Scope: the Projects nav item (placement, click-nav, essential-mode
// visibility). We intentionally don't test every other nav item.

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))

vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span data-testid="mock-image" aria-label={alt} />,
}))

const navigateToPanelMock = vi.fn()
vi.mock('@/lib/navigation', () => ({
  useNavigateToPanel: () => navigateToPanelMock,
  usePrefetchPanel: () => vi.fn(),
}))

vi.mock('@/lib/plugins', () => ({
  getPluginNavItems: () => [],
}))

vi.mock('@/lib/version', () => ({
  APP_VERSION: '0.0.0-test',
}))

vi.mock('@/store', () => ({
  useMissionControl: vi.fn(),
}))

import { NavRail } from '../nav-rail'
import { useMissionControl } from '@/store'

interface StoreOverrides {
  interfaceMode?: 'full' | 'essential'
  dashboardMode?: 'full' | 'local'
  sidebarExpanded?: boolean
}

function mountStore(overrides: StoreOverrides = {}) {
  ;(useMissionControl as unknown as Mock).mockReturnValue({
    activeTab: 'overview',
    connection: { isConnected: true, sseConnected: true, url: '' },
    dashboardMode: overrides.dashboardMode ?? 'full',
    currentUser: { role: 'admin', username: 'tester' },
    activeTenant: null,
    tenants: [],
    osUsers: [],
    setActiveTenant: vi.fn(),
    fetchTenants: vi.fn(),
    fetchOsUsers: vi.fn(),
    activeProject: null,
    projects: [],
    setActiveProject: vi.fn(),
    fetchProjects: vi.fn(),
    sidebarExpanded: overrides.sidebarExpanded ?? true,
    collapsedGroups: [] as string[],
    toggleSidebar: vi.fn(),
    toggleGroup: vi.fn(),
    defaultOrgName: 'MC',
    interfaceMode: overrides.interfaceMode ?? 'full',
    setInterfaceMode: vi.fn(),
  })
}

beforeEach(() => {
  navigateToPanelMock.mockClear()
  ;(useMissionControl as unknown as Mock).mockReset()
})

afterEach(() => {
  cleanup()
})

describe('NavRail Projects item', () => {
  it('renders a Projects button in full interface mode', () => {
    mountStore({ interfaceMode: 'full' })
    render(<NavRail />)
    // Desktop sidebar is the primary surface; button labels come from
    // the translation key `projects` (mock returns keys verbatim).
    const projectsButtons = screen.getAllByRole('button', { name: /^projects$/i })
    expect(projectsButtons.length).toBeGreaterThan(0)
  })

  it('Projects nav item appears before Tasks in DOM order', () => {
    mountStore({ interfaceMode: 'full' })
    const { container } = render(<NavRail />)
    const nav = container.querySelector('nav[aria-label="Main navigation"]')
    expect(nav).toBeTruthy()
    const buttons = Array.from(nav!.querySelectorAll('button')) as HTMLButtonElement[]
    const labels = buttons.map((b) => b.textContent?.trim() || '')
    const projectsIdx = labels.findIndex((l) => /^projects$/i.test(l))
    const tasksIdx = labels.findIndex((l) => /^tasks$/i.test(l))
    expect(projectsIdx).toBeGreaterThanOrEqual(0)
    expect(tasksIdx).toBeGreaterThanOrEqual(0)
    expect(projectsIdx).toBeLessThan(tasksIdx)
  })

  it('invokes navigateToPanel("projects") when the Projects item is clicked', () => {
    mountStore({ interfaceMode: 'full' })
    const { container } = render(<NavRail />)
    const nav = container.querySelector('nav[aria-label="Main navigation"]')
    const projectsBtn = within(nav as HTMLElement).getAllByRole('button', {
      name: /^projects$/i,
    })[0]
    fireEvent.click(projectsBtn)
    expect(navigateToPanelMock).toHaveBeenCalledWith('projects')
  })

  it('Projects item remains visible in essential interface mode', () => {
    mountStore({ interfaceMode: 'essential' })
    render(<NavRail />)
    const projectsButtons = screen.getAllByRole('button', { name: /^projects$/i })
    expect(projectsButtons.length).toBeGreaterThan(0)
  })
})
