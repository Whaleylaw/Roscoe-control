'use client'

import { useTranslations } from 'next-intl'
import { useProjectWorkspace } from '@/components/project/project-context'

export function SessionsView() {
  const t = useTranslations('project')
  const { slug } = useProjectWorkspace()

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold mb-4">{t('sessions.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('sessions.placeholder')}</p>
    </div>
  )
}
