'use client'

import { useTranslations } from 'next-intl'

interface StatusCardsProps {
  active: number
  blocked: number
  completed: number
  onBlockedClick?: () => void
}

export function StatusCards({ active, blocked, completed, onBlockedClick }: StatusCardsProps) {
  const t = useTranslations('project')

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-400 mb-3">{t('dashboard.statusOverview')}</h3>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
          <div className="text-2xl font-bold text-zinc-100">{active}</div>
          <div className="text-sm text-zinc-400 mt-1">{t('dashboard.active')}</div>
        </div>

        <div
          className={`rounded-lg border p-4 ${
            blocked > 0
              ? 'bg-amber-500/10 border-amber-500/50 cursor-pointer'
              : 'bg-zinc-800/50 border-zinc-700'
          }`}
          onClick={blocked > 0 && onBlockedClick ? onBlockedClick : undefined}
          role={blocked > 0 && onBlockedClick ? 'button' : undefined}
        >
          <div className={`text-2xl font-bold ${blocked > 0 ? 'text-amber-400' : 'text-zinc-100'}`}>
            {blocked}
          </div>
          <div className="text-sm text-zinc-400 mt-1">{t('dashboard.blocked')}</div>
        </div>

        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
          <div className="text-2xl font-bold text-zinc-100">{completed}</div>
          <div className="text-sm text-zinc-400 mt-1">{t('dashboard.completed')}</div>
        </div>
      </div>
    </div>
  )
}
