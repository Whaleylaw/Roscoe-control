import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Covers: GSD-21.
// PhaseTimeline renders the five-phase strip with aria-current on the
// active step, "✓" prefix on completed steps, and dimmed future steps.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { PhaseTimeline } from '@/components/project/lifecycle/phase-timeline'

afterEach(() => cleanup())

describe('PhaseTimeline (GSD-21)', () => {
  it('renders 5 steps: Discuss, Plan, Execute, Verify, Done (literal English, D-37)', () => {
    render(<PhaseTimeline currentPhase="discuss" />)
    const list = screen.getByRole('list')
    expect(list).toBeTruthy()
    const items = list.querySelectorAll('li')
    expect(items.length).toBe(5)
    const labelText = items[0].textContent?.trim()
    expect(labelText).toBe('Discuss')
    // every phase name literally present across all steps (D-37)
    const joined = Array.from(items).map(li => li.textContent || '').join('|')
    expect(joined).toContain('Discuss')
    expect(joined).toContain('Plan')
    expect(joined).toContain('Execute')
    expect(joined).toContain('Verify')
    expect(joined).toContain('Done')
  })

  it('current phase has aria-current="step" and bg-primary class', () => {
    render(<PhaseTimeline currentPhase="execute" />)
    const items = screen.getAllByRole('listitem')
    // execute is index 2
    expect(items[2].getAttribute('aria-current')).toBe('step')
    expect(items[2].className).toContain('bg-primary')
    // others not aria-current
    expect(items[0].getAttribute('aria-current')).toBeNull()
    expect(items[4].getAttribute('aria-current')).toBeNull()
  })

  it('past phases show "✓" prefix', () => {
    render(<PhaseTimeline currentPhase="verify" />)
    const items = screen.getAllByRole('listitem')
    // past = discuss/plan/execute (indices 0,1,2)
    expect(items[0].textContent).toContain('✓')
    expect(items[1].textContent).toContain('✓')
    expect(items[2].textContent).toContain('✓')
    // current (verify) has no ✓ prefix
    expect(items[3].textContent?.startsWith('✓')).toBe(false)
    // future (done) has no ✓ prefix
    expect(items[4].textContent?.startsWith('✓')).toBe(false)
  })

  it('future phases have opacity-60', () => {
    render(<PhaseTimeline currentPhase="discuss" />)
    const items = screen.getAllByRole('listitem')
    // future unreachable = execute/verify/done (indices 2,3,4). plan (index 1) is 'next' reachable.
    expect(items[2].className).toContain('opacity-60')
    expect(items[3].className).toContain('opacity-60')
    expect(items[4].className).toContain('opacity-60')
    // next reachable step (plan) does NOT get opacity-60
    expect(items[1].className).not.toContain('opacity-60')
  })

  it('uses role="list" and collapses to grid-cols-1 at sm breakpoint', () => {
    render(<PhaseTimeline currentPhase="discuss" />)
    const list = screen.getByRole('list')
    expect(list.tagName).toBe('OL')
    expect(list.className).toContain('grid-cols-1')
    expect(list.className).toContain('sm:grid-cols-5')
  })
})
