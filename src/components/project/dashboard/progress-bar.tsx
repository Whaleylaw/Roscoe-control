'use client'

import { useTranslations } from 'next-intl'

interface ProgressBarProps {
  completed: number
  total: number
}

export function ProgressBar({ completed, total }: ProgressBarProps) {
  const t = useTranslations('project')
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100)

  if (total === 0) {
    return (
      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-3">{t('dashboard.progress')}</h3>
        <p className="text-sm text-zinc-500">{t('dashboard.noTasks')}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-zinc-400">{t('dashboard.progress')}</h3>
        <span className="text-sm font-medium text-zinc-300">{percentage}%</span>
      </div>
      <div className="bg-zinc-700 rounded-full h-2.5">
        <div
          className="bg-green-500 rounded-full h-2.5 transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-xs text-zinc-500 mt-1.5">
        {t('dashboard.progressText', { completed, total })}
      </p>
    </div>
  )
}
