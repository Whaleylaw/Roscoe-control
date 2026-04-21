'use client'

/**
 * SkillsChipInput — Phase 16 Plan 05 (RUI-04).
 *
 * Chip-style input for `task.extra_skills: string[]`.
 *
 * UX:
 *   - Existing values render as chips with a ✖ remove affordance.
 *   - Enter on the input commits the trimmed value to the array, iff it's
 *     non-empty AND not already present.
 *   - Backspace on an empty input removes the last chip.
 *   - When disabled, chips render without the ✖ and the input is readonly.
 *
 * Pure controlled component — never mutates the `value` prop.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'

export type SkillsChipInputProps = {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

export function SkillsChipInput({ value, onChange, disabled = false }: SkillsChipInputProps) {
  const t = useTranslations('taskBoard.advancedSection')
  const [draft, setDraft] = useState('')

  const commit = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (value.includes(trimmed)) {
      setDraft('')
      return
    }
    onChange([...value, trimmed])
    setDraft('')
  }

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      return
    }
    if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="space-y-2">
      <div className="block text-sm text-muted-foreground">{t('extraSkillsLabel')}</div>
      <div className="flex flex-wrap gap-1">
        {value.map((skill, index) => (
          <span
            key={`${skill}-${index}`}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border bg-surface-2"
          >
            <span className="font-mono">{skill}</span>
            {!disabled && (
              <button
                type="button"
                aria-label={`${t('removeSkill')}: ${skill}`}
                onClick={() => removeAt(index)}
                className="text-muted-foreground hover:text-foreground"
              >
                ✖
              </button>
            )}
          </span>
        ))}
      </div>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('skillPlaceholder')}
        readOnly={disabled}
        disabled={disabled}
        className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
      />
    </div>
  )
}
