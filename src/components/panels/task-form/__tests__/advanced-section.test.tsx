/**
 * Tests for AdvancedSection — Phase 16 Plan 05 (RUI-04).
 *
 * Covers:
 *  1. Default collapsed — subcomponents not rendered.
 *  2. Click heading → expands and children render.
 *  3. Disabled → lockedHint visible; subcomponents receive disabled.
 *  4. Heading toggles expanded state (collapse after expand).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}))

import { AdvancedSection } from '../advanced-section'

afterEach(() => {
  cleanup()
})

function baseProps() {
  return {
    mounts: [],
    onMountsChange: vi.fn(),
    skills: [],
    onSkillsChange: vi.fn(),
    modelOverride: '',
    onModelOverrideChange: vi.fn(),
  }
}

describe('AdvancedSection', () => {
  it('is collapsed by default — subcomponents not in DOM', () => {
    render(<AdvancedSection {...baseProps()} />)
    // Heading button has aria-expanded="false".
    const heading = screen.getByRole('button', { name: /taskBoard\.advancedSection\.heading/ })
    expect(heading.getAttribute('aria-expanded')).toBe('false')
    // MountsEditor label text not rendered when collapsed.
    expect(screen.queryByText(/taskBoard\.advancedSection\.readOnlyMountsLabel/)).toBeNull()
    expect(screen.queryByText(/taskBoard\.advancedSection\.modelOverrideLabel/)).toBeNull()
  })

  it('clicking the heading expands and renders the children', () => {
    render(<AdvancedSection {...baseProps()} />)
    const heading = screen.getByRole('button', { name: /taskBoard\.advancedSection\.heading/ })
    fireEvent.click(heading)
    expect(heading.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/taskBoard\.advancedSection\.readOnlyMountsLabel/)).toBeInTheDocument()
    expect(screen.getByText(/taskBoard\.advancedSection\.extraSkillsLabel/)).toBeInTheDocument()
    expect(screen.getByText(/taskBoard\.advancedSection\.modelOverrideLabel/)).toBeInTheDocument()
  })

  it('disabled → lockedHint visible; subcomponents receive disabled', () => {
    render(<AdvancedSection {...baseProps()} disabled lockedHint="LOCKED_ADVANCED" />)
    // Expand first.
    const heading = screen.getByRole('button', { name: /taskBoard\.advancedSection\.heading/ })
    fireEvent.click(heading)

    expect(screen.getByText('LOCKED_ADVANCED')).toBeInTheDocument()
    // Model override input is readOnly because disabled propagates down.
    const modelInput = screen.getByPlaceholderText(/taskBoard\.advancedSection\.modelOverridePlaceholder/) as HTMLInputElement
    expect(modelInput.readOnly).toBe(true)
    // Mounts Add button is hidden.
    expect(screen.queryByText(/taskBoard\.advancedSection\.addMount/)).toBeNull()
  })

  it('heading toggles expanded state (expand then collapse)', () => {
    render(<AdvancedSection {...baseProps()} />)
    const heading = screen.getByRole('button', { name: /taskBoard\.advancedSection\.heading/ })
    fireEvent.click(heading)
    expect(heading.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(heading)
    expect(heading.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/taskBoard\.advancedSection\.readOnlyMountsLabel/)).toBeNull()
  })
})
