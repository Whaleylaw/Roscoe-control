'use client'

import { useProjectWorkspace } from '@/components/project/project-context'
import { DashboardView } from '@/components/project/dashboard-view'
import { TasksView } from '@/components/project/tasks-view'
import { SessionsView } from '@/components/project/sessions-view'
import { AgentsView } from '@/components/project/agents-view'
import { SettingsView } from '@/components/project/settings-view'
import { useTranslations } from 'next-intl'

export function ProjectViewRouter() {
  const { view } = useProjectWorkspace()
  const t = useTranslations('project')

  switch (view) {
    case 'dashboard':
      return <DashboardView />
    case 'tasks':
      return <TasksView />
    case 'sessions':
      return <SessionsView />
    case 'agents':
      return <AgentsView />
    case 'settings':
      return <SettingsView />
    default:
      return (
        <div className="flex items-center justify-center py-24 text-center">
          <p className="text-sm text-muted-foreground">{t('workspace.notFound')}</p>
        </div>
      )
  }
}
