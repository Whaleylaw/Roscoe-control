'use client'

import * as React from 'react'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useProjectWorkspace } from '@/components/project/project-context'
import { useMissionControl } from '@/store'
import type { Project } from '@/store'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'

// Duplicated from src/components/modals/project-manager-modal.tsx:30-39 per D-11.
// Do NOT import from the modal — each view owns its own copy so the modal can
// evolve independently.
const COLOR_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
]

// Mirror of server normalizePrefix from src/app/api/projects/[id]/route.ts:11-14.
// Used for dirty-check comparison only — the raw user input is sent to the
// server which re-normalizes authoritatively.
function normalizePrefixForCompare(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

function deadlineToYyyyMmDd(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return ''
  return new Date(unixSeconds * 1000).toISOString().split('T')[0]
}

interface FieldErrors {
  name?: string
  ticketPrefix?: string
  status?: string
}

interface FieldBlockProps {
  id: string
  label: string
  helperId?: string
  helperText?: string
  errorText?: string
  colSpanClass?: string
  children: React.ReactNode
}

function FieldBlock({
  id,
  label,
  helperId,
  helperText,
  errorText,
  colSpanClass = 'md:col-span-1',
  children,
}: FieldBlockProps) {
  return (
    <div className={`space-y-2 ${colSpanClass}`}>
      <label htmlFor={id} className="block text-sm font-semibold text-foreground">
        {label}
      </label>
      {children}
      {errorText ? (
        <p className="text-xs text-destructive" role="alert">
          {errorText}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-xs text-muted-foreground">
          {helperText}
        </p>
      ) : null}
    </div>
  )
}

export function SettingsView() {
  const t = useTranslations('project.settings')
  const tCommon = useTranslations('project.common')
  const { project, loading, error } = useProjectWorkspace()
  const { currentUser, fetchProjects } = useMissionControl()
  const isViewer = currentUser?.role === 'viewer'

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<'active' | 'archived'>('active')
  const [color, setColor] = useState('')
  const [ticketPrefix, setTicketPrefix] = useState('')
  const [deadline, setDeadline] = useState('') // YYYY-MM-DD
  const [githubRepo, setGithubRepo] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const bannerRef = useRef<HTMLDivElement>(null)
  const lastSeededProjectIdRef = useRef<number | null>(null)
  const shouldFocusBannerRef = useRef(false)

  // Focus the error banner once it mounts after a failed save.
  useEffect(() => {
    if (bannerError && shouldFocusBannerRef.current && bannerRef.current) {
      bannerRef.current.focus()
      shouldFocusBannerRef.current = false
    }
  }, [bannerError])

  // isDirty must be derived before the seeding effect so the effect can skip
  // re-seeding while the user has unsaved edits (Pitfall: in-progress edits
  // preserved across projects[] refresh).
  const isDirty = useMemo(() => {
    if (!project) return false
    if (name.trim() !== (project.name ?? '').trim()) return true
    if (description.trim() !== (project.description ?? '').trim()) return true
    if (status !== (project.status ?? 'active')) return true
    if (color !== (project.color ?? '')) return true
    if (
      normalizePrefixForCompare(ticketPrefix) !==
      normalizePrefixForCompare(project.ticket_prefix ?? '')
    ) {
      return true
    }
    const loadedDeadline = deadlineToYyyyMmDd(project.deadline)
    if (deadline !== loadedDeadline) return true
    if (githubRepo.trim() !== (project.github_repo ?? '').trim()) return true
    return false
  }, [project, name, description, status, color, ticketPrefix, deadline, githubRepo])

  // Seed state when project id changes, or on first load. Skip re-seeding when
  // the form is dirty so an in-flight edit isn't clobbered by a projects[]
  // refresh for the same project.
  useEffect(() => {
    if (!project) return
    const sameProject = lastSeededProjectIdRef.current === project.id
    if (sameProject && isDirty) return
    setName(project.name ?? '')
    setDescription(project.description ?? '')
    setStatus(project.status === 'archived' ? 'archived' : 'active')
    setColor(project.color ?? '')
    setTicketPrefix(project.ticket_prefix ?? '')
    setDeadline(deadlineToYyyyMmDd(project.deadline))
    setGithubRepo(project.github_repo ?? '')
    lastSeededProjectIdRef.current = project.id
  }, [project, isDirty])

  const canSave = isDirty && name.trim().length > 0 && !isSaving

  const save = async () => {
    if (!project || isSaving || !canSave) return
    setIsSaving(true)
    setBannerError(null)
    setFieldErrors({})

    // Build PATCH body. Per SETT-03: name is always included; other fields
    // only when their normalized value differs from the loaded project.
    // The ticket counter is never sent (pitfall).
    const body: Record<string, unknown> = { name: name.trim() }

    if (description.trim() !== (project.description ?? '').trim()) {
      body.description = description // '' allowed; server coerces to null
    }
    if (status !== (project.status ?? 'active')) {
      body.status = status
    }
    if (color !== (project.color ?? '')) {
      body.color = color // '' allowed; server coerces to null
    }
    if (
      normalizePrefixForCompare(ticketPrefix) !==
      normalizePrefixForCompare(project.ticket_prefix ?? '')
    ) {
      body.ticket_prefix = ticketPrefix // server normalizes authoritatively
    }
    const loadedDeadlineStr = deadlineToYyyyMmDd(project.deadline)
    if (deadline !== loadedDeadlineStr) {
      body.deadline = deadline
        ? Math.floor(new Date(deadline).getTime() / 1000)
        : null
    }
    if (githubRepo.trim() !== (project.github_repo ?? '').trim()) {
      body.github_repo = githubRepo // '' allowed; server coerces to null
    }

    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errText =
          typeof (data as { error?: unknown })?.error === 'string'
            ? ((data as { error: string }).error)
            : ''
        if (errText === 'Project name cannot be empty') {
          setFieldErrors({ name: t('errorNameRequired') })
        } else if (errText === 'Ticket prefix already in use') {
          setFieldErrors({ ticketPrefix: t('errorPrefixConflict') })
        } else if (errText === 'Invalid ticket prefix') {
          setFieldErrors({ ticketPrefix: t('errorPrefixInvalid') })
        } else if (errText === 'Default project cannot be archived') {
          setFieldErrors({ status: t('errorDefaultArchive') })
        } else {
          shouldFocusBannerRef.current = true
          setBannerError(errText || t('errorBannerFallback'))
        }
        return
      }

      // Success — server echoes normalized project row. Re-seed state from the
      // echo so the form immediately reflects the server's canonical values
      // (e.g. normalized ticket_prefix), then refresh Zustand so breadcrumb,
      // dashboard and nav observe the update. No router refresh, no SSE.
      const echoed = (data as { project?: Project })?.project
      if (echoed) {
        setName(echoed.name ?? '')
        setDescription(echoed.description ?? '')
        setStatus(echoed.status === 'archived' ? 'archived' : 'active')
        setColor(echoed.color ?? '')
        setTicketPrefix(echoed.ticket_prefix ?? '')
        setDeadline(deadlineToYyyyMmDd(echoed.deadline))
        setGithubRepo(echoed.github_repo ?? '')
        lastSeededProjectIdRef.current = echoed.id ?? lastSeededProjectIdRef.current
      }
      await fetchProjects()
    } catch {
      shouldFocusBannerRef.current = true
      setBannerError(t('errorBannerFallback'))
    } finally {
      setIsSaving(false)
    }
  }

  const cancel = () => {
    if (!project) return
    setName(project.name ?? '')
    setDescription(project.description ?? '')
    setStatus(project.status === 'archived' ? 'archived' : 'active')
    setColor(project.color ?? '')
    setTicketPrefix(project.ticket_prefix ?? '')
    setDeadline(deadlineToYyyyMmDd(project.deadline))
    setGithubRepo(project.github_repo ?? '')
    setFieldErrors({})
    setBannerError(null)
  }

  // Gate: loading state
  if (loading && !project) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader />
      </div>
    )
  }

  // Gate: load error
  if (error) {
    return (
      <div className="p-6 max-w-3xl">
        <div className="bg-surface-1 border border-border rounded-md p-4 space-y-3">
          <h2 className="text-lg font-semibold">{t('loadErrorHeading')}</h2>
          <Button variant="secondary" onClick={() => fetchProjects()}>
            {tCommon('retry')}
          </Button>
        </div>
      </div>
    )
  }

  const inputClass =
    'w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed'

  const isGeneralSlug = project?.slug === 'general'

  return (
    <div className="p-6 max-w-3xl pb-12">
      <h2 className="text-lg font-semibold mb-6">{t('title')}</h2>

      {isViewer && (
        <div className="text-xs text-muted-foreground bg-surface-1 border border-border rounded-md px-3 py-2 mb-6">
          {t('readOnlyNote')}
        </div>
      )}

      {bannerError && (
        <div
          ref={bannerRef}
          role="alert"
          tabIndex={-1}
          className="bg-destructive/10 border border-destructive/30 text-destructive rounded-md p-3 mb-6"
        >
          <div className="text-sm font-semibold">{t('errorBannerHeading')}</div>
          <div className="text-sm font-normal text-destructive/90">{bannerError}</div>
        </div>
      )}

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSave && !isViewer) void save()
        }}
      >
        {/* Section 1 — Basics */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">{t('sectionBasics')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldBlock
              id="settings-name"
              label={t('nameLabel')}
              errorText={fieldErrors.name}
              colSpanClass="md:col-span-2"
            >
              <input
                id="settings-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                className={`${inputClass} aria-invalid:border-destructive`}
                aria-required="true"
                aria-invalid={!!fieldErrors.name}
                disabled={isViewer || isSaving}
              />
            </FieldBlock>

            <FieldBlock
              id="settings-description"
              label={t('descriptionLabel')}
              colSpanClass="md:col-span-2"
            >
              <textarea
                id="settings-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('descriptionPlaceholder')}
                className={`${inputClass} resize-none`}
                disabled={isViewer || isSaving}
              />
            </FieldBlock>

            <FieldBlock
              id="settings-status"
              label={t('statusLabel')}
              errorText={fieldErrors.status}
              colSpanClass="md:col-span-1"
            >
              <select
                id="settings-status"
                value={status}
                onChange={(e) => setStatus(e.target.value === 'archived' ? 'archived' : 'active')}
                className={`${inputClass} h-9`}
                aria-invalid={!!fieldErrors.status}
                disabled={isViewer || isSaving}
              >
                <option value="active">{t('statusActive')}</option>
                <option value="archived" disabled={isGeneralSlug}>
                  {t('statusArchived')}
                </option>
              </select>
            </FieldBlock>
          </div>
        </section>

        {/* Section 2 — Appearance & Tracking */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">{t('sectionAppearance')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <fieldset className="space-y-2 md:col-span-2">
              <legend className="text-sm font-semibold text-foreground">{t('colorLabel')}</legend>
              <div className="flex gap-2 flex-wrap items-center">
                {COLOR_PALETTE.map((c) => {
                  const selected = color === c
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      aria-pressed={selected}
                      onClick={() => setColor(selected ? '' : c)}
                      disabled={isViewer || isSaving}
                      className={`w-6 h-6 rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                        selected
                          ? 'border-foreground scale-110'
                          : 'border-transparent hover:border-border'
                      } ${isViewer ? 'pointer-events-none opacity-60' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  )
                })}
                <button
                  type="button"
                  aria-pressed={color === ''}
                  onClick={() => setColor('')}
                  disabled={isViewer || isSaving}
                  className="bg-transparent border border-border rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {t('colorNone')}
                </button>
              </div>
            </fieldset>

            <FieldBlock
              id="settings-prefix"
              label={t('prefixLabel')}
              helperId="prefix-help"
              helperText={t('prefixHelp')}
              errorText={fieldErrors.ticketPrefix}
              colSpanClass="md:col-span-1"
            >
              <input
                id="settings-prefix"
                type="text"
                value={ticketPrefix}
                onChange={(e) => setTicketPrefix(e.target.value)}
                placeholder={t('prefixPlaceholder')}
                className={`${inputClass} font-mono uppercase aria-invalid:border-destructive`}
                maxLength={12}
                aria-invalid={!!fieldErrors.ticketPrefix}
                aria-describedby="prefix-help"
                disabled={isViewer || isSaving}
              />
            </FieldBlock>

            <FieldBlock
              id="settings-deadline"
              label={t('deadlineLabel')}
              colSpanClass="md:col-span-1"
            >
              <input
                id="settings-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className={`${inputClass} h-9`}
                disabled={isViewer || isSaving}
              />
            </FieldBlock>
          </div>
        </section>

        {/* Section 3 — Integrations */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">{t('sectionIntegrations')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldBlock
              id="settings-github-repo"
              label={t('githubRepoLabel')}
              helperId="github-help"
              helperText={t('githubRepoHelp')}
              colSpanClass="md:col-span-2"
            >
              <input
                id="settings-github-repo"
                type="text"
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                placeholder={t('githubRepoPlaceholder')}
                className={inputClass}
                aria-describedby="github-help"
                disabled={isViewer || isSaving}
              />
            </FieldBlock>
          </div>
        </section>
      </form>

      {isDirty && !isViewer && (
        <div className="sticky bottom-0 -mx-6 mt-6 px-6 py-4 bg-card/95 backdrop-blur border-t border-border flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isSaving ? (
              <span>{t('saving')}</span>
            ) : (
              <>
                <span
                  className="inline-block w-2 h-2 bg-primary rounded-full"
                  aria-hidden="true"
                />
                <span>{t('unsavedChanges')}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={cancel}
              disabled={isSaving}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="default"
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
            >
              {isSaving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
