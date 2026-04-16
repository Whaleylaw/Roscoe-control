'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import type { Task } from '@/store'
import { useProjectWorkspace } from '@/components/project/project-context'
import { PhaseTimeline } from '@/components/project/lifecycle/phase-timeline'
import { CurrentPhaseCallout } from '@/components/project/lifecycle/current-phase-callout'
import { GateTaskList } from '@/components/project/lifecycle/gate-task-list'
import { LifecycleEmptyState } from '@/components/project/lifecycle/empty-state'
import { LifecycleHierarchy } from '@/components/project/lifecycle/lifecycle-hierarchy'
import { Loader } from '@/components/ui/loader'

// NEXT_PHASE map is kept inline per plan (no new shared export in this plan).
const NEXT_PHASE: Record<string, string | null> = {
  discuss: 'plan',
  plan: 'execute',
  execute: 'verify',
  verify: 'done',
  done: null,
}

interface LifecycleGraphPlan {
  id: number
  plan_ref: string
  title: string
  wave: number
  status: string
  depends_on_plan_ids: string
  updated_at: number
}

interface LifecycleGraphPhase {
  id: number
  phase_key: string
  phase_slug: string
  lifecycle_phase: string
  ordering_numeric: number
  status: string
  depends_on_phase_ids: string
  updated_at: number
  plans: LifecycleGraphPlan[]
}

interface LifecycleGraphMilestone {
  id: number
  version_label: string
  title: string
  status: string
  workstream_id?: number | null
  updated_at: number
  phases: LifecycleGraphPhase[]
}

interface LifecycleGraphWorkstream {
  id: number
  key: string
  name: string
  status: string
  updated_at: number
  milestones: LifecycleGraphMilestone[]
}

interface LifecycleGraphResponse {
  rollups: {
    active_workstreams: number
    active_milestones: number
    active_phases: number
    in_progress_plans: number
    blocked_gates: number
    wave_conflicts: number
  }
  workstreams: LifecycleGraphWorkstream[]
  unscopedMilestones: LifecycleGraphMilestone[]
  legacy: {
    enabled: boolean
    current_phase: string
    track: string | null
    gate_mode: string | null
    task_counts: Array<{ phase: string; count: number }>
    fallback_active: boolean
  }
}

interface LifecycleRealtimeEvent {
  type: string
  data: Record<string, unknown> | null
  timestamp: number
}

function formatHierarchyConflictMessage(data: Record<string, unknown> | null | undefined): string {
  const code = String(data?.code ?? '')
  const phaseBlockers = Array.isArray(data?.blocking_phase_ids)
    ? (data?.blocking_phase_ids as number[])
    : []
  const planBlockers = Array.isArray(data?.blocking_plan_ids)
    ? (data?.blocking_plan_ids as number[])
    : []
  const conflictingPaths = Array.isArray(data?.conflicting_paths)
    ? (data?.conflicting_paths as string[])
    : []

  switch (code) {
    case 'DEPENDENCY_BLOCKED':
      return `Phase is blocked by incomplete dependency phases: ${phaseBlockers.join(', ')}.`
    case 'PHASE_ORDER_BLOCKED':
      return `Phase is blocked by earlier incomplete phases: ${phaseBlockers.join(', ')}.`
    case 'PLAN_DEPENDENCY_BLOCKED':
      return `Plan is blocked by unfinished plan dependencies: ${planBlockers.join(', ')}.`
    case 'WAVE_CONFLICT_BLOCKED':
      return conflictingPaths.length > 0
        ? `Plan is blocked by same-wave conflicts on: ${conflictingPaths.join(', ')}.`
        : `Plan is blocked by active same-wave plan conflicts: ${planBlockers.join(', ')}.`
    case 'OPTIMISTIC_LOCK_FAILED':
      return 'This item changed since you last loaded it. Refresh and retry.'
    default:
      return String(data?.error ?? 'Hierarchy update is blocked by an unresolved dependency.')
  }
}

export function LifecycleView() {
  const t = useTranslations('project.lifecycle')
  const { project } = useProjectWorkspace()
  const { currentUser, tasks, fetchProjects } = useMissionControl()
  const isViewer = currentUser?.role === 'viewer'

  const [bannerError, setBannerError] = useState<string | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(false)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [isEnabling, setIsEnabling] = useState(false)
  const [graph, setGraph] = useState<LifecycleGraphResponse | null>(null)
  const [isGraphLoading, setIsGraphLoading] = useState(false)

  const projectTasks: Task[] = useMemo(
    () => tasks.filter((x) => x.project_id === project?.id),
    [tasks, project?.id]
  )

  const hasLegacyTasks = useMemo(
    () => projectTasks.some((x) => x.gsd_phase != null),
    [projectTasks]
  )

  const gateTasks = useMemo(
    () => projectTasks.filter((x) => x.gate_required === 1),
    [projectTasks]
  )

  const currentPhase = project?.gsd_phase ?? 'discuss'
  const nextPhase = NEXT_PHASE[currentPhase] ?? null
  const hasHierarchyData = (graph?.workstreams.length ?? 0) > 0 || (graph?.unscopedMilestones.length ?? 0) > 0
  const shouldRenderLegacy = Boolean(graph?.legacy.fallback_active && graph?.legacy.enabled)
  const shouldRenderBootstrapEmpty =
    project?.gsd_enabled === 1 &&
    !isGraphLoading &&
    !hasHierarchyData &&
    !shouldRenderLegacy

  const makeLegacyFallback = useCallback((): LifecycleGraphResponse | null => {
    if (!project) return null
    return {
      rollups: {
        active_workstreams: 0,
        active_milestones: 0,
        active_phases: 0,
        in_progress_plans: 0,
        blocked_gates: gateTasks.filter((task) => task.gate_status !== 'approved').length,
        wave_conflicts: 0,
      },
      workstreams: [],
      unscopedMilestones: [],
      legacy: {
        enabled: hasLegacyTasks,
        current_phase: currentPhase,
        track: project.gsd_track ?? null,
        gate_mode: project.gsd_gate_mode ?? null,
        task_counts: [],
        fallback_active: hasLegacyTasks,
      },
    }
  }, [currentPhase, gateTasks, hasLegacyTasks, project])

  const refetchGraph = useCallback(async () => {
    if (!project || project.gsd_enabled !== 1) {
      setGraph(null)
      setIsGraphLoading(false)
      return
    }

    setIsGraphLoading(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/gsd/lifecycle-graph`)
      if (!res.ok) {
        throw new Error('Failed to load lifecycle graph')
      }
      const data = await res.json() as LifecycleGraphResponse
      setGraph(data)
    } catch {
      setGraph(makeLegacyFallback())
      setBannerError('Failed to load lifecycle graph')
    } finally {
      setIsGraphLoading(false)
    }
  }, [makeLegacyFallback, project])

  useEffect(() => {
    void refetchGraph()
  }, [refetchGraph])

  useEffect(() => {
    if (!project || typeof window === 'undefined' || typeof EventSource === 'undefined') return

    const source = new EventSource('/api/events')
    source.onmessage = (event) => {
      let payload: LifecycleRealtimeEvent | null = null
      try {
        payload = JSON.parse(event.data) as LifecycleRealtimeEvent
      } catch {
        return
      }
      if (!payload || !payload.type.startsWith('gsd.')) return
      const eventProjectId = Number(payload.data?.project_id ?? 0)
      if (eventProjectId !== project.id) return

      if (payload.type === 'gsd.conflict.detected') {
        setBannerError(formatHierarchyConflictMessage(payload.data))
      }
      void refetchGraph()
    }

    return () => {
      source.close()
    }
  }, [project, refetchGraph])

  const dismissBanner = useCallback(() => setBannerError(null), [])

  const getApiErrorMessage = useCallback(async (response: Response, fallback: string) => {
    try {
      const data = await response.json() as {
        error?: string
        details?: string[]
        code?: string
        blocking_phase_ids?: number[]
        blocking_plan_ids?: number[]
      }
      if (
        data.code === 'DEPENDENCY_BLOCKED' ||
        data.code === 'PHASE_ORDER_BLOCKED' ||
        data.code === 'PLAN_DEPENDENCY_BLOCKED' ||
        data.code === 'WAVE_CONFLICT_BLOCKED'
      ) {
        return formatHierarchyConflictMessage(data)
      }
      if (Array.isArray(data.details) && data.details.length > 0) {
        return `${data.error ?? fallback}: ${data.details.join('; ')}`
      }
      if (data.error) return data.error
    } catch {
      /* noop */
    }
    return fallback
  }, [])

  const runHierarchyMutation = useCallback(async (
    input: {
      url: string
      method?: 'POST' | 'PATCH'
      body?: Record<string, unknown>
      fallbackError: string
      refreshProjects?: boolean
    }
  ) => {
    setBannerError(null)
    const res = await fetch(input.url, {
      method: input.method ?? 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.body ?? {}),
    })
    if (!res.ok) {
      setBannerError(await getApiErrorMessage(res, input.fallbackError))
      return false
    }
    if (input.refreshProjects) {
      await fetchProjects()
    }
    await refetchGraph()
    return true
  }, [fetchProjects, getApiErrorMessage, refetchGraph])

  const surfaceTransitionError = useCallback(
    async (response: Response): Promise<void> => {
      let data: { error?: string; code?: string; to_phase?: string; reason?: string; remedy?: string } = {}
      try {
        data = await response.json()
      } catch {
        /* noop */
      }
      if (response.status === 409) {
        if (data.code === 'GATE_BLOCKED') {
          setBannerError(t('error.gateBlocked'))
        } else {
          setBannerError(
            t('error.illegalTransition', {
              toPhase: data.to_phase ?? nextPhase ?? '',
              reason: data.error ?? '',
              remedy: data.remedy ?? '',
            })
          )
        }
      } else {
        setBannerError(t('error.transitionFailed'))
      }
    },
    [t, nextPhase]
  )

  const handleBootstrap = useCallback(async () => {
    if (!project) return
    setIsBootstrapping(true)
    setBannerError(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/gsd/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        setBannerError(t('error.bootstrapFailed'))
        return
      }
      await fetchProjects()
    } catch {
      setBannerError(t('error.bootstrapFailed'))
    } finally {
      setIsBootstrapping(false)
    }
  }, [project, t, fetchProjects])

  const handleAdvance = useCallback(async () => {
    if (!project || !nextPhase) return
    setIsAdvancing(true)
    setBannerError(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/gsd/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_phase: nextPhase }),
      })
      if (!res.ok) {
        await surfaceTransitionError(res)
        return
      }
      await fetchProjects()
    } catch {
      setBannerError(t('error.transitionFailed'))
    } finally {
      setIsAdvancing(false)
    }
  }, [project, nextPhase, t, fetchProjects, surfaceTransitionError])

  const handleEnable = useCallback(async () => {
    if (!project) return
    setIsEnabling(true)
    setBannerError(null)
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gsd_enabled: 1 }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setBannerError(t('error.enableFailed', { serverError: data.error ?? '' }))
        return
      }
      await fetchProjects()
    } catch {
      setBannerError(t('error.enableFailed', { serverError: '' }))
    } finally {
      setIsEnabling(false)
    }
  }, [project, t, fetchProjects])

  const patchGate = useCallback(
    async (taskId: number, gateStatus: 'approved' | 'rejected', note?: string) => {
      setBannerError(null)
      try {
        const res = await fetch(`/api/tasks/${taskId}/gate`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gate_status: gateStatus, ...(note ? { note } : {}) }),
        })
        if (!res.ok) {
          setBannerError(t('error.transitionFailed'))
        }
      } catch {
        setBannerError(t('error.transitionFailed'))
      }
    },
    [t]
  )

  const handleApprove = useCallback(
    (taskId: number, note?: string) => patchGate(taskId, 'approved', note),
    [patchGate]
  )

  const handleReject = useCallback(
    (taskId: number, note?: string) => patchGate(taskId, 'rejected', note),
    [patchGate]
  )

  const handleCreateWorkstream = useCallback(async (payload: {
    key: string
    name: string
    status: string
  }) => {
    if (!project) return
    await runHierarchyMutation({
      url: `/api/projects/${project.id}/gsd/workstreams`,
      body: payload,
      fallbackError: 'Failed to create workstream',
    })
  }, [project, runHierarchyMutation])

  const handleUpdateWorkstreamStatus = useCallback(async (
    workstreamId: number,
    payload: { status: string; expected_updated_at: number },
  ) => {
    if (!project) return
    await runHierarchyMutation({
      url: `/api/projects/${project.id}/gsd/workstreams/${workstreamId}`,
      method: 'PATCH',
      body: payload,
      fallbackError: 'Failed to update workstream',
    })
  }, [project, runHierarchyMutation])

  const handleUpdateWorkstream = useCallback(async (
    workstreamId: number,
    payload: { key?: string; name?: string; status?: string; expected_updated_at: number },
  ) => {
    if (!project) return
    await runHierarchyMutation({
      url: `/api/projects/${project.id}/gsd/workstreams/${workstreamId}`,
      method: 'PATCH',
      body: payload,
      fallbackError: 'Failed to update workstream',
    })
  }, [project, runHierarchyMutation])

  const handleCompleteWorkstream = useCallback(async (workstreamId: number, expected_updated_at: number) => {
    if (!project) return
    await runHierarchyMutation({
      url: `/api/projects/${project.id}/gsd/workstreams/${workstreamId}/complete`,
      body: { expected_updated_at },
      fallbackError: 'Failed to complete workstream',
    })
  }, [project, runHierarchyMutation])

  const handleCreateMilestone = useCallback(async (payload: {
    workstream_id?: number | null
    version_label: string
    title: string
    status: string
  }) => {
    if (!project) return
    await runHierarchyMutation({
      url: `/api/projects/${project.id}/gsd/milestones`,
      body: payload,
      fallbackError: 'Failed to create milestone',
    })
  }, [project, runHierarchyMutation])

  const handleUpdateMilestoneStatus = useCallback(async (
    milestoneId: number,
    payload: { status: string; expected_updated_at: number },
  ) => {
    if (!project) return
    await runHierarchyMutation({
      url: `/api/projects/${project.id}/gsd/milestones/${milestoneId}`,
      method: 'PATCH',
      body: payload,
      fallbackError: 'Failed to update milestone',
    })
  }, [project, runHierarchyMutation])

  const handleUpdateMilestone = useCallback(async (
    milestoneId: number,
    payload: {
      workstream_id?: number | null
      version_label?: string
      title?: string
      status?: string
      started_at?: number | null
      completed_at?: number | null
      expected_updated_at: number
    },
  ) => {
    if (!project) return
    await runHierarchyMutation({
      url: `/api/projects/${project.id}/gsd/milestones/${milestoneId}`,
      method: 'PATCH',
      body: payload,
      fallbackError: 'Failed to update milestone',
    })
  }, [project, runHierarchyMutation])

  const handleCompleteMilestone = useCallback(async (milestoneId: number, expected_updated_at: number) => {
    if (!project) return
    await runHierarchyMutation({
      url: `/api/projects/${project.id}/gsd/milestones/${milestoneId}/complete`,
      body: { expected_updated_at },
      fallbackError: 'Failed to complete milestone',
    })
  }, [project, runHierarchyMutation])

  const handleCreatePhase = useCallback(async (
    milestoneId: number,
    payload: {
      phase_key: string
      phase_slug: string
      lifecycle_phase: string
      ordering_numeric: number
      status: string
      depends_on_phase_ids: number[]
    },
  ) => {
    await runHierarchyMutation({
      url: `/api/gsd/milestones/${milestoneId}/phases`,
      body: payload,
      fallbackError: 'Failed to create phase',
    })
  }, [runHierarchyMutation])

  const handleTransitionPhase = useCallback(async (
    phaseId: number,
    payload: { to_lifecycle_phase: string; expected_updated_at: number },
  ) => {
    await runHierarchyMutation({
      url: `/api/gsd/phases/${phaseId}/transition`,
      body: payload,
      fallbackError: 'Failed to transition phase',
    })
  }, [runHierarchyMutation])

  const handleUpdatePhase = useCallback(async (
    phaseId: number,
    payload: {
      phase_key?: string
      phase_slug?: string
      lifecycle_phase?: string
      ordering_numeric?: number
      status?: string
      depends_on_phase_ids?: number[]
      expected_updated_at: number
    },
  ) => {
    await runHierarchyMutation({
      url: `/api/gsd/phases/${phaseId}`,
      method: 'PATCH',
      body: payload,
      fallbackError: 'Failed to update phase',
    })
  }, [runHierarchyMutation])

  const handleCreatePlan = useCallback(async (
    phaseId: number,
    payload: {
      plan_ref: string
      title: string
      wave: number
      status: string
      depends_on_plan_ids: number[]
    },
  ) => {
    await runHierarchyMutation({
      url: `/api/gsd/phases/${phaseId}/plans`,
      body: payload,
      fallbackError: 'Failed to create plan',
    })
  }, [runHierarchyMutation])

  const handleTransitionPlan = useCallback(async (
    planId: number,
    payload: { to_status: string; expected_updated_at: number },
  ) => {
    await runHierarchyMutation({
      url: `/api/gsd/plans/${planId}/transition`,
      body: payload,
      fallbackError: 'Failed to transition plan',
    })
  }, [runHierarchyMutation])

  const handleUpdatePlan = useCallback(async (
    planId: number,
    payload: {
      plan_ref?: string
      title?: string
      wave?: number
      status?: string
      depends_on_plan_ids?: number[]
      expected_updated_at: number
    },
  ) => {
    await runHierarchyMutation({
      url: `/api/gsd/plans/${planId}`,
      method: 'PATCH',
      body: payload,
      fallbackError: 'Failed to update plan',
    })
  }, [runHierarchyMutation])

  // Branch 1: GSD not enabled — render non-gsd empty state (GSD-23, D-20, D-21)
  if (project && project.gsd_enabled !== 1) {
    return (
      <div className="p-6 space-y-6">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        {bannerError && (
          <div
            role="alert"
            className="text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3 flex items-start gap-2"
          >
            <span>{bannerError}</span>
            <button
              onClick={dismissBanner}
              aria-label="Dismiss"
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        )}
        <LifecycleEmptyState
          variant="non-gsd"
          onEnable={handleEnable}
          isEnabling={isEnabling}
          isViewer={isViewer}
        />
      </div>
    )
  }

  if (project && project.gsd_enabled === 1 && isGraphLoading && !graph) {
    return (
      <div className="p-6 space-y-6">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader variant="inline" />
            <span>Loading lifecycle graph...</span>
          </div>
        </div>
      </div>
    )
  }

  // Branch 2: GSD enabled but no hierarchy or legacy lifecycle yet — render bootstrap empty state.
  if (project && shouldRenderBootstrapEmpty) {
    return (
      <div className="p-6 space-y-6">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        {bannerError && (
          <div
            role="alert"
            className="text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3 flex items-start gap-2"
          >
            <span>{bannerError}</span>
            <button
              onClick={dismissBanner}
              aria-label="Dismiss"
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        )}
        <LifecycleEmptyState
          variant="not-bootstrapped"
          onBootstrap={handleBootstrap}
          isBootstrapping={isBootstrapping}
          isViewer={isViewer}
        />
      </div>
    )
  }

  // Branch 3a: legacy fallback — keep the Phase 09 surface active.
  if (project && shouldRenderLegacy) {
    const legacyPhase = graph?.legacy.current_phase ?? currentPhase
    const legacyNextPhase = NEXT_PHASE[legacyPhase] ?? null

    return (
      <div className="p-6 space-y-6">
        <h2 className="text-lg font-semibold">{t('title')}</h2>

        {bannerError && (
          <div
            role="alert"
            className="text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3 flex items-start gap-2"
          >
            <span>{bannerError}</span>
            <button
              onClick={dismissBanner}
              aria-label="Dismiss"
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        )}

        <CurrentPhaseCallout
          currentPhase={legacyPhase}
          nextPhase={legacyNextPhase}
          onBootstrap={handleBootstrap}
          onAdvance={handleAdvance}
          hasBeenBootstrapped
          isAdvancing={isAdvancing}
          isBootstrapping={isBootstrapping}
          isViewer={isViewer}
        />

        <PhaseTimeline currentPhase={legacyPhase} />

        <GateTaskList
          gateTasks={gateTasks}
          onApprove={handleApprove}
          onReject={handleReject}
          isViewer={isViewer}
        />
      </div>
    )
  }

  // Branch 3b: hierarchy view — canonical Phase 10 lifecycle surface.
  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-semibold">{t('title')}</h2>

      {bannerError && (
        <div
          role="alert"
          className="text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3 flex items-start gap-2"
        >
          <span>{bannerError}</span>
          <button
            onClick={dismissBanner}
            aria-label="Dismiss"
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      )}

      {graph && (
        <LifecycleHierarchy
          rollups={graph.rollups}
          workstreams={graph.workstreams}
          unscopedMilestones={graph.unscopedMilestones}
          isViewer={isViewer}
          isRefreshing={isGraphLoading}
          onRefresh={() => {
            void refetchGraph()
          }}
          onCreateWorkstream={handleCreateWorkstream}
          onUpdateWorkstreamStatus={handleUpdateWorkstreamStatus}
          onUpdateWorkstream={handleUpdateWorkstream}
          onCompleteWorkstream={handleCompleteWorkstream}
          onCreateMilestone={handleCreateMilestone}
          onUpdateMilestoneStatus={handleUpdateMilestoneStatus}
          onUpdateMilestone={handleUpdateMilestone}
          onCompleteMilestone={handleCompleteMilestone}
          onCreatePhase={handleCreatePhase}
          onUpdatePhase={handleUpdatePhase}
          onTransitionPhase={handleTransitionPhase}
          onCreatePlan={handleCreatePlan}
          onUpdatePlan={handleUpdatePlan}
          onTransitionPlan={handleTransitionPlan}
        />
      )}

      <GateTaskList
        gateTasks={gateTasks}
        onApprove={handleApprove}
        onReject={handleReject}
        isViewer={isViewer}
      />
    </div>
  )
}
