'use client'

/**
 * AdvancedSection — Phase 16 Plan 05 (RUI-04).
 *
 * Collapsible container on the Create/Edit task form that exposes the three
 * v1.2 runtime fields:
 *   - read_only_mounts   (MountsEditor)
 *   - extra_skills       (SkillsChipInput)
 *   - model_override     (plain text input)
 *
 * Default state is collapsed (session-local — NOT persisted). When `disabled`
 * is true (RECIPE_LOCKED gate on EditTaskModal), a localized `lockedHint`
 * renders under the heading and every subcomponent receives disabled=true.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { MountsEditor, type MountEntry } from './mounts-editor'
import { SkillsChipInput } from './skills-chip-input'

export type AdvancedSectionProps = {
  mounts: MountEntry[]
  onMountsChange: (next: MountEntry[]) => void
  skills: string[]
  onSkillsChange: (next: string[]) => void
  modelOverride: string
  onModelOverrideChange: (next: string) => void
  disabled?: boolean
  lockedHint?: string
  mountErrors?: Record<number, string>
}

export function AdvancedSection({
  mounts,
  onMountsChange,
  skills,
  onSkillsChange,
  modelOverride,
  onModelOverrideChange,
  disabled = false,
  lockedHint,
  mountErrors,
}: AdvancedSectionProps) {
  const t = useTranslations('taskBoard.advancedSection')
  const [expanded, setExpanded] = useState(false)
  const resolvedLockedHint = lockedHint ?? t('lockedHint')

  return (
    <div className="mt-4 border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-secondary/50 transition-colors text-left"
      >
        <span className="text-sm font-medium text-foreground">{t('heading')}</span>
        <span className="text-muted-foreground text-xs">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="p-4 border-t border-border space-y-4">
          {disabled && resolvedLockedHint && (
            <p className="text-[11px] text-amber-500/80">{resolvedLockedHint}</p>
          )}
          <MountsEditor value={mounts} onChange={onMountsChange} disabled={disabled} errors={mountErrors} />
          <SkillsChipInput value={skills} onChange={onSkillsChange} disabled={disabled} />
          <div className="space-y-1">
            <label htmlFor="advanced-model-override" className="block text-sm text-muted-foreground">
              {t('modelOverrideLabel')}
            </label>
            <input
              id="advanced-model-override"
              type="text"
              value={modelOverride}
              onChange={(e) => onModelOverrideChange(e.target.value)}
              placeholder={t('modelOverridePlaceholder')}
              readOnly={disabled}
              disabled={disabled}
              className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
            />
          </div>
        </div>
      )}
    </div>
  )
}
