'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { startTransition } from 'react'
import { ProjectWorkspaceProvider, useProjectWorkspace } from '@/components/project/project-context'
import { ProjectBreadcrumb } from '@/components/project/project-breadcrumb'
import { ProjectTabs } from '@/components/project/project-tabs'
import { ProjectViewRouter } from '@/components/project/project-view-router'

function WorkspaceContent() {
  const t = useTranslations('project')
  const router = useRouter()
  const { loading, error } = useProjectWorkspace()

  if (loading) {
    return (
      <div className="flex flex-col min-h-full">
        <div className="px-4 pt-4 pb-0 space-y-3">
          <div className="h-5 w-48 bg-muted animate-pulse rounded" />
          <div className="h-10 w-full bg-muted/50 animate-pulse rounded" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">{t('workspace.loading')}</p>
        </div>
      </div>
    )
  }

  if (error === 'not-found') {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
        <p className="text-lg font-medium text-foreground">{t('workspace.projectNotFound')}</p>
        <p className="text-sm text-muted-foreground">{t('workspace.projectNotFoundDescription')}</p>
        <button
          onClick={() => startTransition(() => router.push('/', { scroll: false }))}
          className="text-sm text-primary hover:underline"
        >
          {t('workspace.backToProjects')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="px-4 pt-4 pb-0 space-y-3">
        <ProjectBreadcrumb />
        <ProjectTabs />
      </div>
      <div className="flex-1">
        <ProjectViewRouter />
      </div>
    </div>
  )
}

export function ProjectWorkspace() {
  return (
    <ProjectWorkspaceProvider>
      <WorkspaceContent />
    </ProjectWorkspaceProvider>
  )
}
