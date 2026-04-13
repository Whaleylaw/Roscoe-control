'use client'

import { useProjectWorkspace } from '@/components/project/project-context'
import { TaskBoardPanel } from '@/components/panels/task-board-panel'

export function TasksView() {
  const { project } = useProjectWorkspace()
  // project-workspace.tsx already gates on loading/not-found before this view.
  if (!project) return null
  return (
    <TaskBoardPanel
      scope={{
        lockedProjectId: project.id,
        hideProjectFilter: true,
        hideProjectLabels: true,
        defaultCreateProjectId: project.id,
      }}
    />
  )
}
