import { describe, it } from 'vitest'

// Mock setup (to be implemented in Plan 05-01):
// - vi.mock('@/components/project/project-context', ...) for useProjectWorkspace (return { slug, view, project: { id, slug, name }, ... })
// - vi.mock('@/components/panels/agent-squad-panel', ...) to replace with a lightweight test double capturing its scope prop
// - vi.mock('next-intl', ...) for useTranslations
// - React Testing Library render() of <AgentsView />

describe('AgentsView', () => {
  describe('SESS-02: embeds AgentSquadPanel with correct scope', () => {
    it.todo('renders <AgentSquadPanel scope={...}/> when project is loaded')
    it.todo('scope.lockedProjectId equals useProjectWorkspace().project.id')
    it.todo('scope.taskScopeProjectId equals useProjectWorkspace().project.id')
    it.todo('scope.hideCreateAgent is true')
    it.todo('scope.showAssignmentBadge is true')
  })

  describe('SESS-02: renders nothing when project is null', () => {
    it.todo('returns null when useProjectWorkspace().project is null (workspace shell handles loading/not-found)')
  })

  describe('SESS-02: empty-state handling is delegated to embedded panel', () => {
    it.todo('does NOT render its own empty state — the panel handles it (empty state copy comes from project.agents.* keys)')
  })
})
