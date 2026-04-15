'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'

interface LifecycleEmptyStateProps {
  variant: 'non-gsd' | 'not-bootstrapped'
  onEnable?: () => void
  onBootstrap?: () => void
  isEnabling?: boolean
  isBootstrapping?: boolean
  isViewer?: boolean
}

export function LifecycleEmptyState({
  variant,
  onEnable,
  onBootstrap,
  isEnabling = false,
  isBootstrapping = false,
  isViewer = false,
}: LifecycleEmptyStateProps) {
  const t = useTranslations('project.lifecycle')

  if (variant === 'not-bootstrapped') {
    return (
      <section className="py-8 text-center space-y-3">
        <h3 className="text-base font-semibold">{t('empty.notBootstrapped.heading')}</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {t('empty.notBootstrapped.body')}
        </p>
        <div className="flex justify-center">
          <Button
            variant="default"
            onClick={onBootstrap}
            disabled={isViewer || isBootstrapping}
            aria-label={t('cta.bootstrap')}
            title={isViewer ? 'Viewer role cannot modify project settings' : undefined}
          >
            {isBootstrapping ? (
              <>
                <Loader variant="inline" />
                <span className="ml-2">{t('cta.bootstrap')}</span>
              </>
            ) : (
              t('cta.bootstrap')
            )}
          </Button>
        </div>
      </section>
    )
  }

  // variant === 'non-gsd'
  return (
    <section className="py-8 text-center space-y-3">
      <h3 className="text-base font-semibold">{t('empty.heading')}</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">{t('empty.body')}</p>
      <div className="flex justify-center">
        <Button
          variant="default"
          onClick={onEnable}
          disabled={isViewer || isEnabling}
          aria-label={t('cta.enable')}
          title={isViewer ? 'Viewer role cannot modify project settings' : undefined}
        >
          {isEnabling ? (
            <>
              <Loader variant="inline" />
              <span className="ml-2">{t('cta.enable')}</span>
            </>
          ) : (
            t('cta.enable')
          )}
        </Button>
      </div>
    </section>
  )
}
