'use client'

import { useTranslations } from 'next-intl'

interface HealthBadgeProps {
  blocked: number
  total: number
}

type HealthStatus = 'onTrack' | 'atRisk' | 'offTrack'

function deriveHealth(blocked: number, total: number): HealthStatus {
  if (total === 0 || blocked === 0) return 'onTrack'
  if (blocked / total < 0.25) return 'atRisk'
  return 'offTrack'
}

const HEALTH_CONFIG: Record<HealthStatus, { emoji: string; key: string; classes: string }> = {
  onTrack: {
    emoji: '\u2705',
    key: 'dashboard.healthOnTrack',
    classes: 'bg-green-500/15 text-green-400',
  },
  atRisk: {
    emoji: '\u26A0\uFE0F',
    key: 'dashboard.healthAtRisk',
    classes: 'bg-amber-500/15 text-amber-400',
  },
  offTrack: {
    emoji: '\uD83D\uDD34',
    key: 'dashboard.healthOffTrack',
    classes: 'bg-red-500/15 text-red-400',
  },
}

export function HealthBadge({ blocked, total }: HealthBadgeProps) {
  const t = useTranslations('project')
  const status = deriveHealth(blocked, total)
  const config = HEALTH_CONFIG[status]

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${config.classes}`}
    >
      <span>{config.emoji}</span>
      {t(config.key)}
    </span>
  )
}
