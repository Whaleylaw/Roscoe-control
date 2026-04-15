'use client'
import { useTranslations } from 'next-intl'

type TaskLike = { gate_required?: 0 | 1; gate_status?: string }

/**
 * Phase 09 GSD-25, D-06 — renders an approval badge on gate_required tasks.
 * Two-branch render: approved (green) vs anything-else (amber with lock).
 * Emoji prefix ("🔒" / "✓") lives inside the translated string per UI-SPEC
 * (atomic translatable unit — survives i18n extraction unchanged).
 */
export function GateBadge({ task }: { task: TaskLike }) {
  const t = useTranslations('project.lifecycle')
  if (task.gate_required !== 1) return null
  if (task.gate_status === 'approved') {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20">
        {t('gate.statusApproved')}
      </span>
    )
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
      {t('gate.statusRequired')}
    </span>
  )
}
