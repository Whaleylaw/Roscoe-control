import { describe, it } from 'vitest'

// Mock setup (to be implemented in later plans):
// - vi.mock('@/store', ...) for useMissionControl (tasks, projects)
// - vi.mock('@/components/project/project-context', ...) for useProjectWorkspace
// - vi.mock('next-intl', ...) for useTranslations
// - vi.mock('react-markdown', ...) for Markdown rendering
// - global.fetch mock for activity feed API

describe('DashboardView', () => {
  describe('DASH-01: status overview cards', () => {
    it.todo('renders active task count card')
    it.todo('renders blocked task count card')
    it.todo('renders completed task count card')
    it.todo('groups task statuses correctly: active = inbox+assigned+awaiting_owner+in_progress+review+quality_review')
  })

  describe('DASH-02: progress indicator', () => {
    it.todo('shows progress bar with correct width percentage')
    it.todo('shows completion text like 6/8 tasks')
  })

  describe('DASH-03: project brief', () => {
    it.todo('renders project description as markdown')
    it.todo('shows empty state when no description exists')
  })

  describe('DASH-04: activity feed', () => {
    it.todo('displays recent activity entries')
    it.todo('shows relative timestamps')
    it.todo('shows empty state when no activities')
  })

  describe('DASH-05: blocked tasks attention', () => {
    it.todo('blocked card has distinct warning styling when count > 0')
    it.todo('blocked card has normal styling when count is 0')
  })

  describe('DASH-06: health indicator', () => {
    it.todo('shows On Track when 0 blocked tasks')
    it.todo('shows At Risk when blocked < 25%')
    it.todo('shows Off Track when blocked >= 25%')
  })

  describe('DASH-07: real-time updates', () => {
    it.todo('updates counts when store tasks change')
  })
})
