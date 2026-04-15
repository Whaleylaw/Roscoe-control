import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// Covers: GSD-23.
// LifecycleEmptyState renders when gsd_enabled=0 and exposes the
// Enable CTA that issues PATCH /api/projects/:id with {gsd_enabled:1}
// per D-21.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `lifecycle.${key}`,
}))

import { LifecycleEmptyState } from '@/components/project/lifecycle/empty-state'

afterEach(() => cleanup())

describe('LifecycleEmptyState (GSD-23)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('gsd_enabled=0 (variant="non-gsd") renders heading + body + Enable CTA', () => {
    const onEnable = vi.fn()
    render(<LifecycleEmptyState variant="non-gsd" onEnable={onEnable} />)
    // heading text from translation stub: lifecycle.empty.heading
    expect(screen.getByText('lifecycle.empty.heading')).toBeTruthy()
    expect(screen.getByText('lifecycle.empty.body')).toBeTruthy()
    const cta = screen.getByRole('button', { name: /lifecycle\.cta\.enable/ })
    expect(cta).toBeTruthy()
  })

  it('not-bootstrapped variant renders bootstrap heading + Bootstrap CTA', () => {
    const onBootstrap = vi.fn()
    render(<LifecycleEmptyState variant="not-bootstrapped" onBootstrap={onBootstrap} />)
    expect(screen.getByText('lifecycle.empty.notBootstrapped.heading')).toBeTruthy()
    expect(screen.getByText('lifecycle.empty.notBootstrapped.body')).toBeTruthy()
    const cta = screen.getByRole('button', { name: /lifecycle\.cta\.bootstrap/ })
    expect(cta).toBeTruthy()
  })

  it('viewer role renders Enable CTA disabled', () => {
    render(<LifecycleEmptyState variant="non-gsd" isViewer />)
    const cta = screen.getByRole('button', { name: /lifecycle\.cta\.enable/ })
    expect((cta as HTMLButtonElement).disabled).toBe(true)
  })

  it('clicking Enable CTA invokes onEnable (per D-21 — parent issues PATCH)', () => {
    const onEnable = vi.fn()
    render(<LifecycleEmptyState variant="non-gsd" onEnable={onEnable} />)
    const cta = screen.getByRole('button', { name: /lifecycle\.cta\.enable/ })
    fireEvent.click(cta)
    expect(onEnable).toHaveBeenCalledTimes(1)
  })
})
