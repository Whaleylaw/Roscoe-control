'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

type LifecycleRollups = {
  active_workstreams: number
  active_milestones: number
  active_phases: number
  in_progress_plans: number
  blocked_gates: number
  wave_conflicts: number
}

type LifecycleGraphPlan = {
  id: number
  plan_ref: string
  title: string
  wave: number
  status: string
  depends_on_plan_ids: string
  updated_at: number
}

type LifecycleGraphPhase = {
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

type LifecycleGraphMilestone = {
  id: number
  version_label: string
  title: string
  status: string
  workstream_id?: number | null
  updated_at: number
  phases: LifecycleGraphPhase[]
}

type LifecycleGraphWorkstream = {
  id: number
  key: string
  name: string
  status: string
  updated_at: number
  milestones: LifecycleGraphMilestone[]
}

interface LifecycleHierarchyProps {
  rollups: LifecycleRollups
  workstreams: LifecycleGraphWorkstream[]
  unscopedMilestones: LifecycleGraphMilestone[]
  isViewer: boolean
  isRefreshing: boolean
  onRefresh: () => void
  onCreateWorkstream: (payload: {
    key: string
    name: string
    status: string
  }) => Promise<void> | void
  onUpdateWorkstream: (
    workstreamId: number,
    payload: { key?: string; name?: string; status?: string; expected_updated_at: number },
  ) => Promise<void> | void
  onUpdateWorkstreamStatus: (
    workstreamId: number,
    payload: { status: string; expected_updated_at: number },
  ) => Promise<void> | void
  onCompleteWorkstream: (workstreamId: number, expected_updated_at: number) => Promise<void> | void
  onCreateMilestone: (payload: {
    workstream_id?: number | null
    version_label: string
    title: string
    status: string
  }) => Promise<void> | void
  onUpdateMilestone: (
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
  ) => Promise<void> | void
  onUpdateMilestoneStatus: (
    milestoneId: number,
    payload: { status: string; expected_updated_at: number },
  ) => Promise<void> | void
  onCompleteMilestone: (milestoneId: number, expected_updated_at: number) => Promise<void> | void
  onCreatePhase: (
    milestoneId: number,
    payload: {
      phase_key: string
      phase_slug: string
      lifecycle_phase: string
      ordering_numeric: number
      status: string
      depends_on_phase_ids: number[]
    },
  ) => Promise<void> | void
  onUpdatePhase: (
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
  ) => Promise<void> | void
  onTransitionPhase: (
    phaseId: number,
    payload: { to_lifecycle_phase: string; expected_updated_at: number },
  ) => Promise<void> | void
  onCreatePlan: (
    phaseId: number,
    payload: {
      plan_ref: string
      title: string
      wave: number
      status: string
      depends_on_plan_ids: number[]
    },
  ) => Promise<void> | void
  onUpdatePlan: (
    planId: number,
    payload: {
      plan_ref?: string
      title?: string
      wave?: number
      status?: string
      depends_on_plan_ids?: number[]
      expected_updated_at: number
    },
  ) => Promise<void> | void
  onTransitionPlan: (
    planId: number,
    payload: { to_status: string; expected_updated_at: number },
  ) => Promise<void> | void
}

type WorkstreamFormState = {
  key: string
  name: string
  status: string
}

type MilestoneFormState = {
  version_label: string
  title: string
  status: string
}

type PhaseFormState = {
  phase_key: string
  phase_slug: string
  lifecycle_phase: string
  ordering_numeric: string
  status: string
  depends_on_phase_ids: number[]
}

type PlanFormState = {
  plan_ref: string
  title: string
  wave: string
  status: string
  depends_on_plan_ids: number[]
}

const ROLLUP_KEYS: Array<{ key: keyof LifecycleRollups; i18nKey: string }> = [
  { key: 'active_workstreams', i18nKey: 'activeWorkstreams' },
  { key: 'active_milestones', i18nKey: 'activeMilestones' },
  { key: 'active_phases', i18nKey: 'activePhases' },
  { key: 'in_progress_plans', i18nKey: 'inProgressPlans' },
  { key: 'blocked_gates', i18nKey: 'blockedGates' },
  { key: 'wave_conflicts', i18nKey: 'waveConflicts' },
]

const NEXT_LIFECYCLE_PHASE: Record<string, string | null> = {
  discuss: 'plan',
  plan: 'execute',
  execute: 'verify',
  verify: 'done',
  done: null,
}

const NEXT_PLAN_STATUSES: Record<string, readonly string[]> = {
  todo: ['in_progress'],
  in_progress: ['review', 'done', 'failed'],
  review: ['in_progress', 'done', 'failed'],
  done: [],
  failed: ['todo', 'in_progress'],
}

function humanizeToken(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function parseIdList(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is number => Number.isFinite(x)) : []
  } catch {
    return []
  }
}

function statusClasses(status: string): string {
  switch (status) {
    case 'active':
    case 'in_progress':
      return 'border-primary/30 bg-primary/10 text-primary'
    case 'complete':
    case 'done':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
    case 'paused':
    case 'deferred':
    case 'failed':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700'
    case 'archived':
      return 'border-border bg-muted text-muted-foreground'
    default:
      return 'border-border bg-card text-foreground'
  }
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(status)}`}
    >
      {humanizeToken(status)}
    </span>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      <div>{label}</div>
      {children}
    </label>
  )
}

function textInputClassName() {
  return 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50'
}

function selectClassName() {
  return 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50'
}

function checkboxClassName() {
  return 'h-4 w-4 rounded border border-border bg-background text-primary focus:outline-none focus:ring-1 focus:ring-primary/50'
}

function toggleDependencyId(current: number[], id: number): number[] {
  return current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id].sort((a, b) => a - b)
}

function usePendingMap() {
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const withPending = async (key: string, action: () => Promise<void> | void) => {
    setPending((current) => ({ ...current, [key]: true }))
    try {
      await action()
    } finally {
      setPending((current) => ({ ...current, [key]: false }))
    }
  }
  return { pending, withPending }
}

function DependencyChecklist({
  legend,
  emptyLabel,
  options,
  selected,
  onToggle,
}: {
  legend: string
  emptyLabel: string
  options: Array<{ id: number; label: string; helper?: string }>
  selected: number[]
  onToggle: (id: number) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs text-muted-foreground">{legend}</legend>
      {options.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {options.map((option) => (
            <label
              key={option.id}
              className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                onChange={() => onToggle(option.id)}
                className={checkboxClassName()}
              />
              <span className="space-y-1">
                <span className="block">{option.label}</span>
                {option.helper && (
                  <span className="block text-xs text-muted-foreground">{option.helper}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

function CreateWorkstreamForm({
  isViewer,
  onCreate,
}: {
  isViewer: boolean
  onCreate: (payload: WorkstreamFormState) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<WorkstreamFormState>({ key: '', name: '', status: 'active' })
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.key.trim() || !form.name.trim()) return
    setSubmitting(true)
    try {
      await onCreate({
        key: form.key.trim(),
        name: form.name.trim(),
        status: form.status,
      })
      setForm({ key: '', name: '', status: 'active' })
      setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (isViewer) return null

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      {!open ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          Add workstream
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Key">
              <input
                value={form.key}
                onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))}
                placeholder="CORE"
                className={textInputClassName()}
              />
            </Field>
            <Field label="Name">
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Core platform"
                className={textInputClassName()}
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className={selectClassName()}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="complete">Complete</option>
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create workstream'}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

function CreateMilestoneForm({
  isViewer,
  label,
  workstreamId,
  onCreate,
}: {
  isViewer: boolean
  label: string
  workstreamId?: number | null
  onCreate: (payload: {
    workstream_id?: number | null
    version_label: string
    title: string
    status: string
  }) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<MilestoneFormState>({
    version_label: '',
    title: '',
    status: 'planned',
  })
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.version_label.trim() || !form.title.trim()) return
    setSubmitting(true)
    try {
      await onCreate({
        workstream_id: workstreamId,
        version_label: form.version_label.trim(),
        title: form.title.trim(),
        status: form.status,
      })
      setForm({ version_label: '', title: '', status: 'planned' })
      setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (isViewer) return null

  return (
    <div className="space-y-3">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {label}
        </Button>
      ) : (
        <form onSubmit={submit} className="rounded-lg border border-border bg-card p-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Version">
              <input
                value={form.version_label}
                onChange={(event) => setForm((current) => ({ ...current, version_label: event.target.value }))}
                placeholder="v1.2"
                className={textInputClassName()}
              />
            </Field>
            <Field label="Title">
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Hierarchy UI"
                className={textInputClassName()}
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className={selectClassName()}
              >
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create milestone'}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function CreatePhaseForm({
  isViewer,
  milestoneId,
  nextOrdering,
  availableDependencies,
  onCreate,
}: {
  isViewer: boolean
  milestoneId: number
  nextOrdering: number
  availableDependencies: Array<{ id: number; label: string; helper?: string }>
  onCreate: (
    milestoneId: number,
    payload: {
      phase_key: string
      phase_slug: string
      lifecycle_phase: string
      ordering_numeric: number
      status: string
      depends_on_phase_ids: number[]
    },
  ) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<PhaseFormState>({
    phase_key: '',
    phase_slug: '',
    lifecycle_phase: 'discuss',
    ordering_numeric: String(nextOrdering),
    status: 'planned',
    depends_on_phase_ids: [],
  })
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.phase_key.trim() || !form.phase_slug.trim()) return
    setSubmitting(true)
    try {
      await onCreate(milestoneId, {
        phase_key: form.phase_key.trim(),
        phase_slug: form.phase_slug.trim(),
        lifecycle_phase: form.lifecycle_phase,
        ordering_numeric: Number.parseFloat(form.ordering_numeric || String(nextOrdering)),
        status: form.status,
        depends_on_phase_ids: form.depends_on_phase_ids,
      })
      setForm({
        phase_key: '',
        phase_slug: '',
        lifecycle_phase: 'discuss',
        ordering_numeric: String(nextOrdering),
        status: 'planned',
        depends_on_phase_ids: [],
      })
      setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (isViewer) return null

  return (
    <div className="space-y-3">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Add phase
        </Button>
      ) : (
        <form onSubmit={submit} className="rounded-lg border border-border bg-background p-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Phase key">
              <input
                value={form.phase_key}
                onChange={(event) => setForm((current) => ({ ...current, phase_key: event.target.value }))}
                placeholder="phase-10-ui"
                className={textInputClassName()}
              />
            </Field>
            <Field label="Slug">
              <input
                value={form.phase_slug}
                onChange={(event) => setForm((current) => ({ ...current, phase_slug: event.target.value }))}
                placeholder="hierarchy-ui"
                className={textInputClassName()}
              />
            </Field>
            <Field label="Lifecycle phase">
              <select
                value={form.lifecycle_phase}
                onChange={(event) => setForm((current) => ({ ...current, lifecycle_phase: event.target.value }))}
                className={selectClassName()}
              >
                <option value="discuss">Discuss</option>
                <option value="plan">Plan</option>
                <option value="execute">Execute</option>
                <option value="verify">Verify</option>
                <option value="done">Done</option>
              </select>
            </Field>
            <Field label="Ordering">
              <input
                value={form.ordering_numeric}
                onChange={(event) => setForm((current) => ({ ...current, ordering_numeric: event.target.value }))}
                placeholder={String(nextOrdering)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className={selectClassName()}
              >
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
                <option value="deferred">Deferred</option>
              </select>
            </Field>
          </div>
          <DependencyChecklist
            legend="Phase dependencies"
            emptyLabel="No earlier phases available yet."
            options={availableDependencies}
            selected={form.depends_on_phase_ids}
            onToggle={(id) => setForm((current) => ({
              ...current,
              depends_on_phase_ids: toggleDependencyId(current.depends_on_phase_ids, id),
            }))}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create phase'}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function CreatePlanForm({
  isViewer,
  phaseId,
  nextWave,
  availableDependencies,
  onCreate,
}: {
  isViewer: boolean
  phaseId: number
  nextWave: number
  availableDependencies: Array<{ id: number; label: string; helper?: string }>
  onCreate: (
    phaseId: number,
    payload: {
      plan_ref: string
      title: string
      wave: number
      status: string
      depends_on_plan_ids: number[]
    },
  ) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<PlanFormState>({
    plan_ref: '',
    title: '',
    wave: String(nextWave),
    status: 'todo',
    depends_on_plan_ids: [],
  })
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.plan_ref.trim() || !form.title.trim()) return
    setSubmitting(true)
    try {
      await onCreate(phaseId, {
        plan_ref: form.plan_ref.trim(),
        title: form.title.trim(),
        wave: Number.parseInt(form.wave || String(nextWave), 10),
        status: form.status,
        depends_on_plan_ids: form.depends_on_plan_ids,
      })
      setForm({
        plan_ref: '',
        title: '',
        wave: String(nextWave),
        status: 'todo',
        depends_on_plan_ids: [],
      })
      setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (isViewer) return null

  return (
    <div className="space-y-3">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Add plan
        </Button>
      ) : (
        <form onSubmit={submit} className="rounded-lg border border-border bg-background p-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Plan ref">
              <input
                value={form.plan_ref}
                onChange={(event) => setForm((current) => ({ ...current, plan_ref: event.target.value }))}
                placeholder="P10-UI-01"
                className={textInputClassName()}
              />
            </Field>
            <Field label="Title">
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Render lifecycle graph"
                className={textInputClassName()}
              />
            </Field>
            <Field label="Wave">
              <input
                value={form.wave}
                onChange={(event) => setForm((current) => ({ ...current, wave: event.target.value }))}
                placeholder={String(nextWave)}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className={selectClassName()}
              >
                <option value="todo">Todo</option>
                <option value="in_progress">In progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
                <option value="failed">Failed</option>
              </select>
            </Field>
          </div>
          <DependencyChecklist
            legend="Plan dependencies"
            emptyLabel="No sibling plans available yet."
            options={availableDependencies}
            selected={form.depends_on_plan_ids}
            onToggle={(id) => setForm((current) => ({
              ...current,
              depends_on_plan_ids: toggleDependencyId(current.depends_on_plan_ids, id),
            }))}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create plan'}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function EditWorkstreamForm({
  workstream,
  isViewer,
  onUpdate,
}: {
  workstream: LifecycleGraphWorkstream
  isViewer: boolean
  onUpdate: (
    workstreamId: number,
    payload: { key?: string; name?: string; status?: string; expected_updated_at: number },
  ) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<WorkstreamFormState>({
    key: workstream.key,
    name: workstream.name,
    status: workstream.status,
  })
  const [submitting, setSubmitting] = useState(false)

  if (isViewer) return null

  return (
    <div className="space-y-3">
      {!open ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Edit details
        </Button>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setSubmitting(true)
            try {
              await onUpdate(workstream.id, {
                key: form.key.trim(),
                name: form.name.trim(),
                status: form.status,
                expected_updated_at: workstream.updated_at,
              })
              setOpen(false)
            } finally {
              setSubmitting(false)
            }
          }}
          className="rounded-lg border border-border bg-card p-3 space-y-3"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Workstream key">
              <input
                value={form.key}
                onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Workstream name">
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Workstream status">
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className={selectClassName()}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="complete">Complete</option>
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save details'}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function EditMilestoneForm({
  milestone,
  isViewer,
  workstreamOptions,
  onUpdate,
}: {
  milestone: LifecycleGraphMilestone
  isViewer: boolean
  workstreamOptions: Array<{ id: number; label: string }>
  onUpdate: (
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
  ) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<MilestoneFormState>({
    version_label: milestone.version_label,
    title: milestone.title,
    status: milestone.status,
  })
  const [selectedWorkstreamId, setSelectedWorkstreamId] = useState<string>(String(milestone.workstream_id ?? ''))
  const [submitting, setSubmitting] = useState(false)

  if (isViewer) return null

  return (
    <div className="space-y-3">
      {!open ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Edit details
        </Button>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setSubmitting(true)
            try {
              await onUpdate(milestone.id, {
                workstream_id: selectedWorkstreamId ? Number.parseInt(selectedWorkstreamId, 10) : null,
                version_label: form.version_label.trim(),
                title: form.title.trim(),
                status: form.status,
                expected_updated_at: milestone.updated_at,
              })
              setOpen(false)
            } finally {
              setSubmitting(false)
            }
          }}
          className="rounded-lg border border-border bg-background p-3 space-y-3"
        >
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Workstream">
              <select
                value={selectedWorkstreamId}
                onChange={(event) => setSelectedWorkstreamId(event.target.value)}
                className={selectClassName()}
              >
                <option value="">Project-level</option>
                {workstreamOptions.map((workstream) => (
                  <option key={workstream.id} value={workstream.id}>
                    {workstream.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Milestone version">
              <input
                value={form.version_label}
                onChange={(event) => setForm((current) => ({ ...current, version_label: event.target.value }))}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Milestone title">
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Milestone status">
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className={selectClassName()}
              >
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save details'}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function EditPhaseForm({
  phase,
  isViewer,
  availableDependencies,
  onUpdate,
}: {
  phase: LifecycleGraphPhase
  isViewer: boolean
  availableDependencies: Array<{ id: number; label: string; helper?: string }>
  onUpdate: (
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
  ) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<PhaseFormState>({
    phase_key: phase.phase_key,
    phase_slug: phase.phase_slug,
    lifecycle_phase: phase.lifecycle_phase,
    ordering_numeric: String(phase.ordering_numeric),
    status: phase.status,
    depends_on_phase_ids: parseIdList(phase.depends_on_phase_ids),
  })
  const [submitting, setSubmitting] = useState(false)

  if (isViewer) return null

  return (
    <div className="space-y-3">
      {!open ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Edit phase
        </Button>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setSubmitting(true)
            try {
              await onUpdate(phase.id, {
                phase_key: form.phase_key.trim(),
                phase_slug: form.phase_slug.trim(),
                lifecycle_phase: form.lifecycle_phase,
                ordering_numeric: Number.parseFloat(form.ordering_numeric || String(phase.ordering_numeric)),
                status: form.status,
                depends_on_phase_ids: form.depends_on_phase_ids,
                expected_updated_at: phase.updated_at,
              })
              setOpen(false)
            } finally {
              setSubmitting(false)
            }
          }}
          className="rounded-lg border border-border bg-background p-3 space-y-3"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Phase key">
              <input
                value={form.phase_key}
                onChange={(event) => setForm((current) => ({ ...current, phase_key: event.target.value }))}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Phase slug">
              <input
                value={form.phase_slug}
                onChange={(event) => setForm((current) => ({ ...current, phase_slug: event.target.value }))}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Lifecycle phase">
              <select
                value={form.lifecycle_phase}
                onChange={(event) => setForm((current) => ({ ...current, lifecycle_phase: event.target.value }))}
                className={selectClassName()}
              >
                <option value="discuss">Discuss</option>
                <option value="plan">Plan</option>
                <option value="execute">Execute</option>
                <option value="verify">Verify</option>
                <option value="done">Done</option>
              </select>
            </Field>
            <Field label="Ordering">
              <input
                value={form.ordering_numeric}
                onChange={(event) => setForm((current) => ({ ...current, ordering_numeric: event.target.value }))}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Phase status">
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className={selectClassName()}
              >
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
                <option value="deferred">Deferred</option>
              </select>
            </Field>
          </div>
          <DependencyChecklist
            legend="Phase dependencies"
            emptyLabel="No other phases are available in this milestone."
            options={availableDependencies}
            selected={form.depends_on_phase_ids}
            onToggle={(id) => setForm((current) => ({
              ...current,
              depends_on_phase_ids: toggleDependencyId(current.depends_on_phase_ids, id),
            }))}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save phase'}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function EditPlanForm({
  plan,
  isViewer,
  availableDependencies,
  onUpdate,
}: {
  plan: LifecycleGraphPlan
  isViewer: boolean
  availableDependencies: Array<{ id: number; label: string; helper?: string }>
  onUpdate: (
    planId: number,
    payload: {
      plan_ref?: string
      title?: string
      wave?: number
      status?: string
      depends_on_plan_ids?: number[]
      expected_updated_at: number
    },
  ) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<PlanFormState>({
    plan_ref: plan.plan_ref,
    title: plan.title,
    wave: String(plan.wave),
    status: plan.status,
    depends_on_plan_ids: parseIdList(plan.depends_on_plan_ids),
  })
  const [submitting, setSubmitting] = useState(false)

  if (isViewer) return null

  return (
    <div className="space-y-3">
      {!open ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Edit plan
        </Button>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setSubmitting(true)
            try {
              await onUpdate(plan.id, {
                plan_ref: form.plan_ref.trim(),
                title: form.title.trim(),
                wave: Number.parseInt(form.wave || String(plan.wave), 10),
                status: form.status,
                depends_on_plan_ids: form.depends_on_plan_ids,
                expected_updated_at: plan.updated_at,
              })
              setOpen(false)
            } finally {
              setSubmitting(false)
            }
          }}
          className="rounded-lg border border-border bg-background p-3 space-y-3"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Plan ref">
              <input
                value={form.plan_ref}
                onChange={(event) => setForm((current) => ({ ...current, plan_ref: event.target.value }))}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Plan title">
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Wave">
              <input
                value={form.wave}
                onChange={(event) => setForm((current) => ({ ...current, wave: event.target.value }))}
                className={textInputClassName()}
              />
            </Field>
            <Field label="Plan status">
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className={selectClassName()}
              >
                <option value="todo">Todo</option>
                <option value="in_progress">In progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
                <option value="failed">Failed</option>
              </select>
            </Field>
          </div>
          <DependencyChecklist
            legend="Plan dependencies"
            emptyLabel="No other plans are available in this phase."
            options={availableDependencies}
            selected={form.depends_on_plan_ids}
            onToggle={(id) => setForm((current) => ({
              ...current,
              depends_on_plan_ids: toggleDependencyId(current.depends_on_plan_ids, id),
            }))}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save plan'}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function PhaseCard({
  phase,
  isViewer,
  availablePhaseDependencies,
  onCreatePlan,
  onUpdatePhase,
  onUpdatePlan,
  onTransitionPhase,
  onTransitionPlan,
}: {
  phase: LifecycleGraphPhase
  isViewer: boolean
  availablePhaseDependencies: Array<{ id: number; label: string; helper?: string }>
  onCreatePlan: (
    phaseId: number,
    payload: {
      plan_ref: string
      title: string
      wave: number
      status: string
      depends_on_plan_ids: number[]
    },
  ) => Promise<void> | void
  onUpdatePhase: (
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
  ) => Promise<void> | void
  onUpdatePlan: (
    planId: number,
    payload: {
      plan_ref?: string
      title?: string
      wave?: number
      status?: string
      depends_on_plan_ids?: number[]
      expected_updated_at: number
    },
  ) => Promise<void> | void
  onTransitionPhase: (
    phaseId: number,
    payload: { to_lifecycle_phase: string; expected_updated_at: number },
  ) => Promise<void> | void
  onTransitionPlan: (
    planId: number,
    payload: { to_status: string; expected_updated_at: number },
  ) => Promise<void> | void
}) {
  const dependencies = parseIdList(phase.depends_on_phase_ids)
  const nextLifecyclePhase = NEXT_LIFECYCLE_PHASE[phase.lifecycle_phase] ?? null
  const nextWave = useMemo(
    () => phase.plans.reduce((max, plan) => Math.max(max, plan.wave), 0) + 1,
    [phase.plans],
  )
  const [phasePending, setPhasePending] = useState(false)
  const { pending: planPending, withPending: withPlanPending } = usePendingMap()

  const groupedPlans = useMemo(() => {
    const grouped = new Map<number, LifecycleGraphPlan[]>()
    for (const plan of phase.plans) {
      grouped.set(plan.wave, [...(grouped.get(plan.wave) ?? []), plan])
    }
    return [...grouped.entries()].sort((a, b) => a[0] - b[0])
  }, [phase.plans])
  const availablePlanDependencies = useMemo(
    () =>
      phase.plans.map((plan) => ({
        id: plan.id,
        label: `${plan.plan_ref} · ${plan.title}`,
        helper: `Wave ${plan.wave} · ${humanizeToken(plan.status)}`,
      })),
    [phase.plans],
  )

  const transitionPhase = async () => {
    if (!nextLifecyclePhase) return
    setPhasePending(true)
    try {
      await onTransitionPhase(phase.id, {
        to_lifecycle_phase: nextLifecyclePhase,
        expected_updated_at: phase.updated_at,
      })
    } finally {
      setPhasePending(false)
    }
  }

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{phase.phase_key}</div>
          <div className="text-xs text-muted-foreground">
            {humanizeToken(phase.lifecycle_phase)} · {phase.phase_slug}
          </div>
        </div>
        <StatusPill status={phase.status} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>Order {phase.ordering_numeric}</span>
        {dependencies.length > 0 && (
          <span>Depends on phase IDs {dependencies.join(', ')}</span>
        )}
      </div>

      {!isViewer && (
        <div className="mt-4 flex flex-wrap gap-2">
          {nextLifecyclePhase && (
            <Button size="sm" onClick={transitionPhase} disabled={phasePending}>
              {phasePending ? 'Advancing...' : `Advance to ${humanizeToken(nextLifecyclePhase)}`}
            </Button>
          )}
          <EditPhaseForm
            phase={phase}
            isViewer={isViewer}
            availableDependencies={availablePhaseDependencies}
            onUpdate={onUpdatePhase}
          />
          <CreatePlanForm
            isViewer={isViewer}
            phaseId={phase.id}
            nextWave={nextWave}
            availableDependencies={availablePlanDependencies}
            onCreate={onCreatePlan}
          />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {groupedPlans.length === 0 ? (
          <div className="text-xs text-muted-foreground">No plans yet.</div>
        ) : (
          groupedPlans.map(([wave, wavePlans]) => (
            <div key={wave} className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Wave {wave}
              </div>
              <ul className="space-y-2">
                {wavePlans.map((plan) => {
                  const planKey = `plan-${plan.id}`
                  const dependenciesForPlan = parseIdList(plan.depends_on_plan_ids)
                  return (
                    <li key={plan.id} className="rounded-md border border-border bg-background px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{plan.title}</div>
                          <div className="text-xs text-muted-foreground">{plan.plan_ref}</div>
                        </div>
                        <StatusPill status={plan.status} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>Wave {plan.wave}</span>
                        {dependenciesForPlan.length > 0 && (
                          <span>Depends on plan IDs {dependenciesForPlan.join(', ')}</span>
                        )}
                      </div>
                      {!isViewer && NEXT_PLAN_STATUSES[plan.status]?.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <EditPlanForm
                            plan={plan}
                            isViewer={isViewer}
                            availableDependencies={availablePlanDependencies.filter((option) => option.id !== plan.id)}
                            onUpdate={onUpdatePlan}
                          />
                          {NEXT_PLAN_STATUSES[plan.status].map((nextStatus) => (
                            <Button
                              key={nextStatus}
                              size="sm"
                              variant={nextStatus === 'done' ? 'success' : nextStatus === 'failed' ? 'destructive' : 'outline'}
                              disabled={Boolean(planPending[planKey])}
                              onClick={() => {
                                void withPlanPending(planKey, async () => {
                                  await onTransitionPlan(plan.id, {
                                    to_status: nextStatus,
                                    expected_updated_at: plan.updated_at,
                                  })
                                })
                              }}
                            >
                              {planPending[planKey] ? 'Saving...' : humanizeToken(nextStatus)}
                            </Button>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </article>
  )
}

function MilestoneCard({
  milestone,
  isViewer,
  workstreamOptions,
  onUpdateMilestone,
  onUpdateMilestoneStatus,
  onCompleteMilestone,
  onCreatePhase,
  onCreatePlan,
  onUpdatePhase,
  onUpdatePlan,
  onTransitionPhase,
  onTransitionPlan,
}: {
  milestone: LifecycleGraphMilestone
  isViewer: boolean
  workstreamOptions: Array<{ id: number; label: string }>
  onUpdateMilestone: (
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
  ) => Promise<void> | void
  onUpdateMilestoneStatus: (
    milestoneId: number,
    payload: { status: string; expected_updated_at: number },
  ) => Promise<void> | void
  onCompleteMilestone: (milestoneId: number, expected_updated_at: number) => Promise<void> | void
  onCreatePhase: (
    milestoneId: number,
    payload: {
      phase_key: string
      phase_slug: string
      lifecycle_phase: string
      ordering_numeric: number
      status: string
      depends_on_phase_ids: number[]
    },
  ) => Promise<void> | void
  onCreatePlan: (
    phaseId: number,
    payload: {
      plan_ref: string
      title: string
      wave: number
      status: string
      depends_on_plan_ids: number[]
    },
  ) => Promise<void> | void
  onUpdatePhase: (
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
  ) => Promise<void> | void
  onUpdatePlan: (
    planId: number,
    payload: {
      plan_ref?: string
      title?: string
      wave?: number
      status?: string
      depends_on_plan_ids?: number[]
      expected_updated_at: number
    },
  ) => Promise<void> | void
  onTransitionPhase: (
    phaseId: number,
    payload: { to_lifecycle_phase: string; expected_updated_at: number },
  ) => Promise<void> | void
  onTransitionPlan: (
    planId: number,
    payload: { to_status: string; expected_updated_at: number },
  ) => Promise<void> | void
}) {
  const [status, setStatus] = useState(milestone.status)
  const { pending, withPending } = usePendingMap()
  const nextOrdering = useMemo(
    () => milestone.phases.reduce((max, phase) => Math.max(max, phase.ordering_numeric), 0) + 1,
    [milestone.phases],
  )
  const availablePhaseDependencies = useMemo(
    () =>
      milestone.phases.map((phase) => ({
        id: phase.id,
        label: `${phase.phase_key} · ${phase.phase_slug}`,
        helper: `${humanizeToken(phase.lifecycle_phase)} · order ${phase.ordering_numeric}`,
      })),
    [milestone.phases],
  )

  return (
    <article className="rounded-xl border border-border bg-card/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {milestone.version_label}
          </div>
          <h4 className="text-base font-semibold">{milestone.title}</h4>
        </div>
        <StatusPill status={milestone.status} />
      </div>

      {!isViewer && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Field label="Milestone status">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className={selectClassName()}
            >
              <option value="planned">Planned</option>
              <option value="active">Active</option>
              <option value="complete">Complete</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={Boolean(pending.status)}
            onClick={() => {
              void withPending('status', async () => {
                await onUpdateMilestoneStatus(milestone.id, {
                  status,
                  expected_updated_at: milestone.updated_at,
                })
              })
            }}
          >
            {pending.status ? 'Saving...' : 'Save status'}
          </Button>
          <EditMilestoneForm
            milestone={milestone}
            isViewer={isViewer}
            workstreamOptions={workstreamOptions}
            onUpdate={onUpdateMilestone}
          />
          {milestone.status !== 'complete' && (
            <Button
              size="sm"
              variant="success"
              disabled={Boolean(pending.complete)}
              onClick={() => {
                void withPending('complete', async () => {
                  await onCompleteMilestone(milestone.id, milestone.updated_at)
                })
              }}
            >
              {pending.complete ? 'Completing...' : 'Complete milestone'}
            </Button>
          )}
          <CreatePhaseForm
            isViewer={isViewer}
            milestoneId={milestone.id}
            nextOrdering={nextOrdering}
            availableDependencies={availablePhaseDependencies}
            onCreate={onCreatePhase}
          />
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {milestone.phases.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            No phases defined yet.
          </div>
        ) : (
          milestone.phases.map((phase) => (
            <PhaseCard
              key={phase.id}
              phase={phase}
              isViewer={isViewer}
              availablePhaseDependencies={availablePhaseDependencies.filter((option) => option.id !== phase.id)}
              onCreatePlan={onCreatePlan}
              onUpdatePhase={onUpdatePhase}
              onUpdatePlan={onUpdatePlan}
              onTransitionPhase={onTransitionPhase}
              onTransitionPlan={onTransitionPlan}
            />
          ))
        )}
      </div>
    </article>
  )
}

function MilestoneSection({
  title,
  milestones,
  isViewer,
  createLabel,
  createWorkstreamId,
  workstreamOptions,
  onCreateMilestone,
  onUpdateMilestone,
  onUpdateMilestoneStatus,
  onCompleteMilestone,
  onCreatePhase,
  onCreatePlan,
  onUpdatePhase,
  onUpdatePlan,
  onTransitionPhase,
  onTransitionPlan,
}: {
  title: string
  milestones: LifecycleGraphMilestone[]
  isViewer: boolean
  createLabel: string
  createWorkstreamId?: number | null
  workstreamOptions: Array<{ id: number; label: string }>
  onCreateMilestone: (payload: {
    workstream_id?: number | null
    version_label: string
    title: string
    status: string
  }) => Promise<void> | void
  onUpdateMilestone: (
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
  ) => Promise<void> | void
  onUpdateMilestoneStatus: (
    milestoneId: number,
    payload: { status: string; expected_updated_at: number },
  ) => Promise<void> | void
  onCompleteMilestone: (milestoneId: number, expected_updated_at: number) => Promise<void> | void
  onCreatePhase: (
    milestoneId: number,
    payload: {
      phase_key: string
      phase_slug: string
      lifecycle_phase: string
      ordering_numeric: number
      status: string
      depends_on_phase_ids: number[]
    },
  ) => Promise<void> | void
  onCreatePlan: (
    phaseId: number,
    payload: {
      plan_ref: string
      title: string
      wave: number
      status: string
      depends_on_plan_ids: number[]
    },
  ) => Promise<void> | void
  onUpdatePhase: (
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
  ) => Promise<void> | void
  onUpdatePlan: (
    planId: number,
    payload: {
      plan_ref?: string
      title?: string
      wave?: number
      status?: string
      depends_on_plan_ids?: number[]
      expected_updated_at: number
    },
  ) => Promise<void> | void
  onTransitionPhase: (
    phaseId: number,
    payload: { to_lifecycle_phase: string; expected_updated_at: number },
  ) => Promise<void> | void
  onTransitionPlan: (
    planId: number,
    payload: { to_status: string; expected_updated_at: number },
  ) => Promise<void> | void
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="text-xs text-muted-foreground">
            {milestones.length} milestone{milestones.length === 1 ? '' : 's'}
          </div>
        </div>
        <CreateMilestoneForm
          isViewer={isViewer}
          label={createLabel}
          workstreamId={createWorkstreamId}
          onCreate={onCreateMilestone}
        />
      </div>
      {milestones.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          No milestones created yet.
        </div>
      ) : (
        <div className="space-y-3">
          {milestones.map((milestone) => (
            <MilestoneCard
              key={milestone.id}
              milestone={milestone}
              isViewer={isViewer}
              workstreamOptions={workstreamOptions}
              onUpdateMilestone={onUpdateMilestone}
              onUpdateMilestoneStatus={onUpdateMilestoneStatus}
              onCompleteMilestone={onCompleteMilestone}
              onCreatePhase={onCreatePhase}
              onCreatePlan={onCreatePlan}
              onUpdatePhase={onUpdatePhase}
              onUpdatePlan={onUpdatePlan}
              onTransitionPhase={onTransitionPhase}
              onTransitionPlan={onTransitionPlan}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function LifecycleHierarchy({
  rollups,
  workstreams,
  unscopedMilestones,
  isViewer,
  isRefreshing,
  onRefresh,
  onCreateWorkstream,
  onUpdateWorkstream,
  onUpdateWorkstreamStatus,
  onCompleteWorkstream,
  onCreateMilestone,
  onUpdateMilestone,
  onUpdateMilestoneStatus,
  onCompleteMilestone,
  onCreatePhase,
  onUpdatePhase,
  onTransitionPhase,
  onCreatePlan,
  onUpdatePlan,
  onTransitionPlan,
}: LifecycleHierarchyProps) {
  const tRollups = useTranslations('project.lifecycle.rollups')
  const [workstreamStatuses, setWorkstreamStatuses] = useState<Record<number, string>>({})
  const { pending, withPending } = usePendingMap()
  const workstreamOptions = useMemo(
    () => workstreams.map((workstream) => ({ id: workstream.id, label: `${workstream.key} · ${workstream.name}` })),
    [workstreams],
  )

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Hierarchy rollups</h3>
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ROLLUP_KEYS.map(({ key, i18nKey }) => (
            <article key={key} className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tRollups(i18nKey)}
              </div>
              <div className="mt-2 text-2xl font-semibold">{rollups[key]}</div>
            </article>
          ))}
        </div>
      </section>

      <CreateWorkstreamForm isViewer={isViewer} onCreate={onCreateWorkstream} />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Workstreams</h3>
          <span className="text-xs text-muted-foreground">{workstreams.length} active lanes tracked</span>
        </div>
        {workstreams.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            No workstreams created yet.
          </div>
        ) : (
          <div className="space-y-4">
            {workstreams.map((workstream) => {
              const selectedStatus = workstreamStatuses[workstream.id] ?? workstream.status
              const workstreamKey = `workstream-${workstream.id}`
              return (
                <article key={workstream.id} className="rounded-2xl border border-border bg-background/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {workstream.key}
                      </div>
                      <h4 className="text-lg font-semibold">{workstream.name}</h4>
                    </div>
                    <StatusPill status={workstream.status} />
                  </div>

                  {!isViewer && (
                    <div className="mt-4 flex flex-wrap items-end gap-2">
                      <EditWorkstreamForm
                        workstream={workstream}
                        isViewer={isViewer}
                        onUpdate={onUpdateWorkstream}
                      />
                      <Field label="Workstream status">
                        <select
                          value={selectedStatus}
                          onChange={(event) => setWorkstreamStatuses((current) => ({
                            ...current,
                            [workstream.id]: event.target.value,
                          }))}
                          className={selectClassName()}
                        >
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="complete">Complete</option>
                        </select>
                      </Field>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={Boolean(pending[`${workstreamKey}:status`])}
                        onClick={() => {
                          void withPending(`${workstreamKey}:status`, async () => {
                            await onUpdateWorkstreamStatus(workstream.id, {
                              status: selectedStatus,
                              expected_updated_at: workstream.updated_at,
                            })
                          })
                        }}
                      >
                        {pending[`${workstreamKey}:status`] ? 'Saving...' : 'Save status'}
                      </Button>
                      {workstream.status !== 'complete' && (
                        <Button
                          size="sm"
                          variant="success"
                          disabled={Boolean(pending[`${workstreamKey}:complete`])}
                          onClick={() => {
                            void withPending(`${workstreamKey}:complete`, async () => {
                              await onCompleteWorkstream(workstream.id, workstream.updated_at)
                            })
                          }}
                        >
                          {pending[`${workstreamKey}:complete`] ? 'Completing...' : 'Complete workstream'}
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="mt-4">
                    <MilestoneSection
                      title="Milestones"
                      milestones={workstream.milestones}
                      isViewer={isViewer}
                      createLabel="Add milestone"
                      createWorkstreamId={workstream.id}
                      workstreamOptions={workstreamOptions}
                      onCreateMilestone={onCreateMilestone}
                      onUpdateMilestone={onUpdateMilestone}
                      onUpdateMilestoneStatus={onUpdateMilestoneStatus}
                      onCompleteMilestone={onCompleteMilestone}
                      onCreatePhase={onCreatePhase}
                      onCreatePlan={onCreatePlan}
                      onUpdatePhase={onUpdatePhase}
                      onUpdatePlan={onUpdatePlan}
                      onTransitionPhase={onTransitionPhase}
                      onTransitionPlan={onTransitionPlan}
                    />
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <MilestoneSection
        title="Project milestones"
        milestones={unscopedMilestones}
        isViewer={isViewer}
        createLabel="Add project milestone"
        createWorkstreamId={null}
        workstreamOptions={workstreamOptions}
        onCreateMilestone={onCreateMilestone}
        onUpdateMilestone={onUpdateMilestone}
        onUpdateMilestoneStatus={onUpdateMilestoneStatus}
        onCompleteMilestone={onCompleteMilestone}
        onCreatePhase={onCreatePhase}
        onCreatePlan={onCreatePlan}
        onUpdatePhase={onUpdatePhase}
        onUpdatePlan={onUpdatePlan}
        onTransitionPhase={onTransitionPhase}
        onTransitionPlan={onTransitionPlan}
      />
    </div>
  )
}
