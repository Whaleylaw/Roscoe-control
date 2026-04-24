'use client'

import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { modelToTier, modelTierClassName } from '@/lib/model-tier-colors'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { getModel, MODEL_IDS } from '@/lib/model-registry'

/**
 * Phase 16 RUI-06 — Recipes Panel.
 *
 * Read-only list of indexed recipes with a Resync button that calls
 * `POST /api/recipes/resync` and surfaces insert/update/delete counts via
 * an inline feedback banner (pattern copied from github-sync-panel.tsx).
 *
 * Auto-refreshes on `mc:recipe-indexed` / `mc:recipe-removed` DOM events
 * relayed by the Plan 16-01 SSE dispatcher, so filesystem edits under
 * `recipes/` land live without a reload.
 *
 * Authoring stays filesystem-first — no create/edit/delete UI ships here
 * (roadmap SC 5 LOCK). The per-row "View" button expands an inline panel
 * rendering the recipe's `soul_md` via the shared MarkdownRenderer; no
 * new routes and no new modal.
 */

type Recipe = {
  slug: string
  name: string
  description?: string
  when_to_use?: string
  image?: string
  workspace_mode?: 'worktree' | 'readonly' | 'none'
  model?: { primary?: string; fallback?: string; provider?: string }
  tags?: string[]
  env?: Record<string, string>
  secrets?: string[]
  timeout_seconds?: number
  max_concurrent?: number
  version?: number
  soul_md?: string
}

type ResyncReport = {
  scanned: number
  inserted: number
  updated: number
  deleted: number
  errors: Array<{ slug: string; reason: string }>
}

const FEEDBACK_AUTO_CLEAR_MS = 6000
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_SOUL_MD = '# My Recipe Agent\n\nDescribe the agent instructions here.\n'

type EditorState =
  | RecipeFormState & { mode: 'create'; originalSlug: null; saving: boolean }
  | RecipeFormState & { mode: 'edit'; originalSlug: string; saving: boolean }

type RecipeFormState = {
  slug: string
  name: string
  description: string
  whenToUse: string
  image: string
  workspaceMode: 'worktree' | 'readonly' | 'none'
  timeoutSeconds: string
  maxConcurrent: string
  tagsText: string
  envText: string
  secretsText: string
  modelPrimary: string
  modelFallback: string
  soulMd: string
}

export function RecipesPanel() {
  const t = useTranslations('recipesPanel')
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null)

  const fetchRecipes = useCallback(async () => {
    try {
      setLoadError(null)
      const res = await fetch('/api/recipes')
      if (!res.ok) throw new Error(`${res.status}`)
      const data = (await res.json()) as { recipes?: Recipe[] }
      setRecipes(Array.isArray(data?.recipes) ? data.recipes : [])
    } catch {
      setLoadError(t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  // Initial fetch on mount.
  useEffect(() => {
    void fetchRecipes()
  }, [fetchRecipes])

  // SSE-driven live refresh via Plan 16-01's DOM CustomEvent relay.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      void fetchRecipes()
    }
    window.addEventListener('mc:recipe-indexed', handler)
    window.addEventListener('mc:recipe-removed', handler)
    return () => {
      window.removeEventListener('mc:recipe-indexed', handler)
      window.removeEventListener('mc:recipe-removed', handler)
    }
  }, [fetchRecipes])

  const showFeedback = useCallback((ok: boolean, message: string) => {
    setFeedback({ ok, message })
    setTimeout(() => setFeedback(null), FEEDBACK_AUTO_CLEAR_MS)
  }, [])

  const handleResync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const res = await fetch('/api/recipes/resync', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errorMessage = typeof body?.error === 'string' ? body.error : t('resyncError')
        showFeedback(false, errorMessage)
        return
      }
      const report = body as ResyncReport
      showFeedback(
        true,
        t('resyncSuccess', {
          inserted: report.inserted ?? 0,
          updated: report.updated ?? 0,
          deleted: report.deleted ?? 0,
        }),
      )
      await fetchRecipes()
    } catch {
      showFeedback(false, t('resyncError'))
    } finally {
      setSyncing(false)
    }
  }, [syncing, showFeedback, t, fetchRecipes])

  const openCreate = useCallback(() => {
    setEditor({
      mode: 'create',
      originalSlug: null,
      ...emptyRecipeForm(),
      saving: false,
    })
  }, [])

  const openEdit = useCallback((recipe: Recipe) => {
    setEditor({
      mode: 'edit',
      originalSlug: recipe.slug,
      ...recipeToForm(recipe),
      saving: false,
    })
  }, [])

  const closeEditor = useCallback(() => {
    setEditor(null)
  }, [])

  const saveEditor = useCallback(async () => {
    if (!editor || editor.saving) return
    setEditor({ ...editor, saving: true })
    try {
      const isCreate = editor.mode === 'create'
      const recipeYaml = formToYaml(editor)
      const slug = editor.slug.trim()
      const url = isCreate ? '/api/recipes' : `/api/recipes/${encodeURIComponent(editor.originalSlug)}`
      const res = await fetch(url, {
        method: isCreate ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isCreate ? { slug } : {}),
          recipe_yaml: recipeYaml,
          soul_md: editor.soulMd,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const details = Array.isArray(body?.details) ? ` ${body.details.join('; ')}` : ''
        const errorMessage = typeof body?.error === 'string' ? `${body.error}${details}` : t('saveError')
        showFeedback(false, errorMessage)
        setEditor({ ...editor, saving: false })
        return
      }
      showFeedback(true, isCreate ? t('createSuccess') : t('updateSuccess'))
      setEditor(null)
      await fetchRecipes()
    } catch {
      showFeedback(false, t('saveError'))
      setEditor((prev) => prev ? { ...prev, saving: false } : prev)
    }
  }, [editor, fetchRecipes, showFeedback, t])

  const deleteRecipe = useCallback(async (recipe: Recipe) => {
    if (deletingSlug) return
    if (typeof window !== 'undefined' && !window.confirm(t('deleteConfirm', { slug: recipe.slug }))) return
    setDeletingSlug(recipe.slug)
    try {
      const res = await fetch(`/api/recipes/${encodeURIComponent(recipe.slug)}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showFeedback(false, typeof body?.error === 'string' ? body.error : t('deleteError'))
        return
      }
      showFeedback(true, t('deleteSuccess', { slug: recipe.slug }))
      setExpanded((prev) => {
        const next = new Set(prev)
        next.delete(recipe.slug)
        return next
      })
      await fetchRecipes()
    } catch {
      showFeedback(false, t('deleteError'))
    } finally {
      setDeletingSlug(null)
    }
  }, [deletingSlug, fetchRecipes, showFeedback, t])

  const toggle = useCallback((slug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }, [])

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button variant="default" onClick={openCreate}>
          {t('createRecipe')}
        </Button>
        <Button variant="secondary" onClick={handleResync} disabled={syncing}>
          {syncing ? t('resyncing') : t('resync')}
        </Button>
      </header>

      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`px-4 py-2 rounded-md border text-sm ${
            feedback.ok
              ? 'bg-green-500/5 border-green-500/20 text-green-400'
              : 'bg-red-500/5 border-red-500/20 text-red-400'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {editor && (
        <section className="border rounded-md p-4 space-y-3" aria-label={editor.mode === 'create' ? t('createRecipe') : t('editRecipe')}>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <h2 className="text-base font-semibold">
                {editor.mode === 'create' ? t('createRecipe') : t('editRecipe')}
              </h2>
              <p className="text-xs text-muted-foreground">{t('editorHint')}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={closeEditor} disabled={editor.saving}>
              {t('cancel')}
            </Button>
            <Button size="sm" onClick={saveEditor} disabled={editor.saving}>
              {editor.saving ? t('saving') : t('saveRecipe')}
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <RecipeInput label={t('slugField')} value={editor.slug} onChange={(value) => updateEditor(setEditor, { slug: value })} disabled={editor.saving || editor.mode === 'edit'} />
            <RecipeInput label={t('nameField')} value={editor.name} onChange={(value) => updateEditor(setEditor, { name: value })} disabled={editor.saving} />
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t('modelField')}</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={editor.modelPrimary}
                onChange={(event) => updateEditor(setEditor, { modelPrimary: event.target.value })}
                disabled={editor.saving}
              >
                {modelOptions(editor.modelPrimary).map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t('fallbackModelField')}</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={editor.modelFallback}
                onChange={(event) => updateEditor(setEditor, { modelFallback: event.target.value })}
                disabled={editor.saving}
              >
                <option value="">{t('noneOption')}</option>
                {modelOptions(editor.modelFallback).map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </label>
            <RecipeInput label={t('imageField')} value={editor.image} onChange={(value) => updateEditor(setEditor, { image: value })} disabled={editor.saving} />
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t('workspaceModeField')}</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={editor.workspaceMode}
                onChange={(event) => updateEditor(setEditor, { workspaceMode: event.target.value as RecipeFormState['workspaceMode'] })}
                disabled={editor.saving}
              >
                <option value="worktree">worktree</option>
                <option value="readonly">readonly</option>
                <option value="none">none</option>
              </select>
            </label>
            <RecipeInput label={t('timeoutSecondsField')} value={editor.timeoutSeconds} onChange={(value) => updateEditor(setEditor, { timeoutSeconds: value })} disabled={editor.saving} type="number" min={10} max={86400} />
            <RecipeInput label={t('maxConcurrentField')} value={editor.maxConcurrent} onChange={(value) => updateEditor(setEditor, { maxConcurrent: value })} disabled={editor.saving} type="number" min={1} max={100} />
            <RecipeInput label={t('tagsField')} value={editor.tagsText} onChange={(value) => updateEditor(setEditor, { tagsText: value })} disabled={editor.saving} placeholder="docs, planning" />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <RecipeTextarea label={t('descriptionField')} value={editor.description} onChange={(value) => updateEditor(setEditor, { description: value })} disabled={editor.saving} minHeight="min-h-28" />
            <RecipeTextarea label={t('whenToUseField')} value={editor.whenToUse} onChange={(value) => updateEditor(setEditor, { whenToUse: value })} disabled={editor.saving} minHeight="min-h-28" />
            <RecipeTextarea label={t('envField')} value={editor.envText} onChange={(value) => updateEditor(setEditor, { envText: value })} disabled={editor.saving} placeholder="KEY=value" minHeight="min-h-28" />
            <RecipeTextarea label={t('secretsField')} value={editor.secretsText} onChange={(value) => updateEditor(setEditor, { secretsText: value })} disabled={editor.saving} placeholder="API_KEY" minHeight="min-h-28" />
            <div className="lg:col-span-2">
              <RecipeTextarea label={t('soulMd')} value={editor.soulMd} onChange={(value) => updateEditor(setEditor, { soulMd: value })} disabled={editor.saving} minHeight="min-h-56" />
            </div>
          </div>
        </section>
      )}

      {loading && recipes.length === 0 && (
        <p className="text-sm text-muted-foreground">…</p>
      )}
      {loadError && recipes.length === 0 && (
        <p className="text-sm text-red-400">{loadError}</p>
      )}

      {!loading && !loadError && recipes.length === 0 && (
        <div className="border border-dashed rounded-md p-8 text-center space-y-1">
          <p className="text-base font-medium">{t('emptyHeading')}</p>
          <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
        </div>
      )}

      {recipes.length > 0 && (
        <ul className="space-y-3" aria-label={t('title')}>
          {recipes.map((r) => {
            const tier = modelToTier(r.model?.primary)
            const tierClass = modelTierClassName(tier)
            const isOpen = expanded.has(r.slug)
            return (
              <li key={r.slug} className="border rounded-md">
                <div className="flex items-start gap-3 p-4">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{r.name}</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {r.slug}
                      </span>
                      {r.model?.primary && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${tierClass}`}
                        >
                          {r.model.primary}
                        </span>
                      )}
                    </div>
                    {r.description && (
                      <p className="text-sm text-muted-foreground">{r.description}</p>
                    )}
                    {r.tags && r.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground border"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggle(r.slug)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? t('hideRecipe') : t('viewRecipe')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(r)}
                  >
                    {t('editRecipe')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteRecipe(r)}
                    disabled={deletingSlug === r.slug}
                  >
                    {deletingSlug === r.slug ? t('deleting') : t('deleteRecipe')}
                  </Button>
                </div>
                {isOpen && r.soul_md && (
                  <div className="px-4 pb-4 border-t pt-3">
                    <MarkdownRenderer content={r.soul_md} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function RecipeInput({
  label,
  value,
  onChange,
  disabled,
  type = 'text',
  min,
  max,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  type?: 'text' | 'number'
  min?: number
  max?: number
  placeholder?: string
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        type={type}
        min={min}
        max={max}
        placeholder={placeholder}
      />
    </label>
  )
}

function RecipeTextarea({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  minHeight = 'min-h-36',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  minHeight?: string
}) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <textarea
        className={`${minHeight} w-full rounded-md border bg-background p-3 text-sm leading-5 outline-none focus:ring-2 focus:ring-ring`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
      />
    </label>
  )
}

function updateEditor(
  setEditor: Dispatch<SetStateAction<EditorState | null>>,
  patch: Partial<RecipeFormState>,
) {
  setEditor((prev) => prev ? { ...prev, ...patch } : prev)
}

function emptyRecipeForm(): RecipeFormState {
  return {
    slug: 'my-recipe',
    name: 'My Recipe',
    description: 'What this recipe does.',
    whenToUse: 'When this recipe should be selected.',
    image: 'my-agent-image:latest',
    workspaceMode: 'worktree',
    timeoutSeconds: '600',
    maxConcurrent: '1',
    tagsText: 'example',
    envText: '',
    secretsText: '',
    modelPrimary: DEFAULT_MODEL,
    modelFallback: '',
    soulMd: DEFAULT_SOUL_MD,
  }
}

function recipeToForm(recipe: Recipe): RecipeFormState {
  return {
    slug: recipe.slug,
    name: recipe.name,
    description: recipe.description || '',
    whenToUse: recipe.when_to_use || '',
    image: recipe.image || 'my-agent-image:latest',
    workspaceMode: recipe.workspace_mode || 'worktree',
    timeoutSeconds: String(recipe.timeout_seconds || 600),
    maxConcurrent: String(recipe.max_concurrent || 1),
    tagsText: recipe.tags?.join(', ') || '',
    envText: recipe.env ? Object.entries(recipe.env).map(([key, value]) => `${key}=${value}`).join('\n') : '',
    secretsText: recipe.secrets?.join('\n') || '',
    modelPrimary: recipe.model?.primary || DEFAULT_MODEL,
    modelFallback: recipe.model?.fallback || '',
    soulMd: recipe.soul_md || '',
  }
}

function formToYaml(form: RecipeFormState): string {
  const lines: string[] = [
    `slug: ${yamlScalar(form.slug.trim())}`,
    `name: ${yamlScalar(form.name.trim())}`,
  ]
  pushYamlField(lines, 'description', form.description)
  pushYamlField(lines, 'when_to_use', form.whenToUse)
  lines.push(
    `image: ${yamlScalar(form.image.trim())}`,
    `workspace_mode: ${form.workspaceMode}`,
    `timeout_seconds: ${numberOrDefault(form.timeoutSeconds, 600)}`,
    `max_concurrent: ${numberOrDefault(form.maxConcurrent, 1)}`,
  )
  const tags = splitList(form.tagsText)
  if (tags.length > 0) {
    lines.push('tags:')
    for (const tag of tags) lines.push(`  - ${yamlScalar(tag)}`)
  }
  const env = parseEnvLines(form.envText)
  if (Object.keys(env).length > 0) {
    lines.push('env:')
    for (const [key, value] of Object.entries(env)) lines.push(`  ${key}: ${yamlScalar(value)}`)
  }
  const secrets = splitList(form.secretsText)
  if (secrets.length > 0) {
    lines.push('secrets:')
    for (const secret of secrets) lines.push(`  - ${yamlScalar(secret)}`)
  }
  const modelPrimary = form.modelPrimary || DEFAULT_MODEL
  const provider = getModel(modelPrimary)?.provider
  lines.push('model:', `  primary: ${yamlScalar(modelPrimary)}`)
  if (provider) lines.push(`  provider: ${yamlScalar(provider)}`)
  if (form.modelFallback) lines.push(`  fallback: ${yamlScalar(form.modelFallback)}`)
  return `${lines.join('\n')}\n`
}

function modelOptions(current: string): string[] {
  if (current && !MODEL_IDS.includes(current as (typeof MODEL_IDS)[number])) return [current, ...MODEL_IDS]
  return MODEL_IDS
}

function splitList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseEnvLines(raw: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf('=')
    if (separator === -1) {
      env[trimmed] = ''
      continue
    }
    const key = trimmed.slice(0, separator).trim()
    if (!key) continue
    env[key] = trimmed.slice(separator + 1).trim()
  }
  return env
}

function numberOrDefault(raw: string, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function pushYamlField(lines: string[], key: string, value: string) {
  const trimmed = value.trim()
  if (!trimmed) return
  if (trimmed.includes('\n')) {
    lines.push(`${key}: |`)
    for (const line of trimmed.split('\n')) lines.push(`  ${line}`)
    return
  }
  lines.push(`${key}: ${yamlScalar(trimmed)}`)
}

function yamlScalar(value: string): string {
  if (!value) return '""'
  if (/^[a-zA-Z0-9_./:-]+(?: [a-zA-Z0-9_./:-]+)*$/.test(value)) return value
  return JSON.stringify(value)
}
