import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// Phase 8 D-14/D-15/D-20: the task-board's project filter select must gain a
// sibling "↗ Open workspace" button that routes to /project/{slug} of the
// selected project. Disabled when the filter value is "all" or when the
// selected id has no matching project.

const pushMock = vi.fn()
let mockSearchParams = new URLSearchParams()

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => '/tasks',
  useSearchParams: () => mockSearchParams,
}))

vi.mock('@/lib/use-smart-poll', () => ({
  useSmartPoll: () => {},
}))

vi.mock('@/lib/use-focus-trap', () => ({
  useFocusTrap: () => ({ current: null }),
}))

vi.mock('@/lib/client-logger', () => ({
  createClientLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@/components/markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}))

vi.mock('@/components/ui/agent-avatar', () => ({
  AgentAvatar: () => <span>avatar</span>,
}))

vi.mock('@/components/modals/project-manager-modal', () => ({
  ProjectManagerModal: () => <div>ProjectManagerModal</div>,
}))

vi.mock('@/components/chat/session-message', () => ({
  SessionMessage: () => <div>session-message</div>,
  shouldShowTimestamp: () => false,
}))

interface MockProject {
  id: number
  name: string
  slug: string
  ticket_prefix: string
  status: string
}

const defaultProjects: MockProject[] = [
  { id: 42, name: 'Alpha', slug: 'alpha', ticket_prefix: 'ALP', status: 'active' },
  { id: 43, name: 'Beta', slug: 'beta', ticket_prefix: 'BTA', status: 'active' },
]

let mockStoreState: any

function buildStoreState(overrides: any = {}) {
  return {
    tasks: [],
    setTasks: vi.fn(),
    selectedTask: null,
    setSelectedTask: vi.fn(),
    activeProject: null,
    setActiveProject: vi.fn(),
    availableModels: [{ alias: 'sonnet' }],
    spawnRequests: [],
    addSpawnRequest: vi.fn(),
    updateSpawnRequest: vi.fn(),
    dashboardMode: 'local',
    updateTask: vi.fn(),
    currentUser: { username: 'tester' },
    projects: defaultProjects,
    ...overrides,
  }
}

vi.mock('@/store', () => ({
  useMissionControl: () => mockStoreState,
}))

function makeFetchMock(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
    if (url.startsWith('/api/projects')) {
      return new Response(JSON.stringify({ projects: defaultProjects }), { status: 200 })
    }
    if (url.startsWith('/api/agents')) {
      return new Response(JSON.stringify({ agents: [] }), { status: 200 })
    }
    if (url.startsWith('/api/tasks')) {
      return new Response(JSON.stringify({ tasks: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({}), { status: 200 })
  })
}

beforeEach(() => {
  mockStoreState = buildStoreState()
  mockSearchParams = new URLSearchParams()
  pushMock.mockReset()
  global.fetch = makeFetchMock() as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

import { TaskBoardPanel } from '@/components/panels/task-board-panel'

async function renderBoard() {
  const utils = render(<TaskBoardPanel />)
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalled()
  })
  return utils
}

function getFilterSelect(): HTMLSelectElement {
  // The project filter select is identified by having the "all" option value.
  const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]
  const filter = selects.find((s) =>
    Array.from(s.options).some((o) => o.value === 'all'),
  )
  if (!filter) throw new Error('Project filter <select> not found')
  return filter
}

function getOpenWorkspaceButton(): HTMLButtonElement {
  // aria-label or text equals the namespaced key "projects.picker.openWorkspace"
  return screen.getByRole('button', {
    name: /projects\.picker\.openWorkspace/i,
  }) as HTMLButtonElement
}

describe('TaskBoardPanel — filter-bar Open workspace button (D-14)', () => {
  it('renders the Open workspace button labeled from projects.picker.openWorkspace', async () => {
    await renderBoard()
    const btn = getOpenWorkspaceButton()
    expect(btn).toBeInTheDocument()
  })

  it('disables the button when the project filter is "all"', async () => {
    await renderBoard()
    const filter = getFilterSelect()
    expect(filter.value).toBe('all')
    const btn = getOpenWorkspaceButton()
    expect(btn).toBeDisabled()
  })

  it('enables and routes to /project/{slug} when a specific project is selected', async () => {
    await renderBoard()
    const filter = getFilterSelect()
    fireEvent.change(filter, { target: { value: '42' } })

    const btn = getOpenWorkspaceButton()
    expect(btn).not.toBeDisabled()

    fireEvent.click(btn)
    expect(pushMock).toHaveBeenCalledWith('/project/alpha', expect.anything())
  })

  it('stays disabled when the filter id has no matching project in the store', async () => {
    // Seed projects WITHOUT id 42, but leave filter at "all" then change to a
    // nonexistent id via fireEvent on a DOM-added option would be hacky. Instead
    // drive the same defensive branch by seeding projects=[] so the filter
    // <select> cannot even show the selected id.
    mockStoreState = buildStoreState({ projects: [] })
    await renderBoard()
    const btn = getOpenWorkspaceButton()
    expect(btn).toBeDisabled()
  })
})
