'use client'

import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { TaskBoardPanel } from '@/components/panels/task-board-panel'

type CaseDetail = {
  summary: {
    slug: string
    name: string
    case_type: string | null
    current_phase: string | null
    date_of_incident: string | null
    jurisdiction: string | null
    legacy_id: string | null
    activity_count: number
    document_count: number
    claim_count: number
    lien_count: number
    landmark_count: number
    satisfied_landmark_count: number
  }
  dashboard: {
    claims: Array<Record<string, string>>
    recent_activity: Array<{ file: string; date: string | null; category: string | null; title: string; excerpt: string }>
  }
  state: {
    current_phase: string | null
    phases: Array<{ key: string; label: string }>
    landmarks: Array<{ key: string; label: string; satisfied: boolean; satisfied_at: string | null; satisfied_by: string | null; evidence: string | null }>
  }
  files: Array<{ name: string; kind: 'markdown' | 'directory' | 'other' }>
}

const VIEWS = ['dashboard', 'tasks', 'workflow', 'activity', 'files'] as const

export function LawFirmCaseWorkspace() {
  const t = useTranslations('lawFirm')
  const router = useRouter()
  const pathname = usePathname()
  const { slug, view } = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean)
    return {
      slug: segments[2] || '',
      view: (segments[3] || 'dashboard') as typeof VIEWS[number],
    }
  }, [pathname])
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [phaseDraft, setPhaseDraft] = useState('')
  const [landmarkDraft, setLandmarkDraft] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/law-firm/cases/${encodeURIComponent(slug)}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : t('detailLoadError'))
      const next = body.case as CaseDetail
      setDetail(next)
      setPhaseDraft(next.state.current_phase || '')
      setLandmarkDraft(Object.fromEntries(next.state.landmarks.map((item) => [item.key, item.satisfied])))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('detailLoadError'))
    } finally {
      setLoading(false)
    }
  }, [slug, t])

  useEffect(() => {
    if (slug) void loadDetail()
  }, [loadDetail, slug])

  const navigate = (nextView: string) => {
    const href = nextView === 'dashboard'
      ? `/law-firm/case/${slug}`
      : `/law-firm/case/${slug}/${nextView}`
    startTransition(() => router.push(href, { scroll: false }))
  }

  const saveWorkflow = useCallback(async () => {
    if (!detail || saving) return
    setSaving(true)
    setFeedback(null)
    try {
      const original = Object.fromEntries(detail.state.landmarks.map((item) => [item.key, item.satisfied]))
      const changedLandmarks = Object.fromEntries(
        Object.entries(landmarkDraft).filter(([key, value]) => original[key] !== value),
      )
      const res = await fetch(`/api/law-firm/cases/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_phase: phaseDraft || undefined, landmarks: changedLandmarks }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : t('saveError'))
      const next = body.case as CaseDetail
      setDetail(next)
      setPhaseDraft(next.state.current_phase || '')
      setLandmarkDraft(Object.fromEntries(next.state.landmarks.map((item) => [item.key, item.satisfied])))
      setFeedback(t('saveSuccess'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'))
    } finally {
      setSaving(false)
    }
  }, [detail, landmarkDraft, phaseDraft, saving, slug, t])

  if (loading && !detail) {
    return <div className="p-6 text-sm text-muted-foreground">{t('detailLoading')}</div>
  }

  if (error && !detail) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <p className="text-lg font-medium text-foreground">{error}</p>
        <Button variant="ghost" onClick={() => router.push('/law-firm', { scroll: false })}>{t('backToCases')}</Button>
      </div>
    )
  }

  if (!detail) return null

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-3 border-b border-border px-4 pt-4">
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => router.push('/law-firm', { scroll: false })}
        >
          {t('backToCases')}
        </button>
        <div>
          <h1 className="text-xl font-semibold text-foreground">{detail.summary.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">{detail.summary.slug}</p>
        </div>
        <nav aria-label={t('caseViews')} className="flex gap-1">
          {VIEWS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => navigate(item)}
              className={`px-3 py-2 text-sm transition-colors ${
                view === item
                  ? 'border-b-2 border-primary text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`caseNav.${item}`)}
            </button>
          ))}
        </nav>
      </div>

      {error && (
        <div className="m-4 rounded-md border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">{error}</div>
      )}
      {feedback && (
        <div className="m-4 rounded-md border border-green-500/20 bg-green-500/5 p-3 text-sm text-green-400">{feedback}</div>
      )}

      {view === 'dashboard' && <CaseDashboard detail={detail} />}
      {view === 'tasks' && <CaseTasksView slug={slug} />}
      {view === 'workflow' && (
        <WorkflowView
          detail={detail}
          phaseDraft={phaseDraft}
          landmarkDraft={landmarkDraft}
          saving={saving}
          onPhaseChange={setPhaseDraft}
          onLandmarkChange={(key, value) => setLandmarkDraft((prev) => ({ ...prev, [key]: value }))}
          onSave={saveWorkflow}
        />
      )}
      {view === 'activity' && <ActivityView detail={detail} />}
      {view === 'files' && <FilesView detail={detail} />}
    </div>
  )
}

function CaseTasksView({ slug }: { slug: string }) {
  const t = useTranslations('lawFirm')
  const [project, setProject] = useState<{ id: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/law-firm/cases/${encodeURIComponent(slug)}/task-project`, { method: 'POST' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : t('taskBoardLoadError'))
        if (!cancelled) setProject(body.project)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('taskBoardLoadError'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [slug, t])

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">{t('taskBoardLoading')}</div>
  }

  if (error || !project) {
    return (
      <div className="m-6 rounded-md border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
        {error || t('taskBoardLoadError')}
      </div>
    )
  }

  return (
    <TaskBoardPanel
      scope={{
        lockedProjectId: project.id,
        hideProjectFilter: true,
        hideProjectLabels: true,
        includeHiddenProjects: true,
        defaultCreateProjectId: project.id,
      }}
    />
  )
}

function CaseDashboard({ detail }: { detail: CaseDetail }) {
  const t = useTranslations('lawFirm')
  return (
    <div className="p-6 space-y-6">
      <section className="grid gap-3 md:grid-cols-4">
        <Metric label={t('caseType')} value={formatLabel(detail.summary.case_type) || t('unknown')} />
        <Metric label={t('incidentDate')} value={detail.summary.date_of_incident || t('unknown')} />
        <Metric label={t('currentPhase')} value={formatLabel(detail.summary.current_phase) || t('unknown')} />
        <Metric label={t('metrics.landmarks')} value={`${detail.summary.satisfied_landmark_count}/${detail.summary.landmark_count}`} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-md border bg-card p-4">
          <h2 className="mb-3 text-base font-semibold">{t('claims')}</h2>
          {detail.dashboard.claims.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noClaims')}</p>
          ) : (
            <div className="space-y-2">
              {detail.dashboard.claims.map((claim, index) => (
                <div key={`${claim.claim_number}-${index}`} className="rounded border bg-background p-3 text-sm">
                  <div className="font-medium text-foreground">{claim.type || t('unknown')}</div>
                  <div className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>{t('carrier')}: {claim.carrier || t('unknown')}</span>
                    <span>{t('claimNumber')}: {claim.claim_number || t('unknown')}</span>
                    <span>{t('policyLimit')}: {claim.policy_limit || claim.policy_limits || t('unknown')}</span>
                    <span>{t('status')}: {claim.status || t('unknown')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border bg-card p-4">
          <h2 className="mb-3 text-base font-semibold">{t('recentActivity')}</h2>
          <ActivityList items={detail.dashboard.recent_activity.slice(0, 8)} />
        </div>
      </section>
    </div>
  )
}

function WorkflowView({
  detail,
  phaseDraft,
  landmarkDraft,
  saving,
  onPhaseChange,
  onLandmarkChange,
  onSave,
}: {
  detail: CaseDetail
  phaseDraft: string
  landmarkDraft: Record<string, boolean>
  saving: boolean
  onPhaseChange: (value: string) => void
  onLandmarkChange: (key: string, value: boolean) => void
  onSave: () => void
}) {
  const t = useTranslations('lawFirm')
  return (
    <div className="p-6 space-y-4">
      <label className="block max-w-md space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t('currentPhase')}</span>
        <select
          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          value={phaseDraft}
          onChange={(event) => onPhaseChange(event.target.value)}
        >
          {detail.state.phases.map((phase) => (
            <option key={phase.key} value={phase.key}>{phase.label}</option>
          ))}
        </select>
      </label>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {detail.state.landmarks.map((landmark) => (
          <label key={landmark.key} className="flex items-start gap-2 rounded border bg-card p-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={Boolean(landmarkDraft[landmark.key])}
              onChange={(event) => onLandmarkChange(landmark.key, event.target.checked)}
            />
            <span>
              <span className="block text-foreground">{landmark.label}</span>
              {landmark.satisfied_at && <span className="text-xs text-muted-foreground">{t('satisfiedAt')}: {landmark.satisfied_at}</span>}
            </span>
          </label>
        ))}
      </div>
      <Button onClick={onSave} disabled={saving}>{saving ? t('saving') : t('saveWorkflow')}</Button>
    </div>
  )
}

function ActivityView({ detail }: { detail: CaseDetail }) {
  return <div className="p-6"><ActivityList items={detail.dashboard.recent_activity} /></div>
}

function FilesView({ detail }: { detail: CaseDetail }) {
  return (
    <div className="p-6">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {detail.files.map((file) => (
          <div key={file.name} className="rounded border bg-card p-3">
            <div className="font-mono text-sm text-foreground">{file.name}</div>
            <div className="text-xs text-muted-foreground">{file.kind}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ActivityList({ items }: { items: CaseDetail['dashboard']['recent_activity'] }) {
  const t = useTranslations('lawFirm')
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t('noActivity')}</p>
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <article key={item.file} className="rounded border bg-background p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{item.title}</span>
            {item.category && <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.category}</span>}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{item.date || item.file}</div>
          {item.excerpt && <p className="mt-2 text-sm text-muted-foreground">{item.excerpt}</p>}
        </article>
      ))}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  )
}

function formatLabel(value: string | null): string {
  if (!value) return ''
  return value.replace(/_/g, ' ')
}
