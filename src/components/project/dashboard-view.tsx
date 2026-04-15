'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useMissionControl } from '@/store'
import type { Activity } from '@/store'
import { useProjectWorkspace } from '@/components/project/project-context'
import { StatusCards } from '@/components/project/dashboard/status-cards'
import { ProgressBar } from '@/components/project/dashboard/progress-bar'
import { HealthBadge } from '@/components/project/dashboard/health-badge'
import { ProjectBrief } from '@/components/project/dashboard/project-brief'
import { ActivityFeed } from '@/components/project/dashboard/activity-feed'

const STATUS_GROUPS = {
  active: ['inbox', 'assigned', 'awaiting_owner', 'in_progress', 'review', 'quality_review'],
  blocked: ['failed'],
  completed: ['done'],
} as const

export function DashboardView() {
  const t = useTranslations('project')
  const router = useRouter()
  const { tasks } = useMissionControl()
  const { project, slug } = useProjectWorkspace()

  // Filter tasks belonging to this project
  const projectTasks = useMemo(
    () => tasks.filter(t => t.project_id === project?.id),
    [tasks, project?.id]
  )

  // Derive task counts reactively from Zustand store (D-04, D-18)
  // total excludes backlog tasks per research recommendation
  const counts = useMemo(() => {
    const active = projectTasks.filter(t =>
      (STATUS_GROUPS.active as readonly string[]).includes(t.status)
    ).length
    const blocked = projectTasks.filter(t =>
      (STATUS_GROUPS.blocked as readonly string[]).includes(t.status)
    ).length
    const completed = projectTasks.filter(t =>
      (STATUS_GROUPS.completed as readonly string[]).includes(t.status)
    ).length
    return { active, blocked, completed, total: active + blocked + completed }
  }, [projectTasks])

  // Activity feed: fetch from API, refresh when project tasks change (D-10, D-19)
  const [activities, setActivities] = useState<Activity[]>([])

  const fetchActivities = useCallback(async () => {
    if (!project?.id) return
    try {
      const res = await fetch('/api/activities?entity_type=task&limit=50')
      const data = await res.json()
      const projectTaskIds = new Set(projectTasks.map(t => t.id))
      const filtered = (data.activities || [])
        .filter((a: Activity) => a.entity_type === 'task' && projectTaskIds.has(a.entity_id))
        .slice(0, 20)
      setActivities(filtered)
    } catch {
      // silently fail, show empty state
    }
  }, [project?.id, projectTasks])

  useEffect(() => { fetchActivities() }, [fetchActivities])

  // Navigate to tasks tab when clicking blocked card (D-12)
  const handleBlockedClick = useCallback(() => {
    router.push(`/project/${slug}/tasks`, { scroll: false })
  }, [router, slug])

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-semibold">{t('dashboard.title')}</h2>

      {/* Top row: Status overview cards */}
      <StatusCards
        active={counts.active}
        blocked={counts.blocked}
        completed={counts.completed}
        onBlockedClick={handleBlockedClick}
      />

      {/* Middle row: Progress + Health (D-16: visible without scrolling) */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-center">
        <ProgressBar completed={counts.completed} total={counts.total} />
        <HealthBadge blocked={counts.blocked} total={counts.total} />
      </div>

      {/* Bottom section: Brief + Activity side by side on lg, stacked narrow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProjectBrief description={project?.description} projectSlug={slug} />
        <ActivityFeed activities={activities} />
      </div>
    </div>
  )
}
