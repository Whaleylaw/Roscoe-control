'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { EmailReviewerPanel } from '@/components/panels/email-reviewer-panel'

type LawFirmCase = {
  slug: string
  name: string
  case_type: string | null
  current_phase: string | null
  date_of_incident: string | null
  jurisdiction: string | null
  legacy_id: string | null
  updated_at: number
  activity_count: number
  document_count: number
  claim_count: number
  lien_count: number
  landmark_count: number
  satisfied_landmark_count: number
}

export function LawFirmPanel() {
  const t = useTranslations('lawFirm')
  const router = useRouter()
  const [cases, setCases] = useState<LawFirmCase[]>([])
  const [root, setRoot] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeView, setActiveView] = useState<'cases' | 'email'>('cases')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCases = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/law-firm/cases', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : t('loadError'))
      setCases(Array.isArray(body?.cases) ? body.cases : [])
      setRoot(typeof body?.root === 'string' ? body.root : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void fetchCases()
  }, [fetchCases])

  const filteredCases = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return cases
    return cases.filter((item) => {
      return [
        item.name,
        item.slug,
        item.case_type,
        item.current_phase,
        item.jurisdiction,
        item.legacy_id,
      ].some((value) => String(value || '').toLowerCase().includes(needle))
    })
  }, [cases, query])

  const totalLandmarks = cases.reduce((sum, item) => sum + item.landmark_count, 0)
  const satisfiedLandmarks = cases.reduce((sum, item) => sum + item.satisfied_landmark_count, 0)
  const activePhaseCount = new Set(cases.map((item) => item.current_phase).filter(Boolean)).size

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-start gap-4 border-b border-border p-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-foreground">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          {root && <p className="mt-1 text-xs font-mono text-muted-foreground/70 truncate">{root}</p>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="inline-flex rounded-md border border-border bg-card p-1 text-sm">
            <button
              type="button"
              onClick={() => setActiveView('cases')}
              className={`rounded px-3 py-1.5 ${activeView === 'cases' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Cases
            </button>
            <button
              type="button"
              onClick={() => setActiveView('email')}
              className={`rounded px-3 py-1.5 ${activeView === 'email' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Email
            </button>
          </div>
          <Button variant="secondary" onClick={fetchCases} disabled={loading || activeView !== 'cases'}>
            {loading ? t('refreshing') : t('refresh')}
          </Button>
        </div>
      </header>

      {activeView === 'email' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <EmailReviewerPanel />
        </div>
      ) : (
        <>
      <section className="grid gap-3 border-b border-border p-4 md:grid-cols-3">
        <Metric label={t('metrics.cases')} value={String(cases.length)} />
        <Metric label={t('metrics.phases')} value={String(activePhaseCount)} />
        <Metric
          label={t('metrics.landmarks')}
          value={`${satisfiedLandmarks}/${totalLandmarks || 0}`}
        />
      </section>

      <div className="border-b border-border p-4">
        <input
          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="m-4 rounded-md border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {loading && cases.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">{t('loading')}</p>
        )}

        {!loading && !error && filteredCases.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
            <p className="text-sm text-muted-foreground">
              {query ? t('emptySearch') : t('empty')}
            </p>
          </div>
        )}

        {filteredCases.length > 0 && (
          <ul className="divide-y divide-border">
            {filteredCases.map((item) => (
              <li key={item.slug}>
                <button
                  type="button"
                  className="w-full px-4 py-3 text-left transition-colors hover:bg-secondary/60 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  onClick={() => router.push(`/law-firm/case/${item.slug}`, { scroll: false })}
                >
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">{item.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{item.slug}</span>
                        {item.current_phase && (
                          <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-300">
                            {formatLabel(item.current_phase)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{t('caseType')}: {formatLabel(item.case_type) || t('unknown')}</span>
                        <span>{t('incidentDate')}: {item.date_of_incident || t('unknown')}</span>
                        <span>{t('jurisdiction')}: {item.jurisdiction || t('unknown')}</span>
                        {item.legacy_id && <span>{t('legacyId')}: {item.legacy_id}</span>}
                      </div>
                    </div>
                    <div className="grid shrink-0 grid-cols-4 gap-2 text-center text-xs">
                      <MiniMetric label={t('activity')} value={item.activity_count} />
                      <MiniMetric label={t('docs')} value={item.document_count} />
                      <MiniMetric label={t('claims')} value={item.claim_count} />
                      <MiniMetric label={t('liens')} value={item.lien_count} />
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-12 rounded border bg-background px-2 py-1">
      <div className="font-semibold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

function formatLabel(value: string | null): string {
  if (!value) return ''
  return value.replace(/_/g, ' ')
}
