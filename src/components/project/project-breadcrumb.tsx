'use client'

import { useRouter } from 'next/navigation'
import { startTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useProjectWorkspace } from '@/components/project/project-context'

/**
 * Derive a human-readable label for the breadcrumb's fourth (detail) segment.
 *
 * - `thread:<projectId>:<agentName>` → agent name with first letter uppercased
 * - any other id (runtime session id) → returned verbatim (the breadcrumb cell
 *   already truncates with max-w + truncate)
 */
function detailLabelFrom(id: string): string {
  const threadMatch = id.match(/^thread:\d+:(.+)$/)
  if (threadMatch) {
    const name = threadMatch[1]
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  return id
}

export function ProjectBreadcrumb() {
  const router = useRouter()
  const t = useTranslations('project')
  const { slug, view, detailId, project } = useProjectWorkspace()

  const navigate = (href: string) => {
    startTransition(() => {
      router.push(href, { scroll: false })
    })
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <button
        onClick={() => navigate('/')}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        {t('nav.projects')}
      </button>
      <span className="text-muted-foreground/50" aria-hidden="true">{'>'}</span>
      <button
        onClick={() => navigate(`/project/${slug}`)}
        className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]"
      >
        {project?.name || slug}
      </button>
      {view !== 'dashboard' && (
        <>
          <span className="text-muted-foreground/50" aria-hidden="true">{'>'}</span>
          {detailId ? (
            <button
              onClick={() => navigate(`/project/${slug}/${view}`)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {t(`nav.${view}`)}
            </button>
          ) : (
            <span className="text-foreground font-medium">
              {t(`nav.${view}`)}
            </span>
          )}
        </>
      )}
      {detailId && view !== 'dashboard' && (
        <>
          <span className="text-muted-foreground/50" aria-hidden="true">{'>'}</span>
          <span className="text-foreground font-medium truncate max-w-[240px]">
            {detailLabelFrom(detailId)}
          </span>
        </>
      )}
    </nav>
  )
}
