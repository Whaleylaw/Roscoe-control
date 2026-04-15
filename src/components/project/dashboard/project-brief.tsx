'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { MarkdownRenderer } from '@/components/markdown-renderer'

interface ProjectBriefProps {
  description?: string | null
  projectSlug: string
}

export function ProjectBrief({ description, projectSlug }: ProjectBriefProps) {
  const t = useTranslations('project')

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">{t('dashboard.about')}</h3>
      {description ? (
        <MarkdownRenderer content={description} />
      ) : (
        <div className="text-sm text-zinc-500">
          <p>{t('dashboard.noDescription')}</p>
          <Link
            href={`/project/${projectSlug}/settings`}
            className="text-blue-400 hover:text-blue-300 underline mt-1 inline-block"
          >
            {t('dashboard.addDescription')}
          </Link>
        </div>
      )}
    </div>
  )
}
