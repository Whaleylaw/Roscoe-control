'use client'

import { useRouter } from 'next/navigation'
import { startTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useProjectWorkspace } from '@/components/project/project-context'

const VIEWS = ['dashboard', 'lifecycle', 'tasks', 'sessions', 'agents', 'settings'] as const

export function ProjectTabs() {
  const router = useRouter()
  const t = useTranslations('project')
  const { slug, view, project } = useProjectWorkspace()
  const views = project?.gsd_enabled ? VIEWS : VIEWS.filter((v) => v !== 'lifecycle')

  const navigate = (targetView: string) => {
    const href = targetView === 'dashboard'
      ? `/project/${slug}`
      : `/project/${slug}/${targetView}`
    startTransition(() => {
      router.push(href, { scroll: false })
    })
  }

  return (
    <nav aria-label="Project views" className="flex gap-1 border-b border-border">
      {views.map((v) => (
        <button
          key={v}
          onClick={() => navigate(v)}
          className={`px-3 py-2 text-sm transition-colors ${
            view === v
              ? 'text-foreground border-b-2 border-primary font-medium'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t(`nav.${v}`)}
        </button>
      ))}
    </nav>
  )
}
