'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { startTransition } from 'react'
import { ProjectWorkspaceProvider, useProjectWorkspace } from '@/components/project/project-context'
import { ProjectBreadcrumb } from '@/components/project/project-breadcrumb'
import { ProjectTabs } from '@/components/project/project-tabs'
import { ProjectViewRouter } from '@/components/project/project-view-router'
import { useMissionControl } from '@/store'

function WorkspaceContent() {
  const t = useTranslations('project')
  const router = useRouter()
  const { loading, error } = useProjectWorkspace()
  const { fetchProjects } = useMissionControl()

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

  if (error === 'load-timeout') {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4 px-4">
        <div className="bg-surface-1 border border-border rounded-md p-6 max-w-md space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            {t('workspace.loadTimeoutHeading')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('workspace.loadTimeoutBody')}
          </p>
          <button
            type="button"
            onClick={() => fetchProjects()}
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {t('workspace.loadTimeoutRetry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-4 pb-0 space-y-3">
        <ProjectBreadcrumb />
        <ProjectTabs />
      </div>
      <div className="min-h-0 flex-1">
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
