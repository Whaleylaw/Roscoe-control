'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

type RouteStatus = 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed' | string

interface WaypointRouteSummary {
  id: number
  workflow_key?: string
  status: RouteStatus
  definition_name?: string
  definition_slug?: string
  definition_version?: number
  started_at?: number
  completed_at?: number | null
  updated_at?: number
}

interface WaypointRouteNode {
  id: number
  node_key: string
  node_type: string
  status: string
  recipe_slug?: string | null
  task_id?: number | null
  review_task_id?: number | null
}

interface WaypointRouteEvent {
  id: number
  event_type: string
  actor_id?: string | null
  node_key?: string | null
  task_id?: number | null
  payload_json?: string
  created_at?: number
}

interface RouteDetailPayload {
  ok: boolean
  route?: WaypointRouteSummary
  vars?: Record<string, unknown>
  nodes?: WaypointRouteNode[]
  error?: string
}

interface RouteEventsPayload {
  ok: boolean
  events?: WaypointRouteEvent[]
  error?: string
}

interface RuntimeEventView {
  event: WaypointRouteEvent
  payload: Record<string, unknown>
  status: string | null
  summary: string | null
  recipeSlug: string | null
  artifacts: string[]
  missingArtifacts: string[]
}

export function WaypointReviewTab({ projectId, routeId }: { projectId: number; routeId: number | string }) {
  const [detail, setDetail] = useState<RouteDetailPayload | null>(null)
  const [events, setEvents] = useState<WaypointRouteEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gateMessage, setGateMessage] = useState<string | null>(null)
  const [gateBusyNode, setGateBusyNode] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [detailRes, eventsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/waypoint/routes/${routeId}`),
        fetch(`/api/projects/${projectId}/waypoint/routes/${routeId}/events?limit=25`),
      ])
      const detailJson = (await detailRes.json()) as RouteDetailPayload
      const eventsJson = (await eventsRes.json()) as RouteEventsPayload
      if (!detailRes.ok || !detailJson.ok) throw new Error(detailJson.error || `Route detail failed: ${detailRes.status}`)
      if (!eventsRes.ok || !eventsJson.ok) throw new Error(eventsJson.error || `Route events failed: ${eventsRes.status}`)
      setDetail(detailJson)
      setEvents(eventsJson.events || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Waypoint review state')
    } finally {
      setLoading(false)
    }
  }, [projectId, routeId])

  useEffect(() => {
    void load()
  }, [load])

  const runtimeEvents = useMemo(() => {
    return events
      .filter((event) => event.event_type.startsWith('waypoint.local_package.'))
      .map(toRuntimeEventView)
      .filter((view): view is RuntimeEventView => Boolean(view))
  }, [events])

  const latestRuntime = runtimeEvents[0] ?? null
  const gateNodes = (detail?.nodes || []).filter((node) =>
    node.status === 'blocked' && (node.node_type.includes('gate') || node.node_key.toLowerCase().includes('handoff')),
  )

  const approveGate = useCallback(async (nodeKey: string) => {
    try {
      setGateBusyNode(nodeKey)
      setGateMessage(null)
      const response = await fetch(`/api/projects/${projectId}/waypoint/routes/${routeId}/gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_key: nodeKey, decision: 'approve', note: 'Operator approved in Mission Control.' }),
      })
      const json = await response.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!response.ok || !json.ok) throw new Error(json.error || `Gate approval failed: ${response.status}`)
      setGateMessage('Gate approved. Refresh route state to continue review.')
    } catch (err) {
      setGateMessage(err instanceof Error ? err.message : 'Gate approval failed')
    } finally {
      setGateBusyNode(null)
    }
  }, [projectId, routeId])

  if (loading) return <div className="text-sm text-muted-foreground">Loading Waypoint review…</div>
  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!detail?.route) return <div className="text-sm text-muted-foreground">No Waypoint route state found.</div>

  const route = detail.route
  const title = route.definition_name || route.definition_slug || route.workflow_key || `Route ${route.id}`
  const caseRoot = stringValue(detail.vars?.case_root)

  return (
    <div role="tabpanel" data-testid="waypoint-review-tab" className="space-y-4">
      <section className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="mt-1 text-[11px] text-muted-foreground font-mono">
              route #{route.id} · {route.definition_slug || route.workflow_key || 'waypoint'}
            </div>
          </div>
          <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${statusClass(route.status)}`}>{route.status}</span>
        </div>
        {caseRoot && (
          <div className="text-xs text-muted-foreground">
            Case root: <span className="font-mono text-foreground/80">{caseRoot}</span>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/50 bg-secondary/20 p-3 space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Package runtime</div>
        {latestRuntime ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {latestRuntime.status && <span className="rounded bg-secondary px-2 py-0.5 text-foreground">{latestRuntime.status}</span>}
              {latestRuntime.recipeSlug && <span className="font-mono text-cyan-300">{latestRuntime.recipeSlug}</span>}
              <span className="text-muted-foreground">{latestRuntime.event.event_type}</span>
            </div>
            {latestRuntime.summary && <p className="text-sm text-foreground/90">{latestRuntime.summary}</p>}
            <PathList title="Artifacts" paths={latestRuntime.artifacts} empty="No artifacts reported yet." />
            <PathList title="Missing artifacts" paths={latestRuntime.missingArtifacts} empty="No missing artifacts reported." tone="blocked" />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No local package runtime event has been recorded yet.</div>
        )}
      </section>

      <section className="rounded-lg border border-border/50 bg-secondary/20 p-3 space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Route nodes</div>
        {(detail.nodes || []).length > 0 ? (
          <div className="space-y-1.5">
            {(detail.nodes || []).map((node) => (
              <div key={node.id} className="flex items-center justify-between gap-3 rounded border border-border/40 bg-card/50 px-2 py-1.5 text-xs">
                <div className="min-w-0">
                  <div className="font-mono text-foreground truncate">{node.node_key}</div>
                  {node.recipe_slug && <div className="mt-0.5 font-mono text-muted-foreground truncate">{node.recipe_slug}</div>}
                </div>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 ${statusClass(node.status)}`}>{node.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No route nodes found.</div>
        )}
      </section>

      {gateNodes.length > 0 && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-amber-200">Operator handoff gates</div>
          {gateNodes.map((node) => (
            <div key={node.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="font-mono text-foreground">{node.node_key}</span>
              <Button size="xs" onClick={() => approveGate(node.node_key)} disabled={gateBusyNode === node.node_key} aria-label={`Approve ${node.node_key}`}>
                {gateBusyNode === node.node_key ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          ))}
          {gateMessage && <div className="text-xs text-amber-100">{gateMessage}</div>}
        </section>
      )}
    </div>
  )
}

function toRuntimeEventView(event: WaypointRouteEvent): RuntimeEventView | null {
  const payload = parsePayload(event.payload_json)
  const artifacts = toStringList(payload.artifacts)
  const missingArtifacts = toStringList(payload.missing_artifacts)
  return {
    event,
    payload,
    status: stringValue(payload.status),
    summary: stringValue(payload.summary),
    recipeSlug: stringValue(payload.recipe_slug),
    artifacts,
    missingArtifacts,
  }
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function PathList({ title, paths, empty, tone }: { title: string; paths: string[]; empty: string; tone?: 'blocked' }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {paths.length > 0 ? (
        <ul className="space-y-1">
          {paths.map((path) => (
            <li key={path} className={`rounded border px-2 py-1 font-mono text-xs ${tone === 'blocked' ? 'border-amber-500/25 bg-amber-500/10 text-amber-100' : 'border-border/40 bg-card/50 text-foreground/80'}`}>
              {path}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-muted-foreground">{empty}</div>
      )}
    </div>
  )
}

function statusClass(status: string): string {
  if (status === 'complete' || status === 'completed' || status === 'ok') return 'border-green-500/25 bg-green-500/10 text-green-300'
  if (status === 'blocked') return 'border-amber-500/25 bg-amber-500/10 text-amber-200'
  if (status === 'failed') return 'border-red-500/25 bg-red-500/10 text-red-300'
  if (status === 'active' || status === 'running') return 'border-blue-500/25 bg-blue-500/10 text-blue-300'
  return 'border-border/50 bg-secondary text-muted-foreground'
}
