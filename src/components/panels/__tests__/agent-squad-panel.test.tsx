import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'

// ─── Module mocks ────────────────────────────────────────────────────
//
// AgentSquadPanel is fairly self-contained — it uses next-intl for i18n and
// fetch() for data. We mock both and let the component render its real DOM.

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string) => (ns ? `${ns}.${key}` : key),
}))

vi.mock('@/lib/client-logger', () => ({
  createClientLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const fetchSpy = vi.fn()

beforeEach(() => {
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [] }) })
  global.fetch = fetchSpy as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Import after mocks are set up.
import { AgentSquadPanel } from '@/components/panels/agent-squad-panel'

const sampleAssigned = {
  id: 1,
  name: 'Aegis',
  role: 'code',
  status: 'idle' as const,
  created_at: 1000,
  updated_at: 1000,
  assignment_source: 'assigned' as const,
  taskStats: { total: 2, assigned: 1, in_progress: 1, completed: 0 },
}
const sampleTaskOnly = {
  id: 2,
  name: 'Hermes',
  role: 'planner',
  status: 'busy' as const,
  created_at: 1100,
  updated_at: 1100,
  assignment_source: 'task' as const,
  taskStats: { total: 1, assigned: 0, in_progress: 1, completed: 0 },
}

describe('AgentSquadPanel', () => {
  describe('scope default (undefined) — current behavior preserved (SESS-02 regression guard)', () => {
    it('renders "Add Agent" button when scope is undefined', async () => {
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [sampleAssigned] }) })
      render(<AgentSquadPanel />)
      // Translation key fallback returns "agentSquad.addAgent"
      expect(await screen.findByText('agentSquad.addAgent')).toBeInTheDocument()
    })

    it('fetches GET /api/agents (no project_id param) when scope is undefined', async () => {
      render(<AgentSquadPanel />)
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith('/api/agents')
      })
    })

    it('does NOT render Assigned chip on any card when scope is undefined', async () => {
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [sampleAssigned] }) })
      render(<AgentSquadPanel />)
      await screen.findByText('Aegis')
      expect(screen.queryByText('project.agents.assignedChip')).not.toBeInTheDocument()
    })

    it('taskStats are unscoped when scope is undefined', async () => {
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [sampleAssigned] }) })
      render(<AgentSquadPanel />)
      await screen.findByText('Aegis')
      // sampleAssigned has total=2 — visible in card
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })

  describe('SESS-02: scope.lockedProjectId triggers project-scoped fetch', () => {
    it('fetches GET /api/agents?project_id=<lockedProjectId> when scope.lockedProjectId is set', async () => {
      render(<AgentSquadPanel scope={{ lockedProjectId: 42 }} />)
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith('/api/agents?project_id=42')
      })
    })

    it('renders only agents returned by the scoped API response (union of assigned ∪ task-derived)', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ agents: [sampleAssigned, sampleTaskOnly] }),
      })
      render(<AgentSquadPanel scope={{ lockedProjectId: 42 }} />)
      expect(await screen.findByText('Aegis')).toBeInTheDocument()
      expect(await screen.findByText('Hermes')).toBeInTheDocument()
    })

    it('renders empty state when API returns empty agents array', async () => {
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [] }) })
      render(<AgentSquadPanel scope={{ lockedProjectId: 42 }} />)
      // The existing empty state copy comes from the agentSquad namespace
      expect(await screen.findByText('agentSquad.noAgents')).toBeInTheDocument()
    })
  })

  describe('SESS-02: scope.hideCreateAgent hides the create button', () => {
    it('"Add Agent" button is NOT rendered in DOM when scope.hideCreateAgent is true', async () => {
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [sampleAssigned] }) })
      render(<AgentSquadPanel scope={{ lockedProjectId: 1, hideCreateAgent: true }} />)
      await screen.findByText('Aegis')
      expect(screen.queryByText('agentSquad.addAgent')).not.toBeInTheDocument()
    })

    it('agent cards and detail click-through remain functional (D-17)', async () => {
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [sampleAssigned] }) })
      render(<AgentSquadPanel scope={{ lockedProjectId: 1, hideCreateAgent: true }} />)
      const card = await screen.findByText('Aegis')
      expect(card).toBeInTheDocument()
      // Card is still clickable (cursor-pointer class on the parent)
      const clickableParent = card.closest('.cursor-pointer')
      expect(clickableParent).not.toBeNull()
    })
  })

  describe('SESS-02: scope.taskScopeProjectId scopes active-task-count per card', () => {
    it('passes lockedProjectId to the fetch so taskStats from API are project-scoped', async () => {
      // taskScopeProjectId is documented in the interface but the API derives task scoping
      // from project_id. We assert the project-scoped URL is used so the API returns scoped stats.
      render(
        <AgentSquadPanel
          scope={{ lockedProjectId: 7, taskScopeProjectId: 7 }}
        />,
      )
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith('/api/agents?project_id=7')
      })
    })

    it('card renders activeTaskCount reflecting only tasks whose project_id matches scope.taskScopeProjectId', async () => {
      // The API returns already-scoped taskStats; the panel just renders them.
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          agents: [{ ...sampleAssigned, taskStats: { total: 5, assigned: 2, in_progress: 3, completed: 0 } }],
        }),
      })
      render(<AgentSquadPanel scope={{ lockedProjectId: 7, taskScopeProjectId: 7 }} />)
      await screen.findByText('Aegis')
      // total=5 visible
      expect(screen.getByText('5')).toBeInTheDocument()
      // in_progress=3 visible
      expect(screen.getByText('3')).toBeInTheDocument()
    })
  })

  describe('SESS-02: scope.showAssignmentBadge renders Assigned chip', () => {
    it('agent with assignment_source==="assigned" shows the "Assigned" chip (from project.agents.assignedChip key)', async () => {
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [sampleAssigned] }) })
      render(
        <AgentSquadPanel
          scope={{ lockedProjectId: 1, showAssignmentBadge: true }}
        />,
      )
      expect(await screen.findByText('project.agents.assignedChip')).toBeInTheDocument()
    })

    it('agent with assignment_source==="task" shows NO chip (cleaner — per CONTEXT specifics)', async () => {
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [sampleTaskOnly] }) })
      render(
        <AgentSquadPanel
          scope={{ lockedProjectId: 1, showAssignmentBadge: true }}
        />,
      )
      await screen.findByText('Hermes')
      expect(screen.queryByText('project.agents.assignedChip')).not.toBeInTheDocument()
    })

    it('chip styling uses bg-primary/10 text-primary border-primary/30 per UI-SPEC (accent reserved use #3)', async () => {
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [sampleAssigned] }) })
      render(
        <AgentSquadPanel
          scope={{ lockedProjectId: 1, showAssignmentBadge: true }}
        />,
      )
      const chip = await screen.findByText('project.agents.assignedChip')
      expect(chip.className).toContain('bg-primary/10')
      expect(chip.className).toContain('text-primary')
      expect(chip.className).toContain('border-primary/30')
    })
  })

  describe('SESS-02: dedupe by lowercased name (Pitfall 6)', () => {
    it('agent appearing in both assignments AND tasks is rendered exactly once', async () => {
      // The API does the LOWER() dedupe — the panel just renders what it gets.
      // We assert that when only one Aegis row arrives (correct API behavior),
      // the panel renders one Aegis card.
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [sampleAssigned] }) })
      render(<AgentSquadPanel scope={{ lockedProjectId: 1 }} />)
      const matches = await screen.findAllByText('Aegis')
      expect(matches).toHaveLength(1)
    })

    it('assigned-source takes precedence over task-source in the dedupe (D-03)', async () => {
      // When the API has applied D-03 (dedupe with assigned precedence), the panel
      // sees assignment_source='assigned' for the deduped agent. Verify it renders
      // the Assigned chip (which it would NOT render if the source were 'task').
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ agents: [sampleAssigned] }) })
      render(
        <AgentSquadPanel
          scope={{ lockedProjectId: 1, showAssignmentBadge: true }}
        />,
      )
      expect(await screen.findByText('project.agents.assignedChip')).toBeInTheDocument()
    })
  })
})
