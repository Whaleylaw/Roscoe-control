'use client'

import { startTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'
import { ProjectManagerModal } from '@/components/modals/project-manager-modal'

/**
 * ProjectsPanel
 *
 * Lists every active project as a clickable row. Clicking a row navigates
 * to /project/{slug} — the full-takeover workspace. The empty-state CTA
 * opens the existing project-manager modal (same modal used by the
 * task-board's Projects button) so we don't duplicate the creation flow.
 *
 * Data comes from Zustand projects[] — already populated at boot via
 * GET /api/projects (see src/app/[[...panel]]/page.tsx boot sequence).
 * No re-fetch on mount. last_activity_at arrives from the backend
 * (Plan 08-00: LEFT JOIN tasks + MAX(updated_at) * 1000).
 */
export function ProjectsPanel() {
  const t = useTranslations('projects')
  const router = useRouter()
  const { projects, fetchProjects } = useMissionControl()
  const [showManager, setShowManager] = useState(false)

  // ROADMAP scopes the list to active projects; archived view is deferred.
  const activeProjects = projects.filter((p) => p.status === 'active')

  function navigateToWorkspace(slug: string) {
    startTransition(() => {
      router.push(`/project/${slug}`, { scroll: false })
    })
  }

  function handleRowKeyDown(e: React.KeyboardEvent, slug: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      navigateToWorkspace(slug)
    }
  }

  function formatDeadline(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toLocaleDateString()
  }

  function formatLastActivity(unixMs: number): string {
    return new Date(unixMs).toLocaleDateString()
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <h2 className="text-xl font-bold text-foreground">{t('title')}</h2>
        <Button onClick={() => setShowManager(true)}>{t('header.cta')}</Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {activeProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
            <p className="text-sm text-muted-foreground">{t('empty.title')}</p>
            <Button onClick={() => setShowManager(true)}>{t('empty.cta')}</Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activeProjects.map((project) => {
              const showDeadline = typeof project.deadline === 'number' && project.deadline > 0
              const showLastActivity =
                !showDeadline &&
                typeof project.last_activity_at === 'number' &&
                project.last_activity_at > 0
              return (
                <li key={project.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={project.name}
                    onClick={() => navigateToWorkspace(project.slug)}
                    onKeyDown={(e) => handleRowKeyDown(e, project.slug)}
                    className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-secondary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {/* Color swatch (if set) */}
                    {project.color && (
                      <span
                        className="w-2.5 h-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: project.color }}
                        aria-hidden="true"
                      />
                    )}

                    {/* Name (primary) */}
                    <span className="text-sm font-medium text-foreground truncate min-w-0">
                      {project.name}
                    </span>

                    {/* Status badge */}
                    <span
                      className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-500/15 text-green-400 border border-green-500/20"
                      aria-label={`${t('row.statusLabel')}: ${project.status}`}
                    >
                      {project.status}
                    </span>

                    {/* Ticket prefix */}
                    <span className="shrink-0 font-mono text-xs text-muted-foreground/80 tracking-wide">
                      {project.ticket_prefix}
                    </span>

                    {/* Meta slot (right-aligned) */}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {showDeadline ? (
                        <>
                          <span className="text-muted-foreground/60 mr-1">
                            {t('row.deadlineLabel')}:
                          </span>
                          {formatDeadline(project.deadline as number)}
                        </>
                      ) : showLastActivity ? (
                        <>
                          <span className="text-muted-foreground/60 mr-1">
                            {t('row.lastActivityLabel')}:
                          </span>
                          {formatLastActivity(project.last_activity_at as number)}
                        </>
                      ) : (
                        <span className="text-muted-foreground/40">{t('row.noActivity')}</span>
                      )}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Reuse the existing project-manager modal for creation (D-12) */}
      {showManager && (
        <ProjectManagerModal
          onClose={() => {
            setShowManager(false)
            fetchProjects()
          }}
        />
      )}
    </div>
  )
}
