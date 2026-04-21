'use client'

/**
 * MountsEditor — Phase 16 Plan 05 (RUI-04).
 *
 * Repeatable row editor for `task.read_only_mounts`:
 *   Array<{ host_path: string; container_path: string; label: string }>
 *
 * Pure controlled component — never mutates the `value` prop; always yields a
 * fresh array via `onChange`. Server remains the source of truth for host-path
 * validation (allowlist, realpath resolution); this editor surfaces per-row
 * errors from the API response via the optional `errors` prop.
 */

import { useTranslations } from 'next-intl'

export type MountEntry = {
  host_path: string
  container_path: string
  label: string
}

export type MountsEditorProps = {
  value: MountEntry[]
  onChange: (next: MountEntry[]) => void
  disabled?: boolean
  /** Optional per-row error messages, keyed by entry index. */
  errors?: Record<number, string>
}

export function MountsEditor({ value, onChange, disabled = false, errors }: MountsEditorProps) {
  const t = useTranslations('taskBoard.advancedSection')

  const updateAt = (index: number, patch: Partial<MountEntry>) => {
    const next = value.map((row, i) => (i === index ? { ...row, ...patch } : row))
    onChange(next)
  }

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const append = () => {
    onChange([...value, { host_path: '', container_path: '', label: '' }])
  }

  return (
    <div className="space-y-2">
      <div className="block text-sm text-muted-foreground">{t('readOnlyMountsLabel')}</div>
      {value.map((row, index) => {
        const rowError = errors?.[index]
        return (
          <div key={index} className="space-y-1">
            <div className="flex gap-2 items-stretch">
              <input
                type="text"
                aria-label={t('hostPathPlaceholder')}
                value={row.host_path}
                onChange={(e) => updateAt(index, { host_path: e.target.value })}
                placeholder={t('hostPathPlaceholder')}
                readOnly={disabled}
                disabled={disabled}
                className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
              />
              <input
                type="text"
                aria-label={t('containerPathPlaceholder')}
                value={row.container_path}
                onChange={(e) => updateAt(index, { container_path: e.target.value })}
                placeholder={t('containerPathPlaceholder')}
                readOnly={disabled}
                disabled={disabled}
                className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
              />
              <input
                type="text"
                aria-label={t('labelPlaceholder')}
                value={row.label}
                onChange={(e) => updateAt(index, { label: e.target.value })}
                placeholder={t('labelPlaceholder')}
                readOnly={disabled}
                disabled={disabled}
                className="w-28 bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
              />
              {!disabled && (
                <button
                  type="button"
                  aria-label={t('removeMount')}
                  onClick={() => removeAt(index)}
                  className="px-2 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md"
                >
                  ✖
                </button>
              )}
            </div>
            {rowError && <p className="text-[11px] text-red-400">{rowError}</p>}
          </div>
        )
      })}
      {!disabled && (
        <button
          type="button"
          onClick={append}
          className="text-xs px-2 py-1 border border-border rounded-md hover:bg-surface-2 text-muted-foreground"
        >
          ➕ {t('addMount')}
        </button>
      )}
    </div>
  )
}
