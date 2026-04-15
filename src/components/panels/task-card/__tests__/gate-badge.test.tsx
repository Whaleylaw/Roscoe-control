/**
 * Phase 09 Plan 08 — Wave 3c.
 * Covers: GSD-25, D-06.
 *
 * GateBadge renders an amber "🔒 Approval required" or green "✓ Approved"
 * pill on the task card when gate_required=1. Copy is sourced from
 * next-intl translations (project.lifecycle.gate.*), never hard-coded.
 * Emoji prefix lives inside the translated string per UI-SPEC (atomic
 * translatable unit).
 */
import type { ReactNode } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '../../../../../messages/en.json'
import { GateBadge } from '../gate-badge'

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider messages={messages as never} locale="en">
      {ui}
    </NextIntlClientProvider>
  )
}

describe('GateBadge (GSD-25)', () => {
  it('gate_required=0 → renders nothing', () => {
    const { container } = renderWithIntl(
      <GateBadge task={{ gate_required: 0, gate_status: 'not_required' }} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('gate_required=undefined → renders nothing', () => {
    const { container } = renderWithIntl(<GateBadge task={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('gate_required=1, gate_status="approved" → green badge with "✓ Approved"', () => {
    renderWithIntl(<GateBadge task={{ gate_required: 1, gate_status: 'approved' }} />)
    const el = screen.getByText('✓ Approved')
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('bg-green-500/15', 'text-green-400', 'border-green-500/20')
  })

  it('gate_required=1, gate_status="pending" → amber "🔒 Approval required"', () => {
    renderWithIntl(<GateBadge task={{ gate_required: 1, gate_status: 'pending' }} />)
    const el = screen.getByText('🔒 Approval required')
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('bg-amber-500/15', 'text-amber-400', 'border-amber-500/20')
  })

  it('gate_required=1, gate_status="rejected" → amber "🔒 Approval required"', () => {
    renderWithIntl(<GateBadge task={{ gate_required: 1, gate_status: 'rejected' }} />)
    expect(screen.getByText('🔒 Approval required')).toBeInTheDocument()
  })

  it('gate_required=1, gate_status="not_required" → amber "🔒 Approval required" (any non-approved state)', () => {
    renderWithIntl(<GateBadge task={{ gate_required: 1, gate_status: 'not_required' }} />)
    expect(screen.getByText('🔒 Approval required')).toBeInTheDocument()
  })
})
