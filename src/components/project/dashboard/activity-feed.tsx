'use client'

import { useTranslations } from 'next-intl'
import type { Activity } from '@/store'

interface ActivityFeedProps {
  activities: Activity[]
}

function relativeTime(
  createdAt: number,
  t: (key: string, values?: Record<string, number>) => string
): string {
  const now = Date.now()
  const diffMs = now - createdAt
  const diffSeconds = Math.floor(diffMs / 1000)

  if (diffSeconds < 60) return t('dashboard.justNow')
  if (diffSeconds < 3600) return t('dashboard.minutesAgo', { count: Math.floor(diffSeconds / 60) })
  if (diffSeconds < 86400) return t('dashboard.hoursAgo', { count: Math.floor(diffSeconds / 3600) })
  return t('dashboard.daysAgo', { count: Math.floor(diffSeconds / 86400) })
}

function activityTypeIndicator(type: string): string {
  if (type.includes('created')) return '+'
  if (type.includes('updated')) return '~'
  if (type.includes('completed') || type.includes('done')) return '\u2713'
  if (type.includes('failed') || type.includes('error')) return '!'
  return '\u2022'
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  const t = useTranslations('project')

  if (activities.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">{t('dashboard.activityFeed')}</h3>
        <p className="text-sm text-zinc-500">{t('dashboard.noActivity')}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">{t('dashboard.activityFeed')}</h3>
      <ul className="divide-y divide-zinc-700/50">
        {activities.map((activity) => (
          <li key={activity.id} className="py-2.5 first:pt-0 last:pb-0 flex items-start gap-2">
            <span className="text-xs font-mono text-zinc-500 mt-0.5 w-4 text-center shrink-0">
              {activityTypeIndicator(activity.type)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-300 truncate">{activity.description}</p>
            </div>
            <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
              {relativeTime(activity.created_at, t)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
