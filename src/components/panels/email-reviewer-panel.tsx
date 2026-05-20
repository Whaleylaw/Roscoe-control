'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

type EmailTriageMessage = {
  id: number
  gmail_message_id: string
  gmail_thread_id: string | null
  sent_at: number | null
  from_name: string | null
  from_email: string | null
  sender_domain: string | null
  subject: string | null
  snippet: string | null
  body_text?: string | null
  body_fetched_at?: number | null
  is_unread: number
  has_attachments: number
  bucket: string
  confidence: number | null
  reason: string | null
  suggested_action: string
  review_status: string
  action_taken: string | null
  case_slug: string | null
  contact_name: string | null
  contact_match_type: string | null
  contact_match_value: string | null
  contact_confidence: number | null
  tags_json: string
  paralegal_review_status: string | null
}

type EmailTriageStats = {
  total: number
  unread: number
  pending: number
  byBucket: Record<string, number>
  topSenders: Array<{ sender: string; count: number }>
  lastInventoryAt: number | null
}

const buckets = [
  { id: 'all', label: 'All' },
  { id: 'needs_review', label: 'Needs review' },
  { id: 'ops_action', label: 'Ops/action' },
  { id: 'case_related', label: 'Case-related' },
  { id: 'receipt', label: 'Receipts' },
  { id: 'newsletter', label: 'Read later' },
  { id: 'junk', label: 'Junk' },
  { id: 'personal', label: 'Personal' },
  { id: 'spam_review', label: 'Spam review' },
]

export function EmailReviewerPanel() {
  const [emails, setEmails] = useState<EmailTriageMessage[]>([])
  const [stats, setStats] = useState<EmailTriageStats | null>(null)
  const [bucket, setBucket] = useState('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkBucket, setBulkBucket] = useState('needs_review')
  const [activeEmail, setActiveEmail] = useState<EmailTriageMessage | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const fetchInventory = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ bucket, limit: '100' })
    if (query.trim()) params.set('q', query.trim())
    try {
      const res = await fetch(`/api/law-firm/email-triage?${params.toString()}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load email triage inventory')
      setEmails(Array.isArray(body?.emails) ? body.emails : [])
      setStats(body?.stats || null)
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email triage inventory')
    } finally {
      setLoading(false)
    }
  }, [bucket, query])

  useEffect(() => {
    void fetchInventory()
  }, [fetchInventory])

  const selectedIds = useMemo(() => Array.from(selected), [selected])

  async function runInventory() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/law-firm/email-triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inventory', query: 'is:unread', max: 500 }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Inventory failed')
      const contacts = body?.result?.contacts?.indexed
      const contactText = typeof contacts === 'number' ? ` Indexed ${contacts} FirmVault contact match values first.` : ''
      setNotice(`Imported ${body?.result?.imported ?? 0} unread messages into the local review DB.${contactText}`)
      await fetchInventory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inventory failed')
    } finally {
      setBusy(false)
    }
  }

  async function updateSelected(patch: Record<string, string>) {
    if (selectedIds.length === 0) return
    await updateEmails(selectedIds, patch)
  }

  async function applyBulkCategory() {
    await updateSelected({ bucket: bulkBucket, suggested_action: defaultActionForBucket(bulkBucket) })
  }

  async function updateEmail(id: number, patch: Record<string, string>) {
    await updateEmails([id], patch)
  }

  async function updateEmails(ids: number[], patch: Record<string, string>) {
    if (ids.length === 0) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/law-firm/email-triage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, ...patch }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Update failed')
      const learned = body?.result?.learned ? ` Learned ${body.result.learned} sender rule(s).` : ''
      setNotice(`Updated ${body?.result?.updated ?? ids.length} messages.${learned}`)
      await fetchInventory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function openEmail(email: EmailTriageMessage) {
    setActiveEmail(email)
    if (email.body_text) return
    setPreviewLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/law-firm/email-triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fetch_body', id: email.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load email body')
      const fetched = body?.result?.email as EmailTriageMessage | undefined
      if (fetched) {
        setActiveEmail(fetched)
        setEmails((prev) => prev.map((item) => item.id === fetched.id ? fetched : item))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email body')
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <div aria-label="Email reviewer workspace" className="flex h-full min-h-0 flex-col overflow-hidden">
      <div aria-label="Email reviewer controls" className="shrink-0 border-b border-border bg-background">
        <section className="grid gap-3 border-b border-border p-4 md:grid-cols-4">
          <Metric label="Indexed" value={String(stats?.total ?? 0)} />
          <Metric label="Unread" value={String(stats?.unread ?? 0)} />
          <Metric label="Pending review" value={String(stats?.pending ?? 0)} />
          <Metric label="Last inventory" value={formatTimestamp(stats?.lastInventoryAt)} />
        </section>

        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          <input
            className="h-10 min-w-64 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="Search sender, subject, snippet…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button variant="secondary" onClick={fetchInventory} disabled={loading || busy}>Refresh</Button>
          <Button onClick={runInventory} disabled={busy}>Inventory unread</Button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-border p-4">
          {buckets.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setBucket(item.id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${bucket === item.id ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}
            >
              {item.label}{item.id !== 'all' && stats?.byBucket?.[item.id] ? ` (${stats.byBucket[item.id]})` : ''}
            </button>
          ))}
        </div>

        <div
          aria-label="Selected email actions"
          className="flex flex-wrap items-center gap-2 p-3 text-xs"
        >
          <span className="text-muted-foreground">{selectedIds.length} selected</span>
          <label className="flex items-center gap-2 text-muted-foreground">
            Bulk category
            <select
              className="h-8 rounded border bg-background px-2 text-xs text-foreground"
              value={bulkBucket}
              onChange={(event) => setBulkBucket(event.target.value)}
              aria-label="Bulk category"
            >
              {buckets.filter((item) => item.id !== 'all').map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <Button variant="outline" size="sm" disabled={busy || selectedIds.length === 0} onClick={applyBulkCategory}>Apply category</Button>
          <Button variant="outline" size="sm" disabled={busy || selectedIds.length === 0} onClick={() => updateSelected({ review_status: 'approved', suggested_action: 'mark_read_archive' })}>Approve read/archive</Button>
        </div>

        {notice && <div className="mx-4 mb-3 rounded-md border border-green-500/20 bg-green-500/5 p-3 text-sm text-green-300">{notice}</div>}
        {error && <div className="mx-4 mb-3 rounded-md border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>}
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.1fr)_260px]">
        <div aria-label="Email message list" className="min-h-0 overflow-y-auto border-r border-border">
          {loading && emails.length === 0 && <p className="p-4 text-sm text-muted-foreground">Loading email inventory…</p>}
          {!loading && emails.length === 0 && (
            <div className="p-8 text-sm text-muted-foreground">
              No indexed emails yet. Run a read-only inventory first. This stores Gmail metadata/snippets locally; it does not delete or archive anything.
            </div>
          )}
          {emails.map((email) => (
            <EmailRow
              key={email.id}
              email={email}
              selected={selected.has(email.id)}
              active={activeEmail?.id === email.id}
              onOpen={() => void openEmail(email)}
              onMove={(nextBucket) => void updateEmail(email.id, { bucket: nextBucket, suggested_action: defaultActionForBucket(nextBucket) })}
              onToggle={() => setSelected((prev) => {
                const next = new Set(prev)
                if (next.has(email.id)) next.delete(email.id)
                else next.add(email.id)
                return next
              })}
            />
          ))}
        </div>
        <EmailPreview email={activeEmail} loading={previewLoading} />
        <aside className="hidden min-h-0 overflow-y-auto border-l border-border p-4 lg:block">
          <h3 className="font-medium text-foreground">Top senders</h3>
          <ul className="mt-3 space-y-2 text-xs">
            {(stats?.topSenders || []).map((sender) => (
              <li key={sender.sender} className="flex items-center justify-between gap-2 border-b border-border/50 pb-1">
                <span className="truncate text-muted-foreground">{sender.sender}</span>
                <span className="font-mono text-foreground">{sender.count}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}

function EmailRow({ email, selected, active, onToggle, onOpen, onMove }: {
  email: EmailTriageMessage
  selected: boolean
  active: boolean
  onToggle: () => void
  onOpen: () => void
  onMove: (bucket: string) => void
}) {
  return (
    <article className={`border-b border-border px-4 py-3 hover:bg-secondary/40 ${active ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : ''}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={selected}
          onChange={onToggle}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Select ${email.subject || email.gmail_message_id}`}
        />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{email.from_name || email.from_email || email.sender_domain || 'Unknown sender'}</span>
            {email.from_email && <span className="text-xs text-muted-foreground">{email.from_email}</span>}
            <BucketBadge bucket={email.bucket} />
            {email.case_slug && <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-300">case:{email.case_slug}</span>}
            {email.contact_name && <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[11px] text-purple-300">{email.contact_name}</span>}
            {email.paralegal_review_status === 'pending' && <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[11px] text-orange-300">paralegal review</span>}
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{email.suggested_action.replace(/_/g, ' ')}</span>
          </div>
          <h3 className="mt-1 truncate text-sm text-foreground">{email.subject || '(no subject)'}</h3>
          {email.snippet && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{email.snippet}</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>{formatTimestamp(email.sent_at)}</span>
            {email.confidence != null && <span>{Math.round(email.confidence * 100)}% confidence</span>}
            {email.reason && <span>{email.reason}</span>}
            {email.has_attachments ? <span>attachment</span> : null}
          </div>
        </button>
        <select
          className="mt-1 h-8 rounded border bg-background px-2 text-xs text-foreground"
          value={email.bucket}
          onChange={(event) => onMove(event.target.value)}
          aria-label={`Move ${email.subject || email.gmail_message_id} to category`}
        >
          {buckets.filter((item) => item.id !== 'all').map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </div>
    </article>
  )
}

function EmailPreview({ email, loading }: { email: EmailTriageMessage | null; loading: boolean }) {
  if (!email) {
    return (
      <section className="min-h-0 overflow-hidden p-6 text-sm text-muted-foreground">
        Select an email to load the message body here. The controls stay fixed while this pane and the email list scroll independently.
      </section>
    )
  }
  return (
    <section className="min-h-0 overflow-hidden flex flex-col">
      <header className="border-b border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <BucketBadge bucket={email.bucket} />
          {email.case_slug && <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-300">case:{email.case_slug}</span>}
          {email.contact_name && <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[11px] text-purple-300">{email.contact_name}</span>}
          {email.contact_match_type && email.contact_match_value && <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">matched {email.contact_match_type}: {email.contact_match_value}</span>}
          {email.paralegal_review_status === 'pending' && <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[11px] text-orange-300">paralegal review pending</span>}
          {loading && <span className="text-xs text-muted-foreground">Loading body…</span>}
        </div>
        <h3 className="mt-2 text-base font-semibold text-foreground">{email.subject || '(no subject)'}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {email.from_name || email.from_email || 'Unknown sender'} {email.from_email ? `<${email.from_email}>` : ''}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{formatTimestamp(email.sent_at)}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-background p-4">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
          {email.body_text || email.snippet || 'No body fetched yet.'}
        </pre>
      </div>
    </section>
  )
}

function BucketBadge({ bucket }: { bucket: string }) {
  const color = bucket === 'ops_action' ? 'text-red-300 border-red-500/30 bg-red-500/10'
    : bucket === 'case_related' ? 'text-blue-300 border-blue-500/30 bg-blue-500/10'
      : bucket === 'junk' ? 'text-zinc-300 border-zinc-500/30 bg-zinc-500/10'
        : bucket === 'personal' ? 'text-pink-300 border-pink-500/30 bg-pink-500/10'
          : 'text-amber-300 border-amber-500/30 bg-amber-500/10'
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${color}`}>{bucket.replace(/_/g, ' ')}</span>
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
    </div>
  )
}

function formatTimestamp(value?: number | null): string {
  if (!value) return '—'
  return new Date(value * 1000).toLocaleString()
}

function defaultActionForBucket(bucket: string): string {
  switch (bucket) {
    case 'case_related': return 'case_route'
    case 'ops_action': return 'ops_alert'
    case 'receipt':
    case 'newsletter':
    case 'junk': return 'mark_read_archive'
    default: return 'none'
  }
}
