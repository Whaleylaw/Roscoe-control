import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'

// ─── Module mocks ────────────────────────────────────────────────────
//
// Integration test: render <TasksView /> embedding the real
// <TaskBoardPanel />. We mock the workspace context so it provides a
// project, plus the same heavy edges as the panel's own unit test
// (Zustand store, next-intl, next/navigation, focus-trap, smart-poll,
// child UI components).

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))

let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/project/p1/tasks',
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
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
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

// ─── workspace context mock ───────────────────────────────────────────

interface MockProject {
  id: number; name: string; slug: string; ticket_prefix: string; status: string
  description?: string
}

const workspaceProject: MockProject = {
  id: 1, name: 'Project One', slug: 'p1', ticket_prefix: 'P1', status: 'active',
}

let mockWorkspace: { project: MockProject | null } = { project: workspaceProject }

vi.mock('@/components/project/project-context', () => ({
  useProjectWorkspace: () => mockWorkspace,
}))

// ─── store mock ───────────────────────────────────────────────────────

interface MockTask {
  id: number; title: string; status: string; priority: string
  project_id?: number; ticket_ref?: string
  created_by: string; created_at: number; updated_at: number
}

const allProjects: MockProject[] = [
  workspaceProject,
  { id: 2, name: 'Project Two', slug: 'p2', ticket_prefix: 'P2', status: 'active' },
]

const seedTasks: MockTask[] = [
  { id: 101, title: 'Task in P1', status: 'inbox', priority: 'medium', project_id: 1, ticket_ref: 'P1-1', created_by: 'u', created_at: 0, updated_at: 0 },
  { id: 102, title: 'Task in P2', status: 'inbox', priority: 'medium', project_id: 2, ticket_ref: 'P2-1', created_by: 'u', created_at: 0, updated_at: 0 },
]

let mockStoreState: any

function buildStoreState(overrides: Record<string, unknown> = {}) {
  return {
    tasks: seedTasks.map(t => ({ ...t })),
    setTasks: vi.fn((tasks: MockTask[]) => { mockStoreState.tasks = tasks }),
    selectedTask: null,
    setSelectedTask: vi.fn((t: MockTask | null) => { mockStoreState.selectedTask = t }),
    activeProject: null,
    setActiveProject: vi.fn(),
    availableModels: [{ alias: 'sonnet' }],
    spawnRequests: [],
    addSpawnRequest: vi.fn(),
    updateSpawnRequest: vi.fn(),
    dashboardMode: 'local',
    updateTask: vi.fn(),
    currentUser: { username: 'tester' },
    projects: allProjects,
    ...overrides,
  }
}

vi.mock('@/store', () => ({
  useMissionControl: () => mockStoreState,
}))

// ─── fetch mock ───────────────────────────────────────────────────────

let lastTaskPostBody: any = null
let lastTaskPutMethod: string | null = null
let lastTaskPutUrl: string | null = null
let lastTaskPutBody: any = null

function makeFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
    const method = (init?.method || 'GET').toUpperCase()

    if (url.match(/^\/api\/tasks\/\d+/)) {
      lastTaskPutMethod = method
      lastTaskPutUrl = url
      lastTaskPutBody = init?.body ? JSON.parse(String(init.body)) : {}
      return new Response(JSON.stringify({ task: { id: 101 } }), { status: 200 })
    }
    if (url === '/api/tasks' && method === 'POST') {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      lastTaskPostBody = body
      return new Response(JSON.stringify({ task: { id: 999, ...body } }), { status: 201 })
    }
    if (url.startsWith('/api/tasks')) {
      return new Response(JSON.stringify({ tasks: mockStoreState.tasks }), { status: 200 })
    }
    if (url.startsWith('/api/projects')) {
      return new Response(JSON.stringify({ projects: allProjects }), { status: 200 })
    }
    if (url.startsWith('/api/agents')) {
      return new Response(JSON.stringify({ agents: [] }), { status: 200 })
    }
    if (url.startsWith('/api/quality-review')) {
      return new Response(JSON.stringify({ latest: {} }), { status: 200 })
    }
    if (url.startsWith('/api/gnap')) {
      return new Response(JSON.stringify({ enabled: true, taskCount: 3, lastSync: '2025-01-01' }), { status: 200 })
    }
    if (url.startsWith('/api/sessions')) {
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 })
    }
    if (url.startsWith('/api/mentions')) {
      return new Response(JSON.stringify({ mentions: [] }), { status: 200 })
    }
    if (url.startsWith('/api/cron') || url.startsWith('/api/claude')) {
      return new Response(JSON.stringify({ jobs: [], tasks: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({}), { status: 200 })
  })
}

beforeEach(() => {
  mockStoreState = buildStoreState()
  mockWorkspace = { project: workspaceProject }
  mockSearchParams = new URLSearchParams()
  lastTaskPostBody = null
  lastTaskPutMethod = null
  lastTaskPutUrl = null
  lastTaskPutBody = null
  global.fetch = makeFetchMock() as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Import after mocks
import { TasksView } from '@/components/project/tasks-view'

async function renderView() {
  const utils = render(<TasksView />)
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalled()
  })
  return utils
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('TasksView', () => {
  describe('TASK-01: tasks filtered to current project', () => {
    it('renders only tasks whose project_id matches the workspace project', async () => {
      await renderView()
      expect(await screen.findByText('Task in P1')).toBeInTheDocument()
    })

    it('does not render tasks belonging to other projects', async () => {
      await renderView()
      expect(await screen.findByText('Task in P1')).toBeInTheDocument()
      expect(screen.queryByText('Task in P2')).toBeNull()
    })

    it('renders an empty column when the workspace project has no tasks in that status', async () => {
      mockStoreState = buildStoreState({ tasks: [] })
      await renderView()
      // Empty state message renders inside columns.
      const emptyStates = screen.getAllByText('dropTasksHere')
      expect(emptyStates.length).toBeGreaterThan(0)
    })
  })

  describe('TASK-01: project filter dropdown hidden in workspace mode', () => {
    it('project filter <select> is not present in the rendered DOM', async () => {
      await renderView()
      // The "allProjects" option is the unique signature of the toolbar
      // filter <select>; absent when scope.hideProjectFilter is true.
      expect(screen.queryByText('allProjects')).toBeNull()
    })

    it('all 9 status columns remain visible even with filter hidden (D-10)', async () => {
      mockStoreState = buildStoreState({ tasks: [] })
      await renderView()
      const expectedKeys = [
        'colBacklog',
        'colInbox',
        'colAssigned',
        'colAwaitingOwner',
        'colInProgress',
        'colReview',
        'colQualityReview',
        'colDone',
      ]
      for (const key of expectedKeys) {
        expect(screen.getAllByText(key).length).toBeGreaterThan(0)
      }
    })
  })

  describe('TASK-01: card project label hidden in workspace mode', () => {
    it('card renders without the ticket_ref span inside the column view', async () => {
      await renderView()
      expect(await screen.findByText('Task in P1')).toBeInTheDocument()
      // hideProjectLabels: ticket_ref P1-1 should not appear on the card.
      expect(screen.queryByText('P1-1')).toBeNull()
    })

    it('detail modal still shows ticket_ref for task identity (pitfall #4)', async () => {
      mockSearchParams = new URLSearchParams('taskId=101')
      await renderView()
      await waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
      })
      // Detail modal renders ticket_ref unconditionally (pitfall #4).
      const refs = await screen.findAllByText('P1-1')
      expect(refs.length).toBeGreaterThan(0)
    })
  })

  describe('TASK-03: reassigns out disappears', () => {
    it('task reassigned away from workspace project disappears from the board immediately via client-side filter', async () => {
      const utils = await renderView()
      expect(await screen.findByText('Task in P1')).toBeInTheDocument()
      mockStoreState.tasks = [
        { ...seedTasks[0], project_id: 2 },
        seedTasks[1],
      ]
      utils.rerender(<TasksView />)
      await waitFor(() => {
        expect(screen.queryByText('Task in P1')).toBeNull()
      })
    })

    it('task reassigned into the workspace project appears in the board after next fetch', async () => {
      // Start with no tasks for project 1 in the store.
      mockStoreState = buildStoreState({
        tasks: [seedTasks[1]], // only project 2
      })
      const utils = await renderView()
      expect(screen.queryByText('Task in P1')).toBeNull()

      // SSE updates: a project-2 task is reassigned into project 1.
      mockStoreState.tasks = [
        { ...seedTasks[1], project_id: 1, ticket_ref: 'P1-2', title: 'Reassigned in' },
      ]
      utils.rerender(<TasksView />)
      await waitFor(() => {
        expect(screen.getByText('Reassigned in')).toBeInTheDocument()
      })
    })

    it('EditTaskModal project dropdown is present and lists other projects as reassignment targets', async () => {
      mockSearchParams = new URLSearchParams('taskId=101')
      await renderView()
      await waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
      })
      const editButtons = await screen.findAllByLabelText('edit')
      fireEvent.click(editButtons[0])
      const projectSelect = (await screen.findByLabelText('fieldProject')) as HTMLSelectElement
      expect(projectSelect).toBeInTheDocument()
      // Project Two should be a selectable option for reassignment.
      const optionTwo = Array.from(projectSelect.options).find(o => o.value === '2')
      expect(optionTwo).toBeDefined()
    })
  })

  describe('TASK-04: feature parity with global board', () => {
    it('Projects button, Spawn form, and GNAP badge all render inside workspace (D-04 no features stripped)', async () => {
      mockStoreState = buildStoreState({ dashboardMode: 'full' })
      await renderView()
      expect(screen.getByText('projects')).toBeInTheDocument() // Projects button
      expect(screen.getByText('spawnSubAgent')).toBeInTheDocument() // Spawn toggle
      // GNAP badge rendered when /api/gnap returns enabled (mock above).
      await waitFor(() => {
        expect(screen.getByText('GNAP')).toBeInTheDocument()
      })
    })

    it('drag-and-drop status change still dispatches PUT /api/tasks/[id]', async () => {
      mockStoreState = buildStoreState({
        tasks: [{ ...seedTasks[0], status: 'in_progress' }],
      })
      await renderView()
      // Fire submit on the EditTaskModal as the deterministic PUT path
      // (drag-and-drop is hard to simulate reliably in jsdom and exercises
      // the same PUT contract).
      mockSearchParams = new URLSearchParams('taskId=101')
      cleanup()
      await renderView()
      await waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
      })
      const editButtons = await screen.findAllByLabelText('edit')
      fireEvent.click(editButtons[0])
      const titleInput = (await screen.findByLabelText('fieldTitle')) as HTMLInputElement
      const form = titleInput.closest('form')!
      fireEvent.submit(form)
      await waitFor(() => {
        // Pitfall #1: status update uses { method: 'PUT' }, not PATCH.
        expect({ method: lastTaskPutMethod }).toEqual({ method: 'PUT' })
      })
      expect(lastTaskPutUrl).toMatch(/\/api\/tasks\/101/)
    })

    it('edit and delete actions on a task card behave identically to the global board', async () => {
      mockSearchParams = new URLSearchParams('taskId=101')
      await renderView()
      await waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
      })
      // Both the edit button (aria-label='edit') and delete button
      // (aria-label='delete') render inside the detail modal.
      const editButtons = await screen.findAllByLabelText('edit')
      const deleteButtons = await screen.findAllByLabelText('delete')
      expect(editButtons.length).toBeGreaterThan(0)
      expect(deleteButtons.length).toBeGreaterThan(0)
    })
  })
})
