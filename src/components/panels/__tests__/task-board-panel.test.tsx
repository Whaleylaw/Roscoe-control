import { describe, it } from 'vitest'

// Mock setup (to be implemented in Plan 04-01):
// - vi.mock('@/store', ...) for useMissionControl (tasks, projects, agents, activeProject)
// - vi.mock('next-intl', ...) for useTranslations('taskBoard')
// - vi.mock('next/navigation', ...) for useRouter
// - global.fetch mock for /api/tasks (GET list, POST create), /api/tasks/[id] (PUT edit — NOT PATCH, pitfall #1), /api/projects, /api/agents
// - React Testing Library render() of <TaskBoardPanel scope={...} />

describe('TaskBoardPanel', () => {
  describe('scope default (undefined) — current behavior preserved (TASK-04 regression guard)', () => {
    it.todo('renders project filter <select> dropdown when scope is undefined')
    it.todo('renders card ticket_ref when scope is undefined')
    it.todo('CreateTaskModal defaults project_id to projects[0].id when scope is undefined')
    it.todo('respects activeProject Zustand selection when scope is undefined')
  })

  describe('TASK-01: scope.lockedProjectId filters tasks', () => {
    it.todo('renders only tasks whose project_id === scope.lockedProjectId')
    it.todo('client-side filter hides tasks whose project_id changes in storeTasks (pitfall #5 — SSE reassign-out defense)')
    it.todo('activeProject changes in Zustand do not override scope.lockedProjectId')
  })

  describe('TASK-01: scope.hideProjectFilter hides the filter dropdown', () => {
    it.todo('project filter <select> is not rendered when scope.hideProjectFilter is true')
    it.todo('Projects button and other top-bar controls remain visible (D-04)')
  })

  describe('TASK-01: scope.hideProjectLabels hides the card ticket_ref — card only, not detail modal (pitfall #4)', () => {
    it.todo('column-view card does not render ticket_ref span when scope.hideProjectLabels is true')
    it.todo('detail modal header still renders ticket_ref when scope.hideProjectLabels is true')
  })

  describe('TASK-02: scope.defaultCreateProjectId pre-fills CreateTaskModal project', () => {
    it.todo('CreateTaskModal useState initializer uses defaultProjectId when provided')
    it.todo('user can still change the project dropdown away from default (D-05 editable)')
    it.todo('submit dispatches POST /api/tasks with the selected project_id')
    it.todo('defaultProjectId surviving slow projects fetch (pitfall #3) — initializer does not clobber to empty string')
  })

  describe('TASK-03: reassigns out disappears', () => {
    it.todo('EditTaskModal project <select> is visible and enabled when scope is set')
    it.todo('submitting EditTaskModal with a different project_id calls PUT /api/tasks/[id] (NOT PATCH — pitfall #1)')
    it.todo('task with project_id !== scope.lockedProjectId is immediately filtered from the board')
  })

  describe('TASK-04: feature parity when scope is set', () => {
    it.todo('Projects button, Spawn form, GNAP badge, ProjectManagerModal all render (D-04)')
    it.todo('all 9 status columns render even when empty (D-10)')
    it.todo('drag-and-drop updates task status via PUT /api/tasks/[id]')
  })
})
