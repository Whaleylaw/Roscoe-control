'use client'

import { useTranslations } from 'next-intl'
import { ProjectWorkspaceProvider } from '@/components/project/project-context'
import { ProjectViewRouter } from '@/components/project/project-view-router'

export function ProjectWorkspace() {
  const t = useTranslations('project')

  return (
    <ProjectWorkspaceProvider>
      <div className="flex flex-col min-h-full">
        <ProjectViewRouter />
      </div>
    </ProjectWorkspaceProvider>
  )
}
