'use client'

import { useProjectWorkspace } from '@/components/project/project-context'
import { DashboardView } from '@/components/project/dashboard-view'
import { LifecycleView } from '@/components/project/lifecycle/lifecycle-view'
import { TasksView } from '@/components/project/tasks-view'
import { SessionsView } from '@/components/project/sessions-view'
import { SessionDetailView } from '@/components/project/session-detail-view'
import { AgentsView } from '@/components/project/agents-view'
import { SettingsView } from '@/components/project/settings-view'
import { useTranslations } from 'next-intl'

export function ProjectViewRouter() {
  const { view, detailId } = useProjectWorkspace()
  const t = useTranslations('project')

  switch (view) {
    case 'dashboard':
      return <DashboardView />
    case 'lifecycle':
      return <LifecycleView />
    case 'tasks':
      return <TasksView />
    case 'sessions':
      // SESS-03 — when a fourth URL segment is present, render the single-session detail.
      return detailId ? <SessionDetailView sessionId={detailId} /> : <SessionsView />
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
