/**
 * Phase 09 Plan 08 — Wave 3c.
 * Covers: GSD-24, D-22, D-37.
 *
 * PhaseBadge renders a small monospace pill of the task's GSD phase
 * on the task card. Returns null when task.gsd_phase is nullish (D-22 —
 * non-GSD tasks must look identical to v1.0). Value is rendered literal
 * English per D-37 (uppercased phase name).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PhaseBadge } from '../phase-badge'

describe('PhaseBadge (GSD-24)', () => {
  it('renders upper-cased phase value when task.gsd_phase="plan" → "PLAN"', () => {
    render(<PhaseBadge task={{ gsd_phase: 'plan' }} />)
    expect(screen.getByText('PLAN')).toBeInTheDocument()
  })

  it('renders nothing when task.gsd_phase is null (D-22)', () => {
    const { container } = render(<PhaseBadge task={{ gsd_phase: null }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when task.gsd_phase is undefined (D-22)', () => {
    const { container } = render(<PhaseBadge task={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('carries classes text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono (UI-SPEC)', () => {
    render(<PhaseBadge task={{ gsd_phase: 'execute' }} />)
    const el = screen.getByText('EXECUTE')
    // Verbatim class list from UI-SPEC — visual parity with ticket_ref badge.
    expect(el).toHaveClass('text-[10px]', 'px-1.5', 'py-0.5', 'rounded', 'bg-primary/15', 'text-primary', 'font-mono')
  })
})
