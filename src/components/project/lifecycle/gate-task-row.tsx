'use client'

import { useRef, useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type { Task } from '@/store'
import { Button } from '@/components/ui/button'

interface GateTaskRowProps {
  task: Task
  onApprove: (taskId: number, note?: string) => Promise<void> | void
  onReject: (taskId: number, note?: string) => Promise<void> | void
  isViewer: boolean
}

type RowMode = 'idle' | 'rejecting'

export function GateTaskRow({ task, onApprove, onReject, isViewer }: GateTaskRowProps) {
  const t = useTranslations('project.lifecycle')
  const [mode, setMode] = useState<RowMode>('idle')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Auto-focus the note input when entering reject mode.
  useEffect(() => {
    if (mode === 'rejecting' && inputRef.current) {
      inputRef.current.focus()
    }
  }, [mode])

  const ticketRef = task.ticket_ref ?? String(task.id)
  const status = task.gate_status ?? 'pending'

  const statusPill = (() => {
    if (status === 'approved') {
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20">
          {t('gate.statusApproved')}
        </span>
      )
    }
    if (status === 'rejected') {
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">
          {t('gate.statusRejected')}
        </span>
      )
    }
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
        {t('gate.statusPending')}
      </span>
    )
  })()

  const handleApprove = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onApprove(task.id)
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmReject = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onReject(task.id, note.trim() ? note.trim() : undefined)
      setMode('idle')
      setNote('')
    } finally {
      setBusy(false)
    }
  }

  const cancelReject = () => {
    setMode('idle')
    setNote('')
  }

  return (
    <li className="px-3 py-2 flex items-center gap-2 flex-wrap">
      <span className="font-mono-tight text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
        {ticketRef}
      </span>
      <span className="text-sm text-foreground truncate">{task.title}</span>
      <span className="ml-auto flex items-center gap-2">
        {mode === 'idle' && statusPill}
        {!isViewer && mode === 'idle' && (
          <>
            <Button
              size="xs"
              variant="success"
              aria-label={`Approve gate for ${ticketRef}`}
              onClick={handleApprove}
              disabled={busy || status === 'approved'}
            >
              {t('gate.approve')}
            </Button>
            <Button
              size="xs"
              variant="destructive"
              aria-label={`Reject gate for ${ticketRef}`}
              onClick={() => setMode('rejecting')}
              disabled={busy}
            >
              {t('gate.reject')}
            </Button>
          </>
        )}
        {!isViewer && mode === 'rejecting' && (
          <>
            <input
              ref={inputRef}
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelReject()
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleConfirmReject()
                }
              }}
              placeholder={t('gate.rejectNotePlaceholder')}
              className="bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              size="xs"
              variant="destructive"
              onClick={() => void handleConfirmReject()}
              disabled={busy}
            >
              {t('gate.rejectConfirmSubmit')}
            </Button>
            <Button size="xs" variant="ghost" onClick={cancelReject} disabled={busy}>
              {t('cta.cancel')}
            </Button>
          </>
        )}
      </span>
    </li>
  )
}
