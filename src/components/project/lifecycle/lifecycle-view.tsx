'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import type { Task } from '@/store'
import { useProjectWorkspace } from '@/components/project/project-context'
import { PhaseTimeline } from '@/components/project/lifecycle/phase-timeline'
import { CurrentPhaseCallout } from '@/components/project/lifecycle/current-phase-callout'
import { GateTaskList } from '@/components/project/lifecycle/gate-task-list'
import { LifecycleEmptyState } from '@/components/project/lifecycle/empty-state'

// NEXT_PHASE map is kept inline per plan (no new shared export in this plan).
const NEXT_PHASE: Record<string, string | null> = {
  discuss: 'plan',
  plan: 'execute',
  execute: 'verify',
  verify: 'done',
  done: null,
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

  const projectTasks: Task[] = useMemo(
    () => tasks.filter((x) => x.project_id === project?.id),
    [tasks, project?.id]
  )

  // A project is considered bootstrapped if any task carries gsd_phase.
  const hasBeenBootstrapped = useMemo(
    () => projectTasks.some((x) => x.gsd_phase != null),
    [projectTasks]
  )

  const gateTasks = useMemo(
    () => projectTasks.filter((x) => x.gate_required === 1),
    [projectTasks]
  )

  const currentPhase = project?.gsd_phase ?? 'discuss'
  const nextPhase = NEXT_PHASE[currentPhase] ?? null

  const dismissBanner = useCallback(() => setBannerError(null), [])

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

  // Branch 2: GSD enabled but not bootstrapped — render bootstrap empty state
  if (project && project.gsd_enabled === 1 && !hasBeenBootstrapped) {
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

  // Branch 3: bootstrapped — full lifecycle surface
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
        currentPhase={currentPhase}
        nextPhase={nextPhase}
        onBootstrap={handleBootstrap}
        onAdvance={handleAdvance}
        hasBeenBootstrapped={hasBeenBootstrapped}
        isAdvancing={isAdvancing}
        isBootstrapping={isBootstrapping}
        isViewer={isViewer}
      />

      <PhaseTimeline currentPhase={currentPhase} />

      <GateTaskList
        gateTasks={gateTasks}
        onApprove={handleApprove}
        onReject={handleReject}
        isViewer={isViewer}
      />
    </div>
  )
}
