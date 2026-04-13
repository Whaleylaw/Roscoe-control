'use client'

import { useRouter } from 'next/navigation'
import { startTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useProjectWorkspace } from '@/components/project/project-context'

export function ProjectBreadcrumb() {
  const router = useRouter()
  const t = useTranslations('project')
  const { slug, view, project } = useProjectWorkspace()

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
          <span className="text-foreground font-medium">
            {t(`nav.${view}`)}
          </span>
        </>
      )}
    </nav>
  )
}
