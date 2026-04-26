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

type WorkflowPreview = {
  workflow_instances: Array<{
    workflow_instance_id: number
    workflow_key: string
    definition_slug: string
    definition_name: string
    definition_version: number
    status: 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'
    started_by: string
    started_at: number
    completed_at: number | null
    updated_at: number
    total_nodes: number
    ready_nodes: number
    running_nodes: number
    waiting_nodes: number
    blocked_nodes: number
    complete_nodes: number
    failed_nodes: number
    task_count: number
    nodes: Array<{
      id: number
      node_key: string
      node_type: 'recipe' | 'review' | 'wait' | 'code' | 'gateway' | 'gate'
      status: 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'complete' | 'failed' | 'skipped' | 'cancelled'
      recipe_slug: string | null
      task_id: number | null
      due_at: number | null
      completed_at: number | null
      blocked_by: string[]
    }>
  }>
  ready_items: Array<{
    workflow_key: string
    phase_name: string
    landmark_name: string
    priority: string
    status: string
    blocked_by: string[]
  }>
  workflows: Array<{
    workflow_id: string
    name: string
    goal: string
    phase_id: string
    source: string | null
    enabled: boolean
    status: 'active' | 'complete' | 'not_started' | 'blocked'
    completed_steps: number
    total_steps: number
    active_steps: number
    blocked_by: string[]
    steps: Array<{
      id: string
      type: 'recipe' | 'wait' | 'human_review' | 'code'
      landmark_id: string
      recipe_slug: string | null
      status: 'ready' | 'complete' | 'blocked' | 'waiting' | 'skipped'
      depends_on: string[]
      blocked_by: string[]
      wait_days: number | null
      skip_when: string[]
    }>
  }>
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
  const [workflowPreview, setWorkflowPreview] = useState<WorkflowPreview | null>(null)
  const [workflowLoading, setWorkflowLoading] = useState(false)
  const [workflowMaterializing, setWorkflowMaterializing] = useState(false)
  const [workflowOverriding, setWorkflowOverriding] = useState<string | null>(null)
  const [workflowInstanceUpdating, setWorkflowInstanceUpdating] = useState<string | null>(null)
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

  const loadWorkflowPreview = useCallback(async () => {
    if (!slug) return
    setWorkflowLoading(true)
    try {
      const res = await fetch(`/api/law-firm/cases/${encodeURIComponent(slug)}/workflow`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : t('workflowPreviewError'))
      setWorkflowPreview({
        workflow_instances: Array.isArray(body.workflow_instances) ? body.workflow_instances : [],
        ready_items: Array.isArray(body.ready_items) ? body.ready_items : [],
        workflows: Array.isArray(body.workflows) ? body.workflows : [],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workflowPreviewError'))
    } finally {
      setWorkflowLoading(false)
    }
  }, [slug, t])

  useEffect(() => {
    if (slug && view === 'workflow') void loadWorkflowPreview()
  }, [loadWorkflowPreview, slug, view])

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

  const materializeWorkflow = useCallback(async () => {
    if (workflowMaterializing) return
    setWorkflowMaterializing(true)
    setFeedback(null)
    try {
      const res = await fetch(`/api/law-firm/cases/${encodeURIComponent(slug)}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : t('workflowMaterializeError'))
      setFeedback(t('workflowMaterializeSuccess', {
        created: Array.isArray(body.created) ? body.created.length : 0,
        skipped: Array.isArray(body.skipped) ? body.skipped.length : 0,
      }))
      await loadWorkflowPreview()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workflowMaterializeError'))
    } finally {
      setWorkflowMaterializing(false)
    }
  }, [loadWorkflowPreview, slug, t, workflowMaterializing])

  const updateWorkflowOverride = useCallback(async (workflowId: string, action: 'activate' | 'close') => {
    if (workflowOverriding) return
    setWorkflowOverriding(`${workflowId}:${action}`)
    setFeedback(null)
    try {
      const res = await fetch(`/api/law-firm/cases/${encodeURIComponent(slug)}/workflow`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_id: workflowId, action }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : t('workflowPreviewError'))
      setWorkflowPreview((prev) => ({
        workflow_instances: prev?.workflow_instances ?? [],
        ready_items: prev?.ready_items ?? [],
        workflows: Array.isArray(body.workflows) ? body.workflows : prev?.workflows ?? [],
      }))
      setFeedback(action === 'activate' ? 'Workflow activated' : 'Workflow closed')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workflowPreviewError'))
    } finally {
      setWorkflowOverriding(null)
    }
  }, [slug, t, workflowOverriding])

  const cancelWorkflowInstance = useCallback(async (workflowInstanceId: number) => {
    if (workflowInstanceUpdating !== null) return
    setWorkflowInstanceUpdating(`cancel:${workflowInstanceId}`)
    setFeedback(null)
    try {
      const res = await fetch(`/api/law-firm/cases/${encodeURIComponent(slug)}/workflow`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel_instance',
          workflow_instance_id: workflowInstanceId,
          reason: 'Cancelled from the case Workflow tab.',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : t('workflowPreviewError'))
      setWorkflowPreview((prev) => ({
        workflow_instances: Array.isArray(body.workflow_instances) ? body.workflow_instances : prev?.workflow_instances ?? [],
        ready_items: prev?.ready_items ?? [],
        workflows: prev?.workflows ?? [],
      }))
      setFeedback('Workflow instance cancelled')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workflowPreviewError'))
    } finally {
      setWorkflowInstanceUpdating(null)
    }
  }, [slug, t, workflowInstanceUpdating])

  const bypassWorkflowNode = useCallback(async (workflowInstanceId: number, nodeKey: string) => {
    if (workflowInstanceUpdating !== null) return
    setWorkflowInstanceUpdating(`bypass:${workflowInstanceId}:${nodeKey}`)
    setFeedback(null)
    try {
      const res = await fetch(`/api/law-firm/cases/${encodeURIComponent(slug)}/workflow`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bypass_node',
          workflow_instance_id: workflowInstanceId,
          node_key: nodeKey,
          reason: 'Marked not applicable from the case Workflow tab.',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : t('workflowPreviewError'))
      setWorkflowPreview((prev) => ({
        workflow_instances: Array.isArray(body.workflow_instances) ? body.workflow_instances : prev?.workflow_instances ?? [],
        ready_items: prev?.ready_items ?? [],
        workflows: prev?.workflows ?? [],
      }))
      setFeedback('Workflow node marked not applicable')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workflowPreviewError'))
    } finally {
      setWorkflowInstanceUpdating(null)
    }
  }, [slug, t, workflowInstanceUpdating])

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
          workflowPreview={workflowPreview}
          workflowLoading={workflowLoading}
          workflowMaterializing={workflowMaterializing}
          workflowOverriding={workflowOverriding}
          workflowInstanceUpdating={workflowInstanceUpdating}
          onMaterialize={materializeWorkflow}
          onWorkflowOverride={updateWorkflowOverride}
          onCancelWorkflowInstance={cancelWorkflowInstance}
          onBypassWorkflowNode={bypassWorkflowNode}
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
  workflowPreview,
  workflowLoading,
  workflowMaterializing,
  workflowOverriding,
  workflowInstanceUpdating,
  onMaterialize,
  onWorkflowOverride,
  onCancelWorkflowInstance,
  onBypassWorkflowNode,
}: {
  workflowPreview: WorkflowPreview | null
  workflowLoading: boolean
  workflowMaterializing: boolean
  workflowOverriding: string | null
  workflowInstanceUpdating: string | null
  onMaterialize: () => void
  onWorkflowOverride: (workflowId: string, action: 'activate' | 'close') => void
  onCancelWorkflowInstance: (workflowInstanceId: number) => void
  onBypassWorkflowNode: (workflowInstanceId: number, nodeKey: string) => void
}) {
  const t = useTranslations('lawFirm')
  const workflowInstances = workflowPreview?.workflow_instances ?? []
  const readyItems = workflowPreview?.ready_items ?? []
  const workflows = workflowPreview?.workflows ?? []
  const grouped = {
    active: workflows.filter((workflow) => workflow.status === 'active' || workflow.status === 'blocked'),
    not_started: workflows.filter((workflow) => workflow.status === 'not_started'),
    complete: workflows.filter((workflow) => workflow.status === 'complete'),
  }
  return (
    <div className="p-6 space-y-4">
      <div className="rounded-md border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Workflow Activity</h2>
            <p className="text-sm text-muted-foreground">
              Actual workflow instances running for this case. Agent work appears on the existing Tasks board.
            </p>
          </div>
          <span className="rounded border px-2 py-1 text-xs text-muted-foreground">{workflowInstances.length} instances</span>
        </div>
        {workflowInstances.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No workflow instances have started for this case yet.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {workflowInstances.map((workflow) => (
              <article key={workflow.workflow_instance_id} className="rounded-md border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-foreground">{workflow.definition_name}</h3>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">{workflow.definition_slug} v{workflow.definition_version}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${workflowInstanceTone(workflow.status)}`}>
                      {formatLabel(workflow.status)}
                    </span>
                    {workflow.status === 'active' || workflow.status === 'blocked' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCancelWorkflowInstance(workflow.workflow_instance_id)}
                        disabled={workflowInstanceUpdating !== null}
                      >
                        {workflowInstanceUpdating === `cancel:${workflow.workflow_instance_id}` ? 'Cancelling' : 'Cancel'}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-5 gap-2 text-center text-xs">
                  <WorkflowMetric label="Ready" value={workflow.ready_nodes} />
                  <WorkflowMetric label="Running" value={workflow.running_nodes} />
                  <WorkflowMetric label="Waiting" value={workflow.waiting_nodes} />
                  <WorkflowMetric label="Blocked" value={workflow.blocked_nodes} />
                  <WorkflowMetric label="Done" value={`${workflow.complete_nodes}/${workflow.total_nodes}`} />
                </div>
                <div className="mt-3 space-y-1.5">
                  {workflow.nodes.map((node) => (
                    <div key={node.id} className="rounded border px-2 py-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-foreground">
                          {formatLabel(node.node_key)}
                          {node.task_id ? <span className="ml-1 text-muted-foreground">#{node.task_id}</span> : null}
                          {node.due_at ? <span className="ml-1 text-purple-500">due {formatUnixTime(node.due_at)}</span> : null}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {canBypassWorkflowNode(node.status) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onBypassWorkflowNode(workflow.workflow_instance_id, node.node_key)}
                              disabled={workflowInstanceUpdating !== null}
                            >
                              {workflowInstanceUpdating === `bypass:${workflow.workflow_instance_id}:${node.node_key}` ? 'Bypassing' : 'Not Applicable'}
                            </Button>
                          ) : null}
                          <span className={`rounded px-1.5 py-0.5 ${workflowNodeTone(node.status)}`}>{formatLabel(node.status)}</span>
                        </div>
                      </div>
                      {node.blocked_by.length > 0 && (
                        <div className="mt-1 text-amber-500">Blocked by: {node.blocked_by.join(', ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t('workflowTasksTitle')}</h2>
            <p className="text-sm text-muted-foreground">
              {workflowLoading ? t('workflowPreviewLoading') : t('workflowTasksSummary', { count: readyItems.length })}
            </p>
          </div>
          <Button onClick={onMaterialize} disabled={workflowMaterializing || workflowLoading}>
            {workflowMaterializing ? t('workflowMaterializing') : t('materializeWorkflow')}
          </Button>
        </div>
        {readyItems.length > 0 && (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {readyItems.slice(0, 6).map((item) => (
              <div key={item.workflow_key} className="rounded border bg-background p-3 text-sm">
                <div className="font-medium text-foreground">{item.landmark_name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{item.phase_name} · {item.priority} · {item.status}</div>
                {item.blocked_by.length > 0 && (
                  <div className="mt-1 text-xs text-amber-500">{t('blockedBy')}: {item.blocked_by.join(', ')}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <WorkflowColumn title="Active" workflows={grouped.active} empty="No active workflows" workflowOverriding={workflowOverriding} onWorkflowOverride={onWorkflowOverride} />
        <WorkflowColumn title="Not Started" workflows={grouped.not_started} empty="No hidden workflows are ready yet" workflowOverriding={workflowOverriding} onWorkflowOverride={onWorkflowOverride} />
        <WorkflowColumn title="Complete" workflows={grouped.complete} empty="No completed workflows" workflowOverriding={workflowOverriding} onWorkflowOverride={onWorkflowOverride} />
      </div>
    </div>
  )
}

function WorkflowColumn({
  title,
  workflows,
  empty,
  workflowOverriding,
  onWorkflowOverride,
}: {
  title: string
  workflows: NonNullable<WorkflowPreview['workflows']>
  empty: string
  workflowOverriding: string | null
  onWorkflowOverride: (workflowId: string, action: 'activate' | 'close') => void
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{workflows.length}</span>
      </div>
      <div className="space-y-3">
        {workflows.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{empty}</p>
        ) : workflows.map((workflow) => (
          <article key={workflow.workflow_id} className="rounded-md border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-foreground">{workflow.name}</h4>
                <p className="mt-1 text-xs text-muted-foreground">{workflow.goal}</p>
              </div>
              <span className="shrink-0 rounded border px-2 py-0.5 text-[11px] text-muted-foreground">
                {workflow.completed_steps}/{workflow.total_steps}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {workflow.steps.map((step) => (
                <div key={step.id} className="rounded border bg-background p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-foreground">{formatLabel(step.id)}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 ${workflowStepTone(step.status)}`}>{formatLabel(step.status)}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {step.type}{step.recipe_slug ? ` · ${step.recipe_slug}` : ''}{step.wait_days ? ` · wait ${step.wait_days} days` : ''}
                  </div>
                  {step.blocked_by.length > 0 && (
                    <div className="mt-1 text-amber-500">Blocked by: {step.blocked_by.join(', ')}</div>
                  )}
                </div>
              ))}
            </div>
            {!workflow.enabled && (
              <div className="mt-3 rounded border border-dashed px-2 py-1 text-xs text-muted-foreground">
                Cataloged from FirmVault SOPs; not enabled for task materialization yet.
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onWorkflowOverride(workflow.workflow_id, 'activate')}
                disabled={workflow.status === 'active' || workflowOverriding !== null}
              >
                Activate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onWorkflowOverride(workflow.workflow_id, 'close')}
                disabled={workflow.status === 'complete' || workflowOverriding !== null}
              >
                Close
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function workflowStepTone(status: WorkflowPreview['workflows'][number]['steps'][number]['status']): string {
  if (status === 'complete' || status === 'skipped') return 'bg-green-500/10 text-green-500'
  if (status === 'ready') return 'bg-blue-500/10 text-blue-500'
  if (status === 'waiting') return 'bg-purple-500/10 text-purple-500'
  return 'bg-amber-500/10 text-amber-500'
}

function workflowInstanceTone(status: WorkflowPreview['workflow_instances'][number]['status']): string {
  if (status === 'complete') return 'bg-green-500/10 text-green-500'
  if (status === 'failed' || status === 'cancelled') return 'bg-red-500/10 text-red-500'
  if (status === 'blocked') return 'bg-amber-500/10 text-amber-500'
  return 'bg-blue-500/10 text-blue-500'
}

function workflowNodeTone(status: WorkflowPreview['workflow_instances'][number]['nodes'][number]['status']): string {
  if (status === 'complete' || status === 'skipped') return 'bg-green-500/10 text-green-500'
  if (status === 'ready') return 'bg-blue-500/10 text-blue-500'
  if (status === 'running') return 'bg-yellow-500/10 text-yellow-500'
  if (status === 'waiting') return 'bg-purple-500/10 text-purple-500'
  if (status === 'failed' || status === 'cancelled') return 'bg-red-500/10 text-red-500'
  return 'bg-amber-500/10 text-amber-500'
}

function canBypassWorkflowNode(status: WorkflowPreview['workflow_instances'][number]['nodes'][number]['status']): boolean {
  return ['pending', 'ready', 'waiting', 'blocked'].includes(status)
}

function WorkflowMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border bg-card/50 px-2 py-1">
      <div className="font-semibold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
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

function formatUnixTime(value: number): string {
  try {
    return new Date(value * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return String(value)
  }
}
