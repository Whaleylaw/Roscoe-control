import { describe, it } from 'vitest'

// Mock setup (to be implemented in Plan 04-01):
// - vi.mock('@/store', ...) for useMissionControl (tasks, projects, activeProject)
// - vi.mock('@/components/project/project-context', ...) for useProjectWorkspace
// - vi.mock('next-intl', ...) for useTranslations
// - vi.mock('next/navigation', ...) for useRouter / usePathname
// - global.fetch mock for /api/tasks and /api/projects
// - Note: TaskBoardPanel is embedded directly, not mocked — this is an integration test

describe('TasksView', () => {
  describe('TASK-01: tasks filtered to current project', () => {
    it.todo('renders only tasks whose project_id matches the workspace project')
    it.todo('does not render tasks belonging to other projects')
    it.todo('renders an empty column when the workspace project has no tasks in that status')
  })

  describe('TASK-01: project filter dropdown hidden in workspace mode', () => {
    it.todo('project filter <select> is not present in the rendered DOM')
    it.todo('all 9 status columns remain visible even with filter hidden (D-10)')
  })

  describe('TASK-01: card project label hidden in workspace mode', () => {
    it.todo('card renders without the ticket_ref span inside the column view')
    it.todo('detail modal still shows ticket_ref for task identity (pitfall #4)')
  })

  describe('TASK-03: reassigns out disappears', () => {
    it.todo('task reassigned away from workspace project disappears from the board immediately via client-side filter')
    it.todo('task reassigned into the workspace project appears in the board after next fetch')
    it.todo('EditTaskModal project dropdown is present and lists other projects as reassignment targets')
  })

  describe('TASK-04: feature parity with global board', () => {
    it.todo('Projects button, Spawn form, and GNAP badge all render inside workspace (D-04 no features stripped)')
    it.todo('drag-and-drop status change still dispatches PUT /api/tasks/[id]')
    it.todo('edit and delete actions on a task card behave identically to the global board')
  })
})
