import { describe, it } from 'vitest'

// Mock setup (to be implemented in Plan 05-01):
// - vi.mock('@/store', ...) for useMissionControl (agents, projects)
// - vi.mock('next-intl', ...) for useTranslations('agentSquad' | 'project.agents')
// - global.fetch mock for GET /api/agents and GET /api/agents?project_id=<id>
// - React Testing Library render() of <AgentSquadPanel scope={...} />

describe('AgentSquadPanel', () => {
  describe('scope default (undefined) — current behavior preserved (SESS-02 regression guard)', () => {
    it.todo('renders "Add Agent" button when scope is undefined')
    it.todo('fetches GET /api/agents (no project_id param) when scope is undefined')
    it.todo('does NOT render Assigned chip on any card when scope is undefined')
    it.todo('taskStats are unscoped when scope is undefined')
  })

  describe('SESS-02: scope.lockedProjectId triggers project-scoped fetch', () => {
    it.todo('fetches GET /api/agents?project_id=<lockedProjectId> when scope.lockedProjectId is set')
    it.todo('renders only agents returned by the scoped API response (union of assigned ∪ task-derived)')
    it.todo('renders empty state when API returns empty agents array')
  })

  describe('SESS-02: scope.hideCreateAgent hides the create button', () => {
    it.todo('"Add Agent" button is NOT rendered in DOM when scope.hideCreateAgent is true')
    it.todo('agent cards and detail click-through remain functional (D-17)')
  })

  describe('SESS-02: scope.taskScopeProjectId scopes active-task-count per card', () => {
    it.todo('fetch URL includes task_project_id=<id> param when scope.taskScopeProjectId is set')
    it.todo('card renders activeTaskCount reflecting only tasks whose project_id matches scope.taskScopeProjectId')
  })

  describe('SESS-02: scope.showAssignmentBadge renders Assigned chip', () => {
    it.todo('agent with assignment_source==="assigned" shows the "Assigned" chip (from project.agents.assignedChip key)')
    it.todo('agent with assignment_source==="task" shows NO chip (cleaner — per CONTEXT specifics)')
    it.todo('chip styling uses bg-primary/10 text-primary border-primary/30 per UI-SPEC (accent reserved use #3)')
  })

  describe('SESS-02: dedupe by lowercased name (Pitfall 6)', () => {
    it.todo('agent appearing in both assignments AND tasks is rendered exactly once')
    it.todo('assigned-source takes precedence over task-source in the dedupe (D-03)')
  })
})
