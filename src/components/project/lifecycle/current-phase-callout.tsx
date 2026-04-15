'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'

const PHASE_LABEL: Record<string, string> = {
  discuss: 'Discuss',
  plan: 'Plan',
  execute: 'Execute',
  verify: 'Verify',
  done: 'Done',
}

interface CurrentPhaseCalloutProps {
  currentPhase: string
  nextPhase: string | null
  onBootstrap: () => void
  onAdvance: () => void
  hasBeenBootstrapped: boolean
  isAdvancing: boolean
  isBootstrapping: boolean
  isViewer: boolean
}

export function CurrentPhaseCallout({
  currentPhase,
  nextPhase,
  onBootstrap,
  onAdvance,
  hasBeenBootstrapped,
  isAdvancing,
  isBootstrapping,
  isViewer,
}: CurrentPhaseCalloutProps) {
  const t = useTranslations('project.lifecycle')
  const currentLabel = PHASE_LABEL[currentPhase] ?? currentPhase
  const nextLabel = nextPhase ? PHASE_LABEL[nextPhase] ?? nextPhase : null

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {t('currentPhase')}
      </div>
      <div className="mt-1 text-lg font-semibold text-primary">{currentLabel}</div>

      {!isViewer && (
        <div className="mt-3 flex gap-2 flex-wrap">
          {nextLabel && (
            <Button
              variant="default"
              onClick={onAdvance}
              disabled={isAdvancing}
              aria-label={t('cta.advance', { next: nextLabel })}
            >
              {isAdvancing ? (
                <>
                  <Loader variant="inline" />
                  <span className="ml-2">{t('cta.advance', { next: nextLabel })}</span>
                </>
              ) : (
                t('cta.advance', { next: nextLabel })
              )}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={onBootstrap}
            disabled={isBootstrapping}
          >
            {isBootstrapping ? (
              <>
                <Loader variant="inline" />
                <span className="ml-2">
                  {hasBeenBootstrapped ? t('cta.bootstrapRerun') : t('cta.bootstrap')}
                </span>
              </>
            ) : hasBeenBootstrapped ? (
              t('cta.bootstrapRerun')
            ) : (
              t('cta.bootstrap')
            )}
          </Button>
        </div>
      )}
    </section>
  )
}
