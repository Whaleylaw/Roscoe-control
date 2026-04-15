'use client'

import { useEffect, useState, useCallback, startTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useProjectWorkspace } from '@/components/project/project-context'

type Thread = {
  id: string
  conversationId: string
  agentName: string
  agentStatus: string
  lastMessage: string | null
  lastActivity: number
  assignmentSource: 'assigned' | 'task'
}

type RuntimeSession = {
  id: string
  kind: 'Claude' | 'Codex' | 'Hermes' | 'Gateway'
  ticketRef: string | null
  startedAt: number
  active: boolean
  status: 'running' | 'finished' | 'failed'
  agent: string | null
}

type ProjectSessionsResponse = { threads: Thread[]; runtimeSessions: RuntimeSession[] }

const STATUS_DOT_CLASS: Record<string, string> = {
  idle: 'bg-success',
  busy: 'bg-warning',
  offline: 'bg-destructive',
  error: 'bg-destructive',
  running: 'bg-success',
  finished: 'bg-muted-foreground',
  failed: 'bg-destructive',
}

const RUNTIME_KIND_KEY: Record<RuntimeSession['kind'], string> = {
  Claude: 'runtimeClaude',
  Codex: 'runtimeCodex',
  Hermes: 'runtimeHermes',
  Gateway: 'runtimeGateway',
}

const RUNTIME_STATUS_KEY: Record<RuntimeSession['status'], string> = {
  running: 'statusRunning',
  finished: 'statusFinished',
  failed: 'statusFailed',
}

function relativeTime(
  tDash: (k: string, vars?: Record<string, string | number | Date>) => string,
  ts: number,
): string {
  if (!ts) return ''
  const now = Date.now()
  const diffSec = Math.max(0, (now - ts) / 1000)
  if (diffSec < 60) return tDash('justNow')
  if (diffSec < 3600) return tDash('minutesAgo', { count: Math.floor(diffSec / 60) })
  if (diffSec < 86400) return tDash('hoursAgo', { count: Math.floor(diffSec / 3600) })
  return tDash('daysAgo', { count: Math.floor(diffSec / 86400) })
}

function rowClass(selected: boolean): string {
  return (
    'flex items-start gap-3 bg-card border border-border rounded-md p-4 ' +
    'hover:bg-surface-2 transition-colors cursor-pointer ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'animate-fade-in' +
    (selected ? ' bg-primary/10 border-l-2 border-l-primary' : '')
  )
}

export function SessionsView() {
  const t = useTranslations('project.sessions')
  const tCommon = useTranslations('project.common')
  const tDash = useTranslations('project.dashboard')
  const tAgents = useTranslations('project.agents')
  const router = useRouter()
  const { project, slug, detailId } = useProjectWorkspace()

  const [data, setData] = useState<ProjectSessionsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!project) return
    setError(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/sessions`)
      if (!res.ok) throw new Error(res.statusText || 'fetch failed')
      const json: ProjectSessionsResponse = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'fetch failed')
    }
  }, [project])

  useEffect(() => {
    load()
  }, [load])

  // D-20: SSE re-fetch on chat.message events. The relay is dispatched by
  // use-server-events.ts when the SSE channel pushes `chat.message`.
  useEffect(() => {
    if (!project) return
    const handler = () => {
      load()
    }
    window.addEventListener('mc:chat-message', handler)
    return () => window.removeEventListener('mc:chat-message', handler)
  }, [project, load])

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => router.push(href, { scroll: false } as any))
    },
    [router],
  )

  if (!project) return null

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 text-center">
        <span className="text-destructive text-2xl" aria-hidden="true">
          !
        </span>
        <h2 className="text-lg font-semibold">{t('errorHeading')}</h2>
        <p className="text-sm text-muted-foreground max-w-sm">{t('errorBody')}</p>
        <button
          type="button"
          onClick={() => load()}
          className="bg-surface-2 hover:bg-surface-3 border border-border text-sm font-semibold px-4 py-2 rounded-md transition-colors"
        >
          {tCommon('retry')}
        </button>
      </div>
    )
  }

  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>
  }

  const empty = data.threads.length === 0 && data.runtimeSessions.length === 0

  if (empty) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 text-center">
        <span className="text-4xl" aria-hidden="true">
          💬
        </span>
        <h2 className="text-lg font-semibold">{t('emptyHeading')}</h2>
        <p className="text-sm text-muted-foreground max-w-sm">{t('emptyBody')}</p>
        <button
          type="button"
          onClick={() => navigate(`/project/${slug}/agents`)}
          className="mt-6 bg-primary text-primary-foreground text-sm font-semibold px-4 py-2 rounded-md transition-colors"
        >
          {t('emptyCta')}
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {data.threads.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">{t('threadsHeader')}</h3>
          <ul className="space-y-2">
            {data.threads.map((thread) => {
              const selected = detailId === thread.id
              const dotClass = STATUS_DOT_CLASS[thread.agentStatus] ?? 'bg-muted-foreground'
              return (
                <li key={thread.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={rowClass(selected)}
                    onClick={() => navigate(`/project/${slug}/sessions/${thread.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        navigate(`/project/${slug}/sessions/${thread.id}`)
                      }
                    }}
                  >
                    <span
                      className={`mt-1.5 w-2 h-2 rounded-full ${dotClass}`}
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{thread.agentName}</span>
                        {thread.assignmentSource === 'assigned' && (
                          <span className="text-xs font-normal bg-primary/10 text-primary border border-primary/30 px-2 py-0.5 rounded">
                            {tAgents('assignedChip')}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {thread.lastMessage ?? t('threadEmptyPreview')}
                      </div>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                      {relativeTime(tDash, thread.lastActivity)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {data.runtimeSessions.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">{t('runtimeHeader')}</h3>
          <ul className="space-y-2">
            {data.runtimeSessions.map((session) => {
              const selected = detailId === session.id
              const dotClass = STATUS_DOT_CLASS[session.status] ?? 'bg-muted-foreground'
              return (
                <li key={session.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={rowClass(selected)}
                    onClick={() => navigate(`/project/${slug}/sessions/${session.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        navigate(`/project/${slug}/sessions/${session.id}`)
                      }
                    }}
                  >
                    <span
                      className={`mt-1.5 w-2 h-2 rounded-full ${dotClass}`}
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded">
                          {t(RUNTIME_KIND_KEY[session.kind])}
                        </span>
                        <span className="text-sm text-foreground truncate">
                          {session.ticketRef
                            ? t('taskLabel', { ticketRef: session.ticketRef })
                            : session.id}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {t(RUNTIME_STATUS_KEY[session.status])}
                      </div>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                      {relativeTime(tDash, session.startedAt)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
