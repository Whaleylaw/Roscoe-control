'use client'

import { useProjectWorkspace } from '@/components/project/project-context'
import { AgentSquadPanel } from '@/components/panels/agent-squad-panel'

export function AgentsView() {
  const { project } = useProjectWorkspace()
  // project-workspace.tsx already gates on loading/not-found before this view.
  if (!project) return null
  return (
    <AgentSquadPanel
      scope={{
        lockedProjectId: project.id,
        taskScopeProjectId: project.id,
        hideCreateAgent: true,
        showAssignmentBadge: true,
      }}
    />
  )
}
