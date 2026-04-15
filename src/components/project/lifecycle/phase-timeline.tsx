'use client'

import { useTranslations } from 'next-intl'

// Literal English phase labels per D-37 — not translated.
const PHASES = ['discuss', 'plan', 'execute', 'verify', 'done'] as const
type Phase = typeof PHASES[number]

const LABELS: Record<Phase, string> = {
  discuss: 'Discuss',
  plan: 'Plan',
  execute: 'Execute',
  verify: 'Verify',
  done: 'Done',
}

const PHASE_ORDER: Record<string, number> = {
  discuss: 0,
  plan: 1,
  execute: 2,
  verify: 3,
  done: 4,
}

interface PhaseTimelineProps {
  currentPhase: string
}

export function PhaseTimeline({ currentPhase }: PhaseTimelineProps) {
  const t = useTranslations('project.lifecycle')
  const curIdx = PHASE_ORDER[currentPhase] ?? 0

  return (
    <section>
      <h3 className="text-sm font-semibold">{t('phaseTimeline')}</h3>
      <ol
        role="list"
        className="mt-3 grid grid-cols-1 sm:grid-cols-5 gap-2"
      >
        {PHASES.map((p, idx) => {
          const state =
            idx < curIdx
              ? 'past'
              : idx === curIdx
                ? 'current'
                : idx === curIdx + 1
                  ? 'next'
                  : 'future'
          const classes = {
            past: 'bg-card border border-border text-muted-foreground',
            current: 'bg-primary text-primary-foreground font-semibold',
            next: 'bg-card border border-border text-foreground',
            future: 'bg-card border border-border/50 text-muted-foreground opacity-60',
          }[state]
          return (
            <li
              key={p}
              aria-current={state === 'current' ? 'step' : undefined}
              className={`rounded px-3 py-2 text-sm text-center ${classes}`}
            >
              {state === 'past' && (
                <span aria-label="completed" className="mr-1">
                  ✓
                </span>
              )}
              {LABELS[p]}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
