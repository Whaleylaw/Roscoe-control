import { describe, it } from 'vitest'

// Mock setup (to be implemented in Plan 05-01):
// - new Database(':memory:') and run migrations via @/lib/migrations
// - seed: workspace, 2 projects, 3 agents, project_agent_assignments rows, tasks with assigned_to
// - import { GET } from '@/app/api/agents/route'
// - build a NextRequest with URL '/api/agents?project_id=<id>' and call GET(request)
// - assert response.json() shape

describe('GET /api/agents', () => {
  describe('existing behavior (no project_id) — regression guard', () => {
    it.todo('returns all workspace agents when project_id is omitted')
    it.todo('respects existing filters status, role, show_hidden')
    it.todo('task counts are unscoped (count all tasks for each agent) when project_id is omitted')
  })

  describe('SESS-02: project_id union filter', () => {
    it.todo('returns agents explicitly assigned via project_agent_assignments for the given project_id')
    it.todo('returns agents whose name appears in tasks.assigned_to for any task with project_id=<id> (task-derived)')
    it.todo('returns UNION — agent present in either source is included')
    it.todo('excludes agents that are in neither assignments nor project tasks')
  })

  describe('SESS-02: dedupe with LOWER() comparison (Pitfall 6)', () => {
    it.todo('agent whose canonical name is "Aegis" and whose project_agent_assignments row is "aegis" appears exactly once')
    it.todo('dedupe returns the canonical casing from agents.name, not the source-table casing')
  })

  describe('SESS-02: assignment_source field per agent', () => {
    it.todo('agents from project_agent_assignments have assignment_source="assigned"')
    it.todo('agents only from tasks.assigned_to have assignment_source="task"')
    it.todo('agents in both sources have assignment_source="assigned" (assigned takes precedence — D-03)')
  })

  describe('SESS-02: taskStats scoped to project_id', () => {
    it.todo('taskStats.total counts only tasks with project_id=<id> when project_id param is present')
    it.todo('taskStats.active (assigned+in_progress) is likewise scoped to the project_id')
    it.todo('agent with tasks in another project has taskStats.total=0 in the scoped response if not assigned here')
  })

  describe('SESS-02: invalid project_id handling', () => {
    it.todo('returns 400 when project_id is non-numeric')
    it.todo('returns empty agents array (200) when project_id is numeric but does not exist')
  })
})
