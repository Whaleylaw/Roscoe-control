'use client'

/**
 * CheckpointRow — per-checkpoint timeline entry for the Progress tab (RUI-03).
 *
 * Pure render-from-props. Fetching + SSE subscription live in ProgressTab,
 * which composes this row. Status dot colors + border treatment follow the
 * LOCKED decisions in 16-CONTEXT.md:
 *   - completed  → green dot
 *   - in_progress → blue dot with pulse
 *   - blocked    → red dot + red border + blocker_reason rendered inline
 *
 * Artifact glyphs are the closed 6-kind set defined in 16-CONTEXT.md — no
 * icon library (CLAUDE.md rule). URLs render as `<a target="_blank">`;
 * all other kinds are text-only per the "no inline previews" lock.
 */

import { useTranslations } from 'next-intl'

export type CheckpointArtifact =
  | { kind: 'file'; path: string; summary?: string }
  | { kind: 'url'; url: string; summary?: string }
  | { kind: 'diff'; path?: string; ref?: string; summary?: string }
  | { kind: 'test_result'; path?: string; url?: string; summary?: string }
  | { kind: 'comment'; summary: string }
  | { kind: 'other'; path?: string; url?: string; ref?: string; summary?: string }

export type Checkpoint = {
  id: number
  task_id: number
  attempt: number
  step: string
  summary: string
  status: 'completed' | 'in_progress' | 'blocked'
  artifacts?: CheckpointArtifact[]
  next_step?: string
  blocker_reason?: string
  tokens_used?: number
  duration_ms?: number
  ts: string
}

const ARTIFACT_GLYPHS: Record<CheckpointArtifact['kind'], string> = {
  file: '📄',
  url: '🔗',
  diff: '📝',
  test_result: '✅',
  comment: '💬',
  other: '✨',
}

export function CheckpointRow({ checkpoint }: { checkpoint: Checkpoint }) {
  const t = useTranslations('taskBoard.progressTab')

  const dotClass =
    checkpoint.status === 'completed'
      ? 'bg-green-500'
      : checkpoint.status === 'in_progress'
        ? 'bg-blue-500 animate-pulse'
        : 'bg-red-500'

  const borderClass =
    checkpoint.status === 'blocked' ? 'border-red-500/40' : 'border-border/50'

  return (
    <div
      data-testid="checkpoint-row"
      data-status={checkpoint.status}
      data-checkpoint-id={checkpoint.id}
      className={`flex gap-3 p-3 border rounded-md ${borderClass}`}
    >
      <span
        data-testid="checkpoint-status-dot"
        className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotClass}`}
        aria-hidden="true"
      />
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{checkpoint.step}</span>
          <span className="text-xs text-muted-foreground">{checkpoint.ts}</span>
        </div>
        <p className="text-sm text-muted-foreground">{checkpoint.summary}</p>
        {checkpoint.status === 'blocked' && checkpoint.blocker_reason && (
          <p className="text-sm text-red-400">
            <span className="font-semibold">{t('blockerPrefix')}</span>{' '}
            {checkpoint.blocker_reason}
          </p>
        )}
        {checkpoint.artifacts && checkpoint.artifacts.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-xs">
            {checkpoint.artifacts.map((a, i) => {
              const glyph = ARTIFACT_GLYPHS[a.kind] ?? ARTIFACT_GLYPHS.other
              const label =
                'path' in a && a.path
                  ? a.path
                  : 'url' in a && a.url
                    ? a.url
                    : 'summary' in a && a.summary
                      ? a.summary
                      : a.kind
              const labelText = `${glyph} ${label}`
              if ('url' in a && a.url) {
                return (
                  <li key={i}>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-muted-foreground hover:text-foreground"
                    >
                      {labelText}
                    </a>
                  </li>
                )
              }
              return (
                <li key={i} className="text-muted-foreground">
                  {labelText}
                </li>
              )
            })}
          </ul>
        )}
        {(checkpoint.tokens_used != null || checkpoint.duration_ms != null) && (
          <div className="flex gap-3 text-xs text-muted-foreground">
            {checkpoint.tokens_used != null && (
              <span>{t('tokensLabel', { tokens: checkpoint.tokens_used })}</span>
            )}
            {checkpoint.duration_ms != null && (
              <span>{t('durationLabel', { ms: checkpoint.duration_ms })}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
