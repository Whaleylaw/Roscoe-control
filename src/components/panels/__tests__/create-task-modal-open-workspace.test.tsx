import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// Phase 8 D-14/D-15/D-20: the CreateTaskModal's project <select> must gain a
// sibling "↗ Open workspace" button that routes to /project/{slug} of the
// currently-picked project. Disabled when no project is selectable.

const pushMock = vi.fn()

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => '/tasks',
  useSearchParams: () => new URLSearchParams(),
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

vi.mock('@/store', () => ({
  useMissionControl: () => ({
    tasks: [],
    agents: [],
    projects: [],
    availableModels: [{ alias: 'sonnet' }],
    activeProject: null,
    spawnRequests: [],
    dashboardMode: 'local',
    currentUser: { username: 'tester' },
  }),
}))

beforeEach(() => {
  pushMock.mockReset()
  global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

import { CreateTaskModal } from '@/components/panels/task-board-panel'

const alpha = { id: 1, name: 'Alpha', slug: 'alpha', ticket_prefix: 'ALP', status: 'active' } as any
const beta = { id: 2, name: 'Beta', slug: 'beta', ticket_prefix: 'BTA', status: 'active' } as any

function getOpenWorkspaceButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: /projects\.picker\.openWorkspace/i,
  }) as HTMLButtonElement
}

describe('CreateTaskModal — Open workspace picker button (D-14)', () => {
  it('enables the button when a project is pre-selected and navigates on click', () => {
    render(
      <CreateTaskModal
        agents={[]}
        projects={[alpha]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        defaultProjectId={1}
      />,
    )
    const btn = getOpenWorkspaceButton()
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(pushMock).toHaveBeenCalledWith('/project/alpha', expect.anything())
  })

  it('disables the button when no project is selectable (empty projects list)', () => {
    render(
      <CreateTaskModal
        agents={[]}
        projects={[]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    )
    const btn = getOpenWorkspaceButton()
    expect(btn).toBeDisabled()
  })

  it('routes to the new slug after the user changes the project select', () => {
    render(
      <CreateTaskModal
        agents={[]}
        projects={[alpha, beta]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        defaultProjectId={1}
      />,
    )
    const projectSelect = screen.getByLabelText(/fieldProject/i) as HTMLSelectElement
    fireEvent.change(projectSelect, { target: { value: '2' } })
    const btn = getOpenWorkspaceButton()
    fireEvent.click(btn)
    expect(pushMock).toHaveBeenCalledWith('/project/beta', expect.anything())
  })

  it('button has type="button" so it does not submit the form', () => {
    render(
      <CreateTaskModal
        agents={[]}
        projects={[alpha]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        defaultProjectId={1}
      />,
    )
    const btn = getOpenWorkspaceButton()
    expect(btn.getAttribute('type')).toBe('button')
  })
})
